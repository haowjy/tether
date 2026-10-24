// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "TetherKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "TetherKit", targets: ["TetherKit"])],
    targets: [
        .target(name: "TetherKit"),
        .testTarget(
            name: "TetherKitTests",
            dependencies: ["TetherKit"],
            path: "Tests",
            sources: ["TetherKitTests"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
