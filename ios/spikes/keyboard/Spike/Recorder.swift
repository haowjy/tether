import Foundation

/// One checklist step from spike-1-keyboard.md. `record` is the question the
/// step's Pass asks, for steps that record a value rather than pass or fail.
struct Step: Sendable {
    let id: String
    let section: String
    let todo: String
    let pass: String
    var record: String? = nil
}

enum Checklist {
    static let steps: [Step] = [
        Step(id: "S1", section: "1 Keyboard stays up (flood 1M)", todo: "Scroll the terminal up and down, fling it", pass: "Keyboard stays up"),
        Step(id: "S2", section: "1 Keyboard stays up (flood 1M)", todo: "Tap the terminal 5 times in different places", pass: "Keyboard stays up"),
        Step(id: "S3", section: "1 Keyboard stays up (flood 1M)", todo: "Tap tab1, tab2, tab3, several times", pass: "Keyboard stays up; typing goes to the shown tab"),
        Step(id: "S4", section: "1 Keyboard stays up (flood 1M)", todo: "Open and close the web sheet; tap buttons inside it", pass: "Keyboard stays up"),
        Step(id: "S5", section: "1 Keyboard stays up (flood 1M)", todo: "⚙ → Native sheet, then dismiss it", pass: "Keyboard is up again afterwards without a tap"),
        Step(id: "S6", section: "1 Keyboard stays up (flood 1M)", todo: "Rotate to landscape and back", pass: "Keyboard stays up; cols×rows changes only on rotation"),
        Step(id: "S7", section: "1 Keyboard stays up (flood 1M)", todo: "Long-press the static text, drag the handles, tap Copy, then tap the terminal", pass: "Selection and Copy work; keyboard stays up or comes back by itself. Paste into Notes later"),
        Step(id: "S8", section: "1 Keyboard stays up (flood 1M)", todo: "Swipe home, wait 10 s, return to the app", pass: "Keyboard comes back by itself"),
        Step(id: "S9", section: "1 Keyboard stays up (flood 1M)", todo: "Pull down Notification Center, then Control Center, and return", pass: "Keyboard stays or comes back by itself"),
        Step(id: "S10", section: "1 Keyboard stays up (flood 1M)", todo: "⚙ → Native prompt; type in its field; OK", pass: "Keyboard returns to the terminal afterwards"),
        Step(id: "S11", section: "1 Keyboard stays up (flood 1M)", todo: "Tap \"edit\", tap into its text area, type, close it", pass: "Text area gets the keyboard; after close, terminal input works without a tap"),
        Step(id: "S12", section: "1 Keyboard stays up (flood 1M)", todo: "Tap cmp, type in compose, tap cmp again", pass: "Keyboard never drops while switching"),
        Step(id: "S13", section: "1 Keyboard stays up (flood 1M)", todo: "Hide with the hide key. Tap the tab bar, then the web sheet, then the terminal", pass: "While hidden, fr: stays term; the terminal tap brings the keyboard back"),
        Step(id: "S14", section: "1 Keyboard stays up (flood 1M)", todo: "With the keyboard up, ⚙ → Kill web process", pass: "The page reloads and the keyboard is up again without a tap"),
        Step(id: "T1", section: "2 Typing (flood off)", todo: "Look above the keyboard", pass: "Record: is there a QuickType / prediction bar?", record: "QuickType / prediction bar? (yes/no)"),
        Step(id: "T2", section: "2 Typing (flood off)", todo: "Type: hello world. it's \"fine\" -- ok", pass: "Echo matches exactly: no capitals, curly quotes, em dash or corrections"),
        Step(id: "T3", section: "2 Typing (flood off)", todo: "Type two spaces quickly", pass: "Two spaces, not \". \""),
        Step(id: "T4", section: "2 Typing (flood off)", todo: "Backspace 3 times on an empty line", pass: "3 ⟨BSpace⟩ echoed"),
        Step(id: "T5", section: "2 Typing (flood off)", todo: "Swipe-type a word", pass: "Word arrives (note whether a space is added)", record: "Did the word arrive? Was a space added?"),
        Step(id: "T6", section: "2 Typing (flood off)", todo: "Tap the keyboard's mic, if shown, and dictate", pass: "Note what happens; any crash is a Fail", record: "What happened?"),
        Step(id: "T7", section: "2 Typing (flood off)", todo: "In compose: dictate a sentence; type with autocorrect; send", pass: "Dictation and autocorrect work there; text arrives as one paste"),
        Step(id: "T8", section: "2 Typing (flood off)", todo: "Tap paste in the key row with text on the clipboard", pass: "Pastes with no \"Allow Paste\" prompt"),
        Step(id: "F1", section: "3 Feel", todo: "Tap key-row keys quickly", pass: "Haptic on every key? Feels like Termius or better?", record: "Haptic on every key? Feel 1–5"),
        Step(id: "F2", section: "3 Feel", todo: "Open/close the keyboard 5 times with [⌨] and the hide key", pass: "Smooth? Tab bar tracks the keyboard without a jump?", record: "Smoothness 1–5 (this geometry)"),
        Step(id: "H1", section: "4 Hardware keyboard", todo: "Esc", pass: "⟨Escape⟩"),
        Step(id: "H2", section: "4 Hardware keyboard", todo: "Ctrl+C, Ctrl+D, Ctrl+R, Ctrl+A, Ctrl+Z, Ctrl+B", pass: "⟨C-c⟩ ⟨C-d⟩ ⟨C-r⟩ ⟨C-a⟩ ⟨C-z⟩ ⟨C-b⟩, and iOS does nothing else"),
        Step(id: "H3", section: "4 Hardware keyboard", todo: "Hold ← for 2 s, then ↑", pass: "Repeating ⟨Left⟩ while held, stops on release"),
        Step(id: "H4", section: "4 Hardware keyboard", todo: "Tab, Shift+Tab", pass: "⟨Tab⟩ ⟨BTab⟩"),
        Step(id: "H5", section: "4 Hardware keyboard", todo: "Option+B, Option+Enter", pass: "⟨M-b⟩ ⟨M-Enter⟩"),
        Step(id: "H6", section: "4 Hardware keyboard", todo: "Type a sentence with Shift and punctuation", pass: "Text exactly as typed"),
        Step(id: "H7", section: "4 Hardware keyboard", todo: "Cmd+V with text on the clipboard", pass: "Pastes, no prompt"),
        Step(id: "H8", section: "4 Hardware keyboard", todo: "Look at the bottom of the screen", pass: "Key row collapsed to the thin strip; no software keyboard"),
        Step(id: "H9", section: "4 Hardware keyboard", todo: "Hide with the hide key, then type on the hardware keyboard", pass: "Keys still echo (the terminal input kept first responder)"),
        Step(id: "B1", section: "B Keychain", todo: "⚙ → Keychain B1: add", pass: "No Face ID prompt", record: "Face ID prompts seen"),
        Step(id: "B2", section: "B Keychain", todo: "⚙ → Keychain B2/B3: read, delete, add", pass: "One prompt for the read, none for delete and add; the read returns the data", record: "Face ID prompts seen"),
        Step(id: "B3", section: "B Keychain", todo: "Add an Alternate Appearance in Settings → Face ID, then ⚙ → Keychain B2/B3", pass: "Record the read's OSStatus (shown above); do delete and add succeed? Reset Face ID afterwards", record: "Face ID prompts seen; anything odd"),
    ]
}

