import GameController
import TetherKit
import UIKit

@MainActor
protocol TerminalInputDelegate: AnyObject {
    func terminalInput(_ event: InputEvent)
    func terminalInputWarning()
}

@MainActor
final class TerminalInputView: UIView, UIKeyInput {
    weak var output: TerminalInputDelegate?
    weak var focusController: FocusController?
    var hidesSoftwareKeyboard = true {
        didSet { if oldValue != hidesSoftwareKeyboard { reloadInputViews() } }
    }
    private var repeatTimers: [Int: Timer] = [:]
    private var repeatingTimers: [Int: Timer] = [:]
    private var handledCodes = Set<Int>()

    var autocorrectionType: UITextAutocorrectionType = .no
    var autocapitalizationType: UITextAutocapitalizationType = .none
    var spellCheckingType: UITextSpellCheckingType = .no
    var smartQuotesType: UITextSmartQuotesType = .no
    var smartDashesType: UITextSmartDashesType = .no
    var smartInsertDeleteType: UITextSmartInsertDeleteType = .no
    var inlinePredictionType: UITextInlinePredictionType = .no
    var keyboardType: UIKeyboardType = .asciiCapable
    var returnKeyType: UIReturnKeyType = .default

    override var canBecomeFirstResponder: Bool { true }
    override var canResignFirstResponder: Bool { focusController?.canResignInput ?? true }
    override var inputView: UIView? { hidesSoftwareKeyboard ? UIView(frame: .zero) : nil }
    var hasText: Bool { true }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isAccessibilityElement = false
        alpha = 0.01
        isUserInteractionEnabled = false
        NotificationCenter.default.addObserver(self, selector: #selector(stopAllRepeats), name: UIApplication.willResignActiveNotification, object: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    deinit { NotificationCenter.default.removeObserver(self) }

    override func resignFirstResponder() -> Bool {
        stopAllRepeats()
        return super.resignFirstResponder()
    }

    func insertText(_ text: String) {
        if text == "\n" || text == "\r" { output?.terminalInput(.key("Enter")) }
        else if !text.isEmpty { output?.terminalInput(.text(text)) }
    }

    func deleteBackward() { output?.terminalInput(.key("BSpace")) }

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var unhandled = Set<UIPress>()
        for press in presses {
            guard let key = press.key,
                  let hardwareKey = Self.hardwareKey(key),
                  let mapped = KeyMapper.event(for: hardwareKey) else {
                unhandled.insert(press)
                continue
            }
            let code = key.keyCode.rawValue
            guard !handledCodes.contains(code) else { continue }
            handledCodes.insert(code)
            if case .key(let name) = mapped, name == "C-c" || name == "C-d" { output?.terminalInputWarning() }
            output?.terminalInput(mapped)
            startRepeat(mapped, code: code)
        }
        if !unhandled.isEmpty { super.pressesBegan(unhandled, with: event) }
    }

    override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var unhandled = Set<UIPress>()
        for press in presses {
            guard let key = press.key, handledCodes.contains(key.keyCode.rawValue) else {
                unhandled.insert(press)
                continue
            }
            stopRepeat(key.keyCode.rawValue)
        }
        if !unhandled.isEmpty { super.pressesEnded(unhandled, with: event) }
    }

    override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        for press in presses {
            if let key = press.key { stopRepeat(key.keyCode.rawValue) }
        }
        super.pressesCancelled(presses, with: event)
    }

    private func startRepeat(_ input: InputEvent, code: Int) {
        let initial = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.handledCodes.contains(code) else { return }
                self.output?.terminalInput(input)
                let repeating = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
                    MainActor.assumeIsolated {
                        guard let self, self.handledCodes.contains(code) else { return }
                        self.output?.terminalInput(input)
                    }
                }
                self.repeatingTimers[code] = repeating
            }
        }
        repeatTimers[code] = initial
    }

    private func stopRepeat(_ code: Int) {
        handledCodes.remove(code)
        repeatTimers.removeValue(forKey: code)?.invalidate()
        repeatingTimers.removeValue(forKey: code)?.invalidate()
    }

    @objc private func stopAllRepeats() {
        for timer in repeatTimers.values { timer.invalidate() }
        for timer in repeatingTimers.values { timer.invalidate() }
        repeatTimers.removeAll()
        repeatingTimers.removeAll()
        handledCodes.removeAll()
    }

    private static func hardwareKey(_ key: UIKey) -> HardwareKey? {
        let code: String
        switch key.keyCode {
        case .keyboardEscape: code = "escape"
        case .keyboardTab: code = "tab"
        case .keyboardReturnOrEnter: code = "return"
        case .keyboardDeleteOrBackspace: code = "delete"
        case .keyboardUpArrow: code = "up"
        case .keyboardDownArrow: code = "down"
        case .keyboardLeftArrow: code = "left"
        case .keyboardRightArrow: code = "right"
        case .keyboardHome: code = "home"
        case .keyboardEnd: code = "end"
        case .keyboardPageUp: code = "pageUp"
        case .keyboardPageDown: code = "pageDown"
        case .keyboardF1: code = "f1"
        case .keyboardF2: code = "f2"
        case .keyboardF3: code = "f3"
        case .keyboardF4: code = "f4"
        case .keyboardF5: code = "f5"
        case .keyboardF6: code = "f6"
        case .keyboardF7: code = "f7"
        case .keyboardF8: code = "f8"
        case .keyboardF9: code = "f9"
        case .keyboardF10: code = "f10"
        case .keyboardF11: code = "f11"
        case .keyboardF12: code = "f12"
        default:
            guard key.charactersIgnoringModifiers.count == 1 else { return nil }
            code = key.charactersIgnoringModifiers.lowercased()
        }
        var modifiers: KeyModifiers = []
        if key.modifierFlags.contains(.control) { modifiers.insert(.control) }
        if key.modifierFlags.contains(.alternate) { modifiers.insert(.option) }
        if key.modifierFlags.contains(.shift) { modifiers.insert(.shift) }
        if key.modifierFlags.contains(.command) { modifiers.insert(.command) }
        return HardwareKey(code: code, charactersIgnoringModifiers: key.charactersIgnoringModifiers, modifiers: modifiers)
    }
}
