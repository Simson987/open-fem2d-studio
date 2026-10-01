// De vervormde vorm in 3D:
//   [1] één doorlopend geveegd profiel per staaf (openFem3dDeformedSweep):
//       geen kopvlakken of naden tussen de stations, gladde normalen langs de
//       kromme, scherpe profielhoeken blijven scherp, oriëntatie als de
//       rechte profielextrusie;
//   [2] de vergroting (automatisch of 1× – 1000× logaritmisch) en "Origineel
//       tonen" (openFem3dDeformationDisplay), onthouden als voorkeur;
//   [3] de bedrading in tekenvlak, verkenner en App, en de teksten in vier talen.
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const opslag = new Map();
globalThis.localStorage = {
  getItem: (k) => (opslag.has(k) ? opslag.get(k) : null),
  setItem: (k, v) => { opslag.set(k, String(v)); },
  removeItem: (k) => { opslag.delete(k); },
};

const { createOpenFem3DSweptProfileGeometry, createOpenFem3DSweptProfilesGeometry } = await import("./src/components/openFem3d/openFem3dDeformedSweep.ts");
const {
  DEFAULT_OPEN_FEM_3D_DEFORMATION_DISPLAY, formatOpenFem3DDeformationScale, openFem3DAutoDeformationScale,
  openFem3DDeformationScale, openFem3DDeformationScaleFromSlider, openFem3DDeformationSliderFromScale,
  readOpenFem3DDeformationDisplay, saveOpenFem3DDeformationDisplay,
} = await import("./src/components/openFem3d/openFem3dDeformationDisplay.ts");
const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");

const HIER = dirname(fileURLToPath(import.meta.url));
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Doorsneden zoals openFem3DProfileSection ze levert: contour in mm rond het
// zwaartepunt. Een I-profiel 100 × 200 (lijf 5,6, flens 8,5; scherpe hoeken)
// en een buis Ø 88,9 × 4.
const iVorm = new THREE.Shape();
const [b, h, tw, tf] = [100, 200, 5.6, 8.5];
[[-b / 2, -h / 2], [b / 2, -h / 2], [b / 2, -h / 2 + tf], [tw / 2, -h / 2 + tf], [tw / 2, h / 2 - tf], [b / 2, h / 2 - tf],
  [b / 2, h / 2], [-b / 2, h / 2], [-b / 2, h / 2 - tf], [-tw / 2, h / 2 - tf], [-tw / 2, -h / 2 + tf], [-b / 2, -h / 2 + tf]]
  .forEach(([x, y], i) => i === 0 ? iVorm.moveTo(x, y) : iVorm.lineTo(x, y));
const iProfiel = { shapes: [iVorm], centroid: new THREE.Vector2(0, 0), widthM: 0.1, heightM: 0.2 };
// Zoals de profieltekening een cirkel schrijft: twee halve bogen.
const buis = new THREE.Shape().absarc(0, 0, 44.45, 0, Math.PI, false).absarc(0, 0, 44.45, Math.PI, Math.PI * 2, false);
buis.holes.push(new THREE.Path().absarc(0, 0, 40.45, 0, Math.PI, true).absarc(0, 0, 40.45, Math.PI, Math.PI * 2, true));
const buisProfiel = { shapes: [buis], centroid: new THREE.Vector2(0, 0), widthM: 0.0889, heightM: 0.0889 };

const standen = (geometry) => {
  const pos = geometry.getAttribute("position"), nor = geometry.getAttribute("normal");
  return Array.from({ length: pos.count }, (_, i) => ({ p: V(pos.getX(i), pos.getY(i), pos.getZ(i)), n: V(nor.getX(i), nor.getY(i), nor.getZ(i)) }));
};

