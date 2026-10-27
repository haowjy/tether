import CryptoKit
import Foundation
import LocalAuthentication
import Network
import SwiftUI
import TetherKit
import UIKit

enum TokenAccess {
    case token(String)
    case locked
    case notEnrolled
}

struct AddHostRequest: Identifiable {
    let id: UUID
    let server: String
    let code: String
    let error: String?

    init(server: String, code: String = "", error: String? = nil) {
        id = UUID()
        self.server = server
        self.code = code
        self.error = error
    }
}

@MainActor
final class TetherAppModel: ObservableObject {
    private static let preferencesKey = "tether.preferences"

    @Published private(set) var hosts: [HostEntry]
    @Published private(set) var isLocked: Bool
    /// The user's choices. Native owns them: appearance and relock are applied here, the web only shows and asks.
    private(set) var preferences: Preferences
    @Published private(set) var pendingAddRequest: AddHostRequest?
    @Published var showingServers = false
    @Published var errorMessage: String?

    let hostStore = HostStore()
    let tokenStore = TokenStore()
    let drafts = DraftStore()
    private let authClient = AuthClient()
    private let defaults = UserDefaults.standard
    private let expectedTokenItemKey = "tether.tokens.expected"
    private var tokens: [String: String]?
    private var authenticationContext: LAContext?
    // A late 401 can finish while locked; keep a digest, not the discarded credential.
    private var rejectedTokenDigestsWhileLocked: [String: Data] = [:]
    private var visible = true
    private var covered = false
    private var online = false
    private var backgroundEnteredAt: Date?
    private var backgroundHadTokens = false
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var shouldAutoUnlock = false
    /// Debug builds only: the state came from the launch environment and is never written to the device.
    #if DEBUG
    private var seeded = false
    #else
    private let seeded = false
    #endif
    private var unlockInFlight = false
    private weak var shell: WebShellController?
    private let pathMonitor = NWPathMonitor()

    init() {
        preferences = defaults.data(forKey: Self.preferencesKey).flatMap { try? JSONDecoder().decode(Preferences.self, from: $0) } ?? .standard
        let storedHosts = hostStore.load()
        hosts = storedHosts
        let expectsTokenItem = defaults.object(forKey: expectedTokenItemKey) as? Bool ?? !storedHosts.isEmpty
        isLocked = expectsTokenItem
        tokens = expectsTokenItem ? nil : [:]
        shouldAutoUnlock = expectsTokenItem
        #if DEBUG
        // Simulator verification has no Face ID or typing into the Add sheet: a launch environment (SIMCTL_CHILD_*) seeds one server held in memory only.
        let environment = ProcessInfo.processInfo.environment
        if let url = environment["TETHER_DEBUG_HOST_URL"], let id = environment["TETHER_DEBUG_HOST_ID"], let token = environment["TETHER_DEBUG_TOKEN"] {
            hosts = [HostEntry(id: id, name: environment["TETHER_DEBUG_HOST_NAME"] ?? id, baseURL: url)]
            isLocked = false
            tokens = [id: token]
            shouldAutoUnlock = false
            seeded = true
        }
        #endif
        // The workspace's version lives inside the JSON, which only the web reads: the keys that named a version are retired. A saved v2 is discarded by the web parser.
        defaults.removeObject(forKey: "tether.workspace.v1")
        defaults.removeObject(forKey: "tether.workspace.v2")
        startNetworkMonitor()
    }

    var lifecycle: Lifecycle {
        Lifecycle(visible: visible, online: online, locked: isLocked, covered: covered)
    }

    func attach(_ controller: WebShellController) {
        shell = controller
        controller.coverNativeScreen(isLocked || covered)
    }

    func boot(viewport: Viewport, focusMode: FocusMode, lineSnapshot: NativeLineSnapshot?) -> Boot {
        Boot(hosts: platformHosts, workspace: loadWorkspace(), viewport: viewport, preferences: preferences, lifecycle: lifecycle, focusMode: focusMode, lineSnapshot: lineSnapshot)
    }

    /// One choice from the web's Settings. The reply is every preference, so the web shows what native holds.
    func setPreference(_ name: String, to value: JSONValue) throws -> Preferences {
        var next = preferences
        try next.set(name, to: value)
        preferences = next
        defaults.set(try? JSONEncoder().encode(next), forKey: Self.preferencesKey)
        shell?.applyAppearance(next.appearance)
        return next
    }

    var platformHosts: [PlatformHost] { hosts.map(\.platformHost) }

    func saveWorkspace(_ workspace: JSONValue) {
        guard let data = try? JSONEncoder().encode(workspace) else { return }
        defaults.set(data, forKey: "tether.workspace")
    }

    func loadWorkspace() -> JSONValue? {
        guard let data = defaults.data(forKey: "tether.workspace") else { return nil }
        return try? JSONDecoder().decode(JSONValue.self, from: data)
    }

