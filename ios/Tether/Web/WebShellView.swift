import SwiftUI

struct WebShellView: UIViewControllerRepresentable {
    let model: TetherAppModel

    func makeUIViewController(context: Context) -> WebShellController {
        WebShellController(model: model)
    }

    func updateUIViewController(_ controller: WebShellController, context: Context) {}
}
