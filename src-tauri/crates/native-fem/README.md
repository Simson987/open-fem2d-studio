# Eigen Rust FEM-kern (experimenteel)

Deze crate is een zelfstandige rekenkern op de branch
`codex/native-rust-3d-plate-gnl-fnl`. De bestaande solver blijft de standaard in
de app. De CLI-programma's lezen één JSON-verzoek van stdin en schrijven
één JSON-resultaat naar stdout; fouten krijgen een niet-nul exitcode en een
`{"error":"..."}`-resultaat. Een solver die invoer niet ondersteunt, weigert
die expliciet.

## Rekengebied

| Kern | Element | GNL | FNL | Lasten en opleggingen |
| --- | --- | --- | --- | --- |
| `native-frame3d` | 12-DOF Euler-Bernoulli raamwerk, 6 DOF/knoop | iteratieve P-Δ-stijfheid met stabiliteitscontrole | monotone effectieve-E-envelop voor staal en beton | knoop-, lijn-, staafpunt- en thermische lasten; vaste DOF, globale veren, opgelegde verplaatsingen/rotaties en staafeindscharnieren |
| `native-plate2d` | 3-knoops CST-vlakspanning/membraan, 2 DOF/knoop | Green-Lagrange-rek met Newton-iteratie | J2-staalplastificatie met isotrope verharding en onomkeerbare betonschade per element | knoopkrachten en vaste x/y-DOF |
| `native-plate-bending` | 3-knoops DKT-plaatbuiging, 3 DOF/knoop | nog niet | nog niet | dwarsknoopkrachten, knoopmomenten en vaste w/rotatie-DOF |
| `native-square-mesh` | exact vierkant Q4-rooster met randknoop-ID's | n.v.t. | n.v.t. | `widthM`, `heightM`, `cellSizeM` |
| `native-quad2d` | 4-knoops Q4-schijfelement, 2 DOF/knoop | Green-Lagrange | J2-staal en betonschade per Gauss-punt; afnemende E(rek)-curve | vlakke knoopkrachten en x/y-opleggingen |
| `native-hybrid-plate` | 4-knoops hybride Kirchhoff-buiging, 12 DOF en 17 momentparameters | nog niet | afnemende secant-E per element en belastingpad | dwarsknoopkrachten, momenten, uniforme druk en w/rotatie-opleggingen; optionele UGT-wapenings- en BGT-scheurcontrole |
| `native-prestressed-beam` | vrij opgelegde elastische ligger met rechte of parabolische kabel | n.v.t. | opgegeven voorspanverlies | uniforme last en fases overdracht/gebruiksfase |

De invoer gebruikt **m, kN en MPa**. Voor 3D volgt het JSON-schema de
veldnamen van `frame3d-solver` (`schemaVersion: 1`); een materiaal kan een
extra `law` krijgen. Voor 2D is de invoer een apart, beperkt roostercontract
met `nodes`, `materials`, `triangles`, `supports` en `loads`. De bestaande
TypeScript-plaat gebruikt Pa en N; de vergelijkingstest converteert die
eenheden expliciet. `buildNativePlate2DRequest` en
`buildNativePlateBendingRequest`, `buildNativeQuad2DRequest` en
`buildNativeHybridPlateRequest` in
`design-mockup/src/core/fem/nativePlate2DAdapter.ts` zet een bestaand `Mesh`
om naar de betreffende kern en weigert onder meer gemengde elementtypes,
gekoppelde balken, orthotropie en veren.

## Gedeelde aanroep uit de app

`dispatch::solve_native_fem` accepteert één getypeerd verzoek:

```json
{
  "kind": "squareMesh",
  "input": {"originX":0,"originY":0,"widthM":2,"heightM":2,"cellSizeM":1,"materialId":1,"thicknessM":0.1}
}
```

Andere `kind`-waarden zijn `frame3d`, `plate2d`, `plateBending`, `quad2d`,
`hybridPlate` en `prestressedBeam`. Het antwoord heeft dezelfde `kind` en een
`result` met het bestaande resultaatcontract van die kern. De desktop roept
dit aan met Tauri-command `solve_native_fem({ inputs })`, de ontwikkelbrowser
met toetsbrug-opdracht `solve_native_fem`, en MCP met het gelijknamige
gereedschap. `design-mockup/src/lib/nativeFemClient.ts` kiest vanuit de app
automatisch Tauri of de ontwikkelbrug. Een drie-wegen-test vergelijkt de
gehele JSON-uitvoer voor een mesh en een Q4-trekproef.

