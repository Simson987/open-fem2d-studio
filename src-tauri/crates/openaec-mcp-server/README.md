# openaec-mcp-server

Model Context Protocol (MCP) server that exposes the **Open FEM Studio** /
**OpenAEC** check engines and the 2D FEM solver to MCP clients (Claude Desktop,
Claude Code, etc.). It speaks JSON-RPC 2.0 over stdio and wraps the same
Rust crates the Tauri desktop app uses, so a tool call from Claude returns
byte-identical results to clicking through the UI.

The 51 fixed tools, in ten groups (the exact roster is pinned by
`tests/stdio_roundtrip.rs` and `tests/drie_wegen_kruistabel.rs`), plus one tool
per command of the app's command register — see *Commando's uit de app*:

| group | tools |
|---|---|
| steel — EN 1993-1-1 | `list_steel_profiles`, `list_steel_grades`, `check_steel_beam`, `compute_section_properties` |
| timber and CLT — EN 1995-1-1 | `list_timber_grades`, `check_timber_beams`, `list_clt_presets`, `check_clt_beams` |
| concrete — EN 1992-1-1 | `list_concrete_classes`, `list_reinforcement_grades`, `list_exposure_classes`, `check_concrete_beam`, `concrete_column_check`, `concrete_mn_kappa`, `concrete_segment_stiffness`, `concrete_dekkingslijn`, `concrete_effective_flange_width`, `concrete_cover_check`, `concrete_creep_coefficient` |
| plates (wall plates loaded in their plane) | `check_plates` |
| 2D FEM solver | `fem_solver_status`, `validate_fem_model`, `load_fem_project`, `solve_fem_model`, `check_fem_model` |
| 3D frame and plate solver | `solve_open_fem_3d` |
| 3D steel hall (generator, optionally solved and checked) | `open_fem_3d_staalhal_maken` |
| IFC4 structural analysis model import (optionally solved and checked) | `open_fem_3d_ifc_importeren` |
| reporting | `generate_steel_report_pdf` |
| driving the running app | twenty-two `gui_*` tools, see the last section |
| the app's command register: 3D model, project, undo | one tool per command (`model3d_*`, `project_*`, `app_*`), generated from the app's catalogue — see *Commando's uit de app* |

`generate_steel_report_pdf` sits in its own group on purpose: the name is
historical, but the report carries steel, timber, cross-laminated timber,
concrete, plates and the norm-independent stress check. Filing it under steel
would suggest it only renders EN 1993-1-1.

**Belastingen.** In het 3D-model heeft elke soort last een eigen tool
(`model3d_load_nodal_add`, `model3d_load_member_add`, …; zie *Commando's uit de
app*). In het 2D-model nog niet: `solve_fem_model` en `check_fem_model` nemen
`loadCases`, `loads` en (optioneel) `combinations` mee in het verzoek;
`gui_build_model` bouwt ze in de draaiende app op. Een 2D-last erbij betekent
het model opnieuw sturen.

**De drie wegen.** Elke rekenkern in dit project hoort langs drie wegen
bereikbaar te zijn: een Tauri-command (de desktop-app), een opdracht in
`crates/toetsbrug` (de dev-server) en deze MCP-server.
`tests/drie_wegen_kruistabel.rs` bewaakt dat geen kern een weg mist; de
`tests/drie_wegen_*.rs` sturen per kern (beton, hout, kolom, dekking,
dekkingslijn, kruip, plaat, nationale bijlage, …) dezelfde JSON door alle drie
de wegen en eisen dat de antwoorden veld voor veld gelijk zijn. Voor staal
bestaat zo'n vergelijking nog niet.

Not exposed: the free stress check (von Mises against an allowable stress) and
fillet welds — both are reachable through the Tauri commands and the toetsbrug.

## Get the binary

**With the installer (from version 0.3.15).** The desktop installers ship the
server next to the app, so no Rust toolchain is needed:

| platform | path |
|---|---|
| Windows | `%LOCALAPPDATA%\Open FEM Studio\openaec-mcp-server.exe` |
| macOS | `/Applications/Open FEM Studio.app/Contents/MacOS/openaec-mcp-server` |
| Linux (.deb) | `/usr/bin/openaec-mcp-server` |

It is wired in through `bundle.externalBin` in `src-tauri/tauri.bundel.conf.json`,
which only the release build passes (`npm run tauri:build`, and the release
workflow). `scripts/mcp-sidecar.mjs` builds the server first and puts it in
`src-tauri/binaries/` under the target triple Tauri asks for; `tauri dev` and
`cargo check` do not need it.

The check tools run entirely inside the binary. The **FEM tools**
(`solve_fem_model`, `check_fem_model`, …) run the solver bundle in a Node
sidecar and need **Node ≥ 20** on the PATH; `fem_solver_status` says whether
that chain is complete, and the other tools keep working without it.

## Build from source

The server lives in the same Cargo workspace as the rest of OpenAEC.

```bash
cd src-tauri
cargo build --release -p openaec-mcp-server
```

The binary is produced at:

```
src-tauri/target/release/openaec-mcp-server         # Linux/macOS
src-tauri/target/release/openaec-mcp-server.exe     # Windows
```

The binary is fully self-contained (the steel-profile catalogue and PDF fonts
are baked in via `include_bytes!`). No data files need to ship alongside it.

## Wire it into Claude Desktop / Claude Code

