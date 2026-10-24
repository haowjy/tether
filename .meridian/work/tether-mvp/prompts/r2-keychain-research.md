Answer, with sources (Apple docs, Apple Developer Forums posts by Apple staff e.g. Quinn "The Eskimo", reputable blog posts), these iOS Keychain questions. Be concrete; say when evidence is thin.

1. For a kSecClassGenericPassword item added with kSecAttrAccessControl = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, ...): does `SecItemUpdate(query, [kSecValueData: newData])` WITHOUT kSecUseAuthenticationContext trigger a Face ID / Touch ID prompt (or fail with errSecInteractionNotAllowed / errSecAuthFailed)? Does SecItemDelete prompt? Does SecItemAdd prompt?
2. If an LAContext was used for a successful SecItemCopyMatching read, can it be reused (kSecUseAuthenticationContext) for later SecItemUpdate without a new prompt, and for how long (touchIDAuthenticationAllowableReuseDuration)?
3. What does SecItemAdd return for a .biometryCurrentSet access-control item when the device has a passcode but NO biometry enrolled (or on the iOS Simulator with Face ID not enrolled)?
4. When reading a .biometryCurrentSet item, does the system prompt allow passcode fallback? (I believe not — confirm.)
5. Does SecItemCopyMatching with an auth UI block the calling thread, and is calling it on a background queue the recommended practice?

Write nothing to the repo. Report findings with links.
