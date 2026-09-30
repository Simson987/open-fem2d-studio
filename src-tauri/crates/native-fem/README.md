# Eigen Rust FEM-kern (experimenteel)

Deze crate is een zelfstandige rekenkern op de branch
`codex/native-rust-3d-plate-gnl-fnl`. De bestaande solver blijft de standaard in
de app. De drie CLI-programma's lezen één JSON-verzoek van stdin en schrijven
één JSON-resultaat naar stdout; fouten krijgen een niet-nul exitcode en een
`{"error":"..."}`-resultaat. Een solver die invoer niet ondersteunt, weigert
die expliciet.

## Rekengebied

| Kern | Element | GNL | FNL | Lasten en opleggingen |
| --- | --- | --- | --- | --- |
| `native-frame3d` | 12-DOF Euler-Bernoulli raamwerk, 6 DOF/knoop | iteratieve P-Δ-stijfheid met stabiliteitscontrole | monotone effectieve-E-envelop voor staal en beton | knoopkrachten en volledig/partieel vaste DOF |
| `native-plate2d` | 3-knoops CST-vlakspanning/membraan, 2 DOF/knoop | Green-Lagrange-rek met Newton-iteratie | J2-staalplastificatie met isotrope verharding en onomkeerbare betonschade per element | knoopkrachten en vaste x/y-DOF |
| `native-plate-bending` | 3-knoops DKT-plaatbuiging, 3 DOF/knoop | nog niet | nog niet | dwarsknoopkrachten, knoopmomenten en vaste w/rotatie-DOF |

De invoer gebruikt **m, kN en MPa**. Voor 3D volgt het JSON-schema de
veldnamen van `frame3d-solver` (`schemaVersion: 1`); een materiaal kan een
extra `law` krijgen. Voor 2D is de invoer een apart, beperkt roostercontract
met `nodes`, `materials`, `triangles`, `supports` en `loads`. De bestaande
TypeScript-plaat gebruikt Pa en N; de vergelijkingstest converteert die
eenheden expliciet. `buildNativePlate2DRequest` en
`buildNativePlateBendingRequest` in
`design-mockup/src/core/fem/nativePlate2DAdapter.ts` zet een bestaand `Mesh`
om en weigert onder meer vierhoeken, balken, orthotropie en veren.

```bash
cd src-tauri
cargo test -p openaec-native-fem
cargo build -p openaec-native-fem --bins
cd ../design-mockup
node --import tsx test-native-frame3d-comparison.mjs
node --import tsx test-native-plate2d-comparison.mjs
node --import tsx test-native-plate-bending-comparison.mjs
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
- De 2D lineaire knoopverplaatsingen, reacties en spanningen van twee
  CST-elementen zijn vergeleken met de huidige TypeScript-kern. Tests dekken
  ook elementoriëntatie, GNL-verstijving, plastische restvervorming na ontlasten,
  blijvende betonschade en foutafhandeling.
- De DKT-plaatbuiging is voor acht driehoeken met de bestaande TypeScript-kern
  vergeleken op verplaatsingen, reacties en momenten. Starre modes en een
  constante-krommingspatch zijn apart getest.
- **Beperkingen FNL:** de 3D-raamwerkkern gebruikt nog een monotone
  effectieve-E-envelop zonder doorsnedeplastificatie of scheurgeschiedenis.
  De 2D-betonschade gebruikt één scalair per element zonder scheurband- of
  breukenergie-regularisatie; het resultaat kan daarom van de mesh afhangen.
  Ook de 2D-staalwet en het betonmodel zijn nog niet extern gevalideerd voor
  ontwerpbeslissingen.
- De DKT-kern rekent alleen lineaire plaatbuiging. Vlakvervorming,
  vierhoeken, orthotropie en gekoppelde staaf-plaatmodellen zijn nog niet
  geïmplementeerd. De 3D-kern weigert verdeelde/staafpunt/thermische lasten,
  veren, opgelegde verplaatsingen, scharnieren en eigenwaarde-knik.
- Alle drie kernen gebruiken een dichte solver met een harde grens van 600 DOF.
  Een ijle solver, bredere referentieset en 3D-materiaalhistorie zijn nodig
  voordat de app deze kern als standaard kan gebruiken.
