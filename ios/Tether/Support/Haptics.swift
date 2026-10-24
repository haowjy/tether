import UIKit

@MainActor
final class Haptics {
    private let impact = UIImpactFeedbackGenerator(style: .light)
    private let firm = UIImpactFeedbackGenerator(style: .medium)
    private let rigid = UIImpactFeedbackGenerator(style: .rigid)
    private let selection = UISelectionFeedbackGenerator()
    private let notification = UINotificationFeedbackGenerator()

    func send(_ kind: String) {
        switch kind {
        case "key": impact.impactOccurred()
        case "modifier": firm.impactOccurred()
        case "rigid": rigid.impactOccurred()
        case "selection": selection.selectionChanged()
        case "warning": notification.notificationOccurred(.warning)
        default: return
        }
    }
}
