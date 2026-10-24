import ObjectiveC.runtime
import UIKit
import WebKit

enum WebKitAccessoryBar {
    @discardableResult
    static func hide(in webView: WKWebView) -> Bool {
        // UIKit has no public switch for this bar. If WebKit changes its internal view,
        // leave the system bar visible.
        guard let contentView = webView.scrollView.subviews.first(where: {
            NSStringFromClass(type(of: $0)).contains("WKContentView")
        }), let contentClass = object_getClass(contentView) else { return false }

        if NSStringFromClass(contentClass).hasPrefix("Tether_NoFormAccessory_") { return true }

        let className = "Tether_NoFormAccessory_\(NSStringFromClass(contentClass).replacingOccurrences(of: ".", with: "_"))"
        let accessoryClass: AnyClass
        if let existing = NSClassFromString(className) {
            accessoryClass = existing
        } else {
            guard let subclass = objc_allocateClassPair(contentClass, className, 0) else { return false }
            let selector = #selector(getter: UIResponder.inputAccessoryView)
            let noAccessory: @convention(block) (AnyObject) -> UIView? = { _ in nil }
            guard class_addMethod(subclass, selector, imp_implementationWithBlock(noAccessory), "@@:") else {
                objc_disposeClassPair(subclass)
                return false
            }
            objc_registerClassPair(subclass)
            accessoryClass = subclass
        }

        object_setClass(contentView, accessoryClass)
        return true
    }
}
