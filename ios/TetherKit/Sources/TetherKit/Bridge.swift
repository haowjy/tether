import Foundation

public enum BridgeDirection: String, Codable, Sendable {
    case webToNative
    case nativeToWeb
}

public enum BridgeMessageType: String, CaseIterable, Codable, Sendable {
    case ready, socket, hostRejected, recreateWebView, saveWorkspace, focus, activeTab
    case lineSet, lineCaret, lineCaretStep, lineInsert, lineSubmit, lineSelectAll, modifiers, lineEdit, lineReturn
    case draftGet, draftPut, draftDelete, draftList, copy, readPasteboard, haptic
    case pickMedia, playVideo, manageHosts, openURL, ack
    case input, viewport, lifecycle, hosts, upload

    public var direction: BridgeDirection {
        switch self {
        case .input, .lineEdit, .lineReturn, .viewport, .lifecycle, .hosts, .upload: .nativeToWeb
        default: .webToNative
        }
    }

    var requiredFields: Set<String> {
        switch self {
        case .ready, .recreateWebView, .draftList, .manageHosts: []
        case .pickMedia: ["id", "host"]
        case .socket: ["host"]
        case .hostRejected: ["host", "token"]
        case .saveWorkspace: ["workspace"]
        case .focus: ["mode"]
        case .activeTab: ["tab"]
        case .lineSet: ["text", "caret", "tab"]
        case .lineCaret: ["index"]
        case .lineCaretStep: ["step"]
        case .lineInsert: ["text"]
        case .lineSubmit, .lineSelectAll: []
        case .modifiers: ["armed"]
        case .lineEdit: ["gen", "text", "tab", "selection", "marked"]
        case .lineReturn: ["gen", "text", "tab"]
        case .draftGet, .draftDelete: ["key"]
        case .readPasteboard: ["tab", "id"]
        case .draftPut: ["record", "baseRevision"]
        case .copy: ["text"]
        case .haptic: ["kind"]
        case .playVideo: ["host", "path"]
        case .openURL: ["url"]
        case .ack: ["id"]
        case .input: ["tab", "events"]
        case .viewport: ["viewport"]
        case .lifecycle: ["lifecycle"]
        case .hosts: ["hosts"]
        case .upload: ["id", "progress"]
        }
    }
}

/// A JSON value that preserves the bridge's flat `{ type, ...fields }` wire shape.
public enum JSONValue: Codable, Equatable, Sendable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    public subscript(_ key: String) -> JSONValue? {
        guard case .object(let fields) = self else { return nil }
        return fields[key]
    }

    public func decode<T: Decodable>(_ type: T.Type) throws -> T {
        try JSONDecoder().decode(type, from: JSONEncoder().encode(self))
    }

    public static func encode<T: Encodable>(_ value: T) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
    }
}

private struct DynamicKey: CodingKey, Hashable {
    var stringValue: String
    var intValue: Int? { nil }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}

/// One validated, flat bridge message. Payload fields are represented as JSON so the
/// app can route a message without a duplicate transport DTO for every Platform type.
public struct BridgeMessage: Codable, Equatable, Sendable {
    public let type: BridgeMessageType
    public let fields: [String: JSONValue]

    public init(type: BridgeMessageType, fields: [String: JSONValue] = [:]) throws {
        self.type = type
        self.fields = fields
        try validate()
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: DynamicKey.self)
        guard let typeKey = DynamicKey(stringValue: "type") else { throw BridgeError.malformed }
        type = try container.decode(BridgeMessageType.self, forKey: typeKey)
        var decoded: [String: JSONValue] = [:]
        for key in container.allKeys where key.stringValue != "type" {
            decoded[key.stringValue] = try container.decode(JSONValue.self, forKey: key)
        }
        fields = decoded
        try validate()
    }

    public func encode(to encoder: Encoder) throws {
        try validate()
        var container = encoder.container(keyedBy: DynamicKey.self)
        guard let typeKey = DynamicKey(stringValue: "type") else { throw BridgeError.malformed }
        try container.encode(type, forKey: typeKey)
        for (name, value) in fields {
            guard let key = DynamicKey(stringValue: name) else { throw BridgeError.malformed }
            try container.encode(value, forKey: key)
        }
    }

    public func field<T: Decodable>(_ name: String, as type: T.Type = T.self) throws -> T {
        guard let value = fields[name] else { throw BridgeError.missingField(name) }
        return try value.decode(type)
    }

    private func validate() throws {
        let missing = type.requiredFields.subtracting(fields.keys)
        guard missing.isEmpty else { throw BridgeError.missingField(missing.sorted().joined(separator: ", ")) }
    }
}

public enum BridgeError: Error, Equatable {
    case malformed
    case missingField(String)
}

public enum SocketReply: Codable, Equatable, Sendable {
    case socket(url: String, token: String)
    case locked
    case notEnrolled

    private enum Keys: String, CodingKey { case url, token, locked, notEnrolled }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        if let url = try container.decodeIfPresent(String.self, forKey: .url),
           let token = try container.decodeIfPresent(String.self, forKey: .token) {
            self = .socket(url: url, token: token)
        }
        else if try container.decodeIfPresent(Bool.self, forKey: .locked) == true { self = .locked }
        else if try container.decodeIfPresent(Bool.self, forKey: .notEnrolled) == true { self = .notEnrolled }
        else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid socket reply")) }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        switch self {
        case .socket(let url, let token):
            try container.encode(url, forKey: .url)
            try container.encode(token, forKey: .token)
        case .locked: try container.encode(true, forKey: .locked)
        case .notEnrolled: try container.encode(true, forKey: .notEnrolled)
        }
    }
}

public enum DraftPutReply: String, Codable, Sendable { case ok, conflict, failed }

public enum PasteboardReply: Codable, Equatable, Sendable {
    case text(String)
    case uploading(String)
    case empty
    case denied

    public init(from decoder: Decoder) throws {
        if let value = try? JSONValue(from: decoder) {
            if case .string(let text) = value, text == "empty" { self = .empty; return }
            if case .string(let text) = value, text == "denied" { self = .denied; return }
            if case .object(let fields) = value {
                if case .string(let text)? = fields["text"] { self = .text(text); return }
                if case .string(let id)? = fields["uploading"] { self = .uploading(id); return }
            }
        }
        throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid pasteboard reply"))
    }

    public func encode(to encoder: Encoder) throws {
        let value: JSONValue
        switch self {
        case .text(let text): value = .object(["text": .string(text)])
        case .uploading(let id): value = .object(["uploading": .string(id)])
        case .empty: value = .string("empty")
        case .denied: value = .string("denied")
        }
        try value.encode(to: encoder)
    }
}
