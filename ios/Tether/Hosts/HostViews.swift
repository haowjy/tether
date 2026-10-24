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
                    TextField("MagicDNS name", text: $server)
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
                        .disabled(sending || server.isEmpty || code.isEmpty || deviceName.isEmpty)
                }
            }
        }
    }

    private func submit() async {
        sending = true
        defer { sending = false }
        do {
            try await model.enroll(server: server, code: code, deviceName: deviceName)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
