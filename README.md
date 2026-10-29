<p align="center">
  <strong>Open FEM Studio</strong>
</p>

<p align="center">
  Open-source finite element program (2D and 3D) for structural analysis and code checking.<br>
  Part of the <a href="https://github.com/OpenAEC-Foundation">OpenAEC Foundation</a> portfolio.
</p>

<p align="center">
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-AGPL--3.0-D97706?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/contributions-welcome-D97706?style=flat-square" alt="Contributions welcome">
  <img src="https://img.shields.io/badge/status-alpha-B91C1C?style=flat-square" alt="Status: alpha">
</p>

> [!WARNING]
> **Alpha version: not suitable for production calculations.**
> Open FEM Studio is under heavy development. The solvers, code checks and report may contain errors and
> may change between versions. Do not use the results as the basis for structural calculations in real
> projects, and always verify them with an independent calculation.

Open FEM Studio is a desktop application (Windows, macOS, Linux) for modelling and analysing structures:
frames, trusses, beams and plates in 2D, and frames with shells, slabs and walls in 3D. It checks members
against the Eurocodes with the Dutch national annex and writes a calculation report as PDF. The user interface
is available in English, Dutch, German and French.

---

## Gallery

![Open FEM Studio: steel hall with bending moments](docs/images/app-overview.png)

