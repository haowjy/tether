import UIKit
import TetherKit
import WebKit

@MainActor
final class LineFieldLender: NSObject, UIGestureRecognizerDelegate {
    private weak var webView: WKWebView?
    private weak var focus: FocusController?
    private var rect: CGRect?
    private var generation = 0

    init(webView: WKWebView, focus: FocusController) {
        self.webView = webView
        self.focus = focus
        super.init()
        let recognizer = PassiveTouchRecognizer(target: self, action: nil)
        recognizer.delegate = self
        recognizer.cancelsTouchesInView = false
        recognizer.delaysTouchesBegan = false
        recognizer.delaysTouchesEnded = false
        recognizer.onBegin = { [weak self] point in self?.touchBegan(at: point) }
        recognizer.onEnd = { [weak self] in self?.touchEnded() }
        recognizer.onCancel = { [weak self] in self?.cancelTouch() }
        webView.addGestureRecognizer(recognizer)
    }

    func setRect(_ rect: Rect?) {
        guard let rect, let webView,
              [rect.x, rect.y, rect.width, rect.height].allSatisfy(\.isFinite),
              rect.x >= 0, rect.y >= 0, rect.width > 0, rect.height > 0,
              rect.x + rect.width <= webView.bounds.width,
              rect.y + rect.height <= webView.bounds.height else {
            self.rect = nil
            return
        }
        self.rect = CGRect(x: rect.x, y: rect.y, width: rect.width, height: rect.height)
    }

    func confirmed() -> Bool {
        guard focus?.hasPendingLineFieldTouch == true else { return false }
        generation += 1
        focus?.lineFieldConfirmed()
        return true
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }

    private func touchBegan(at point: CGPoint) {
        guard let rect, rect.contains(point), focus?.mode == .terminal || focus?.mode == .hidden else { return }
        generation += 1
        focus?.allowLineFieldTouch()
    }

    private func touchEnded() {
        generation += 1
        let expected = generation
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self, self.generation == expected else { return }
            self.focus?.lineFieldCancelled()
        }
    }

    private func cancelTouch() {
        generation += 1
        focus?.lineFieldCancelled()
    }
}

private final class PassiveTouchRecognizer: UIGestureRecognizer {
    var onBegin: ((CGPoint) -> Void)?
    var onEnd: (() -> Void)?
    var onCancel: (() -> Void)?
    private var began = false

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let touch = touches.first, let view else { return }
        began = true
        onBegin?(touch.location(in: view))
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        if began { onEnd?() }
        began = false
        state = .failed
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        if began { onCancel?() }
        began = false
        state = .failed
    }

    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }
}
