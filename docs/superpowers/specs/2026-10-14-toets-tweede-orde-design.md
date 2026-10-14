# Toetskrachten altijd uit tweede orde met scheefstand (#199, deel 1)

Ontwerp, 14 oktober 2026. Doelversie 2026.43.

## Doel

De UGT-normtoetsing rekent altijd met krachten uit een tweede-ordeberekening (P-Δ) **met scheefstand** (NEN-EN 1993-1-1 5.3.2), ongeacht de analyse-instelling van het model. Elke staaf wordt dan getoetst volgens methode b van 5.2.2(7): de systeemlengte als kniklengte, zonder zijdelingse kniklengtes en zonder de eis α_cr ≥ 10 voor eerste orde.

De instelling "Analyse" en de schakelaar "Scheefstand" bepalen voortaan alleen de **resultaten**: momentenlijnen, zakkingen en reacties. Een handberekening blijft zo controleerbaar op de eerste-ordewaarden. Het rapport, de toetstabellen en MCP zeggen bij elke toets dat de toetskrachten tweede orde met scheefstand zijn.

Deel 1 geldt voor de 2D-app, de 3D-app en MCP (`check_fem_model`, de staalhal en de IFC-import): één regel, langs alle drie de wegen.

## Besluiten

| Nr | Besluit | Bron |
|---|---|---|
| B1 | De UGT-toets rekent altijd zelf P-Δ met scheefstand; 1e orde alleen voor de resultaten | gebruiker, 14 okt |
| B2 | De scheefstand doet in de UGT-toets altijd mee, ook als de schakelaar uit staat | gebruiker, 14 okt |
| B3 | Deel 1 omvat 2D, 3D en MCP samen; #194 (m per rij en richting) blijft een apart issue | gebruiker, 14 okt |
| B4 | De instellingen Analyse en Scheefstand bepalen alleen de resultaten. De φ-velden zijn altijd zichtbaar. Bij elke toetskracht staat "2e orde + scheefstand". "Toon maatgevend op tekenvlak" werkt alleen als de resultaten gelijk zijn aan de toetsset, anders volgt een melding. Diagrammen van de toetskrachten komen in fase 6 | gebruiker, 14 okt |
| B5 | De toets gebruikt de φ van de projectinstelling (bron, noemer, h, m; standaard vast 1/200). Met hout in het model geldt minstens de φ van EN 1995 (5.1). Een ingetikte noemer onder de normwaarde geeft een waarschuwing. φ en bron staan in het rapport en in de MCP-uitvoer | gebruiker, 14 okt |
| B6 | BGT-toetsen (doorbuiging, h/300, scheurwijdte) komen uit de resultaatberekening | gebruiker, 14 okt |
| B7 | Divergeert de P-Δ van de toets in een UGT-combinatie, dan blijven de resultaten staan en wordt de toets geweigerd, met de reden per combinatie. Nooit terugvallen op eerste orde | aanbeveling, overgenomen na "go" |
| B8 | 3D-modellen met platen, waar geen P-Δ bestaat: de toets wordt geweigerd met een reden. K_G voor schaalelementen wordt een vervolgissue | aanbeveling, overgenomen |
| B9 | De MCP-tools voor de staalhal en de IFC-import volgen dezelfde regel, met dezelfde functie als de app | aanbeveling, overgenomen |
| B10 | Hout rekent in deel 1 met E_mean mee in de toets-P-Δ en houdt 2·L bij een vrij eind, met een expliciete melding dat dit niet de volledige EN 1995-route is. De UGT-eindtoestandvarianten (E_mean,fin) vervallen in de toets, met een melding; de BGT-eindtoestand blijft | aanbeveling, overgenomen |
| B11 | Beton rekent fysisch niet-lineair alleen bij het analysetype `tweedeOrdeFysisch` (alleen in de 2D-app), anders P-Δ met de elastische stijfheid. `first_order_envelope` gaat altijd mee, in 2D en 3D. De poort λ/λ_lim blijft zoals nu | aanbeveling, overgenomen |
| B12 | De eigen φ per losse kolom komt in fase 3. Tot dan blijft de φ-eis van 2026.42: L alleen als φ_toets ≥ de eigen φ van de kolom | aanbeveling, overgenomen |
| B13 | C_m ≥ 0,9 bij een vrij eind blijft. Een opgegeven L_cr,y > L blijft staan, met een kanttekening dat de sway dan dubbel telt en dat 5.2.2(7)b L toestaat | aanbeveling, overgenomen |
| B14 | De α_cr-meldingen worden informatief: geen toast, geen foutvak en geen `FOUT:` meer in de MCP. De FOUT "eerste orde niet toegestaan bij α_cr < 10" vervalt, want de toets rekent nooit eerste orde | aanbeveling, overgenomen |

