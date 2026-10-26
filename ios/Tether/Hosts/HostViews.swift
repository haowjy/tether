import SwiftUI
import UIKit

struct ServerListSheet: View {
    @ObservedObject var model: TetherAppModel
    @State private var addRequest: AddHostRequest?

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
                    Button("Add", systemImage: "plus") {
                        addRequest = AddHostRequest(server: "")
                    }
                }
            }
            .sheet(item: $addRequest) { request in
                AddHostView(model: model, request: request)
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear {
            model.setCovered(true)
            presentPendingAdd()
        }
        .onChange(of: model.pendingAddRequest?.id) { _, _ in presentPendingAdd() }
    }

    private func presentPendingAdd() {
        guard let request = model.takePendingAddRequest() else { return }
        addRequest = request
    }
}

struct AddHostView: View {
    private enum Step: Equatable { case server, device }

    @ObservedObject var model: TetherAppModel
    @Environment(\.dismiss) private var dismiss
    private let request: AddHostRequest
    @State private var server: String
    @State private var codeCells = Array(repeating: "", count: EnrolmentCode.cellCount)
    @State private var deviceName = UIDevice.current.name
    @State private var step = Step.server
    @State private var error: String?
    @State private var sending = false

    init(model: TetherAppModel, request: AddHostRequest) {
        self.model = model
        self.request = request
        _server = State(initialValue: request.server)
        _codeCells = State(initialValue: EnrolmentCode.cells(from: request.code))
        _error = State(initialValue: request.error)
    }

