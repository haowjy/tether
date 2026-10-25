//! Pure decisions for installing the embedded service file and applying it.

#[cfg(target_os = "linux")]
pub(crate) const SYSTEMD_UNIT: &str = include_str!("../../contrib/tether.service");
#[cfg(any(target_os = "macos", test))]
pub(crate) const LAUNCH_AGENT: &str = include_str!("../../contrib/com.jimmyyao.tether.plist");

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FileState {
    Missing,
    Identical,
    Different(Vec<u8>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ServiceState {
    pub loaded: bool,
    pub disabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg(any(target_os = "linux", test))]
pub(crate) enum SystemdAction {
    Install,
    BackupReplace(Vec<u8>),
    DaemonReload,
    Enable,
    Restart,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg(any(target_os = "macos", test))]
pub(crate) enum LaunchAgentAction {
    Install,
    BackupReplace(Vec<u8>),
    EnableJob,
    Bootout,
    Bootstrap,
    Kickstart,
}

#[cfg(any(target_os = "linux", test))]
pub(crate) fn plan_systemd(file: &FileState) -> Vec<SystemdAction> {
    let mut actions = Vec::new();
    match file {
        FileState::Missing => actions.push(SystemdAction::Install),
        FileState::Different(contents) => {
            actions.push(SystemdAction::BackupReplace(contents.clone()))
        }
        FileState::Identical => {}
    }
    actions.extend([
        SystemdAction::DaemonReload,
        SystemdAction::Enable,
        SystemdAction::Restart,
    ]);
    actions
}

#[cfg(any(target_os = "macos", test))]
pub(crate) fn plan_launch_agent(file: &FileState, service: ServiceState) -> Vec<LaunchAgentAction> {
    let changed = !matches!(file, FileState::Identical);
    let mut actions = Vec::new();
    match file {
        FileState::Missing => actions.push(LaunchAgentAction::Install),
        FileState::Different(contents) => {
            actions.push(LaunchAgentAction::BackupReplace(contents.clone()))
        }
        FileState::Identical => {}
    }
    if service.disabled {
        actions.push(LaunchAgentAction::EnableJob);
    }
    if !service.loaded {
        actions.push(LaunchAgentAction::Bootstrap);
    } else if changed {
        actions.extend([LaunchAgentAction::Bootout, LaunchAgentAction::Bootstrap]);
    } else {
        actions.push(LaunchAgentAction::Kickstart);
    }
    actions
}

#[cfg(any(target_os = "macos", test))]
pub(crate) fn launch_agent(home: &str, path: &str) -> String {
    LAUNCH_AGENT
        .replace("@HOME@", &xml_escape(home))
        .replace("@PATH@", &xml_escape(path))
}

#[cfg(any(target_os = "macos", test))]
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub(crate) fn file_state(current: Option<Vec<u8>>, expected: &[u8]) -> FileState {
    match current {
        None => FileState::Missing,
        Some(contents) if contents == expected => FileState::Identical,
        Some(contents) => FileState::Different(contents),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_actions_follow_file_and_service_state() {
        use SystemdAction as Sys;
        let linux = |file| plan_systemd(&file);
        assert_eq!(
            linux(FileState::Missing),
            [Sys::Install, Sys::DaemonReload, Sys::Enable, Sys::Restart]
        );
        assert_eq!(
            linux(FileState::Identical),
            [Sys::DaemonReload, Sys::Enable, Sys::Restart]
        );
        assert_eq!(
            linux(FileState::Different(b"old".to_vec())),
            [
                Sys::BackupReplace(b"old".to_vec()),
                Sys::DaemonReload,
                Sys::Enable,
                Sys::Restart
            ]
        );

        use LaunchAgentAction as Mac;
        let mac =
            |file, loaded, disabled| plan_launch_agent(&file, ServiceState { loaded, disabled });
        assert_eq!(
            mac(FileState::Missing, false, false),
            [Mac::Install, Mac::Bootstrap]
        );
        assert_eq!(
            mac(FileState::Identical, true, true),
            [Mac::EnableJob, Mac::Kickstart]
        );
        assert_eq!(
            mac(FileState::Different(b"old".to_vec()), true, false),
            [
                Mac::BackupReplace(b"old".to_vec()),
                Mac::Bootout,
                Mac::Bootstrap
            ]
        );
        assert_eq!(
            mac(FileState::Identical, false, true),
            [Mac::EnableJob, Mac::Bootstrap]
        );
        assert_eq!(
            mac(FileState::Different(b"old".to_vec()), false, true),
            [
                Mac::BackupReplace(b"old".to_vec()),
                Mac::EnableJob,
                Mac::Bootstrap
            ]
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
