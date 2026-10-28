# Ontwerpkaart #199: de UGT-toets rekent altijd tweede orde met scheefstand

De kaart is gebaseerd op tak `werk/pr-57`, commit 3ca13468 (release 2026.42.0), en op de bevindingen van 8 verkenners. Zij hebben alleen gelezen: er is niets gebouwd, gedraaid of gemeten. Paden zijn relatief aan `C:\Users\rickd\Documents\GitHub\Open-FEM2D-Studio`.

**Afkortingen voor bestanden die vaak terugkomen**

| Kort | Pad |
|---|---|
| `App.tsx` | `design-mockup/src/App.tsx` |
| `engine.ts`, `combinations.ts`, `alphaCr.ts`, `types.ts` | `design-mockup/src/components/fem/solver/` |
| `NonlinearSolver.ts` | `design-mockup/src/core/solver/NonlinearSolver.ts` |
| `useFemStore.ts` | `design-mockup/src/hooks/useFemStore.ts` |
| `sidecar.ts`, `staalhalSidecar.ts`, `ifcImportSidecar.ts` | `design-mockup/src/mcp/` |
| `scheefstandNorm.ts`, `modelNaarSolverInput.ts`, `houtEindstijfheid.ts`, `steelCheckBuilder.ts`, `timberCheckBuilder.ts`, `betonCheckBuilder.ts`, `eersteOrdeResultaten.ts`, `doorgaandeLijn.ts`, `betonStijfheid.ts`, `sectionResolver.ts` | `design-mockup/src/lib/` |
| `openFem3d*.ts(x)`, `OpenFem3D*.tsx` | `design-mockup/src/components/openFem3d/` |
| `bediening.ts`, `rapportExport.ts`, `rapportVoorwaarden.ts` | `design-mockup/src/bediening/` |
| `fem_tools.rs`, `main.rs`, `timber_tools.rs`, `gui_tools.rs`, `staalhal_tools.rs`, `ifc_import_tools.rs` | `src-tauri/crates/openaec-mcp-server/src/` |
| `steel-check/orchestrator.rs` | `src-tauri/crates/steel-check/src/orchestrator.rs` |
| `kniklengte.rs` | `src-tauri/crates/nen-en-1993-1-1-stability/src/kniklengte.rs` |
| `concrete-check/kolom.rs`, `concrete-check/orchestrator.rs` | `src-tauri/crates/concrete-check/src/` |
| `timber-check/orchestrator.rs` | `src-tauri/crates/timber-check/src/orchestrator.rs` |
| `report/lib.rs` | `src-tauri/crates/report/src/lib.rs` |
| `open-fem-3d/lib.rs`, `tweede_orde.rs` | `src-tauri/crates/open-fem-3d/src/` |
| `ndp_1995.rs` | `src-tauri/crates/nationale-bijlage/src/ndp_1995.rs` |

---

## 1. Hoe het nu werkt

In elk pad krijgt de toets precies de krachten van de resultatenberekening. Analysetype en scheefstand komen allebei uit de modelinstelling. De standaard is `eersteOrde`, met de scheefstand uit en φ-bron "vast" 1/200 (`useFemStore.ts:2200, 2210-2211, 2271`). Een nieuw model wordt dus standaard in eerste orde getoetst, zonder scheefstand.

| Pad | Analyse van de toetskrachten | Scheefstand in de toets | α_cr | Kniklengte bij een vrij eind |
|---|---|---|---|---|
| 2D-app | volgt `fem.analysetype`: `solveAllCases` (eerste orde) of `solveAllCasesNonlinear` (P-Δ per combinatie) (`App.tsx:2168-2196`) | alleen als de schakelaar aan staat; dan worden ook de BGT-combinaties ontvouwd (`useFemStore.ts:2244-2256`) | per UGT-combinatie bepaald (`alphaCr.ts:131-235`); bij eerste orde en α_cr < 10 een FOUT | L alleen bij tweede orde, scheefstand aan, staande staaf en φ_model ≥ `phiLosseKolom(L)` (`alphaCr.ts:455-479`), anders 2·L; hout altijd 2·L |
| 3D-app | `'linear'` bij eersteOrde, anders `'p-delta'`; fysisch gooit een fout (`App.tsx:2803-2806`) | alleen als de schakelaar aan staat; één φ voor X en Y, alleen UGT ontvouwd tot ±X/±Y (`openFem3dScheefstand.ts:93-134, 206-225`) | alleen bij P-Δ; lineair rekent met `bucklingModes` 0 | idem, met X én Y en een projectie (`openFem3dUitkraging.ts:142-187`); hout altijd 2·L |
| MCP `check_fem_model` | uit het projectbestand (eerst `analysetype`, dan `nonlinearEnabled`), anders het argument `nonlinear`, standaard false (`sidecar.ts:973-978`, `fem_tools.rs:342, 428`); fysisch wordt geweigerd (`sidecar.ts:979-988`) | volgt de modelvlag; φ wordt alleen afgeleid als de vlag aan staat en de bron niet "vast" is (`sidecar.ts:331-395`) | zoals 2D; FOUT-regel in `warnings` | zoals 2D |
| MCP staalhal en IFC | standaard `'linear'` (`staalhalSidecar.ts:77`, `ifcImportSidecar.ts:97`) | nooit | geen | altijd 2·L, want er gaat geen `scheefstandPhi` mee |
| API | er is geen reken- of toetscommando (`api/dekking.ts:100, 454`) | n.v.t. | n.v.t. | n.v.t. |

### 2D-app
- Er is één rekengang. Berekenen, de knop in het toetspaneel en de live-herberekening (300 ms, `App.tsx:222, 1818-1866`) lopen allemaal via `rekenDoor` (`App.tsx:2625-2677`). Die doet eerst `computeAndStoreSolverOutputs`, dan `combineResults`/`computeEnvelope` over `fem.actieveCombinaties` (UGT én BGT) en dan α_cr (`App.tsx:2206-2245`). Bij `tweedeOrdeFysisch` volgt de asynchrone betonronde (`App.tsx:2265-2504`), en pas daarna `handleRunMemberChecks` (`App.tsx:2513-2606`). Die toetst op **dezelfde** `combinationResults`-Map als het scherm. `stabiliteit` is de modelinstelling (`App.tsx:2557-2605`).
- Alles staat in één try/catch. Eén divergente P-Δ-combinatie wist alle resultaten (`App.tsx:2233`).
- `CheckTab.tsx` wordt nergens geïmporteerd. Alleen het bedieningscommando `toetsen` roept `handleRunMemberChecks` los aan (`bediening.ts:1120-1137`). Is er geen resultaat, dan rekent dat pad zelf door, maar zonder fysische ronde en met `fem.stabiliteit` uit de closure (`App.tsx:2536-2545, 2585`).
- Scheefstand in de berekening: één globale `schFactor = richting·φ` (`engine.ts:1047-1048`). Elke verticale lastcomponent krijgt een metgezel H = φ·V, ook op liggers, platen en randlasten (`engine.ts:1065-1075, 1619-1627, 1680-1799`).
- Hout krijgt geen `zijdelingse_knik_in_analyse` en houdt dus 2·L (`timberCheckBuilder.ts:1056-1061`). Bij tweede orde vervalt de eindstijfheid van hout (`houtEindstijfheid.ts:399-418`).
- Beton: `first_order_envelope` gaat alleen mee na een tweede-ordeberekening (`eersteOrdeResultaten.ts:36-43`). De poort λ/λ_lim staat bij λ ≥ λ_lim altijd op NotOk (`concrete-check/kolom.rs:891-947`).

### 3D-app
- De toets krijgt dezelfde `combinationSet` als de weergave (`App.tsx:2877-2887`).
- Standaard toetst 3D in eerste orde, zonder scheefstand en zonder α_cr. Elke staaf zonder vrij eind krijgt dan de staaflengte als kniklengte (`kniklengte.rs:554-583`, `openFem3dSteelCheck.ts:167-171, 330-331`).
- Een model met platen rekent altijd lineair (`openFem3dSolver.ts:1007-1010`). De kern weigert P-Δ met schaalelementen (`open-fem-3d/lib.rs:2004-2010`).
- De betontoets krijgt geen `first_order_envelope` (`openFem3dConcreteCheck.ts:73-97`).
- Elke rekenfout wist alle 3D-resultaten (`App.tsx:2860-2874, 2897-2908`).
- #194 (m per rij en richting, scheefstand ook op BGT, stabiliteitspoort) zit niet in `werk/pr-57`. Er ligt alleen een niet-gecommitte diff in de worktree `ofs-wt-65s`, 116 commits achter.