/// What the app is doing when something is recorded.
struct Context {
    var step = ""
    var firstResponder = ""
    var guardOn = true
    var geometry = "A"
}

struct Event: Codable {
    let t: Double
    let kind: String
    let step: String
    let fr: String
    let detail: [String: String]
}

struct Answer: Codable {
    let step: String
    let result: String
    let note: String?
    let guardOn: Bool
    let geometry: String
    let t: Double
    let at: String
}

struct KeychainRecord: Codable {
    let step: String
    let op: String
    let status: Int32
    let message: String
    let ms: Double
    let detail: String
    let at: String
}

/// Latency statistics in milliseconds. `oneWay` is half of each percentile, for
/// round trips.
struct Stats: Codable {
    struct Percentiles: Codable {
        let p50: Double
        let p95: Double
        let p99: Double
        let max: Double
    }

    let count: Int
    let lost: Int
    let mean: Double
    let percentiles: Percentiles
    let oneWay: Percentiles?
    let note: String?
    let samples: [Double]

    init(samplesMs: [Double], lost: Int = 0, roundTrip: Bool, note: String? = nil) {
        let sorted = samplesMs.sorted()
        // Nearest-rank percentile.
        func pct(_ p: Double) -> Double {
            guard !sorted.isEmpty else { return 0 }
            let rank = Int((p * Double(sorted.count)).rounded(.up))
            return sorted[min(max(rank, 1), sorted.count) - 1]
        }
        let p = Percentiles(p50: round3(pct(0.50)), p95: round3(pct(0.95)),
                            p99: round3(pct(0.99)), max: round3(sorted.last ?? 0))
        count = sorted.count
        self.lost = lost
        mean = round3(sorted.isEmpty ? 0 : sorted.reduce(0, +) / Double(sorted.count))
        percentiles = p
        oneWay = roundTrip
            ? Percentiles(p50: round3(p.p50 / 2), p95: round3(p.p95 / 2), p99: round3(p.p99 / 2), max: round3(p.max / 2))
            : nil
        self.note = note
        samples = samplesMs.map(round3)
    }
}

