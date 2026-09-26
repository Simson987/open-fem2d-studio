# Onderzoek 3D-rekenkernel

Datum: 26 september 2026

Status: keuze goedgekeurd op 26 september 2026

## Doel en randvoorwaarden

Open FEM Studio heeft voor de eerste 3D-versie een rekenkernel nodig voor ruimtelijke raamwerken met zes vrijheidsgraden per knoop en directe tweede-ordeanalyse. De kernel moet in Rust bruikbaar zijn, geschikt zijn voor een commerciële SaaS-dienst en later uitgebreid kunnen worden met plaat-, schaal- en volume-elementen.

De instellingen tonen een solverkeuze met **Automatisch** als standaard. Een interne router controleert of de gekozen engine de analyse- en elementcapaciteiten bezit en kiest in de automatische stand zelf een geschikte engine. Hierdoor kan later meer dan één gespecialiseerde engine bestaan zonder dat het gebruikersmodel of de bedieningsstroom verandert.

## Samenvatting

Er is geen kandidaat die tegelijk volwassen, permissief gelicentieerd, volledig in Rust, direct tweede orde en breed genoeg voor raamwerk, plaat en volume is.

De twee meest bruikbare routes zijn:

1. **Dedaliano uit Stabileo gebruiken of commercieel licentiëren.** Dit is technisch de beste aansluiting: Rust, WebAssembly, 2D/3D, iteratieve P-Delta, sparse assembly en een grote openbare verificatiesuite. De repository gebruikt AGPL-3.0. Een commerciële SaaS is mogelijk, maar bij netwerkgebruik gelden broncodeverplichtingen. Voor een gesloten product is een aparte commerciële licentie nodig.
2. **Een afgebakende PyNite-raamwerkkernel naar Rust porteren.** PyNite is MIT-gelicentieerd, actief onderhouden en ondersteunt elastische 3D-raamwerken en P-Delta. Dit kost meer ontwikkel- en verificatiewerk, maar geeft de schoonste basis voor een eigen commerciële kernel. De port moet de formules en tests overnemen met bronvermelding, terwijl de softwarearchitectuur opnieuw in Rust wordt ontworpen.

Kratos is de sterkste brede referentie voor toekomstige plaat- en volumeanalyse, maar de kern is C++ en de integratie is zwaar. Het is een goed toekomstig engine-adapter of verificatie-orakel, geen logische eerste Rust-kernel.

## Vergelijking

| Kandidaat | Licentie en SaaS | 3D raamwerk / tweede orde | Plaat en volume | Rust-aansluiting | Beoordeling |
|---|---|---|---|---|---|
| **Stabileo / Dedaliano** | AGPL-3.0; bruikbaar voor open SaaS, aparte licentie nodig voor gesloten gebruik | Ja; 2D/3D P-Delta en corotationele onderdelen | Plaat/schaal aanwezig; algemene solids niet de hoofdsterkte | Native Rust en WASM | Technisch beste directe basis; licentiebesluit vereist |
| **PyNite** | MIT; gunstig voor commerciële SaaS | Ja; elastisch 3D en P-Delta | Platen aanwezig, maar geen P-Delta voor platen | Python; gerichte Rust-port nodig | Beste permissieve bronbasis voor de eerste framekernel |
| **Kratos Multiphysics** | BSD-4; commercieel toegestaan met advertentievermelding | Ja; onder meer 3D corotationele beams | Sterk: shells en meerdere solidformuleringen | C++ met Python-interface | Beste brede engine, maar groot en geen Rust-kern |
| **Frame3DD** | GPL-3.0; ongunstig voor een gedistribueerde gesloten desktopapp | Ja; geometrische stijfheid en quasi Newton-Raphson | Nee | Compacte ANSI-C-bron | Waardevol verificatie-orakel; geen productbasis |
| **OpenSees** | Commerciële opname vereist toestemming/licentie van UC | Zeer breed en volwassen | Breed | C++/Tcl/Python | Verificatie-orakel; commercieel en technisch geen eenvoudige integratie |
| **ORFAS** | Apache-2.0 | Beam2 is lineair; geen volwassen frame-P-Delta | Tetra, hexa en shells aanwezig | Native Rust | Interessante toekomstige elementbron; expliciet pre-alpha |
| **fe-engine** | MIT | 3D beam en sparse Cholesky; nonlineariteit staat op de roadmap | Nog niet | Native Rust | Te jong en mist de vereiste tweede orde |

## Bevindingen per kandidaat

### Stabileo / Dedaliano

De engine beschrijft een Rust-kernel met lineaire 2D/3D-analyse, iteratieve P-Delta, sparse Cholesky en parallelle elementassemblage. De openbare documentatie rapporteert 5.906 geslaagde tests en aparte benchmarkpoorten voor constraints, shells en sparse 3D-pariteit. Ook gemengde frame- en schaalmodellen worden genoemd. Deze cijfers zijn projecteigen claims; voor opname moeten de relevante tests lokaal reproduceerbaar worden gemaakt.