### MCP en sidecar
- `solve_fem_model` en `check_fem_model` delen `rekenDoor` (`sidecar.ts:886, 1299-1300, 1357-1358`).
- `check_fem_model` toetst geen beton: betonstaven komen in `skipped_beams` (`fem_tools.rs:661-668`).
- De uitvoer heeft `nonlinear_used` en `stability.analysis_type`, maar geen scheefstandveld (`sidecar.ts:1252-1263`).
- `solve_fem_model` levert ook `steel_check_inputs` op de resultaatkrachten (`sidecar.ts:1328-1332`). De toolbeschrijving belooft dat die ongewijzigd naar `check_steel_beam` kunnen (`fem_tools.rs:1311`).

### API en bediening
- Het bedieningskanaal gebruikt de App-functies en geeft het analysetype van het model terug (`bediening.ts:429, 1120-1176`).
- De rapportexport eist objectidentiteit: `lastRunData.combinationResults === fem.combinationResults` (`rapportExport.ts:106-107`).
- Voor 3D staat het analysetype in de export vast op `'tweedeOrdeGeometrisch'`, ook als er lineair gerekend is (`rapportExport.ts:90, 366`). Dat is nu al inconsistent.

---

## 2. Wat er moet veranderen (bouwstenen)

### A. Toetsrekengang 2D (het fundament)
**Doel:** één zuivere functie die uit de resultaatinvoer de UGT-toetskrachten maakt: altijd P-Δ, altijd scheefstand, in beide richtingen.

- **Nieuwe gedeelde lib-module**, bijvoorbeeld `design-mockup/src/lib/toetsKrachten.ts`. App en `sidecar.ts` roepen haar allebei aan, en ze wordt geëxporteerd in `design-mockup/src/mcp/kernel-exports.ts`.
  - Invoer: de MultiInput van de resultaatrekengang met `scheefstand: {phi: scheefstandUitkomst.phi, richting}`. Dus niet opnieuw `bouwMultiInput` aanroepen; de basis staat in `App.tsx:2168-2183`.
  - Uitvoer: toets-perCase met SecondOrderState, de UGT-toetscombinaties, de toetsresultaten en α_cr.
- **Toetscombinaties.** `metScheefstandRichtingen(actieveCombinaties.filter(c => c.type === 'uls' && c.eindtoestand === undefined), true, richting)` (`combinations.ts:193-219`; de functie is idempotent).
  - De UGT-eindtoestandvarianten moeten eruit. Anders gooit `combineResults` (`combinations.ts:373-392`); zie vraag 6.
- **Engine-helper.** Een lege perCase-Map met `SECOND_ORDER_KEY`, naast `solveAllCasesNonlinear` (`engine.ts:2700-2705`). `combineResults` → `solveCombinationSecondOrder` (`engine.ts:2536-2613`) doet de rest. Dat scheelt 2× het aantal belastinggevallen aan lineaire sommen.
- **Cache.** Een SecondOrderState nooit delen tussen invoer met verschillende scheefstand: de cachesleutel is `id|factoren`, zonder φ of richting (`engine.ts:2475-2480`, `combinations.ts:402-419, 741-746`).
  - Hergebruik van de resultaatrekengang mag alleen als het analysetype niet eersteOrde is, de schakelaar aan staat en de φ gelijk is. Na bouwsteen E komt daar bij: geen hout in het model.
