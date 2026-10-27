import Foundation

public enum BridgeContract {
    public static let version = 7
}

public struct SafeArea: Codable, Equatable, Sendable {
    public var top: Double
    public var right: Double
    public var bottom: Double
    public var left: Double

    public init(top: Double, right: Double, bottom: Double, left: Double) {
        self.top = top
        self.right = right
        self.bottom = bottom
        self.left = left
    }
}

public struct Viewport: Codable, Equatable, Sendable {
    public var layout: String
    public var density: String
    public var directInput: String
    public var scheme: String
    public var width: Double
    public var stableHeight: Double
    public var visibleHeight: Double
    public var keyboardInset: Double
    public var safeArea: SafeArea
    public var keyboard: Bool

    public init(
        layout: String,
        density: String,
        directInput: String = "native",
        scheme: String,
        width: Double,
        stableHeight: Double,
        visibleHeight: Double,
        keyboardInset: Double,
        safeArea: SafeArea,
        keyboard: Bool
    ) {
        self.layout = layout
        self.density = density
        self.directInput = directInput
        self.scheme = scheme
        self.width = width
        self.stableHeight = stableHeight
        self.visibleHeight = visibleHeight
        self.keyboardInset = keyboardInset
        self.safeArea = safeArea
        self.keyboard = keyboard
    }
}

public enum Appearance: String, Codable, Equatable, Sendable {
    case system, light, dark
}

public enum TextSize: String, Codable, Equatable, Sendable {
    case small, `default`, large, larger
}

/// How long the app may stay in the background before Face ID asks again (auth.md, "When the app asks for Face ID").
public enum Relock: String, Codable, Equatable, Sendable {
    case fiveMinutes = "5min"
    case oneHour = "1hour"
    case launch

    /// The Face ID gap this choice allows; `launch` is unbounded: the app unlocks once per launch.
    private var allowedAbsence: Duration? {
        switch self {
        case .fiveMinutes: .seconds(5 * 60)
        case .oneHour: .seconds(60 * 60)
        case .launch: nil
        }
    }

    /// An elapsed time that is negative is unknown, and an unknown time fails toward locking.
    public func locks(after elapsed: Duration) -> Bool {
        guard let allowedAbsence else { return false }
        return elapsed < .zero || elapsed > allowedAbsence
    }

    /// Whether `self` lets the app stay unlocked longer than `other` does.
    public func loosens(_ other: Relock) -> Bool {
        (allowedAbsence ?? .seconds(Int64.max)) > (other.allowedAbsence ?? .seconds(Int64.max))
    }
}

/// What the user chose. Native keeps these (UserDefaults) and applies them; the web only shows and asks to change them.
public struct Preferences: Codable, Equatable, Sendable {
    public var appearance: Appearance
    public var textSize: TextSize
    public var relock: Relock

    public static let standard = Preferences(appearance: .system, textSize: .default, relock: .oneHour)
    /// What an unreadable stored relock means: the strictest choice, since a guess must not loosen the lock.
    private static let unreadableRelock = Relock.fiveMinutes

    public init(appearance: Appearance, textSize: TextSize, relock: Relock) {
        self.appearance = appearance
        self.textSize = textSize
        self.relock = relock
    }

    private enum CodingKeys: String, CodingKey { case appearance, textSize, relock }

    /// Each field on its own, so one unreadable value (a newer build's, or damage) costs only that field.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        appearance = (try? container.decode(Appearance.self, forKey: .appearance)) ?? Self.standard.appearance
        textSize = (try? container.decode(TextSize.self, forKey: .textSize)) ?? Self.standard.textSize
        relock = (try? container.decode(Relock.self, forKey: .relock)) ?? Self.unreadableRelock
    }

    /// The stored bytes, or the defaults when nothing was stored. Bytes that are not even an object keep the strict relock.
    public static func restore(from data: Data?) -> Preferences {
        guard let data else { return .standard }
        return (try? JSONDecoder().decode(Preferences.self, from: data))
            ?? Preferences(appearance: standard.appearance, textSize: standard.textSize, relock: unreadableRelock)
    }

    /// `setPreference { name, value }`: one choice from the web. An unknown name or value is a malformed request.
    public mutating func set(_ name: String, to value: JSONValue) throws {
        guard case .string(let raw) = value else { throw BridgeError.malformed }
        switch name {
        case "appearance": appearance = try Self.choice(raw)
        case "textSize": textSize = try Self.choice(raw)
        case "relock": relock = try Self.choice(raw)
        default: throw BridgeError.malformed
        }
    }

    private static func choice<T: RawRepresentable>(_ raw: String) throws -> T where T.RawValue == String {
        guard let value = T(rawValue: raw) else { throw BridgeError.malformed }
        return value
    }
}

public struct Lifecycle: Codable, Equatable, Sendable {
    public var visible: Bool
    public var online: Bool
    public var locked: Bool
    public var covered: Bool

    public init(visible: Bool, online: Bool, locked: Bool, covered: Bool) {
        self.visible = visible
        self.online = online
        self.locked = locked
        self.covered = covered
    }
}

