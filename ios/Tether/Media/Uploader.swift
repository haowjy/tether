import Foundation
import TetherKit

final class Uploader: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    private static let maxQueuedUploads = 4

    private final class Job {
        let id: String
        let host: HostEntry
        let data: Data
        let fileName: String
        let token: String
        let rejectedToken: (String) -> Void
        let progress: (Double) -> Void
        let completion: (Result<String, Error>) -> Void
        var responseData = Data()
        var statusCode: Int?
        var retry = 0

        init(id: String, host: HostEntry, data: Data, fileName: String, token: String, rejectedToken: @escaping (String) -> Void, progress: @escaping (Double) -> Void, completion: @escaping (Result<String, Error>) -> Void) {
            self.id = id
            self.host = host
            self.data = data
            self.fileName = fileName
            self.token = token
            self.rejectedToken = rejectedToken
            self.progress = progress
            self.completion = completion
        }
    }

    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        return URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }()
    private var jobs: [Int: Job] = [:]
    private var activeJob: Job?
    private var queuedJobs: [Job] = []

    func upload(host: HostEntry, data: Data, fileName: String, token: String, rejectedToken: @escaping (String) -> Void, progress: @escaping (Double) -> Void, completion: @escaping (Result<String, Error>) -> Void) -> String? {
        guard activeJob == nil || queuedJobs.count < Self.maxQueuedUploads else { return nil }
        let id = UUID().uuidString.lowercased()
        let job = Job(id: id, host: host, data: data, fileName: fileName, token: token, rejectedToken: rejectedToken, progress: progress, completion: completion)
        if activeJob == nil {
            activeJob = job
            attempt(job)
        } else {
            queuedJobs.append(job)
        }
        return id
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        jobs[dataTask.taskIdentifier]?.statusCode = (response as? HTTPURLResponse)?.statusCode
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        jobs[dataTask.taskIdentifier]?.responseData.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard let job = jobs[task.taskIdentifier], totalBytesExpectedToSend > 0 else { return }
        job.progress(min(0.99, Double(totalBytesSent) / Double(totalBytesExpectedToSend)))
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let job = jobs.removeValue(forKey: task.taskIdentifier) else { return }
        if let error {
            job.completion(.failure(error))
            finish(job)
            return
        }
        if job.statusCode == 503, job.retry < 3 {
            let retryAfter = (task.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Retry-After").flatMap(TimeInterval.init) ?? 1
            job.retry += 1
            DispatchQueue.main.asyncAfter(deadline: .now() + max(0, min(retryAfter, 60))) { [weak self] in self?.attempt(job) }
            return
        }
        if job.statusCode == 401 { job.rejectedToken(job.token) }
        guard job.statusCode == 201,
              let uploaded = try? JSONDecoder().decode(UploadedPath.self, from: job.responseData) else {
            job.completion(.failure(UploadFailure.server(job.statusCode ?? 0)))
            finish(job)
            return
        }
        job.progress(1)
        job.completion(.success(uploaded.path))
        finish(job)
    }

    private func attempt(_ job: Job) {
        guard var components = URLComponents(string: job.host.baseURL) else {
            fail(job, with: UploadFailure.invalidHost)
            return
        }
        components.path = "/fs/upload"
        components.queryItems = [URLQueryItem(name: "name", value: job.fileName)]
        guard let url = components.url else { fail(job, with: UploadFailure.invalidHost); return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(job.token)", forHTTPHeaderField: "Authorization")
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.setValue(String(job.data.count), forHTTPHeaderField: "Content-Length")
        job.responseData.removeAll(keepingCapacity: true)
        job.statusCode = nil
        let task = session.uploadTask(with: request, from: job.data)
        jobs[task.taskIdentifier] = job
        task.resume()
    }

    private func finish(_ job: Job) {
        guard activeJob?.id == job.id else { return }
        activeJob = queuedJobs.isEmpty ? nil : queuedJobs.removeFirst()
        if let activeJob { attempt(activeJob) }
    }

    private func fail(_ job: Job, with error: Error) {
        DispatchQueue.main.async { [weak self] in
            job.completion(.failure(error))
            self?.finish(job)
        }
    }
}

private struct UploadedPath: Decodable { let path: String }

private enum UploadFailure: LocalizedError {
    case invalidHost
    case server(Int)

    var errorDescription: String? {
        switch self {
        case .invalidHost: "The server address is invalid."
        case .server(let code): "The upload failed (HTTP \(code))."
        }
    }
}