## Omvang

**Deel 1 (deze spec):** fase 0 (voorwerk) en de bouwstenen A, B en C, plus het minimale deel van F, G, H en I. Zie hieronder.

**Buiten deel 1, als vervolgissues met een eigen spec:**
- fase 3: eigen scheefstand per losse kolom (vorm, herkenning, m en h van de model-φ), daarna vervalt de φ-eis;
- fase 4: hout volgens EN 1995 (E_d en G_d per houtstaaf in de toetsrekening, boogimperfectie e = 0,0025·l, φ volgens (5.1), daarna L);
- fase 5: beton volgens §5.8 (kernveld `tweede_orde_in_krachten`, de poort, e_i om y, fysisch via MCP);
- fase 6: toetskrachten als diagram op het tekenvlak;
- K_G voor platen in de 3D-kern;
- standaard wandverbanden van de halwizard: de standaard-staalhal is bij P-Δ met scheefstand instabiel doordat de wandverbanden CHS 88,9×4 zelf knikken (α_cr = 0,688). In deel 1 weigert de toets die combinaties met een duidelijke reden.

## Hoe het nu werkt

In elk pad krijgt de toets precies de krachten van de resultaatberekening. Analysetype en scheefstand komen uit de modelinstelling. Een nieuw model wordt standaard eerste orde, zonder scheefstand, getoetst (`useFemStore.ts:2200, 2210-2211`).

- **2D-app:** `rekenDoor` → `computeAndStoreSolverOutputs` → `combineResults` → α_cr → `handleRunMemberChecks`, op dezelfde `combinationResults` als het scherm (`App.tsx:2168-2245, 2513-2606`).
- **3D-app:** `'linear'` bij eerste orde, anders `'p-delta'` (`App.tsx:2803-2806`); scheefstand alleen als de schakelaar aan staat. Een model met platen rekent altijd lineair (`openFem3dSolver.ts:1007-1010`).
- **MCP:** `check_fem_model` volgt het projectbestand of `nonlinear` (`sidecar.ts:973-988`). De staalhal en de IFC-import rekenen lineair, zonder scheefstand (`staalhalSidecar.ts:77`, `ifcImportSidecar.ts:97`).

De volledige inventaris met regelnummers staat in de ontwerpkaart van de verkenning (in de bijlage van het plan).

## Ontwerp

### Fase 0: voorwerk

1. Bestaande fouten rechtzetten:
   - het invalidatie-effect wist `stabiliteit` niet (`useFemStore.ts:3128-3138`);
   - het API-pad gebruikt de oude `fem.stabiliteit` uit de closure (`App.tsx:2542, 2585`);
   - de rapportexport noemt 3D altijd `'tweedeOrdeGeometrisch'` (`rapportExport.ts:90, 366`);
   - de tekst `openFem3d.normBasis` ("kniklengtes vallen terug op L") klopt niet.
2. Tests die met een regex de broncode lezen, worden gedragstests: `test-kolom-eerste-orde.mjs:212-219`, `test-open-fem3d-scheefstand.mjs:72-81, 131-139`, `test-rekengang-generatie.mjs:8-21`, `test-maatgevend`, `test-rapport-gereedheid` en `test-verouderd`. Anders breken ze in fase 1 zonder reden.

### A. Toetsrekengang 2D

Een nieuwe, zuivere module `design-mockup/src/lib/toetsKrachten.ts`. De app en de sidecar roepen haar allebei aan; ze wordt geëxporteerd in `design-mockup/src/mcp/kernel-exports.ts`.