The images below were made with the app from the [example projects](#example-projects) in [`examples/`](examples/).
All structures are fictitious.

| | |
|:---:|:---:|
| ![Steel hall](docs/images/steel-hall.png) | ![Glulam hall: unity checks](docs/images/glulam-hall-utilization.png) |
| **Steel hall** from the hall wizard: portal frames, purlins and tension-only bracing | **Glulam portal frame hall**: unity checks to EN 1995-1-1 (timber) and EN 1993-1-1 (steel rods) |
| ![Concrete office](docs/images/concrete-office.png) | ![Concrete office: slab moments](docs/images/concrete-office-slab-moments.png) |
| **Concrete office**: columns, beams and floor slabs | **Concrete office**: slab bending moments m<sub>xx</sub> (shell elements) in an ULS combination |
| ![Masonry house](docs/images/masonry-house.png) | ![Braced frame (2D)](docs/images/braced-frame-2d.png) |
| **Masonry house**: calcium silicate walls with openings and steel lintels on foundation beams | **Braced frame (2D)** under wind: the compressed tension-only diagonals drop out |

![Continuous beam (2D)](docs/images/continuous-beam-2d.png)
**Continuous beam (2D)**: bending moment, deflection and reactions for the imposed load on the first span only.

## Features

**Analysis**

- **2D**: beams, frames and trusses, plus plates loaded in their plane (wall plates); linear, second order
  (P-Δ) and physically non-linear analysis
- **3D**: frames with shell elements for slabs and walls, load panels that distribute area loads to the
  supporting beams, tension-only members, rigid diaphragms, elastic bedding under beams and plates, member end
  releases, tapered members, and masonry walls with openings and lintels; linear and second order
- Load cases, load combinations to EN 1990 (generated per consequence class with the Dutch national annex, or
  your own), envelopes, initial sway imperfections to EN 1993-1-1 §5.3.2
- A steel hall wizard that generates a complete hall (frames, purlins, eaves beams, roof and wall bracing,
  loads, optionally a concrete foundation grid on piles)

**Code checks** (Eurocodes with the Dutch national annex)

| Material | Standard |
|---|---|
| Steel | NEN-EN 1993-1-1 (cross-section, buckling, lateral-torsional buckling), longitudinal welds NEN-EN 1993-1-8 |
| Cold-formed steel | NEN-EN 1993-1-3 |
| Aluminium | NEN-EN 1999-1-1 |
| Reinforced concrete | NEN-EN 1992-1-1 (bending, shear, columns, M-N-κ, curtailment lines, crack widths and cover) |
| Timber and cross-laminated timber (CLT) | NEN-EN 1995-1-1 |
| Masonry | NEN-EN 1996-1-1 |
| Natural stone elements | strengths from testing (NEN-EN 1990 annex D) |
| Plates (2D wall plates loaded in their plane) | per element; plus a code-independent von Mises stress check |

The checks themselves are written in Rust; the ULS check forces always come from a second-order analysis with
imperfections, independent of the analysis type chosen for the results. The member checks of a 3D model with
plates (slabs, walls) are not available yet: the 3D engine has no geometric stiffness for shell elements, so the
required second-order analysis cannot be made, and the app says so instead of falling back to first order.

**Input and output**

- Calculation report as PDF
- Project files `.ifcfem` (older `.ifcfem2d` files still open); the installer associates both extensions
- IFC4 export of the analysis model together with the physical model, and `.ifcfemresults`: an IFC4 file with
  the analysis results (displacements, reactions, member forces, plate results, unity checks) and the project
  embedded
- Import of IFC4 structural analysis models into the 3D model
- Local import extensions for other file formats, see [using and writing extensions](docs/extensies.md) (Dutch)

**Automation**

- An MCP server (`openaec-mcp-server`) ships with the app. An AI assistant such as Claude Desktop or Claude Code
  can use it to run the solvers and code checks directly, edit `.ifcfem` project files without the app, and
  drive the running app: build models, solve, check, take screenshots and export reports
- Every command of the app's command register (`model3d.*`, `project.*`) is available as an MCP tool

## Example projects

Open any of these files with **File → Open** in the app. They are fictitious structures made to show what the
program can do, with common profiles and the standard load combinations of NEN-EN 1990 (consequence class CC2).

| File | Model | Shows |
|---|---|---|
| [`steel-hall.ifcfem`](examples/steel-hall.ifcfem) | 3D steel hall 36 × 24 m, eaves height 7 m, 6° duopitch roof; HEA 400 columns and IPE 500 rafters (S355), IPE 220 purlins, RD 24 bracing | Hall wizard, tension-only bracing, snow and wind cases, steel checks |
| [`glulam-portal-hall.ifcfem`](examples/glulam-portal-hall.ifcfem) | 3D glulam (GL24h) portal frames, span 12 m, five frames at 5 m, pinned purlins, RD 20 steel rod bracing | Timber checks, load panels on a pitched roof, tension-only cross rule, longitudinal wind |
| [`concrete-office.ifcfem`](examples/concrete-office.ifcfem) | 3D concrete frame, three storeys of 3.6 m, grid 3 × 7.2 m by 2 × 6.0 m; 400 × 400 columns, 300 × 600 beams, 250 mm slabs (C30/37) | Shell elements for slabs, area loads, office imposed load (category B), wind on the facade |
| [`masonry-house.ifcfem`](examples/masonry-house.ifcfem) | 3D house 8.4 × 6.0 m with 120 mm calcium silicate walls, window openings with HEA 100/120 lintels, 400 × 500 concrete foundation beams on piles | Masonry walls (orthotropic shells) with lintels |
| [`continuous-beam-2d.ifcfem`](examples/continuous-beam-2d.ifcfem) | 2D continuous IPE 360 beam over three spans of 6 m | One imposed load case per span (pattern loading) in the standard combinations, steel checks |
| [`braced-frame-2d.ifcfem`](examples/braced-frame-2d.ifcfem) | 2D two-storey steel frame, one bay of 6 m; HEA 200 columns, IPE 330 beams with pinned ends, L 70x70x7 cross bracing | Tension-only bracing, steel checks |

## Installation

Download the installer for your platform from the
[Releases](https://github.com/OpenAEC-Foundation/open-fem-studio/releases) page:

- **Windows:** `.exe` (NSIS installer) or `.msi`
- **macOS:** `.dmg` (universal)
- **Linux:** `.AppImage` or `.deb`; signatures (`.asc`) and checksums (`SHA256SUMS`) are published alongside

The installers also place the MCP server next to the app. To connect an AI assistant, open
**Settings → AI assistant (MCP)** in the app: it shows the path of the server, a button to add it to Claude
Desktop, and the command for Claude Code. Driving the running app is only possible on the same computer and
can be switched off there. See the [MCP server README](src-tauri/crates/openaec-mcp-server/README.md) for all
tools.

## Building from source

Requirements: Node.js 22, the Rust toolchain via [rustup](https://rustup.rs/), and on Windows the WebView2
runtime. On Linux you also need the development packages for GTK 3, WebKitGTK 4.1 and Cairo.

```bash
npm install                                  # root: the Tauri CLI
npm --prefix design-mockup install           # the frontend

# from the repository root:
npm run tauri:dev     # desktop app in development mode (dev server on port 1440)
npm run tauri:build   # installer; also builds the frontend, the solver bundle and the MCP server
```

On Linux, `bash scripts/dev-desktop.sh` starts the frontend dev server and the Tauri app as one session.

### Repository layout

| Path | Contents |
|---|---|
| `design-mockup/` | **The application (v2).** React 19, TypeScript, Vite 7, zustand, i18next. The folder name is historical: this is the app that is built and released. |
| `design-mockup/src/core/` | The 2D FEM core in TypeScript (bar, triangle, quadrilateral and DKT elements; linear, second order and non-linear solvers; plate mesher) |
| `src-tauri/` | Tauri v2 desktop shell and the Rust workspace |
| `src-tauri/crates/` | Code checks (`nen-en-*`, `*-check`), the 3D solver adapter (`open-fem-3d`), the PDF report, `toetsbrug` (checks as JSON over stdin/stdout for the browser dev server) and `openaec-mcp-server` |
| `src/` | The first version of the app (v1), frozen and no longer built |
| `docs/` | Documentation (mostly in Dutch) and verification against closed-form solutions and NAFEMS benchmarks |
| `examples/`, `voorbeelden/` | Example projects |

### Tests

```bash
cd src-tauri
cargo build --release -p toetsbrug -p openaec-mcp-server    # the JS tests call these binaries

cd ../design-mockup
npx tsc --noEmit
node scripts/run-tests.mjs            # all test-*.mjs against the source
node scripts/run-tests.mjs --bundel   # adapter tests against the solver bundle

cd ../src-tauri
cargo test --workspace --exclude open-fem-studio
```

After a change to the solver core or `engine.ts`, rebuild the MCP solver bundle with `npm run build:sidecar` in
`design-mockup/`. Verification of the 3D core is documented in
[`docs/verificatie/3d-raamwerk/`](docs/verificatie/3d-raamwerk/README.md) and
[`docs/verificatie/nafems/`](docs/verificatie/nafems/README.md).

## Versioning

Versions follow the OpenAEC Blueprint scheme **YYYY.W.N**: year, ISO week (no leading zero) and a sequence
number within that week starting at 0, for example `2026.44.0`. Git tags are `vYYYY.W.N`; a tag starts the
release workflow, which builds the installers and publishes a draft release. `npm run versie` shows and checks
every place where the number is stored (`npm run versie -- --set 2026.44.1` changes them all).

## License

| Part | License |
|---|---|
| Open FEM Studio as a whole: the app (`design-mockup/`, `src-tauri/`), toetsbrug, MCP server, reporting and the 3D solver adapter | **AGPL-3.0-or-later**, see [LICENSE.md](LICENSE.md) |
| Code-check libraries in `src-tauri/crates/`: `nen-en-*`, `*-check`, `section-properties`, `steel-profiles`, `nationale-bijlage`, `mechanics` | **LGPL-3.0-or-later**, see [LICENSES/LGPL-3.0-or-later.md](LICENSES/LGPL-3.0-or-later.md) |
| `openaec-layout` | MIT (see the crate) |
| Documentation and images | CC BY-SA 4.0 |

The app is AGPL because the 3D frame analysis links an external solver licensed under AGPL-3.0 (source and
pinned revision: `src-tauri/crates/open-fem-3d/Cargo.toml`). Anyone who modifies the app and offers it, also as a
network service, must make the source code of that version available. The code checks remain usable as
libraries under LGPL-3.0-or-later.

## About the OpenAEC Foundation

The OpenAEC Foundation develops free, open-source software for the built environment.
Build free. Build together. [openaec.org](https://github.com/OpenAEC-Foundation)