Add an entry to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "openaec-fem": {
      "command": "C:\\Users\\you\\AppData\\Local\\Open FEM Studio\\openaec-mcp-server.exe"
    }
  }
}
```

The config file lives at:

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Restart Claude Desktop after editing. All 51 tools should appear in the tools
picker. For Claude Code:

```bash
claude mcp add openaec-fem -- "C:\Users\you\AppData\Local\Open FEM Studio\openaec-mcp-server.exe"
```

To raise the log level (logs go to **stderr** so they never collide with
JSON-RPC traffic on stdout), set the env var `OPENAEC_MCP_LOG=debug`:

```json
{
  "mcpServers": {
    "openaec-fem": {
      "command": "C:\\path\\to\\openaec-mcp-server.exe",
      "env": { "OPENAEC_MCP_LOG": "debug" }
    }
  }
}
```

## Tools

All tool I/O matches the existing `ts-rs`-generated TypeScript types in
`src/lib/types/steel/` and `src/lib/types/concrete/`, so the same JSON shapes
work for both Tauri and MCP callers.

### `list_steel_profiles`

Returns every profile in the catalogue (HEA, HEB, HEM, IPE, UNP, RHS, SHS,
CHS) with geometry, section properties, and EN 1993-1-1 buckling curves.

**Request**:
```json
{ "name": "list_steel_profiles", "arguments": {} }
```

**Response** (truncated):
```json
{
  "profiles": [
    {
      "name": "HEA200",
      "kind": "ISection",
      "geometry": { "h": 190, "b": 200, "tw": 6.5, "tf": 10, "r": 18 },
      "properties": { "area_mm2": 5380, "iy_mm4": 36900000, ... },
      "buckling_curves": { "y_axis": "b", "z_axis": "c" }
    },
    ...
  ]
}
```

### `list_steel_grades`

Returns the supported EN 10025 grades and their material constants.

**Request**:
```json
{ "name": "list_steel_grades", "arguments": {} }
```

**Response**:
```json
{
  "grades": [
    { "name": "S235", "fy_mpa": 235, "fu_mpa": 360,
      "gamma_m0": 1.0, "gamma_m1": 1.0, "gamma_m2": 1.25 },
    ...
  ]
}
```

### `check_steel_beam`

Runs the full §6.2 cross-section + §6.3 stability + SLS-deflection check on
one beam. Input matches `BeamCheckInput` exactly; output matches
`BeamCheckResult` exactly (including all derivation steps with LaTeX
formulae, intermediate values, and unity-check ratios per check).

**Minimal request**:
```json
{
  "name": "check_steel_beam",
  "arguments": {
    "beam_id": 1,
    "profile_name": "HEA200",
    "steel_grade": "S235",
    "length_m": 5.0,
    "forces_envelope": [
      { "combination_id": 1, "position_mm": 0,
        "forces": { "n_ed": -100, "vy_ed": 0, "vz_ed": 25,
                    "mt_ed": 0, "my_ed": 0, "mz_ed": 0 } },
      { "combination_id": 1, "position_mm": 2500,
        "forces": { "n_ed": -100, "vy_ed": 0, "vz_ed": 0,
                    "mt_ed": 0, "my_ed": 31.25, "mz_ed": 0 } },
      { "combination_id": 1, "position_mm": 5000,
        "forces": { "n_ed": -100, "vy_ed": 0, "vz_ed": -25,
                    "mt_ed": 0, "my_ed": 0, "mz_ed": 0 } }
    ],
    "lateral_bracing": { "top_flange_positions": [], "bottom_flange_positions": [] },
    "buckling_length_y_m": 5.0,
    "buckling_length_z_m": 5.0,
    "deflection_limit_class": "Floor",
    "deflection_limit_numerator": 250,
    "deflection_actual_max_mm": 8.0,
    "is_cantilever": false,
    "consequence_class": "CC2"
  }
}
```

`deflection_limit_class` kiest de NB-categorie voor de **bijkomende**
doorbuiging w_add (= w2 + w3), volgens NEN-EN 1990:2002/NB:2019 A1.4.3(3):

| klasse | grens voor w_add | NB-categorie |
|---|---|---|
| `Floor` | 3/1 000 · ℓ_rep | overige vloeren en daken die intensief door personen worden gebruikt (2e streepje) |
| `FloorBrittlePartitions` | ℓ_rep/500 | vloeren die scheurgevoelige scheidingswanden dragen (1e streepje) |
| `Roof` | ℓ_rep/250 | overige daken (3e streepje) |
| `Cantilever` | als `Floor`, maar met ℓ_rep = 2 × de uitkraaglengte | verklaring bij ℓ_rep |
| `Custom` | de opgegeven `deflection_limit_numerator`, op de staaflengte | geen |

Het optionele veld `deflection_add_limit_numerator` (default 0 = de tabel
hierboven) overschrijft die noemer en rekent op de staaflengte. Gebruik het
alleen om een externe referentie-uitwerking met een vaste noemer na te rekenen;
het antwoord vermeldt dan in `notes` dat de noemer is opgegeven en niet uit de
norm volgt.

**Response shape**:
```json
{
  "beam_id": 1,
  "profile_name": "HEA200",
  "steel_grade": "S235",
  "classification": "Class1",
  "checks": [ ... 12 NamedCheck entries ... ],
  "uc_max": 0.42,
  "status": "Ok",
  "governing_check_id": "EN1993-1-1_6.3.3_NMy"
}
```

### `compute_section_properties`

Recomputes section properties from the catalogue **geometry** (so the result
is independent of the catalogue's stored property values — useful for
spot-checking). Dispatches to `i_section_props`, `channel_section_props`, or
`rhs_section_props` based on `ProfileKind`. CHS profiles fall back to
catalogue values (no analytical helper exists yet — see "Known limitations").

**Request**:
```json
{ "name": "compute_section_properties", "arguments": { "profile_name": "HEA200" } }
```

**Response**: a `SectionProperties` object — `area_mm2`, `iy_mm4`, `iz_mm4`,
`wel_y_mm3`, `wpl_y_mm3`, `it_mm4`, `iw_mm6`, `iy_radius_mm`, etc.

### `generate_steel_report_pdf`

Renders a complete constructive-check PDF report (OpenAEC-branded, A4 portrait,
multi-page) from check results — typically the output of one or more prior
`check_steel_beam` / `check_concrete_beam` calls. Returns the PDF as base64
because MCP transports JSON, not binary.

Despite the name, the report is material-neutral. Five result arrays feed it:
`steel_check_results` (EN 1993-1-1), `timber_check_results` (EN 1995-1-1),
`clt_check_results` (EN 1995-1-1, cross-laminated timber), `concrete_check_results`
(EN 1992-1-1) and `stress_check_results` (no standard — von Mises against an
allowable stress). Only `steel_check_results` is schema-required; for a report
without steel, pass it as `[]`. The cover and the page header name **only** the
standards actually present, and claim none when nothing was checked.

`concrete_stiffness_trace` is optional as well and adds the chapter "Beton —
fysisch niet-lineaire tweede orde": per load combination the assumptions
(analysis type, segment length, number of rounds, convergence criterion with
the value reached), the segment stiffness table per member, and the four
concrete figures — cross-section with cage, M-κ, N-M interaction and the EI
distribution along the member. Its shape mirrors
`design-mockup/src/stores/betonStijfheidStore.ts`; see `report::betonspoor`.
Omit it and the chapter states, honestly, that no physically non-linear round
was run.

**Request**:
```json
{
  "name": "generate_steel_report_pdf",
  "arguments": {
    "project_name":   "Demo Project",
    "project_number": "P-2026-001",
    "engineer":       "M. Vroegindeweij",
    "company":        "OpenAEC Foundation",
    "date":           "2026-05-16",
    "steel_check_results": [ /* BeamCheckResult objects; [] for a report without steel */ ],
    "timber_check_results":     [ /* optional TimberBeamCheckResult objects */ ],
    "clt_check_results":        [ /* optional CltBeamCheckResult objects */ ],
    "concrete_check_results":   [ /* optional ConcreteBeamCheckResult objects */ ],
    "stress_check_results":     [ /* optional SpanningBeamCheckResult objects */ ],
    "concrete_stiffness_trace": { /* optional BetonStijfheidSpoor */ }
  }
}
```

**Response**:
```json
{
  "pdf_base64": "JVBERi0xLjcK...",
  "byte_count": 124852
}
```

Decode the base64 and write to disk to view. The PDF renders the OpenAEC
header/footer, a project information block, and one section per beam with all
checks, formulae and unity-check ratios.

## Concrete tools (EN 1992-1-1)

Same engine as the Tauri commands `list_concrete_classes`,
`list_reinforcement_grades`, `check_concrete_beams` and `concrete_mn_kappa`, and
as the toetsbrug opdrachten of those names: `concrete_check` is called directly,
so there is no second implementation. `check_concrete_beam` is **singular** here
and takes one beam, exactly like `check_steel_beam`; the other two ways take a
list. Input and output types are identical (`ConcreteBeamCheckInput` /
`ConcreteBeamCheckResult`, `MnKappaRequest` / `MnKappaResponse`).

Scope today: a rectangular, T- or L-section with a cage that may vary along the
member (`reinforcement_zones`). `check_concrete_beam` runs fifteen checks:
bending with the rectangular stress block (§3.1.7(3)), bending **with axial
force** through the M-N-κ relation including the minimum eccentricity of
§6.1(4), shear (§6.2), minimum reinforcement and crack width (§7.3.2, §7.3.4)
under the frequent combination, the span/depth ratio (§7.4.2) and nine
detailing rules (§9.2.1, §9.2.2, §8.2). A check whose input is missing comes
back `NotApplicable` with the reason; it is never silently dropped. Next to it:
`concrete_column_check` (§5.8 slenderness gate and column detailing),
`concrete_cover_check` (§4.4.1 with the national annex),
`concrete_creep_coefficient` (annex B) and `concrete_segment_stiffness` (secant
stiffness for the physically non-linear second-order analysis). **Not**
included: torsion and punching.

### `list_concrete_classes` / `list_reinforcement_grades`

```json
{ "name": "list_concrete_classes", "arguments": {} }
```

Return `{ "classes": [ … ] }` and `{ "grades": [ … ] }`. The list is wrapped in
an object because `structuredContent` must be an object; the array inside is the
same one the other two ways return bare.

### `check_concrete_beam`

`n_strips` (50), `steel_branch` (`"Horizontal"`), `design_situation`
(`"PersistentTransient"`) and `apply_min_eccentricity` (`true`) may be omitted;
everything else is required. The schema is complete and strict
(`additionalProperties: false`), mirroring `#[serde(deny_unknown_fields)]`: a
typo in a field name is an error, not a silent fallback.

