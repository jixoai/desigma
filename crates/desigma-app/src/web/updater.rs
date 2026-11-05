//! Browser releases are updated by the service worker after saving the current document.
use crate::app::App;
#[derive(Default)]
pub struct UpdaterState {
    pub dialog: bool,
    pub no_auto_check: bool,
    pub pending_restart: bool,
}
impl UpdaterState {
    pub fn start(&mut self, _: Option<&std::path::Path>, _: bool) {}
}
impl App {
    pub fn check_for_updates(&mut self, _: &egui::Context, _: bool) {
        self.show_toast("Reload the page to check for a browser update. Your library is saved on this device.", false);
    }
    pub fn poll_updater(&mut self, _: &egui::Context) {}
    pub fn poll_install(&mut self, _: &egui::Context) {}
    pub fn confirm_restart(&mut self) {
        self.updater.pending_restart = false;
    }
    pub fn toggle_update_check(&mut self) {
        self.updater.no_auto_check = !self.updater.no_auto_check;
    }
}
pub fn preset(_: &mut App, _: &str) {}
pub mod install {
    pub fn run_stashed() {}
}
pub mod ui {
    pub fn show(_: &mut crate::app::App, _: &egui::Context) {}
}
