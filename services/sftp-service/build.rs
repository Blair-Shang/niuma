fn main() {
    let version = std::env::var("NIUMMA_APP_VERSION")
        .unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_string());
    let build_id = std::env::var("NIUMMA_BUILD_ID").unwrap_or_else(|_| "dev".to_string());
    println!("cargo:rustc-env=NIUMMA_BUILD_VERSION={version}");
    println!("cargo:rustc-env=NIUMMA_BUILD_ID={build_id}");
}
