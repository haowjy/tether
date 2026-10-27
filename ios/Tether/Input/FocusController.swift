import GameController
import TetherKit
import UIKit

@MainActor
final class FocusController {
    typealias Mode = TetherKit.FocusMode

    private(set) var mode: Mode = .hidden
    private var moving = false
    private var isCovered = false
    private var stateBeforeCover: Mode?
    private let input: KeyboardInput

    var canResignInput: Bool { moving || mode == .webText || mode == .select }
    var covered: Bool { isCovered }
    var modeForWeb: Mode { isCovered ? (stateBeforeCover ?? mode) : mode }

    init(input: KeyboardInput) {
        self.input = input
        input.focusController = self
    }

    func set(_ next: Mode) {
        guard !isCovered else {
            stateBeforeCover = next
            return
        }
        apply(next)
    }

    private func apply(_ next: Mode) {
        mode = next
        input.setMode(next)
        moving = true
        defer { moving = false }
        switch next {
        case .terminal, .line:
            if !input.isFirstResponder { input.becomeFirstResponder() }
        case .hidden:
            if !input.isFirstResponder { input.becomeFirstResponder() }
        case .webText, .select:
            if input.isFirstResponder { _ = input.resignFirstResponder() }
        }
    }

    func systemKeyboardDidHide() {
        guard mode == .terminal || mode == .line, GCKeyboard.coalesced == nil else { return }
        set(.hidden)
    }

    func restoreAfterInterruption() {
        guard !isCovered else { return }
        set(mode)
    }

    func coverNativeScreen(_ covered: Bool) {
        guard isCovered != covered else { return }
        if covered {
            stateBeforeCover = mode
            isCovered = true
            apply(.webText)
        } else if let previous = stateBeforeCover {
            isCovered = false
            stateBeforeCover = nil
            set(previous)
        } else {
            isCovered = false
        }
    }
}
