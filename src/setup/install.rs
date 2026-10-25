//! Pure decisions for installing the embedded service file and applying it.

#![cfg_attr(target_os = "linux", allow(dead_code))]

#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(crate) const SYSTEMD_UNIT: &str = include_str!("../../contrib/tether.service");
pub(crate) const LAUNCH_AGENT: &str = include_str!("../../contrib/com.jimmyyao.tether.plist");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub(crate) enum Platform {
    Systemd,
    LaunchAgent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FileState {
    Missing,
    Identical,
    Different,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ServiceState {
    pub loaded: bool,
    pub disabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Action {
    Install,
    BackupReplace,
    DaemonReload,
    Enable,
    Restart,
    EnableJob,
    Bootout,
    Bootstrap,
    Kickstart,
}

pub(crate) fn plan(platform: Platform, file: FileState, service: ServiceState) -> Vec<Action> {
    let changed = file != FileState::Identical;
    let mut actions = Vec::new();
    match file {
        FileState::Missing => actions.push(Action::Install),
        FileState::Different => actions.push(Action::BackupReplace),
        FileState::Identical => {}
    }
    match platform {
        Platform::Systemd => {
            actions.extend([Action::DaemonReload, Action::Enable, Action::Restart]);
        }
        Platform::LaunchAgent => {
            if service.disabled {
                actions.push(Action::EnableJob);
            }
            if !service.loaded {
                actions.push(Action::Bootstrap);
            } else if changed {
                actions.extend([Action::Bootout, Action::Bootstrap]);
            } else {
                actions.push(Action::Kickstart);
            }
        }
    }
    actions
}

pub(crate) fn launch_agent(home: &str, path: &str) -> String {
    LAUNCH_AGENT
        .replace("@HOME@", &xml_escape(home))
        .replace("@PATH@", &xml_escape(path))
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub(crate) fn file_state(
    current: Option<Vec<u8>>,
    expected: &[u8],
) -> (FileState, Option<Vec<u8>>) {
    let state = match current.as_deref() {
        None => FileState::Missing,
        Some(contents) if contents == expected => FileState::Identical,
        Some(_) => FileState::Different,
    };
    (state, current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_actions_follow_file_and_service_state() {
        let linux = |file| {
            plan(
                Platform::Systemd,
                file,
                ServiceState {
                    loaded: true,
                    disabled: false,
                },
            )
        };
        assert_eq!(
            linux(FileState::Missing),
            [
                Action::Install,
                Action::DaemonReload,
                Action::Enable,
                Action::Restart
            ]
        );
        assert_eq!(
            linux(FileState::Identical),
            [Action::DaemonReload, Action::Enable, Action::Restart]
        );
        assert_eq!(
            linux(FileState::Different),
            [
                Action::BackupReplace,
                Action::DaemonReload,
                Action::Enable,
                Action::Restart
            ]
        );

        let mac = |file, loaded, disabled| {
            plan(
                Platform::LaunchAgent,
                file,
                ServiceState { loaded, disabled },
            )
        };
        assert_eq!(
            mac(FileState::Missing, false, false),
            [Action::Install, Action::Bootstrap]
        );
        assert_eq!(
            mac(FileState::Identical, true, true),
            [Action::EnableJob, Action::Kickstart]
        );
        assert_eq!(
            mac(FileState::Different, true, false),
            [Action::BackupReplace, Action::Bootout, Action::Bootstrap]
        );
        assert_eq!(
            mac(FileState::Identical, false, true),
            [Action::EnableJob, Action::Bootstrap]
        );
        assert_eq!(
            mac(FileState::Different, false, true),
            [Action::BackupReplace, Action::EnableJob, Action::Bootstrap]
        );
    }

    #[test]
    fn plist_substitutions_are_xml_escaped() {
        let rendered = launch_agent("/Users/jimmy & <home>", "/a<& path");
        assert!(rendered.contains("/Users/jimmy &amp; &lt;home&gt;/.cargo/bin/tether"));
        assert!(rendered.contains("/a&lt;&amp; path"));
        if cfg!(target_os = "macos") {
            let path =
                std::env::temp_dir().join(format!("tether-plist-{}.plist", std::process::id()));
            std::fs::write(&path, rendered).expect("write rendered plist");
            let lint = std::process::Command::new("plutil")
                .arg("-lint")
                .arg(&path)
                .output()
                .expect("run plutil");
            let _ = std::fs::remove_file(&path);
            assert!(
                lint.status.success(),
                "plutil -lint failed: {}",
                String::from_utf8_lossy(&lint.stderr)
            );
        }
    }
}
