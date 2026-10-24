import Foundation
import XCTest
@testable import TetherKit

final class AuthFixtureTests: XCTestCase {
    func testAuthDTOsMatchRustEmittedFixtures() throws {
        let directory = try XCTUnwrap(Bundle.module.resourceURL?.appendingPathComponent("Fixtures/auth"))
        let info = try decode(AuthInfo.self, "auth-info.json", directory)
        XCTAssertEqual(info.hostId, "a234567bcdefghjk")
        XCTAssertTrue(AuthInfo.validHostID(info.hostId))
        XCTAssertTrue(info.protocolRange.contains(DaemonProtocol.version))

        let request = try decode(EnrollRequest.self, "auth-enroll-request.json", directory)
        XCTAssertEqual(request.deviceName, "Jimmy's iPhone")
        let response = try decode(EnrollResponse.self, "auth-enroll-response.json", directory)
        XCTAssertEqual(response.token, "fixture-device-token")

        let badCode = try decode(ErrorBody.self, "error-bad-code.json", directory)
        XCTAssertEqual(badCode.error, "bad_code")
        XCTAssertNil(badCode.reason)
        let notEnrolled = try decode(ErrorBody.self, "error-not-enrolled.json", directory)
        XCTAssertEqual(notEnrolled.node?.name, "jimmy-iphone")
    }

    private func decode<T: Codable & Equatable>(_ type: T.Type, _ name: String, _ directory: URL) throws -> T {
        let data = try Data(contentsOf: directory.appendingPathComponent(name))
        let decoded = try JSONDecoder().decode(type, from: data)
        let encoded = try JSONEncoder().encode(decoded)
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: encoded), try JSONDecoder().decode(JSONValue.self, from: data), name)
        return decoded
    }
}
