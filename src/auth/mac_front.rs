//! Identity and wiring for the Mac's path-secret Serve front.

use std::fmt;
use std::sync::Arc;

use axum::http::{Uri, uri::Authority};
use base64::Engine as _;

use crate::http::Front;

use super::identity::ServeTarget;
use super::publish::Publication;

#[derive(Clone)]
pub struct MacFront {
    port: u16,
    secret: Arc<str>,
}

impl MacFront {
    pub fn generate(port: u16) -> Result<Self, getrandom::Error> {
        let mut random = [0; 32];
        getrandom::fill(&mut random)?;
        let secret = format!(
            "tether-{}",
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random)
        );
        Ok(Self::new(port, secret))
    }

    pub fn new(port: u16, secret: impl Into<Arc<str>>) -> Self {
        Self {
            port,
            secret: secret.into(),
        }
    }

    pub fn proxy_url(&self) -> String {
        format!(
            "http://127.0.0.1:{}/{secret}",
            self.port,
            secret = self.secret
        )
    }

    /// Matches a previous tether proxy without parsing URL syntax. The path format is
    /// deliberately exact because Serve config is untrusted input at this boundary.
    pub fn is_tether_shaped(proxy: &str, port: Option<u16>) -> bool {
        let Some(target) = proxy.strip_prefix("http://127.0.0.1:") else {
            return false;
        };
        let Some((port_text, secret)) = target.split_once('/') else {
            return false;
        };
        let Ok(found_port) = port_text.parse::<u16>() else {
            return false;
        };
        if found_port == 0
            || port.is_some_and(|wanted| wanted != found_port)
            || port_text != found_port.to_string()
        {
            return false;
        }
        let Some(secret) = secret.strip_prefix("tether-") else {
            return false;
        };
        secret.len() == 43
            && secret
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    }

    pub(super) fn references_port(&self, proxy: &str) -> bool {
        proxy
            .parse::<Uri>()
            .ok()
            .and_then(|uri| uri.port_u16())
            .or_else(|| {
                proxy
                    .parse::<Authority>()
                    .ok()
                    .and_then(|authority| authority.port_u16())
            })
            .is_some_and(|port| port == self.port)
    }

    pub fn into_parts(self) -> (ServeTarget, Publication, Front) {
        let target = ServeTarget::loopback(self.clone());
        let (publication, state) = Publication::new(self.clone());
        let front = Front::loopback(&self.secret, state);
        (target, publication, front)
    }

    pub(super) fn port(&self) -> u16 {
        self.port
    }
}

impl fmt::Debug for MacFront {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MacFront")
            .field("port", &self.port)
            .field("secret", &"<redacted>")
            .finish()
    }
}
