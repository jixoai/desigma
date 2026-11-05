#![cfg_attr(all(windows, not(debug_assertions), not(test)), windows_subsystem = "windows")]

fn main() {
    desigma_app::run_native();
}