```json
{
  "name": "check_concrete_beam",
  "arguments": {
    "beam_id": 7,
    "width_mm": 300,
    "height_mm": 500,
    "concrete_class": "C30/37",
    "reinforcement_grade": "B500B",
    "cage": {
      "cover_mm": 30,
      "stirrup_diameter_mm": 8,
      "top":    { "count": 2, "diameter_mm": 12 },
      "bottom": { "count": 3, "diameter_mm": 16 }
    },
    "length_m": 5,
    "forces_envelope": [
      { "combination_id": 1, "position_mm": 2500,
        "forces": { "n_ed": 0, "vy_ed": 0, "vz_ed": 0,
                    "mt_ed": 0, "my_ed": 100, "mz_ed": 0 } }
    ]
  }
}
```

Response (`ConcreteBeamCheckResult`, abridged) — these are the numbers all three
ways produce for this input:

```json
{
  "beam_id": 7,
  "section_name": "300 x 500",
  "reinforcement_summary": "onder 3Ø16, boven 2Ø12, beugel Ø8, dekking 30 mm",
  "d_mm": 454.0,
  "f_cd_mpa": 20.0,
  "f_yd_mpa": 434.7826086956522,
  "checks": [ "6.1_bending_stress_block", "6.1_mn_kappa" ],
  "uc_max": 0.8839946123262402,
  "status": "Ok",
  "governing_check_id": "6.1_mn_kappa",
  "mn_kappa": { "n_kn": 0.0, "m_max_knm": 113.12286139035288, "failure_mode": "ConcreteCrushing" },
  "interaction_positive": [ /* 21 points */ ],
  "interaction_negative": [ /* 21 points */ ]
}
```

An unknown strength class or a cage that does not fit the section does **not**
throw: the result comes back with `governing_check_id` = `"ERROR: …"` and an
empty `checks` list. Check that field before reading `uc_max`.

### `concrete_mn_kappa`

The M-N-κ diagram of one cage without a beam or a force envelope — what the
reinforcement editor draws. `n_ed_kn` is **tension-positive**, so a compressed
column takes a negative value.

```json
{
  "name": "concrete_mn_kappa",
  "arguments": {
    "width_mm": 300, "height_mm": 500,
    "concrete_class": "C30/37", "reinforcement_grade": "B500B",
    "cage": { "cover_mm": 30, "stirrup_diameter_mm": 8,
              "top": { "count": 2, "diameter_mm": 12 },
              "bottom": { "count": 3, "diameter_mm": 16 } },
    "n_ed_kn": -800,
    "interaction_points": 11
  }
}
```

Response (abridged): `n_rd_compression_kn` = 3331.7521842190818,
`n_rd_tension_kn` = 360.6002002381328, `diagram.m_max_knm` =
235.12985457846818, `diagram.kappa_u_per_m` = 0.017642178136855355,
`diagram.failure_mode` = `"ConcreteCrushing"`, 61 diagram points and 11
interaction points per moment direction.

Unlike `check_concrete_beam`, an invalid request here **is** a tool error
(`isError: true`) with the reason — an empty diagram would read as "no
capacity".

### `concrete_dekkingslijn`

The curtailment diagram of one member as data: figure 9.2 of §9.2.1.3 for the
longitudinal bars and §6.2 for the shear. Per position the required and the
available value, with the evidence that applied there.

The member goes in under `beam` as the **same** `ConcreteBeamCheckInput` that
`check_concrete_beam` takes — there is deliberately no second, near-identical
input type, so a field added to the beam travels to both tools at once. Four
extra choices sit next to it, all optional and all meaning *not supplied* when
left out: `z_mm`, `c_d_mm`, `a_sl_mm2`, `cot_theta`.

```json
{
  "name": "concrete_dekkingslijn",
  "arguments": {
    "beam": { "beam_id": 7, "section": { "...": "as check_concrete_beam" },
              "concrete_class": "C30/37", "reinforcement_grade": "B500B",
              "cage": { "...": "" },
              "reinforcement_zones": { "longitudinal": [], "stirrups": [] },
              "length_m": 6.0, "forces_envelope": [] }
  }
}
```

What the response carries: `onder` and `boven` (one moment line per face, each
with its points, its governing index and the bar bundles with the full §8.4
l_bd derivation), `dwarskracht` (one V_Rd per point with the route and the
§6.2.1(3)/(5) track that produced it — V_Rd,c and V_Rd,s are never added),
`steunpunten` (§9.2.1.4/§9.2.1.5 at both member ends, reported and not judged),
`a_l_mm` with its article, the two governing unity checks, and `notes`.

Two things to know before reading a line:

- **Zone boundaries must be stations.** The resistance jumps where the
  reinforcement changes, and two points then share the same `x_mm`, marked
  `Links` and `Rechts`. If the envelope has no station there, the line puts a
  required force from somewhere else next to a resistance from here. In the app
  `bouwMultiInput` places a calculation node on every boundary through
  `SolverBeamInput.extraSneden`; a caller feeding this tool by hand should
  sample the envelope on those boundaries too.
- **An axial force without `z_mm` is an error, not a line.** 6.2.3(1) allows
  z = 0,9·d only "for reinforced concrete without axial force"; silently
  filling it in would make the required tensile force too low.

## 3D-raamwerk (`solve_open_fem_3d`)

Dezelfde functie `open_fem_3d::solve` als het Tauri-command en de
ontwikkelbrowser: een ruimtelijk raamwerk, lineair of in directe tweede orde
(`analysis: "p-delta"`, de standaard). Eenheden m, kN, kNm en MPa; het schema
is op elk niveau strikt en het contract weigert onbekende velden.

