import Foundation
import XCTest
@testable import TetherKit

final class BridgeFixtureTests: XCTestCase {
    func testEveryBridgeMessageRoundTripsThroughTheSharedFixtures() throws {
        let directory = try XCTUnwrap(Bundle.module.resourceURL?.appendingPathComponent("Fixtures/bridge"))
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        var seen = Set<BridgeMessageType>()

        for file in files {
            let root = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: file))
            let direction = try XCTUnwrap(root["direction"]).decode(BridgeDirection.self)
            let source = try XCTUnwrap(root["message"])
            let message = try source.decode(BridgeMessage.self)
            XCTAssertEqual(message.type.direction, direction, file.lastPathComponent)
            XCTAssertTrue(seen.insert(message.type).inserted, "duplicate fixture for \(message.type)")

            let encoded = try JSONValue.encode(message)
            XCTAssertEqual(encoded, source, "Swift's encoded \(message.type) differs from the shared JSON fixture")

            if let reply = root["reply"] {
                XCTAssertEqual(try JSONValue.encode(reply), reply, "reply in \(file.lastPathComponent) is not stable JSON")
                if message.type == .ready {
                    let boot = try reply.decode(Boot.self)
                    XCTAssertEqual(boot.bridgeVersion, BridgeContract.version)
                    XCTAssertEqual(boot.focusMode, .line)
                    XCTAssertEqual(boot.lineSnapshot?.text, "echo hi")
                    XCTAssertEqual(boot.lineSnapshot?.selection, TextRange(start: 7, end: 7))
                    XCTAssertNil(boot.lineSnapshot?.marked)
                    XCTAssertEqual(try JSONValue.encode(boot), reply)
                } else if message.type == .socket {
                    XCTAssertEqual(
                        try reply.decode(SocketReply.self),
                        .socket(url: "wss://pop-os.ts.net/ws", token: "fixture-token")
                    )
                } else if message.type == .draftPut {
                    XCTAssertEqual(try reply.decode(DraftPutReply.self), .ok)
                } else if message.type == .readPasteboard {
                    XCTAssertEqual(try reply.decode(PasteboardReply.self), .text("clipboard text"))
                }
            } else {
                XCTAssertEqual(direction, .nativeToWeb, "web requests always have a reply slot")
            }
        }

        XCTAssertEqual(seen, Set(BridgeMessageType.allCases))
    }

    func testMessagesRejectMissingRequiredFields() throws {
        let malformed = Data(#"{"type":"input","events":[]}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(BridgeMessage.self, from: malformed))
    }
}