```ts
interface ToetsAnalyse {
  soort: "tweedeOrdeGeometrisch" | "tweedeOrdeFysisch";
  phi: number;              // rad, de φ van de projectinstelling (B5)
  noemer: number;           // 1/φ, om te tonen
  bron: string;             // "vast" of een norm
  scheefstandModelAan: boolean; // de schakelaar van de resultaten
  hergebruikt: boolean;     // true = de resultaatrekengang was al P-Δ met deze φ
}
interface ToetsKrachten2D {
  analyse: ToetsAnalyse;
  perCase: Map<...>;                    // met SECOND_ORDER_KEY
  ugtCombinaties: LoadCombination[];    // ontvouwd in ±x, zonder eindtoestandvarianten
  combinationResults: Map<number, SolverResult>; // alleen UGT
  alphaCr: AlphaCrUitkomst[];           // één keer per basiscombinatie
  weigering: null | { reden: string; perCombinatie: { id: number; naam: string; reden: string }[] };
  meldingen: string[];                  // o.a. hout met E_mean, vervallen eindtoestandvarianten
}
function bepaalToetsKrachten2D(invoer: {
  basis: MultiInput;                    // de invoer van de resultaatrekengang
  combinaties: LoadCombination[];       // de actieve combinaties
  scheefstand: { phi: number; richting: 1 | -1; bron: string; modelAan: boolean };
  resultaten?: { analysetype: Analysetype; phi?: number; perCase; combinationResults }; // voor hergebruik
}): ToetsKrachten2D
```

- **Toets-φ (B5):**
  - φ_toets is de φ van de projectinstelling, `scheefstandUitkomst` (bron, noemer, h, m), ook als de schakelaar uit staat.
  - Zit er hout in het model, dan geldt φ_toets = max(φ_project, φ volgens EN 1995 (5.1) met de modelhoogte), met een melding als dat de φ verhoogt.
  - Is de bron "vast" en ligt 1/noemer onder de normafleiding van het model, dan komt er een waarschuwing in de toets.
  - Dezelfde regel geldt in 3D (`openFem3dScheefstandUitkomst`) en in de sidecar (`leesScheefstand`).
- **Toetscombinaties:** `metScheefstandRichtingen(actieveCombinaties.filter(c => c.type === "uls" && c.eindtoestand === undefined), true, richting)`. De UGT-eindtoestandvarianten vervallen, met een melding (B10).
- **Rekenen:** een lege perCase-Map met `SECOND_ORDER_KEY` (naast `solveAllCasesNonlinear`, `engine.ts:2700-2705`); `combineResults` → `solveCombinationSecondOrder` (`engine.ts:2536-2613`).
- **Cache:** een SecondOrderState wordt nooit gedeeld tussen invoer met een verschillende scheefstand. De cachesleutel `id|factoren` kent geen φ (`engine.ts:2475-2480`).
- **Hergebruik:** alleen als de resultaatrekengang tweede orde is, met de schakelaar aan en dezelfde φ, en er geen hout-eindtoestandvarianten in de UGT zitten. Dan zijn de toetsresultaten de UGT-resultaten van de resultaatrekengang.
- **Divergentie (B7):** elke combinatie wordt apart gerekend. Divergeert er één, dan krijgt de toets een `weigering` met alle betrokken combinaties, en heeft de toets geen krachten. De resultaten blijven staan.
- **α_cr** één keer per basiscombinatie, op de toetsinvoer.
- **Fysisch (B11):** bij `tweedeOrdeFysisch` draait de bestaande betonronde (`App.tsx:2265-2504`) op de toets-perCase in plaats van de resultaat-perCase. Mislukt die ronde, dan wordt alleen de toets geweigerd.

### A2. De 2D-app

- `handleRunMemberChecks` (`App.tsx:2513-2606`) bouwt de toetsinvoer uit twee sets:
  - de UGT uit `bepaalToetsKrachten2D`;
  - de BGT uit de resultaten (B6), met de BGT-eindtoestand van hout.

  Eén samengevoegde Map; de id's botsen niet. `stabiliteit` wordt de toetsanalyse (`analysetype` = de toetssoort, `alphaCr` uit de toets, `scheefstandAan: true`, `scheefstandPhi` = toets-φ).
