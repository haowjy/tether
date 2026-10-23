import UIKit

/// The compose field. It sits inside the terminal input's accessory, so taking
/// first responder swaps between two native views and the keyboard stays up.
final class ComposeTextView: UITextView {
    /// Called with true before and false after this view tries to become first
    /// responder, so the focus controller can let the terminal input resign.
    var focusHook: ((Bool) -> Void)?

    override func becomeFirstResponder() -> Bool {
        focusHook?(true)
        let ok = super.becomeFirstResponder()
        focusHook?(false)
        return ok
    }
}

/// The terminal input's `inputAccessoryView`: a key row, an optional compose
/// row above it, and a paste control. Keys are `UIControl`s, which never take
/// first responder.
final class Accessory: UIInputView {
    enum Action {
        case key(String)
        case ctrl
        case compose
        case hide
        case send(String)
    }

    var onAction: ((Action) -> Void)?
    let compose = ComposeTextView(frame: .zero, textContainer: nil)
    private(set) var composeVisible = false
    private(set) var hardwareKeyboard = false

    private let pasteControl: UIPasteControl
    private let stack = UIStackView()
    private let composeRow = UIStackView()
    private let keyRow = UIStackView()
    private var keyRowHeight: NSLayoutConstraint!
    private var softOnlyKeys: [UIView] = []
    private var ctrlKey: UIButton!
    private lazy var haptic = UIImpactFeedbackGenerator(style: .light, view: self)

    private static let keyColor = UIColor.secondarySystemBackground
    private static let pad: CGFloat = 6
    private static let composeHeight: CGFloat = 76

    init(pasteTarget: any UIPasteConfigurationSupporting) {
        let config = UIPasteControl.Configuration()
        config.displayMode = .iconOnly
        config.cornerStyle = .medium
        let paste = UIPasteControl(configuration: config)
        paste.target = pasteTarget
        pasteControl = paste
        super.init(frame: CGRect(x: 0, y: 0, width: 0, height: 52), inputViewStyle: .keyboard)
        allowsSelfSizing = true
        build()
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    private func build() {
        stack.axis = .vertical
        stack.spacing = Accessory.pad
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor, constant: Accessory.pad),
            stack.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: Accessory.pad),
            stack.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -Accessory.pad),
        ])

        compose.font = .systemFont(ofSize: 16)
        compose.layer.cornerRadius = 8
        compose.backgroundColor = .systemBackground
        let send = UIButton(type: .system)
        send.setTitle("send", for: .normal)
        send.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
        send.addAction(UIAction { [unowned self] _ in
            let text = self.compose.text ?? ""
            self.compose.text = ""
            self.onAction?(.send(text))
        }, for: .touchUpInside)
        send.widthAnchor.constraint(equalToConstant: 52).isActive = true
        composeRow.axis = .horizontal
        composeRow.spacing = Accessory.pad
        composeRow.addArrangedSubview(compose)
        composeRow.addArrangedSubview(send)
        composeRow.heightAnchor.constraint(equalToConstant: Accessory.composeHeight).isActive = true
        composeRow.isHidden = true

        keyRow.axis = .horizontal
        keyRow.spacing = 4
        keyRowHeight = keyRow.heightAnchor.constraint(equalToConstant: 38)
        keyRowHeight.isActive = true

        let keys: [(String, Action, Bool)] = [
            ("esc", .key("Escape"), true),
            ("tab", .key("Tab"), true),
            ("ctrl", .ctrl, false),
            ("⇧tab", .key("BTab"), true),
            ("←", .key("Left"), true),
            ("↑", .key("Up"), true),
            ("↓", .key("Down"), true),
            ("→", .key("Right"), true),
            ("cmp", .compose, true),
        ]
        var keyViews = keys.map { title, action, softOnly in
            let key = makeKey(title, action)
            if title == "ctrl" { ctrlKey = key }
            if softOnly { softOnlyKeys.append(key) }
            return key
        }
        keyViews.append(makeKey("⌨︎↓", .hide))
        softOnlyKeys.append(pasteControl)
        for key in keyViews.dropLast() { keyRow.addArrangedSubview(key) }
        keyRow.addArrangedSubview(pasteControl)
        keyRow.addArrangedSubview(keyViews[keyViews.count - 1])

        stack.addArrangedSubview(composeRow)
        stack.addArrangedSubview(keyRow)

        // Keys share the width equally; the paste control gets a fixed, larger
        // slot because iOS checks it is clearly visible before it pastes.
        for key in keyViews.dropFirst() {
            key.widthAnchor.constraint(equalTo: keyViews[0].widthAnchor).isActive = true
        }
        pasteControl.widthAnchor.constraint(equalToConstant: 44).isActive = true
    }

    private func makeKey(_ title: String, _ action: Action) -> UIButton {
        let key = UIButton(type: .system)
        key.setTitle(title, for: .normal)
        key.setTitleColor(.label, for: .normal)
        key.titleLabel?.font = .systemFont(ofSize: 14, weight: .medium)
        key.titleLabel?.adjustsFontSizeToFitWidth = true
        key.backgroundColor = Accessory.keyColor
        key.layer.cornerRadius = 6
        // Key-down, not key-up: the haptic and the key fire on touch.
        key.addAction(UIAction { [unowned self] _ in
            self.haptic.impactOccurred()
            self.haptic.prepare()
            self.onAction?(action)
        }, for: .touchDown)
        return key
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil { haptic.prepare() }
    }

    override var intrinsicContentSize: CGSize {
        let keys: CGFloat = hardwareKeyboard ? 28 : 38
        let composePart = composeVisible ? Accessory.composeHeight + Accessory.pad : 0
        return CGSize(width: UIView.noIntrinsicMetric, height: Accessory.pad + composePart + keys + Accessory.pad)
    }

    func setComposeVisible(_ visible: Bool) {
        guard visible != composeVisible else { return }
        composeVisible = visible
        composeRow.isHidden = !visible
        invalidateIntrinsicContentSize()
    }

    /// With a hardware keyboard the row collapses to a thin strip: ctrl and hide.
    func setHardwareKeyboard(_ connected: Bool) {
        guard connected != hardwareKeyboard else { return }
        hardwareKeyboard = connected
        for key in softOnlyKeys { key.isHidden = connected }
        keyRowHeight.constant = connected ? 28 : 38
        if connected { setComposeVisible(false) }
        invalidateIntrinsicContentSize()
    }

    func setCtrlArmed(_ armed: Bool) {
        ctrlKey.backgroundColor = armed ? .systemBlue : Accessory.keyColor
        ctrlKey.setTitleColor(armed ? .white : .label, for: .normal)
    }
}
