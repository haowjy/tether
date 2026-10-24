import SwiftUI

struct TetherRootView: View {
    @ObservedObject var model: TetherAppModel

    var body: some View {
        ZStack(alignment: .topTrailing) {
            WebShellView(model: model).ignoresSafeArea()
            Button {
                model.showingServers = true
            } label: {
                Image(systemName: "server.rack")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 42, height: 42)
                    .background(.regularMaterial, in: Circle())
            }
            .accessibilityLabel("Servers")
            .padding(.trailing, 12)
            .padding(.top, 8)
        }
        .sheet(isPresented: $model.showingServers, onDismiss: { model.setCovered(false) }) {
            ServerListSheet(model: model)
        }
        .overlay {
            if model.isLocked { LockedView(model: model) }
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
