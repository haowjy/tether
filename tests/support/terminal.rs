//! A `vt100` terminal and what it shows, for checking restore bytes and live output
//! against each other and against tmux.
#![allow(dead_code)]

use tether::tmux::Size;

pub fn terminal(size: Size) -> vt100::Parser {
    let nonzero = |n| std::num::NonZeroU16::new(n).expect("a pane has size");
    vt100::Parser::new(nonzero(size.rows), nonzero(size.cols), 0)
}

/// What a terminal shows and how it reacts to input: each cell's text and style, the
/// cursor, and the modes that change what a client sends. A blank is a blank whether
/// tmux drew it as a space or left it empty, and tmux clears a cell to its background
/// only, so a blank's foreground doesn't count.
pub fn look(term: &vt100::Parser, size: Size) -> impl PartialEq + std::fmt::Debug + use<> {
    let screen = term.screen();
    let cells = (0..size.rows)
        .flat_map(|row| (0..size.cols).map(move |col| (row, col)))
        .map(|(row, col)| {
            let cell = screen.cell(row, col).expect("cell in bounds");
            let (text, fg) = match cell.contents() {
                "" | " " => (" ", vt100::Color::Default),
                text => (text, cell.fgcolor()),
            };
            let style = [
                cell.bold(),
                cell.dim(),
                cell.italic(),
                cell.underline(),
                cell.inverse(),
            ];
            (text.to_owned(), fg, cell.bgcolor(), style)
        })
        .collect::<Vec<_>>();
    (
        cells,
        screen.cursor_position(),
        (screen.hide_cursor(), screen.alternate_screen()),
        (screen.application_cursor(), screen.application_keypad()),
        (
            screen.mouse_protocol_mode(),
            screen.mouse_protocol_encoding(),
        ),
    )
}