    func token(for hostID: String) -> TokenAccess {
        guard hosts.contains(where: { $0.id == hostID }) else { return .notEnrolled }
        guard !isLocked, let tokens else { return .locked }
        guard let token = tokens[hostID] else { return .notEnrolled }
        return .token(token)
    }

    func socket(for hostID: String) -> SocketReply {
        guard let host = hosts.first(where: { $0.id == hostID }) else { return .notEnrolled }
        guard !isLocked, let tokens else { return .locked }
        guard let token = tokens[hostID] else { return .notEnrolled }
        guard var components = URLComponents(string: host.baseURL),
              components.scheme?.lowercased() == "https",
              components.host != nil,
              components.user == nil,
              components.password == nil,
              components.query == nil,
              components.fragment == nil,
              components.path.isEmpty || components.path == "/" else { return .notEnrolled }
        components.scheme = "wss"
        components.path = "/ws"
        guard let url = components.url else { return .notEnrolled }
        return .socket(url: url.absoluteString, token: token)
    }

    func rejectedToken(for hostID: String, token rejectedToken: String) {
        Task { await applyRejectedToken(for: hostID, token: rejectedToken) }
    }

    private func applyRejectedToken(for hostID: String, token rejectedToken: String) async {
        guard hosts.contains(where: { $0.id == hostID }) else { return }
        guard var tokens else {
            rejectedTokenDigestsWhileLocked[hostID] = Self.tokenDigest(rejectedToken)
            shell?.send(.hosts(platformHosts))
            return
        }
        guard tokens[hostID] == rejectedToken else { return }
        tokens.removeValue(forKey: hostID)
        self.tokens = tokens
        do {
            try await saveTokens(tokens)
            errorMessage = nil
        } catch {
            errorMessage = "The rejected server token couldn't be removed from Keychain."
        }
        shell?.send(.hosts(platformHosts))
    }

    func enroll(server: String, code: String, deviceName: String) async throws {
        guard !isLocked, tokens != nil else { throw TokenStore.StoreError.locked }
        let result = try await authClient.enroll(server: server, code: code, deviceName: deviceName)
        guard !isLocked, let currentTokens = tokens else { throw TokenStore.StoreError.locked }
        var nextTokens = currentTokens
        nextTokens[result.entry.id] = result.token
        tokens = nextTokens
        do {
            try await saveTokens(nextTokens)
        } catch {
            if tokens == nextTokens { tokens = currentTokens }
            throw error
        }
        var nextHosts = hosts.filter { $0.id != result.entry.id }
        nextHosts.append(result.entry)
        do {
            try saveHosts(nextHosts)
        } catch {
            if tokens == nextTokens { tokens = currentTokens }
            try? await saveTokens(currentTokens)
            throw error
        }
        hosts = nextHosts
        errorMessage = nil
        shell?.send(.hosts(platformHosts))
    }

    func openAddServerURL(_ url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "tether",
              components.host?.lowercased() == "add",
              components.path.isEmpty,
              components.user == nil,
              components.password == nil,
              components.port == nil,
              components.fragment == nil,
              let queryItems = components.queryItems,
              queryItems.allSatisfy({ $0.name == "host" || $0.name == "code" }),
              queryItems.filter({ $0.name == "host" }).count == 1,
              queryItems.filter({ $0.name == "code" }).count <= 1,
              let origin = queryItems.first(where: { $0.name == "host" })?.value else { return }

        let code = queryItems.first(where: { $0.name == "code" })?.value ?? ""

        do {
            let server = try AuthClient.serverURL(origin).absoluteString
            showAddHost(server: server, code: code)
        } catch {
            showAddHost(server: origin, code: code, error: error.localizedDescription)
        }
    }

    func takePendingAddRequest() -> AddHostRequest? {
        defer { pendingAddRequest = nil }
        return pendingAddRequest
    }

    private func showAddHost(server: String, code: String = "", error: String? = nil) {
        pendingAddRequest = AddHostRequest(server: server, code: code, error: error)
        showingServers = true
    }

    func removeHost(_ host: HostEntry) async {
        guard let currentTokens = tokens else {
            errorMessage = "Unlock tether before removing a server."
            return
        }
        var nextTokens = currentTokens
        nextTokens.removeValue(forKey: host.id)
        let nextHosts = hosts.filter { $0.id != host.id }
        tokens = nextTokens
        do {
            try await saveTokens(nextTokens)
            do {
                try saveHosts(nextHosts)
            } catch {
                if tokens == nextTokens { tokens = currentTokens }
                try? await saveTokens(currentTokens)
                throw error
            }
            hosts = nextHosts
            errorMessage = nil
            shell?.send(.hosts(platformHosts))
            publishLifecycle()
        } catch {
            if tokens == nextTokens { tokens = currentTokens }
            errorMessage = "Couldn't remove this server."
        }
    }

