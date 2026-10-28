# Plan: Toetskrachten altijd uit tweede orde met scheefstand (#199, deel 1)

> Uitvoering: per taak een uitvoerder, daarna een review en een eigen verificatie. Taken in volgorde; elke taak eindigt met groene tests voor zijn deel. De coördinator commit en integreert; uitvoerders committen en mergen niet.

**Doel.** Elke UGT-normtoetsing rekent met krachten uit een P-Δ-berekening met scheefstand: in de 2D-app, de 3D-app en via MCP. De instellingen Analyse en Scheefstand gelden alleen nog voor de resultaten.

**Architectuur.**
- Twee zuivere functies maken de toetskrachten. `bepaalToetsKrachten2D` staat in `design-mockup/src/lib/toetsKrachten.ts`, `bepaalToetsKrachten3D` naast de 3D-solver.
- De app, de sidecar en de 3D-MCP-paden roepen dezelfde functies aan.
- De toetsbouwers krijgen de UGT uit de toetsset en de BGT uit de resultaten.
- In de Rust-kernen veranderen alleen teksten en het MCP-schema.

**Stack.** React 19 + TypeScript (design-mockup), Rust-workspace (src-tauri/crates), MCP-server met de sidecarbundel.

**Bronnen.**
- Spec: `docs/superpowers/specs/2026-10-14-toets-tweede-orde-design.md`, met de besluiten B1–B14.
- Ontwerpkaart met regelnummers: `docs/superpowers/plans/2026-10-14-toets-tweede-orde-ontwerpkaart.md`.

## Globale eisen

- **Werkmap:** `C:\Users\rickd\Documents\GitHub\ofs-wt-int`, tak `werk/issue-199`. Niet committen en niet mergen; de coördinator integreert.
- **Repo-inhoud:** nergens namen van externe rekensoftware of verwijzingen naar gesprekken (code, commentaar, tests, docs).
- **Taal:** code-commentaar en committeksten Nederlands. MCP-toolbeschrijvingen volgen het bestaande patroon: Engelse tooltekst, Nederlandse veldbeschrijvingen.
- **Drie wegen:** elke regel werkt in de app en via MCP (sidecar plus Rust-server). Na een wijziging aan `core/`, `engine.ts`, de sidecar of de bouwers eerst `npm run build:sidecar`, dan `cargo build --release -p toetsbrug -p openaec-mcp-server -p open-fem-3d`.
- **Referentiegetallen:** nooit blind bijwerken. Elk veranderd getal krijgt in de test een commentaarregel met de oorzaak (P-Δ, scheefstand, een vervallen eindtoestandvariant), de grootte en de handcontrole. Een tolerantie verruimen telt ook als besluit.
- **Analytische tests:** `design-mockup/test-*.mjs`, geregistreerd in `scripts/run-tests.mjs` (BUNDEL_TESTS of ALLEEN_BRON met reden).
- **ts-rs:** `cargo test` herschrijft `design-mockup/src/lib/types/`. Bestanden met alleen een regeleindeverschil zet je terug.
- **i18n:** elke nieuwe sleutel in nl, en, de en fr. Dit wordt bewaakt door `test-i18n-talen.mjs`.
- **Geen gedragsverandering buiten #199:** resultaten en BGT blijven bit-gelijk aan nu.

---

### Taak 0: voorwerk (fase 0)

**Bestanden:** `useFemStore.ts` (invalidatie `stabiliteit`, ~3128-3138), `App.tsx` (~2542, 2585: de oude `fem.stabiliteit`), `bediening/rapportExport.ts` (~90, 366: het vaste 3D-analysetype), de i18n-sleutel `openFem3d.normBasis`. Tests met een broncode-regex: `test-kolom-eerste-orde.mjs`, `test-open-fem3d-scheefstand.mjs`, `test-rekengang-generatie.mjs`, `test-maatgevend*.mjs`, `test-rapport-gereedheid*.mjs`, `test-verouderd*.mjs`.

**Acceptatie:**
- Na een modelwijziging is `stabiliteit` gewist.
- Het API-pad leest de verse stabiliteit.
- De export noemt in 3D het werkelijk gebruikte analysetype.
- De tekst `normBasis` klopt in vier talen.
- De genoemde regex-tests controleren gedrag in plaats van broncodetekst; waar dat niet kan, staat de reden erbij.
- `npx tsc --noEmit` en de betrokken tests zijn groen.

### Taak 1: `bepaalToetsKrachten2D` (bouwsteen A)

**Bestanden:**
- nieuw `design-mockup/src/lib/toetsKrachten.ts`;
- export in `design-mockup/src/mcp/kernel-exports.ts`;
- eventueel een helper in `components/fem/solver/engine.ts` (een lege perCase met `SECOND_ORDER_KEY`) en in `combinations.ts`.

