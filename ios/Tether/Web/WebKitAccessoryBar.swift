import ObjectiveC.runtime
import UIKit
import WebKit

/// Takes the form accessory bar and the predictive text strip off the keyboard for web fields.
///
/// Both belong to the web view's content view, and UIKit has no public switch for either. If
/// WebKit changes its internal view, the system's own chrome stays: nothing here is load-bearing
/// for input, so a missing class only leaves the bar and the predictions visible.
enum WebKitAccessoryBar {
    private static let prefix = "Tether_NoFormChrome_"

    @discardableResult
    static func hide(in webView: WKWebView) -> Bool {
        guard let contentView = webView.scrollView.subviews.first(where: {
            NSStringFromClass(type(of: $0)).contains("WKContentView")
        }), let contentClass = object_getClass(contentView) else { return false }

        let original = NSStringFromClass(contentClass)
        if original.hasPrefix(prefix) { return true }

        let className = "\(prefix)\(original.replacingOccurrences(of: ".", with: "_"))"
        if let existing = NSClassFromString(className) {
            object_setClass(contentView, existing)
            return true
        }

        guard let subclass = objc_allocateClassPair(contentClass, className, 0) else { return false }
        let noAccessory: @convention(block) (AnyObject) -> UIView? = { _ in nil }
        // The dock's line field is a real `<input>`, and a line is a command or a prompt, not
        // prose: `autocorrect="off"` and `spellcheck="false"` say so, and WebKit still asks this
        // view for the traits the keyboard strip reads. Answer as `TerminalInputView` does.
        let noAutocorrection: @convention(block) (AnyObject) -> Int = { _ in UITextAutocorrectionType.no.rawValue }
        let noSpellChecking: @convention(block) (AnyObject) -> Int = { _ in UITextSpellCheckingType.no.rawValue }
        let added = [
            (#selector(getter: UIResponder.inputAccessoryView), imp_implementationWithBlock(noAccessory), "@@:"),
            (NSSelectorFromString("autocorrectionType"), imp_implementationWithBlock(noAutocorrection), "q@:"),
            (NSSelectorFromString("spellCheckingType"), imp_implementationWithBlock(noSpellChecking), "q@:"),
        ].allSatisfy { class_addMethod(subclass, $0.0, $0.1, $0.2) }
        guard added else {
            objc_disposeClassPair(subclass)
            return false
        }
        objc_registerClassPair(subclass)
        object_setClass(contentView, subclass)
        return true
    }
}
