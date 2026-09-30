# Eigen Rust FEM-kern (experimenteel)

Deze crate is een zelfstandige rekenkern op de branch
`codex/native-rust-3d-plate-gnl-fnl`. De bestaande solver blijft de standaard in
de app. De twee CLI-programma's lezen één JSON-verzoek van stdin en schrijven
één JSON-resultaat naar stdout; fouten krijgen een niet-nul exitcode en een
`{"error":"..."}`-resultaat. Een solver die invoer niet ondersteunt, weigert
die expliciet.

## Rekengebied

| Kern | Element | GNL | FNL | Lasten en opleggingen |
| --- | --- | --- | --- | --- |
| `native-frame3d` | 12-DOF Euler-Bernoulli raamwerk, 6 DOF/knoop | iteratieve P-Δ-stijfheid met stabiliteitscontrole | monotone effectieve-E-envelop voor staal en beton | knoopkrachten en volledig/partieel vaste DOF |
| `native-plate2d` | 3-knoops CST-vlakspanning/membraan, 2 DOF/knoop | Green-Lagrange-rek met Newton-iteratie | bilineaire staal- en gescheurd-beton-spanningsenvelop | knoopkrachten en vaste x/y-DOF |

De invoer gebruikt **m, kN en MPa**. Voor 3D volgt het JSON-schema de
veldnamen van `frame3d-solver` (`schemaVersion: 1`); een materiaal kan een
extra `law` krijgen. Voor 2D is de invoer een apart, beperkt roostercontract
met `nodes`, `materials`, `triangles`, `supports` en `loads`. De bestaande
TypeScript-plaat gebruikt Pa en N; de vergelijkingstest converteert die
eenheden expliciet. `buildNativePlate2DRequest` in
`design-mockup/src/core/fem/nativePlate2DAdapter.ts` zet een bestaand `Mesh`
om en weigert onder meer vierhoeken, balken, orthotropie en veren.

```bash
cd src-tauri
cargo test -p openaec-native-fem
cargo build -p openaec-native-fem --bins
cd ../design-mockup
node --import tsx test-native-frame3d-comparison.mjs
node --import tsx test-native-plate2d-comparison.mjs
```

Voorbeeld van een 2D-vlakspanning-verzoek:

```json
{
  "analysis": "combined",
  "nodes": [{"id":1,"x":0,"y":0},{"id":2,"x":1,"y":0},{"id":3,"x":0,"y":1}],
  "materials": [{"id":1,"eMpa":210000,"nu":0.3,"law":{"kind":"steelBilinear","yield_mpa":235,"hardening_ratio":0.02}}],
  "triangles": [{"id":1,"nodeIds":[1,2,3],"materialId":1,"thicknessM":0.1}],
  "supports": [{"nodeId":1,"ux":true,"uy":true},{"nodeId":2,"ux":false,"uy":true},{"nodeId":3,"ux":true,"uy":false}],
  "loads": [{"nodeId":2,"fx":10,"fy":0},{"nodeId":3,"fx":0,"fy":10}]
}
```

`analysis` is `linear`, `geometric`, `material` of `combined` voor 2D;
3D gebruikt `linear`, `p-delta`, `material` of `combined`. Het
`MaterialLaw`-contract bevat `elastic`, `steelBilinear` en
`concreteCracking` met respectievelijk `yield_mpa`/`hardening_ratio` en
`tensile_mpa`/`residual_ratio`.

## Verificatie en grenzen

- De 3D-verplaatsingen en reacties zijn voor drie stalen belastinggevallen
  vergeleken met de bestaande Dedaliano-adapter, met grenzen van 1e-7 m/rad
  en 1e-4 kN/kNm. Een uitkraging is bovendien tegen de gesloten formule getest.
- De 2D lineaire knoopverplaatsingen, reacties en spanningen van twee
  CST-elementen zijn vergeleken met de huidige TypeScript-kern. Tests dekken
  ook elementoriëntatie, GNL-verstijving, materiaalverweking en foutafhandeling.
- FNL is op dit moment een **monotone spanningsenvelop**. Plastische rek,
  permanente vervorming, scheurgeschiedenis en ontlast/herbelastgedrag worden
  niet opgeslagen. De resultaten zijn daarom geen gevalideerde plastische of
  gescheurde doorsnedeberekening en niet geschikt voor ontwerpbeslissingen.
- De 2D-kern rekent *in het vlak*. Plaatbuiging uit het vlak (DKT), vlakvervorming,
  vierhoeken, orthotropie en gekoppelde staaf-plaatmodellen zijn nog niet
  geïmplementeerd. De 3D-kern weigert verdeelde/staafpunt/thermische lasten,
  veren, opgelegde verplaatsingen, scharnieren en eigenwaarde-knik.
- Beide kernen gebruiken een dichte solver met een harde grens van 600 DOF.
  Een ijle solver, bredere referentieset en materiaalhistorie zijn nodig
  voordat de app deze kern als standaard kan gebruiken.