**Interfaces:** zoals in de spec (A). Invoer: de basis-MultiInput van de resultaatrekengang, de actieve combinaties, de scheefstand (φ, richting, bron, modelAan) en de resultaten voor hergebruik. Uitvoer: `ToetsKrachten2D`.

**Acceptatie:**
- Alleen UGT, ontvouwd in ±x, zonder eindtoestandvarianten, met een melding.
- φ volgt B5, inclusief het hout-maximum volgens EN 1995 (5.1) en een waarschuwing bij een vaste noemer onder de normwaarde.
- Hergebruik werkt alleen onder de voorwaarden van de spec.
- De SecondOrderState wordt niet gedeeld tussen invoer met verschillende scheefstand.
- Divergentie levert een `weigering` per combinatie, nooit een uitzondering die de resultaten raakt.
- α_cr wordt één keer per basiscombinatie bepaald.

**Test:** nieuw `test-toets-krachten.mjs` (BUNDEL_TESTS), met:
- een vrijstaande kolom in een eerste-ordemodel: de toets-N gelijk aan de belasting, M aan de voet = φ·V·h·1/(1 − N/N_cr) binnen 1 %, met de handberekening in de test;
- beide richtingen aanwezig;
- een eindtoestandvariant uitgesloten;
- hergebruik bit-gelijk;
- een model met α_cr < 1 geweigerd, met de reden.

### Taak 2: de 2D-app (A2)

**Bestanden:**
- `App.tsx`: `rekenDoor`, `computeAndStoreSolverOutputs`, `handleRunMemberChecks`, `handleToonMaatgevend` en de fysische ronde;
- `stores/checkStore.ts`;
- `lib/houtEindstijfheid.ts`;
- `lib/eersteOrdeResultaten.ts`;
- `lib/betonCheckBuilder.ts`;
- de identiteitscontroles in `components/beton/dekking/BetonStaafVenster.tsx`, `bediening/rapportExport.ts`, `bediening/rapportVoorwaarden.ts` en `App.tsx` (`volledigeRekengangRef`);
- `components/report/sections/CheckTableSection.tsx` (combinatienamen).

**Acceptatie:**
- Toetsen geeft UGT-toetsen op tweede orde met scheefstand en BGT-toetsen op de resultaten.
- Een divergerende toets laat de resultaten staan en toont de weigering.
- `first_order_envelope` gaat altijd mee, uit de toetsset.
- De maatgevend-markering volgt B4.
- Het rapport toont geen "comb. 1000003".
- Bij `tweedeOrdeFysisch` draait de betonronde op de toetsset.

**Test:** gedragstests op de app-route, met de bouwers zoals de checkStore ze aanroept; de bestaande tests uit de ontwerpkaart (I), elk veranderd getal verantwoord.

### Taak 3: de sidecar en MCP voor 2D (C)

**Bestanden:**
- `design-mockup/src/mcp/sidecar.ts`: `opCheck` en `opSolve` gesplitst, `leesScheefstand`, de bouwers en de uitvoer;
- `design-mockup/src/mcp/valideerModel.ts`, als dat nodig is;
- Rust: `openaec-mcp-server/src/fem_tools.rs` (de argumenten van check zonder `nonlinear`, de beschrijvingen, de bewaking `TOETSING_ONMOGELIJK`, de uitvoerbeschrijving), `main.rs`, `timber_tools.rs` en `gui_tools.rs` (teksten en tijdslimieten), de README;
- `tests/schema_strikt.rs`, `tests/fem_golden.rs` en `golden/portaal.verwacht.json`.

**Acceptatie:**
- `check_fem_model` toetst altijd met tweede orde en scheefstand.
- De uitvoer bevat `stability.analysis_type` = de toetsanalyse, `model_analysis_type`, `scheefstand{…}`, de toelichtingen en de vaste regel in `warnings`.
- `nonlinear` in `check_fem_model` wordt geweigerd als onbekend veld.
- `solve_fem_model` levert geen `steel_check_inputs` meer.
- Een oude bundel geeft `TOETSING_ONMOGELIJK`.
- De app-route en MCP geven dezelfde UC: een kruistest in `test-toets-krachten.mjs` of een nieuwe drie-wegen-test.

### Taak 4: 3D (B)

**Bestanden:**
- nieuw `components/openFem3d/openFem3dToetsKrachten.ts` (`bepaalToetsKrachten3D`);
- `App.tsx`: 3D-solve, `combinationSet` en de foutafhandeling;
- `openFem3dSolver.ts` (`bucklingModes`, de weigering bij platen);
- `openFem3dSteelCheck.ts`, `openFem3dTimberCheck.ts` en de betontoets in 3D (`first_order_envelope`);
- `openFem3dUitkraging.ts`.

