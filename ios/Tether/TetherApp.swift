import SwiftUI

@main
@MainActor
struct TetherApp: App {
    @StateObject private var model = TetherAppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            TetherRootView(model: model)
                .onChange(of: scenePhase, initial: true) { _, phase in model.sceneChanged(phase) }
                .onOpenURL { model.openAddServerURL($0) }
        }
    }
}