De AGPL-3.0-licentie is het beslispunt. Een betaalde SaaS onder AGPL is toegestaan, maar gebruikers die via een netwerk met een gewijzigde versie werken krijgen recht op de bijbehorende broncode. Herschrijven naar een andere taal verwijdert deze verplichting niet als de nieuwe code een afgeleid werk is.

Bronnen:

- <https://github.com/lambdaclass/stabileo>
- <https://github.com/lambdaclass/stabileo/blob/main/engine/README.md>
- <https://github.com/lambdaclass/stabileo/blob/main/docs/VERIFICATION.md>

### PyNite

PyNite ondersteunt elastische 3D-staafmodellen, P-Delta, belastingcombinaties, verdeelde belastingen en staafresultaten. De MIT-licentie past bij zowel een gesloten als open commerciële dienst. De documentatie vermeldt dat de AISC C2.1-benchmarks worden gehaald wanneer tussenknopen op de derde punten worden toegevoegd om lokale P-delta te vangen. Het benodigde aantal segmenten is modelafhankelijk. P-Delta geldt niet voor plaatelementen.

De releasehistorie laat correcties zien aan lokale rotaties, axiale stijfheid en P-Delta-resultaten. Daarom is een mechanische regel-voor-regelport onvoldoende. De Rust-port moet een eigen verificatiepoort krijgen en resultaten kruisen met gepubliceerde benchmarks en onafhankelijke engines.

Bronnen:

- <https://github.com/JWock82/Pynite>
- <https://pynite.readthedocs.io/en/latest/PDelta.html>

### Kratos Multiphysics

Kratos is actief ontwikkeld, BSD-4-gelicentieerd en staat commercieel gebruik toe. De Structural Mechanics Application bevat onder meer 3D corotationele beams, trusses, cables, shells, solids, eigensolvers en meer dan honderd Python-validatietests plus C++-tests. De technische breedte past goed bij toekomstige platen en volumes.

De keerzijde is de integratieomvang: een grote C++/CMake-stack met Python-interface en optionele externe numerieke bibliotheken. Een Rust-wrapper maakt de productlaag wel Rust, maar de rekenkernel niet. Een volledige Rust-port is een afzonderlijk meerjarig traject.

Bronnen:

- <https://github.com/KratosMultiphysics/Kratos>
- <https://github.com/KratosMultiphysics/Kratos/blob/master/applications/StructuralMechanicsApplication/README.md>
- <https://github.com/KratosMultiphysics/Kratos/blob/master/kratos/license.txt>

### Overige kandidaten

Frame3DD heeft een compacte en goed beschreven geometrisch-nonlineaire raamwerkkern, maar gebruikt GPL-3.0 en een oudere C-architectuur. OpenSees is technisch zeer volwassen, maar commerciële opname vereist een overeenkomst met de University of California. ORFAS is Apache-2.0 en Rust-native, maar noemt zichzelf pre-alpha en de huidige Beam2 is een lineair Euler-Bernoulli-element. `fe-engine` is MIT en Rust-native, maar nonlineariteit staat nog op de roadmap.

Bronnen:

- <https://hpgavin.github.io/frame3dd/web/Frame3DD-manual.html>
- <https://opensees.berkeley.edu/OpenSees/developer/copyright.php>
- <https://github.com/LLorgeou21/orfas>
- <https://github.com/krank56/fe-engine>

## Voorgestelde architectuur

De uitbreidbaarheid wordt op drie niveaus aangebracht:

1. **Neutraal rekenmodel.** Knooppunten, vrijheidsgraden, materialen, doorsneden, belastingen, combinaties en elementvarianten hebben geen afhankelijkheid op Tauri of een concrete solver.
2. **Analysis-enginecontract.** Elke engine meldt capaciteiten en verwerkt een geversioneerd analyseverzoek tot een uniform resultaat. De interne router kiest een engine; de interface toont geen technische solverkeuze.
3. **Element- en matrixcontracten.** Elementformuleringen leveren bijdragen aan dezelfde globale vrijheidsgraden en sparse matrix. De matrixoplosser is vervangbaar zonder de elementcode te wijzigen.

Voorgestelde crates:

```text
fem-model          neutrale invoer, resultaten, eenheden en versiebeheer
fem-kernel         enginecontract, capaciteiten, validatie en router
fem-frame3d        eerste Rust-engine voor 3D-raamwerken en tweede orde
fem-linalg         dun contract; eerste implementatie met faer

later:
fem-plate          plaat- en schaalformuleringen
fem-solid          volume-elementen
fem-coupled        gezamenlijke assemblage van gemengde elementfamilies
```

De hoofdcontracten krijgen ongeveer deze verantwoordelijkheid:

