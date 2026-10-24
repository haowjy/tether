import Foundation
import TetherKit
import UniformTypeIdentifiers
import WebKit

final class AppSchemeHandler: NSObject, WKURLSchemeHandler, URLSessionDataDelegate {
    private final class Pending {
        let identifier: ObjectIdentifier
        let schemeTask: WKURLSchemeTask
        let originalURL: URL
        let hostID: String?
        let isAuthInfo: Bool
        let sentToken: String?
        var dataTask: URLSessionDataTask?
        var authInfoBody = Data()
        var statusCode: Int?
        var stopped = false

        init(identifier: ObjectIdentifier, schemeTask: WKURLSchemeTask, url: URL, hostID: String?, isAuthInfo: Bool, sentToken: String?) {
            self.identifier = identifier
            self.schemeTask = schemeTask
            self.originalURL = url
            self.hostID = hostID
            self.isAuthInfo = isAuthInfo
            self.sentToken = sentToken
        }
    }

    private let model: TetherAppModel
    private let bundle: Bundle
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        return URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }()
    private var pending: [ObjectIdentifier: Pending] = [:]
    private var byTaskID: [Int: Pending] = [:]
    private var compatibleHosts = Set<String>()

    init(model: TetherAppModel, bundle: Bundle = .main) {
        self.model = model
        self.bundle = bundle
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url,
              url.scheme == "tether-app",
              let host = url.host else {
            fail(urlSchemeTask, error: URLError(.badURL))
            return
        }
        if host == "ui" {
            serveAsset(url, to: urlSchemeTask)
        } else if host.hasPrefix("h-") {
            proxy(urlSchemeTask, hostID: String(host.dropFirst(2)))
        } else {
            fail(urlSchemeTask, error: URLError(.unsupportedURL))
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let identifier = ObjectIdentifier(urlSchemeTask as AnyObject)
        guard let request = pending.removeValue(forKey: identifier) else { return }
        request.stopped = true
        if let task = request.dataTask {
            byTaskID.removeValue(forKey: task.taskIdentifier)
            task.cancel()
        }
    }

    private func serveAsset(_ url: URL, to task: WKURLSchemeTask) {
        let encodedPath = url.path.isEmpty || url.path == "/" ? "/index.html" : url.path
        guard let path = encodedPath.removingPercentEncoding,
              !path.contains(".."), !path.contains("\\"),
              let root = bundle.url(forResource: "WebUI", withExtension: nil) else {
            respond(task, status: 404, body: Data("Not found".utf8), headers: ["Content-Type": "text/plain; charset=utf-8"])
            return
        }
        let file = root.appending(path: String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path + "/"),
              let data = try? Data(contentsOf: file) else {
            respond(task, status: 404, body: Data("Not found".utf8), headers: ["Content-Type": "text/plain; charset=utf-8"])
            return
        }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        var headers = ["Content-Type": mime, "X-Content-Type-Options": "nosniff"]
        if file.lastPathComponent == "index.html" { headers["Content-Security-Policy"] = Self.contentSecurityPolicy }
        respond(task, status: 200, body: data, headers: headers)
    }

    private func proxy(_ schemeTask: WKURLSchemeTask, hostID: String) {
        let request = schemeTask.request
        guard let url = request.url else { fail(schemeTask, error: URLError(.badURL)); return }
        guard let requestComponents = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            fail(schemeTask, error: URLError(.badURL))
            return
        }
        let path = requestComponents.percentEncodedPath.isEmpty ? "/" : requestComponents.percentEncodedPath
        let method = request.httpMethod?.uppercased() ?? "GET"
        let isAuthInfo = path == "/auth/info" && method == "GET"
        guard Self.permits(path: path, method: method) else {
            respond(schemeTask, status: 404, body: Data(#"{"error":"not_found"}"#.utf8), headers: Self.corsHeaders)
            return
        }
        if method == "OPTIONS" {
            respond(schemeTask, status: 204, body: Data(), headers: Self.corsHeaders.merging([
                "Access-Control-Allow-Methods": "GET, POST, PUT",
                "Access-Control-Allow-Headers": "Range, If-Match, Content-Type",
                "Access-Control-Max-Age": "600",
            ]) { _, new in new })
            return
        }
        guard ["GET", "POST", "PUT"].contains(method) else {
            respond(schemeTask, status: 405, body: Data(), headers: Self.corsHeaders)
            return
        }
        guard isAuthInfo || compatibleHosts.contains(hostID) else {
            respond(schemeTask, status: 409, body: Data(#"{"error":"incompatible"}"#.utf8), headers: Self.corsHeaders.merging(["Content-Type": "application/json"]) { _, new in new })
            return
        }
        guard let storedHost = MainActor.assumeIsolated({ model.hosts.first { $0.id == hostID } }),
              let baseURL = URL(string: storedHost.baseURL),
              var target = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            respond(schemeTask, status: 404, body: Data(#"{"error":"not_found"}"#.utf8), headers: Self.corsHeaders)
            return
        }
        target.percentEncodedPath = path
        target.percentEncodedQuery = requestComponents.percentEncodedQuery
        guard let targetURL = target.url else { fail(schemeTask, error: URLError(.badURL)); return }
        var upstream = URLRequest(url: targetURL)
        upstream.httpMethod = request.httpMethod
        upstream.httpBody = request.httpBody
        for name in ["Range", "If-Match", "Content-Type"] {
            if let value = request.value(forHTTPHeaderField: name) { upstream.setValue(value, forHTTPHeaderField: name) }
        }
        let sentToken: String?
        if isAuthInfo {
            sentToken = nil
        } else {
            switch MainActor.assumeIsolated({ model.token(for: hostID) }) {
            case .token(let value):
                upstream.setValue("Bearer \(value)", forHTTPHeaderField: "Authorization")
                sentToken = value
            case .locked:
                respond(schemeTask, status: 423, body: Data(#"{"error":"locked"}"#.utf8), headers: Self.corsHeaders.merging(["Content-Type": "application/json"]) { _, new in new })
                return
            case .notEnrolled:
                respond(schemeTask, status: 401, body: Data(#"{"error":"not_enrolled"}"#.utf8), headers: Self.corsHeaders.merging(["Content-Type": "application/json"]) { _, new in new })
                return
            }
        }

        let identifier = ObjectIdentifier(schemeTask as AnyObject)
        let item = Pending(identifier: identifier, schemeTask: schemeTask, url: targetURL, hostID: hostID, isAuthInfo: isAuthInfo, sentToken: sentToken)
        pending[identifier] = item
        let task = session.dataTask(with: upstream)
        item.dataTask = task
        byTaskID[task.taskIdentifier] = item
        task.resume()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let item = byTaskID[dataTask.taskIdentifier], !item.stopped,
              let http = response as? HTTPURLResponse else { completionHandler(.cancel); return }
        item.statusCode = http.statusCode
        let forwarded = ["Content-Type", "Content-Range", "ETag", "Content-Length"]
        var headers: [String: String] = Self.corsHeaders
        for name in forwarded {
            if let value = http.value(forHTTPHeaderField: name) { headers[name] = value }
        }
        headers["Content-Security-Policy"] = "sandbox"
        headers["X-Content-Type-Options"] = "nosniff"
        deliverResponse(item.schemeTask, status: http.statusCode, headers: headers)
        completionHandler(.allow)
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        guard let item = byTaskID[task.taskIdentifier],
              let redirectURL = request.url,
              let path = URLComponents(url: redirectURL, resolvingAgainstBaseURL: false)?.percentEncodedPath,
              Self.sameOrigin(item.originalURL, redirectURL),
              Self.permits(path: path, method: request.httpMethod?.uppercased() ?? "GET") else {
            completionHandler(nil)
            return
        }
        completionHandler(request)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let item = byTaskID[dataTask.taskIdentifier], !item.stopped else { return }
        if item.isAuthInfo { item.authInfoBody.append(data) }
        item.schemeTask.didReceive(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let item = byTaskID.removeValue(forKey: task.taskIdentifier), !item.stopped else { return }
        pending.removeValue(forKey: item.identifier)
        if let error {
            item.schemeTask.didFailWithError(error)
            return
        }
        if item.isAuthInfo, item.statusCode == 200,
           let info = try? JSONDecoder().decode(AuthInfo.self, from: item.authInfoBody),
           info.protocolRange.contains(DaemonProtocol.version), let hostID = item.hostID {
            compatibleHosts.insert(hostID)
        }
        if item.statusCode == 401, let token = item.sentToken, let hostID = item.hostID {
            MainActor.assumeIsolated { model.rejectedToken(for: hostID, token: token) }
        }
        item.schemeTask.didFinish()
    }

    private func respond(_ task: WKURLSchemeTask, status: Int, body: Data, headers: [String: String]) {
        deliverResponse(task, status: status, headers: headers)
        if !body.isEmpty { task.didReceive(body) }
        task.didFinish()
    }

    private func deliverResponse(_ task: WKURLSchemeTask, status: Int, headers: [String: String]) {
        guard let url = task.request.url,
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else { return }
        task.didReceive(response)
    }

    private func fail(_ task: WKURLSchemeTask, error: Error) { task.didFailWithError(error) }

    private static let corsHeaders = [
        "Access-Control-Allow-Origin": "tether-app://ui",
        "Access-Control-Expose-Headers": "Content-Range, ETag",
        "Vary": "Origin",
    ]

    private static let contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' tether-app: blob: data:; media-src 'self' blob:; connect-src 'self' tether-app: wss:; frame-src 'none'; object-src 'none'; base-uri 'none'"

    private static func permits(path: String, method: String) -> Bool {
        path == "/auth/info" && method == "GET"
            || path == "/complete"
            || path.hasPrefix("/fs/")
    }

    private static func sameOrigin(_ lhs: URL, _ rhs: URL) -> Bool {
        guard let left = URLComponents(url: lhs, resolvingAgainstBaseURL: false),
              let right = URLComponents(url: rhs, resolvingAgainstBaseURL: false) else { return false }
        return left.scheme?.lowercased() == right.scheme?.lowercased()
            && left.host?.lowercased() == right.host?.lowercased()
            && left.port == right.port
    }
}
