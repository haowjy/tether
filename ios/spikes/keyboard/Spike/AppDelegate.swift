import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {}

/// Named in Info.plist's scene manifest.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var spike: SpikeViewController?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let spike = SpikeViewController()
        let window = UIWindow(windowScene: windowScene)
        window.overrideUserInterfaceStyle = .dark
        window.rootViewController = spike
        window.makeKeyAndVisible()
        self.window = window
        self.spike = spike
    }

    func sceneDidBecomeActive(_ scene: UIScene) { spike?.lifecycle("active") }
    func sceneWillResignActive(_ scene: UIScene) { spike?.lifecycle("inactive") }
    func sceneWillEnterForeground(_ scene: UIScene) { spike?.lifecycle("foreground") }
    func sceneDidEnterBackground(_ scene: UIScene) { spike?.lifecycle("background") }
}
