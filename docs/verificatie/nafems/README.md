# NAFEMS-benchmarks voor de 3D-kern (issue #217)

Deze map legt vast hoe de 3D-versie van Open FEM Studio rekent op de lineair-elastische
benchmarks uit *The Standard NAFEMS Benchmarks* (NAFEMS, publicatie TNSB, Rev. 3, oktober 1990).
Getest worden de platen/schalen van de 3D-adapter (`src-tauri/crates/open-fem-3d`, het
MITC4-element van de vastgezette externe kern) en het eigen Hex8-volume-element van de native
Rust-route (`src-tauri/crates/native-fem`). Alle tests zijn geautomatiseerd; elke test drukt zijn
convergentietabel af.

| Waar | Commando |
|------|----------|
| Schalen en membraan (LE1, LE2, LE3, LE5, LE6) | `cd src-tauri && cargo test -p open-fem-3d --release --test nafems -- --nocapture --test-threads=1` |
| Volume (LE10, Hex8) | `cd src-tauri && cargo test -p openaec-native-fem --release --test nafems_le10_hex8 -- --nocapture` |
| Drie wegen + getoonde plaatwaarden | `cd src-tauri && cargo build --release -p open-fem-3d -p openaec-mcp-server`, dan `cd design-mockup && node scripts/run-tests.mjs --filter=nafems-3d` |
| De bewust falende LE3-toets | `cargo test -p open-fem-3d --release --test nafems -- --ignored` |

## Bronnen en licentie

* Het NAFEMS-document zelf hebben we niet; de foundation heeft geen exemplaar of licentie
  vastgelegd (open vraag 1 van het issue blijft open). NAFEMS-publicaties zijn auteursrechtelijk
  beschermd. **In de repo staan daarom alleen de probleemgegevens (geometrie, materiaal,
  randvoorwaarden, last), het meetpunt en de doelwaarde, met bronvermelding** — feitelijke
  gegevens, geen overgenomen tekst of figuren. Dat is ook wat de commerciële en open
  verificatiehandboeken doen. Het document zelf, figuren en de NAFEMS-netcoördinaten nemen we
  niet op.
* Omdat het originele document ontbreekt, zijn invoer en doelwaarden overgenomen uit
  onafhankelijke reproducties die TNSB Rev. 3 als bron noemen, en alleen gebruikt als ten minste
  twee daarvan overeenstemmen:
  * ESRD, *Benchmarks Guide — The Standard NAFEMS Benchmarks: Linear Elastic Tests* (2018),
    blz. 4 (LE1), 8 (LE2), 12 (LE3), 15 (LE5), 19 (LE6), 29 (LE10);
  * Dassault Systèmes, *Abaqus Benchmarks Guide* §4.2.1–4.2.10;
  * Altair, *OptiStruct Verification Problems* (LE1, LE3, LE5, LE6, LE10);
  * Dlubal, *Verification Example NAFEMS LE 5* (2021) — de probleemschets met meetpunt A;
  * COMSOL, *Thick Plate Stress Analysis*, en SimScale, *Thick plate under pressure* — de
    coördinaten van D in LE10, (2; 0; 0,6);
  * FieldCraft (github.com/tangency-labs/fieldcraft, `tests/oracle/nafems-le*`) — open
    reproducties met hoekcoördinaten (LE6), meetpunt A van LE5 en convergentiereeksen; alleen ter
    bevestiging en vergelijking gebruikt.
* Waar alleen de figuur van TNSB een gegeven bevat (de NAFEMS-netten, de vervorming van het
  LE2-net) is dat gegeven niet gebruikt; we rekenen eigen netten en zeggen dat per test.

## Selectie

