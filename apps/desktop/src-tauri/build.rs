fn main() {
  // Google sign-in reads these with option_env!, so a change must rebuild.
  println!("cargo:rerun-if-env-changed=GOOGLE_DESKTOP_CLIENT_ID");
  println!("cargo:rerun-if-env-changed=GOOGLE_DESKTOP_CLIENT_SECRET");
  tauri_build::build()
}