**Tweede orde.** De adapter itereert zelf: (K + K_G(N))·u = F met een verse
factorisatie per iteratie, tot de relatieve verplaatsingswijziging onder
`tolerance` ligt. Een tangent die niet positief definiet is, geeft een melding
"instabiliteit". De reacties zijn ((K + K_G)·u − F), zodat de krachtensom exact
sluit; de momentensom om de oorsprong in de onvervormde stand wijkt precies af
met het tweede-ordemoment Σ N·(e_x × Δu). Vooraf bepaalt de adapter de eerste
knikfactor α_cr (`buckling.modes[0].loadFactor`) uit dezelfde K en K_G; bij
α_cr ≤ 1 weigert de berekening. EN 1993-1-1, 5.2.1 vraagt α_cr ≥ 10 voor een
eerste-ordeberekening. K_G houdt rekening met vrijgegeven staafeinden.

**Trek-alleen.** `members[].tensionOnly: true` maakt een staaf trek-alleen
(bijvoorbeeld een windverband van rond staal). Per berekening valt een
trek-alleen staaf weg zolang zij op druk zou staan; bij tweede orde convergeert
die set eerst lineair en daarna in tweede orde. Het resultaat noemt de
inactieve staven (`inactiveMembers`, met nul-krachten en nul-lijnen in de
uitvoer) en het aantal statusrondes (`tensionOnlyRounds`). Staaflasten op een
inactieve staaf gaan als statisch gelijkwaardige knooplasten naar de
eindknopen. Een staaf die een knoop los laat hangen of een set die blijft
wisselen, geeft een melding met staafnummers.

**Starre schijven.** `diaphragms: [{ id, nodeIds }]` koppelt X, Y en de
rotatie om Z van de knopen als één star horizontaal vlak. Voorwaarden: minstens
twee bestaande knopen, alle binnen 1 mm op dezelfde hoogte, een knoop in
hoogstens één schijf, en hoogstens één knoop die de schijf in haar vlak
vasthoudt (oplegging in X, Y of rotatie om Z); die knoop wordt de meester.
Liggen alle knopen in X en Y vast, dan valt de schijf met een melding weg.

**Montage van trek-alleen staven.** `tensionOnlyFit: { nodalLoads,
memberLoads, memberPointLoads, thermalLoads, surfaceLoads }` zijn de lasten die
al op het frame staan wanneer de verbanden gemonteerd worden, bijvoorbeeld de
permanente belasting met factor 1. Zelfde vorm en keuring als de gewone lasten;
opgelegde verplaatsingen horen bij het rekengeval en doen niet mee. Elke
trek-alleen staaf krijgt de spanningsloze lengte L + Δ0, met Δ0 de verlenging
van haar koorde (u_j − u_i)·e_x onder de montagelasten (min de vrije
temperatuurverlenging van de staaf zelf). Δ0 werkt als gelijkwaardige uniforme
temperatuur ΔT = Δ0/(α·L) met de α van het materiaal (anders 12·10⁻⁶/K), in
elke statusronde en in de tweede orde. De eerste montageberekening is lineair
met alle staven actief, zodat het frame lood staat; omdat het verband daarin
zelf meedraagt, past de adapter opnieuw op de nieuwe koorde tot de
verbandkrachten niet meer veranderen (hoogstens 12 berekeningen). Onder alleen
de montagelasten dragen de verbanden dan niets, behalve een kracht die het
frame zonder verbanden niet kan dragen (een scheefstand die alleen de
verbanden tegenhouden): die blijft, en voor dat deel houdt het verband zijn
lengte uit de lode stand. Het resultaat geeft Δ0 per staaf
(`tensionOnlyFit: [{ memberId, deltaMm }]`) en een melding met het aantal
aangepaste staven, de grootste |Δ0| en het aantal montageberekeningen.
Ontbreekt het veld, dan rekent alles als voorheen.

**Kruisregel.** `tensionOnlyCrossRule: true`: twee trek-alleen staven die
elkaar in hun inwendige snijden (kleinste afstand tussen de assen < 1 mm, het
snijpunt meer dan 1 mm van de einden, geen gedeelde eindknoop) vormen een
kruis; drie of meer staven door één punt tellen niet. Zou in een kruis geen
diagonaal meedoen, dan blijft die met de grootste normaalkracht actief (voor
een inactieve staaf de normaalkracht uit haar verlenging), ook met een kleine
drukkracht. Het resultaat noemt die staven (`crossRuleMembers`); de melding
geeft het aantal kruisen waarin de regel nodig was en de grootste drukkracht in
een actieve trek-alleen staaf.

`gui_build_3d_model` kent dezelfde velden in de app: `beams[].tension_only`,
`diaphragms: [{ nodes, name? }]` met 1-gebaseerde knoopindices, en de
modelinstellingen `tension_only_fit_after_permanent` (montagelasten zijn de
blijvende belastinggevallen met factor 1, inclusief eigen gewicht en
belastingvlakken) en `tension_only_cross_rule`. In de app werkt het eigen
gewicht van een trek-alleen staaf als twee gelijke knooplasten op haar einden
(kabelwerking), niet als verdeelde last.

## Stalen hal (`open_fem_3d_staalhal_maken`)

Een complete stalen hal als 3D-raamwerk met één aanroep: spanten (kolommen en
spantliggers), gordingen, randliggers, dak- en wandverbanden, de lasten G, S,
wind dwars en wind langs, het vaste geval "Eigen gewicht", en desgewenst een
betonnen **balkrooster op palen** als fundering. Dezelfde generator zit achter
de wizard **Stalen hal…** in de app (lint, groep Project, en het
welkomstscherm) en achter de bedieningsopdracht `staalhal_maken`
(`gui_build_3d_steel_hall`): wie een hal via de API maakt, krijgt knoop voor
knoop hetzelfde model als in de wizard.

**De keten.** De hal wordt in de solverbundel gebouwd
(`design-mockup/src/components/openFem3d/wizards/staalhal.ts`, sidecar
`staalhal_maken`). Met `reken: true` rekent `open_fem_3d::solve` — dezelfde
kern als `solve_open_fem_3d` — elk belast geval en elke standaardcombinatie; de
sidecar (`staalhal_uitwerken`) werkt de resultaten uit en bouwt de
EN 1993-toetsinvoer met dezelfde functie als de app, en
`steel_check::check_all_beams` toetst. Er wordt hier niets nagerekend of
geschat: de UC per groep is het maximum van de `uc_max` die de staaltoets zelf
geeft.

### Argumenten

| veld | standaard | betekenis |
|---|---|---|
| `hal` | `{}` | de parameters van de hal, zie hieronder |
| `reken` | `false` | meteen doorrekenen met de 3D-kern |
| `analyse` | `"linear"` | `"linear"` (eerste orde, zoals het projectbestand) of `"p-delta"` |
| `gevolgklasse` | `"CC2"` | factoren van de standaardcombinaties (NEN-EN 1990 NB) |
| `toetsen` | `true` | met `reken`: ook EN 1993 toetsen |
| `stramien` | `true` | stramien en levels van de hal in het projectbestand |
| `detail` | `"samenvatting"` | `"volledig"`: ook alle reacties en verplaatsingen per geval en de toetsuitkomst per staaf |
| `timeout_s` | — | tijdslimiet per sidecar-aanroep |