| Benchmark | Element | Status | Waarom |
|-----------|---------|--------|--------|
| LE1 elliptisch membraan | MITC4 (membraandeel, EAS) | **getest** | vlakspanning: plaat met w, θx, θy vast |
| LE2 cilinderschaal, buigpatch | MITC4, vlakke facetten | **getest** | homogene toestand; doel ook analytisch (6m/t²) |
| LE3 halve bol, puntlasten | MITC4, vlakke facetten | **getest — buiten tolerantie** | zie bevinding B1 |
| LE4 | — | niet getest | geen LE4 in de gebruikte reproducties (ESRD slaat hem over); gegevens niet uit twee bronnen te bevestigen |
| LE5 Z-profiel uitkraging | MITC4, drie vlakke platen | **getest** | |
| LE6 scheve plaat | MITC4 (Mindlin) | **getest** | |
| LE7, LE8 rotatiesymmetrisch | — | niet getest | de 3D-versie heeft geen rotatiesymmetrische elementen; als 3D-schaal na te bouwen, maar de doelwaarden komen uit rotatiesymmetrische schaaltheorie met meetpunten aan het oppervlak van een gekromde wand; buiten de opdracht gelaten |
| LE9 | — | niet getest | geen gegevens in de gebruikte bronnen |
| LE10 dikke plaat | Hex8 (native Rust) | **getest** | |
| LE11 temperatuurbelasting volume | — | niet getest | de Hex8-route kent geen temperatuurlast |
| Staven/raamwerken | 3D-staaf | niet uit NAFEMS | TNSB bevat geen raamwerkbenchmark; de staven zijn analytisch geverifieerd in [`../3d-raamwerk/`](../3d-raamwerk/README.md) |
| Knik / tweede orde | 3D-staaf | niet uit NAFEMS | geen NAFEMS-knikbenchmark in de gebruikte bronnen; eigenwaarde-knik en P-Δ staan analytisch in `../3d-raamwerk/` |
| FV-reeks (eigenfrequenties) | — | buiten scope | de 3D-versie heeft geen modale analyse (`open-fem-3d` levert alleen knik-eigenwaarden); eerst bouwen (open vraag 2) |

## Resultaten (28 oktober 2026)

Tolerantie per benchmark vooraf vastgelegd (in de testcode, vóór de eerste uitvoering) en niet
achteraf verruimd. "Afwijking" = OFS/doel − 1.

| Benchmark | Meetpunt (bron) | Doel | OFS | Afwijking | Tolerantie | Net | Element | Vergeleken waarde | Status |
|-----------|-----------------|------|-----|-----------|------------|-----|---------|-------------------|--------|
| LE1 | σyy in D (2; 0), ESRD blz. 4 | 92,7 MPa | 92,713 MPa | +0,01 % | 3 % | 96×48 | MITC4 | knoopwaarde (randknoop: patchfit) n_yy/t | ✅ |
| LE2 | σ_tang. buitenzijde, ESRD blz. 8 | 60 MPa | 60,000 MPa | 0,000 % | 1 % | 1×1 … 8×16 | MITC4 | elementmidden, alle elementen | ✅ |
| LE3 | u_r in A (10; 0; 0), ESRD blz. 12 | 0,185 m | 0,0586 m | −68,3 % | 2 % | 32×32 | MITC4 | knoopverplaatsing | ❌ B1 |
| LE5 | σxx middenvlak in A (2,5; −1; −1), ESRD blz. 15, Dlubal | −108 MPa | −111,0 MPa | +2,8 % | 5 % | 128×32 | MITC4 | knoopwaarde (randknoop) n_xx/t | ✅ |
| LE6 | σ1 onderzijde in E (midden), ESRD blz. 19 | 0,802 MPa | 0,8197 MPa | +2,2 % | 5 % | 64×64 verdicht | MITC4 | knoopwaarde (gemiddelde) | ✅ |
| LE10 | σyy in D (2; 0; 0,6), ESRD blz. 29 | −5,38 MPa | −5,519 MPa | +2,6 % | 5 % | 16×32×32 | Hex8 | Gauss-punten hoekelement, trilineair geëxtrapoleerd naar D | ✅ |