```rust
trait AnalysisEngine {
    fn capabilities(&self) -> EngineCapabilities;
    fn solve(&self, request: &AnalysisRequest) -> Result<AnalysisResult, SolveError>;
}

trait ElementKernel {
    fn dof_layout(&self) -> DofLayout;
    fn elastic_contribution(&self, state: &ElementState) -> ElementContribution;
    fn geometric_contribution(&self, state: &ElementState) -> ElementContribution;
    fn recover(&self, state: &ElementState) -> ElementResult;
}

trait LinearSystemSolver {
    fn factor_and_solve(&self, system: &SparseSystem) -> Result<Vec<f64>, LinearSolveError>;
}
```

Rust-traits worden alleen binnen de workspace gebruikt. De grens naar Tauri, WebAssembly of een SaaS-service wordt een geversioneerd data-contract. Daarmee blijft de kernel reproduceerbaar en ontstaat geen afhankelijkheid op een instabiele Rust-ABI.

### Routing zonder solverkeuze in de interface

```text
Analyseverzoek
    -> modelvalidatie
    -> gevraagde capaciteiten bepalen
    -> geschikte engine intern selecteren
    -> analyse uitvoeren
    -> uniform resultaat + herkomst + diagnostiek
```

Een gemengd model met bijvoorbeeld kolommen en een plaat mag niet door twee losse engines onafhankelijk worden opgelost. Alle elementbijdragen moeten in één globale stijfheidsmatrix en één evenwichtstoestand terechtkomen. Gescheiden engines zijn alleen geschikt voor modellen die daadwerkelijk los van elkaar staan of voor een expliciete domeindecompositie.

## Eerste engine

Voor een permissief commercieel product is de aanbevolen eerste engine:

- een Rust-native 3D-framekernel;
- PyNite als MIT-gelicentieerde functionele bron en testreferentie;
- `faer` als MIT-gelicentieerde sparse lineaire algebra;
- iteratieve geometrische stijfheid voor directe tweede orde;
- automatische of gecontroleerde onderverdeling van staven voor lokale P-delta;
- zes vrijheidsgraden per knoop;
- uniforme, punt- en knoopbelastingen, momenten, opleggingen, veren en staafeindscharnieren;
- resultaatvelden voor verplaatsingen, reacties en N/Vy/Vz/T/My/Mz langs de staaf.

Als een AGPL-open SaaS acceptabel is, moet eerst een korte technische proef met de Dedaliano-engine worden gedaan. Die route kan veel implementatietijd besparen. Voor gesloten gebruik moet vóór integratie een alternatieve licentie schriftelijk geregeld zijn.

`faer` biedt sparse LLT, LU en QR-oplossers in pure Rust. De kernel begint met een symmetrisch-positief-definiete route waar dat geldig is en moet een expliciete diagnose geven bij singulariteit, verlies van positieve definitie en naderende instabiliteit. Een numerieke bibliotheek lost alleen het matrixstelsel op; de elementformuleringen, belastingen, tweede-orde-iteratie en resultaatterugwinning blijven onderdeel van de FEM-kernel.

Bronnen:

- <https://docs.rs/faer/latest/faer/sparse/linalg/solvers/index.html>
- <https://github.com/sarah-quinones/faer-rs>

## Verificatiepoort

De kernel wordt pas als bruikbaar beschouwd als alle volgende lagen slagen:

1. elementmatrices, transformaties, equivalente knooplasten en resultaatstappen;
2. evenwicht, symmetrie, rigid-body-controles en energie-invarianten;
3. gesloten oplossingen voor ligger, vakwerk en ruimtelijk raamwerk;
4. AISC C2.1-tweede-ordebenchmarks met vastgelegde discretisatieregels;
5. vergelijking met ten minste twee onafhankelijke referenties, bijvoorbeeld Kratos en Frame3DD of OpenSees;
6. convergentieonderzoek bij elementverfijning en toenemende normaalkracht;
7. foutdiagnostiek voor mechanismen, nul-lengte-elementen, ongeldige eigenschappen en niet-convergentie;
8. prestatiemetingen voor kleine interactieve modellen en grotere SaaS-batches.

Elke analyse bewaart engineversie, modelcontractversie, toleranties, iteraties, residu en waarschuwingen in het resultaat. Daardoor kunnen rapporten later aantonen hoe een uitkomst is verkregen.

## Licentiepunt in het huidige project

Het project bevat momenteel een `LICENSE.md` met LGPL-3.0-tekst, terwijl `package.json` en meerdere Cargo-manifesten `CC-BY-SA-4.0` vermelden. Dit moet vóór commerciële distributie worden rechtgetrokken. De solverkeuze lost deze bestaande inconsistentie niet op.

## Goedgekeurd besluit

1. De solverlaag mag openbaar zijn; AGPL is voor deze laag acceptabel.
2. Dedaliano/Stabileo wordt de eerste externe Rust-engine achter een Open FEM-adapter.
3. De instellingen krijgen een solverkeuze met **Automatisch** als standaard.
4. De neutrale model-, engine-, element- en matrixcontracten worden vanaf het begin ingebouwd.
5. PyNite blijft de permissieve terugvalroute; Kratos, Frame3DD en OpenSees dienen als onafhankelijke verificatiebronnen totdat hun integratievorm expliciet anders is besloten.
