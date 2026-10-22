import UIKit

/// The terminal's first responder (ios-shell.md "The input responder"): an
/// invisible `UIKeyInput` whose events go to the page.
final class TerminalInputView: UIView, UIKeyInput {
    /// Receives every input event, from the software keyboard, hardware keys and paste.
    var onInput: ((InputEvent) -> Void)?
    /// Asked by `canResignFirstResponder`; false keeps first responder (the guard).
    var resignGate: (() -> Bool)?
    var onLog: ((_ kind: String, _ detail: [String: String]) -> Void)?

    /// While true, an empty input view and no accessory: the keyboard is down but
    /// this view stays first responder. Call `reloadInputViews()` after changing it.
    var keyboardHidden = false
    var accessory: UIView?
    /// Ctrl from the key row: applies to the next key, then clears.
    var ctrlArmed = false {
        didSet { onCtrlChange?(ctrlArmed) }
    }
    var onCtrlChange: ((Bool) -> Void)?

    private let emptyInputView = UIView(frame: .zero)

    // MARK: Traits (ios-shell.md)

    var autocorrectionType: UITextAutocorrectionType = .no
    var autocapitalizationType: UITextAutocapitalizationType = .none
    var spellCheckingType: UITextSpellCheckingType = .no
    var smartQuotesType: UITextSmartQuotesType = .no
    var smartDashesType: UITextSmartDashesType = .no
    var smartInsertDeleteType: UITextSmartInsertDeleteType = .no
    var inlinePredictionType: UITextInlinePredictionType = .no
    var keyboardType: UIKeyboardType = .asciiCapable
    var returnKeyType: UIReturnKeyType = .default

    override init(frame: CGRect) {
        super.init(frame: frame)
        pasteConfiguration = UIPasteConfiguration(forAccepting: NSString.self)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    // MARK: Responder

    override var canBecomeFirstResponder: Bool { true }
    override var canResignFirstResponder: Bool { resignGate?() ?? true }
    override var inputView: UIView? { keyboardHidden ? emptyInputView : nil }
    override var inputAccessoryView: UIView? { keyboardHidden ? nil : accessory }

    // MARK: UIKeyInput

    var hasText: Bool { true }

    func insertText(_ text: String) {
        if ctrlArmed, text.count == 1 {
            ctrlArmed = false
            emit(.key(text == " " ? "C-Space" : "C-" + text.lowercased()))
            return
        }
        var chunk = ""
        for ch in text {
            if ch.isNewline {
                if !chunk.isEmpty { emit(.text(chunk)); chunk = "" }
                emit(.key("Enter"))
            } else {
                chunk.append(ch)
            }
        }
        if !chunk.isEmpty { emit(.text(chunk)) }
    }

    func deleteBackward() {
        emit(.key("BSpace"))
    }

    /// Key-row keys come through here so a pending Ctrl applies to them too.
    func sendKey(_ name: String) {
        if ctrlArmed {
            ctrlArmed = false
            emit(.key("C-" + name))
        } else {
            emit(.key(name))
        }
    }

    private func emit(_ event: InputEvent) {
        onInput?(event)
    }

    // MARK: Hardware keyboard

    /// Raw key codes this view consumed in `pressesBegan`, until their `pressesEnded`.
    private var held: Set<Int> = []
    private var repeatTask: Task<Void, Never>?
    private var repeatKeyCode: Int?

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var unhandled = Set<UIPress>()
        for press in presses {
            guard let key = press.key, let mapped = KeyMap.event(for: key) else {
                unhandled.insert(press)
                continue
            }
            let code = key.keyCode.rawValue
            if held.contains(code) {
                // iOS repeated pressesBegan itself: let it drive repeat, not the timer.
                onLog?("osKeyRepeat", ["key": "\(mapped.json)"])
                stopRepeat()
                emit(mapped)
                continue
            }
            held.insert(code)
            emit(mapped)
            startRepeat(mapped, code: code)
        }
        if !unhandled.isEmpty { super.pressesBegan(unhandled, with: event) }
    }