log("[1] één doorlopend geveegd profiel");
{
  const stations = 9;
  const recht = Array.from({ length: stations }, (_, i) => V(6 * i / (stations - 1), 0, 0));
  const g = createOpenFem3DSweptProfileGeometry({ section: iProfiel, points: recht, referenceY: V(0, 1, 0) });
  g.computeBoundingBox();
  const bb = g.boundingBox;
  check("recht: omhullende gelijk aan het rechte profiel (breedte langs y, hoogte langs z)",
    Math.abs(bb.min.x) < 1e-9 && Math.abs(bb.max.x - 6) < 1e-9 && Math.abs(bb.max.y - 0.05) < 1e-7
    && Math.abs(bb.min.y + 0.05) < 1e-7 && Math.abs(bb.max.z - 0.1) < 1e-7 && Math.abs(bb.min.z + 0.1) < 1e-7,
    JSON.stringify([bb.min, bb.max]));
  const v = standen(g);
  const kop = v.filter(({ n }) => Math.abs(Math.abs(n.x) - 1) < 1e-9);
  check("alleen aan de twee staafeinden een kopvlak (geen dwarsvlakken tussen de stations)",
    kop.length > 0 && kop.every(({ p }) => Math.abs(p.x) < 1e-9 || Math.abs(p.x - 6) < 1e-9));
  // 12 scherpe hoeken → 24 ringpunten per station; plus twee kopvlakken van 12 punten.
  check("zijwanden delen hun ringpunten tussen opeenvolgende stations (geen losse stukken)",
    v.length === stations * 24 + 2 * 12, String(v.length));
  const gedraaid = createOpenFem3DSweptProfileGeometry({ section: iProfiel, points: recht, referenceY: V(0, 0, 1) });
  gedraaid.computeBoundingBox();
  check("gedraaide staaf (lokale y = globale z): de breedte ligt langs z",
    Math.abs(gedraaid.boundingBox.max.z - 0.05) < 1e-7 && Math.abs(gedraaid.boundingBox.max.y - 0.1) < 1e-7);
}
{
  // Een doorbuigende ligger: stations op een cirkelboog in het xz-vlak.
  const R = 12, n = 25, hoek = 0.5;
  const boog = Array.from({ length: n }, (_, i) => {
    const a = -hoek / 2 + hoek * i / (n - 1);
    return V(R * Math.sin(a), 0, R * (Math.cos(a) - 1));
  });
  const g = createOpenFem3DSweptProfileGeometry({ section: iProfiel, points: boog, referenceY: V(0, 1, 0) });
  const v = standen(g);
  const slots = 24;
  let maxBuitenVlak = 0, maxSprong = 0;
  for (let k = 0; k < n; k += 1) {
    const vorige = boog[Math.max(0, k - 1)], volgende = boog[Math.min(n - 1, k + 1)];
    const raak = volgende.clone().sub(vorige).normalize();
    for (let s = 0; s < slots; s += 1) {
      const { p, n: normaal } = v[k * slots + s];
      maxBuitenVlak = Math.max(maxBuitenVlak, Math.abs(p.clone().sub(boog[k]).dot(raak)));
      if (k > 0) maxSprong = Math.max(maxSprong, normaal.angleTo(v[(k - 1) * slots + s].n));
    }
  }
  const draaiingPerStap = hoek / (n - 1);
  // Posities staan als 32-bits getallen in de geometrie: ~1 µm bij 12 m.
  check("elke ring ligt loodrecht op de kromme", maxBuitenVlak < 2e-5, String(maxBuitenVlak));
  check("normalen lopen glad mee: per station niet meer dan de bocht zelf", maxSprong <= draaiingPerStap * 1.0001 + 1e-12,
    `${maxSprong} > ${draaiingPerStap}`);
  const kop = v.slice(n * slots);
  check("ook gebogen: alleen de twee eindkopvlakken", kop.length === 24
    && kop.every(({ p }) => p.distanceTo(boog[0]) < 0.12 || p.distanceTo(boog[n - 1]) < 0.12));
}
{
  const recht = [V(0, 0, 0), V(3, 0, 0), V(6, 0, 0)];
  const g = createOpenFem3DSweptProfileGeometry({ section: buisProfiel, points: recht, referenceY: V(0, 1, 0) });
  const v = standen(g);
  const contour = buis.extractPoints(4);
  // Dubbele punten (sluitpunt, de naad tussen twee bogen) tellen niet.
  const uniek = (lus) => lus.filter((p, i) => i === 0 || p.distanceTo(lus[i - 1]) > 1e-9).length - (lus[0].distanceTo(lus.at(-1)) < 1e-9 ? 1 : 0);
  const punten = uniek(contour.shape) + uniek(contour.holes[0]);
  const ring = v.slice(0, v.length / 1).filter(({ n }) => Math.abs(n.x) < 1e-9);
  check("buis: alle ringpunten glad (geen dubbele punten)", ring.length === 3 * punten, `${ring.length} ≠ ${3 * punten}`);
  const buitenOk = ring.filter(({ p }) => Math.hypot(p.y, p.z) > 0.0425).every(({ p, n }) => n.dot(V(0, p.y, p.z).normalize()) > 0.99);
  const binnenOk = ring.filter(({ p }) => Math.hypot(p.y, p.z) < 0.0425).every(({ p, n }) => n.dot(V(0, p.y, p.z).normalize()) < -0.99);
  check("buitenwand naar buiten, binnenwand naar de as", buitenOk && binnenOk);
  const twee = createOpenFem3DSweptProfilesGeometry([
    { section: iProfiel, points: recht, referenceY: V(0, 1, 0) },
    { section: buisProfiel, points: recht.map((p) => p.clone().add(V(0, 2, 0))), referenceY: V(0, 1, 0) },
  ]);
  const los1 = createOpenFem3DSweptProfileGeometry({ section: iProfiel, points: recht, referenceY: V(0, 1, 0) });
  check("alle staven samen in één geometrie (één tekenaanroep)",
    twee.getAttribute("position").count === los1.getAttribute("position").count + g.getAttribute("position").count);
  check("te weinig stations → geen geometrie", createOpenFem3DSweptProfileGeometry({ section: iProfiel, points: [V(0, 0, 0)], referenceY: V(0, 1, 0) }) === null);
}