    func resetTokens() async {
        // A Debug seed never touched the Keychain, so it must not delete the device's real item.
        if seeded {
            tokens = [:]
            shell?.send(.hosts(platformHosts))
            publishLifecycle()
            return
        }
        do {
            try await tokenStore.deleteAll(context: authenticationContext)
            authenticationContext?.invalidate()
            authenticationContext = nil
            defaults.set(false, forKey: expectedTokenItemKey)
            tokens = [:]
            rejectedTokenDigestsWhileLocked.removeAll()
            isLocked = false
            errorMessage = nil
            updateNativeCoverage()
            shell?.send(.hosts(platformHosts))
            publishLifecycle()
        } catch {
            errorMessage = "Couldn't reset the stored tokens."
        }
    }

    func setCovered(_ value: Bool) {
        guard covered != value else { return }
        covered = value
        updateNativeCoverage()
        publishLifecycle()
    }

    func sceneChanged(_ phase: ScenePhase) {
        switch phase {
        case .active:
            visible = true
            let elapsed = backgroundEnteredAt.map { Date().timeIntervalSince($0) } ?? 0
            backgroundEnteredAt = nil
            endBackgroundTask()
            // The timed check runs first on foreground, against when the app went to the background; At launch has no delay, so it never relocks here.
            if backgroundHadTokens, let delay = preferences.relock.backgroundDelay, elapsed > delay {
                lockApp()
                shouldAutoUnlock = true
            }
            backgroundHadTokens = false
            shell?.restoreFocus()
            publishLifecycle()
            if isLocked && shouldAutoUnlock {
                shouldAutoUnlock = false
                Task { await unlock() }
            }
        case .background:
            visible = false
            if backgroundEnteredAt == nil {
                backgroundEnteredAt = Date()
                backgroundHadTokens = tokens?.isEmpty == false
            }
            beginBackgroundTask()
            if let shell {
                shell.sendLifecycle(lifecycle) { [weak self] in self?.endBackgroundTask() }
            } else {
                endBackgroundTask()
            }
        case .inactive:
            break
        @unknown default:
            break
        }
    }

    func unlock() async {
        guard !unlockInFlight else { return }
        unlockInFlight = true
        defer { unlockInFlight = false }
        errorMessage = nil
        do {
            guard let result = try await tokenStore.readAll(localizedReason: "Unlock tether") else {
                errorMessage = "No token item is available. Reset tokens, then enrol your servers again."
                return
            }
            var unlockedTokens = result.tokens
            for (hostID, rejectedDigest) in rejectedTokenDigestsWhileLocked
            where unlockedTokens[hostID].map(Self.tokenDigest) == rejectedDigest {
                unlockedTokens.removeValue(forKey: hostID)
            }
            authenticationContext = result.context
            if unlockedTokens != result.tokens {
                do {
                    try await saveTokens(unlockedTokens)
                } catch {
                    authenticationContext?.invalidate()
                    authenticationContext = nil
                    throw error
                }
            }
            tokens = unlockedTokens
            if unlockedTokens == result.tokens { defaults.set(!unlockedTokens.isEmpty, forKey: expectedTokenItemKey) }
            rejectedTokenDigestsWhileLocked.removeAll()
            isLocked = false
            errorMessage = nil
            updateNativeCoverage()
            publishLifecycle()
        } catch {
            if let storeError = error as? TokenStore.StoreError {
                errorMessage = storeError.unlockMessage
            } else {
                errorMessage = "Couldn't read the stored tokens. Try again, or reset tokens if Face ID changed."
            }
        }
    }

    func lockApp() {
        // A Debug seed's token is in memory only; an unlock would read the real Keychain over it.
        if seeded { return }
        tokens = nil
        authenticationContext?.invalidate()
        authenticationContext = nil
        isLocked = true
        updateNativeCoverage()
    }

    func publishLifecycle() { shell?.send(.lifecycle(lifecycle)) }

    private func updateNativeCoverage() { shell?.coverNativeScreen(isLocked || covered) }

    private func saveHosts(_ hosts: [HostEntry]) throws {
        if !seeded { try hostStore.save(hosts) }
    }

    private func saveTokens(_ tokens: [String: String]) async throws {
        if seeded { return }
        try await tokenStore.save(tokens, context: authenticationContext)
        defaults.set(!tokens.isEmpty, forKey: expectedTokenItemKey)
    }

    private static func tokenDigest(_ token: String) -> Data {
        Data(SHA256.hash(data: Data(token.utf8)))
    }

    private func beginBackgroundTask() {
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Close tether sockets") { [weak self] in
            Task { @MainActor in self?.endBackgroundTask() }
        }
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    private func startNetworkMonitor() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self, self.online != (path.status == .satisfied) else { return }
                self.online = path.status == .satisfied
                self.publishLifecycle()
            }
        }
        pathMonitor.start(queue: DispatchQueue(label: "com.jimmyyao.tether.network"))
    }
}