Motivering van de toleranties: LE1 3 % (drie cijfers, randspanning van lineaire elementen);
LE2 1 % (homogene toestand die een vlak element exact kan beschrijven); LE3 2 % (drie cijfers;
onder een puntlast groeit de verplaatsing van een afschuifvervormbare schaal nog logaritmisch);
LE5 5 % (het doel is dunwandig; schaalmodellen met verbonden wanden landen enkele procenten
verder: Abaqus S4 −110,4, OptiStruct Quad4 −112,2, Dlubal −108,9); LE6 5 % (het doel is een
Kirchhoff-waarde; een afschuifvervormbaar element convergeert bij t = 10 mm naar ≈ 0,820, ESRD
blz. 20); LE10 5 % (geconvergeerde volumemodellen liggen zelf 0,6–2,6 % onder het doel, en de
Hex8 is volledig geïntegreerd zonder incompatibele modes).

### Convergentie

LE1 (afgebeeld net tussen de ellipsen op gelijke parameterhoek, θ × r):

| net | σyy knoop D (MPa) | afwijking | σyy midden hoekelement |
|-----|-------------------|-----------|------------------------|
| 6×3 | 55,50 | −40,1 % | 48,38 |
| 12×6 | 79,84 | −13,9 % | 64,03 |
| 24×12 | 90,53 | −2,3 % | 75,75 |
| 48×24 | 92,58 | −0,1 % | 83,30 |
| 96×48 | 92,71 | +0,0 % | 87,70 |

De knoopwaarde in D (kwadratische patchfit door de elementmiddens, zoals de app hem toont)
convergeert veel sneller dan de waarde in het elementmidden, die een halve elementbreedte van de
rand ligt.

LE2: op elk net (1×1, 2×2, 4×4, 8×8, 8×16) in elk element 60,000 MPa (afwijking < 0,001 %).

LE3 (lengte-/breedtegraadnet met vlakke polkap):

| net | u_r A (m) | afwijking |
|-----|-----------|-----------|
| 4×4 | 0,0191 | −89,7 % |
| 8×8 | 0,0249 | −86,6 % |
| 16×16 | 0,0338 | −81,7 % |
| 32×32 | 0,0586 | −68,3 % |
| 64×64 | 0,1083 | −41,5 % |
| 128×128 (eenmalig, niet in de test) | 0,1550 | −16,2 % |

LE5 (lengte × flensindeling; lijf twee keer zo fijn):

| net | σxx A (MPa) | afwijking |
|-----|-------------|-----------|
| 8×2 | −104,45 | −3,3 % |
| 16×4 | −109,59 | +1,5 % |
| 32×8 | −110,40 | +2,2 % |
| 64×16 | −110,80 | +2,6 % |
| 128×32 | −111,01 | +2,8 % |

Convergeert naar ≈ −111, in lijn met andere schaalmodellen (FieldCraft MITC4 −111,3, Abaqus S4
−110,4). Het verschil met −108 is de schaalidealisering van de aansluitingen, niet de
discretisatie.

LE6 (n×n parallellogrammen; verdicht = cosinusverdeling naar de randen):

| net | gelijkmatig (MPa) | afwijking | verdicht (MPa) | afwijking |
|-----|-------------------|-----------|----------------|-----------|
| 4×4 | 0,7000 | −12,7 % | 0,5473 | −31,8 % |
| 8×8 | 0,7465 | −6,9 % | 0,7256 | −9,5 % |
| 16×16 | 0,7751 | −3,4 % | 0,8021 | +0,0 % |
| 32×32 | 0,7952 | −0,8 % | 0,8160 | +1,7 % |
| 64×64 | 0,8088 | +0,8 % | 0,8197 | +2,2 % |

De verdichte reeks convergeert naar ≈ 0,82 MPa, de waarde van een afschuifvervormbare plaat bij
t = 10 mm (ESRD 0,820). Dat de 16×16-waarde precies 0,802 raakt is toeval op weg daarheen.

LE10 (afgebeeld net radiaal × hoek × dikte):