- Het fallbackpad (bedieningscommando `toetsen`, `App.tsx:2536-2545`) loopt via dezelfde functie.
- `eersteOrdeResultatenVoorKolomtoets` gebruikt de eerste orde van de **toets**-perCase. `first_order_envelope` gaat altijd mee (B11). Alleen die set bevat de varianten met id + 1 000 000.
- Houteindstijfheid (`houtEindstijfheid.ts:399-418`): de UGT-eindtoestand vervalt in de toets (B10), de BGT-eindtoestand komt uit de resultaten.
- De identiteitscontroles worden een generatievergelijking: `BetonStaafVenster.tsx:246-247`, `rapportExport.ts:106-113`, `rapportVoorwaarden.ts:104-110`, `App.tsx:2662, 2674`.
- `handleToonMaatgevend` (`App.tsx:2049-2071`): markeert alleen als de maatgevende combinatie in de resultaten bestaat met dezelfde krachten (resultaten = P-Δ met scheefstand en dezelfde φ). Anders volgt een melding (B4).
- De combinatienamen in het rapport komen uit `lastRunData.combinations` (`CheckTableSection.tsx:80-90, 213-214`), zodat er nooit "comb. 1000003" staat.
- Een fout in de toets wist de resultaten niet meer (nu één try/catch, `App.tsx:2233`).

### B. Toetsrekengang 3D

- De resultaatanalyse volgt de instelling. De **toetsanalyse is altijd `'p-delta'`**, met de toets-φ = `openFem3dScheefstandUitkomst.phi`, los van de schakelaar (`App.tsx:993-1007, 2806, 2817`).
- Toetslijst: alleen de UGT, met `metScheefstandRichtingen3D(…, true)` en `solveOpenFem3DCombination(…, 'p-delta', scheefstandVanCombinatie(c, φ_toets))`. Is de resultaatrekengang al P-Δ met scheefstand en dezelfde φ, dan worden die resultaten hergebruikt.
- `combinationSet` voor de toets (`App.tsx:2877-2887`) bevat:
  - de UGT-varianten met P-Δ-resultaten;
  - de BGT uit de resultaten;
  - `scheefstandPhi` altijd.
- Een mislukte toetsrun blokkeert alleen de toets, met de reden erbij (B7). De resultaten blijven staan.
- `bucklingModes` = 1 voor de toetsruns.
- **Platen (B8):** een model met platen krijgt geen toets, maar een weigering met de reden "geen tweede-ordeberekening met platen".
- De betontoets in 3D krijgt `first_order_envelope` uit de eerste orde van de toetsruns (B11). Om z komen M₀Ed,z en r_m dan uit de eerste orde.
- Deze logica komt in een zuivere functie `bepaalToetsKrachten3D` (naast `toetsKrachten.ts`, of in `components/openFem3d/openFem3dToetsKrachten.ts`). De app en de 3D-MCP-paden roepen haar allebei aan.

### C. MCP en sidecar

- **`check_fem_model`** (`sidecar.ts`):
  - `opCheck` gebruikt `bepaalToetsKrachten2D` voor de UGT en de resultaatrekengang voor de BGT;
  - `opSolve` blijft de resultaatrekengang;
  - het analysetype van de toets staat vast, ongeacht het bestand of `payload.nonlinear`;
  - bij `tweedeOrdeFysisch` in het bestand wordt de toets geweigerd met een reden (de fysische ronde draait alleen in de app), zoals nu.
- **`leesScheefstand`:** φ ook afleiden als de schakelaar uit staat (`sidecar.ts:331-395`, vroege terugkeer op `367-369`).
- **Uitvoer van `check_fem_model`:**
  - `stability.analysis_type` = de toetsanalyse;
  - nieuw: `stability.model_analysis_type` en `stability.scheefstand {phi, noemer, bron, model_scheefstand_aan, afgedwongen}`;
  - een vaste regel in `warnings`;
  - `analyse_toelichting` en `scheefstand_toelichting`.
