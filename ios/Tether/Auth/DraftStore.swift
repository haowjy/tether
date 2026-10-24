import Foundation
import TetherKit

final class DraftStore {
    private let defaults: UserDefaults
    private let key = "tether.drafts.v1"
    private let lock = NSLock()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    func get(_ key: TabKey) -> DraftRecord? {
        lock.lock(); defer { lock.unlock() }
        return records()[Self.key(for: key)]
    }

    func put(_ record: DraftRecord, baseRevision: Int) -> DraftPutReply {
        lock.lock(); defer { lock.unlock() }
        var values = records()
        let stored = values[Self.key(for: record.key)]
        guard (stored?.revision ?? 0) <= baseRevision else { return .conflict }
        values[Self.key(for: record.key)] = record
        return save(values) ? .ok : .failed
    }

    func delete(_ key: TabKey) {
        lock.lock(); defer { lock.unlock() }
        var values = records()
        values.removeValue(forKey: Self.key(for: key))
        _ = save(values)
    }

    func list() -> [DraftRecord] {
        lock.lock(); defer { lock.unlock() }
        return records().values.sorted { $0.editedAt < $1.editedAt }
    }

    private func records() -> [String: DraftRecord] {
        guard let data = defaults.data(forKey: key),
              let values = try? decoder.decode([DraftRecord].self, from: data) else { return [:] }
        return Dictionary(values.map { (Self.key(for: $0.key), $0) }, uniquingKeysWith: { _, newer in newer })
    }

    private func save(_ values: [String: DraftRecord]) -> Bool {
        guard let data = try? encoder.encode(Array(values.values)) else { return false }
        defaults.set(data, forKey: key)
        return true
    }

    private static func key(for key: TabKey) -> String {
        let data = (try? JSONEncoder().encode(key)) ?? Data()
        return data.base64EncodedString()
    }
}