    var body: some View {
        NavigationStack {
            Form {
                if step == .server {
                    Section("Server") {
                        TextField("MagicDNS name or setup link", text: $server)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                            .onChange(of: server) { _, text in
                                // A pasted setup link carries both: show the host and code in their fields.
                                guard let link = Self.link(text) else { return }
                                server = link.host
                                codeCells = EnrolmentCode.cells(from: link.code)
                            }
                    }
                    Section("Enrolment code (optional)") {
                        EnrolmentCodeField(cells: $codeCells)
                        HStack(alignment: .firstTextBaseline) {
                            Text("Leave blank if this phone is already enrolled; otherwise enter all 8 characters.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            Spacer(minLength: 4)
                            if codeCells.contains(where: { !$0.isEmpty }) {
                                Button("Clear") { codeCells = Array(repeating: "", count: EnrolmentCode.cellCount) }
                                    .font(.footnote)
                            }
                        }
                        .listRowSeparator(.hidden)
                    }
                } else {
                    Section("Device name") {
                        TextField("Device name", text: $deviceName)
                            .textInputAutocapitalization(.words)
                    }
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle(step == .server ? "Add server" : "Device name")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(step == .server ? "Cancel" : "Back") {
                        if step == .server { dismiss() }
                        else { step = .server }
                    }
                    .disabled(sending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(step == .server ? "Next" : (sending ? "Adding…" : "Add")) {
                        if step == .server { advance() }
                        else { Task { await submit() } }
                    }
                    .disabled(sending || (step == .server ? !canContinue : !canAdd))
                }
            }
            .onChange(of: request.id) { _, _ in
                server = request.server
                codeCells = EnrolmentCode.cells(from: request.code)
                deviceName = UIDevice.current.name
                error = request.error
                step = .server
            }
        }
    }

    private var canContinue: Bool {
        !server.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (codeCells.allSatisfy(\.isEmpty) || codeCells.allSatisfy { !$0.isEmpty })
    }

    private var canAdd: Bool {
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

    private func advance() {
        let host = server.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            _ = try AuthClient.serverURL(host)
            error = nil
            step = .device
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func submit() async {
        guard canAdd else { return }
        let host = server.trimmingCharacters(in: .whitespacesAndNewlines)
        let code = codeCells.joined()
        sending = true
        defer { sending = false }
        do {
            try await model.enroll(server: host, code: code, deviceName: deviceName)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private enum EnrolmentCode {
    static let cellCount = 8

    static func cells(from text: String) -> [String] {
        let characters = text.uppercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        let cells = Array(characters.prefix(cellCount)).map(String.init)
        return cells + Array(repeating: "", count: cellCount - cells.count)
    }
}

private struct EnrolmentCodeField: View {
    @Binding var cells: [String]
    @State private var focusedCell: Int?

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<EnrolmentCode.cellCount, id: \.self) { index in
                if index == 4 {
                    Text("–")
                        .font(.title2.weight(.medium))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 4)
                        .accessibilityHidden(true)
                }
                CodeDigitField(
                    index: index,
                    value: $cells[index],
                    focusedCell: $focusedCell,
                    onReplacement: { replacement in replace(at: index, with: replacement) },
                    onEmptyBackspace: { backspace(at: index) }
                )
                .frame(width: 36, height: 46)
                .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(focusedCell == index ? Color.accentColor : Color(uiColor: .separator).opacity(0.4), lineWidth: focusedCell == index ? 2 : 1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, 4)
    }

    private func replace(at index: Int, with replacement: String) {
        if replacement.isEmpty {
            cells[index] = ""
            focusedCell = index
            return
        }
        if replacement.count > 1 {
            // A multi-character edit is a paste: separators and letter case are presentation only.
            cells = EnrolmentCode.cells(from: replacement)
            focusedCell = min(cells.firstIndex(where: \.isEmpty) ?? (EnrolmentCode.cellCount - 1), EnrolmentCode.cellCount - 1)
            return
        }
        guard let character = EnrolmentCode.cells(from: replacement).first, !character.isEmpty else { return }
        cells[index] = character
        focusedCell = min(index + 1, EnrolmentCode.cellCount - 1)
    }

    private func backspace(at index: Int) {
        guard index > 0 else { return }
        cells[index - 1] = ""
        focusedCell = index - 1
    }
}

private struct CodeDigitField: UIViewRepresentable {
    let index: Int
    @Binding var value: String
    @Binding var focusedCell: Int?
    let onReplacement: (String) -> Void
    let onEmptyBackspace: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> CodeDigitTextField {
        let field = CodeDigitTextField()
        field.delegate = context.coordinator
        field.textAlignment = .center
        field.font = .monospacedSystemFont(ofSize: 19, weight: .medium)
        field.keyboardType = .asciiCapable
        field.autocapitalizationType = .allCharacters
        field.autocorrectionType = .no
        field.spellCheckingType = .no
        field.smartQuotesType = .no
        field.smartDashesType = .no
        field.smartInsertDeleteType = .no
        field.clearButtonMode = .never
        field.accessibilityLabel = "Enrolment code character \(index + 1) of \(EnrolmentCode.cellCount)"
        field.accessibilityHint = "Enter a letter or number."
        return field
    }

    func updateUIView(_ field: CodeDigitTextField, context: Context) {
        context.coordinator.owner = self
        if field.text != value { field.text = value }
        field.onEmptyBackspace = { [weak coordinator = context.coordinator] in coordinator?.deleteBackwardOnEmptyCell() }
        if focusedCell == index {
            if !field.isFirstResponder { field.becomeFirstResponder() }
        } else if field.isFirstResponder {
            field.resignFirstResponder()
        }
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var owner: CodeDigitField

        init(_ owner: CodeDigitField) { self.owner = owner }

        func textFieldDidBeginEditing(_ textField: UITextField) {
            owner.focusedCell = owner.index
        }

        func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
            owner.onReplacement(string)
            return false
        }

        func deleteBackwardOnEmptyCell() { owner.onEmptyBackspace() }
    }
}

private final class CodeDigitTextField: UITextField {
    var onEmptyBackspace: (() -> Void)?

    override func deleteBackward() {
        if (text ?? "").isEmpty { onEmptyBackspace?() }
        else { super.deleteBackward() }
    }
}
