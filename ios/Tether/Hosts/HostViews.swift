import SwiftUI
import UIKit

struct ServerListSheet: View {
    @ObservedObject var model: TetherAppModel
    @State private var adding = false

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
            .sheet(isPresented: $adding) { AddHostView(model: model) }
        }
        .presentationDetents([.medium, .large])
        .onAppear { model.setCovered(true) }
    }
}

struct AddHostView: View {
    @ObservedObject var model: TetherAppModel
    @Environment(\.dismiss) private var dismiss
    @State private var server = ""
    @State private var code = ""
    @State private var deviceName = UIDevice.current.name
    @State private var error: String?
    @State private var sending = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("MagicDNS name or setup link", text: $server)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
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
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(sending ? "Adding…" : "Add") { Task { await submit() } }
                        .disabled(sending || target == nil || deviceName.isEmpty)
                }
            }
        }
    }

    /// What Add will send. `tether setup` prints a link that carries the code
    /// (`https://<MagicDNS name>/#code=7KQ4-XM2P`), so a pasted link fills both fields; a
    /// bare MagicDNS name still takes the separately typed code.
    private var target: (server: String, code: String)? {
        var host = server.trimmingCharacters(in: .whitespacesAndNewlines)
        var secret = code.trimmingCharacters(in: .whitespacesAndNewlines)
        if let link = Self.link(host) {
            host = link.host
            if !link.code.isEmpty { secret = link.code }
        }
        return host.isEmpty || secret.isEmpty ? nil : (host, secret)
    }

    private static func link(_ text: String) -> (host: String, code: String)? {
        guard text.contains("://") || text.contains("#code=") else { return nil }
        var rest = text
        if let scheme = rest.range(of: "://") { rest = String(rest[scheme.upperBound...]) }
        var code = ""
        if let fragment = rest.range(of: "#code=") {
            code = String(rest[fragment.upperBound...])
            rest = String(rest[..<fragment.lowerBound])
        }
        if let path = rest.firstIndex(of: "/") { rest = String(rest[..<path]) }
        return rest.isEmpty ? nil : (rest, code)
    }

    private func submit() async {
        guard let target = target else { return }
        sending = true
        defer { sending = false }
        do {
            try await model.enroll(server: target.server, code: target.code, deviceName: deviceName)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
