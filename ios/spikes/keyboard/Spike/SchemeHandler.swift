import Foundation
import WebKit

/// Serves the bundled `web/` folder at `spike-app://ui/`, as the real app's
/// AppSchemeHandler serves `tether-app://ui/`, with the same CSP.
@MainActor
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "spike-app"
    static let host = "ui"
    static let startURL = URL(string: "spike-app://ui/index.html")!

    private static let csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        + "img-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'"

    private static let types = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json",
        "map": "application/json",
    ]

    private let root: URL
    var onLog: ((_ kind: String, _ detail: [String: String]) -> Void)?

    override init() {
        guard let web = Bundle.main.url(forResource: "web", withExtension: nil) else {
            fatalError("web/ is missing from the app bundle; check the folder reference in project.yml")
        }
        root = web.standardizedFileURL
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        var path = url.path(percentEncoded: false)
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appending(path: String(path.dropFirst())).standardizedFileURL
        let inside = file.path(percentEncoded: false).hasPrefix(root.path(percentEncoded: false))
        guard url.host() == SchemeHandler.host, inside, let data = try? Data(contentsOf: file) else {
            onLog?("scheme404", ["url": url.absoluteString])
            respond(urlSchemeTask, url: url, status: 404, type: "text/plain", data: Data("not found".utf8))
            return
        }
        let type = SchemeHandler.types[file.pathExtension] ?? "application/octet-stream"
        respond(urlSchemeTask, url: url, status: 200, type: type, data: data)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
        // Every response is sent synchronously in start, so there is nothing to cancel.
    }

    private func respond(_ task: any WKURLSchemeTask, url: URL, status: Int, type: String, data: Data) {
        let headers = [
            "Content-Type": type,
            "Content-Length": "\(data.count)",
            "Content-Security-Policy": SchemeHandler.csp,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                             headerFields: headers) else {
            task.didFailWithError(URLError(.cannotParseResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }
}
