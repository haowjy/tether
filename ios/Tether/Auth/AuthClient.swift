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

        let nodeEnrollment = code.isEmpty
        var request = URLRequest(url: baseURL.appending(path: nodeEnrollment ? "auth/node/enroll" : "auth/enroll"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try encoder.encode(EnrollRequest(code: code, deviceName: deviceName))
        if nodeEnrollment {
            // `Origin` is what the node lane checks. No `Sec-Fetch-*`: the daemon refuses the
            // mint to anything carrying browser fetch metadata, which is how browser script on
            // tether's own origin is kept out of it (auth.md, "minting").
            request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
        }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw Failure.response }
        if nodeEnrollment, response.statusCode == 401,
           let body = try? decoder.decode(ErrorBody.self, from: data), body.error == "not_enrolled" {
            throw Failure.phoneNotEnrolled
        }
        guard response.statusCode == 200 else { throw errorMessage(from: data) }
        let enrolled = try decoder.decode(EnrollResponse.self, from: data)
        return EnrolledHost(entry: HostEntry(id: info.hostId, name: info.name, baseURL: baseURL.absoluteString), token: enrolled.token)
    }

    private func request<T: Decodable>(_ path: String, from baseURL: URL) async throws -> T {
        let (data, response) = try await session.data(from: baseURL.appending(path: path))
        guard let response = response as? HTTPURLResponse else { throw Failure.response }
        guard response.statusCode == 200 else { throw errorMessage(from: data) }
        return try decoder.decode(T.self, from: data)
    }

    private func errorMessage(from data: Data) -> Failure {
        if let body = try? decoder.decode(ErrorBody.self, from: data) { return .server(body.error) }
        return .response
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