| net | elementen | σyy D geëxtrapoleerd | afwijking | dichtstbijzijnd Gauss-punt |
|-----|-----------|----------------------|-----------|----------------------------|
| 3×6×2 | 36 | −4,611 | −14,3 % | −3,207 |
| 6×12×4 | 288 | −5,434 | +1,0 % | −4,490 |
| 12×24×6 | 1 728 | −5,693 | +5,8 % | −5,011 |
| 16×32×8 | 4 096 | −5,673 | +5,4 % | −5,137 |
| 16×32×16 | 8 192 | −5,564 | +3,4 % | −5,168 |
| 16×32×32 | 16 384 | −5,519 | +2,6 % | −5,178 |

Eenmalig verder verfijnd (niet in de test): 24×48×12 −5,616; 24×48×32 −5,532 (+2,8 %). De
geëxtrapoleerde waarde hangt vooral af van het aantal lagen over de dikte; met 8 lagen of minder
valt hij buiten 5 %. Het Gauss-punt een halve laag onder het oppervlak ligt bij −5,18 … −5,25,
dicht bij de geconvergeerde volumewaarden uit de literatuur (−5,25 … −5,35).

## Drie wegen naar de kern

Voor LE1 (net 24×12) staat het rekenverzoek in [`le1-membraan-24x12.request.json`](le1-membraan-24x12.request.json)
en de uitkomst van `open_fem_3d::solve` in [`le1-membraan-24x12.verwacht.json`](le1-membraan-24x12.verwacht.json).

| Weg | Hoe getest | σyy in D |
|-----|------------|----------|
| Tauri-commando `solve_open_fem_3d` (roept `open_fem_3d::solve`) | `nafems_le1_request_file_three_routes` in `tests/nafems.rs`: leest het bestand, rekent, vergelijkt met de opbouw in de test | 90,526998 MPa |
| Browserroute `/api/openFem3d/solve` = stdin/stdout-kern `open-fem-3d` | `design-mockup/test-nafems-3d.mjs` [1] | gelijk tot op 1e-9 |
| MCP-server, tool `solve_open_fem_3d` | `design-mockup/test-nafems-3d.mjs` [1], ook alle knoopwaarden n_xx, n_yy, n_xy | gelijk tot op 1e-9 |

(`toetsbrug` is de weg voor de normtoetsing, niet voor de 3D-kern; de 3D-kern bereikt de browser
via de eigen stdin/stdout-binary.)

## Grafische weergave

Getest zonder browser (`test-nafems-3d.mjs` [2]): LE6 als gewoon appmodel (plaat met vier
hoekknopen, het midden als knoop, randopleggingen u_z, S235, vlaklast −0,7 kN/m²) langs de
route van de app (`parseOpenFem3DModel` → `meshOpenFem3DPlates` → `buildOpenFem3DSolveRequest`
→ kern) en dan door dezelfde functies die het tekenvlak, de legenda en het eigenschappenpaneel
voeden.

| Wat de gebruiker ziet | Bron in de app | Controle | Status |
|-----------------------|----------------|----------|--------|
| contourwaarden mxx, myy, mxy, w, σvm,onder per knoop | `openFem3DPlateQuantityValues` | = kernknoopwaarden (exact, w ×1000 naar mm) | ✅ |
| legenda min/max | `openFem3DPlateQuantityRange` | = min/max over de kernknopen | ✅ |
| extremen in het eigenschappenpaneel | `openFem3DPlateExtremes` | = `PlateSummary3D.extremes` = legenda | ✅ |
| getalopmaak | `formatOpenFem3DPlateValue` | NL-notatie, minstens drie significante cijfers | ✅ (B3 opgelost) |
| kleur van de contour in E | `buildOpenFem3DPlateOverlay` | = kleurschaal van (m − min)/(max − min) | ✅ |
| vervormde vorm | `buildOpenFem3DPlateOverlay` | E ligt op x + schaal·u | ✅ |
| teken: positief moment = trek onder | `shell.rs`, `values_from` | σ1 onder uit de getoonde momenten: 0,8112 MPa (+1,1 %) op het appnet (1 422 vierhoeken uit driehoeken, maaswijdte 1/32 m) | ✅ |
| Von Mises onderzijde | idem | volgt uit de getoonde momenten | ✅ |
| WebGL-beeld, labels/tooltips in de DOM, rapporttabel `OpenFem3DReport.tsx`, staafdiagrammen | — | **niet getest**: vergt Chromium (ontbreekt op de testmachine) | open |

