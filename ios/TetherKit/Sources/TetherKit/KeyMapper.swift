import Foundation

public struct KeyModifiers: OptionSet, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }
    public static let control = KeyModifiers(rawValue: 1 << 0)
    public static let option = KeyModifiers(rawValue: 1 << 1)
    public static let shift = KeyModifiers(rawValue: 1 << 2)
    public static let command = KeyModifiers(rawValue: 1 << 3)
}

public struct HardwareKey: Sendable {
    public let code: String
    public let charactersIgnoringModifiers: String
    public let modifiers: KeyModifiers

    public init(code: String, charactersIgnoringModifiers: String, modifiers: KeyModifiers = []) {
        self.code = code
        self.charactersIgnoringModifiers = charactersIgnoringModifiers
        self.modifiers = modifiers
    }
}

public enum KeyMapper {
    /// Maps a hardware key press to the daemon's tmux key vocabulary. Printable text
    /// without a terminal modifier stays on UIKeyInput.insertText instead.
    public static func event(for key: HardwareKey) -> InputEvent? {
        let name: String
        switch key.code {
        case "escape": name = "Escape"
        case "tab": name = "Tab"
        case "return": name = "Enter"
        case "delete": name = "BSpace"
        case "up": name = "Up"
        case "down": name = "Down"
        case "left": name = "Left"
        case "right": name = "Right"
        case "home": name = "Home"
        case "end": name = "End"
        case "pageUp": name = "PageUp"
        case "pageDown": name = "PageDown"
        case "f1": name = "F1"
        case "f2": name = "F2"
        case "f3": name = "F3"
        case "f4": name = "F4"
        case "f5": name = "F5"
        case "f6": name = "F6"
        case "f7": name = "F7"
        case "f8": name = "F8"
        case "f9": name = "F9"
        case "f10": name = "F10"
        case "f11": name = "F11"
        case "f12": name = "F12"
        default:
            guard key.charactersIgnoringModifiers.count == 1,
                  let character = key.charactersIgnoringModifiers.first,
                  character.isASCII else { return nil }
            if key.modifiers.contains(.command) { return nil }
            if character == " ", key.modifiers == .control { return .key("C-Space") }
            if let byte = controlByte(for: character), key.modifiers.contains(.control) {
                let data = Data(key.modifiers.contains(.option) ? [0x1b, byte] : [byte])
                return .bytes(data.base64EncodedString())
            }
            if character == " ", key.modifiers.contains(.option) { return .key("M-Space") }
            if key.modifiers.contains(.option), isPrintableASCIINonAlphanumeric(character) {
                var data = Data([0x1b])
                data.append(contentsOf: String(character).utf8)
                return .bytes(data.base64EncodedString())
            }
            guard character.isLetter || character.isNumber else { return nil }
            var prefix = ""
            if key.modifiers.contains(.control) { prefix += "C-" }
            if key.modifiers.contains(.option) { prefix += "M-" }
            guard !prefix.isEmpty else { return nil }
            let letter = String(character)
            let mapped = prefix + (key.modifiers.contains(.shift) && character.isLetter ? letter.uppercased() : letter.lowercased())
            return .key(mapped)
        }

        if key.modifiers.contains(.command) { return nil }
        if name == "Enter", key.modifiers == .shift {
            return .bytes("G1sxMzsydQ==") // CSI-u Shift+Enter: ESC [ 13 ; 2 u
        }
        var modifiers: [String] = []
        if key.modifiers.contains(.control) { modifiers.append("C") }
        if key.modifiers.contains(.option) { modifiers.append("M") }
        if key.modifiers.contains(.shift), shiftableNames.contains(name) { modifiers.append("S") }
        if name == "Tab", key.modifiers.contains(.shift) { return .key("BTab") }
        return .key(modifiers.isEmpty ? name : modifiers.joined(separator: "-") + "-" + name)
    }

    private static func controlByte(for character: Character) -> UInt8? {
        guard let byte = character.asciiValue else { return nil }
        switch byte {
        case 0x2f: return 0x1f // Ctrl+/ is the same terminal byte as Ctrl+_
        case 0x3f: return 0x7f
        case 0x5b...0x5f: return byte & 0x1f
        default: return nil
        }
    }

    private static func isPrintableASCIINonAlphanumeric(_ character: Character) -> Bool {
        guard let byte = character.asciiValue, (0x20...0x7e).contains(byte) else { return false }
        return !((0x30...0x39).contains(byte) || (0x41...0x5a).contains(byte) || (0x61...0x7a).contains(byte))
    }

    private static let shiftableNames = Set([
        "Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown", "IC", "DC",
    ] + (1...12).map { "F\($0)" })
}

public enum InputEvent: Codable, Equatable, Sendable {
    case text(String)
    case key(String)
    case bytes(String)
    case paste(String)

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let value = try container.decodeIfPresent(String.self, forKey: .text) { self = .text(value) }
        else if let value = try container.decodeIfPresent(String.self, forKey: .key) { self = .key(value) }
        else if let value = try container.decodeIfPresent(String.self, forKey: .bytes) { self = .bytes(value) }
        else if let value = try container.decodeIfPresent(String.self, forKey: .paste) { self = .paste(value) }
        else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid input event")) }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .text(let value): try container.encode(value, forKey: .text)
        case .key(let value): try container.encode(value, forKey: .key)
        case .bytes(let value): try container.encode(value, forKey: .bytes)
        case .paste(let value): try container.encode(value, forKey: .paste)
        }
    }

    private enum CodingKeys: String, CodingKey { case text, key, bytes, paste }
}
