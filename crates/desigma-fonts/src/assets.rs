use crate::FontRequest;

/// A font embedded in the binary.
#[derive(Clone, Copy, Debug)]
pub struct FontAsset {
    pub family: &'static str,
    pub italic: bool,
    /// Weight range covered (the file is a variable font when `min != max`).
    pub min_weight: u16,
    pub max_weight: u16,
    pub license: &'static str,
    pub data: &'static [u8],
}

/// Regular Chinese fallback shared by the WASM UI, canvas and export worker.
/// Kept separate from Inter so Latin metrics and document font choices stay intact.
pub static BROWSER_CJK: FontAsset = FontAsset {
    family: "FDE2E UI CJK",
    italic: false,
    min_weight: 400,
    max_weight: 400,
    license: "OFL-1.1",
    data: include_bytes!("../assets/cjk/FDE2E-UI-CJK-Regular.ttf"),
};

static BUNDLED: &[FontAsset] = &[
    FontAsset {
        family: "Inter",
        italic: false,
        min_weight: 100,
        max_weight: 900,
        license: "OFL-1.1",
        data: include_bytes!("../assets/inter/Inter[opsz,wght].ttf"),
    },
    FontAsset {
        family: "Inter",
        italic: true,
        min_weight: 100,
        max_weight: 900,
        license: "OFL-1.1",
        data: include_bytes!("../assets/inter/Inter-Italic[opsz,wght].ttf"),
    },
    #[cfg(target_arch = "wasm32")]
    BROWSER_CJK,
];

/// Fonts embedded in the binary; always available, no I/O.
pub fn bundled() -> &'static [FontAsset] {
    BUNDLED
}

/// The bundled asset serving `req`, if any (family match is case-insensitive).
pub fn bundled_for(req: &FontRequest) -> Option<&'static FontAsset> {
    BUNDLED.iter().find(|a| a.family.eq_ignore_ascii_case(req.family.trim()) && a.italic == req.italic)
}
