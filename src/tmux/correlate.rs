use std::collections::VecDeque;
use std::num::NonZeroUsize;

use bytes::Bytes;
use thiserror::Error;

use super::parse::{Block, BlockResult, Line};

pub type Body = Bytes;

/// One submitted command line and the number of replies it can produce.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Group {
    pub tag: u64,
    pub line: Bytes,
    pub expected_replies: NonZeroUsize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupDone {
    pub tag: u64,
    pub result: Result<Vec<Body>, GroupError>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupError {
    /// Replies from commands that succeeded before the error.
    pub replies: Vec<Body>,
    /// The body of the command that failed.
    pub body: Body,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CorrelatedLine {
    Line(Line),
    GroupDone(GroupDone),
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CorrelateError {
    #[error("tmux sent a flag-1 reply with no pending command group")]
    UnexpectedReply,
    #[error("tmux sent a reply block with unsupported flag {0}")]
    UnsupportedFlag(u8),
}

#[derive(Debug)]
struct Pending {
    tag: u64,
    expected: NonZeroUsize,
    replies: Vec<Body>,
}

#[derive(Debug, Default)]
pub struct Correlator {
    pending: VecDeque<Pending>,
}

impl Correlator {
    /// Queue the group and return its command line for the control-client writer.
    pub fn submit(&mut self, group: Group) -> Bytes {
        let Group {
            tag,
            line,
            expected_replies,
        } = group;
        self.pending.push_back(Pending {
            tag,
            expected: expected_replies,
            replies: Vec::with_capacity(expected_replies.get()),
        });
        line
    }

    /// Pass non-reply lines through and replace flag-1 blocks with inline completions.
    pub fn push(
        &mut self,
        line: Line,
        out: &mut Vec<CorrelatedLine>,
    ) -> Result<(), CorrelateError> {
        let Line::Block(block) = line else {
            out.push(CorrelatedLine::Line(line));
            return Ok(());
        };
        self.push_block(block, out)
    }

    fn push_block(
        &mut self,
        block: Block,
        out: &mut Vec<CorrelatedLine>,
    ) -> Result<(), CorrelateError> {
        match block.flag {
            0 => Ok(()),
            1 => {
                let Some(pending) = self.pending.front_mut() else {
                    return Err(CorrelateError::UnexpectedReply);
                };
                match block.result {
                    BlockResult::End => {
                        pending.replies.push(block.body);
                        if pending.replies.len() == pending.expected.get() {
                            let pending = self
                                .pending
                                .pop_front()
                                .ok_or(CorrelateError::UnexpectedReply)?;
                            out.push(CorrelatedLine::GroupDone(GroupDone {
                                tag: pending.tag,
                                result: Ok(pending.replies),
                            }));
                        }
                    }
                    BlockResult::Error => {
                        let pending = self
                            .pending
                            .pop_front()
                            .ok_or(CorrelateError::UnexpectedReply)?;
                        out.push(CorrelatedLine::GroupDone(GroupDone {
                            tag: pending.tag,
                            result: Err(GroupError {
                                replies: pending.replies,
                                body: block.body,
                            }),
                        }));
                    }
                }
                Ok(())
            }
            flag => Err(CorrelateError::UnsupportedFlag(flag)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tmux::parse::NotificationKind;

    fn group(tag: u64, expected: usize) -> Group {
        Group {
            tag,
            line: Bytes::from_static(b"display-message -p x"),
            expected_replies: NonZeroUsize::new(expected).expect("positive reply count"),
        }
    }

    fn block(flag: u8, result: BlockResult, body: &[&[u8]]) -> Line {
        Line::Block(Block {
            timestamp: 1,
            number: 2,
            flag,
            result,
            body: Bytes::from(
                body.iter()
                    .flat_map(|line| line.iter().copied().chain(std::iter::once(b'\n')))
                    .collect::<Vec<_>>(),
            ),
        })
    }

    #[test]
    fn matches_groups_fifo_and_yields_completion_inline() {
        let mut correlator = Correlator::default();
        let first_line = correlator.submit(group(7, 2));
        let next_line = correlator.submit(group(8, 1));
        assert_eq!(first_line, Bytes::from_static(b"display-message -p x"));
        assert_eq!(next_line, Bytes::from_static(b"display-message -p x"));

        let mut out = Vec::new();
        correlator
            .push(block(0, BlockResult::End, &[b"attach"]), &mut out)
            .expect("drop attach reply");
        correlator
            .push(
                Line::Notification(crate::tmux::parse::Notification {
                    kind: NotificationKind::Exit,
                    args: Bytes::new(),
                }),
                &mut out,
            )
            .expect("pass notification");
        correlator
            .push(block(1, BlockResult::End, &[b"a"]), &mut out)
            .expect("first reply");
        assert_eq!(out.len(), 1);
        correlator
            .push(block(1, BlockResult::End, &[b"b"]), &mut out)
            .expect("second reply");
        correlator
            .push(block(1, BlockResult::End, &[b"c"]), &mut out)
            .expect("third reply");

        assert_eq!(
            out,
            vec![
                CorrelatedLine::Line(Line::Notification(crate::tmux::parse::Notification {
                    kind: NotificationKind::Exit,
                    args: Bytes::new(),
                })),
                CorrelatedLine::GroupDone(GroupDone {
                    tag: 7,
                    result: Ok(vec![Bytes::from_static(b"a\n"), Bytes::from_static(b"b\n")]),
                }),
                CorrelatedLine::GroupDone(GroupDone {
                    tag: 8,
                    result: Ok(vec![Bytes::from_static(b"c\n")]),
                }),
            ]
        );
    }

    #[test]
    fn error_ends_group_early_with_successes_and_error_body() {
        let mut correlator = Correlator::default();
        correlator.submit(group(4, 3));
        let mut out = Vec::new();
        correlator
            .push(block(1, BlockResult::End, &[b"first"]), &mut out)
            .expect("first reply");
        correlator
            .push(block(1, BlockResult::Error, &[b"failed"]), &mut out)
            .expect("error reply");
        assert_eq!(
            out,
            vec![CorrelatedLine::GroupDone(GroupDone {
                tag: 4,
                result: Err(GroupError {
                    replies: vec![Bytes::from_static(b"first\n")],
                    body: Bytes::from_static(b"failed\n"),
                }),
            })]
        );
    }

    #[test]
    fn errors_when_reply_has_no_group_or_unknown_flag() {
        let mut correlator = Correlator::default();
        let mut out = Vec::new();
        assert_eq!(
            correlator.push(block(1, BlockResult::End, &[]), &mut out),
            Err(CorrelateError::UnexpectedReply)
        );
        correlator.submit(group(1, 1));
        assert_eq!(
            correlator.push(block(2, BlockResult::End, &[]), &mut out),
            Err(CorrelateError::UnsupportedFlag(2))
        );
    }
}