**`hal`** — alle lengtes in **mm**. Ontbrekende velden krijgen de standaardwaarde;
samen is dat de voorbeeldhal van `docs/verificatie/3d-raamwerk/staalhal-60x30.ifcfem`.
Een onbekend veld, een verkeerd type of een onzinnige combinatie wordt
GEWEIGERD (`INVOER_ONGELDIG`), met in `detail.problemen` per probleem een code,
het veld en een Nederlandse melding — nooit een stille standaardwaarde.

| veld | standaard | betekenis |
|---|---|---|
| `lengteMm` | 60000 | lengte (x) |
| `breedteMm` | 30000 | overspanning (y) |
| `spantafstandMm` | 6000 | GROOTSTE h.o.h.-afstand; aantal vakken = ⌈lengte/spantafstand⌉, gelijk verdeeld. Niet samen met `aantalVakken` |
| `aantalVakken` | — | aantal vakken (spanten = vakken + 1), in plaats van `spantafstandMm` |
| `goothoogteMm` | 8000 | goothoogte (lage zijde bij een lessenaarsdak) |
| `dak.type` | `"zadeldak"` | `"zadeldak"`, `"lessenaarsdak"` of `"platdak"` |
| `dak.nokhoogteMm` / `dak.hellingGraden` | helling 1 : 10 | nokhoogte (lessenaarsdak: hoge zijde) óf helling; niet allebei |
| `gordingafstandMm` | 2500 | GROOTSTE gordingafstand, horizontaal; bij een zadeldak valt de nok op een gording |
| `profielen.{kolom,spantligger,gording,randligger,verband}` | HEA 450, IPE 600, IPE 160, HEA 160, CHS 88.9x4 | `{ profiel, materiaal }`, catalogusprofiel en S235–S460 |
| `kolomvoet` | `"ingeklemd"` | of `"scharnierend"` (dan is wandverband verplicht) |
| `verbanden.vakken` | `"kopvakken"` | `"kopvakken"`, `"alle"`, `"geen"` of vaknummers (1 = eerste vak) |
| `verbanden.dak` / `verbanden.wanden` | `true` / `true` | kruis in elk gordingveld / in beide langsgevels |
| `fundering.type` | `"opleggingen"` | of `"balkrooster"` |
| `fundering.balkBreedteMm` × `balkHoogteMm`, `betonklasse` | 400 × 600, C20/25 | funderingsbalken |
| `fundering.dwarsbalken` | `"elkSpant"` | of `"kopspanten"`; langsbalken liggen altijd onder beide kolomlijnen |
| `fundering.diepteMm` | 800 | systeemlijn (hart balk) onder peil; > 0: een betonnen poer verbindt kolomvoet en rooster |
| `fundering.paalKzKnPerMm` | 100 | verticale veer per paal |
| `fundering.paalHorizontaal` | `"veren"` | veer per paal (`paalKhKnPerMm`, 5) of `"statischBepaald"` (u_x+u_y in de eerste paal, u_y in de laatste van kolomlijn y = 0) |
| `fundering.paalAfstandMm` | 6000 | grootste paalafstand langs een balk; onder elke kolom staat een paal |
| `lasten.dakafwerkingKnM2` / `sneeuwKnM2` | 0,3 / 0,56 | kN/m² horizontale projectie, als lijnlast op de gordingen |
| `lasten.wind.bron` | `"handmatig"` | `"handmatig"` (`drukKnM2` 0,64, `zuigingKnM2` 0,40, `dakZuigingKnM2` 0,48) of `"stuwdruk"`: q_p(z = nok) uit NEN-EN 1991-1-4 (`windgebied` II, `terreincategorie` III), c_pe,10 zones D/E van tabel 7.1 en `cDak` (0,6) op het hele dak |
| `eigenGewicht` | `true` | geval "Eigen gewicht" (id 5), ρ·A·g per staaf, ook rooster en poeren |
| `projectnaam` | `""` | leeg: "Staalhal L × B m" |

Belastinggevallen van de hal: 1 Permanent (G), 2 Sneeuw (S), 3 Wind dwars (W,
+Y: kolommen loef druk en lij zuiging, dak opwaarts), 4 Wind langs (W, +X: de
helft van de kopgevel op de dakrand van het eerste spant), 5 Eigen gewicht. De
app koppelt ze bij "Maken" aan de gevallen van het project (op naam en type;
ontbrekende komen erbij).

### Uitvoer

- `project` — de inhoud van een projectbestand (op te slaan als `.ifcfem`, te
  openen in de app of met `gui_load_model`);
- `parameters` — de genormaliseerde parameters (weer als `hal` te gebruiken);
- `samenvatting` — `aantallen`, `maten` (werkelijke spant- en gordingafstand,
  helling, verbandvakken), `groepen` (staafnummers per rol: kolom, spantligger,
  gording, randligger, dakverband, wandverband, funderingsbalk, poer),
  `paalknopen`, de lasten (bij stuwdruk met afleiding), `belastingsom` per geval
  en `eigenGewichtKn` (staal/beton);
- `waarschuwingen` — aandachtspunten, bijv. lasten per m² projectie bij een
  helling boven 10°, of de statisch bepaalde horizontale oplegging;
- met `reken`: `berekening.gevallen[]` en `berekening.combinaties[]` met
  `reactiesomKn`, `belastingsomKn`, `evenwicht` (kern én onafhankelijke
  krachten- en momentensom), `maxVerplaatsingMm`, `maxGootverplaatsingMm` en
  (balkrooster) `paalreacties`; `grenzen_ter_vergelijking` (L/250, h/150) en —
  met `toetsen` — `berekening.toetsing` met `uc_max`, de maatgevende staaf,
  `per_groep`, `status_telling`, `niet_getoetst` (beton, met reden) en de
  `notities` van de toetsinvoer.

### Voorbeeld

```json
{ "name": "open_fem_3d_staalhal_maken", "arguments": {
    "hal": {
      "lengteMm": 48000, "breedteMm": 24000, "spantafstandMm": 6000, "goothoogteMm": 7000,
      "dak": { "type": "zadeldak", "hellingGraden": 6 },
      "profielen": { "kolom": { "profiel": "HEA 400", "materiaal": "S355" } },
      "kolomvoet": "scharnierend",
      "verbanden": { "vakken": [1, 8], "dak": true, "wanden": true },
      "fundering": { "type": "balkrooster", "dwarsbalken": "kopspanten", "paalAfstandMm": 4000 },
      "lasten": { "wind": { "bron": "stuwdruk", "windgebied": "II", "terreincategorie": "III" } }
    },
    "reken": true } }
```

Verkort antwoord van de voorbeeldhal (`{ "reken": true }`, release-build):

```json
{ "samenvatting": { "aantallen": { "knopen": 165, "staven": 340, "opleggingen": 22, "palen": 0 } },
  "berekening": { "aantal_berekeningen": 19,
    "gevallen": [ { "id": 1, "naam": "Permanent (G)", "reactiesomKn": { "fx": 0, "fy": 0, "fz": 540 },
                    "evenwicht": { "kern": true, "onafhankelijk": true }, "maxVerplaatsingMm": 31.9, "maxGootverplaatsingMm": 2.4 } ],
    "toetsing": { "uc_max": 1.77, "maatgevend": { "groep": "wandverband", "profiel": "CHS 88.9x4" },
                  "per_groep": { "kolom": { "uc_max": 0.78 }, "spantligger": { "uc_max": 0.68 }, "gording": { "uc_max": 1.59 } } } } }
```

