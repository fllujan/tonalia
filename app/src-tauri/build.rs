fn main() {
    // Expose the target triple so dev builds can find `binaries/<name>-<triple>`.
    println!(
        "cargo:rustc-env=TONALIA_TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("TARGET is set by cargo")
    );
    tauri_build::build()
}