In **Instellingen → Berekening** kan de gebruiker nu `Open FEM Rust
(experimenteel)` kiezen voor een eerste-orde 3D-raamwerk. De bestaande
analyseknop gebruikt dan dezelfde app-invoer en vertaalt de Rust-uitvoer naar
knoopverplaatsingen, reacties, staafkrachten, bemonsterde snedekrachtlijnen, evenwicht,
resultaatweergave en rapport. De automatische keuze blijft bij de bestaande
solver. Staaflijn-, staafpunt- en thermische lasten zijn ook gekoppeld en de
diagramstations zijn tegen de bestaande solver vergeleken. De app weigert voor
de native route nog P-Δ zolang eigenknik in de app ontbreekt.
De andere native elementresultaten zijn nog niet op alle weergave-, combinatie-
en rapporttypen aangesloten. Onbekende `kind`- en invoervelden worden door de
Rust-typen geweigerd.

```bash
cd src-tauri
cargo test -p openaec-native-fem
cargo test -p openaec-native-fem --test frame3d_parity
cargo build -p openaec-native-fem --bins
cd ../design-mockup
node --import tsx test-native-frame3d-comparison.mjs
node --import tsx test-native-frame3d-app-route.mjs
node --import tsx test-native-plate2d-comparison.mjs
node --import tsx test-native-plate-bending-comparison.mjs
node --import tsx test-native-quad2d-comparison.mjs
```

Voorbeeld van een 2D-vlakspanning-verzoek:

```json
{
  "analysis": "material",
  "nodes": [{"id":1,"x":0,"y":0},{"id":2,"x":1,"y":0},{"id":3,"x":0,"y":1}],
  "materials": [{"id":1,"eMpa":210000,"nu":0.3,"law":{"kind":"steelBilinear","yield_mpa":235,"hardening_ratio":0.02}}],
  "triangles": [{"id":1,"nodeIds":[1,2,3],"materialId":1,"thicknessM":0.1}],
  "supports": [{"nodeId":1,"ux":true,"uy":true},{"nodeId":2,"ux":false,"uy":true},{"nodeId":3,"ux":true,"uy":false}],
  "loads": [{"nodeId":2,"fx":15000,"fy":0},{"nodeId":3,"fx":0,"fy":15000}],
  "loadPath": [1, 0]
}
```

`analysis` is `linear`, `geometric`, `material` of `combined` voor 2D;
3D gebruikt `linear`, `p-delta`, `material` of `combined`. Het
`MaterialLaw`-contract bevat `elastic`, `steelBilinear` en
`concreteCracking` met respectievelijk `yield_mpa`/`hardening_ratio` en
`tensile_mpa`/`residual_ratio`. `loadPath` is optioneel: de factoren worden
achtereenvolgens aangebracht, elk in tien stappen voor niet-lineaire analyses.
Het voorbeeld belast en ontlast weer. Het resultaat bevat per driehoek de
equivalente plastische rek en de trekschade. De materiaaltoestand leeft binnen
één verzoek; afzonderlijke CLI-aanroepen delen geen toestand.

## Verificatie en grenzen

- De 3D-verplaatsingen en reacties zijn voor drie stalen belastinggevallen
  vergeleken met de bestaande Dedaliano-adapter, met grenzen van 1e-7 m/rad
  en 1e-4 kN/kNm. Een uitkraging is bovendien tegen de gesloten formule getest.
  Een gedeelde JSON-invoer vergelijkt nu ook translatie- en rotatieveren en
  opgelegde axiale verplaatsing en rotatie rechtstreeks met de adapter;
  de eerste twee gevallen lopen ook door P-Δ. Voor de veer en de axiale
  verplaatsing zijn daarnaast gesloten evenwichtsformules getest. Uniforme,
  gedeeltelijke/lineair verlopende staaflijnlasten en staafpuntlasten zijn
  op dezelfde wijze vergeleken; de uitkragingslasten zijn ook met gesloten
  liggerformules getoetst. De JSON-vergelijking gebruikt maximaal 1e-8 m/rad
  absolute of 1e-6 relatieve afwijking voor verplaatsingen en 1e-6 kN/kNm
  absolute of relatieve afwijking voor reacties. Vrije en verhinderde
  thermische uitzetting zijn tegen de analytische staafoplossing getoetst;
  uniforme en tweerichtingsgradiënten zijn met de bestaande solver vergeleken.
  My-, Mz- en torsiescharnieren zijn met statische condensatie ingevoerd en
  tegen de bestaande solver en een opgelegde liggerformule gecontroleerd.
  Een schuine tweestaafsknoop met lokale staafrotatie is ook vergeleken.
  Vrije rotaties zonder aangesloten stijfheid krijgen een nulwaarde als
  rekentechnische referentie; een momentlast op zo'n vrijheidsgraad wordt
  geweigerd. De bestaande solver meldt het geteste tweezijdig losgelaten
  liggergeval als singulier, terwijl de reacties analytisch volgen.