    override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        let rest = releaseHeld(presses)
        if !rest.isEmpty { super.pressesEnded(rest, with: event) }
    }

    override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        let rest = releaseHeld(presses)
        if !rest.isEmpty { super.pressesCancelled(rest, with: event) }
    }

    /// Forgets consumed presses and returns the others, which belong to `super`.
    private func releaseHeld(_ presses: Set<UIPress>) -> Set<UIPress> {
        var rest = Set<UIPress>()
        for press in presses {
            guard let code = press.key?.keyCode.rawValue, held.remove(code) != nil else {
                rest.insert(press)
                continue
            }
            if code == repeatKeyCode { stopRepeat() }
        }
        return rest
    }

    /// ios-shell.md: 400 ms delay, then every 33 ms, until the key is released.
    private func startRepeat(_ event: InputEvent, code: Int) {
        stopRepeat()
        repeatKeyCode = code
        repeatTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            while !Task.isCancelled {
                self?.emit(event)
                try? await Task.sleep(for: .milliseconds(33))
            }
        }
    }

    private func stopRepeat() {
        repeatTask?.cancel()
        repeatTask = nil
        repeatKeyCode = nil
    }

    // MARK: Paste (UIPasteControl and Cmd+V, without the "Allow Paste" prompt)

    func paste(itemProviders: [NSItemProvider]) {
        guard let provider = itemProviders.first(where: { $0.canLoadObject(ofClass: NSString.self) }) else {
            onLog?("pasteNoText", ["providers": "\(itemProviders.count)"])
            return
        }
        _ = provider.loadObject(ofClass: NSString.self) { object, error in
            let text = (object as? NSString).map { String($0) }
            let failure = error.map { "\($0)" }
            Task { @MainActor in
                if let text {
                    self.emit(.paste(text))
                } else {
                    self.onLog?("pasteFailed", ["error": failure ?? "no text"])
                }
            }
        }
    }
}

/// Hardware keys this view consumes: everything that isn't plain text.
/// Plain printing keys, Return, Backspace and Cmd shortcuts return nil and go
/// to `super`, so they arrive through `insertText`, `deleteBackward` or the
/// responder chain.
enum KeyMap {
    @MainActor
    static func event(for key: UIKey) -> InputEvent? {
        let mods = key.modifierFlags
        if mods.contains(.command) { return nil }
        let ctrl = mods.contains(.control)
        let alt = mods.contains(.alternate)
        let shift = mods.contains(.shift)

        func named(_ base: String) -> InputEvent {
            var name = base
            if alt { name = "M-" + name }
            if ctrl { name = "C-" + name }
            return .key(name)
        }

        switch key.keyCode {
        case .keyboardEscape: return .key("Escape")
        case .keyboardTab: return shift ? .key("BTab") : named("Tab")
        case .keyboardUpArrow: return named("Up")
        case .keyboardDownArrow: return named("Down")
        case .keyboardLeftArrow: return named("Left")
        case .keyboardRightArrow: return named("Right")
        case .keyboardHome: return named("Home")
        case .keyboardEnd: return named("End")
        case .keyboardPageUp: return named("PPage")
        case .keyboardPageDown: return named("NPage")
        case .keyboardDeleteForward: return named("DC")
        case .keyboardReturnOrEnter:
            // Shift+Enter is CSI-u `ESC [13;2u` as raw bytes (ios-shell.md).
            if shift && !ctrl && !alt { return .bytes(Data([0x1b, 0x5b, 0x31, 0x33, 0x3b, 0x32, 0x75])) }
            return ctrl || alt ? named("Enter") : nil
        case .keyboardDeleteOrBackspace:
            return ctrl || alt ? named("BSpace") : nil
        default:
            break
        }

        let code = key.keyCode.rawValue
        let f1 = UIKeyboardHIDUsage.keyboardF1.rawValue
        if code >= f1 && code <= UIKeyboardHIDUsage.keyboardF12.rawValue {
            return named("F\(code - f1 + 1)")
        }

        guard ctrl || alt else { return nil }
        let chars = key.charactersIgnoringModifiers
        guard chars.count == 1 else { return nil }
        if chars == " " { return named("Space") }
        return named(ctrl ? chars.lowercased() : chars)
    }
}