De voorbeeldhal is een rekenvoorbeeld, geen ontwerp: met de veilige
aannames van de 3D-toetsinvoer (kniklengte = staaflengte, geen kipsteunen)
en beide diagonalen van de kruisen meewerkend halen de gordingen en de
wanddiagonalen de toets niet. Kies zwaardere profielen of meer verbandvakken.

**In de draaiende app** (bedieningskanaal, `OPENAEC_GUI_CONTROL=1`):
`gui_build_3d_steel_hall { "hal": { … } }` — paginaopdracht `staalhal_maken`.
Het 3D-model wordt vervangen als één undo-stap, de gevallen van de hal worden
aan die van het project gekoppeld, het stramien en het eigen gewicht worden
gezet en het 3D-werkblad opent passend in beeld; het antwoord noemt de
aantallen, de staafnummers per groep en per geval van de hal het geval van het
project. Een fout in de parameters komt terug met alle problemen, zonder dat
er iets verandert.

## IFC-analysemodel importeren (`open_fem_3d_ifc_importeren`)

Een IFC4-analysemodel (Structural Analysis View: `IfcStructuralAnalysisModel`
met knopen, staven, vlakken, belastinggevallen en combinaties) als 3D-project.
Dezelfde import zit achter de knop **Rekenmodel importeren** op het IFC-tabblad
van het lint (en Bestand → Openen) en achter de bedieningsopdracht
`ifc_analysemodel_importeren` (`gui_import_ifc_analysis_model`): wie een bestand
via de API importeert, krijgt knoop voor knoop hetzelfde project als in de app.

**De keten.** De server leest het bestand (UTF-8, anders ISO 8859-1); de import
zelf draait in de solverbundel (`design-mockup/src/io/ifcAnalyseImport.ts`,
sidecar `ifc_importeren`). Met `reken: true` rekent `open_fem_3d::solve` elk
belast geval en elke combinatie uit het bestand (heeft het bestand er geen: de
standaardset van de app voor `gevolgklasse`), werkt de sidecar
(`ifc_uitwerken`) de resultaten uit en toetst `steel_check::check_all_beams` de
staven met een catalogusprofiel van staal, per onderdeel. Kent de 3D-kern een
onderdeel nog niet (trek-alleen staven, starre schijven) of mist een staaf een
profiel, dan is `berekening.uitgevoerd` false met de reden; er wordt niets
weggelaten om toch te rekenen.

### Argumenten

| veld | standaard | betekenis |
|---|---|---|
| `pad` | — (verplicht) | absoluut pad naar het `.ifc`-bestand (IFC4, STEP-vorm) |
| `analysemodel` | — | naam (hoofdletterongevoelig) of volgnummer vanaf 1; verplicht als het bestand meer dan één analysemodel heeft, anders komt er een fout met de lijst |
| `reken` | `false` | meteen doorrekenen met de 3D-kern |
| `analyse` | `"linear"` | `"linear"` of `"p-delta"` |
| `gevolgklasse` | `"CC2"` | alleen voor de standaardset, als het bestand geen combinaties heeft |
| `toetsen` | `true` | met `reken`: ook EN 1993 toetsen |
| `detail` | `"samenvatting"` | `"volledig"`: ook reacties en verplaatsingen per geval en de toetsuitkomst per staaf |
| `timeout_s` | — | tijdslimiet per sidecar-aanroep |

### Wat er wordt ingelezen

- eenheden uit `IfcUnitAssignment` (ook mm en kN; een `IfcDerivedUnit` gaat voor, de vlaklast valt anders terug op `PRESSUREUNIT`), omgerekend naar m, kN, kN/m, kN/m² en kNm;
- plaatsing via de `IfcLocalPlacement`-keten en de `SharedPlacement` van het model;
- knopen (`IfcStructuralPointConnection`) met opleggingen en veren; staven (`IfcStructuralCurveMember`) met profiel (I, U, kokers, buizen, massief rond als `RD <d>`, een stalen rechthoek als `Strip <b>x<t>`; op naam of op afmetingen), staalsoort, rolhoek uit `Axis` en eindscharnieren (`IfcRelConnectsStructuralMember`); een staaf die ook tussen haar eindpunten aan een knoop hangt (een doorgaande ligger over een kolom of tussensteunpunt), wordt daar geknipt: de lasten gaan over de delen, de tussenknopen zijn star;
- trek-alleen: `TENSION_MEMBER`, `CABLE` en een `PIN_JOINED_MEMBER` van massief rond staal of van een platte strip (dikte ≤ ¼ breedte); een pendelstaaf met een ander profiel (ook een gedrongen strip) blijft een staaf die ook druk opneemt;
- vlakken: horizontale membraanvlakken die knopen delen worden per hoogte één starre schijf; vlakken zonder stijfheid dragen belastingvlakken (overspanningsrichting uit een eigenschap "Overspanningsrichting"/"SpanDirection" met X of Y, anders twee richtingen);
- belastinggevallen (type uit ActionType en ActionSource; `SelfWeightCoefficients` (0, 0, −1) = het automatische eigen gewicht; `SYSTEM_IMPERFECTION` = "overig", en de scheefstand van het project staat dan uit), vlak-, lijn- en puntlasten (een vlaklast met een eigen face die samenvalt met de rand van het vlak geldt voor het hele vlak; een kleinere face wordt gemeld en niet ingelezen), eigen combinaties (factoren uit `IfcRelAssignsToGroupByFactor`, type uit Purpose of naam) en levels uit `IfcBuildingStorey`.

### Uitvoer

- `project` — de inhoud van een projectbestand (`.ifcfem`), te openen in de app of met `gui_load_model`;
- `modellen` — de analysemodellen in het bestand (nummer, naam, beschrijving, aantallen) en `analysemodel` — het gekozen model;
- `verslag` — `aantallen`, `trekAlleen`, `schijven`, en in Nederlandse zinnen `toelichting`, `waarschuwingen` (benaderd of aangenomen) en `nietOndersteund` (niet ingelezen), gelijke meldingen samen met een telling;
- met `reken`: `berekening` met `uitgevoerd` (en anders `reden`), `gevallen[]` en `combinaties[]` met `reactiesomKn`, `belastingsomKn`, `evenwicht` en `maxVerplaatsingMm`, en met `toetsen` de `toetsing` per onderdeel (zoals bij de stalen hal).

### Voorbeeld

```json
{ "name": "open_fem_3d_ifc_importeren", "arguments": {
    "pad": "C:/projecten/hal/analysemodel.ifc", "analysemodel": "Hal", "reken": true } }
```

**In de draaiende app** (bedieningskanaal, `OPENAEC_GUI_CONTROL=1`):
`gui_import_ifc_analysis_model { "path": "…", "analysis_model": "Hal" }` —
de app leest het bestand, zet het als nieuw 3D-project neer (zonder te vragen
naar niet-opgeslagen werk) en geeft het verslag terug.

## Commando's uit de app (`model3d_*`, `project_*`, `app_*`)

