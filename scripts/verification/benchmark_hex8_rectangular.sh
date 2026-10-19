#!/usr/bin/env bash
# Run the full typed matrix-free Hex8 box patch at 63^3 = 250,047 cells.
# Pass a smaller cells-per-axis value for a quick smoke check.
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../.." && pwd)
temporary_project=$(mktemp -d /tmp/open-fem-hex8-rectangular.XXXXXX)
trap 'rm -rf "$temporary_project"' EXIT
mkdir -p "$temporary_project/src"
cp "$script_dir/benchmark_hex8_rectangular.rs" "$temporary_project/src/main.rs"
cat > "$temporary_project/Cargo.toml" <<EOF
[package]
name = "hex8-rectangular-verification"
version = "0.1.0"
edition = "2021"

[dependencies]
openaec-native-fem = { path = "$repo_root/src-tauri/crates/native-fem" }
serde_json = "1"
EOF

target_dir="$repo_root/src-tauri/target"
if command -v cargo >/dev/null 2>&1; then
    cargo_bin=$(command -v cargo)
else
    cargo_bin="${CARGO_HOME:-$HOME/.cargo}/bin/cargo"
fi
"$cargo_bin" build --release --offline --manifest-path "$temporary_project/Cargo.toml" --target-dir "$target_dir"
/usr/bin/time -f 'peakRSSKiB=%M' "$target_dir/release/hex8-rectangular-verification" "${1:-63}"
