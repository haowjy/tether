import TetherKit
import UIKit

@MainActor
protocol KeyboardInputDelegate: AnyObject {
    func keyboardInput(_ event: InputEvent)
    func keyboardInputWarning()
    func keyboardInputLineEdit(gen: Int, text: String, tab: TabKey, selection: NSRange, marked: NSRange?)
    func keyboardInputLineReturn(gen: Int, text: String, tab: TabKey) -> Bool
}

@MainActor
final class KeyboardInput: UITextField, UITextFieldDelegate {
    weak var output: KeyboardInputDelegate?
    weak var focusController: FocusController?

    private(set) var mode: FocusController.Mode = .hidden
    private var generation = 0
    private var armedModifier: String?
    private let emptyInputView = UIView(frame: .zero)
    private var repeatTimers: [Int: Timer] = [:]
    private var repeatingTimers: [Int: Timer] = [:]
    private var handledCodes = Set<Int>()
    private var lineTab: TabKey?
    private var lastLineEdit: LineEdit?
    private var suppressLineEdit = false

    private struct LineEdit: Equatable {
        let text: String
        let selection: NSRange
        let marked: NSRange?
    }

    override var canBecomeFirstResponder: Bool { true }
    override var canResignFirstResponder: Bool { focusController?.canResignInput ?? true }
    override var hasText: Bool { mode != .line || !(text?.isEmpty ?? true) }

