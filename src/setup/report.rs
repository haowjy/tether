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

pub(crate) fn render_success(
    report: &Success<'_>,
    terminal: bool,
) -> Result<String, qrcode::types::QrError> {
    let mut output = match report.mode {
        Mode::Service(service) => format!(
            "tether {} is running as your {}, {}",
            report.version, service.name, service.startup
        ),
        #[cfg(target_os = "linux")]
        Mode::Foreground => format!(
            "tether {} is running in this terminal; Ctrl-C stops it",
            report.version
        ),
    };
    if let Some(previous) = report.previous_version {
        output.push_str(&format!(" (was {previous})"));
    }
    output.push_str(".\n");
    if report.changes.is_empty() {
        output.push_str("Nothing else to change.\n");
    } else {
        for change in report.changes {
            output.push_str(change);
            output.push('\n');
        }
    }
    if !report.notes.is_empty() {
        output.push_str("Notes:\n");
        for note in report.notes {
            output.push_str("- ");
            output.push_str(note);
            output.push('\n');
        }
    }
    output.push_str(&format!(
        "Published on your tailnet:\n\n  {}\n",
        report.origin
    ));
    if terminal {
        let code = qrcode::QrCode::new(report.origin.as_bytes())?;
        output.push('\n');
        output.push_str(&code.render::<Dense1x2>().build());
        output.push('\n');
    }
    let cleanup = if matches!(report.mode, Mode::Service(_)) {
        "`tether enroll` prints a new code. `tether teardown` removes all of this."
    } else {
        "`tether enroll` prints a new code. The Serve entry stays when you stop tether; `tether teardown` removes it."
    };
    output.push_str(&format!(
        "\nEnrolment code: {}, for one device, valid for 10 minutes.\n  Phone browser: scan the QR code or open the link, then enter the code.\n  iOS app: Add host, {}, code {}.\n{cleanup}\n",
        report.code,
        report.origin
            .strip_prefix("https://")
            .unwrap_or(report.origin),
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
        let encoded = base64::engine::general_purpose::STANDARD.encode(report.origin);
        write!(stdout, "\x1b]52;c;{encoded}\x07")?;
        stdout.write_all(b"Copied the link to your clipboard (if your terminal allows it).\n")?;
    }
    stdout.flush()
}
