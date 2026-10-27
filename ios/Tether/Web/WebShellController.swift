import AVKit
import Foundation
import PhotosUI
import TetherKit
import UIKit
import WebKit

@MainActor
final class WebShellController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply, KeyboardInputDelegate, PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    private let model: TetherAppModel
    private let schemeHandler: AppSchemeHandler
    private let haptics = Haptics()
    private let uploader = Uploader()
    private let terminalInput = KeyboardInput(frame: .zero)
    private var focus: FocusController!
    private var webView: WKWebView!
    private var webViewConstraints: [NSLayoutConstraint] = []
    private var bottomConstraint: NSLayoutConstraint!
    private var pendingInput: [InputEvent] = []
    private var inputFlushQueued = false
    private var lineReceiverReady = false
    private var activeTab: TabKey?
    private var lastViewport: Viewport?
    private var pendingPick: PendingPick?
    private lazy var messageHandlerProxy = WeakScriptMessageHandler(target: self)

    init(model: TetherAppModel) {
        self.model = model
        schemeHandler = AppSchemeHandler(model: model)
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        view.insetsLayoutMarginsFromSafeArea = false

        webView = makeWebView()

        terminalInput.output = self
        view.addSubview(terminalInput)
        focus = FocusController(input: terminalInput)

        terminalInput.translatesAutoresizingMaskIntoConstraints = false
        bottomConstraint = webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        webViewConstraints = constraints(for: webView, bottom: bottomConstraint)
        NSLayoutConstraint.activate(webViewConstraints + [
            terminalInput.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            terminalInput.topAnchor.constraint(equalTo: view.topAnchor),
            terminalInput.widthAnchor.constraint(equalToConstant: 0),
            terminalInput.heightAnchor.constraint(equalToConstant: 0),
        ])

        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillChange(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillHide(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
        focus.set(.hidden)
        model.attach(self)
        loadUI()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        publishViewportIfChanged()
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in self?.publishViewportIfChanged(force: true) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        focus.restoreAfterInterruption()
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    func send(_ type: BridgeMessageType, fields: [String: JSONValue]) {
        send(type, fields: fields, completion: nil)
    }

    private func send(_ type: BridgeMessageType, fields: [String: JSONValue], completion: ((Bool) -> Void)?) {
        guard let message = try? BridgeMessage(type: type, fields: fields),
              let object = try? jsonObject(message) else {
            completion?(false)
            return
        }
        webView.callAsyncJavaScript(
            "window.__tether?.receive([message]);",
            arguments: ["message": object],
            in: nil,
            in: .page,
            completionHandler: { result in
                if case .success = result { completion?(true) }
                else { completion?(false) }
            }
        )
    }

    func sendLifecycle(_ lifecycle: Lifecycle, completion: @escaping () -> Void) {
        do {
            send(.lifecycle, fields: ["lifecycle": try .encode(lifecycle)]) { _ in completion() }
        } catch {
            completion()
            assertionFailure("Native lifecycle is not JSON encodable: \(error)")
        }
    }

    func coverNativeScreen(_ covered: Bool) {
        focus.coverNativeScreen(covered)
        if covered { view.endEditing(true) }
    }

    func restoreFocus() { focus.restoreAfterInterruption() }

    func send(_ event: NativeEvent) {
        do {
            switch event {
            case .input(let tab, let events):
                send(.input, fields: ["tab": try .encode(tab), "events": try .encode(events)])
            case .viewport(let viewport):
                send(.viewport, fields: ["viewport": try .encode(viewport)])
            case .lifecycle(let lifecycle):
                send(.lifecycle, fields: ["lifecycle": try .encode(lifecycle)])
            case .hosts(let hosts):
                send(.hosts, fields: ["hosts": try .encode(hosts)])
            case .upload(let id, let progress, let path, let error, let cancelled):
                var fields: [String: JSONValue] = ["id": .string(id), "progress": .number(progress)]
                if let path { fields["path"] = .string(path) }
                if let error { fields["error"] = .string(error) }
                if cancelled { fields["cancelled"] = .bool(true) }
                send(.upload, fields: fields)
            }
        } catch {
            assertionFailure("Native bridge event is not JSON encodable: \(error)")
        }
    }

    func keyboardInput(_ event: InputEvent) {
        pendingInput.append(event)
        guard !inputFlushQueued else { return }
        inputFlushQueued = true
        DispatchQueue.main.async { [weak self] in self?.flushInput() }
    }

    func keyboardInputWarning() { haptics.send("warning") }

    func keyboardInputLineEdit(gen: Int, text: String, tab: TabKey, selection: NSRange, marked: NSRange?) {
        guard focus.mode == .line, !focus.covered, !model.isLocked else { return }
        flushInput()
        sendLineEdit(gen: gen, text: text, tab: tab, selection: selection, marked: marked)
    }

    func keyboardInputLineReturn(gen: Int, text: String, tab: TabKey) -> Bool {
        guard lineReceiverReady, focus.mode == .line, !focus.covered, !model.isLocked else { return false }
        flushInput()
        do {
            send(.lineReturn, fields: [
                "gen": .number(Double(gen)),
                "text": .string(text),
                "tab": try .encode(tab),
            ])
            return true
        } catch {
            assertionFailure("Native line return target is not JSON encodable: \(error)")
            return false
        }
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "tether-app",
              message.frameInfo.securityOrigin.host == "ui" else {
            replyHandler(nil, "bridge messages must come from the app's main frame")
            return
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: message.body, options: [.fragmentsAllowed])
            let request = try JSONDecoder().decode(BridgeMessage.self, from: data)
            guard request.type.direction == .webToNative else { throw BridgeError.malformed }
            route(request, reply: replyHandler)
        } catch {
            replyHandler(nil, "invalid bridge message")
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame?.isMainFrame == false {
            decisionHandler(.cancel)
            return
        }
        if url.scheme == "tether-app", url.host == "ui", url.path == "/index.html" {
            decisionHandler(.allow)
            return
        }
        if ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
        }
        return nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { loadUI(fragment: webView.url?.fragment) }

    private func loadUI(fragment: String? = nil) {
        lineReceiverReady = false
        var components = URLComponents()
        components.scheme = "tether-app"
        components.host = "ui"
        components.path = "/index.html"
        components.fragment = fragment
        guard let url = components.url else { return }
        webView.load(URLRequest(url: url))
    }

    private func recreateWebView() {
        let previous = webView!
        let fragment = previous.url?.fragment
        NSLayoutConstraint.deactivate(webViewConstraints)
        previous.configuration.userContentController.removeScriptMessageHandler(forName: "tether", contentWorld: .page)
        previous.navigationDelegate = nil
        previous.uiDelegate = nil
        previous.removeFromSuperview()
        webView = makeWebView()
        bottomConstraint = webView.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: bottomConstraint.constant)
        webViewConstraints = constraints(for: webView, bottom: bottomConstraint)
        NSLayoutConstraint.activate(webViewConstraints)
        loadUI(fragment: fragment)
    }

    private func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: "tether-app")
        configuration.allowsInlineMediaPlayback = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.userContentController.addScriptMessageHandler(messageHandlerProxy, contentWorld: .page, name: "tether")

        let result = WKWebView(frame: .zero, configuration: configuration)
        result.translatesAutoresizingMaskIntoConstraints = false
        result.navigationDelegate = self
        result.uiDelegate = self
        result.scrollView.contentInsetAdjustmentBehavior = .never
        result.scrollView.bounces = false
        result.scrollView.keyboardDismissMode = .none
        result.scrollView.isScrollEnabled = false
        result.allowsBackForwardNavigationGestures = false
        #if DEBUG
        result.isInspectable = true
        #endif
        view.addSubview(result)
        return result
    }

    private func constraints(for webView: WKWebView, bottom: NSLayoutConstraint) -> [NSLayoutConstraint] {
        [
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            bottom,
        ]
    }

    private func route(_ request: BridgeMessage, reply: @escaping (Any?, String?) -> Void) {
        do {
            switch request.type {
            case .ready:
                let focusMode = focus.modeForWeb
                let lineSnapshot = focusMode == .line ? terminalInput.lineSnapshot() : nil
                let boot = try jsonObject(model.boot(viewport: viewport(), focusMode: focusMode, lineSnapshot: lineSnapshot))
                lineReceiverReady = true
                reply(boot, nil)
            case .socket:
                let host: String = try request.field("host")
                reply(try jsonObject(model.socket(for: host)), nil)
            case .hostRejected:
                let host: String = try request.field("host")
                let token: String = try request.field("token")
                model.rejectedToken(for: host, token: token)
                reply(NSNull(), nil)
            case .recreateWebView:
                lineReceiverReady = false
                reply(NSNull(), nil)
                DispatchQueue.main.async { [weak self] in self?.recreateWebView() }
            case .saveWorkspace:
                model.saveWorkspace(try request.field("workspace"))
                reply(NSNull(), nil)
            case .focus:
                let mode: String = try request.field("mode")
                guard let next = FocusController.Mode(rawValue: mode) else { throw BridgeError.malformed }
                focus.set(next)
                reply(NSNull(), nil)
            case .activeTab:
                let tab: JSONValue = try request.field("tab")
                if case .null = tab { activeTab = nil }
                else { activeTab = try tab.decode(TabKey.self) }
                reply(NSNull(), nil)
            case .manageHosts:
                model.showingServers = true
                reply(NSNull(), nil)
            case .lineSet:
                let text: String = try request.field("text")
                let caret: Int = try request.field("caret")
                let tab: TabKey = try request.field("tab")
                let snapshot = terminalInput.setLine(text: text, caret: caret, tab: tab)
                reply(try jsonObject(snapshot.gen), nil)
            case .lineCaret:
                terminalInput.setLineCaret(try request.field("index"))
                reply(NSNull(), nil)
            case .lineCaretStep:
                let step: Int = try request.field("step")
                guard step == -1 || step == 1 else { throw BridgeError.malformed }
                terminalInput.stepLineCaret(step)
                reply(NSNull(), nil)
            case .lineInsert:
                let text: String = try request.field("text")
                guard !text.contains(where: { $0.isNewline }) else { throw BridgeError.malformed }
                terminalInput.insertLine(text)
                reply(NSNull(), nil)
            case .lineSubmit:
                terminalInput.submitLine()
                reply(NSNull(), nil)
            case .lineSelectAll:
                terminalInput.selectAllLine()
                reply(NSNull(), nil)
            case .modifiers:
                let value: JSONValue = try request.field("armed")
                let armed: String?
                if case .null = value { armed = nil }
                else if case .string(let name) = value, name == "ctrl" || name == "alt" { armed = name }
                else { throw BridgeError.malformed }
                terminalInput.setArmedModifier(armed)
                reply(NSNull(), nil)
            case .draftGet:
                reply(try jsonObject(model.drafts.get(request.field("key"))), nil)
            case .draftPut:
                let record: DraftRecord = try request.field("record")
                let baseRevision: Int = try request.field("baseRevision")
                reply(try jsonObject(model.drafts.put(record, baseRevision: baseRevision)), nil)
            case .draftDelete:
                let key: TabKey = try request.field("key")
                model.drafts.delete(key)
                reply(NSNull(), nil)
            case .draftList:
                reply(try jsonObject(model.drafts.list()), nil)
            case .copy:
                let text: String = try request.field("text")
                UIPasteboard.general.string = text
                reply(try jsonObject("ok"), nil)
            case .readPasteboard:
                let tab: TabKey = try request.field("tab")
                let result = readPasteboard(host: tab.host, id: try request.field("id"))
                reply(try jsonObject(result), nil)
            case .haptic:
                haptics.send(try request.field("kind"))
                reply(NSNull(), nil)
            case .pickMedia:
                showMediaPicker(host: try request.field("host"), id: try request.field("id"))
                reply(NSNull(), nil)
            case .playVideo:
                let host: String = try request.field("host")
                let path: String = try request.field("path")
                playVideo(host: host, path: path)
                reply(NSNull(), nil)
            case .openURL:
                let value: String = try request.field("url")
                guard let url = URL(string: value), ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") else { throw BridgeError.malformed }
                UIApplication.shared.open(url)
                reply(NSNull(), nil)
            case .ack:
                reply(NSNull(), nil)
            case .input, .lineEdit, .lineReturn, .viewport, .lifecycle, .hosts, .upload:
                throw BridgeError.malformed
            }
        } catch {
            reply(nil, "native request failed")
        }
    }

    private func readPasteboard(host: String, id: String) -> JSONValue {
        if let image = UIPasteboard.general.image {
            upload(image, id: id, host: host)
            return .object(["uploading": .string(id)])
        }
        if let text = UIPasteboard.general.string { return .object(["text": .string(text)]) }
        return .string("empty")
    }

    private func showMediaPicker(host: String, id: String) {
        let target = PendingPick(host: host, id: id)
        // UIKit drops a present while another is up (a double tap on Upload); end the stream instead of leaving it open.
        guard presentedViewController == nil else { cancel(target); return }
        let alert = UIAlertController(title: "Add image", message: nil, preferredStyle: .actionSheet)
        alert.addAction(UIAlertAction(title: "Photo Library", style: .default) { [weak self] _ in self?.presentPhotoLibrary(target) })
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            alert.addAction(UIAlertAction(title: "Camera", style: .default) { [weak self] _ in self?.presentCamera(target) })
        }
        alert.addAction(UIAlertAction(title: "Paste Image", style: .default) { [weak self] _ in
            guard let image = UIPasteboard.general.image else { self?.cancel(target); return }
            self?.upload(image, id: id, host: host)
        })
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in self?.cancel(target) })
        alert.popoverPresentationController?.sourceView = view
        alert.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        present(alert, animated: true)
    }

    private func presentPhotoLibrary(_ target: PendingPick) {
        var configuration = PHPickerConfiguration()
        configuration.filter = .images
        configuration.selectionLimit = 1
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        pendingPick = target
        present(picker, animated: true)
    }

    private func presentCamera(_ target: PendingPick) {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = ["public.image"]
        picker.delegate = self
        pendingPick = target
        present(picker, animated: true)
    }

    /// Every `upload` event is deferred one turn: a paste's reply to the page goes out first, so its
    /// stream exists before the first event arrives.
    private func sendUpload(id: String, progress: Double, path: String? = nil, error: String? = nil, cancelled: Bool = false) {
        Task { @MainActor [weak self] in
            self?.send(.upload(id: id, progress: progress, path: path, error: error, cancelled: cancelled))
        }
    }

    private func cancel(_ pick: PendingPick) { sendUpload(id: pick.id, progress: 1, cancelled: true) }

    private func upload(_ image: UIImage, id: String, host hostID: String) {
        guard let data = Self.jpegData(image),
              let host = model.hosts.first(where: { $0.id == hostID }) else {
            sendUpload(id: id, progress: 1, error: "Couldn't prepare this image.")
            return
        }
        guard case .token(let token) = model.token(for: hostID) else {
            sendUpload(id: id, progress: 1, error: "Unlock tether to upload this image.")
            return
        }
        let accepted = uploader.upload(id: id, host: host, data: data, fileName: "image.jpg", token: token, rejectedToken: { [weak model = self.model] rejectedToken in
            model?.rejectedToken(for: host.id, token: rejectedToken)
        }, progress: { [weak self] progress in
            self?.sendUpload(id: id, progress: progress)
        }, completion: { [weak self] result in
            switch result {
            case .success(let path): self?.sendUpload(id: id, progress: 1, path: path)
            case .failure(let error): self?.sendUpload(id: id, progress: 1, error: error.localizedDescription)
            }
        })
        if accepted { sendUpload(id: id, progress: 0) }
        else { sendUpload(id: id, progress: 1, error: "Wait for the current uploads to finish.") }
    }

    private func playVideo(host: String, path: String) {
        guard let stored = model.hosts.first(where: { $0.id == host }),
              case .token(let token) = model.token(for: host),
              var components = URLComponents(string: stored.baseURL) else { return }
        let segments = path.split(separator: "/").map { segment in
            segment.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? String(segment)
        }
        components.percentEncodedPath = "/fs/raw/" + segments.joined(separator: "/")
        guard let url = components.url else { return }
        let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": ["Authorization": "Bearer \(token)"]])
        let player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
        let controller = AVPlayerViewController()
        controller.player = player
        present(controller, animated: true) { player.play() }
    }

    private static func jpegData(_ image: UIImage) -> Data? {
        let pixelWidth = image.size.width * image.scale
        let pixelHeight = image.size.height * image.scale
        guard pixelWidth > 0, pixelHeight > 0 else { return nil }
        let factor = min(1, 2048 / max(pixelWidth, pixelHeight))
        let size = CGSize(
            width: max(1, floor(image.size.width * factor)),
            height: max(1, floor(image.size.height * factor))
        )
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let thumbnail = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        return thumbnail.jpegData(compressionQuality: 0.9)
    }

    private func flushInput() {
        inputFlushQueued = false
        let events = pendingInput
        pendingInput.removeAll(keepingCapacity: true)
        guard !events.isEmpty, !model.isLocked, !focus.covered, let activeTab else { return }
        send(.input(tab: activeTab, events: events))
    }

    private func sendLineEdit(gen: Int, text: String, tab: TabKey, selection: NSRange, marked: NSRange?) {
        let range = { (value: NSRange) in
            JSONValue.object(["start": .number(Double(value.location)), "end": .number(Double(NSMaxRange(value)))])
        }
        do {
            send(.lineEdit, fields: [
                "gen": .number(Double(gen)),
                "text": .string(text),
                "tab": try .encode(tab),
                "selection": range(selection),
                "marked": marked.map(range) ?? .null,
            ])
        } catch {
            assertionFailure("Native line edit target is not JSON encodable: \(error)")
        }
    }

    private func publishViewportIfChanged(force: Bool = false) {
        guard isViewLoaded else { return }
        let next = viewport()
        guard force || next != lastViewport else { return }
        lastViewport = next
        send(.viewport(next))
    }

    private func viewport() -> Viewport {
        let stable = max(0, view.bounds.height)
        let visible = max(0, webView?.bounds.height ?? stable)
        // A docked keyboard moves the web view's bottom edge up, so the keyboard covers none of
        // the page: the dock and sheets sit at the bottom of the resized view, and the web lifts
        // nothing (ios-shell.md, "Keyboard geometry"). `covered` is the frame the keyboard took,
        // which is what the keyboard-dependent chrome keys on.
        let covered = max(0, stable - visible)
        let width = max(0, view.bounds.width)
        let safe = view.safeAreaInsets
        return Viewport(
            layout: min(width, stable) < 600 ? "phone" : "desktop",
            density: "touch",
            scheme: traitCollection.userInterfaceStyle == .dark ? "dark" : "light",
            width: width,
            stableHeight: stable,
            visibleHeight: visible,
            keyboardInset: 0,
            safeArea: SafeArea(top: safe.top, right: safe.right, bottom: safe.bottom, left: safe.left),
            keyboard: covered >= 120
        )
    }

    @objc private func keyboardWillChange(_ notification: Notification) {
        guard let info = notification.userInfo,
              let screenFrame = info[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        let frame = view.convert(screenFrame, from: nil)
        let docked = frame.maxY >= view.bounds.maxY - 1 && frame.minY < view.bounds.maxY
        bottomConstraint.constant = docked ? -(view.bounds.maxY - frame.minY) : 0
        let duration = info[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
        let curve = info[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt ?? 7
        let options = UIView.AnimationOptions(rawValue: curve << 16).union(.beginFromCurrentState)
        UIView.animate(withDuration: duration, delay: 0, options: options) {
            self.view.layoutIfNeeded()
        } completion: { [weak self] _ in
            self?.publishViewportIfChanged(force: true)
        }
    }

    @objc private func keyboardWillHide(_ notification: Notification) {
        focus.systemKeyboardDidHide()
        bottomConstraint.constant = 0
        let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
        UIView.animate(withDuration: duration) {
            self.view.layoutIfNeeded()
        } completion: { [weak self] _ in self?.publishViewportIfChanged(force: true) }
    }

    private func jsonObject<T: Encodable>(_ value: T) throws -> Any {
        let data = try JSONEncoder().encode(value)
        return try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        let pick = pendingPick
        pendingPick = nil
        dismiss(animated: true)
        guard let pick else { return }
        guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else {
            cancel(pick)
            return
        }
        provider.loadObject(ofClass: UIImage.self) { [weak self] object, _ in
            Task { @MainActor in
                guard let image = object as? UIImage else {
                    self?.sendUpload(id: pick.id, progress: 1, error: "Couldn't read this image.")
                    return
                }
                self?.upload(image, id: pick.id, host: pick.host)
            }
        }
    }

    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        let pick = pendingPick
        pendingPick = nil
        dismiss(animated: true)
        guard let pick else { return }
        if let image = info[.originalImage] as? UIImage { upload(image, id: pick.id, host: pick.host) }
        else { cancel(pick) }
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        let pick = pendingPick
        pendingPick = nil
        dismiss(animated: true)
        if let pick { cancel(pick) }
    }
}
/// A pick the page asked for: where to upload it, and the id its `upload` events carry.
private struct PendingPick {
    let host: String
    let id: String
}

enum NativeEvent {
    case input(tab: TabKey, events: [InputEvent])
    case viewport(Viewport)
    case lifecycle(Lifecycle)
    case hosts([PlatformHost])
    case upload(id: String, progress: Double, path: String?, error: String?, cancelled: Bool)
}

@MainActor
private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var target: WebShellController?

    init(target: WebShellController) { self.target = target }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let target else {
            replyHandler(nil, "native bridge is unavailable")
            return
        }
        target.userContentController(userContentController, didReceive: message, replyHandler: replyHandler)
    }
}