- **`nonlinear` vervalt** in de argumenten van `check_fem_model` (`fem_tools.rs`, `deny_unknown_fields`). In `solve_fem_model` blijft het: daar gaat het om de resultaten.
- **`steel_check_inputs`** vervalt in de uitvoer van `solve_fem_model`. Die invoer rustte op de resultaatkrachten; `check_fem_model` is de weg. De golden-test verliest velden, maar er verandert geen waarde.
- **De staalhal en de IFC-import (B9)** gebruiken `bepaalToetsKrachten3D` voor de toets. De resultaten mogen lineair blijven. De uitvoer meldt de toetsanalyse.
- **Rust-bewaking:** meldt de bundel de afgedwongen toetsanalyse niet (een oude bundel), dan `TOETSING_ONMOGELIJK` in plaats van stil eerste orde.
- Toolbeschrijvingen, de README van de MCP-server en de koptekst van `sidecar.ts` worden bijgewerkt. De strikte schema's in `tests/schema_strikt.rs` worden bijgewerkt.

### F (minimaal), G (minimaal) en de kernen

- **Rust-kernen:** geen rekenwijziging, alleen teksten. Het staalmechanisme (geen opgave = 2·L bij een vrij eind; de φ-eis; C_m ≥ 0,9) blijft (B12, B13).
- **`kniklengte.rs`:** de teksten noemen de toets voortaan altijd tweede orde met scheefstand.
- **`alphaCrStaafNotitie`** vervalt voor de toets: de toets rekent nooit eerste orde (B14). De functie en haar aanroepen (`steelCheckBuilder.ts`, `timberCheckBuilder.ts`) gaan weg.
- **`zijdelingseKnikInVlakModel` en `openFem3DZijdelingseKnik`:** de voorwaarden op analysetype en scheefstand zijn in de toets altijd waar. Ze blijven als bewaking staan. De voorwaarde "staand" en de φ-eis blijven tot fase 3.
- **Sway-regel C_my bij een opgegeven L_cr,y > L** (`steel-check/orchestrator.rs`): blijft, met een kanttekening dat de krachten al tweede orde zijn, dat 5.2.2(7)b de systeemlengte toestaat en dat de opgave de sway dus dubbel telt (B13).
- **Hout (B10):**
  - de houtbouwers zetten `zijdelingse_knik_in_analyse` niet;
  - een vaste melding bij elke houtstaaf in de toets: "tweede orde met E_mean; de volledige EN 1995-route (E_d, boogimperfectie) volgt; daarom 2·L bij een vrij eind";
  - de EC3-kanttekening `alphaCrStaafNotitie` vervalt bij hout.
- **Beton (B11):** `first_order_envelope` altijd mee (zie A2 en B).

### H (minimaal). Rapport, UI en i18n

- `analyseToelichting` (`alphaCr.ts`) krijgt twee regels:
  - de resultaten: de gekozen analyse, met of zonder scheefstand;
  - de toetskrachten: tweede orde P-Δ met scheefstand φ = 1/…, en de systeemlengte volgens 5.2.2(7)b.

  De regel "eerste orde is toegestaan…" gaat alleen over de resultaten.
- `stabiliteitsMeldingen`: de FOUT "eerste orde niet toegestaan", de waarschuwing "zet de scheefstand aan" en "α_cr niet bepaald" vervallen als fout en worden informatief (B14). Er komt een nieuwe fout bij een geweigerde toets door divergentie (B7).
- De scheefstandtekst is nooit meer leeg (`App.tsx:1008-1012, 1020-1036`), want de toets gebruikt φ altijd.
- **PDF** (`report/lib.rs`): de inleiding, de scheefstandzin en de krachtregel zeggen dat de toetskrachten tweede orde met scheefstand zijn.
- **Instellingen** (`LoadCaseTabBar.tsx`): de φ-velden zijn altijd zichtbaar. Bij Analyse en Scheefstand staat "voor de resultaten; de toets rekent altijd 2e orde met scheefstand".
- **Label "2e orde + scheefstand"** bij de toetskrachten: `CheckBlock.tsx`, `CheckDetailSection.tsx`, `CheckPanel.tsx`, `checkReportUtils.ts`.
- **3D:** `OpenFem3DReport.tsx` (analyse, α_cr-noot), `OpenFem3DExplorer.tsx:423-428` (nu vaste Nederlandse tekst, wordt i18n), `openFem3d.normBasis`.
- **i18n:** nieuwe en gewijzigde sleutels in nl, en, de en fr. `app.stability.firstOrderNotAllowed` verdwijnt in alle vier tegelijk (`test-i18n-talen.mjs`).

