//! The `/auth/*` bodies (auth.md "Endpoints"). The web never sends them, so they have
//! no TypeScript; Swift mirrors them by hand. Errors are `ErrorBody`.

use serde::{Deserialize, Serialize};

/// `GET /auth/info`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthInfo {
    pub host_id: String,
    pub name: String,
    pub daemon_version: String,
    pub protocol: ProtocolRange,
    pub browser_origin: Option<String>,
    pub browser_refused: Option<String>,
    pub browser_pending: bool,
}

/// The protocol versions the daemon accepts, as in `hello`'s check.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolRange {
    pub min: u32,
    pub max: u32,
}

/// `POST /auth/enroll`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollRequest {
    pub code: String,
    pub device_name: String,
}

/// The token is shown once; the daemon keeps only its hash. `device_name` is the name
/// the device got, which may carry a `-2` suffix.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollResponse {
    pub token: String,
    pub device_name: String,
}

#[cfg(test)]
mod fixtures {
    use std::path::PathBuf;

    use super::*;
    use crate::proto::{ErrorBody, ErrorNode, HttpError};

    fn fixtures() -> Vec<(&'static str, serde_json::Value)> {
        vec![
            (
                "auth-info.json",
                serde_json::to_value(AuthInfo {
                    host_id: "a234567bcdefghjk".into(),
                    name: "pop-os".into(),
                    daemon_version: "0.0.1".into(),
                    protocol: ProtocolRange { min: 1, max: 1 },
                    browser_origin: None,
                    browser_refused: None,
                    browser_pending: false,
                })
                .expect("AuthInfo serializes"),
            ),
            (
                "auth-enroll-request.json",
                serde_json::to_value(EnrollRequest {
                    code: "enroll-fixture-code".into(),
                    device_name: "Jimmy's iPhone".into(),
                })
                .expect("EnrollRequest serializes"),
            ),
            (
                "auth-enroll-response.json",
                serde_json::to_value(EnrollResponse {
                    token: "fixture-device-token".into(),
                    device_name: "Jimmy's iPhone".into(),
                })
                .expect("EnrollResponse serializes"),
            ),
            (
                "error-bad-code.json",
                serde_json::to_value(ErrorBody {
                    error: HttpError::BadCode,
                    reason: None,
                    node: None,
                })
                .expect("ErrorBody serializes"),
            ),
            (
                "error-not-enrolled.json",
                serde_json::to_value(ErrorBody {
                    error: HttpError::NotEnrolled,
                    reason: None,
                    node: Some(ErrorNode {
                        name: "jimmy-iphone".into(),
                    }),
                })
                .expect("ErrorBody serializes"),
            ),
        ]
    }

    #[test]
    fn auth_json_fixtures_match_rust_wire_types() {
        let directory =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("ios/TetherKit/Tests/Fixtures/auth");
        if std::env::var("UPDATE_AUTH_FIXTURES").as_deref() == Ok("1") {
            std::fs::create_dir_all(&directory).expect("create auth fixture directory");
            for (name, fixture) in fixtures() {
                let json = serde_json::to_string_pretty(&fixture).expect("fixture is JSON");
                std::fs::write(directory.join(name), format!("{json}\n"))
                    .unwrap_or_else(|error| panic!("write {name}: {error}"));
            }
            return;
        }

        for (name, fixture) in fixtures() {
            let path = directory.join(name);
            let actual: serde_json::Value = serde_json::from_slice(
                &std::fs::read(&path).unwrap_or_else(|error| panic!("read {path:?}: {error}")),
            )
            .unwrap_or_else(|error| panic!("parse {path:?}: {error}"));
            assert_eq!(
                actual, fixture,
                "{name} is stale; run UPDATE_AUTH_FIXTURES=1 cargo test --lib proto::auth::fixtures"
            );
        }
    }
}
