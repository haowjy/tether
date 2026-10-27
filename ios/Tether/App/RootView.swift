import SwiftUI
import TetherKit

struct TetherRootView: View {
    @ObservedObject var model: TetherAppModel

    var body: some View {
        WebShellView(model: model)
            .ignoresSafeArea()
            .sheet(isPresented: $model.showingServers, onDismiss: { model.setCovered(false) }) {
                ServerListSheet(model: model)
            }
            .overlay {
                if model.isLocked { LockedView(model: model) }
            }
            // The one owner of the window's appearance: the lock screen, the sheets, the keyboard and the web's scheme follow it. nil is the system's.
            .preferredColorScheme(model.preferences.appearance.colorScheme)
    }
}

private extension Appearance {
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

private struct LockedView: View {
    @ObservedObject var model: TetherAppModel
    @State private var confirmingTokenReset = false

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "lock.fill").font(.system(size: 30))
            Text("tether is locked").font(.title2.weight(.semibold))
            if let error = model.errorMessage { Text(error).font(.footnote).foregroundStyle(.secondary) }
            Button("Unlock with Face ID") { Task { await model.unlock() } }
                .buttonStyle(.borderedProminent)
            Button("Reset tokens", role: .destructive) { confirmingTokenReset = true }
                .font(.footnote)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
        .alert("Reset stored tokens?", isPresented: $confirmingTokenReset) {
            Button("Cancel", role: .cancel) {}
            Button("Reset tokens", role: .destructive) { Task { await model.resetTokens() } }
        } message: {
            Text("You will need to enrol each server again.")
        }
    }
}