De app heeft een commandoregister (`design-mockup/src/api/`): elke
modelfunctie is daar een commando met een naam, een Nederlandse beschrijving
en een streng invoerschema. Deze server maakt van elk commando een tool. De
lijst komt uit `assets/api-catalogus.json`, die `npm run build:sidecar` uit
de app schrijft; een nieuw commando in de app is na het bouwen dus vanzelf
een tool. Het register dekt nu het 3D-model, de gevallen en combinaties, het
stramien, ongedaan maken en opslaan; het 2D-model, rekenen en toetsen, en
weergave en rapport volgen.

- **Naam**: de commandonaam met `_` voor `.`, dus `model3d.node.add` wordt
  `model3d_node_add`.
- **Documentcommando's** (`model3d_*`, `project_*`) werken op een project.
  - Met `project` (pad naar een `.ifcfem` of `.ifcfem2d`) is er geen app
    nodig: de server leest het bestand, voert het commando uit in de
    solverbundel en schrijft het resultaat terug (eerst naast het bestand,
    dan in één keer vervangen). `save: false` laat het bestand staan.
    Antwoord: `{output, saved, project}`.
  - Zonder `project` gaat het commando naar de draaiende app (gestart met
    `OPENAEC_GUI_CONTROL=1`, zie de laatste sectie), als één stap die
    `app_undo` of Ctrl+Z ongedaan maakt. Antwoord: `{output, via: "app"}`.
- **App-commando's** (`app_undo`, `app_redo`, `app_project_save`,
  `app_project_open`) werken alleen in de draaiende app.
- **Niet-opgeslagen werk**: in de app weigeren `project_new` en
  `app_project_open` als het project niet-opgeslagen wijzigingen heeft, tenzij
  `discardChanges: true`. Dit kanaal stelt de gebruiker geen vragen.
- **Fouten** komen met een vaste code in `structuredContent.error_code`, met
  een remedie: `ONBEKEND_COMMANDO` (met suggesties), `INVOER_ONGELDIG` (met de
  problemen per veld), `GEEN_DOCUMENT`, `NIET_GEVONDEN`, `GEWEIGERD` (een
  modelregel weigert; de reden staat erbij), `ALLEEN_IN_APP`,
  `BESTAND_ONLEESBAAR` en `INTERN`. Een verkeerd argument van de tool zelf
  (`project` bij een app-commando, een ander bestandstype) geeft
  `ARGUMENT_ONGELDIG`.
- **Eenheden**: m, kN, kN/m, kN/m², kNm; de profielrotatie in graden
  (`rollAngleDeg`). `model3d_get` geeft het model zoals het project het
  bewaart (de rolhoek dan in radialen).

Voorbeeld: een kolom op een bestand, zonder app.

```json
{"name": "project_new", "arguments": {"project": "C:/werk/kolom.ifcfem"}}
{"name": "model3d_node_add", "arguments": {"project": "C:/werk/kolom.ifcfem", "x": 0, "y": 0, "z": 0}}
{"name": "model3d_node_add", "arguments": {"project": "C:/werk/kolom.ifcfem", "x": 0, "y": 0, "z": 4}}
{"name": "model3d_beam_add", "arguments": {"project": "C:/werk/kolom.ifcfem", "startNodeId": 1, "endNodeId": 2, "profileName": "HEA 200"}}
{"name": "model3d_support_set", "arguments": {"project": "C:/werk/kolom.ifcfem", "nodeId": 1, "preset": "fixed"}}
{"name": "model3d_load_nodal_add", "arguments": {"project": "C:/werk/kolom.ifcfem", "nodeId": 2, "fx": 5, "fz": -100}}
```

Hetzelfde in de draaiende app: laat `project` weg.

Welke functie van de 3D-bediening bij welk commando hoort, en wat in een
latere fase komt, staat in `design-mockup/src/api/dekking.ts`;
`design-mockup/test-api-dekking.mjs` faalt zodra de 3D-bediening een functie
krijgt zonder commando. Eind-tot-eind door de echte app, via deze server:
`node design-mockup/referentie-gui/api-app.mjs`.

## Architecture

- **Transport**: newline-delimited JSON-RPC 2.0 on stdin/stdout. One message
  per line.
- **Protocol**: implements `initialize`, `notifications/initialized`,
  `tools/list`, `tools/call`, and `ping`. Other methods return -32601.
- **Concurrency**: each request is dispatched on its own `tokio::spawn`, so a
  long-running PDF render does not block subsequent reads. CPU-bound work
  (the steel-check orchestrator and PDF generation) runs on
  `tokio::task::spawn_blocking` so it does not starve the I/O scheduler.
- **Error mapping**: malformed request → `-32700`, unknown method → `-32601`,
  invalid `tools/call` params → `-32602`. Per the MCP spec, **tool execution
  errors** (e.g. unknown profile name, malformed `BeamCheckInput`) are
  returned in `result.isError = true` rather than as JSON-RPC errors, so the
  model can read them and self-correct.
- **Logging**: `tracing` to stderr. Set `OPENAEC_MCP_LOG=debug` for verbose
  output.

## Test

```bash
cargo test -p openaec-mcp-server
```

| test | what it pins down |
|---|---|
| `stdio_roundtrip.rs` | the full handshake against the real binary: `initialize` → `notifications/initialized` → `tools/list` → `tools/call`, and the complete tool roster |
| `schema_strikt.rs` | the input schemas of `check_steel_beam`, `check_concrete_beam` and `concrete_mn_kappa` are complete and strict; a typo in a field name is refused, not silently defaulted |
| `drie_wegen_beton.rs` | **the three ways give the same answer**: the same JSON through the Tauri command's engine call, through `toetsbrug::behandel` and through the real MCP binary, compared field by field, plus anchor values so all three cannot drift together |
| `drie_wegen_dekkingslijn.rs` | the same for `concrete_dekkingslijn` (§9.2.1.3 / figure 9.2 and §6.2): one member through all three ways, plus anchor values that follow from the norm — two bar bundles for a 3/5/3 curtailment, two points on every zone boundary (left and right of the jump), and the full tensile force jumping by 5/3 there. Also pins that an axial force without a supplied `z_mm` fails on ALL three ways with 6.2.3(1) in the reason, and that a typo in a field name is refused |
| `beton_in_check_fem_model.rs` | a concrete beam in a mixed model is reported in `skipped_beams` instead of vanishing; `beam_ids` is respected; a model carrying a reinforcement cage is refused by the field gate |
| `hout_in_check_fem_model.rs` | the same for a timber beam, including `beam_ids: [timber beam]`; and catalogue profiles outside the old prefix list (INP, DIN, L) are checked, not dropped |
| `fem_golden.rs`, `sidecar.rs`, `fout_paden.rs` | the FEM chain: golden values, the Node sidecar, and the error paths |
| `ifc_import_mcp.rs` | `open_fem_3d_ifc_importeren` end to end on the synthetic files of `docs/verificatie/ifc-analyse`: without a model choice the error lists both analysis models; the canopy model is imported, solved and checked with ΣR per load case equal to hand values and equilibrium everywhere; the hall comes back with its report and an honest calculation status; the mm/kN file gives exactly the same model; a missing file is reported (needs Node ≥ 20) |
| `api_tools.rs` | the tools generated from the app's command catalogue: a chain of commands on a temporary project file (headless, through the Node sidecar), `save: false`, and the error codes — `NIET_GEVONDEN`, `INVOER_ONGELDIG`, `BESTAND_ONLEESBAAR`, and `ARGUMENT_ONGELDIG` for another file type or `project` on an app command (needs Node ≥ 20) |
| `staalhal_mcp.rs` | `open_fem_3d_staalhal_maken` end to end: the default hall equals the example project file node for node, every schema default equals the generator's, ΣR per load case and Σ pile reactions match hand values, equilibrium in every case and combination, a UC for every steel member, and parameter errors come back with code and field (needs Node ≥ 20) |

