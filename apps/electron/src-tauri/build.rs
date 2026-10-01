fn main() {
    // include_image! embeds the tray art at macro expansion without a
    // dep-info entry, so cargo never notices tray-art changes on its own;
    // these directives make a changed PNG rerun the build script and the
    // crate with it.
    for png in ["icons/tray-16.png", "icons/tray-24.png", "icons/tray-32.png"] {
        println!("cargo:rerun-if-changed={png}");
    }
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "dsh_quit",
                "dsh_minimize",
                "dsh_toggle_maximize",
                "dsh_close",
                "dsh_start_drag",
                "dsh_open_external",
                "dsh_notify",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}
