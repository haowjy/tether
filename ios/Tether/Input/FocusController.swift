import GameController
import UIKit

@MainActor
final class FocusController {
    enum Mode: String { case hidden, terminal, webText, select }

    private struct State {
        let mode: Mode
        let lineFieldLent: Bool
    }

    private(set) var mode: Mode = .hidden
    private var moving = false
    private var lineFieldTouch = false
    private var lineFieldLent = false
    private var isCovered = false
    private var stateBeforeCover: State?
    private let input: TerminalInputView

    var canResignInput: Bool { moving || lineFieldTouch || mode == .webText || mode == .select }
    var covered: Bool { isCovered }

    init(input: TerminalInputView) {
        self.input = input
        input.focusController = self
    }

    func set(_ next: Mode, fromLineField: Bool = false) {
        guard !isCovered else {
            let lineFieldLent = next == .webText
                && (fromLineField || stateBeforeCover?.lineFieldLent == true)
            stateBeforeCover = State(mode: next, lineFieldLent: lineFieldLent)
            return
        }
        apply(State(mode: next, lineFieldLent: next == .webText && fromLineField))
    }

    private func apply(_ state: State) {
        mode = state.mode
        lineFieldLent = state.lineFieldLent
        moving = true
        defer { moving = false }
        switch state.mode {
        case .terminal:
            input.hidesSoftwareKeyboard = false
            if !input.isFirstResponder { input.becomeFirstResponder() }
        case .hidden:
            input.hidesSoftwareKeyboard = true
            if !input.isFirstResponder { input.becomeFirstResponder() }
        case .webText, .select:
            input.hidesSoftwareKeyboard = false
            if input.isFirstResponder { _ = input.resignFirstResponder() }
        }
    }

    func allowLineFieldTouch() { lineFieldTouch = true }

    func lineFieldConfirmed() {
        lineFieldTouch = false
        set(.webText, fromLineField: true)
    }

    var hasPendingLineFieldTouch: Bool { lineFieldTouch }

    func lineFieldCancelled() { lineFieldTouch = false }

    func systemKeyboardDidHide() {
        guard mode == .terminal, GCKeyboard.coalesced == nil else { return }
        set(.hidden)
    }

    func restoreAfterInterruption() {
        guard !isCovered else { return }
        set(mode == .webText && lineFieldLent ? .terminal : mode)
    }

    func coverNativeScreen(_ covered: Bool) {
        guard isCovered != covered else { return }
        if covered {
            stateBeforeCover = State(mode: mode, lineFieldLent: lineFieldLent)
            isCovered = true
            apply(State(mode: .webText, lineFieldLent: false))
        } else if let previous = stateBeforeCover {
            isCovered = false
            stateBeforeCover = nil
            let restoredMode = previous.mode == .webText && previous.lineFieldLent ? .terminal : previous.mode
            set(restoredMode)
        } else {
            isCovered = false
        }
    }
}