`beton_in_check_fem_model.rs` and the FEM tests need Node ≥ 20, because the
solve runs in the Node sidecar; they fail with that message rather than skipping
silently. The steel and concrete check tools run entirely in Rust, so
`schema_strikt.rs` and `drie_wegen_beton.rs` need nothing beyond cargo.

## Known limitations

- **`check_fem_model` does not check concrete members.** Steel lands in
  `results`, timber in `timber_results`, cross-laminated timber in
  `clt_results` and wall plates in `plate_results`. A concrete member is solved
  with the rest of the model but comes back in `skipped_beams` with a pointer
  to `check_concrete_beam`. Every requested member is in exactly one of those
  lists, never in none: always read `skipped_beams`, `skipped_plates` and the
  `FOUT:` lines in `warnings`, and never read `governing` as a verdict on a
  model with concrete in it.
- **Plates**: what the membrane model cannot support is reported as not checked
  with a reason (`niet_getoetst`), not left out — tension perpendicular to the
  grain, cross-laminated timber as a plate, buckling without `plooi` input.
- **CHS section properties**: `compute_section_properties` returns the
  catalogue values for CHS profiles because no `chs_section_props` analytical
  helper exists in the `section-properties` crate yet.
- **Tool input schemas**: `check_steel_beam`, `check_concrete_beam` and
  `concrete_mn_kappa` have complete, strict schemas
  (`additionalProperties: false`, every field listed) that mirror
  `#[serde(deny_unknown_fields)]` on the Rust types; so do the five FEM tools.
  `generate_steel_report_pdf` is still loose — it is a reporting input with no
  effect on any calculation.
- **No streaming**: tool results are returned in one chunk. The PDF tool
  returns the entire base64-encoded document in a single response — fine for
  reports up to ~1 MB, may need chunking later.
- **No auth**: stdio transport is trusted by definition. Do not expose this
  server over TCP without adding authentication.

## Roadmap

- ~~**Timber (EN 1995) and CLT** as their own tools.~~ Done:
  `check_timber_beams`, `check_clt_beams` and both inside `check_fem_model`.
- **Concrete inside `check_fem_model`**, so a mixed model gets one verdict.
- **The free stress check and fillet welds** as tools — the two engines that
  still miss the third way.
- **A three-ways test for steel**, in the shape of `tests/drie_wegen_beton.rs`.
  Steel is the oldest engine here and the only one without that comparison.
- ~~**A concrete PDF report tool**, next to `generate_steel_report_pdf`.~~
  Done differently, and better: `generate_steel_report_pdf` itself now carries
  concrete — the checks, the segment stiffness chapter and the four figures.
  A second tool would have meant a second report for the same structure.

## GUI tools: driving the running desktop app (`gui_*`)

Twenty-two tools operate the **running** Open FEM Studio desktop app through
its control channel. They are not engine calls and are therefore outside the
three-ways rule — they *are* the way to the GUI.

Start the app with the channel enabled:

```
set OPENAEC_GUI_CONTROL=1
"%LOCALAPPDATA%\Open FEM Studio\open-fem-studio.exe"
```

The app then listens on `127.0.0.1:<free port>` with a per-session token and
writes `gui-control.json` (`{pid, poort, token, versie}`) to
`%LOCALAPPDATA%\org.openaec.fem-studio\`. The tools find it there
(override with `OPENAEC_GUI_CONTROL_FILE`); an app up to 2026.39.1 uses
`%LOCALAPPDATA%\org.openaec.fem2d-studio\`, which the tools fall back to. While the channel is active the
status bar shows *bediening op afstand actief*. Nothing listens without the
variable, nothing accepts a call without the token, and the file is removed
on exit (`gui_quit` exits through the app's own path so that happens).

| Tool | What it does in the app |
|---|---|
| `gui_status` | reachable? pid, port, version, active view, selection, member count |
| `gui_load_model {path}` | loads a `.femp`/`.ifcfem`/`.ifcfem2d` (read by the app process) |
| `gui_build_model {...}` | builds nodes/beams/supports/loads through the store actions |
| `gui_build_3d_model {...}` | builds a 3D frame in metres, with supports, nodal loads, optional member profiles, tension-only members, rigid diaphragms and optional levels (nodes and plates linked to a level) |
| `gui_configure_3d_view {...}` | sets the 3D camera, visibility, profile volumes and the structural grid (X/Y grid axes and levels; linked nodes follow a level) |
| `gui_select_member {id}` | selects a member as if clicked |
| `gui_set_cage {beam_id, cage}` | sets `checkConfig.betonKorf` (same `ReinforcementCage` as `check_concrete_beam`) |
| `gui_set_analysis {analysis_type}` | `eersteOrde` / `tweedeOrdeGeometrisch` / `tweedeOrdeFysisch` |
| `gui_solve` | the full Bereken run (solver, non-linear concrete round when asked, code checks); returns when all is done, with per-combination extremes |
| `gui_run_checks` | runs the code checks and waits for the check store |
| `gui_open_curtailment {beam_id}` | opens the dekkingslijn panel and returns `{verzoek, antwoord}` — replay `verzoek` through `concrete_dekkingslijn` to verify the GUI against the engine |
| `gui_set_view {view}` | `default`, `check`, `report`, `insights`, `ifc` |
| `gui_detach_report` | opens the live report in its own window; returns its label |
| `gui_read_checks` | reads the current check results |
| `gui_screenshot {window, path, dom?}` | real pixels via `PrintWindow` (or `dom: true` → html2canvas) |
| `gui_export_report_pdf {path, report_type?, page_size?, orientation?, project?}` | the standard live report (volledig/beperkt) as PDF via WebView2 `PrintToPdf`; refuses with a reason without a current calculation and check; settings apply to this export only; returns `{path, bytes, pages, sheets, report_type, pdf_base64}` — Windows only |
| `gui_build_3d_steel_hall {hal}` | builds a steel hall with the wizard's generator (same `hal` as `open_fem_3d_staalhal_maken`): one undo step, project load cases coupled, structural grid set |
| `gui_import_ifc_analysis_model {path, analysis_model?}` | imports an IFC4 structural analysis model as a new 3D project with the same import as the ribbon button "Rekenmodel importeren" and `open_fem_3d_ifc_importeren`; the app reads the file; returns the report |
| `gui_quit` | closes the app gracefully |

Every action returns only once the app *is* in the new state (store
subscriptions, not timers), and a failure carries the app's own message.

End-to-end example — the reinforcement workflow through the installed app,
with screenshots: `node design-mockup/referentie-gui/wapening-workflow.mjs`.