Opmerking voor de gebruiker: de app toont geen hoofdspanningen en geen σxx/σyy van platen, alleen
n, m, v, w en Von Mises boven/onder. Een NAFEMS-grootheid als σ1 (LE6) of σyy (LE1) moet de
gebruiker uit m (σ = ±6m/t²) of n (σ = n/t) afleiden.

## Bevindingen

**B1 — LE3: het MITC4-element van de externe kern is op een dunne dubbel gekromde schaal veel te
stijf.** Bij 32×32 elementen −68 %, bij 128×128 nog −16 %; de uitkomst convergeert wel, maar zeer
traag (membraanvergrendeling van het vlakke facetelement). De kern meldt hetzelfde in zijn eigen
documentatie (`SHELL_FAMILY_FEASIBILITY.md`: "Pinched hemisphere 8×8 … ~28× overstiff | Locked";
zijn eigen LE3-test eist alleen een verhouding tussen 10⁻⁶ en 100). Een ander MITC4 met vlakke
facetten haalt LE3 wel (FieldCraft, zelfde net: 0,182 m bij 8×8), dus het is een eigenschap van
dit element, niet van vlakke facetten in het algemeen. Gevolg voor gebruikers: dunne gekromde
schalen (koepels, bolle daken met R/t in de orde van honderden) worden veel te stijf berekend.
Niet opgelost (de externe kern is vastgezet; geen kerncode aangepast); de strikte toets staat als
`#[ignore]` klaar (`nafems_le3_target_within_tolerance`). **Apart issue openen.**

**B2 — LE10: geëxtrapoleerde oppervlaktespanning van Hex8 op grove dikte-indeling.** Met 8 lagen
over de dikte +5,4 % (buiten 5 %); pas met 16–32 lagen binnen tolerantie. Dat is de bekende
zwakte van een volledig geïntegreerde trilineaire Hex8 in buiging plus extrapolatie vanuit één
hoekelement, geen fout. Voor gebruikers: spanningen aan het oppervlak van een Hex8-model met
weinig lagen zijn enkele procenten te groot.

**B3 — getalopmaak van plaatwaarden.** `formatOpenFem3DPlateValue` (legenda, paneel) belooft
"drie significante cijfers" maar rondt op vaste decimalen af (3 onder 10). Kleine waarden
verliezen daardoor hun precisie: in LE6 staat mxx = 0,00822 kNm/m als "0,008", myy = 0,01314 als
"0,013" en mxy = −0,00142 als "-0,001". De kernwaarden zelf kloppen; alleen de weergave is grof.
Opgelost: onder 1 krijgt de waarde zoveel decimalen als drie significante cijfers vragen
(hooguit 10): mxx = 0,00822, myy = 0,0131, mxy = −0,00142. De test controleert dat nu.

## Conclusie

Aangetoond, binnen de genoemde toleranties en netten: het membraan- en buiggedrag van het
MITC4-element op vlakke en zwak gekromde (cilindrische) schalen, de koppeling van vlakke
platen onder een hoek (Z-profiel), de knoopwaarden die de app toont (inclusief de patchfit op de
rand en de tekenafspraak), de Hex8 in een driedimensionale spanningstoestand, en dat de drie
wegen naar de 3D-kern hetzelfde rekenen.

Niet aangetoond: dunne dubbel gekromde schalen (LE3 faalt), rotatiesymmetrische problemen
(LE7/LE8), temperatuurbelasting op volumes (LE11), eigenfrequenties (FV-reeks, geen modale
analyse), het getekende beeld en het rapport in de browser, en de NAFEMS-netten zelf (die staan
alleen in de figuren van TNSB).
