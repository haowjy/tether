import GameController
import UIKit
import WebKit

/// How the web view follows the keyboard (spike-1-keyboard.md, ⚙ menu).
enum Geometry: String {
    /// Resize the web view's frame to end at the keyboard's top, animated.
    case A
    /// Keep the frame full size; send the keyboard height and let the page pad.
    case B
}

/// The spike's one screen: control strip, WKWebView, and the native input.
final class SpikeViewController: UIViewController, WKNavigationDelegate {
    private let recorder: Recorder
    private let bridge: Bridge
    private let scheme = SchemeHandler()
    private let input: TerminalInputView
    private let accessory: Accessory
    private let focus: FocusController
    private let bench: Bench

    private var webView: WKWebView!
    private var webBottom: NSLayoutConstraint!
    private lazy var webHaptic = UISelectionFeedbackGenerator(view: webView)

    private let strip = UIView()
    private let stepLabel = UILabel()
    private let passLabel = UILabel()
    private let statusLabel = UILabel()
    private let gearButton = UIButton(type: .system)

    private var geometry: Geometry = .A
    private var stepIndex = 0
    private var keyboardOverlap: CGFloat = 0
    private var termSize = "–"
    private var floodLabel = "0"
    private var unrequestedHides = 0
    private var viewportSeq = 0
    private var lastWidth: CGFloat = 0
    private var lastFirstResponder = ""
    private var lastHideAction: (name: String, at: Double)?
    private var lastResignAsk: (allowed: Bool, at: Double, repeats: Int)?
    private var lastLifecycleAt: Double = 0
    private var benchStatus: String?
    private var keychainStatus: String?
    private var appeared = false
    private var statusTask: Task<Void, Never>?
    private var observers: [any NSObjectProtocol] = []

