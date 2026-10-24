import Foundation
import LocalAuthentication
import Security
import TetherKit

final class TokenStore: @unchecked Sendable {
    enum StoreError: Error {
        case accessControl, invalidTokens, keychain(OSStatus), locked

        var unlockMessage: String? {
            switch self {
            case .keychain(let status) where status == errSecUserCanceled: nil
            case .keychain(let status) where status == errSecAuthFailed: "Face ID couldn't verify you. Try again."
            case .keychain(let status):
                "Couldn't unlock tether (Keychain error \(status)). Try again, or reset tokens if Face ID changed."
            case .invalidTokens:
                "The stored token map is invalid. Reset tokens and enrol your servers again."
            case .accessControl:
                "This device couldn't create secure token storage."
            case .locked:
                "Unlock tether before changing stored tokens."
            }
        }
    }

    struct UnlockResult: @unchecked Sendable {
        let tokens: [String: String]
        let context: LAContext
    }

    private let service = "tether.tokens"
    private let account = "host-token-map"
    private let keychainQueue = DispatchQueue(label: "com.jimmyyao.tether.keychain", qos: .userInitiated)

    func readAll(localizedReason: String) async throws -> UnlockResult? {
        try await perform { [self] in
            let context = LAContext()
            context.localizedReason = localizedReason
            do {
                guard let tokens = try readAll(context: context) else {
                    context.invalidate()
                    return nil
                }
                return UnlockResult(tokens: tokens, context: context)
            } catch {
                context.invalidate()
                throw error
            }
        }
    }

    func save(_ tokens: [String: String], context: LAContext?) async throws {
        try Self.validate(tokens)
        guard !tokens.isEmpty else { try await deleteAll(context: context); return }
        let data = try JSONEncoder().encode(tokens)
        try await perform { [self] in
            var query = itemQuery
            if let context { query[kSecUseAuthenticationContext as String] = context }
            let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
            if status == errSecItemNotFound {
                let access = try accessControl()
                var addQuery = itemQuery
                addQuery[kSecAttrAccessControl as String] = access
                addQuery[kSecValueData as String] = data
                let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
                guard addStatus == errSecSuccess else { throw StoreError.keychain(addStatus) }
            } else if status != errSecSuccess {
                throw StoreError.keychain(status)
            }
        }
    }

    func deleteAll(context: LAContext?) async throws {
        try await perform { [self] in
            var query = itemQuery
            if let context { query[kSecUseAuthenticationContext as String] = context }
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw StoreError.keychain(status) }
        }
    }

    private func perform<Value>(_ operation: @escaping () throws -> Value) async throws -> Value {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Value, Error>) in
            keychainQueue.async {
                do {
                    continuation.resume(returning: try operation())
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private func readAll(context: LAContext) throws -> [String: String]? {
        var query = itemQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = context

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw StoreError.keychain(status) }
        let tokens = try JSONDecoder().decode([String: String].self, from: data)
        try Self.validate(tokens)
        return tokens
    }

    private func accessControl() throws -> SecAccessControl {
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            .biometryCurrentSet,
            &error
        ) else { throw StoreError.accessControl }
        return access
    }

    private var itemQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static func validate(_ tokens: [String: String]) throws {
        guard tokens.allSatisfy({ AuthInfo.validHostID($0.key) && !$0.value.isEmpty }) else {
            throw StoreError.invalidTokens
        }
    }
}