### Foutafhandeling

| Situatie | Resultaten | Toets |
|---|---|---|
| P-Δ van de toets divergeert in een UGT-combinatie | blijven | geweigerd, met per combinatie de reden (α_cr indien bepaald) |
| 3D-model met platen | blijven | geweigerd: "geen tweede-ordeberekening met platen" |
| `tweedeOrdeFysisch` via MCP | n.v.t. | geweigerd zoals nu (de fysische ronde draait alleen in de app) |
| Oude sidecarbundel zonder toetsanalyse | n.v.t. | `TOETSING_ONMOGELIJK` |
| Fysische betonronde mislukt (app) | blijven | geweigerd, met de reden |

### Prestatie

De extra P-Δ-sommen worden gemeten en gerapporteerd: 2D-standaardset, 3D-hal en `check_fem_model`. Wordt de resultaatrekengang hergebruikt (tweede orde met scheefstand en dezelfde φ), dan kost de toets niets extra.

## Tests en referentiegetallen

- **Nieuwe tests:**
  - `bepaalToetsKrachten2D`: P-Δ en scheefstand in beide richtingen; het uitsluiten van eindtoestandvarianten; hergebruik; divergentie als weigering;
  - een eerste-ordemodel toetst met tweede-ordekrachten. Gebruik een vrijstaande kolom met de hand: de toets-N blijft gelijk, en M aan de voet = φ·V·h vergroot met 1/(1 − N/N_cr);
  - de drie wegen geven dezelfde UC (app-bouwers, toetsbrug en `check_fem_model`);
  - 3D: een hal of kolom in eerste orde toetst met P-Δ; een model met platen wordt geweigerd;
  - de staalhal en de IFC-import melden de toetsanalyse;
  - de schema's: `nonlinear` geweigerd in `check_fem_model`, de nieuwe uitvoervelden aanwezig.
- **Referentiegetallen:** de verkenning noemt 70–100 plekken, waarvan ongeveer 40 getallen. Elk veranderd getal krijgt in de test een regel met de verantwoording: welke handberekening, wat het verschil veroorzaakt (P-Δ, scheefstand, vervallen eindtoestand) en de grootte. Een tolerantie verruimen is ook een besluit dat in de test verantwoord wordt. **Nooit blind bijwerken.**
- Kerntests met opgegeven krachten veranderen niet.
- **Volgorde na elke wijziging aan de kern of de engine:** `npm run build:sidecar`; `cargo build --release -p toetsbrug -p openaec-mcp-server -p open-fem-3d`; `npx tsc --noEmit`; `node scripts/run-tests.mjs` met en zonder `--bundel`; `cargo test --workspace --exclude open-fem-studio`.

## Normgrond

- NEN-EN 1993-1-1 5.2.2(3)b en (7)b: tweede-ordeberekening met globale imperfecties, en daarna de staaftoets met de systeemlengte.
- 5.3.2: de scheefstand φ = φ₀·α_h·α_m, als equivalente horizontale krachten φ·N_Ed.
- 5.2.1(3): de grens α_cr ≥ 10 geldt voor eerste orde. De toets rekent nooit eerste orde, dus voor de toets vervalt die grens.
- NEN-EN 1995-1-1 2.2.2(1)P, 2.4.1(2)P en 5.4.4: in deel 1 niet volledig gevolgd (B10). Dat is expliciet gemeld; fase 4.
- NEN-EN 1992-1-1 §5.8: in deel 1 ongewijzigd behalve `first_order_envelope` (B11); fase 5.