private func round3(_ x: Double) -> Double { (x * 1000).rounded() / 1000 }

/// Event log, checklist answers and measurements, written to
/// Documents/results.json.
@MainActor
final class Recorder {
    struct Results: Codable {
        var device: [String: String]
        var answers: [Answer] = []
        var measurements: [String: Stats] = [:]
        var keychain: [KeychainRecord] = []
        var events: [Event] = []
        var eventsDropped = 0
    }

    /// Bounds the log; a 45-minute run writes a few thousand events.
    private static let maxEvents = 20_000

    let fileURL: URL
    var context: () -> Context = { Context() }
    private var results: Results
    private let start = ProcessInfo.processInfo.systemUptime

    init(system: String) {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        fileURL = docs.appendingPathComponent("results.json")
        results = Results(device: [
            "model": Recorder.modelIdentifier(),
            "system": system,
            "started": Date().formatted(.iso8601),
        ])
    }

    /// Seconds since launch.
    var now: Double { ProcessInfo.processInfo.systemUptime - start }

    func log(_ kind: String, _ detail: [String: String] = [:]) {
        guard results.events.count < Recorder.maxEvents else {
            results.eventsDropped += 1
            return
        }
        let c = context()
        results.events.append(Event(t: round3(now), kind: kind, step: c.step, fr: c.firstResponder, detail: detail))
    }

    func answer(_ step: String, result: String, note: String?) {
        let c = context()
        results.answers.append(Answer(step: step, result: result, note: note, guardOn: c.guardOn,
                                      geometry: c.geometry, t: round3(now), at: Date().formatted(.iso8601)))
        save()
    }

    func answers(for step: String) -> [Answer] {
        results.answers.filter { $0.step == step }
    }

    func measure(_ name: String, _ stats: Stats) {
        results.measurements[name] = stats
        save()
    }

    func keychain(_ step: String, op: String, status: Int32, message: String, ms: Double, detail: String) {
        results.keychain.append(KeychainRecord(step: step, op: op, status: status, message: message,
                                               ms: round3(ms), detail: detail, at: Date().formatted(.iso8601)))
        save()
    }

    func save() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        do {
            try encoder.encode(results).write(to: fileURL, options: .atomic)
        } catch {
            print("results.json write failed: \(error)")
        }
    }

    /// The hardware model, e.g. "iPhone18,1".
    private static func modelIdentifier() -> String {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { raw in
            String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
        }
    }
}
