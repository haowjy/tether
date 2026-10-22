import UIKit

/// The only code that changes first responder (ios-shell.md "Focus: one
/// controller, native"), cut down to the states the spike exercises.
@MainActor
final class FocusController {
    enum Mode: String {
        case terminal, hidden, compose, webText, nativeModal
    }

    /// The wanted state; `restore` re-applies it after an interruption.
    private(set) var mode: Mode = .hidden
    /// The guard: while on, the terminal input refuses to resign unless this
    /// controller is moving focus. The spike's ⚙ menu toggles it.
    var guardOn = true
    /// Set from keyboard notifications by the view controller.
    var keyboardVisible = false
    /// The last focus change this controller made, to attribute keyboard
    /// notifications to it.
    private(set) var lastAction: (mode: Mode, at: Double)?
    var onChange: ((_ mode: Mode, _ reason: String) -> Void)?
    var onResignAsked: ((_ allowed: Bool, _ ours: Bool) -> Void)?

    private let input: TerminalInputView
    private let accessory: Accessory
    private var moving = 0
    private var modeBeforeModal: Mode = .terminal

    init(input: TerminalInputView, accessory: Accessory) {
        self.input = input
        self.accessory = accessory
        input.resignGate = { [unowned self] in self.allowsResign() }
        accessory.compose.focusHook = { [unowned self] begin in
            // A tap in the compose field is a request for `compose`.
            if begin {
                self.moving += 1
                if self.mode != .compose { self.enter(.compose, reason: "composeTap") }
            } else {
                self.moving -= 1
            }
        }
    }

    private func allowsResign() -> Bool {
        let ours = moving > 0
        let allowed = !guardOn || ours || mode == .webText || mode == .nativeModal
        onResignAsked?(allowed, ours)
        return allowed
    }

    func set(_ target: Mode, reason: String) {
        enter(target, reason: reason)
        switch target {
        case .terminal:
            showTerminalKeyboard(hidden: false)
        case .hidden:
            showTerminalKeyboard(hidden: true)
        case .compose:
            accessory.setComposeVisible(true)
            withMove { _ = accessory.compose.becomeFirstResponder() }
        case .webText:
            // Lower the guard and give up first responder; WebKit takes it when
            // the user taps the text area. The keyboard is down until then.
            withMove {
                if input.isFirstResponder { _ = input.resignFirstResponder() }
                if accessory.compose.isFirstResponder { _ = accessory.compose.resignFirstResponder() }
            }
        case .nativeModal:
            break
        }
    }

    /// Re-applies the wanted state: on foreground, after a native sheet, after
    /// a web content process restart.
    func restore(reason: String) {
        switch mode {
        case .terminal, .hidden, .compose: set(mode, reason: "restore:" + reason)
        case .webText, .nativeModal: break
        }
    }

    /// A native alert or sheet with a text field: the guard drops so its field
    /// can take the keyboard. `endModal` returns to the previous state.
    func beginModal() {
        if mode != .nativeModal { modeBeforeModal = mode }
        enter(.nativeModal, reason: "modal")
    }

    func endModal() {
        guard mode == .nativeModal else { return }
        set(modeBeforeModal, reason: "modalEnded")
    }

    func toggleCompose() {
        set(mode == .compose ? .terminal : .compose, reason: "cmpKey")
    }

    private func enter(_ target: Mode, reason: String) {
        mode = target
        lastAction = (target, ProcessInfo.processInfo.systemUptime)
        onChange?(target, reason)
    }

    private func showTerminalKeyboard(hidden: Bool) {
        let changed = input.keyboardHidden != hidden
        input.keyboardHidden = hidden
        withMove {
            if input.isFirstResponder {
                // Showing again after a system dismissal also needs the reload.
                if changed || (!hidden && !keyboardVisible) { input.reloadInputViews() }
            } else {
                _ = input.becomeFirstResponder()
            }
        }
        // Hide compose only once the terminal input holds first responder, so
        // the compose field never leaves the window while it is first responder.
        accessory.setComposeVisible(false)
    }

    private func withMove(_ body: () -> Void) {
        moving += 1
        body()
        moving -= 1
    }
}