    override init(frame: CGRect) {
        super.init(frame: frame)
        inputView = emptyInputView
        isAccessibilityElement = false
        alpha = 0.01
        isUserInteractionEnabled = false
        autocorrectionType = .no
        autocapitalizationType = .none
        spellCheckingType = .no
        smartQuotesType = .no
        smartDashesType = .no
        smartInsertDeleteType = .no
        inlinePredictionType = .no
        // Keep the locale's IME and dictation keyboards available; the explicit text traits
        // above suppress corrections and predictions without restricting the input layout.
        keyboardType = .default
        returnKeyType = .default
        textContentType = .none
        delegate = self
        addTarget(self, action: #selector(editingChanged), for: .editingChanged)
        NotificationCenter.default.addObserver(self, selector: #selector(stopAllRepeats), name: UIApplication.willResignActiveNotification, object: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

    deinit { NotificationCenter.default.removeObserver(self) }

    override func resignFirstResponder() -> Bool {
        stopAllRepeats()
        return super.resignFirstResponder()
    }

    func setMode(_ mode: FocusController.Mode) {
        guard self.mode != mode else { return }
        self.mode = mode
        inputView = mode == .hidden ? emptyInputView : nil
        returnKeyType = mode == .line ? .send : .default
        reloadInputViews()
    }

    func setLine(text: String, caret: Int, tab: TabKey) -> NativeLineSnapshot {
        generation += 1
        lineTab = tab
        self.text = text
        let length = (text as NSString).length
        let offset = min(max(caret, 0), length)
        if let start = position(from: beginningOfDocument, offset: offset) {
            selectedTextRange = textRange(from: start, to: start)
        }
        lastLineEdit = lineEdit
        return snapshot(tab: tab)
    }

    func lineSnapshot() -> NativeLineSnapshot? {
        guard let tab = lineTab else { return nil }
        return snapshot(tab: tab)
    }

    private func snapshot(tab: TabKey) -> NativeLineSnapshot {
        let edit = lineEdit
        let range = { (value: NSRange) in
            TextRange(start: value.location, end: NSMaxRange(value))
        }
        return NativeLineSnapshot(tab: tab, gen: generation, text: edit.text, selection: range(edit.selection), marked: edit.marked.map(range))
    }

    func setLineCaret(_ index: Int) {
        let length = ((text ?? "") as NSString).length
        let offset = min(max(index, 0), length)
        guard let caret = position(from: beginningOfDocument, offset: offset) else { return }
        selectedTextRange = textRange(from: caret, to: caret)
    }

    func selectAllLine() {
        selectedTextRange = textRange(from: beginningOfDocument, to: endOfDocument)
    }

    func insertLine(_ text: String) {
        guard !text.contains(where: { $0.isNewline }) else { return }
        armedModifier = nil
        guard let range = selectedTextRange ?? textRange(from: endOfDocument, to: endOfDocument) else { return }
        replace(range, withText: text)
    }

    func setArmedModifier(_ armed: String?) { armedModifier = armed }

    func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
        guard mode == .line, armedModifier != nil else { return true }
        armedModifier = nil
        guard !string.isEmpty, markedTextRange == nil, range.length == 0, string.count == 1 else { return true }
        output?.keyboardInput(.text(string))
        return false
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        guard markedTextRange == nil else { return false }
        if mode == .line {
            guard let tab = lineTab else { return false }
            let returnedText = text ?? ""
            let returnedGeneration = generation
            guard output?.keyboardInputLineReturn(gen: returnedGeneration, text: returnedText, tab: tab) == true else {
                output?.keyboardInputWarning()
                return false
            }
            generation += 1
            suppressLineEdit = true
            text = ""
            if let caret = position(from: beginningOfDocument, offset: 0) {
                selectedTextRange = textRange(from: caret, to: caret)
            }
            suppressLineEdit = false
            lastLineEdit = lineEdit
        } else if mode == .terminal || mode == .hidden {
            output?.keyboardInput(.key("Enter"))
        }
        return false
    }

    func textFieldDidChangeSelection(_ textField: UITextField) { publishLineEdit() }

    override func deleteBackward() {
        guard markedTextRange == nil else {
            super.deleteBackward()
            return
        }
        guard mode == .line else {
            output?.keyboardInput(.key("BSpace"))
            return
        }
        super.deleteBackward()
    }

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var unhandled = Set<UIPress>()
        for press in presses {
            guard let key = press.key else { unhandled.insert(press); continue }
            if mode == .line {
                if key.modifierFlags.contains(.command), key.charactersIgnoringModifiers.lowercased() == "v" {
                    pasteFromHardwareKeyboard()
                    handledCodes.insert(key.keyCode.rawValue)
                    continue
                }
                let terminalControl = key.modifierFlags.contains(.control) ||
                    [.keyboardEscape, .keyboardTab, .keyboardUpArrow, .keyboardDownArrow].contains(key.keyCode)
                guard terminalControl, let hardwareKey = Self.hardwareKey(key),
                      let mapped = KeyMapper.event(for: hardwareKey) else {
                    unhandled.insert(press)
                    continue
                }
                handle(mapped, key: key)
                continue
            }

            guard let hardwareKey = Self.hardwareKey(key),
                  let mapped = KeyMapper.event(for: hardwareKey) else {
                unhandled.insert(press)
                continue
            }
            handle(mapped, key: key)
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

    @objc private func editingChanged() {
        if mode == .line {
            publishLineEdit()
            return
        }
        guard markedTextRange == nil, let text, !text.isEmpty else { return }
        output?.keyboardInput(.text(text))
        self.text = ""
    }

    private var lineEdit: LineEdit {
        let start = selectedTextRange?.start ?? beginningOfDocument
        let end = selectedTextRange?.end ?? start
        let selection = NSRange(location: offset(from: beginningOfDocument, to: start), length: offset(from: start, to: end))
        let marked: NSRange?
        if let range = markedTextRange {
            let location = offset(from: beginningOfDocument, to: range.start)
            marked = NSRange(location: location, length: offset(from: range.start, to: range.end))
        } else {
            marked = nil
        }
        return LineEdit(text: text ?? "", selection: selection, marked: marked)
    }

    private func publishLineEdit() {
        guard mode == .line, !suppressLineEdit, let lineTab else { return }
        let edit = lineEdit
        guard edit != lastLineEdit else { return }
        lastLineEdit = edit
        output?.keyboardInputLineEdit(gen: generation, text: edit.text, tab: lineTab, selection: edit.selection, marked: edit.marked)
    }

    private func handle(_ event: InputEvent, key: UIKey) {
        let code = key.keyCode.rawValue
        guard !handledCodes.contains(code) else { return }
        handledCodes.insert(code)
        if case .key(let name) = event, name == "C-c" || name == "C-d" { output?.keyboardInputWarning() }
        output?.keyboardInput(event)
        startRepeat(event, code: code)
    }

    private func pasteFromHardwareKeyboard() {
        guard let pasted = UIPasteboard.general.string, !pasted.isEmpty else { return }
        if pasted.contains(where: { $0.isNewline }) {
            output?.keyboardInput(.paste(pasted))
        } else {
            insertLine(pasted)
        }
    }

    private func startRepeat(_ input: InputEvent, code: Int) {
        let initial = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.handledCodes.contains(code) else { return }
                self.output?.keyboardInput(input)
                let repeating = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
                    MainActor.assumeIsolated {
                        guard let self, self.handledCodes.contains(code) else { return }
                        self.output?.keyboardInput(input)
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
