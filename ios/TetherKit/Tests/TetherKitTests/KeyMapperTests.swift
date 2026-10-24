import Foundation
import XCTest
@testable import TetherKit

final class KeyMapperTests: XCTestCase {
    func testEveryKeyCodeAndModifierSetEmitsOnlyDaemonKeyNames() {
        let modifierSets = (0..<16).map(KeyModifiers.init(rawValue:))
        for (code, characters) in keyCodes {
            for modifiers in modifierSets {
                guard case .key(let name)? = KeyMapper.event(for: HardwareKey(
                    code: code,
                    charactersIgnoringModifiers: characters,
                    modifiers: modifiers
                )) else { continue }
                XCTAssertTrue(
                    daemonAllowsKeyName(name),
                    "KeyMapper emitted \(name) for \(code), modifiers 0x\(String(modifiers.rawValue, radix: 16))"
                )
            }
        }
    }

    func testOptionMapsEveryPrintableASCIINonAlphanumericToMetaBytes() {
        for byte in UInt8(0x21)...UInt8(0x7e) where !isASCIIAlphanumeric(byte) {
            let character = Character(UnicodeScalar(byte))
            let expected = Data([0x1b, byte]).base64EncodedString()
            XCTAssertEqual(
                KeyMapper.event(for: HardwareKey(code: String(character), charactersIgnoringModifiers: String(character), modifiers: .option)),
                .bytes(expected),
                "Option+\(character)"
            )
        }
        XCTAssertEqual(
            KeyMapper.event(for: HardwareKey(code: " ", charactersIgnoringModifiers: " ", modifiers: .option)),
            .key("M-Space")
        )
    }

    func testShiftEnterUsesTheRawCSIuBytesFromTheContract() {
        let key = HardwareKey(code: "return", charactersIgnoringModifiers: "\r", modifiers: .shift)
        XCTAssertEqual(KeyMapper.event(for: key), .bytes("G1sxMzsydQ=="))
    }

    func testUnmodifiedPrintableKeysStayOnUIKeyInput() {
        XCTAssertNil(KeyMapper.event(for: HardwareKey(code: "a", charactersIgnoringModifiers: "a")))
    }

    private var keyCodes: [(String, String)] {
        let named = [
            ("escape", "\u{1b}"), ("tab", "\t"), ("return", "\r"), ("delete", "\u{7f}"),
            ("up", "\u{f700}"), ("down", "\u{f701}"), ("left", "\u{f702}"), ("right", "\u{f703}"),
            ("home", "\u{f729}"), ("end", "\u{f72b}"), ("pageUp", "\u{f72c}"), ("pageDown", "\u{f72d}"),
        ] + (1...12).map { ("f\($0)", "") }
        let printable = (UInt8(0x20)...UInt8(0x7e)).map { byte -> (String, String) in
            let character = Character(UnicodeScalar(byte))
            let value = String(character)
            return (isASCIILetter(byte) ? value.lowercased() : value, value)
        }
        return named + printable
    }

    // Faithful copy of src/tmux/command.rs:is_key_name; keep this acceptance rule in sync.
    private func daemonAllowsKeyName(_ name: String) -> Bool {
        var key = name
        while key.hasPrefix("C-") || key.hasPrefix("M-") {
            key.removeFirst(2)
        }

        let named = ["Enter", "Escape", "Tab", "BTab", "BSpace", "Space"]
        let bytes = Array(key.utf8)
        if named.contains(key) || (bytes.count == 1 && isASCIIAlphanumeric(bytes[0])) { return true }

        if key.hasPrefix("S-") { key.removeFirst(2) }
        let shiftable = ["Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown", "IC", "DC"]
        if shiftable.contains(key) { return true }
        guard key.first == "F" else { return false }
        let suffix = key.dropFirst()
        guard let number = Int(suffix), (1...12).contains(number) else { return false }
        return String(number) == suffix
    }

    private func isASCIIAlphanumeric(_ byte: UInt8) -> Bool {
        (0x30...0x39).contains(byte) || isASCIILetter(byte)
    }

    private func isASCIILetter(_ byte: UInt8) -> Bool {
        (0x41...0x5a).contains(byte) || (0x61...0x7a).contains(byte)
    }
}
