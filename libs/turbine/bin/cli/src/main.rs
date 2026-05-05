mod cmd_lib;

use clap::{Parser, Subcommand};
use error_stack::{Result, ResultExt};
use thiserror::Error;

use crate::cmd_lib::Lib;

#[derive(Subcommand, Debug)]
pub(crate) enum Command {
    Lib(Lib),
}

#[derive(Parser, Debug)]
pub(crate) struct Cli {
    #[command(subcommand)]
    pub(crate) command: Command,
}

#[derive(Debug, Copy, Clone, Error)]
#[error("unable to execute cli command")]
pub struct Error;

// TODO: init tracing
fn main() -> Result<(), Error> {
    let cli: Cli = Cli::parse();

    match cli.command {
        Command::Lib(lib) => cmd_lib::execute(lib).change_context(Error),
    }
}
