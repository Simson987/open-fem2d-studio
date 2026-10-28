// Stramien- en levellijnen als streep-stip (issue #103).
//
// WAAROM DEZE TEST BESTAAT
// Stramien- en hartlijnen staan op een constructietekening als streep-stip:
// een lange streep, een korte tussenruimte, een stip, een korte
// tussenruimte. Het tekenvlak tekende ze als gewone streeplijn (2D: 6 3 in
// CSS; 3D: LineDashedMaterial 0,22 / 0,12 m in wereldmaat, dus bij
// uitzoomen een waas en bij inzoomen losse streepjes). Precies de fouten die
// hieronder vallen: een 2D-regel die terugvalt naar streep-gat of afwijkt van
// 3D, een shaderregel van Three.js die bij een update niet meer vervangen
// wordt (dan stil weer streep-gat), lijnafstanden die over alle lijnstukken
// doortellen (elke lijn een ander begin, grote getallen), een patroon dat
// met de zoom meegroeit, een stramien dat de section box toch knipt, een
// andere kleur of dekking, en een rapport dat geen streep-stip meer tekent.
//
// Checks:
//  [1] PATROON  — lange streep, korte tussenruimte, stip, korte tussenruimte;
//                 de regel getekend/niet over drie perioden.
//  [2] 2D       — FemCanvas.css: .fem-stramien-line heeft hetzelfde patroon,
//                 kleur, dikte en dekking ongewijzigd; stramienassen én
//                 niveaulijnen gebruiken die klasse.
//  [3] SHADER   — de echte fragment shader van Three.js wordt vervangen; de
//                 vervangen regel gooit precies weg wat het patroon niet tekent.
//  [4] 3D-LIJN  — materiaal (kleur, dekking), lijnafstand per lijnstuk vanaf 0,
//                 schaal in pixels per meter (parallel en perspectief),
//                 schermvast bij in- en uitzoomen.
//  [5] SECTION BOX — het stramien blijft heel; het model wordt geknipt.
//  [6] TEKENVLAK — ThreeFrameCanvas tekent het stramien via de module; de
//                 andere stippellijnen blijven zoals ze waren.
//  [7] RAPPORT  — de stramienassen in de rapportfiguren zijn streep-stip.
//  [8] BEDRADING — beide tests in de batterij.
//
// Uitvoeren: node scripts/run-tests.mjs --filter=stramien-streepstip
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";

const P = await import("./src/lib/stramienStreepStip.ts");
const L = await import("./src/components/openFem3d/openFem3dStramienLijn.ts");
const Beeld = await import("./src/components/openFem3d/openFem3dSectionBoxBeeld.ts");
const { renderGridAxisLines, buildSchemaTransform } = await import("./src/components/report/reportGeometry.tsx");