- De 2D lineaire knoopverplaatsingen, reacties en spanningen van twee
  CST-elementen zijn vergeleken met de huidige TypeScript-kern. Tests dekken
  ook elementoriëntatie, GNL-verstijving, plastische restvervorming na ontlasten,
  blijvende betonschade en foutafhandeling.
- De DKT-plaatbuiging is voor acht driehoeken met de bestaande TypeScript-kern
  vergeleken op verplaatsingen, reacties en momenten. Starre modes en een
  constante-krommingspatch zijn apart getest.
- Q4-schijfverplaatsingen, reacties en spanningen zijn voor rechte en vervormde
  roosters met de bestaande TypeScript-kern vergeleken. De hybride
  buigplaat doorstaat starre modes, een constante-krommingspatch en een
  Navier-plaatbenchmark (4,1% middenzakkingverschil op 6×6 vierhoeken).
- De optionele plaatwapeningscontrole toetst de dwarskracht en de benodigde
  verticale en langsgerichte wapening in een UGT-verzoek. Een apart
  BGT-verzoek rapporteert scheurwijdten in vier wapeningsrichtingen. De
  scheurformule is ook tegen een gepubliceerd EC2-brugvoorbeeld getoetst;
  de Cement-uitkraging geeft aan de steun 240 kN/m. Zie de
  [plaatvoorbeelden](PLATE_EXAMPLES.md) voor invoer, uitkomsten en aannames.
- **Beperkingen FNL:** de 3D-raamwerkkern gebruikt nog een monotone
  effectieve-E-envelop zonder doorsnedeplastificatie of scheurgeschiedenis.
  De 2D-betonschade gebruikt één scalair per element zonder scheurband- of
  breukenergie-regularisatie; het resultaat kan daarom van de mesh afhangen.
  Ook de 2D-staalwet en het betonmodel zijn nog niet extern gevalideerd voor
  ontwerpbeslissingen.
- De DKT-kern rekent alleen lineaire plaatbuiging. De hybride buigplaat
  gebruikt een secant-E-omhulling per element; dat is geen geregelde
  beton-scheurwet of doorsnedeplastificatie. Vlakvervorming,
  orthotropie en gekoppelde staaf-plaatmodellen zijn nog niet
  geïmplementeerd. Thermische lasten of staafeindscharnieren samen met
  materiaalniet-lineariteit, en eigenwaarde-knik worden in de 3D-kern geweigerd.
- De plaatwapeningsuitvoer gebruikt herleide dwarskracht, aangenomen
  eerste-generatie EC2-formules en een elastische momentverdeling. Er is
  geen gescheurde plaatstijfheid, automatische nationale bijlage of
  constructieve detaillering. De uitvoer is daarom een controlevoorbeeld
  en geen vrijgave voor constructief ontwerp.
- Tot 600 DOF gebruikt de kern dichte eliminatie. Grotere Q4-, CST-, DKT- en
  hybride plaatmatrices gebruiken nu een ijle symmetrische Jacobi-PCG-oplosser
  met een grens van 20.000 DOF. Een Q4-rekproef met 882 DOF en een hybride
  Navier-plaat met 675 DOF staan in de Rust-tests. De ijle oplosser weigert
  asymmetrische matrices en niet-positieve kromming tijdens de iteratie, maar
  voert nog geen volledige traagheids- of eigenwaardecontrole uit. Vooral bij
  een nulbelasting bewijst een nuloplossing dus geen stabiliteit. Het 3D-raamwerk
  blijft voorlopig begrensd op 600 DOF voor zijn expliciete stabiliteitstoets.
  Een bredere referentieset, betrouwbare stabiliteitsdetectie voor grote
  modellen en 3D-materiaalhistorie zijn nodig voordat de app deze kern als
  standaard kan gebruiken.

De [migratie- en verificatielijst](RUST_SOLVER_ROADMAP.md) volgt de nog open
onderdelen van het doorlopende doel om de volledige solver naar Rust te brengen.

De [plaatvoorbeelden](PLATE_EXAMPLES.md) geven reproduceerbare invoer en
controlecijfers, inclusief de uitkragende plaat uit Cement 2021/8 van Braam
en Blaauwendraad. De [voorspanvoorbeelden](PRESTRESSED_BEAM.md) bevatten een
FHWA-controleberekening en een parabolische kabel.
