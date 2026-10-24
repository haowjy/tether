import Foundation
import TetherKit

@MainActor
final class HostStore {
    private let defaults: UserDefaults
    private let key = "tether.hosts.v1"
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    func load() -> [HostEntry] {
        guard let data = defaults.data(forKey: key) else { return [] }
        return (try? decoder.decode([HostEntry].self, from: data)) ?? []
    }

    func save(_ hosts: [HostEntry]) throws {
        defaults.set(try encoder.encode(hosts), forKey: key)
    }

}