**Acceptatie:**
- Een 3D-model in eerste orde toetst met P-Δ en scheefstand ±X/±Y.
- Hergebruik werkt als de instelling dezelfde rekengang al heeft.
- Een model met platen krijgt een weigering met een reden; de resultaten blijven.
- Een mislukte toetsrun blokkeert alleen de toets.
- De BGT komt uit de resultaten.
- Beton in 3D krijgt `first_order_envelope`.

**Test:** nieuw `test-open-fem3d-toets-krachten.mjs` (een kolom en een hal, eerste orde → P-Δ-toets; met platen → weigering), plus de bestaande 3D-tests, elk veranderd getal verantwoord.

### Taak 5: 3D via MCP (staalhal, IFC)

**Bestanden:** `design-mockup/src/mcp/staalhalSidecar.ts` en `ifcImportSidecar.ts`; Rust `staalhal_tools.rs` en `ifc_import_tools.rs` (beschrijvingen en uitvoer); `tests/staalhal_mcp.rs` en `tests/schema_strikt.rs`.

**Acceptatie:**
- De toets loopt via `bepaalToetsKrachten3D`; de uitvoer meldt de toetsanalyse.
- De standaard-staalhal krijgt bij instabiele combinaties (de wandverbanden) een weigering met een duidelijke reden en de suggestie "trek-alleen verbanden of zwaardere verbanden".
- De tests zijn bijgewerkt, met verantwoording.

### Taak 6: kernteksten en de minimale G

**Bestanden:**
- `nen-en-1993-1-1-stability/src/kniklengte.rs` (teksten);
- `steel-check/src/orchestrator.rs` (de kanttekening bij een opgegeven L_cr,y > L, B13);
- `design-mockup/src/components/fem/solver/alphaCr.ts` (`alphaCrStaafNotitie` verwijderen, inclusief de aanroepen in `steelCheckBuilder.ts` en `timberCheckBuilder.ts`);
- `zijdelingseKnikInVlakModel` en `openFem3DZijdelingseKnik`: de bewaking blijft, de commentaren veranderen;
- `timberCheckBuilder.ts` en `openFem3dTimberCheck.ts`: de vaste houtmelding (B10).

**Acceptatie:**
- Geen α_cr-staafnotitie meer.
- De kanttekening bij L_cr,y > L staat in de afleiding, met een Rust-test.
- De houtmelding staat bij elke houtstaaf.
- De Rust-tests zijn groen.

### Taak 7: rapport, UI en i18n (de minimale H)

**Bestanden:**
- `alphaCr.ts`: `analyseToelichting` en `stabiliteitsMeldingen`;
- `App.tsx`: de scheefstandtekst, de toast en `stabiliteitsMelding`;
- `report/src/lib.rs`: de inleiding, de scheefstandzin en de krachtregel;
- `LoadCaseTabBar.tsx`, `CheckBlock.tsx`, `CheckDetailSection.tsx`, `CheckPanel.tsx`, `checkReportUtils.ts`, `InsightsView.tsx`, `OpenFem3DReport.tsx` en `OpenFem3DExplorer.tsx`;
- de locales (nl, en, de, fr).

**Acceptatie:**
- Het rapport, het scherm en de PDF zeggen: resultaten volgens de instelling, toetskrachten tweede orde P-Δ met scheefstand φ = 1/…
- De φ-velden zijn altijd zichtbaar.
- De α_cr-meldingen zijn informatief (B14).
- `test-i18n-talen.mjs`, `test-i18n-meldteksten.mjs` en de rapporttests zijn groen, met verantwoording.

### Taak 8: referentiegetallen en de volledige verificatie (I)

**Werk:**
- Alle tests uit de ontwerpkaart (I) nalopen: veranderd, nagerekend of van betekenis veranderd. Per getal een verantwoording.
- De rekentijd meten: 2D-standaardset, 3D-hal en `check_fem_model`, vóór en na de wijziging.

**Volledige verificatie:**
1. `npm run build:sidecar`
2. `cargo build --release -p toetsbrug -p openaec-mcp-server -p open-fem-3d`
3. `npx tsc --noEmit`
4. `node scripts/run-tests.mjs`
5. `node scripts/run-tests.mjs --bundel`
6. `cargo test --workspace --exclude open-fem-studio --no-fail-fast`

Daarna de ts-rs-bestanden terugzetten die alleen regeleinden verschillen.

**Acceptatie:** alles groen, een lijst van alle veranderde getallen met hun verantwoording, en de meetuitkomsten van de rekentijd.