let geslaagd = 0;
let gefaald = 0;
async function check(naam, proef) {
  try {
    await proef();
    geslaagd += 1;
    console.log(`  ✓ ${naam}`);
  } catch (fout) {
    gefaald += 1;
    console.log(`  ✗ ${naam}\n      ${fout instanceof Error ? fout.message : fout}`);
  }
}
const bron = (pad) => readFileSync(new URL(pad, import.meta.url), "utf8");
const bijna = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} ≠ ${b} (±${tol})`);

/** Loopt van `van` tot `tot` in stapjes en geeft de lengtes van de stukken getekend/niet. */
function stukken(getekend, van, tot, stap = 0.125) {
  const uit = [];
  let huidig = null, lengte = 0;
  for (let t = van; t < tot - 1e-9; t += stap) {
    const aan = getekend(t + stap / 2);
    if (aan === huidig) lengte += stap;
    else { if (huidig !== null) uit.push([huidig, lengte]); huidig = aan; lengte = stap; }
  }
  uit.push([huidig, lengte]);
  return uit;
}

console.log("\n[1] PATROON");
await check("streep-stip in px: lange streep, korte tussenruimte, stip, even korte tussenruimte", () => {
  const [streep, tussen, stip, tussen2] = P.STRAMIEN_STREEPSTIP_PX;
  assert.deepEqual([...P.STRAMIEN_STREEPSTIP_PX], [16, 4, 2, 4]);
  assert.equal(tussen, tussen2, "de twee tussenruimtes even lang");
  assert.ok(streep >= 3 * tussen, "de streep is lang");
  assert.ok(stip > 0 && stip < tussen, "de stip is korter dan de tussenruimte (en niet leeg)");
  assert.equal(P.streepStipPeriode(), 26);
  assert.equal(P.streepStipDasharray(), "16 4 2 4");
});
await check("getekend/niet over drie perioden: 16 aan, 4 uit, 2 aan, 4 uit; ook vóór het begin periodiek", () => {
  const reeks = stukken((t) => P.stramienStreepStipGetekend(t), 0, 78);
  assert.deepEqual(reeks, [
    [true, 16], [false, 4], [true, 2], [false, 4],
    [true, 16], [false, 4], [true, 2], [false, 4],
    [true, 16], [false, 4], [true, 2], [false, 4],
  ]);
  for (const t of [0, 16, 20, 22, 26, 52]) assert.equal(P.stramienStreepStipGetekend(t), true, `${t} px: op een grens getekend`);
  for (const t of [17, 19.9, 22.1, 25.9]) assert.equal(P.stramienStreepStipGetekend(t), false, `${t} px: tussenruimte`);
  assert.equal(P.stramienStreepStipGetekend(-5), P.stramienStreepStipGetekend(21), "−5 px = 21 px (stip)");
  assert.equal(P.stramienStreepStipGetekend(-8), P.stramienStreepStipGetekend(18), "−8 px = 18 px (gat)");
});

console.log("\n[2] 2D");
await check("FemCanvas.css: .fem-stramien-line streep-stip zoals 3D; kleur, dikte en dekking ongewijzigd", () => {
  const css = bron("./src/components/fem/FemCanvas.css").replace(/\/\*[\s\S]*?\*\//g, "");
  // Alle regels waarvan een selector de klasse noemt: precies één (geen tweede die het patroon overschrijft).
  const regels = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => /\.fem-stramien-line(?![\w-])/.test(m[1]));
  assert.deepEqual(regels.map((m) => m[1].trim()), [".fem-stramien-line"], "één regel voor .fem-stramien-line");
  const eigenschap = (naam) => new RegExp(`(?:^|;|\\s)${naam}\\s*:\\s*([^;]+);`).exec(regels[0][2])?.[1].trim();
  assert.equal(eigenschap("stroke-dasharray"), P.streepStipDasharray(), "patroon gelijk aan lib/stramienStreepStip.ts");
  assert.equal(eigenschap("stroke"), "#ffb000", "kleur");
  assert.equal(eigenschap("stroke-width"), "1", "dikte");
  assert.equal(eigenschap("opacity"), "0.35", "dekking");
});
await check("FemCanvas.tsx: stramienassen (verticaal) en niveaus (horizontaal) gebruiken de klasse, zonder eigen patroon", () => {
  const tsx = bron("./src/components/fem/FemCanvas.tsx");
  const lijnen = [...tsx.matchAll(/<line\b[^>]*className="fem-stramien-line"[^>]*\/>/g)].map((m) => m[0]);
  assert.equal(lijnen.length, 2, "twee lijnen: x-assen en niveaus");
  assert.ok(lijnen.some((l) => /pTop/.test(l)) && lijnen.some((l) => /pL\b/.test(l)), "verticale assen en niveaulijnen");
  for (const l of lijnen) assert.ok(!/strokeDasharray|style=/.test(l), `geen eigen patroon op de lijn: ${l}`);
});

console.log("\n[3] SHADER");
const echteFragment = THREE.ShaderLib.dashed.fragmentShader;
await check("de streepregel van Three.js wordt gevonden en vervangen", () => {
  assert.match(echteFragment, /mod\( vLineDistance, totalSize \) > dashSize/, "de regel staat in deze versie van Three.js");
  const nieuw = L.openFem3DStreepStipFragment(echteFragment);
  assert.ok(nieuw, "vervanging gelukt");
  assert.ok(!/mod\( vLineDistance, totalSize \) > dashSize/.test(nieuw), "de oude regel is weg");
  assert.match(nieuw, /openFem3dStreepStipT > dashSize && \( openFem3dStreepStipT < 20\.0 \|\| openFem3dStreepStipT > 22\.0 \) \) discard;/);
  // De rest van de shader (kleur, dekking, clipping, logdiepte, mist) blijft.
  for (const deel of ["#include <clipping_planes_fragment>", "#include <logdepthbuf_fragment>", "#include <fog_fragment>", "vec4 diffuseColor = vec4( diffuse, opacity );"]) {
    assert.ok(nieuw.includes(deel), `blijft: ${deel}`);
  }
  assert.equal(L.openFem3DStreepStipFragment("void main() {}"), null, "zonder de regel: null");
});
await check("de vervangen regel gooit precies weg wat het patroon niet tekent (dashSize 16, totalSize 26)", () => {
  const nieuw = L.openFem3DStreepStipFragment(echteFragment);
  const m = /openFem3dStreepStipT < ([\d.]+) \|\| openFem3dStreepStipT > ([\d.]+)/.exec(nieuw);
  const [stipBegin, stipEinde] = [Number(m[1]), Number(m[2])];
  const materiaal = L.maakOpenFem3DStreepStipMateriaal(0x123456);
  const dashSize = materiaal.dashSize, totalSize = materiaal.dashSize + materiaal.gapSize;
  assert.deepEqual([dashSize, totalSize], [16, 26]);
  const glslMod = (x, y) => x - y * Math.floor(x / y);
  for (let t = -30; t <= 80; t += 0.25) {
    const s = glslMod(t, totalSize);
    const weg = s > dashSize && (s < stipBegin || s > stipEinde);
    assert.equal(!weg, P.stramienStreepStipGetekend(t), `${t} px`);
  }
});
await check("het materiaal past de shader toe in onBeforeCompile, met een eigen programmasleutel", () => {
  const materiaal = L.maakOpenFem3DStreepStipMateriaal(0x7c8da0);
  const shader = { fragmentShader: echteFragment, vertexShader: THREE.ShaderLib.dashed.vertexShader, uniforms: {} };
  materiaal.onBeforeCompile(shader, null);
  assert.equal(shader.fragmentShader, L.openFem3DStreepStipFragment(echteFragment));
  assert.equal(shader.vertexShader, THREE.ShaderLib.dashed.vertexShader, "vertex shader ongewijzigd");
  assert.notEqual(materiaal.customProgramCacheKey(), new THREE.LineDashedMaterial().customProgramCacheKey(), "eigen programma, niet gedeeld met gewone streeplijnen");
});

console.log("\n[4] 3D-LIJN");
await check("materiaal: LineDashedMaterial, kleur en dekking zoals voorheen (0,85, doorzichtig)", () => {
  for (const kleur of [L.OPEN_FEM_3D_STRAMIEN_KLEUR, L.OPEN_FEM_3D_STRAMIEN_LEVEL_KLEUR]) {
    const lijn = L.maakOpenFem3DStramienLijnen([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)], kleur);
    assert.equal(lijn.material.type, "LineDashedMaterial");
    assert.equal(lijn.material.color.getHex(), kleur);
    assert.equal(lijn.material.opacity, 0.85);
    assert.equal(lijn.material.transparent, true);
    assert.equal(lijn.material.userData.openFem3dStreepStip, true);
    assert.equal(lijn.userData.openFem3dStreepStip, true);
  }
  assert.deepEqual([L.OPEN_FEM_3D_STRAMIEN_KLEUR, L.OPEN_FEM_3D_STRAMIEN_LEVEL_KLEUR], [0x7c8da0, 0x94a3b8], "kleuren van vóór #103");
  assert.equal(L.maakOpenFem3DStramienLijnen([], 0x7c8da0), null, "geen lijnstukken: niets");
});
await check("lijnafstand per lijnstuk vanaf 0 (elke lijn begint met een streep), in meters", () => {
  const p = [[0, -1, 0], [0, 5, 0], [6, -1, 0], [6, 5, 0], [-1, 0, 0], [7, 0, 0], [-1, -1, 3], [7, -1, 3]].map((q) => new THREE.Vector3(...q));
  const lijn = L.maakOpenFem3DStramienLijnen(p, 0x7c8da0);
  assert.deepEqual([...lijn.geometry.getAttribute("lineDistance").array], [0, 6, 0, 6, 0, 8, 0, 8]);
  assert.equal(lijn.geometry.getAttribute("position").count, 8);
});
const renderer = (hoogte) => ({ getSize: (v) => v.set(1000, hoogte) });
await check("parallel: schaal = pixels per meter; tweemaal inzoomen = tweemaal zoveel, het patroon blijft 26 px", () => {
  const lijn = L.maakOpenFem3DStramienLijnen([new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)], 0x7c8da0);
  const scene = new THREE.Scene();
  const doel = new THREE.Vector3(5, 0, 0);
  L.openFem3DStramienCameraDoel(scene, doel);
  const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, 0.1, 100);
  lijn.onBeforeRender(renderer(650), scene, camera, lijn.geometry, lijn.material, null);
  bijna(lijn.material.scale, 650 / 10, 1e-9, "650 px over 10 m");
  camera.zoom = 2;
  lijn.onBeforeRender(renderer(650), scene, camera, lijn.geometry, lijn.material, null);
  bijna(lijn.material.scale, 130, 1e-9, "ingezoomd");
  // Eén periode in meters × pixels per meter = 26 px, bij elke zoom.
  for (const zoom of [0.05, 0.5, 1, 4, 40]) {
    camera.zoom = zoom;
    lijn.onBeforeRender(renderer(650), scene, camera, lijn.geometry, lijn.material, null);
    const periodeM = (lijn.material.dashSize + lijn.material.gapSize) / lijn.material.scale;
    bijna(periodeM * lijn.material.scale, 26, 1e-9, `zoom ${zoom}`);
    bijna(periodeM, 26 * 10 / (650 * zoom), 1e-12, `periode in m bij zoom ${zoom}`);
  }
});
await check("perspectief: gemeten bij het draaipunt (dat ter plekke meeschuift); half zo ver = tweemaal zoveel", () => {
  const lijn = L.maakOpenFem3DStramienLijnen([new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)], 0x7c8da0);
  const scene = new THREE.Scene();
  const doel = new THREE.Vector3(5, 0, 0);
  L.openFem3DStramienCameraDoel(scene, doel);
  const camera = new THREE.PerspectiveCamera(50, 1000 / 650, 0.1, 1000);
  camera.position.set(5, -20, 0);
  const verwacht = (d) => 650 / (2 * d * Math.tan(THREE.MathUtils.degToRad(25)));
  lijn.onBeforeRender(renderer(650), scene, camera, lijn.geometry, lijn.material, null);
  bijna(lijn.material.scale, verwacht(20), 1e-9, "20 m");
  camera.position.set(5, -10, 0);
  lijn.onBeforeRender(renderer(650), scene, camera, lijn.geometry, lijn.material, null);
  bijna(lijn.material.scale, verwacht(10), 1e-9, "10 m");
  doel.set(5, 10, 0);
  lijn.onBeforeRender(renderer(650), scene, camera, lijn.geometry, lijn.material, null);
  bijna(lijn.material.scale, verwacht(20), 1e-9, "het draaipunt verschoven: weer 20 m");
});
await check("zonder draaipunt in de scène: gemeten bij het midden van de lijn zelf", () => {
  const lijn = L.maakOpenFem3DStramienLijnen([new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)], 0x7c8da0);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(5, -10, 0);
  lijn.onBeforeRender(renderer(500), new THREE.Scene(), camera, lijn.geometry, lijn.material, null);
  bijna(lijn.material.scale, 500 / (2 * 10 * Math.tan(THREE.MathUtils.degToRad(25))), 1e-9, "midden (5; 0; 0)");
});

console.log("\n[5] SECTION BOX");
await check("de doos knipt het model, het stramien (streep-stip) niet; uit haalt de vlakken weg", () => {
  const scene = new THREE.Scene();
  const beeld = Beeld.createOpenFem3DSectionBoxBeeld();
  scene.add(beeld.group);
  const model = new THREE.Group();
  const staaf = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  model.add(staaf);
  const stramien = new THREE.Group();
  stramien.userData.openFem3dStructuralGrid = true;
  const basis = L.maakOpenFem3DStramienLijnen([new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 5, 0)], L.OPEN_FEM_3D_STRAMIEN_KLEUR);
  const levels = L.maakOpenFem3DStramienLijnen([new THREE.Vector3(-1, -1, 3), new THREE.Vector3(7, -1, 3)], L.OPEN_FEM_3D_STRAMIEN_LEVEL_KLEUR);
  stramien.add(basis, levels);
  model.add(stramien);
  scene.add(model);
  beeld.zet({ min: [2, 0.5, -0.5], max: [4, 3.5, 4] });
  Beeld.openFem3DSectionBoxKnipMaterialen(scene, beeld.vlakken);
  assert.equal(staaf.material.clippingPlanes, beeld.vlakken, "het model geknipt");
  for (const lijn of [basis, levels]) assert.ok(!lijn.material.clippingPlanes?.length, "het stramien heel");
  Beeld.openFem3DSectionBoxKnipMaterialen(scene, null);
  assert.equal(staaf.material.clippingPlanes, null, "uit: weg");
  beeld.dispose();
});

console.log("\n[6] TEKENVLAK");
await check("ThreeFrameCanvas tekent stramienassen en levelrechthoeken via de module, met het draaipunt van de camera", () => {
  const tsx = bron("./src/components/openFem3d/ThreeFrameCanvas.tsx");
  assert.ok(!/addDashedSegments/.test(tsx), "de oude streeplijn is weg");
  assert.ok(!/dashSize: 0\.22, gapSize: 0\.12/.test(tsx), "geen wereldmaat-streep meer voor het stramien");
  assert.match(tsx, /addStramienSegments\(group, baseSegments\);/);
  assert.match(tsx, /addStramienSegments\(group, levelSegments, OPEN_FEM_3D_STRAMIEN_LEVEL_KLEUR\);/);
  assert.match(tsx, /maakOpenFem3DStramienLijnen\(points, color\)/);
  assert.match(tsx, /openFem3DStramienCameraDoel\(scene, controls\.target\);/);
});
await check("de andere stippellijnen blijven zoals ze waren (verborgen staven, nullijnen, spoorlijnen, opgetilde bedding)", () => {
  const tsx = bron("./src/components/openFem3d/ThreeFrameCanvas.tsx");
  assert.match(tsx, /color: 0x6b7280, dashSize: 0\.16, gapSize: 0\.12/, "trek-alleen staven buiten de uitkomst");
  assert.equal((tsx.match(/dashSize: 0\.18, gapSize: 0\.1, opacity: 0\.55/g) ?? []).length, 2, "nullijnen van de snedekrachten");
  assert.match(tsx, /streep\.dashSize = 6 \* wereldPerPixel;\s*streep\.gapSize = 4 \* wereldPerPixel;/, "spoorlijnen (#84)");
  assert.match(tsx, /color: 0x64748b, dashSize: 0\.12, gapSize: 0\.08/, "opgetilde bedding");
  assert.equal((tsx.match(/maakOpenFem3DStramienLijnen\(/g) ?? []).length, 1, "alleen het stramien gebruikt het streep-stip");
});

console.log("\n[7] RAPPORT");
await check("rapportfiguren: stramienassen (verticaal) en niveaus (horizontaal) streep-stip, kleur en dikte als voorheen", () => {
  const nodes = [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }, { id: 3, x: 6000, z: 3500 }, { id: 4, x: 0, z: 3500 }];
  const tr = buildSchemaTransform(nodes, { left: 80, right: 40, top: 80, bottom: 40 });
  const grid = {
    enabled: true,
    xAxes: [{ id: "a", label: "A", position: 0 }, { id: "b", label: "B", position: 6000 }],
    zAxes: [{ id: "0", label: "", position: 0 }, { id: "1", label: "", position: 3500 }],
  };
  const groepen = renderGridAxisLines(grid, tr);
  assert.equal(groepen.length, 4, "twee assen en twee niveaus");
  for (const g of groepen) {
    const lijn = [g.props.children].flat().find((k) => k?.type === "line");
    assert.ok(lijn, `lijn in ${g.key}`);
    const [streep, tussen, stip, tussen2] = String(lijn.props.strokeDasharray).split(/\s+/).map(Number);
    assert.ok(streep >= 3 * stip && tussen === tussen2 && stip <= tussen && tussen < streep, `${g.key}: streep-stip (${lijn.props.strokeDasharray})`);
    assert.equal(lijn.props.stroke, "#8a8a8a", `${g.key}: kleur`);
    assert.equal(lijn.props.strokeWidth, 1.2, `${g.key}: dikte`);
  }
  assert.deepEqual(renderGridAxisLines({ ...grid, enabled: false }, tr), [], "stramien uit: niets");
});

console.log("\n[8] BEDRADING");
await check("de batterij draait deze test en de browserproef (op de bron)", () => {
  const runner = bron("./scripts/run-tests.mjs");
  assert.ok(/\["stramien-streepstip",/.test(runner), "stramien-streepstip niet geregistreerd in run-tests.mjs");
  assert.ok(/\["stramien-streepstip-ui",/.test(runner), "stramien-streepstip-ui niet geregistreerd in run-tests.mjs");
});

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
if (gefaald > 0) process.exit(1);