log("\n[2] vergroting en Origineel tonen");
{
  const model = parseOpenFem3DModel({ nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 10, y: 0, z: 0 }], beams: [{ id: 1, startNodeId: 1, endNodeId: 2 }] });
  const result = {
    displacements: [
      { nodeId: 1, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 },
      { nodeId: 2, ux: 0, uy: 0, uz: -0.02, rx: 0, ry: 0, rz: 0 },
    ],
  };
  const auto = openFem3DAutoDeformationScale(model, result);
  check("automatisch: 12 % van de modelmaat (10 m) gedeeld door de grootste verplaatsing (20 mm) = 60", Math.abs(auto - 60) < 1e-9, String(auto));
  check("automatisch of vast", openFem3DDeformationScale({ scale: "auto", showOriginal: true }, auto) === auto
    && openFem3DDeformationScale({ scale: 25, showOriginal: true }, auto) === 25);
  check("regelaar logaritmisch: 0 → ×1, 100 → ×10, 200 → ×100, 300 → ×1000",
    [0, 100, 200, 300].map(openFem3DDeformationScaleFromSlider).join() === "1,10,100,1000");
  const heen = [1.5, 7, 60, 237, 999].map((f) => openFem3DDeformationScaleFromSlider(openFem3DDeformationSliderFromScale(f)) / f);
  // Eén stand is 2,3 % (10^0,01); afronden op een halve stand plus op mooie cijfers.
  check("factor → stand → factor binnen 1,5 %", heen.every((r) => Math.abs(r - 1) < 0.015), heen.join());
  check("buiten het bereik: aan de rand", openFem3DDeformationSliderFromScale(5000) === 300 && openFem3DDeformationSliderFromScale(0.2) === 0);
  check("leesbare factor", formatOpenFem3DDeformationScale(1.5) === "×1,5" && formatOpenFem3DDeformationScale(24) === "×24"
    && formatOpenFem3DDeformationScale(350) === "×350");
  check("standaard: automatisch, origineel zichtbaar", JSON.stringify(readOpenFem3DDeformationDisplay()) === JSON.stringify(DEFAULT_OPEN_FEM_3D_DEFORMATION_DISPLAY));
  saveOpenFem3DDeformationDisplay({ scale: 40, showOriginal: false });
  check("onthouden als voorkeur", JSON.stringify(readOpenFem3DDeformationDisplay()) === JSON.stringify({ scale: 40, showOriginal: false }));
  opslag.set("open-fem-studio.openFem3d.deformation", JSON.stringify({ scale: 5000, showOriginal: "ja" }));
  check("een onmogelijke waarde uit de opslag wordt begrensd of genegeerd", JSON.stringify(readOpenFem3DDeformationDisplay()) === JSON.stringify({ scale: 1000, showOriginal: true }));
}

log("\n[3] bedrading");
const lees = (...pad) => readFileSync(join(HIER, ...pad), "utf8").replace(/\r\n/g, "\n");
const canvas = lees("src", "components", "openFem3d", "ThreeFrameCanvas.tsx");
check("tekenvlak: vervormde vorm als eigen laag met één geveegde geometrie",
  /function buildDeformedLayer[\s\S]{0,2000}createOpenFem3DSweptProfilesGeometry\(sweeps\)/.test(canvas));
check("… zonder losse rechte profielstukken per station",
  !/deformedProfileBatches/.test(canvas) && !/openFem3DProfileInstanceScale\(length\)[\s\S]{0,200}deformed/.test(canvas));
check("… de vergroting uit de voorkeur (automatisch of vast)",
  /openFem3DDeformationScale\(display, openFem3DAutoDeformationScale\(model, shown\)\)/.test(canvas));
check("… het onvervormde model gewoon, als schim of weg",
  /const mode: OriginalPresentation = !shown \? "normal" : display\.showOriginal \? "ghost" : "hidden";/.test(canvas)
  && /applyOriginalPresentation\(geometry, mode\)/.test(canvas));
const verkenner = lees("src", "components", "openFem3d", "OpenFem3DExplorer.tsx");
check("verkenner: onder Vervormde vorm de regelaar, Automatisch en Origineel tonen",
  /key === "deformation" && props\.visibility\.deformation && props\.setDeformationDisplay[\s\S]{0,300}<DeformationControls/.test(verkenner)
  && /type="range" className="fem-results-scale-slider"/.test(verkenner) && /data-open-fem3d-show-original/.test(verkenner));
const app = lees("src", "App.tsx");
check("App: voorkeur gelezen en bewaard, naar tekenvlak en verkenner",
  /useState\(readOpenFem3DDeformationDisplay\)/.test(app) && /saveOpenFem3DDeformationDisplay\(openFem3dDeformationDisplay\)/.test(app)
  && /deformationDisplay=\{openFem3dDeformationDisplay\}/.test(app) && /setDeformationDisplay=\{setOpenFem3dDeformationDisplay\}/.test(app));
for (const taal of ["nl", "en", "de", "fr"]) {
  const teksten = JSON.parse(readFileSync(join(HIER, "src", "i18n", "locales", taal, "common.json"), "utf8")).openFem3dDeformation ?? {};
  check(`teksten ${taal}`, ["scale", "auto", "scaleHint", "showOriginal", "showOriginalHint"].every((k) => typeof teksten[k] === "string" && teksten[k].length > 0));
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);
