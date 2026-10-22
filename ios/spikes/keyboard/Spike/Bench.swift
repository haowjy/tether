import QuartzCore

/// The measurements in spike-1-keyboard.md "Measure", run from ⚙ → Bench.
/// Native times everything with `CACurrentMediaTime`.
@MainActor
final class Bench {
    private let bridge: Bridge
    private let recorder: Recorder
    private let focus: FocusController
    var getGeometry: (() -> Geometry)?
    var setGeometry: ((Geometry) -> Void)?
    var onProgress: ((String) -> Void)?
    private(set) var running = false

    // M1, M2
    private var nextID = 0
    private var sentAt: [Int: Double] = [:]
    private var roundTripsMs: [Double] = []
    // M3
    private var collectingM3 = false
    private var m3Arrivals: [Double] = []
    private var m3PageSamples: [Double]?
    // M4
    private var didShowAt: Double?
    private var didHideAt: Double?
    private var collectingLayout = false
    private var viewportSentAt: [Int: Double] = [:]
    private var layoutMs: [Double] = []

    init(bridge: Bridge, recorder: Recorder, focus: FocusController) {
        self.bridge = bridge
        self.recorder = recorder
        self.focus = focus
    }

    func run() async {
        guard !running else { return }
        running = true
        recorder.log("benchStart")

        await roundTrips("M1", count: 1000)

        bridge.send(["type": "flood", "rate": 1_000_000])
        progress("M2: flood warming up")
        try? await Task.sleep(for: .milliseconds(1500))
        await roundTrips("M2", count: 1000)
        bridge.send(["type": "flood", "rate": 0])

        await webToNative(count: 1000)
        await keyboardTiming()

        recorder.log("benchEnd")
        running = false
        progress("Bench done: results.json updated")
    }

    // MARK: Events from the page and the keyboard

    func ack(_ id: Int) {
        guard let sent = sentAt.removeValue(forKey: id) else { return }
        roundTripsMs.append((CACurrentMediaTime() - sent) * 1000)
    }

    func hapticRequestArrived() {
        if collectingM3 { m3Arrivals.append(CACurrentMediaTime()) }
    }

    func pageResult(_ name: String, samples: [Double]) {
        if name == "M3" { m3PageSamples = samples }
    }

    func keyboardDidShow() { didShowAt = CACurrentMediaTime() }
    func keyboardDidHide() { didHideAt = CACurrentMediaTime() }

    func viewportSent(seq: Int) {
        if collectingLayout { viewportSentAt[seq] = CACurrentMediaTime() }
    }

    func layoutSettled(seq: Int) {
        guard let sent = viewportSentAt.removeValue(forKey: seq) else { return }
        layoutMs.append((CACurrentMediaTime() - sent) * 1000)
    }

    // MARK: Benches

    /// M1, M2: input-path messages at 60/s; the page acks each at once.
    private func roundTrips(_ name: String, count: Int) async {
        sentAt.removeAll()
        roundTripsMs.removeAll()
        for i in 0..<count {
            let id = nextID
            nextID += 1
            sentAt[id] = CACurrentMediaTime()
            bridge.send(["type": "bench", "id": id])
            if i % 50 == 0 { progress("\(name): \(i)/\(count)") }
            try? await Task.sleep(for: .microseconds(16_667))
        }
        _ = await waitUntil(seconds: 3) { self.sentAt.isEmpty }
        let lost = sentAt.count
        sentAt.removeAll()
        recorder.measure(name, Stats(samplesMs: roundTripsMs, lost: lost, roundTrip: true,
                                     note: "native send → page receive → ack → native, CACurrentMediaTime"))
    }

    /// M3: the page posts `haptic` requests with reply, one after another.
    private func webToNative(count: Int) async {
        m3Arrivals.removeAll()
        m3PageSamples = nil
        collectingM3 = true
        progress("M3: web → native")
        bridge.send(["type": "bench", "m3": count])
        _ = await waitUntil(seconds: 60) { self.m3PageSamples != nil }
        collectingM3 = false
        // Request i+1 leaves the page as soon as reply i resolves, so the gap
        // between arrivals is one round trip, timed natively.
        let gaps = zip(m3Arrivals.dropFirst(), m3Arrivals).map { ($0 - $1) * 1000 }
        recorder.measure("M3", Stats(samplesMs: gaps, lost: max(0, count - m3Arrivals.count), roundTrip: true,
                                     note: "gap between consecutive haptic requests at native: page → native → reply → page → native"))
        if let page = m3PageSamples {
            recorder.measure("M3.page", Stats(samplesMs: page, roundTrip: true,
                                              note: "page performance.now() around await postMessage; WebKit may coarsen the clock"))
        }
    }

    /// M4: 10 show/hide rounds per geometry mode, driven by the focus controller.
    private func keyboardTiming() async {
        guard let getGeometry, let setGeometry else { return }
        let original = getGeometry()
        let originalMode = focus.mode
        for mode in [Geometry.A, .B] {
            setGeometry(mode)
            focus.set(.hidden, reason: "bench")
            _ = await waitUntil(seconds: 2) { !self.focus.keyboardVisible }
            try? await Task.sleep(for: .milliseconds(500))

            var shows: [Double] = []
            var hides: [Double] = []
            layoutMs.removeAll()
            viewportSentAt.removeAll()
            collectingLayout = true
            for round in 1...10 {
                progress("M4 \(mode.rawValue): \(round)/10")
                didShowAt = nil
                let showStart = CACurrentMediaTime()
                focus.set(.terminal, reason: "bench")
                if await waitUntil(seconds: 2, until: { self.didShowAt != nil }), let shown = didShowAt {
                    shows.append((shown - showStart) * 1000)
                }
                try? await Task.sleep(for: .milliseconds(400))

                didHideAt = nil
                let hideStart = CACurrentMediaTime()
                focus.set(.hidden, reason: "bench")
                if await waitUntil(seconds: 2, until: { self.didHideAt != nil }), let hidden = didHideAt {
                    hides.append((hidden - hideStart) * 1000)
                }
                try? await Task.sleep(for: .milliseconds(400))
            }
            _ = await waitUntil(seconds: 1.5) { self.viewportSentAt.isEmpty }
            collectingLayout = false
            let m = mode.rawValue
            recorder.measure("M4.show.\(m)", Stats(samplesMs: shows, lost: 10 - shows.count, roundTrip: false,
                                                  note: "focus terminal from hidden (reloadInputViews) → keyboardDidShow"))
            recorder.measure("M4.hide.\(m)", Stats(samplesMs: hides, lost: 10 - hides.count, roundTrip: false,
                                                  note: "focus hidden → keyboardDidHide"))
            recorder.measure("M4.layout.\(m)", Stats(samplesMs: layoutMs, lost: viewportSentAt.count, roundTrip: false,
                                                    note: "keyboardWillChangeFrame → page reports layout settled after the next animation frame"))
        }
        setGeometry(original)
        focus.set(originalMode == .hidden ? .hidden : .terminal, reason: "benchEnd")
    }

    private func waitUntil(seconds: Double, until done: () -> Bool) async -> Bool {
        let deadline = CACurrentMediaTime() + seconds
        while !done() {
            if CACurrentMediaTime() > deadline { return false }
            try? await Task.sleep(for: .milliseconds(5))
        }
        return true
    }

    private func progress(_ text: String) {
        onProgress?(text)
    }
}
