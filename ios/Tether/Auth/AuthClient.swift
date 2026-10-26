import Foundation
import TetherKit

struct AuthClient {
    enum Failure: LocalizedError {
        case invalidServer
        case incompatible
        case response
        case phoneNotEnrolled
        case server(String)

        var errorDescription: String? {
            switch self {
            case .invalidServer: "Enter a valid HTTPS server address."
            case .incompatible: "This server does not support this client protocol."
            case .response: "The server returned an unreadable response."
            case .phoneNotEnrolled: "This phone is not enrolled yet. Run `tether enroll` on the server for a code."
            case .server(let message): message
            }
        }
    }

    struct EnrolledHost {
        let entry: HostEntry
        let token: String
    }

    private let session: URLSession
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.httpShouldSetCookies = false
        session = URLSession(configuration: configuration)
    }

    func enroll(server: String, code: String, deviceName: String) async throws -> EnrolledHost {
        let baseURL = try Self.serverURL(server)
        let info: AuthInfo = try await request("auth/info", from: baseURL)
        guard AuthInfo.validHostID(info.hostId), !info.name.isEmpty else { throw Failure.response }
        guard info.protocolRange.contains(DaemonProtocol.version) else { throw Failure.incompatible }

        let token: String
        if code.isEmpty {
            token = try await mintNodeToken(from: baseURL, deviceName: deviceName)
        } else {
            _ = try await postNodeEnrollment(code: code, deviceName: deviceName, to: baseURL)
            do {
                token = try await mintNodeToken(from: baseURL, deviceName: deviceName)
            } catch {
                // The code request already enrolled the node; retry only the mint, never the code.
                token = try await mintNodeToken(from: baseURL, deviceName: deviceName)
            }
        }

        return EnrolledHost(entry: HostEntry(id: info.hostId, name: info.name, baseURL: baseURL.absoluteString), token: token)
    }

    private func mintNodeToken(from baseURL: URL, deviceName: String) async throws -> String {
        let data = try await postNodeEnrollment(code: "", deviceName: deviceName, to: baseURL)
        return try decoder.decode(EnrollResponse.self, from: data).token
    }

    private func postNodeEnrollment(code: String, deviceName: String, to baseURL: URL) async throws -> Data {
        var request = URLRequest(url: baseURL.appending(path: "auth/node/enroll"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(EnrollRequest(code: code, deviceName: deviceName))
        // `Origin` is what the node lane checks. Native URLSession adds no fetch metadata;
        // the empty-code branch refuses it to keep browser script from minting a token.
        request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw Failure.response }
        if code.isEmpty, response.statusCode == 401,
           let body = try? decoder.decode(ErrorBody.self, from: data), body.error == "not_enrolled" {
            throw Failure.phoneNotEnrolled
        }
        guard response.statusCode == 200 else { throw errorMessage(from: data) }
        return data
    }

    private func request<T: Decodable>(_ path: String, from baseURL: URL) async throws -> T {
        let (data, response) = try await session.data(from: baseURL.appending(path: path))
        guard let response = response as? HTTPURLResponse else { throw Failure.response }
        guard response.statusCode == 200 else { throw errorMessage(from: data) }
        return try decoder.decode(T.self, from: data)
    }

    private func errorMessage(from data: Data) -> Failure {
        guard let body = try? decoder.decode(ErrorBody.self, from: data) else { return .response }
        // The body names an error code, not a sentence: the two a reader can act on get one.
        switch body.error {
        case "bad_code":
            return .server("That code is wrong or has expired.")
        case "node_refused":
            return .server(["This device can't use tether on this server.", body.reason].compactMap { $0 }.joined(separator: " "))
        default:
            return .server(body.error)
        }
    }

    static func serverURL(_ input: String) throws -> URL {
        let value = input.contains("://") ? input : "https://\(input)"
        guard var components = URLComponents(string: value),
              components.scheme?.lowercased() == "https",
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              components.path.isEmpty || components.path == "/" else { throw Failure.invalidServer }
        components.scheme = "https"
        if components.port == 443 { components.port = nil }
        components.path = ""
        guard let url = components.url else { throw Failure.invalidServer }
        return url
    }

}
