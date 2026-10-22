import Foundation
import LocalAuthentication
import Security

/// Part B: the Face ID-gated Keychain item auth.md specifies, a generic
/// password with `.biometryCurrentSet` and
/// `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`.
///
/// Every function blocks while Face ID shows, so callers run them off the main
/// thread.
enum KeychainCheck {
    struct Outcome: Sendable {
        let op: String
        let status: OSStatus
        let ms: Double
        let detail: String

        var message: String {
            (SecCopyErrorMessageString(status, nil) as String?) ?? "OSStatus \(status)"
        }
    }

    private static let service = "tether.spike.tokens"
    private static let account = "all-hosts"

    /// B1: delete any item left from an earlier run, then add.
    nonisolated static func runAdd() -> [Outcome] {
        [delete(), add()]
    }

    /// B2 and B3: read (one Face ID prompt), delete, add with new data.
    nonisolated static func runReadDeleteAdd() -> [Outcome] {
        [read(), delete(), add()]
    }

    private nonisolated static func add() -> Outcome {
        let started = Date()
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &error
        ) else {
            let reason = error.map { "\($0.takeRetainedValue())" } ?? "unknown"
            return Outcome(op: "add", status: errSecParam, ms: 0, detail: "SecAccessControlCreateWithFlags failed: \(reason)")
        }
        let token = UUID().uuidString
        let data = Data("{\"spike-host\":\"\(token)\"}".utf8)
        let attributes: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessControl as String: access,
            kSecValueData as String: data,
        ]
        let status = SecItemAdd(attributes as CFDictionary, nil)
        return Outcome(op: "add", status: status, ms: msSince(started), detail: "wrote token \(token.prefix(8))…")
    }

    private nonisolated static func read() -> Outcome {
        let started = Date()
        let context = LAContext()
        context.localizedReason = "Unlock tether"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationContext as String: context,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        let detail: String
        if let data = item as? Data {
            detail = "read \(data.count) bytes: \(String(decoding: data, as: UTF8.self))"
        } else {
            detail = "no data"
        }
        return Outcome(op: "read", status: status, ms: msSince(started), detail: detail)
    }

    private nonisolated static func delete() -> Outcome {
        let started = Date()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        return Outcome(op: "delete", status: status, ms: msSince(started), detail: "")
    }

    private nonisolated static func msSince(_ start: Date) -> Double {
        Date().timeIntervalSince(start) * 1000
    }
}