- **α_cr** één keer per rekengang bepalen, niet per ontvouwde variant (circa 19 pivottellingen per combinatie, `alphaCr.ts:197-231`).
- **Foutafhandeling.** Een eigen try/catch voor de toets. Divergentie wist de resultaten niet meer (nu `App.tsx:2233`).
- **`handleRunMemberChecks`** (`App.tsx:2513-2606`):
  - combinaties = de BGT-combinaties uit `actieveCombinaties` (met de BGT-eindtoestand) plus de UGT-toetscombinaties;
  - één samengevoegde Map (de id's botsen niet);
  - `stabiliteit` = de toetsanalyse;
  - `eersteOrdeResultatenVoorKolomtoets` op de toets-perCase;
  - het fallbackpad (`App.tsx:2541-2545`, bedieningscommando `toetsen`) loopt ook via de toetsrekengang.
- **Fysische ronde** (`App.tsx:2265-2504`) draait op de toets-perCase, voor de UGT met DesignValues. Mislukt de ronde, dan wordt alleen de toets gewist (nu `App.tsx:2434-2450`).
- **Houteindstijfheid** (`houtEindstijfheid.ts:399-418`): de UGT leest de toetsanalyse, de BGT de resultaatanalyse (vraag 3 en 6).
- **Identiteitscontroles** vervangen door een vergelijking van generatie of modelversie:
  - `BetonStaafVenster.tsx:246-247` (`design-mockup/src/components/beton/dekking/`);
  - `rapportExport.ts:106-113` en `rapportVoorwaarden.ts:104-110`;
  - `App.tsx:2662, 2674` (`volledigeRekengangRef`).
- **`handleToonMaatgevend`** (`App.tsx:2049-2071`): het variant-id (id + 1 000 000) bestaat niet in de resultaten als de schakelaar uit staat (vraag 1).
- **Bestaande fouten die meegaan:**
  - het invalidatie-effect wist `stabiliteit` niet (`useFemStore.ts:3128-3138`);
  - het API-pad gebruikt `fem.stabiliteit` uit de closure in plaats van de verse waarde (`App.tsx:2542, 2585`).

**Afhankelijk van:** niets. **Levert aan:** C, F (2D), G, H en I.

### B. Toetsrekengang 3D
- `App.tsx:2806` splitsen in een resultaatanalyse volgens de instelling en een toetsanalyse die altijd `'p-delta'` is.
- Toets-φ = `openFem3dScheefstandUitkomst.phi`, los van de schakelaar (`App.tsx:993-1007, 2817`).
- Toetslijst: alleen de UGT, met `metScheefstandRichtingen3D(…, true)` en `solveOpenFem3DCombination(…, 'p-delta', scheefstandVanCombinatie(c, φ_toets))` (`App.tsx:2818-2831`). Hergebruik als de instelling al P-Δ met scheefstand en dezelfde φ is.
- Eigen state voor de toetsruns. De variant-id's (id + k·`SCHEEFSTAND_COMBO_OFFSET`) zijn in weergave en toets gelijk (`App.tsx:2843-2845`, `selectCombination` `3734-3743`).
- `combinationSet` voor de toets (`App.tsx:2877-2887`): de UGT-varianten met P-Δ-resultaten, de BGT uit de weergave, en `scheefstandPhi` altijd.
- Een mislukte toetsrun blokkeert alleen de toets, met de reden erbij. Nu valt alles weg door `Promise.all` en de catch (`App.tsx:2824-2831, 2897-2908`).
- `bucklingModes` = 1 voor de toetsruns (`openFem3dSolver.ts:966-968`). De poort rekent toch altijd minstens één knikfactor (`tweede_orde.rs:795-798`).
- Platen: daar bestaat geen P-Δ. Er moet een expliciete regel komen (vraag 5).
- `openFem3dUitkraging.ts:142-187`: de voorwaarden p-delta en X+Y zijn dan altijd waar. Zodra #194 een φ per as geeft, gaat de φ-eis per as.
- `openFem3dSteelCheck.ts:162` en de notities: de grondslag 5.2.2(7)b noemen.
- Het 3D-deel van F moet tegelijk mee. Anders komen r_m en φ_ef uit tweede-ordemomenten (terugval op #35) en telt de imperfectie om z dubbel.
- **#194 eerst samenvoegen of opnieuw bouwen.** De diff in `ofs-wt-65s` raakt `App.tsx`, `openFem3dSolver.ts`, `openFem3dSteelCheck.ts` en `openFem3dScheefstand.ts`, plus een nieuw `openFem3dStabiliteit.ts`.

**Afhankelijk van:** de regels van A (zelfde besluiten) en het besluit over #194. **Levert aan:** C (de 3D-tools), F (3D) en H (3D).

### C. MCP, sidecar en API (drie wegen)
- **`sidecar.ts:886`** splitsen: `opSolve` (1299) wordt de resultaatrekengang, `opCheck` (1357) de toetsrekengang via A.
- **Analysetype.** In de toets vast op tweede orde, ongeacht het bestand of `payload.nonlinear` (`sidecar.ts:973-988`). De weigering van fysisch opnieuw formuleren (vraag 7).
- **`leesScheefstand`** (`sidecar.ts:331-395`, vroege terugkeer op `367-369`): φ ook afleiden als de schakelaar uit staat.
- **Bouwers.** Twee resultatensets: de UGT uit de toets en de BGT uit de resultaten (`sidecar.ts:997-1009, 1099-1100, 1133-1134, 1162-1163`). `stabiliteit` wordt de toetsanalyse (`sidecar.ts:1109-1114, 1143-1148`). Meldingen herzien: `sidecar.ts:1055-1058, 1217-1219`.
- **Uitvoer van check** (`sidecar.ts:1252-1263, 1357-1397`):
  - `analysis_type` = de analyse van de toetskrachten;
  - nieuw: `stability.scheefstand {phi, noemer, bron, model_scheefstand_aan, afgedwongen}` en `model_analysis_type`;
  - een vaste regel in `warnings`;
  - liefst ook `analyse_toelichting` en `scheefstand_toelichting`, die in ReportInput al bestaan (`report/lib.rs:283-298`).
- **Voorstel (technisch, geen vraag aan de constructeur):**
  - `nonlinear` uit `CheckArgumenten` halen (`fem_tools.rs:148-204, 189, 428, 1344-1345`; `deny_unknown_fields`).
  - `steel_check_inputs` uit de solve-uitvoer halen. De golden-test `tests/fem_golden.rs:422-460` verliest dan velden, maar er verandert geen waarde.
- **Rust-bewaking.** Meldt de bundel de afgedwongen toetsanalyse niet, dan `TOETSING_ONMOGELIJK` in plaats van stil eerste orde (rond `fem_tools.rs:436-451`; een oude bundel via `OPENAEC_FEM_KERNEL`).
- **Teksten:**
  - `fem_tools.rs:1224-1225, 1321-1322, 1333`;
  - `main.rs:356, 435-445`;
  - `timber_tools.rs:216-221`;
  - `gui_tools.rs:1256, 1262, 1267` en de tijdslimieten 120 s / 300 s (`gui_tools.rs:984-990`; standaard `timeout_s` 60 in `fem_tools.rs:1346`);
  - de README van de MCP-server en de koptekst van `sidecar.ts` (11-19).
- **Bediening.** Een veld voor de toetsanalyse in `bediening.ts:429, 1150` en `rapportExport.ts:111, 366`. Het vaste `'tweedeOrdeGeometrisch'` voor 3D rechtzetten (`rapportExport.ts:90, 366`).
- **3D-MCP** (staalhal en IFC; `staalhalSidecar.ts:77, 109-131, 260-267`, `ifcImportSidecar.ts:97, 125-153, 278-281`, `staalhal_tools.rs:205-206, 292, 321-334`, `ifc_import_tools.rs:63, 180, 224, 311`, `tests/schema_strikt.rs:1450, 1633`): volgens vraag 5.
- **API.** Er is nu niets aan te passen. Het rekencommando uit fase 3 (`dekking.ts:100, 454`) moet A aanroepen.
- **Bouwvolgorde na elke wijziging aan kern of `engine.ts`:** `npm run build:sidecar`, een nieuwe `fem-kernel.mjs.sha256`, en `toetsbrug` en `openaec-mcp-server` opnieuw bouwen.

**Afhankelijk van:** A (2D) en B (3D-tools).

### D. Eigen scheefstand voor een losse kolom
- **2D-engine.**
  - `ScheefstandInput` (`types.ts:345-358`) krijgt optioneel `phiPerStaaf` en `phiPerKnoop`.
  - `schFactor` (`engine.ts:1047-1048`) wordt een factor per last: lijnlasten (1619-1627), knooplasten (1752-1777) en staafpuntlasten (1786-1799).
  - Plaat-eigengewicht en randlasten houden de model-φ.
  - Zonder map blijft de uitkomst bit-gelijk. Het tweede-ordepad neemt het vanzelf mee (`buildMesh` per combinatie, `engine.ts:2536-2551`).
- **3D.** `metScheefstandLasten` (`openFem3dScheefstand.ts:278-384`) werkt per memberId en nodeId. Vlaklasten houden de model-φ. Een gedraaide kolom krijgt φ/max(|cos α|, |sin α|) (vraag 9).
- **Herkenning.** Een nieuwe gedeelde functie naast `leidScheefstandGeometrieAf` (`scheefstandNorm.ts`), aangeroepen in `bouwMultiInput`, zodat app en sidecar hetzelfde doen.
  - De huidige herkenning (`doorgaandeLijn.ts:955-995`, `openFem3dUitkraging.ts:98-105`) ziet een kolom met alleen een uitkragende ligger op de kop als "Gaffel".
- **φ voor de last** = max(φ_model, φ_eigen). Vervangen, nooit optellen.
  - `phiLosseKolom` (`scheefstandNorm.ts:601-603`) kent alleen EN 1993; een φ per materiaal kan via `phiVolgensNorm` (`scheefstandNorm.ts:533-588`).
  - Rekenen met de hoogte in plaats van de lijnlengte (`steelCheckBuilder.ts:1529`, `openFem3dUitkraging.ts:159-161`).
- **Model-φ.** Losse kolommen uit m (`scheefstandNorm.ts:343-412`, `openFem3dScheefstand.ts:93-134`) en uit h (`scheefstandNorm.ts:317-328`). Een handmatige m of h gaat voor (`scheefstandNorm.ts:693-702`).
- **Toetszijde.** `StabiliteitVoorToets.scheefstandPhi` is nu één getal (`alphaCr.ts:360-372`). Dat wordt per staaf de toegepaste φ (Map) of een vlag. Raakt `zijdelingseKnikInVlakModel` (`alphaCr.ts:455-479`), `steelCheckBuilder.ts:1518-1534`, `openFem3DZijdelingseKnik` en `combinationSet.scheefstandPhi` (`App.tsx:2882`, `openFem3dSteelCheck.ts:115, 179`). Daarna vervallen de φ-eis en de bijbehorende kanttekening.
- **Afleiding.** Een regel per kolom (`scheefstandNorm.ts:838-848`, VertaalbareTekst met een `swayDerivation`-sleutel).
- **Nieuwe test:** ΣH = Σφ_i·V_i per variant. Anders vervalt de φ per plaats stil bij gesplitste staven of `beamSegments`.
- **5.3.2(4)B** (H_Ed ≥ 0,15·V_Ed) niet gebruiken. Dat volgt uit het besluit dat de scheefstand altijd meedoet (`scheefstandNorm.ts:112-114`).

**Afhankelijk van:** A, B en de vragen 8 en 9. **Levert aan:** G (de φ-eis vervalt) en E (de eigen φ voor hout).

### E. Hout: E_d en boogimperfectie
- **γ_M in de frontend.** Een TS-spiegel van `Ndp1995` (`ndp_1995.rs:16-22, 46-53`), met massief of gelamineerd volgens `timber_type` (`src-tauri/crates/nen-en-1995-1-1/src/data.rs:64-97`). Daarbij een test die het Rust-bestand leest, naar het patroon van `test-hout-eindstijfheid.mjs` [7] (r. 288-290).
- **2D.** Een functie `rekenstijfheidInvoer` naar het patroon van `eindstijfheidInvoer` (`houtEindstijfheid.ts:636-691`).
  - De engine maakt al één materiaal per unieke E (`engine.ts:380-399, 828`), dus de engine hoeft niet te veranderen.
  - CLT per laag (`sectionResolver.ts:403-409`).
  - Alleen in de toets, nooit voor de resultaten.
- **3D.** Een optie in `OpenFem3DSolveOptions` (`openFem3dSolver.ts:538-552`) die eMpa en gMpa van houtmaterialen door γ_M deelt (`openFem3dSolver.ts:700-753`). Het contract blijft gelijk (`open-fem-3d/lib.rs:95-108`).
- **Boogimperfectie e = 0,0025·l.**
  - 2D: equivalente lasten 8·N·e/l² plus eindkrachten 4·N·e/l, met N uit `eersteOrdeCombinatieResultaat` (`engine.ts:2677-2688`). Deze lasten krijgen geen φ·V-metgezel (`engine.ts:1619-1626`).
  - 2D: gedrukte houtstaven in de toets onderverdelen (0,25 / 0,5 / 0,75). Anders ontbreekt P·δ binnen het element (`engine.ts:2527-2535`).
  - 3D: (i) een adapterveld dat de KNIKDELEN-knopen verschuift (`open-fem-3d/lib.rs:46-66, 1205-1224`; het contract heeft `deny_unknown_fields`, `136-167`; tussenknopen moeten op de as liggen, `1011-1016`), of (ii) vervangende lasten in TS, ná `metScheefstandLasten`.
- **φ-eis en eigen φ voor hout** volgens EN 1995 (5.1) (`scheefstandNorm.ts:83-90, 543-556`), niet `phiLosseKolom`.
- **Bouwers zetten `zijdelingse_knik_in_analyse`:** `timberCheckBuilder.ts:1056-1061` en `openFem3dTimberCheck.ts:237-244`. De kern kent het veld al (`timber-check/orchestrator.rs:272-300`).
- **Teksten:** `timber-check/orchestrator.rs:285`, `timber-check/src/input.rs:271-286`, `kniklengte.rs:55-58`, `alphaCr.ts:448-450`, `timber_tools.rs:215-221`.
- **EC3-kanttekening `alphaCrStaafNotitie`** weg bij hout (`timberCheckBuilder.ts:985-992`).
- **UGT-eindtoestandvarianten** uit de toets; de BGT-eindtoestand blijft in de resultaten (`houtEindstijfheid.ts:115-117, 399-418`).
- **3D-normregex** voor D- en LVL-klassen (`openFem3dScheefstand.ts:177-186`) gelijktrekken met de kern, die die klassen niet toetst.
- **Tussenstand in fase 1:** hout zit met E_mean in de toets-P-Δ, houdt 2·L en krijgt een expliciete melding.

**Afhankelijk van:** A, B, D en vraag 6.

### F. Beton: §5.8 zonder dubbeltelling
- **Kernveld (voorstel)** `tweede_orde_in_krachten: geen | geometrisch | fysisch` in `ConcreteBeamCheckInput` (`concrete-check/src/input.rs`) en `ConcreteColumnCheckRequest` (`concrete-check/kolom.rs:262-310`).
  - De poort om y (`concrete-check/kolom.rs:891-947, 985-995`) wordt alleen bij `fysisch` Ok of n.v.t., en telt dan niet meer mee in `uc_max` (`concrete-check/orchestrator.rs:1154-1171, 2414-2420`).
  - Voorwaarde: e_i om y. Die ontbreekt nu in toets en analyse (`concrete-check/orchestrator.rs:1706, 1724`).
- **`first_order_envelope` altijd meegeven.** De voorwaarden in `eersteOrdeResultaten.ts:36-43` en `betonCheckBuilder.ts:627-632` vervallen.
  - Bron: de eerste orde van de **toets-perCase**. §5.8 weigert als de maatgevende combinatie ontbreekt (`concrete-check/kolom.rs:1188-1196`), en de varianten id + 1 000 000 bestaan alleen in de toetsset. *(Dit is een afleiding uit twee feiten, geen bevinding van één verkenner.)*
- **3D.** `first_order_envelope` in `openFem3dConcreteCheck.ts:73-97`. Om z komen M₀Ed,z en r_m uit de eerste orde (`concrete-check/kolom.rs:1711-1712, 1729, 2080-2084`). De notitie in `concrete-check/kolom.rs:1821-1826` corrigeren.
- **BGT (scheurwijdte):** `sls_frequent_envelope` (`betonCheckBuilder.ts:674-677`) uit de resultaatset.
- **Later fysisch via MCP:** de injecteerbare `roep` (`betonStijfheid.ts:439-451, 951-953`) en `concrete_segment_stiffness` bestaan. Het sidecarprotocol kent nog geen terugroep naar Rust.
- **Schema's:** het MCP-schema, `design-mockup/src/mcp/valideerModel.ts` en `tests/schema_strikt.rs`.

**Afhankelijk van:** A (2D), B (het 3D-deel gaat tegelijk met B) en vraag 7.

### G. Regels in de staalkern en C_m
- **`StabiliteitVoorToets`** wordt de toetsanalyse: `App.tsx:2583-2591`, `sidecar.ts:1098-1114, 1137-1148`, `design-mockup/src/stores/checkStore.ts:187`. `scheefstandPhi` gaat altijd mee.
- **`alphaCrStaafNotitie`** (`alphaCr.ts:388-419`) verwijderen of herschrijven. Aanroepen: `steelCheckBuilder.ts:1507-1517` en `timberCheckBuilder.ts:985` (hout deelt de functie).
- **`zijdelingseKnikInVlakModel` en `openFem3DZijdelingseKnik`:** de voorwaarden op analysetype en scheefstand vervallen. "Staand" en de φ-eis blijven tot bouwsteen D. Liggende uitkragingen met druk houden 2·L.
- **`kniklengte.rs:280-293`:** het mechanisme blijft (geen opgave = 2·L, de veilige kant). Alleen de teksten veranderen (`228-240, 261-272`, vlaknotitie `591-616`).
- **Sway-regel** (`steel-check/orchestrator.rs:2113-2127`): blijft voor L_cr,y > L, maar het commentaar moet anders. Een opgegeven L_cr,y > L telt de sway dan dubbel (vraag 10).
- **C_m-ondergrens** (`steel-check/orchestrator.rs:2128-2153`): volgens vraag 10. Vervalt de ondergrens om y, dan moeten `zijdelings_l_1` en `vrij_as_2` gesplitst worden (`1574-1583`).
- **Kip, 6.3.3 en q_equiv** (`steelCheckBuilder.ts:606-654`): geen codewijziging, wel andere uitkomsten. In 3D bevat de momentenlijn een P·δ-bolling die als verdeelde last telt.
- **Eventueel een kernveld** "krachten zijn tweede orde" voor de vlaknotitie. Dan ook het MCP-schema, `valideerModel.ts` en `schema_strikt.rs` bijwerken.

**Afhankelijk van:** A en B, D (voor de φ-eis) en vraag 10.

### H. Rapport, UI en i18n
- **`analyseToelichting`** (`alphaCr.ts:326-358`) krijgt twee regels: één voor de resultaten en één voor de toetskrachten ("tweede orde P-Δ met scheefstand φ = 1/…, systeemlengte 5.2.2(7)b"). De regel "eerste orde is toegestaan…" (`alphaCr.ts:347-350`) gaat dan alleen over de resultaten.
- **`stabiliteitsMeldingen`** (`alphaCr.ts:260-319`): de FOUT "EERSTE ORDE NIET TOEGESTAAN", de waarschuwing "zet de scheefstand aan" en "α_cr niet bepaald" verliezen hun betekenis voor de toets. Er komt een nieuwe fout bij divergentie.
- **Scheefstandtekst** mag niet meer leeg zijn als de schakelaar uit staat (`App.tsx:1008-1012, 1020-1036, 4338-4345`). Ook het commentaar op die plekken aanpassen: `ReportDataContext.tsx:100-110`, `ReportTab.tsx:57-66`, `rapportPdfInvoer.ts:195-216`, `report/lib.rs:267-281` (via ts-rs ook `ReportInput.ts:157`).
- **PDF:** de inleiding (`report/lib.rs:1146-1151`), de scheefstandzin (`1177-1182`) en de krachtregel (`1646-1654`).
- **Instellingen:** `LoadCaseTabBar.tsx:598-614` (Analyse), `773-785` (Scheefstand) en `791-877` (de φ-velden zijn nu alleen zichtbaar als de schakelaar aan staat).
- **Label "2e orde + scheefstand" bij de toetskrachten:** `CheckBlock.tsx:187-193`, `CheckDetailSection.tsx:285-299`, `CheckPanel.tsx:307`, `FemCanvas.tsx:5411-5413`, `FemProjectTree.tsx:146`, `checkReportUtils.ts:519-555`.
- **Analyse bij de resultaten:** `resultScope.tsx:127-136`, `FemCanvas.tsx:3920-3949`, `StatusBar.tsx:63-70`.
- **Combinatienamen in het rapport** uit `lastRunData.combinations` (`CheckTableSection.tsx:80-90, 213-214`), zoals `CheckPanel.tsx:257-261` al doet. Anders verschijnt "comb. 1000003".
- **De α_cr-keten:** de toast (`App.tsx:2114, 2123-2142`), het foutvak in Inzichten (`InsightsView.tsx:412, 446-461`), de MCP (`sidecar.ts:1217-1219`) en het 3D-rapport (`OpenFem3DReport.tsx:467, 471-473, 519-536`).
- **3D:** `OpenFem3DReport.tsx:465-479, 516-540, 765-768`; `OpenFem3DExplorer.tsx:423-428` (vaste Nederlandse tekst); `openFem3d.normBasis` (`OpenFem3DProperties.tsx:795-797`; de tekst "kniklengtes vallen terug op L" klopt nu al niet).
- **Beton:** `BetonSection.tsx:568-574, 628-673`, `BetonStijfheidSection.tsx:470-476`. **Hout:** een eigen regel in het analyseblok.
- **Losgekoppeld rapportvenster:** de snapshotvelden in `reportSync.ts:125-140, 270-330, 540-545`. Labels: `femTypes.ts:1738-1756`.
- **i18n.** Nieuwe sleutels in nl/en/de/fr: `loadCases.analysisResultsNote`, `swayResultsNote`, `resultView.checkForces/resultsBasis`, `report.scopeAnalyse/basisKrachten/krachtregelTweedeOrde/betonTweedeOrdePDelta`, `openFem3d.report.checkForces`, `openFem3d.resultsHint`, `check:block.forcesSecondOrder` en `swayDerivation.alwaysInChecks/freeColumnOwn`.
  - Bestaande waarden wijzigen in vier talen: `resultView.ucCombinations`, `loadCases.swayTitle`, `swayDerivation.directionBoth/directions3d`, `openFem3d.report.alphaCrNote`, `openFem3d.normBasis`, `report.betonNietTweedeOrde`, `betonNietImperfecties`, `eisNietGerekend`.
  - `app.stability.firstOrderNotAllowed` verdwijnt uit alle vier talen tegelijk.
  - `test-i18n-talen.mjs:20-22, 90, 108-131` eist dezelfde sleutels in alle talen, en geen Nederlandse kernwoorden in de/fr.
- **Voorstel (technisch):** de teksten in `alphaCr.ts`, de PDF en de MCP blijven Nederlands, volgens de lijn van issue #33.

**Afhankelijk van:** A en B (de gegevens), D, E en F (de inhoud) en vraag 1.

### I. Tests en referentiegetallen
De verkenners schatten 70 tot 100 plekken die verantwoord moeten worden, waarvan ongeveer 40 getallen. Grofweg 30 veranderen zeker, 30 moeten worden nagerekend en 35 veranderen van betekenis. Elk getal apart verantwoorden en nooit blind bijwerken.

| Groep | Tests (bestand:regel) |
|---|---|
| **Getallen veranderen zeker** (de toets loopt via de route die nu de modelinstelling volgt) | `test-vrij-eind-tweede-orde.mjs` [5] `397-439`: L_cr,y van 6000 naar 3000 waar de toets-φ ≥ de eigen φ; het geval φ = 1/346 pas met D. `test-vakwerk-kniklengte.mjs` `594` (kip-UC 2,235) en `604-605` (14 000 → systeemlengte). `test-veldmaximum.mjs:337-339` (25,3125 met relTol 1e-5; P-Δ geeft naar schatting ~6·10⁻⁴). `test-hout-bgt-eindtoestand.mjs:419` (byte-identiek met de eerste-orde-app-gang). Plaattoetsen: `test-plaat-toets-staal.mjs:90-104, 145`, `-hout.mjs:108-110, 126`, `-beton.mjs:97`, `tests/plaat_in_check_fem_model.rs:138-139, 179, 214-216` (combinatie-id's en volgorde). Staalhal en IFC: `test-staalhal-sidecar.mjs:117, 123, 125, 149-153`, `test-ifc-analyse-sidecar.mjs:121-127`, `tests/staalhal_mcp.rs:175, 184-202` (afhankelijk van vraag 5) |
| **Narekenen** (vaak binnen de tolerantie) | `test-vakwerk-kniklengte.mjs:585` (0,278), `595`, `601`; `test-trapeziumlast-zonder-q.mjs:238` (V_Ed 43,5); de BGT-getallen in `tests/drie_wegen_controle_2026_10.rs:327-365`, `test-blijvende-zakking.mjs:405-406` en `test-clt-doorbuiging.mjs:266-267` (blijven gelijk als de BGT uit de resultaten komt); de controlemodellen B6, B7, K3, K5 en B15 (`test-controle-2026-10.mjs:109-243`) |
| **Betekenis verandert** (regels van 2026.42) | `test-vrij-eind-tweede-orde.mjs` [1]–[4] `120-125, 161-359` (de φ-eis en de α_cr-kanttekening op `211-229`; 3D-φ 1/346: UC van 0,399 naar 0,208; hout-L: L_cr,z van 4000 naar 2000); `steel-check/tests/vrij_eind_tweede_orde.rs:152-195` (C_m 0,9); `kniklengte.rs:749-771`; `test-alpha-cr.mjs:98-127`; `test-vakwerk-scharnieren.mjs:133-140, 172-173, 313`; `test-kolom-eerste-orde.mjs:136-140, 183-193`; `test-hout-eindstijfheid.mjs:169`; `test-i18n-meldteksten.mjs:359-381, 492-527`; `report/tests/rapportaanvulling_pdf.rs:516-519, 551` |
| **Breekt op de broncode, niet op gedrag** | `test-kolom-eerste-orde.mjs:212-219` (regex op `App.tsx`), `test-open-fem3d-scheefstand.mjs:72-81, 131-139`, `test-rekengang-generatie.mjs:8-21`, `test-maatgevend`, `test-rapport-gereedheid`, `test-verouderd`. Omzetten naar gedragstests in plaats van de regex bijwerken |
| **MCP-schema en golden** | `tests/fem_golden.rs:422-460` en `golden/portaal.verwacht.json:177, 1775, 1786`; `nonlinear` in `test-vrij-eind-tweede-orde.mjs:404-409` en `test-vakwerk-kniklengte.mjs:567`; `tests/schema_strikt.rs:241, 840`; `tests/beton_in_check_fem_model.rs:227-284` (alleen bij een weigering van beton) |
| **Blijven gelijk** | kerntests met opgegeven krachten (`calc2_beam1.rs`, `portal_beam*.rs`, kip-tests, `timber-check/tests/referentie_raamwerk.rs`); bouwertests die zelf `solveAllCases` draaien (die stellen dan wel niet meer de app-route voor: beslissen of ze naar A gaan) |

**Werkwijze.** Na elke wijziging aan de kern of de engine: `npm run build:sidecar`, `cargo build --release -p toetsbrug -p openaec-mcp-server`, en dan de runner met en zonder `--bundel` (`scripts/run-tests.mjs`). **Nieuwe tests:** ΣH = Σφ_i·V_i; divergentie laat de resultaten staan; de export na het splitsen van de sets.

---

## 3. Volgorde en opsplitsing

#199 is goed op te splitsen. De afhankelijkheden zijn:

```
Fase 0 ──► A ─┬─► C (2D) ─┐
              ├─► G (min) ├─► H (min) ─► I         = fase 1
              └─► F (2D: first_order_envelope)
#194 ────► B ─► F (3D) ─► C (3D-tools) ─► H (3D)    = fase 2
A + B ───► D ─► G (φ-eis weg, C_m)                  = fase 3
A + B + D ► E                                       = fase 4
A + B ───► F (kernveld, e_i om y, fysisch via MCP)  = fase 5
A ───────► H (diagram toetskrachten)                = fase 6
```

**Fase 0, voorwerk (klein, apart te reviewen)**
- Bestaande fouten rechtzetten: `stabiliteit` niet gewist (`useFemStore.ts:3128-3138`), de oude `fem.stabiliteit` (`App.tsx:2542, 2585`), het vaste 3D-analysetype in de export (`rapportExport.ts:90, 366`) en de `openFem3d.normBasis`-tekst.
- De regexen op de broncode omzetten naar gedragstests, zodat het herstructureren in fase 1 de tests niet zonder reden laat vallen.
- Besluiten hoe #194 en de worktree `ofs-wt-65s` samenkomen.

**Fase 1, de kleinste waardevolle stap: "2D-toets en `check_fem_model` altijd P-Δ met scheefstand"**
- Omvat A, C (2D-deel), G (minimaal), F (alleen `first_order_envelope` uit de toets-perCase), H (minimaal) en I (bijbehorend).
- H minimaal is: de analysetoelichting, de PDF-inleiding, het label bij de toetskrachten, de scheefstandtekst, de combinatienamen, de identiteitscontroles, de maatgevend-markering en de α_cr-meldingen informatief maken.
- In de Rust-kern hoeft niets te veranderen: C_m blijft, de φ-eis blijft, hout houdt 2·L met een melding, en beton rekent P-Δ elastisch met de poort zoals nu. Alleen het MCP-schema, de beschrijvingen en de golden veranderen.
- **Waarom eerst:** het raakt elke 2D-staalstaaf, en de drie wegen zijn meteen gelijk. Met de standaard-φ 1/200 is de φ-eis voor staal altijd gehaald (`scheefstandNorm.ts:601-603, 656-690`), dus een vrije kop krijgt direct L.
- Vereist antwoord op de vragen 1 tot en met 4 en vraag 6, het deel over de eindtoestandvarianten.

**Fase 2: 3D**
- Omvat B, het 3D-deel van F, de 3D-tools van C (volgens vraag 5) en H (3D). Na #194.
- **Alternatief:** fase 2 vóór fase 1. 3D heeft het grootste huidige veiligheidsgat: eerste orde, L voor elke staaf zonder vrij eind, en geen α_cr. Het nadeel is het samenvoegen met #194 en de platen.

**Fase 3: eigen φ voor een losse kolom**
- Omvat D, het wegvallen van de φ-eis in G, het C_m-besluit (vraag 10) en m en h van de model-φ.

**Fase 4: hout volgens EN 1995**
- Bouwsteen E: E_d, boog, eigen φ volgens (5.1), daarna L in plaats van 2·L.

**Fase 5: beton volgens §5.8**
- De rest van F: het kernveld, de poort, e_i om y, en eventueel fysisch rekenen via MCP.

**Fase 6: toetskrachten als diagram**
- Een schakelaar "Toetskrachten (2e orde)", en "Toon op tekenvlak" die naar die set overschakelt.

**Voorstel voor 2026.43:** fase 0 en fase 1 als #199 deel 1. De andere fasen worden vervolgissues, elk met een eigen spec.

---

## 4. Open vragen voor de constructeur

**1. Wat doen de instellingen Analyse en Scheefstand na #199, en hoe ziet de gebruiker de toetskrachten?**
- Opties:
  - (a) De resultaten volgen de instelling zoals nu, de toets rekent altijd zelf.
  - (b) De resultaten worden altijd eerste orde en de instelling vervalt.
  - (c) Als (a), plus een weergave "Toetskrachten (2e orde)" op het tekenvlak.
- Daarbij twee deelkeuzes:
  - de schakelaar Scheefstand wordt "ook in de resultaten", en de φ-velden zijn altijd zichtbaar;
  - de α_cr-meldingen worden informatief: geen toast, geen foutvak en geen `FOUT:` meer in de MCP.
- **Aanbeveling:** (a) nu, met het label "2e orde + scheefstand" bij elke toetskracht. "Toon op tekenvlak" zet de markering alleen als de resultaten gelijk zijn aan de toetsset en geeft anders een melding. (c) komt in fase 6. De schakelaar blijft met de betekenis "ook in de resultaten", en de φ-velden zijn altijd zichtbaar. De α_cr-meldingen worden een informatieve regel.
- **Waarom:** (a) laat projectbestanden en de weergave ongemoeid. Met P-Δ en scheefstand aan kost de toets niets extra. Nu verdwijnen de φ-velden als de schakelaar uit staat (`LoadCaseTabBar.tsx:791-877`), terwijl de toets die φ wel gebruikt. Zonder regel voor de markering staat een tweede-ordetoets op een eerste-ordediagram (`App.tsx:2049-2071`).

**2. Welke φ gebruikt de UGT-toets als de schakelaar Scheefstand uit staat?**
- Opties:
  - (a) De projectinstelling (bron, noemer, h, m via `scheefstandUitkomst`; standaard vast 1/200).
  - (b) Altijd de normafleiding (5.5) uit de geometrie.
  - (c) Altijd "ongunstigste".
  - (d) Als (a), maar met hout in het model minstens de φ van EN 1995 (5.1), met een melding.
- **Aanbeveling:** (a), met (d) zodra er hout in het model zit. φ en bron staan in het rapport en in de MCP-uitvoer. Er komt een waarschuwing als een ingetikte noemer onder de normwaarde ligt.
- **Waarom:** φ wordt nu al los van de schakelaar berekend (`App.tsx:966-984, 993-1007`), dus de φ verandert niet door aan- of uitzetten. 1/200 is de bovengrens van (5.5) en ligt nooit onder (5.1) (`scheefstandNorm.ts:83-90, 543-556`). De verkenner van de tests gaf de voorkeur aan (b). Volgens `test-scheefstand-mcp` scheelt de normkeuze tot een factor 1,94.

**3. Komen de BGT-toetsen (doorbuiging, h/300, scheurwijdte) uit de resultaatrekengang of uit de toetsrekengang?**
- Opties:
  - (a) Uit de resultaten: eerste orde volgens de instelling.
  - (b) Uit de toets: P-Δ met scheefstand.
- **Aanbeveling:** (a), in 2D, 3D en MCP.
- **Waarom:** de imperfecties van 5.3 horen bij de UGT, en het besluit noemt zakkingen als resultaat. De BGT-eindtoestand van hout (2.2.3(4)) blijft dan bestaan (`houtEindstijfheid.ts:399-418`), en ongeveer 20 vastgelegde BGT-getallen blijven gelijk. De prijs is dat de bouwers twee resultatensets moeten lezen. Of de 3D-BGT een scheefstand krijgt (besluit 6 okt), blijft bij #194.

**4. Wat gebeurt er als de P-Δ van de toets niet convergeert (α_cr ≈ 1 of lager)?**
- Opties:
  - (a) De resultaten blijven staan en de toets wordt geweigerd, met de reden per combinatie.
  - (b) Alles wissen, zoals nu.
  - (c) Terugvallen op een eerste-ordetoets met een waarschuwing.
- **Aanbeveling:** (a).
- **Waarom:** (c) is precies wat #199 wil uitsluiten. (b) wist nu ook de eerste-ordewaarden (`App.tsx:2233`, `2897-2908`). Let op de gedragsverandering: modellen die nu nog een UC met een rode melding krijgen, krijgen geen toets meer. MCP geeft dan `MODEL_ONOPLOSBAAR` (`fouten.ts:205-240`). Met E_d voor hout (fase 4) daalt N_cr en divergeert dit vaker.

**5. Hoe ver gaat #199 in 3D?**
- **(a) Modellen met platen**, waar geen P-Δ bestaat (`openFem3dSolver.ts:1007-1010`, `open-fem-3d/lib.rs:2004-2010`).
  - Opties: de toets weigeren met een reden; eerste orde met een kanttekening (in strijd met "nooit terugvallen"); K_G voor schaalelementen bouwen (groot werk).
  - **Aanbeveling:** weigeren met een reden, en K_G voor platen als vervolgissue.
- **(b) De MCP-tools staalhal en IFC.**
  - Opties: dezelfde regel als de app; later, met in de uitvoer welke analyse gebruikt is.
  - **Aanbeveling:** ze volgen fase 2, met dezelfde functie als de app. Tot dan meldt de uitvoer "toets eerste orde, zonder scheefstand".
  - Voor de standaard-staalhal moet daarnaast gekozen worden: wandverbanden trek-alleen als standaard in de wizard, of de geweigerde combinaties als "niet getoetst" melden.
- **Waarom:** zonder regel blijft elk 3D-model met een plaat stil eerste orde. Bij P-Δ weigert de standaard-staalhal 3 berekeningen, met scheefstand 8, omdat de wandverbanden CHS 88,9×4 zelf knikken (α_cr = 0,688; `test-open-fem3d-staalhal-pdelta.mjs:25-37`). De verkenners waren het niet eens over (b): de 3D-verkenner wilde het mee, de MCP-verkenner niet in 2026.43.

**6. Hout in de toets: wat in 2026.43, en wat daarna?**
- Opties:
  - (A) Nu inbouwen: E_d = E_mean/γ_M per houtstaaf (G_d ook), de boog e = 0,0025·l en φ, daarna k_c met de systeemlengte L en E_0,05 (methode b).
  - (B) 2·L houden. Hout gaat met E_mean mee in de toets-P-Δ, met een expliciete melding dat dit niet de volledige EN 1995-route is.
  - (C) Hout buiten de toetsrekengang houden (eerste orde).
- **Deelkeuze die al in fase 1 nodig is:** de UGT-eindtoestandvarianten (E_mean,fin) vervallen in de toets, met een melding, en de BGT-eindtoestand blijft. Het alternatief is ze als eerste-ordevarianten te houden, maar dan is de toets weer eerste orde.
- **Bij (A) ook vastleggen:**
  - k_c met L, niet k_c = 1;
  - één toetsberekening voor een gemengd model (hout E_d, staal E);
  - de eigen φ van een losse houten kolom volgens (5.1) met h = de staaflengte;
  - CLT per laag; schijven en veren alleen melden.
- **Aanbeveling:** (B) in fase 1, (A) als fase 4. De eindtoestandvarianten vervallen in de toets.
- **Waarom:** k_c = 1 is uit de code niet te onderbouwen. E_d van C24 (8462) ligt boven E_0,05 (7400), dus k_c = 1 kan onveilig zijn. De externe referentie-berekening toetst na tweede orde met k_c op de systeemlengte (`referentie_raamwerk.rs:98`). Het laten vallen van de eindtoestandvarianten volgt de eigen lezing van de app (`houtEindstijfheid.ts:115-117`), en `combineResults` sluit de combinatie technisch uit (`combinations.ts:383-388`). Staal-UC's in gemengde onbepaalde constructies kunnen daardoor dalen.

**7. Beton: wanneer fysisch niet-lineair, en wanneer mag de poort om y op groen?**
- **(a) Wanneer fysisch.**
  - Opties: altijd zodra er een betonstaaf met korf is; alleen bij het analysetype `tweedeOrdeFysisch`; nooit in de toets.
  - **Aanbeveling:** voorlopig alleen bij `tweedeOrdeFysisch`. Anders P-Δ met de elastische EI, en de poort blijft NotOk met een duidelijke tekst.
  - De beton-verkenner gaf de voorkeur aan "verplicht in de app voor kolommen met een kolomblok".
- **(b) De poort.**
  - Opties: een kernveld `tweede_orde_in_krachten` (geen / geometrisch / fysisch), waarbij de poort alleen bij fysisch Ok of n.v.t. wordt; `first_order_envelope` als signaal; niets veranderen.
  - **Aanbeveling:** het kernveld, met e_i om y als voorwaarde.
- **(c) 3D om z.**
  - **Aanbeveling:** `first_order_envelope` meegeven, en M₀Ed,z en r_m uit de eerste orde nemen.
- **(d) MCP** weigert alleen als de app de fysische ronde zou draaien.
- **Waarom:** de ronde is asynchroon en zwaar: tot 25 rondes met kernaanroepen per betonstaaf (`betonStijfheid.ts:109, 921-1061`). De sidecar kan hem niet draaien en 3D heeft hem niet, dus "altijd" laat de drie wegen uiteenlopen. Geometrische P-Δ met de ongescheurde Ecm is geen tweede orde volgens §5.8. Een poort op Ok mist dan de imperfectie bij een geschoorde slanke kolom.

**8. De eigen scheefstand van een losse kolom: wanneer, in welke vorm en volgens welke norm?**
- **(a) Wanneer:** in fase 3, met tot dan de φ-eis van 2026.42 (L alleen als φ_toets ≥ φ_eigen), of al in fase 1.
- **(b) Vorm:** een metgezel per last met φ = max(φ_model, φ_eigen), vervangen en nooit optellen; of een extra kopkracht (φ_eigen − φ_model)·N; of een geometrische scheefstand.
- **(c) Norm voor φ_eigen:** altijd EN 1993, zoals `phiLosseKolom` nu; of de norm van het materiaal (EN 1993; EN 1992 met θ₀ = 1/300; EN 1995 (5.1)).
- **Aanbeveling:** (a) fase 3; (b) een metgezel per last met max(φ_model, φ_eigen); (c) de norm van het materiaal, en daarna het maximum met φ_model.
- **Waarom:** met de standaard 1/200 is de φ-eis voor staal al gehaald, dus de winst komt pas bij een normbron. De metgezel gebruikt het bestaande mechanisme (`engine.ts:1619-1627, 1760`; `metScheefstandLasten`). Voor een kolom op een oplegging geeft dat dezelfde staafkrachten als fig. 5.4 en EC2 5.2(7)b. EN 1993 geeft voor een houten kolom van 4 tot circa 11 m een te kleine φ.

**9. Wat telt als losse kolom?**
- **(a) Herkenning:**
  - Opties: zoals nu een vrij eind volgens `bepaalStaafeinden`; topologisch (het deel boven de voet heeft geen oplegging, geen plaat en geen andere kolomlijn); handmatig met een automatische suggestie.
  - **Aanbeveling:** topologisch, met handmatige overschrijving. Dat vangt ook de luifel- of T-kolom, die nu "Gaffel" krijgt (`doorgaandeLijn.ts:975-992`, `openFem3dUitkraging.ts:101-103`).
- **(b) h bij een tussenaansluiting** (bijvoorbeeld HEA200 van 0 tot 7 m met een pendelligger op 3 m):
  - Opties: de hele lijn (zoals 2026.42); alleen het vrije deel boven de aansluiting.
  - **Aanbeveling:** het vrije deel, met φ_eigen alleen op de lasten op de kolom zelf. Een kleinere h geeft een grotere α_h en ligt dus aan de veilige kant. De verkenners waren het hier niet eens; de norm behandelt dit geval niet expliciet.
- **(c) m en h van de model-φ:**
  - Opties: losse kolommen meetellen zoals nu; uit m halen; uit m en uit h halen.
  - **Aanbeveling:** uit allebei, met een regel in de afleiding. Een handmatige m of h gaat voor. Nu verlagen losse kolommen φ voor de rest van het gebouw.
- **(d) Kolom op een ligger:**
  - Opties: alleen vervangen; vervangen plus een correctie aan de voet (fig. 5.4).
  - **Aanbeveling:** alleen vervangen en dat melden. Dat is conservatief zolang φ_eigen ≥ φ_model.
- **(e) Gedraaide 3D-kolom:**
  - Opties: φ delen door max(|cos α|, |sin α|); extra varianten langs de hoofdassen; 2·L houden.
  - **Aanbeveling:** delen. Dat is goedkoop, ligt aan de veilige kant, en dezelfde factor zit al in `openFem3dUitkraging.ts:165-168`.

**10. De staalkern: blijven de dubbele sway-maatregelen?**
- **(a) C_m ≥ 0,9 bij een vrij eind waarvan de knik in de tweede orde zit** (`steel-check/orchestrator.rs:2128-2153`):
  - Opties: houden; om y laten vallen bij `VrijEindTweedeOrde`, maar houden bij L_cr > L en om z in 2D; altijd uit de momentenlijn.
  - **Aanbeveling:** in fase 1 houden (geen kernwijziging, veilige kant). In fase 3, met de eigen φ in de berekening, om y laten vallen als de constructeur de noot bij tabel B.3 zo leest; om z in 2D houden.
- **(b) Een opgegeven L_cr,y > L:**
  - Opties: houden zoals nu (C_my = 0,9, dubbel veilig); houden met een kanttekening dat de sway dubbel telt en dat 5.2.2(7)b L toestaat; weigeren of negeren.
  - **Aanbeveling:** houden met de kanttekening.
- **Waarom:** de code zegt zelf dat de norm het open laat. Drie verkenners zouden de ondergrens om y laten vallen, de verkenner van de losse kolom zou hem houden. Het effect is C_my van 0,9 naar 0,6 bij ψ = 0, dus k_yy × 2/3 (`vrij_eind_tweede_orde.rs:152-176`). Oude projecten hebben L_cr,y mogelijk ingevuld op advies van de α_cr-kanttekening.

---

## 5. Risico's en normtechnische onzekerheden

**[NORM] normtechnisch onzeker**
- **C_m-ondergrens na methode b:** de noot bij tabel B.3 en 5.2.2(7)b/(8) zijn niet gelezen. De code zegt "laat de norm open" (`steel-check/orchestrator.rs:2128-2142`).
- **EN 1995-1-1:**
  - waar E_d = E_mean/γ_M staat: 2.2.2(1)P volgens de repo, of (2.15) in 2.4.1(2)P, met G_d (2.16);
  - de reikwijdte van de boog in 5.4.4(2), en of er een slankheidscriterium is;
  - de richting van de boog ten opzichte van de scheefstand, ook in 3D;
  - of k_c = 1 mag na een tweede-ordeberekening met φ en e.
  - De normtekst staat niet in de repo.
- **Eigen φ van een losse kolom:** m = 1 en een eigen h binnen een groter model; losse kolommen uit m en h; een kolom op een ligger (fig. 5.4 tegenover de metgezel per last); h bij een tussenaansluiting; welke norm φ_eigen geeft.
- **φ·V op liggers:** de 2D-scheefstand zet H = φ·V op elke verticale last (`engine.ts:1044-1048`). Liggers krijgen zo normaalkracht en interactietoetsen, waar de handberekening en een externe referentie-berekening N = 0 geven (`test-dakconstructie-referentie.mjs:33-36`). Omdat de scheefstand straks altijd in de UGT-toets zit, weegt dit zwaarder. Lokale lasten op schuine staven krijgen de metgezel ná de projectie (`engine.ts:1585-1626`).
- **Beton:**
  - P-Δ met de ongescheurde Ecm is geen tweede orde volgens §5.8;
  - om y ontbreekt e_i in toets en analyse;
  - of φ_ef (5.19) en r_m met de scheefstandmetgezel in M0Eqp normtechnisch gewenst zijn, is niet vastgesteld;
  - in 3D telt de imperfectie om z dubbel.
- **q_equiv en de kipvelden uit een tweede-ordemomentenlijn** (NB.NB.4.3): de P·δ-bolling telt mee als verdeelde last. De grootte is niet gemeten.
- **5.3.2(4)B** wordt niet gebruikt. Het formulenummer "(5.7)" in `scheefstandNorm.ts:112` is niet gecontroleerd.
- **Hout:** E_d van C24 (8462) is groter dan E_0,05 (7400). k_c = 1 is daarom mogelijk onveilig.

**[BESTAAND] onveilig of inconsistent, nu al**
- 3D toetst standaard in eerste orde met L voor elke staaf zonder vrij eind, zonder α_cr. Verplaatsbare kolommen, zoals de spanten van een hal, worden mogelijk onveilig getoetst.
- Een kolom met alleen een uitkragende ligger op de kop krijgt "Gaffel", en dus L (`doorgaandeLijn.ts:975-992`).
- Vakwerkstijlen, hangers en onbelaste stijlen tellen mee in m. φ_model kan daardoor tot circa 29 % te laag uitvallen (`scheefstandNorm.ts:343-412`). Een hoge losse kolom verhoogt bovendien h (`scheefstandNorm.ts:317-328`).
- De bediening noemt de 3D-analyse "tweedeOrdeGeometrisch", ook als er lineair gerekend is (`rapportExport.ts:90, 366`).

**[TECH] implementatie**
- **Rekentijd.** 2D rekent synchroon op de UI-thread, met dichte n×n-matrices per iteratie (`NonlinearSolver.ts:379-386, 924-929`) en na elke som een dichte pivottelling (`NonlinearSolver.ts:1045-1074`).
  - Met de standaardset komen er 24 P-Δ-sommen bij (2 × 12 UGT).
  - Het aantal iteraties is ongeveer ln(1e-6)/ln(α_cr): circa 6 bij α_cr = 10, circa 34 bij 1,5.
  - In 3D komen er 4·N_UGT runs bij.
  - In MCP lopen de verzoeken één voor één (`staalhal_tools.rs:321-334`), met tijdslimieten van 60, 120 en 300 s.
- **Cachebotsing** bij een gedeelde SecondOrderState (`engine.ts:2475-2480`).
- **Identiteitscontroles:** het betonvenster ziet de krachten als verouderd en de export weigert (`rapportVoorwaarden.ts:104-110`).
- **Combinatie-id's +1 000 000** ontbreken in `combinatiesVoorRapport` als de schakelaar uit staat. Gevolg: "comb. 1000003" in het rapport, een verdwijnende markering en een andere `governing_combination_id` voor MCP-clients.
- **Houteindstijfheid** valt stil uit als zij het analysetype van de toets leest.
- **Drie wegen:** een halve wijziging, of een oude sidecarbundel of oude binaries, levert een andere UC in de app dan via MCP, of tests die ten onrechte slagen.
- **Samenvoegconflicten met #194** in `App.tsx`, `openFem3dSolver.ts` en `openFem3dSteelCheck.ts`.
- **2D tegenover 3D:** de 2D-P-Δ mist P·δ binnen een element (`engine.ts:2527-2535`, tot ~2 %); 3D verdeelt gedrukte staven in vieren. Pariteitstests tussen 2D en 3D kunnen daardoor hun gelijkheid verliezen.
- **Krappe toleranties** (1e-5, 1e-4, 2e-4) halen P-Δ niet. Een tolerantie verruimen is ook een besluit dat verantwoord moet worden.
- **Profielvarianten** (`variantStore`) nemen aan dat de krachten niet veranderen. Onder P-Δ weegt die aanname zwaarder.
- **φ per plaats** kan bij gesplitste staven stil vervallen als de koppeling van UI-id naar mesh niet klopt.
- **i18n:** een vervallen sleutel in één taal laten staan, of Nederlandse kernwoorden in de/fr, laat `test-i18n-talen` falen. Vaste tekst in `OpenFem3DExplorer.tsx:423-428` valt buiten `test-i18n-vaste-tekst`.

---

## 6. Wat de verkenners niet konden vaststellen

- **Rekentijd en geheugen** van de extra P-Δ-runs, in 2D, in 3D (hal, large-frame, campus-frame) en via MCP. `scripts/meet-oplossers.mjs` meet geen P-Δ per combinatie.
- **Exacte nieuwe referentiewaarden:** de kip-UC van de ligger met paal, `my_ed` bij P-Δ, 0,278 met scheefstand, τ in de platen, of `governing_combination_id` 2 of 1 000 002 wordt, en of B15 en K5 binnen 2e-3 blijven.
- **Tegenstrijdigheden tussen de verkenners:**
  - Het 3D-houtgeval met L: (6.24) van 0,7754 naar "~0,2295 plus buigtermen" volgens de houtverkenner, of naar 0,1721 volgens de testkop (`test-vrij-eind-tweede-orde.mjs:22-29`). Dit moet met de hand worden nagerekend.
  - De bron van `first_order_envelope`: de toets-perCase (2D) of de resultaten (beton-verkenner).
  - Welke φ de toets gebruikt, en of beton altijd of alleen bij `tweedeOrdeFysisch` fysisch rekent.
  - Of de 3D-MCP-tools in 2026.43 meegaan.
  - h van een losse kolom met een tussenaansluiting.
  - De C_m-ondergrens.
- **De Rust-kernen bij tweede-orde-invoer:** of de §5.8-kolomtoets dubbel telt of onderschat, en de richting van de fout in 3D. De betonkern is maar deels gelezen.
- **De normtekst** van EN 1993 (noot bij tabel B.3, 5.2.2(7)/(8), 5.3.2(4)B), EN 1995 (2.2.2, 2.4.1, 5.4.4, fig. 5.4) en de NB:2013 bij 2.4.1, 5.4.4 en 6.3.2. Niet in de repo.
- **De #194-diff** in `ofs-wt-65s`: of die compileert, klopt en nog samen te voegen is. Alleen de bestandslijst en een deel van de diff zijn gelezen.
- **2D P-Δ met platen** (`mixed_beam_plate`): of elk plaatmodel uit de tests convergeert. α_cr wordt bij platen niet bepaald (`alphaCr.ts:80`).
- **De 3D-kern:** of hij lokale staaflasten correct over de KNIKDELEN verdeelt (`contractLoads`, `openFem3dSolver.ts:602-639`), en of trek-alleen en bedding met P-Δ en scheefstand op alle halvarianten convergeren.
- **Toetsbrug en Vite:** of de weg via `/api/toetsing` een solve- en toetsketen heeft die mee moet. Volgens `drie_wegen_kruistabel.rs:307-315` bestaan solve en check alleen als MCP-tool.
- **Bronnen:** hoe `staalhalProject` en `ifcAnalyseProject` de scheefstandvelden zetten, en wat `normenInModel` per materiaal kiest.
- **Rapporttests** (`betonhoofdstuk_pdf.rs`, `test-rapportpdf-invoer`, `test-rapport-gereedheid`), UI- en browsertests, en de regelnummers in de en-, de- en fr-taalbestanden zijn alleen steekproefsgewijs bekeken.
- **Verbindingen:** de stijfheid van verbindingen (K_u, K_ser) in een tweede-ordeberekening van hout, en E_cd voor beton in dezelfde toetsberekening. Niet onderzocht.
- **Hoe vaak losse kolommen in 3D uit meerdere staven bestaan**, en of de interne onderverdeling (commit 33ee0332) de herkenning van een vrij eind beïnvloedt.