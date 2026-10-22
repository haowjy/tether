import Foundation
import WebKit

/// One input event, as ios-shell.md defines `InputEvent`.
enum InputEvent {
    case text(String)
    case key(String)
    case bytes(Data)
    case paste(String)

    var json: [String: Any] {
        switch self {
        case .text(let s): return ["text": s]
        case .key(let k): return ["key": k]
        case .bytes(let d): return ["bytes": d.base64EncodedString()]
        case .paste(let s): return ["paste": s]
        }
    }
}

/// The `tether` message handler (web → native, with reply) and the sender
/// (native → web through `window.__tether.receive`).
///
/// Messages sent in one run-loop turn go to the page in one
/// `callAsyncJavaScript` call, in order; consecutive input events merge into one
/// `input` message.
@MainActor
final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    static let name = "tether"

    weak var webView: WKWebView?
    /// Handles a web → native message and returns the reply (nil for none).
    var onMessage: ((_ type: String, _ body: [String: Any]) -> Any?)?
    var onLog: ((_ kind: String, _ detail: [String: String]) -> Void)?

    /// False until the page sends `ready`; messages sent before then are dropped,
    /// because `window.__tether` doesn't exist yet. `boot` carries fresh state.
    var pageReady = false

    private var queue: [[String: Any]] = []
    private var flushScheduled = false
    private var callErrors = 0
    private var originLogged = false

    func send(_ message: [String: Any]) {
        guard pageReady else { return }
        queue.append(message)
        scheduleFlush()
    }

    func send(_ event: InputEvent) {
        guard pageReady else { return }
        if var last = queue.last, last["type"] as? String == "input",
           var events = last["events"] as? [[String: Any]] {
            events.append(event.json)
            last["events"] = events
            queue[queue.count - 1] = last
        } else {
            queue.append(["type": "input", "events": [event.json]])
        }
        scheduleFlush()
    }

    private func scheduleFlush() {
        guard !flushScheduled else { return }
        flushScheduled = true
        Task { @MainActor in self.flush() }
    }

    private func flush() {
        flushScheduled = false
        guard let webView, pageReady, !queue.isEmpty else { queue.removeAll(); return }
        let batch = queue
        queue.removeAll()
        webView.callAsyncJavaScript(
            "window.__tether.receive(messages)",
            arguments: ["messages": batch],
            in: nil,
            in: .page
        ) { [weak self] result in
            guard let self, case .failure(let error) = result else { return }
            self.callErrors += 1
            // Log the first few only: a broken page would otherwise log every key.
            if self.callErrors <= 5 {
                self.onLog?("bridgeSendError", ["error": "\(error)", "count": "\(self.callErrors)"])
            }
        }
    }

    // MARK: WKScriptMessageHandlerWithReply

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        // ios-shell.md rejects messages from any other frame or origin. The
        // spike records what WebKit reports for the custom scheme instead of
        // enforcing it, so a surprise there can't stop the rest of the run.
        let origin = message.frameInfo.securityOrigin
        let expected = message.frameInfo.isMainFrame && origin.protocol == SchemeHandler.scheme
            && origin.host == SchemeHandler.host
        if !originLogged {
            originLogged = true
            onLog?(expected ? "bridgeOrigin" : "bridgeOriginUnexpected", [
                "protocol": origin.protocol, "host": origin.host, "port": "\(origin.port)",
                "mainFrame": "\(message.frameInfo.isMainFrame)",
            ])
        }
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else {
            replyHandler(nil, "message needs a type")
            return
        }
        replyHandler(onMessage?(type, body), nil)
    }
}
