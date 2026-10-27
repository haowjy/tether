import Foundation

public enum BridgeContract {
    public static let version = 5
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

public struct WorkspaceTab: Codable, Equatable, Sendable {
    public var key: TabKey
    public var session: String
    public var window: String

    public init(key: TabKey, session: String, window: String) {
        self.key = key
        self.session = session
        self.window = window
    }
}

public struct FilesPlace: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable { case roots, dir, file }
    public var kind: Kind
    public var path: String?

    public init(kind: Kind, path: String? = nil) {
        self.kind = kind
        self.path = path
    }
}

public struct SavedFilesPlace: Codable, Equatable, Sendable {
    public var hostId: String
    public var place: FilesPlace

    public init(hostId: String, place: FilesPlace) {
        self.hostId = hostId
        self.place = place
    }
}

public struct SavedWorkspace: Codable, Equatable, Sendable {
    public var version: Int
    public var tabs: [WorkspaceTab]
    public var active: String?
    public var files: SavedFilesPlace?
    public var hostName: String?

    public init(
        version: Int = 2,
        tabs: [WorkspaceTab] = [],
        active: String? = nil,
        files: SavedFilesPlace? = nil,
        hostName: String? = nil
    ) {
        self.version = version
        self.tabs = tabs
        self.active = active
        self.files = files
        self.hostName = hostName
    }

    private enum CodingKeys: String, CodingKey { case version, tabs, active, files, hostName }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(tabs, forKey: .tabs)
        if let active { try container.encode(active, forKey: .active) } else { try container.encodeNil(forKey: .active) }
        if let files { try container.encode(files, forKey: .files) } else { try container.encodeNil(forKey: .files) }
        try container.encodeIfPresent(hostName, forKey: .hostName)
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
    public var workspace: SavedWorkspace?
    public var viewport: Viewport
    public var lifecycle: Lifecycle
    public var focusMode: FocusMode
    public var lineSnapshot: NativeLineSnapshot?

    public init(bridgeVersion: Int = BridgeContract.version, hosts: [PlatformHost], workspace: SavedWorkspace?, viewport: Viewport, lifecycle: Lifecycle, focusMode: FocusMode, lineSnapshot: NativeLineSnapshot? = nil) {
        self.bridgeVersion = bridgeVersion
        self.hosts = hosts
        self.workspace = workspace
        self.viewport = viewport
        self.lifecycle = lifecycle
        self.focusMode = focusMode
        self.lineSnapshot = lineSnapshot
    }

    private enum CodingKeys: String, CodingKey { case bridgeVersion, hosts, workspace, viewport, lifecycle, focusMode, lineSnapshot }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(bridgeVersion, forKey: .bridgeVersion)
        try container.encode(hosts, forKey: .hosts)
        if let workspace { try container.encode(workspace, forKey: .workspace) } else { try container.encodeNil(forKey: .workspace) }
        try container.encode(viewport, forKey: .viewport)
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