    init() {
        let input = TerminalInputView(frame: .zero)
        let accessory = Accessory(pasteTarget: input)
        let recorder = Recorder(system: "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)")
        let focus = FocusController(input: input, accessory: accessory)
        let bridge = Bridge()
        self.bridge = bridge
        self.input = input
        self.accessory = accessory
        self.recorder = recorder
        self.focus = focus
        self.bench = Bench(bridge: bridge, recorder: recorder, focus: focus)
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    private var currentStep: Step { Checklist.steps[stepIndex] }

    // MARK: Setup

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        buildStrip()
        buildWebView()
        input.accessory = accessory
        view.addSubview(input)
        wire()
        observe()
        hardwareKeyboardChanged()
        refreshStep()
        webView.load(URLRequest(url: SchemeHandler.startURL))
        statusTask = Task { [weak self] in
            while !Task.isCancelled {
                self?.tick()
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !appeared {
            appeared = true
            // Start hidden: the terminal input holds first responder with no keyboard.
            focus.set(.hidden, reason: "launch")
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let width = view.bounds.width
        guard width != lastWidth else { return }
        let first = lastWidth == 0
        lastWidth = width
        if !first {
            recorder.log("rotation", ["width": "\(width)", "height": "\(view.bounds.height)"])
            sendViewport(reason: "rotation")
        }
    }

    private func buildStrip() {
        strip.backgroundColor = .secondarySystemBackground
        strip.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(strip)

        stepLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        stepLabel.numberOfLines = 2
        stepLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)
        stepLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        passLabel.font = .systemFont(ofSize: 12)
        passLabel.textColor = .secondaryLabel
        passLabel.numberOfLines = 2
        statusLabel.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        statusLabel.textColor = .systemGreen
        statusLabel.numberOfLines = 2

        gearButton.setTitle("⚙", for: .normal)
        gearButton.titleLabel?.font = .systemFont(ofSize: 24)
        gearButton.showsMenuAsPrimaryAction = true
        gearButton.setContentHuggingPriority(.required, for: .horizontal)

        let row = UIStackView(arrangedSubviews: [
            stripButton("◀", UIAction { [unowned self] _ in self.moveStep(-1) }),
            stepLabel,
            stripButton("▶", UIAction { [unowned self] _ in self.moveStep(1) }),
            stripButton("Pass", UIAction { [unowned self] _ in self.recordStep(pass: true) }),
            stripButton("Fail", UIAction { [unowned self] _ in self.recordStep(pass: false) }),
            gearButton,
        ])
        row.spacing = 8
        row.alignment = .center
        let column = UIStackView(arrangedSubviews: [row, passLabel, statusLabel])
        column.axis = .vertical
        column.spacing = 2
        column.translatesAutoresizingMaskIntoConstraints = false
        strip.addSubview(column)

        NSLayoutConstraint.activate([
            strip.topAnchor.constraint(equalTo: view.topAnchor),
            strip.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            strip.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            column.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 2),
            column.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 8),
            column.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -8),
            column.bottomAnchor.constraint(equalTo: strip.bottomAnchor, constant: -4),
        ])
    }

    private func stripButton(_ title: String, _ action: UIAction) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        button.addAction(action, for: .touchUpInside)
        button.setContentHuggingPriority(.required, for: .horizontal)
        button.setContentCompressionResistancePriority(.required, for: .horizontal)
        return button
    }

    private func buildWebView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(scheme, forURLScheme: SchemeHandler.scheme)
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: Bridge.name)
        webView = WKWebView(frame: .zero, configuration: config)
        webView.isInspectable = true
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.scrollView.keyboardDismissMode = .none
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        webBottom = webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: strip.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            webBottom,
        ])
        bridge.webView = webView
    }

    private func wire() {
        input.onInput = { [unowned self] event in self.bridge.send(event) }
        input.onLog = { [unowned self] kind, detail in self.recorder.log(kind, detail) }
        input.onCtrlChange = { [unowned self] armed in self.accessory.setCtrlArmed(armed) }
        accessory.onAction = { [unowned self] action in self.accessoryAction(action) }
        focus.onChange = { [unowned self] mode, reason in
            if mode == .hidden || mode == .webText || mode == .nativeModal { self.markHideAction(mode.rawValue) }
            self.recorder.log("focus", ["mode": mode.rawValue, "reason": reason])
            self.refreshStatus()
        }
        focus.onResignAsked = { [unowned self] allowed, ours in
            guard !ours else { return }
            // UIKit may ask several times per touch: log the first ask of a burst
            // and how many identical asks the previous burst had.
            let now = ProcessInfo.processInfo.systemUptime
            if let last = self.lastResignAsk, last.allowed == allowed, now - last.at < 0.25 {
                self.lastResignAsk = (allowed, now, last.repeats + 1)
                return
            }
            self.recorder.log("resignAsked", ["allowed": "\(allowed)", "guard": "\(self.focus.guardOn)",
                                              "mode": self.focus.mode.rawValue,
                                              "previousBurstRepeats": "\(self.lastResignAsk?.repeats ?? 0)"])
            self.lastResignAsk = (allowed, now, 0)
        }
        bridge.onMessage = { [unowned self] type, body in self.handle(type, body) }
        bridge.onLog = { [unowned self] kind, detail in self.recorder.log(kind, detail) }
        scheme.onLog = { [unowned self] kind, detail in self.recorder.log(kind, detail) }
        bench.onProgress = { [unowned self] text in
            self.benchStatus = text
            self.refreshStatus()
        }
        bench.getGeometry = { [unowned self] in self.geometry }
        bench.setGeometry = { [unowned self] mode in self.setGeometry(mode) }
        recorder.context = { [unowned self] in
            Context(step: self.currentStep.id, firstResponder: self.firstResponderName(),
                    guardOn: self.focus.guardOn, geometry: self.geometry.rawValue)
        }
    }

    private func observe() {
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(keyboardWillShow(_:)), name: UIResponder.keyboardWillShowNotification, object: nil)
        center.addObserver(self, selector: #selector(keyboardDidShow(_:)), name: UIResponder.keyboardDidShowNotification, object: nil)
        center.addObserver(self, selector: #selector(keyboardWillHide(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
        center.addObserver(self, selector: #selector(keyboardDidHide(_:)), name: UIResponder.keyboardDidHideNotification, object: nil)
        center.addObserver(self, selector: #selector(keyboardWillChangeFrame(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        center.addObserver(self, selector: #selector(keyboardDidChangeFrame(_:)), name: UIResponder.keyboardDidChangeFrameNotification, object: nil)
        // GameController doesn't document its posting thread; hop to main explicitly.
        for name in [NSNotification.Name.GCKeyboardDidConnect, .GCKeyboardDidDisconnect] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    self.hardwareKeyboardChanged()
                }
            })
        }
    }

    // MARK: Messages from the page

    private func handle(_ type: String, _ body: [String: Any]) -> Any? {
        switch type {
        case "ready":
            bridge.pageReady = true
            floodLabel = "0"
            recorder.log("pageReady", strings(body))
            let reply: [String: Any] = ["bridgeVersion": 1, "viewport": viewport(reason: "initial")]
            focus.restore(reason: "pageReady")
            return reply
        case "focus":
            let requested = body["mode"] as? String ?? ""
            if let mode = FocusController.Mode(rawValue: requested), [.terminal, .hidden, .webText].contains(mode) {
                focus.set(mode, reason: "web")
            } else {
                recorder.log("focusRejected", ["mode": requested])
            }
        case "haptic":
            if body["bench"] as? Bool == true {
                bench.hapticRequestArrived()
            } else {
                webHaptic.selectionChanged()
            }
        case "ack":
            if let id = body["id"] as? Int { bench.ack(id) }
        case "benchResult":
            if let name = body["name"] as? String, let samples = body["samples"] as? [Double] {
                bench.pageResult(name, samples: samples)
            }
        case "layout":
            if let seq = body["seq"] as? Int { bench.layoutSettled(seq: seq) }
            recorder.log("pageLayout", strings(body))
        case "term":
            if let cols = body["cols"] as? Int, let rows = body["rows"] as? Int { termSize = "\(cols)×\(rows)" }
            recorder.log("termSize", strings(body))
            refreshStatus()
        case "flood":
            floodLabel = body["label"] as? String ?? "?"
            recorder.log("flood", strings(body))
            refreshStatus()
        case "log":
            let kind = body["kind"] as? String ?? "?"
            recorder.log("web." + kind, strings(body["detail"] as? [String: Any] ?? [:]))
        default:
            recorder.log("unknownMessage", ["type": type])
        }
        return nil
    }

    private func strings(_ body: [String: Any]) -> [String: String] {
        body.filter { $0.key != "type" }.mapValues { "\($0)" }
    }

    // MARK: Viewport and geometry

    private func viewport(reason: String) -> [String: Any] {
        viewportSeq += 1
        let collapsed = view.bounds.height - strip.frame.maxY
        return [
            "type": "viewport",
            "seq": viewportSeq,
            "reason": reason,
            "mode": geometry.rawValue,
            "width": Double(view.safeAreaLayoutGuide.layoutFrame.width),
            "height": Double(geometry == .A ? collapsed - keyboardOverlap : collapsed),
            "collapsedHeight": Double(collapsed),
            "keyboard": keyboardOverlap > 0,
            "keyboardHeight": Double(keyboardOverlap),
            "safeBottom": Double(view.safeAreaInsets.bottom),
        ]
    }

    private func sendViewport(reason: String) {
        let message = viewport(reason: reason)
        if reason == "keyboard", let seq = message["seq"] as? Int { bench.viewportSent(seq: seq) }
        bridge.send(message)
    }

    private func setGeometry(_ mode: Geometry) {
        guard mode != geometry else { return }
        geometry = mode
        recorder.log("geometry", ["mode": mode.rawValue])
        applyGeometry(duration: 0.25, curve: 7)
        sendViewport(reason: "keyboard")
        refreshMenu()
        refreshStatus()
    }

    private func applyGeometry(duration: Double, curve: UInt) {
        let constant = geometry == .A ? -keyboardOverlap : 0
        guard webBottom.constant != constant else { return }
        webBottom.constant = constant
        UIView.animate(withDuration: duration, delay: 0,
                       options: [UIView.AnimationOptions(rawValue: curve << 16), .beginFromCurrentState],
                       animations: { self.view.layoutIfNeeded() })
    }

    // MARK: Keyboard notifications

    @objc private func keyboardWillChangeFrame(_ note: Notification) {
        guard let info = note.userInfo,
              let end = (info[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else { return }
        let duration = (info[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?.doubleValue ?? 0.25
        let curve = (info[UIResponder.keyboardAnimationCurveUserInfoKey] as? NSNumber)?.uintValue ?? 7
        let frame = view.convert(end, from: nil)
        keyboardOverlap = max(0, view.bounds.maxY - frame.minY)
        applyGeometry(duration: duration, curve: curve)
        sendViewport(reason: "keyboard")
        recorder.log("keyboardWillChangeFrame", keyboardDetail(note))
        refreshStatus()
    }

    @objc private func keyboardWillShow(_ note: Notification) {
        focus.keyboardVisible = true
        recorder.log("keyboardWillShow", keyboardDetail(note))
    }

    @objc private func keyboardDidShow(_ note: Notification) {
        bench.keyboardDidShow()
        recorder.log("keyboardDidShow", keyboardDetail(note))
    }

    @objc private func keyboardWillHide(_ note: Notification) {
        focus.keyboardVisible = false
        let cause = hideCause()
        if cause == "unrequested" { unrequestedHides += 1 }
        var detail = keyboardDetail(note)
        detail["cause"] = cause
        recorder.log("keyboardWillHide", detail)
        refreshStatus()
    }

    @objc private func keyboardDidHide(_ note: Notification) {
        bench.keyboardDidHide()
        recorder.log("keyboardDidHide", keyboardDetail(note))
    }

    @objc private func keyboardDidChangeFrame(_ note: Notification) {
        recorder.log("keyboardDidChangeFrame", keyboardDetail(note))
    }

    private func keyboardDetail(_ note: Notification) -> [String: String] {
        let end = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue ?? .zero
        let local = note.userInfo?[UIResponder.keyboardIsLocalUserInfoKey] as? Bool
        return [
            "endY": "\(Int(end.minY))",
            "endHeight": "\(Int(end.height))",
            "overlap": "\(Int(keyboardOverlap))",
            "local": local.map { "\($0)" } ?? "?",
            "mode": focus.mode.rawValue,
        ]
    }

    /// Why the keyboard is hiding: one of the spike's own actions in the last
    /// 1.5 s, an app lifecycle change, or nothing the spike asked for.
    private func hideCause() -> String {
        let now = ProcessInfo.processInfo.systemUptime
        if UIApplication.shared.applicationState != .active || now - lastLifecycleAt < 1.5 { return "lifecycle" }
        if let action = lastHideAction, now - action.at < 1.5 { return "spike:" + action.name }
        return "unrequested"
    }

    private func markHideAction(_ name: String) {
        lastHideAction = (name, ProcessInfo.processInfo.systemUptime)
    }

    private func hardwareKeyboardChanged() {
        let connected = GCKeyboard.coalesced != nil
        accessory.setHardwareKeyboard(connected)
        recorder.log("hardwareKeyboard", ["connected": "\(connected)"])
        if input.isFirstResponder && !input.keyboardHidden { input.reloadInputViews() }
        refreshStatus()
    }

    // MARK: Accessory

    private func accessoryAction(_ action: Accessory.Action) {
        switch action {
        case .key(let name): input.sendKey(name)
        case .ctrl: input.ctrlArmed.toggle()
        case .compose: focus.toggleCompose()
        case .hide: focus.set(.hidden, reason: "hideKey")
        case .send(let text):
            guard !text.isEmpty else { return }
            bridge.send(InputEvent.paste(text))
            bridge.send(InputEvent.key("Enter"))
        }
    }

    // MARK: Lifecycle (from SceneDelegate)

    func lifecycle(_ phase: String) {
        lastLifecycleAt = ProcessInfo.processInfo.systemUptime
        recorder.log("lifecycle", ["phase": phase])
        switch phase {
        case "active": focus.restore(reason: "active")
        case "background": recorder.save()
        default: break
        }
    }

    // MARK: Web content process

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        recorder.log("webProcessTerminated")
        bridge.pageReady = false
        webView.load(URLRequest(url: SchemeHandler.startURL))
    }

    private func killWebProcess() {
        // Private WebKit API, only in this throwaway spike: rehearses a jetsam kill.
        let selector = NSSelectorFromString("_killWebContentProcess")
        guard webView.responds(to: selector) else {
            recorder.log("killUnavailable")
            return
        }
        markHideAction("kill")
        recorder.log("killWebProcess")
        _ = webView.perform(selector)
    }

    // MARK: Checklist

    private func moveStep(_ delta: Int) {
        let count = Checklist.steps.count
        stepIndex = (stepIndex + delta + count) % count
        recorder.log("step", ["id": currentStep.id])
        refreshStep()
    }

    private func refreshStep() {
        let step = currentStep
        stepLabel.text = "\(step.id) · \(step.todo)"
        let done = recorder.answers(for: step.id).map { "\($0.geometry)/\($0.guardOn ? "on" : "off") \($0.result)" }
        passLabel.text = "✓ \(step.pass)" + (done.isEmpty ? "" : "  [\(done.joined(separator: ", "))]")
        refreshMenu()
    }

    private func recordStep(pass: Bool) {
        let step = currentStep
        if pass, step.record == nil {
            recorder.answer(step.id, result: "pass", note: nil)
            refreshStep()
            return
        }
        let question = pass ? (step.record ?? "") : "What surprised you?"
        prompt(title: "\(step.id): \(question)", message: step.pass) { [unowned self] text in
            guard let text else { return }
            self.recorder.answer(step.id, result: pass ? "pass" : "fail", note: text)
            self.refreshStep()
        }
    }

    // MARK: Native surfaces

    /// A native alert with a text field (the bridge's `prompt` path). The guard
    /// drops while it shows, so its field can take the keyboard.
    private func prompt(title: String, message: String?, completion: @escaping @MainActor (String?) -> Void) {
        focus.beginModal()
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addTextField()
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [unowned self] _ in
            self.focus.endModal()
            completion(nil)
        })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [unowned self, weak alert] _ in
            let text = alert?.textFields?.first?.text ?? ""
            self.focus.endModal()
            completion(text)
        })
        present(alert, animated: true)
    }

    private func showNativeSheet() {
        markHideAction("sheet")
        recorder.log("sheetOpened")
        let sheet = NativeSheetViewController()
        sheet.onClose = { [unowned self] in
            self.recorder.log("sheetClosed")
            self.focus.restore(reason: "sheetClosed")
        }
        sheet.modalPresentationStyle = .pageSheet
        sheet.sheetPresentationController?.detents = [.medium()]
        present(sheet, animated: true)
    }

    private func export() {
        recorder.save()
        markHideAction("export")
        present(UIActivityViewController(activityItems: [recorder.fileURL], applicationActivities: nil), animated: true)
    }

    private func addNote() {
        let step = currentStep
        prompt(title: "Note for \(step.id)", message: nil) { [unowned self] text in
            guard let text, !text.isEmpty else { return }
            self.recorder.answer(step.id, result: "note", note: text)
            self.refreshStep()
        }
    }

    private func runKeychain(_ step: String) {
        keychainStatus = "kc \(step)…"
        markHideAction("keychain")
        refreshStatus()
        Task {
            let outcomes = await Task.detached {
                step == "B1" ? KeychainCheck.runAdd() : KeychainCheck.runReadDeleteAdd()
            }.value
            for outcome in outcomes {
                self.recorder.keychain(step, op: outcome.op, status: outcome.status, message: outcome.message,
                                       ms: outcome.ms, detail: outcome.detail)
            }
            self.keychainStatus = "kc \(step): " + outcomes.map { "\($0.op) \($0.status) \(Int($0.ms))ms" }
                .joined(separator: ", ")
            self.refreshStatus()
            self.focus.restore(reason: "keychain")
        }
    }

    private func refreshMenu() {
        let guardItem = UIAction(title: "Guard", state: focus.guardOn ? .on : .off) { [unowned self] _ in
            self.focus.guardOn.toggle()
            self.recorder.log("guard", ["on": "\(self.focus.guardOn)"])
            self.refreshMenu()
            self.refreshStatus()
        }
        let geometryA = UIAction(title: "Geometry A: resize the web view", state: geometry == .A ? .on : .off) {
            [unowned self] _ in self.setGeometry(.A)
        }
        let geometryB = UIAction(title: "Geometry B: the page pads", state: geometry == .B ? .on : .off) {
            [unowned self] _ in self.setGeometry(.B)
        }
        let surfaces: [UIMenuElement] = [
            UIAction(title: "Native sheet (S5)") { [unowned self] _ in self.showNativeSheet() },
            UIAction(title: "Native prompt (S10)") { [unowned self] _ in
                self.prompt(title: "Native prompt (S10)", message: "Type here, then OK") { text in
                    self.recorder.log("promptResult", ["text": text ?? "<cancelled>"])
                }
            },
            UIAction(title: "Kill web process (S14)", attributes: .destructive) { [unowned self] _ in
                self.killWebProcess()
            },
        ]
        let measure: [UIMenuElement] = [
            UIAction(title: "Bench (M1–M4)") { [unowned self] _ in
                Task { await self.bench.run() }
            },
            UIAction(title: "Keychain B1: add") { [unowned self] _ in self.runKeychain("B1") },
            UIAction(title: "Keychain B2/B3: read, delete, add") { [unowned self] _ in
                self.runKeychain(self.currentStep.id == "B3" ? "B3" : "B2")
            },
        ]
        let results: [UIMenuElement] = [
            UIAction(title: "Add note to \(currentStep.id)") { [unowned self] _ in self.addNote() },
            UIAction(title: "Export results.json") { [unowned self] _ in self.export() },
        ]
        gearButton.menu = UIMenu(title: "", children: [
            UIMenu(title: "", options: .displayInline, children: [guardItem, geometryA, geometryB]),
            UIMenu(title: "", options: .displayInline, children: surfaces),
            UIMenu(title: "", options: .displayInline, children: measure),
            UIMenu(title: "", options: .displayInline, children: results),
        ])
    }

    // MARK: Status line

    private func tick() {
        let fr = firstResponderName()
        if fr != lastFirstResponder {
            recorder.log("firstResponderChanged", ["from": lastFirstResponder, "to": fr])
            lastFirstResponder = fr
        }
        refreshStatus()
    }

    private func refreshStatus() {
        let kb = GCKeyboard.coalesced != nil ? "hw" : (keyboardOverlap > 0 ? "up" : "down")
        var parts = [
            termSize, "kb:\(kb)", "guard:\(focus.guardOn ? "on" : "off")", "geo:\(geometry.rawValue)",
            "fr:\(firstResponderName())", "mode:\(focus.mode.rawValue)", "flood:\(floodLabel)",
            "hides:\(unrequestedHides)",
        ]
        if let keychainStatus { parts.append(keychainStatus) }
        if let benchStatus { parts.insert(benchStatus, at: 0) }
        statusLabel.text = parts.joined(separator: " · ")
    }

    private func firstResponderName() -> String {
        guard let responder = UIResponder.spikeFirstResponder() else { return "none" }
        switch responder {
        case is TerminalInputView: return "term"
        case is ComposeTextView: return "compose"
        case is UITextField: return "alertField"
        // With no first responder, the action falls through to the window or app.
        case is UIWindow, is UIApplication, is UIApplicationDelegate: return "none"
        default:
            let name = String(describing: type(of: responder))
            return name.hasPrefix("WK") ? "web(\(name))" : name
        }
    }
}

/// The native sheet for S5: no text field.
private final class NativeSheetViewController: UIViewController {
    var onClose: (() -> Void)?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let label = UILabel()
        label.text = "Native sheet (S5). Swipe it down or tap Done."
        label.numberOfLines = 0
        let done = UIButton(type: .system)
        done.setTitle("Done", for: .normal)
        done.addAction(UIAction { [unowned self] _ in self.dismiss(animated: true) }, for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [label, done])
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
        ])
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        onClose?()
    }
}

extension UIResponder {
    @MainActor private static weak var spikeFound: UIResponder?

    /// The current first responder, wherever it is: an action sent to a nil
    /// target goes to it first.
    @MainActor static func spikeFirstResponder() -> UIResponder? {
        spikeFound = nil
        _ = UIApplication.shared.sendAction(#selector(spikeReportFirstResponder(_:)), to: nil, from: nil, for: nil)
        return spikeFound
    }

    @MainActor @objc private func spikeReportFirstResponder(_ sender: Any?) {
        UIResponder.spikeFound = self
    }
}