public enum FocusMode: String, Codable, Equatable, Sendable {
    case hidden, terminal, line, webText, select
}

public struct TextRange: Codable, Equatable, Sendable {
    public var start: Int
    public var end: Int

    public init(start: Int, end: Int) {
        self.start = start
        self.end = end
    }
}

public struct NativeLineSnapshot: Codable, Equatable, Sendable {
    public var tab: TabKey
    public var gen: Int
    public var text: String
    public var selection: TextRange
    public var marked: TextRange?

    public init(tab: TabKey, gen: Int, text: String, selection: TextRange, marked: TextRange?) {
        self.tab = tab
        self.gen = gen
        self.text = text
        self.selection = selection
        self.marked = marked
    }

    private enum CodingKeys: String, CodingKey { case tab, gen, text, selection, marked }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(tab, forKey: .tab)
        try container.encode(gen, forKey: .gen)
        try container.encode(text, forKey: .text)
        try container.encode(selection, forKey: .selection)
        try container.encode(marked, forKey: .marked)
    }
}

public struct SessionRef: Codable, Equatable, Hashable, Sendable {
    public var server: String
    public var session: Int

    public init(server: String, session: Int) {
        self.server = server
        self.session = session
    }
}

public struct TabKey: Codable, Equatable, Hashable, Sendable {
    public var host: String
    public var session: SessionRef

    public init(host: String, session: SessionRef) {
        self.host = host
        self.session = session
    }
}

/// The web Platform host representation. `handle` is the host id used to resolve
/// `tether-app://h-<handle>`; `baseURL` stays in the native HostStore.
public struct PlatformHost: Codable, Equatable, Sendable {
    public var handle: String
    public var hostId: String?
    public var name: String?
    public var pageOrigin: String?

    public init(handle: String, hostId: String?, name: String?, pageOrigin: String? = nil) {
        self.handle = handle
        self.hostId = hostId
        self.name = name
        self.pageOrigin = pageOrigin
    }

    private enum CodingKeys: String, CodingKey { case handle, hostId, name, pageOrigin }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(handle, forKey: .handle)
        if let hostId { try container.encode(hostId, forKey: .hostId) } else { try container.encodeNil(forKey: .hostId) }
        if let name { try container.encode(name, forKey: .name) } else { try container.encodeNil(forKey: .name) }
        if let pageOrigin { try container.encode(pageOrigin, forKey: .pageOrigin) } else { try container.encodeNil(forKey: .pageOrigin) }
    }
}

public struct Boot: Codable, Equatable, Sendable {
    public var bridgeVersion: Int
    public var hosts: [PlatformHost]
    /// The saved workspace exactly as the web wrote it: native never reads its fields, so a newer web build's version round-trips.
    public var workspace: JSONValue?
    public var viewport: Viewport
    public var preferences: Preferences
    public var lifecycle: Lifecycle
    public var focusMode: FocusMode
    public var lineSnapshot: NativeLineSnapshot?

    public init(bridgeVersion: Int = BridgeContract.version, hosts: [PlatformHost], workspace: JSONValue?, viewport: Viewport, preferences: Preferences, lifecycle: Lifecycle, focusMode: FocusMode, lineSnapshot: NativeLineSnapshot? = nil) {
        self.bridgeVersion = bridgeVersion
        self.hosts = hosts
        self.workspace = workspace
        self.viewport = viewport
        self.preferences = preferences
        self.lifecycle = lifecycle
        self.focusMode = focusMode
        self.lineSnapshot = lineSnapshot
    }

    private enum CodingKeys: String, CodingKey { case bridgeVersion, hosts, workspace, viewport, preferences, lifecycle, focusMode, lineSnapshot }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(bridgeVersion, forKey: .bridgeVersion)
        try container.encode(hosts, forKey: .hosts)
        if let workspace { try container.encode(workspace, forKey: .workspace) } else { try container.encodeNil(forKey: .workspace) }
        try container.encode(viewport, forKey: .viewport)
        try container.encode(preferences, forKey: .preferences)
        try container.encode(lifecycle, forKey: .lifecycle)
        try container.encode(focusMode, forKey: .focusMode)
        if let lineSnapshot { try container.encode(lineSnapshot, forKey: .lineSnapshot) } else { try container.encodeNil(forKey: .lineSnapshot) }
    }
}

public struct DraftRecord: Codable, Equatable, Sendable {
    public var key: TabKey
    public var text: String
    public var revision: Int
    public var editedAt: Double

    public init(key: TabKey, text: String, revision: Int, editedAt: Double) {
        self.key = key
        self.text = text
        self.revision = revision
        self.editedAt = editedAt
    }
}

public struct Rect: Codable, Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public struct HostEntry: Codable, Equatable, Sendable {
    public var id: String
    public var name: String
    public var baseURL: String

    public init(id: String, name: String, baseURL: String) {
        self.id = id
        self.name = name
        self.baseURL = baseURL
    }

    public var platformHost: PlatformHost {
        PlatformHost(handle: id, hostId: id, name: name)
    }
}
