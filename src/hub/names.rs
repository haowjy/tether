//! How control JSON names tmux things: a server as `"<endpoint>:<pid>-<start_time>"`,
//! windows and sessions as refs on it, and tmux's texts cut to `NAME_LIMIT`.

use super::NAME_LIMIT;
use super::state::State;
use crate::proto::{SessionRef, WindowRef};
use crate::tmux::{ServerInstance, SessionId, WindowId};

impl State {
    pub(super) fn parse_server(&self, text: &str) -> Option<(usize, ServerInstance)> {
        let (name, instance) = text.split_once(':')?;
        let endpoint = self
            .endpoints
            .iter()
            .position(|endpoint| endpoint.name == name)?;
        Some((endpoint, instance.parse().ok()?))
    }

    pub(super) fn server_name(&self, endpoint: usize, server: ServerInstance) -> String {
        format!("{}:{server}", self.endpoints[endpoint].name)
    }

    pub(super) fn window_ref(
        &self,
        endpoint: usize,
        server: ServerInstance,
        window: WindowId,
    ) -> WindowRef {
        WindowRef {
            server: self.server_name(endpoint, server),
            window: window.0,
        }
    }

    pub(super) fn session_ref(
        &self,
        endpoint: usize,
        server: ServerInstance,
        session: SessionId,
    ) -> SessionRef {
        SessionRef {
            server: self.server_name(endpoint, server),
            session: session.0,
        }
    }
}

/// tmux names and error texts are cut to `NAME_LIMIT` bytes, which bounds every
/// control message.
pub(super) fn cut(mut text: String) -> String {
    if text.len() > NAME_LIMIT {
        let mut end = NAME_LIMIT;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
    }
    text
}
