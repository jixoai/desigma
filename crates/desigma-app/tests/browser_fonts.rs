// Compile the real UI font setup in isolation. The full upstream unit-test tree
// includes native packaging fixtures removed by this WASM-only distribution.
#![allow(dead_code)]
#[path = "../src/theme.rs"]
mod theme;
