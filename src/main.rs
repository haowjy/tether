#![forbid(unsafe_code)]

use clap::Parser;

/// Phone-first client for tmux sessions on a dev server.
#[derive(Parser)]
#[command(version, about)]
struct Cli {}

fn main() {
    let _cli = Cli::parse();
}
