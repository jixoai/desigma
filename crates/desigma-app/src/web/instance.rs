//! Browser opens arrive through the WebHandle instead of a native loopback listener.
use std::path::PathBuf;
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Open {
    File(PathBuf),
    Link(String),
}
