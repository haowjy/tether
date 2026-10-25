import Foundation

public enum DaemonProtocol {
    public static let version = 1
}

public struct AuthInfo: Codable, Equatable, Sendable {
    public var hostId: String
    public var name: String
    public var daemonVersion: String
    public var protocolRange: ProtocolRange
    public var browserOrigin: String?
    public var browserRefused: String?
    public var browserPending: Bool

    enum CodingKeys: String, CodingKey {
        case hostId, name, daemonVersion
        case protocolRange = "protocol"
        case browserOrigin, browserRefused, browserPending
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        hostId = try container.decode(String.self, forKey: .hostId)
        name = try container.decode(String.self, forKey: .name)
        daemonVersion = try container.decode(String.self, forKey: .daemonVersion)
        protocolRange = try container.decode(ProtocolRange.self, forKey: .protocolRange)
        browserOrigin = try container.decodeIfPresent(String.self, forKey: .browserOrigin)
        browserRefused = try container.decodeIfPresent(String.self, forKey: .browserRefused)
        browserPending = try container.decodeIfPresent(Bool.self, forKey: .browserPending) ?? false
    }

    public static func validHostID(_ value: String) -> Bool {
        value.utf8.count == 16 && value.utf8.allSatisfy { byte in
            (97...122).contains(byte) || (50...55).contains(byte)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(hostId, forKey: .hostId)
        try container.encode(name, forKey: .name)
        try container.encode(daemonVersion, forKey: .daemonVersion)
        try container.encode(protocolRange, forKey: .protocolRange)
        if let browserOrigin { try container.encode(browserOrigin, forKey: .browserOrigin) }
        else { try container.encodeNil(forKey: .browserOrigin) }
        if let browserRefused { try container.encode(browserRefused, forKey: .browserRefused) }
        else { try container.encodeNil(forKey: .browserRefused) }
        try container.encode(browserPending, forKey: .browserPending)
    }
}

public struct ProtocolRange: Codable, Equatable, Sendable {
    public var min: Int
    public var max: Int

    public func contains(_ version: Int) -> Bool { min <= version && version <= max }
}

public struct EnrollRequest: Codable, Equatable, Sendable {
    public var code: String
    public var deviceName: String

    public init(code: String, deviceName: String) {
        self.code = code
        self.deviceName = deviceName
    }
}

public struct EnrollResponse: Codable, Equatable, Sendable {
    public var token: String
    public var deviceName: String
}

public struct ErrorNode: Codable, Equatable, Sendable {
    public var name: String
}

public struct ErrorBody: Codable, Equatable, Sendable {
    public var error: String
    public var reason: String?
    public var node: ErrorNode?
}
