//! User-facing setup success output.

use std::io::{self, IsTerminal, Write};

use base64::Engine as _;
use qrcode::render::unicode::Dense1x2;

#[derive(Clone, Copy)]
pub(crate) struct ServiceKind {
    pub name: &'static str,
    pub startup: &'static str,
}

#[derive(Clone, Copy)]
pub(crate) enum Mode {
    #[cfg(target_os = "linux")]
    Foreground,
    Service(ServiceKind),
}

pub(crate) struct Success<'a> {
    pub version: &'a str,
    pub previous_version: Option<&'a str>,
    pub mode: Mode,
    pub changes: &'a [String],
    pub notes: &'a [String],
    pub origin: &'a str,
    pub code: &'a str,
}

fn enrolment_link(report: &Success<'_>) -> String {
    format!("{}/#code={}", report.origin, report.code)
}

pub(crate) fn render_success(
    report: &Success<'_>,
    terminal: bool,
) -> Result<String, qrcode::types::QrError> {
    let link = enrolment_link(report);
    let mut output = match report.mode {
        Mode::Service(service) => format!(
            "tether {} is running as your {} and {}",
            report.version, service.name, service.startup
        ),
        #[cfg(target_os = "linux")]
        Mode::Foreground => format!(
            "tether {} is running in this terminal. Ctrl-C stops it",
            report.version
        ),
    };
    if let Some(previous) = report.previous_version {
        output.push_str(&format!(" (was {previous})"));
    }
    output.push_str(".\n");
    for change in report.changes {
        output.push_str(change);
        output.push('\n');
    }
    if !report.notes.is_empty() {
        output.push_str("Notes:\n");
        for note in report.notes {
            output.push_str("- ");
            output.push_str(note);
            output.push('\n');
        }
    }
    output.push_str(&format!("\n  {link}\n"));
    if terminal {
        // The render carries its own quiet zone: blank rows above and below.
        let code = qrcode::QrCode::new(link.as_bytes())?;
        output.push_str(&code.render::<Dense1x2>().build());
        output.push('\n');
    } else {
        output.push('\n');
    }
    output.push_str(&format!(
        "Enrolment code: {} (one device, 10 minutes)\nFor another device, run `tether enroll`.\n",
        report.code
    ));
    Ok(output)
}

pub(crate) fn print_success(report: &Success<'_>) -> io::Result<()> {
    let terminal = io::stdout().is_terminal();
    let output = render_success(report, terminal).map_err(io::Error::other)?;
    let mut stdout = io::stdout().lock();
    stdout.write_all(output.as_bytes())?;
    if terminal {
        let encoded = base64::engine::general_purpose::STANDARD.encode(enrolment_link(report));
        // OSC 52: copies the link where the terminal allows it; others ignore it.
        write!(stdout, "\x1b]52;c;{encoded}\x07")?;
    }
    stdout.flush()
}
