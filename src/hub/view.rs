//! The coherent state of one watched session's shown window and claim target.

use std::collections::BTreeSet;

use super::ConnId;
use crate::tmux::{ClientId, PaneId, ServerInstance, SessionId, Size, Tag, WindowId};

/// One session view on a run of one endpoint's server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct ViewKey {
    pub(super) endpoint: usize,
    pub(super) server: ServerInstance,
    pub(super) session: SessionId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct WatchKey {
    pub(super) conn: ConnId,
    pub(super) watch: u32,
}

/// One Locate per view in flight; a trigger during it runs it again afterwards.
#[derive(Default)]
pub(super) struct Locate {
    pub(super) needed: bool,
    pub(super) in_flight: Option<Tag>,
}

pub(super) struct Stream {
    /// False: output is dropped until a snapshot lands.
    pub(super) live: bool,
    pub(super) size: Size,
    /// The snapshot that can make it live, and the watches whose credit it reserved.
    pub(super) inflight: Option<Inflight>,
}

pub(super) struct Inflight {
    pub(super) tag: Tag,
    pub(super) reserved: BTreeSet<WatchKey>,
}

pub(super) struct Vote {
    pub(super) size: Size,
    pub(super) confirmed: bool,
    pub(super) take_due: bool,
}

/// A watched session's current window and pane stream (§4.2, §4.3).
pub(super) struct View {
    pub(super) watches: BTreeSet<WatchKey>,
    pub(super) claim: Option<Claim>,
    pub(super) selecting: Option<Select>,
    /// The last coherent window/pane description from the owner's Locate.
    pub(super) shown: Option<ShownWindow>,
    /// The latest window reported by the owner, while its Locate is pending.
    pub(super) next: Option<WindowId>,
    pub(super) phase: ViewPhase,
    pub(super) locate: Locate,
    pub(super) stream: Stream,
}

pub(super) enum ViewPhase {
    Checking,
    Locating { owner: ClientId },
    Bound { owner: ClientId, pane: PaneId },
    Orphaned { client: ClientId },
}

pub(super) struct Claim {
    pub(super) watch: WatchKey,
    pub(super) take: Take,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Take {
    /// No claiming act is waiting to use a pending take condition.
    None,
    /// A watch or resize may take if the vote is due.
    Due,
    /// Fit always takes, whether or not the layout moved off the vote.
    Fit,
}

pub(super) struct Select {
    pub(super) window: WindowId,
    pub(super) replied: bool,
}

pub(super) struct ShownWindow {
    pub(super) id: WindowId,
    pub(super) index: u32,
    pub(super) name: String,
    pub(super) size: Size,
}

impl View {
    /// What a claim, vote, or act-yield applies to now.
    pub(super) fn target(&self) -> Option<WindowId> {
        self.selecting
            .as_ref()
            .map(|selection| selection.window)
            .or_else(|| {
                self.shown
                    .as_ref()
                    .map(|shown| self.next.unwrap_or(shown.id))
            })
    }

    pub(super) fn claim(&mut self, watch: WatchKey, take: Take) {
        self.claim = Some(Claim { watch, take });
    }

    /// A control-client notification changes the target, not the shown metadata.
    /// A Locate is still needed even if it confirms the window already shown.
    pub(super) fn window_reported(&mut self, window: WindowId) -> bool {
        if self.shown.as_ref().is_some_and(|shown| shown.id == window)
            && self.next.is_none()
            && self.selecting.is_none()
        {
            return false;
        }

        self.retarget(|view| {
            view.next = Some(window);
            if view
                .selecting
                .as_ref()
                .is_some_and(|selection| selection.window == window)
            {
                view.selecting = None;
            }
        });
        true
    }

    pub(super) fn select(&mut self, window: WindowId, watch: WatchKey) {
        self.retarget(|view| {
            view.selecting = Some(Select {
                window,
                replied: false,
            });
        });
        self.claim(watch, Take::None);
    }

    pub(super) fn created(&mut self, window: WindowId, watch: WatchKey) {
        if self.target() != Some(window) {
            self.retarget(|view| {
                view.selecting = Some(Select {
                    window,
                    replied: true,
                });
            });
        }
        self.claim(watch, Take::Due);
    }

    pub(super) fn select_replied(&mut self, window: WindowId) -> bool {
        let Some(selection) = self
            .selecting
            .as_mut()
            .filter(|selection| selection.window == window)
        else {
            return false;
        };
        selection.replied = true;
        true
    }

    pub(super) fn select_failed(&mut self, window: WindowId) {
        if self
            .selecting
            .as_ref()
            .is_none_or(|selection| selection.window != window)
        {
            return;
        }
        self.retarget(|view| view.selecting = None);
        self.claim = None;
    }

    /// Install one authoritative Locate answer without ever exposing mixed window
    /// metadata and pane ownership to `watching` or window-scoped event handlers.
    pub(super) fn located(
        &mut self,
        owner: ClientId,
        pane: PaneId,
        shown: ShownWindow,
    ) -> (bool, bool) {
        let window_changed = self
            .shown
            .as_ref()
            .is_none_or(|current| current.id != shown.id);
        let pane_changed = !matches!(self.phase, ViewPhase::Bound { owner: previous, pane: current } if previous == owner && current == pane);

        self.retarget(|view| {
            view.phase = ViewPhase::Bound { owner, pane };
            view.shown = Some(shown);
            view.next = None;
            if view
                .selecting
                .as_ref()
                .is_some_and(|selection| selection.replied)
            {
                view.selecting = None;
            }
        });
        (window_changed, pane_changed)
    }

    pub(super) fn yield_if(&mut self, window: WindowId) {
        if self.target() == Some(window) {
            self.claim = None;
        }
    }

    /// Retargeting away from a known window ends that window's turn. A pre-bind
    /// claim has no target yet and therefore survives the first reported window.
    fn retarget(&mut self, change: impl FnOnce(&mut Self)) {
        let previous = self.target();
        change(self);
        if previous.is_some() && self.target() != previous {
            self.claim = None;
        }
    }

    /// The control client currently associated with this view.
    pub(super) fn client(&self) -> Option<ClientId> {
        match self.phase {
            ViewPhase::Bound { owner, .. } | ViewPhase::Locating { owner } => Some(owner),
            ViewPhase::Checking | ViewPhase::Orphaned { .. } => None,
        }
    }
}

/// Whether a claiming act needs a vote, and whether that vote must take `latest`.
pub(super) fn vote_plan(previous: Option<&Vote>, size: Size, take: Take) -> Option<bool> {
    let Some(previous) = previous else {
        return Some(true);
    };
    if take == Take::Fit || (previous.take_due && take == Take::Due) {
        Some(true)
    } else if previous.size != size {
        Some(false)
    } else {
        None
    }
}
