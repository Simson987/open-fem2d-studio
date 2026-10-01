#!/usr/bin/env bash
# Start de actuele frontend en Tauri in ontwikkelmodus als één sessie.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND="$ROOT/design-mockup"
URL="http://127.0.0.1:1440"

# Een lokale Rust-toolchain buiten de gewone PATH.
if ! command -v cargo >/dev/null 2>&1 && [[ -x /tmp/open-fem-cargo/bin/cargo ]]; then
  export PATH="/tmp/open-fem-cargo/bin:$PATH"
  export CARGO_HOME="${CARGO_HOME:-/tmp/open-fem-cargo}"
  export RUSTUP_HOME="${RUSTUP_HOME:-/tmp/open-fem-rustup}"
fi

for program in node cargo pkg-config curl pgrep flock; do
  if ! command -v "$program" >/dev/null 2>&1; then
    echo "Ontbrekend programma: $program" >&2
    exit 1
  fi
done

if pgrep -f '^target/debug/open-fem-studio$' >/dev/null 2>&1; then
  echo "Open FEM Studio draait al. Het bestaande venster blijft gekoppeld aan $URL."
  exit 0
fi
exec 9>"/tmp/open-fem-desktop-dev-${UID}.lock"
if ! flock -n 9; then
  echo "De ontwikkelapp wordt al gestart; er komt geen tweede venster."
  exit 0
fi

if ! pkg-config --exists cairo gtk+-3.0 webkit2gtk-4.1; then
  LOCAL_SYSROOT="${OPEN_FEM_DEV_SYSROOT:-/tmp/open-fem-builddeps/root}"
  if [[ -d "$LOCAL_SYSROOT/usr/lib/x86_64-linux-gnu/pkgconfig" ]]; then
    export PKG_CONFIG_PATH="$LOCAL_SYSROOT/usr/lib/x86_64-linux-gnu/pkgconfig:$LOCAL_SYSROOT/usr/share/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
    export PKG_CONFIG_SYSROOT_DIR="$LOCAL_SYSROOT"
    export LIBRARY_PATH="$LOCAL_SYSROOT/usr/lib/x86_64-linux-gnu${LIBRARY_PATH:+:$LIBRARY_PATH}"
  fi
fi
if ! pkg-config --exists cairo gtk+-3.0 webkit2gtk-4.1; then
  echo "Ontbrekende Linux-bouwbibliotheken: cairo, GTK 3 of WebKitGTK 4.1." >&2
  echo "Installeer de ontwikkelpakketten voordat Tauri kan bouwen." >&2
  exit 1
fi

VITE_PID=""
cleanup() {
  if [[ -n "$VITE_PID" ]]; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if curl --fail --silent "$URL/@vite/client" >/dev/null; then
  if ! curl --fail --silent "$URL/src/App.tsx" | grep 'OpenFem3DEditor' >/dev/null; then
    echo "Poort 1440 bedient niet de frontend van dit project." >&2
    exit 1
  fi
  echo "Actuele frontend gevonden op $URL"
elif curl --fail --silent "$URL/" >/dev/null; then
  echo "Poort 1440 is in gebruik door een andere server." >&2
  exit 1
else
  echo "Frontend starten op $URL"
  (cd "$FRONTEND" && node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1440 --strictPort) &
  VITE_PID=$!
  for _ in {1..50}; do
    if curl --fail --silent "$URL/@vite/client" >/dev/null; then break; fi
    if ! kill -0 "$VITE_PID" 2>/dev/null; then
      echo "Frontend is onverwacht gestopt." >&2
      exit 1
    fi
    sleep 0.2
  done
  curl --fail --silent "$URL/@vite/client" >/dev/null || {
    echo "Frontend reageert niet op $URL." >&2
    exit 1
  }
fi

echo "Tauri-ontwikkelapp starten, live gekoppeld aan $URL"
cd "$ROOT"
export OPENAEC_GUI_CONTROL="${OPENAEC_GUI_CONTROL:-1}"
node "$FRONTEND/node_modules/@tauri-apps/cli/tauri.js" dev \
  --config '{"build":{"beforeDevCommand":"","devUrl":"http://127.0.0.1:1440"}}'
