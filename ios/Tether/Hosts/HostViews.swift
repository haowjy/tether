import SwiftUI
import UIKit

struct ServerListSheet: View {
    @ObservedObject var model: TetherAppModel
    @State private var adding = false
    @State private var prefilledServer = ""

    var body: some View {
        NavigationStack {
            List {
                if model.hosts.isEmpty {
                    ContentUnavailableView("No servers yet", systemImage: "server.rack", description: Text("Add a Tailscale server to connect to its tmux sessions."))
                } else {
                    ForEach(model.hosts, id: \.id) { host in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(host.name).font(.headline)
                            Text(host.baseURL).font(.caption).foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    .onDelete { offsets in
                        let hosts = offsets.map { model.hosts[$0] }
                        Task {
                            for host in hosts { await model.removeHost(host) }
                        }
                    }
                }
                if let error = model.errorMessage { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle("Servers")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { model.showingServers = false }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Add", systemImage: "plus") { adding = true }
                }
            }
            .sheet(isPresented: $adding) { AddHostView(model: model, initialServer: prefilledServer) }
        }
        .presentationDetents([.medium, .large])
        .onAppear {
            model.setCovered(true)
            presentPendingAdd()
        }
        .onChange(of: model.pendingAddServer) { _, _ in presentPendingAdd() }
    }

    private func presentPendingAdd() {
        guard let server = model.takePendingAddServer() else { return }
        prefilledServer = server
        adding = true
    }
}

struct AddHostView: View {
    @ObservedObject var model: TetherAppModel
    @Environment(\.dismiss) private var dismiss
    private let initialServer: String
    @State private var server = ""
    @State private var code = ""
    @State private var deviceName = UIDevice.current.name
    @State private var error: String?
    @State private var sending = false

    init(model: TetherAppModel, initialServer: String = "") {
        self.model = model
        self.initialServer = initialServer
        _server = State(initialValue: initialServer)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("MagicDNS name or setup link", text: $server)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .onChange(of: server) { _, text in
                            // A pasted setup link carries both: take it apart so the fields say
                            // what Add will send, instead of hiding a value behind the text.
                            guard let link = Self.link(text) else { return }
                            server = link.host
                            code = link.code
                        }
                    TextField("One-time enrolment code", text: $code)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                Section("Device") {
                    TextField("Device name", text: $deviceName)
                        .textInputAutocapitalization(.words)
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle("Add server")
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: initialServer) { _, value in
                server = value
                code = ""
                error = nil
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(sending ? "Adding…" : "Add") { Task { await submit() } }
                        .disabled(sending || !canSubmit)
                }
            }
        }
    }

    private var canSubmit: Bool {
        !server.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !deviceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// A setup link's host and code: `tether setup` prints `https://<MagicDNS name>/#code=7KQ4-XM2P`.
    private static func link(_ text: String) -> (host: String, code: String)? {
        guard let parts = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              let fragment = parts.fragment, fragment.hasPrefix("code="),
              let host = parts.host, !host.isEmpty else { return nil }
        let code = String(fragment.dropFirst("code=".count))
        guard !code.isEmpty else { return nil }
        return (parts.port.map { "\(host):\(String($0))" } ?? host, code)
    }

    private func submit() async {
        guard canSubmit else { return }
        let host = server.trimmingCharacters(in: .whitespacesAndNewlines)
        let secret = code.trimmingCharacters(in: .whitespacesAndNewlines)
        sending = true
        defer { sending = false }
        do {
            try await model.enroll(server: host, code: secret, deviceName: deviceName)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
