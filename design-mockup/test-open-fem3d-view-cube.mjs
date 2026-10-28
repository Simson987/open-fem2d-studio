// View cube in het 3D-tekenvlak (issue #85): de 26 doelen (vlakken, ribben,
// hoeken), de up-regel, de lintconventie (Boven = bovenaanzicht, Voor = −Y =
// vooraanzicht, Rechts = +X = zijaanzicht), de iso-richting vanaf
// Voor-Rechts (één constante voor lint, startcamera, rapportbeeld en kubus),
// de CSS-matrix die de kubus met de camera laat meedraaien, het slepen om het
// doel (ook vanaf de pool, met de echte OrbitControls), de namen op dak en
// vloer, welke doelen naar de kijker wijzen en het maaiveld.
//
// Uitvoeren: npx tsx test-open-fem3d-view-cube.mjs
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
const {
  OPEN_FEM_3D_VIEW_CUBE_DOELEN, OPEN_FEM_3D_VIEW_CUBE_VLAKKEN, OPEN_FEM_3D_VIEW_CUBE_NORMAAL,
  OPEN_FEM_3D_VIEW_CUBE_MAX_ELEVATIE, OPEN_FEM_3D_VIEW_CUBE_POOL_MARGE, OPEN_FEM_3D_VIEW_CUBE_ZICHTBAAR_VANAF,
  OPEN_FEM_3D_ISO_RICHTING, openFem3DStartCamera,
  openFem3DAanzichtRichting, openFem3DViewCubeUp, openFem3DViewCubeDoel, openFem3DViewCubeCellen,
  openFem3DViewCubeVlakAssen, openFem3DViewCubeCameraAssen, openFem3DViewCubeMatrix, openFem3DViewCubeVlakMatrix,
  openFem3DViewCubeMaal, openFem3DViewCubePunt, openFem3DViewCubeLokaal, openFem3DViewCubeCss,
  openFem3DViewCubeDraai, openFem3DViewCubeSleepHoeken, openFem3DViewCubeNaamHoek, openFem3DViewCubeMaaiveldMatrix,
  openFem3DViewCubeNaamRek, openFem3DViewCubeNaamTransform,
  openFem3DViewCubeNaarKijker, openFem3DViewCubeZichtbaarVlak, openFem3DViewCubeZichtbareDoelen,
} = await import("./src/components/openFem3d/openFem3dViewCube.ts");
const { openFem3DViewFromCamera } = await import("./src/components/openFem3d/openFem3dViewSets.ts");
const { openFem3DKijkAssen } = await import("./src/components/openFem3d/openFem3dRapportBeeld.ts");

let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };
const dichtbij = (a, b, tol = 1e-9) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const tekst = (v) => `(${v.map((x) => Number(x.toFixed(6))).join(", ")})`;
const lengte = (v) => Math.hypot(...v);
const schaal = (v, s) => v.map((x) => x * s);
const punt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Richting (zonder verschuiving) door een matrix in kolomvolgorde. */
const richtingDoor = (m, v) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2]);
const det3 = (m) => {
  const [a, b, c, , d, e, f, , g, h, i] = m;
  return a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
};
const HALF = 27;

log("[1] de 26 doelen");
{
  const doelen = OPEN_FEM_3D_VIEW_CUBE_DOELEN;
  check("26 doelen", doelen.length === 26, String(doelen.length));
  check("26 unieke id's", new Set(doelen.map((d) => d.id)).size === 26);
  check("26 unieke richtingen", new Set(doelen.map((d) => d.som.join(","))).size === 26);
  const telling = (soort) => doelen.filter((d) => d.soort === soort).length;
  check("6 vlakken, 12 ribben, 8 hoeken", telling("vlak") === 6 && telling("ribbe") === 12 && telling("hoek") === 8,
    `${telling("vlak")}/${telling("ribbe")}/${telling("hoek")}`);
  check("soort = aantal vlakken (1, 2 of 3)", doelen.every((d) => d.vlakken.length === { vlak: 1, ribbe: 2, hoek: 3 }[d.soort]));
  check("som = som van de vlaknormalen", doelen.every((d) => dichtbij(d.som,
    d.vlakken.map((v) => OPEN_FEM_3D_VIEW_CUBE_NORMAAL[v]).reduce((a, n) => a.map((x, i) => x + n[i]), [0, 0, 0]))));
  check("richting = genormaliseerde som", doelen.every((d) => dichtbij(d.richting, schaal(d.som, 1 / lengte(d.som)), 1e-12)));
  check("eerst de vlakken, dan de ribben, dan de hoeken",
    doelen.slice(0, 6).every((d) => d.soort === "vlak") && doelen.slice(6, 18).every((d) => d.soort === "ribbe"));
  check("vlakken in de vaste volgorde", doelen.slice(0, 6).map((d) => d.vlakken[0]).join() === OPEN_FEM_3D_VIEW_CUBE_VLAKKEN.join(),
    doelen.slice(0, 6).map((d) => d.vlakken[0]).join());
  const hoek = openFem3DViewCubeDoel("+x-y+z");
  check("hoek +x-y+z: Voor, Rechts, Boven; richting (1, −1, 1)/√3",
    hoek?.soort === "hoek" && hoek.vlakken.join() === "voor,rechts,boven" && dichtbij(hoek.richting, schaal([1, -1, 1], 1 / Math.sqrt(3)), 1e-12),
    JSON.stringify(hoek));
  const ribbe = openFem3DViewCubeDoel("-y+z");
  check("ribbe -y+z: Voor, Boven", ribbe?.soort === "ribbe" && ribbe.vlakken.join() === "voor,boven");
}

log("\n[2] lintconventie en up-regel");
{
  const vlak = (naam) => OPEN_FEM_3D_VIEW_CUBE_DOELEN.find((d) => d.soort === "vlak" && d.vlakken[0] === naam);
  for (const [naam, view] of [["boven", "top"], ["voor", "front"], ["rechts", "side"]]) {
    const lint = openFem3DAanzichtRichting(view);
    check(`vlak ${naam} = lintknop ${view}: richting ${tekst(lint.richting)}, up ${tekst(lint.up)}`,
      dichtbij(vlak(naam).richting, lint.richting) && dichtbij(vlak(naam).up, lint.up),
      `${tekst(vlak(naam).richting)} / ${tekst(vlak(naam).up)}`);
    check(`vlak ${naam} wordt herkend als aanzicht ${view}`, openFem3DViewFromCamera(
      { x: lint.richting[0] * 10, y: lint.richting[1] * 10, z: lint.richting[2] * 10 }, { x: 0, y: 0, z: 0 }) === view);
  }
  check("Voor kijkt vanaf −Y, Rechts vanaf +X, Boven vanaf +Z",
    dichtbij(vlak("voor").richting, [0, -1, 0]) && dichtbij(vlak("rechts").richting, [1, 0, 0]) && dichtbij(vlak("boven").richting, [0, 0, 1]));
  check("Onder: (0, 0, −1) met Y omhoog", dichtbij(vlak("onder").richting, [0, 0, -1]) && dichtbij(vlak("onder").up, [0, 1, 0]));
  check("Achter (+Y) en Links (−X) met Z omhoog",
    dichtbij(vlak("achter").richting, [0, 1, 0]) && dichtbij(vlak("achter").up, [0, 0, 1])
    && dichtbij(vlak("links").richting, [-1, 0, 0]) && dichtbij(vlak("links").up, [0, 0, 1]));
  // Iso vanaf Voor-Rechts (issue #85): (1,4; −1,4; 1), één constante.
  check("iso uit het lint: (1,4; −1,4; 1) genormaliseerd, Z omhoog",
    dichtbij(openFem3DAanzichtRichting("iso").richting, schaal([1.4, -1.4, 1], 1 / Math.hypot(1.4, -1.4, 1)), 1e-12)
    && dichtbij(openFem3DAanzichtRichting("iso").up, [0, 0, 1]));
  check("de iso-constante is (1,4; −1,4; 1)", dichtbij(OPEN_FEM_3D_ISO_RICHTING, [1.4, -1.4, 1]));
  const start = openFem3DStartCamera();
  check("startcamera: 6 × de iso-constante van de oorsprong, Z omhoog",
    dichtbij(start.position, schaal([1.4, -1.4, 1], 6), 1e-12) && dichtbij(start.target, [0, 0, 0]) && dichtbij(start.up, [0, 0, 1]),
    JSON.stringify(start));
  check("de startcamera is een iso-aanzicht", openFem3DViewFromCamera(
    { x: start.position[0], y: start.position[1], z: start.position[2] }, { x: 0, y: 0, z: 0 }) === "iso");
  check("startcamera: telkens een nieuw object", openFem3DStartCamera() !== openFem3DStartCamera()
    && openFem3DStartCamera().position !== openFem3DStartCamera().position);
  // Het iso-rapportbeeld kijkt langs dezelfde constante: zijn schermassen
  // zijn die van een camera in de iso-richting met Z omhoog.
  const rapport = openFem3DKijkAssen("iso", null);
  const isoAssen = openFem3DViewCubeCameraAssen(schaal(openFem3DAanzichtRichting("iso").richting, 10), [0, 0, 0], [0, 0, 1]);
  check("rapportbeeld iso: dezelfde schermassen als de iso-camera",
    dichtbij(rapport.rechts, isoAssen.rechts, 1e-12) && dichtbij(rapport.boven, isoAssen.boven, 1e-12),
    `${tekst(rapport.rechts)} ${tekst(rapport.boven)}`);
  for (const view of ["top", "front", "side"]) {
    const r = openFem3DKijkAssen(view, null);
    const { richting, up } = openFem3DAanzichtRichting(view);
    const a = openFem3DViewCubeCameraAssen(schaal(richting, 10), [0, 0, 0], up);
    check(`rapportbeeld ${view}: dezelfde schermassen als het lint`, dichtbij(r.rechts, a.rechts, 1e-12) && dichtbij(r.boven, a.boven, 1e-12));
  }
  check("up = (0, 1, 0) precies voor ±Z, anders (0, 0, 1)", OPEN_FEM_3D_VIEW_CUBE_DOELEN.every((d) =>
    dichtbij(d.up, d.som[0] === 0 && d.som[1] === 0 ? [0, 1, 0] : [0, 0, 1])));
  check("up nooit evenwijdig aan de kijkrichting", OPEN_FEM_3D_VIEW_CUBE_DOELEN.every((d) => Math.abs(punt(d.up, d.richting)) < 0.99));
  check("up-regel ook voor een vrije richting", dichtbij(openFem3DViewCubeUp([0, 0, -3]), [0, 1, 0]) && dichtbij(openFem3DViewCubeUp([0.2, 0, 3]), [0, 0, 1]));
}

log("\n[3] cellen op de vlakken");
{
  const keer = new Map();
  for (const vlak of OPEN_FEM_3D_VIEW_CUBE_VLAKKEN) {
    const cellen = openFem3DViewCubeCellen(vlak);
    check(`${vlak}: 9 cellen, midden = het vlak zelf`, cellen.length === 9
      && cellen.find((c) => c.rij === 1 && c.kolom === 1).doel.id === openFem3DViewCubeDoel(OPEN_FEM_3D_VIEW_CUBE_DOELEN.find((d) => d.vlakken[0] === vlak && d.soort === "vlak").id).id);
    check(`${vlak}: elke cel hoort bij een doel dat dit vlak bevat`, cellen.every((c) => c.doel && c.doel.vlakken.includes(vlak)));
    for (const cel of cellen) keer.set(cel.doel.id, (keer.get(cel.doel.id) ?? 0) + 1);
  }
  check("alle 26 doelen op de kubus", keer.size === 26);
  check("vlak 1×, ribbe op 2 vlakken, hoek op 3", OPEN_FEM_3D_VIEW_CUBE_DOELEN.every((d) =>
    keer.get(d.id) === { vlak: 1, ribbe: 2, hoek: 3 }[d.soort]));
  const boven = openFem3DViewCubeCellen("boven");
  const cel = (rij, kolom) => boven.find((c) => c.rij === rij && c.kolom === kolom).doel.id;
  check("Boven zoals het bovenaanzicht: bovenrand = Achter (+Y), rechterrand = Rechts (+X)",
    cel(0, 1) === "+y+z" && cel(1, 2) === "+x+z" && cel(2, 1) === "-y+z" && cel(0, 2) === "+x+y+z", [cel(0, 1), cel(1, 2), cel(2, 1), cel(0, 2)].join(" "));
  const voor = openFem3DViewCubeCellen("voor");
  const celVoor = (rij, kolom) => voor.find((c) => c.rij === rij && c.kolom === kolom).doel.id;
  check("Voor zoals het vooraanzicht: bovenrand = Boven, rechterrand = Rechts",
    celVoor(0, 1) === "-y+z" && celVoor(1, 2) === "+x-y" && celVoor(2, 0) === "-x-y-z");
  check("assen per vlak rechtshandig: rechts × boven = normaal", OPEN_FEM_3D_VIEW_CUBE_VLAKKEN.every((vlak) => {
    const { normaal, rechts, boven: b } = openFem3DViewCubeVlakAssen(vlak);
    const k = [rechts[1] * b[2] - rechts[2] * b[1], rechts[2] * b[0] - rechts[0] * b[2], rechts[0] * b[1] - rechts[1] * b[0]];
    return dichtbij(k, normaal);
  }));
}

log("\n[4] CSS-matrix: de kubus volgt de camera");
{
  // Een Three-camera in een willekeurige stand: de kubusmatrix zet een
  // wereldrichting w op het scherm als de cameracoördinaten van w met y
  // omgekeerd (CSS: y omlaag). Dat is de inverse van de camerarotatie.
  const camera = new THREE.PerspectiveCamera(50, 1.4, 0.1, 1000);
  camera.up.set(0, 0, 1);
  camera.position.set(-7, 4, 5);
  camera.lookAt(1, 2, -1);
  const e = new THREE.Matrix4().makeRotationFromQuaternion(camera.quaternion).elements;
  const assen = { rechts: [e[0], e[1], e[2]], boven: [e[4], e[5], e[6]], achter: [e[8], e[9], e[10]] };
  const m = openFem3DViewCubeMatrix(assen);
  const omgekeerd = camera.quaternion.clone().invert();
  let fout = 0;
  for (const w of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.3, -0.8, 0.52]]) {
    const cam = new THREE.Vector3(...w).applyQuaternion(omgekeerd);
    fout = Math.max(fout, ...richtingDoor(m, openFem3DViewCubeLokaal(w)).map((v, i) => Math.abs(v - [cam.x, -cam.y, cam.z][i])));
  }
  check("wereldrichting → (x, −y, z) in camera-assen", fout < 1e-12, String(fout));
  check("kubusmatrix is een echte rotatie (det +1)", Math.abs(det3(m) - 1) < 1e-12, String(det3(m)));
  check("vlakmatrices zijn echte rotaties (det +1)", OPEN_FEM_3D_VIEW_CUBE_VLAKKEN.every((v) => Math.abs(det3(openFem3DViewCubeVlakMatrix(v, HALF)) - 1) < 1e-12));
  const lookAt = openFem3DViewCubeCameraAssen([-7, 4, 5], [1, 2, -1], [0, 0, 1]);
  check("camera-assen uit positie, doel en up = Three.js lookAt",
    dichtbij(lookAt.rechts, assen.rechts, 1e-12) && dichtbij(lookAt.boven, assen.boven, 1e-12) && dichtbij(lookAt.achter, assen.achter, 1e-12));
  const css = openFem3DViewCubeCss(m);
  check("matrix3d met 16 getallen, zonder exponent", /^matrix3d\((-?\d+\.\d{6},){15}-?\d+\.\d{6}\)$/.test(css), css);
  check("CSS-tekst: −0 wordt 0", !openFem3DViewCubeCss([-0, -1e-9, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]).includes("-0.000000"));

  for (const [view, vlak] of [["top", "boven"], ["front", "voor"], ["side", "rechts"]]) {
    const { richting, up } = openFem3DAanzichtRichting(view);
    const mCam = openFem3DViewCubeMatrix(openFem3DViewCubeCameraAssen(schaal(richting, 12), [0, 0, 0], up));
    const samen = openFem3DViewCubeMaal(mCam, openFem3DViewCubeVlakMatrix(vlak, HALF));
    check(`${view}: vlak ${vlak} wijst naar de kijker`, dichtbij(richtingDoor(samen, [0, 0, 1]), [0, 0, 1], 1e-12), tekst(richtingDoor(samen, [0, 0, 1])));
    check(`${view}: de naam op ${vlak} staat rechtop en leest van links naar rechts`,
      dichtbij(richtingDoor(samen, [0, -1, 0]), [0, -1, 0], 1e-12) && dichtbij(richtingDoor(samen, [1, 0, 0]), [1, 0, 0], 1e-12));
    check(`${view}: het midden van ${vlak} ligt een halve ribbe naar voren`, dichtbij(openFem3DViewCubePunt(samen, [0, 0, 0]), [0, 0, HALF], 1e-9));
    const anderen = OPEN_FEM_3D_VIEW_CUBE_VLAKKEN.filter((v) => v !== vlak).map((v) =>
      richtingDoor(openFem3DViewCubeMaal(mCam, openFem3DViewCubeVlakMatrix(v, HALF)), [0, 0, 1])[2]);
    check(`${view}: de andere vlakken staan op hun kant of van de kijker af`, anderen.every((z) => z < 1e-12), anderen.map((z) => z.toFixed(3)).join(" "));
  }
  {
    const { richting, up } = openFem3DAanzichtRichting("iso");
    const mCam = openFem3DViewCubeMatrix(openFem3DViewCubeCameraAssen(schaal(richting, 12), [0, 0, 0], up));
    const hoeken = OPEN_FEM_3D_VIEW_CUBE_DOELEN.filter((d) => d.soort === "hoek").map((d) => ({
      id: d.id, z: openFem3DViewCubePunt(mCam, openFem3DViewCubeLokaal(schaal(d.som, HALF)))[2],
    })).sort((a, b) => b.z - a.z);
    // Iso vanaf Voor-Rechts: de hoek Voor-Rechts-Dak (+x−y+z) staat vooraan.
    check("iso: de hoek +x-y+z wijst naar de kijker (het dichtst bij)", hoeken[0].id === "+x-y+z" && hoeken[0].z > hoeken[1].z + 1,
      hoeken.slice(0, 2).map((h) => `${h.id} ${h.z.toFixed(2)}`).join(", "));
    const zichtbaar = OPEN_FEM_3D_VIEW_CUBE_VLAKKEN.filter((v) =>
      richtingDoor(openFem3DViewCubeMaal(mCam, openFem3DViewCubeVlakMatrix(v, HALF)), [0, 0, 1])[2] > 0);
    check("iso: zichtbaar zijn het dak (Boven), Voor en Rechts", zichtbaar.sort().join() === "boven,rechts,voor", zichtbaar.join());
    const bovenOp = richtingDoor(mCam, openFem3DViewCubeLokaal([0, 0, 1]));
    check("iso: wereld-Z wijst op het scherm omhoog (CSS-y negatief, geen x)", bovenOp[1] < -0.5 && Math.abs(bovenOp[0]) < 1e-12, tekst(bovenOp));
  }
  {
    // Een hoek van de kubus: na een klik kijkt de camera langs de som van de normalen.
    const doel = openFem3DViewCubeDoel("-x-y+z");
    const mCam = openFem3DViewCubeMatrix(openFem3DViewCubeCameraAssen(schaal(doel.richting, 9), [0, 0, 0], doel.up));
    const z = openFem3DViewCubePunt(mCam, openFem3DViewCubeLokaal(schaal(doel.som, HALF)))[2];
    check("hoek -x-y+z na een klik: die hoek recht naar de kijker", Math.abs(z - HALF * Math.sqrt(3)) < 1e-9, z.toFixed(4));
  }
}

log("\n[5] slepen: azimut om Z, begrensde elevatie");
{
  const offset = [10, 0, 0];
  const naRechts = openFem3DViewCubeDraai(offset, [0, 0, 1], -Math.PI / 2, 0);
  check("azimut −90° vanaf +X: camera naar −Y, zelfde hoogte en afstand", dichtbij(naRechts, [0, -10, 0], 1e-9), tekst(naRechts));
  const hoger = openFem3DViewCubeDraai([10, 0, 0], [0, 0, 1], 0, Math.PI / 6);
  check("elevatie +30°", dichtbij(hoger, [10 * Math.cos(Math.PI / 6), 0, 5], 1e-9), tekst(hoger));
  const pool = openFem3DViewCubeDraai([3, 4, 5], [0, 0, 1], 0.3, 5);
  const elevatie = Math.atan2(pool[2], Math.hypot(pool[0], pool[1]));
  check("niet over de pool: elevatie begrensd", Math.abs(elevatie - OPEN_FEM_3D_VIEW_CUBE_MAX_ELEVATIE) < 1e-9 && Math.abs(lengte(pool) - lengte([3, 4, 5])) < 1e-9,
    `${(elevatie * 180 / Math.PI).toFixed(3)}°`);
  const onder = openFem3DViewCubeDraai([3, 4, -5], [0, 0, 1], 0, -5);
  check("ook onderaan begrensd", Math.abs(Math.atan2(onder[2], Math.hypot(onder[0], onder[1])) + OPEN_FEM_3D_VIEW_CUBE_MAX_ELEVATIE) < 1e-9);
  check("vlak bij de pool herkent het tekenvlak het bovenaanzicht", openFem3DViewFromCamera({ x: pool[0], y: pool[1], z: pool[2] }, { x: 0, y: 0, z: 0 }) === "top");
  // Bovenaanzicht (Y omhoog): de draai gaat verder met Z omhoog zonder sprong
  // in het beeld: de camera komt aan de −Y-kant, dan blijft +Y boven.
  const vanBoven = openFem3DViewCubeDraai([0, 0, 10], [0, 1, 0], 0, -0.01);
  check("vanuit het bovenaanzicht: camera aan de −Y-kant (Y blijft boven op het scherm)",
    Math.abs(vanBoven[0]) < 1e-9 && vanBoven[1] < 0, tekst(vanBoven));
  const vanOnder = openFem3DViewCubeDraai([0, 0, -10], [0, 1, 0], 0, 0.01);
  check("vanuit het onderaanzicht: camera aan de +Y-kant", Math.abs(vanOnder[0]) < 1e-9 && vanOnder[1] > 0, tekst(vanOnder));
  const assenVanBoven = openFem3DViewCubeCameraAssen(vanBoven, [0, 0, 0], [0, 0, 1]);
  check("en het scherm-boven is nog steeds ≈ +Y", assenVanBoven.boven[1] > 0.99, tekst(assenVanBoven.boven));
  const { dAzimut, dElevatie } = openFem3DViewCubeSleepHoeken(35, -70, 700);
  check("sleephoeken zoals OrbitControls: 2π per tekenvlakhoogte, rechts = azimut omlaag, omlaag = hoger",
    Math.abs(dAzimut + 2 * Math.PI * 35 / 700) < 1e-12 && Math.abs(dElevatie + 2 * Math.PI * 70 / 700) < 1e-12);
}

/** CSS rotate(θ°) in kolomvolgorde (4 × 4). */
const draaiZ = (graden) => {
  const a = graden * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
};
const kubusVanuit = (richting, up = [0, 0, 1]) =>
  openFem3DViewCubeMatrix(openFem3DViewCubeCameraAssen(schaal(richting, 12), [0, 0, 0], up));

log("\n[6] de namen op dak en vloer lezen rechtop in het startaanzicht");
{
  check("gevels: geen draaiing", ["voor", "achter", "links", "rechts"].every((v) => openFem3DViewCubeNaamHoek(v) === 0));
  check("dak −45°, vloer −135° (iso vanaf Voor-Rechts)", openFem3DViewCubeNaamHoek("boven") === -45 && openFem3DViewCubeNaamHoek("onder") === -135,
    `${openFem3DViewCubeNaamHoek("boven")} / ${openFem3DViewCubeNaamHoek("onder")}`);
  const iso = openFem3DAanzichtRichting("iso").richting;
  // Het dak in het startaanzicht; de vloer met dezelfde camera gespiegeld onder het model.
  for (const [vlak, richting] of [["boven", iso], ["onder", [iso[0], iso[1], -iso[2]]]]) {
    const samen = openFem3DViewCubeMaal(openFem3DViewCubeMaal(kubusVanuit(richting), openFem3DViewCubeVlakMatrix(vlak, HALF)),
      draaiZ(openFem3DViewCubeNaamHoek(vlak)));
    const leesRichting = richtingDoor(samen, [1, 0, 0]);
    const tekstOmhoog = richtingDoor(samen, [0, -1, 0]);
    check(`${vlak}: het vlak wijst naar de kijker`, richtingDoor(samen, [0, 0, 1])[2] > 0.3);
    check(`${vlak}: de naam leest horizontaal van links naar rechts`, leesRichting[0] > 0.99 && Math.abs(leesRichting[1]) < 1e-9, tekst(leesRichting));
    check(`${vlak}: de bovenkant van de letters wijst omhoog op het scherm`, tekstOmhoog[1] < -0.3 && Math.abs(tekstOmhoog[0]) < 1e-9, tekst(tekstOmhoog));
  }
  // De oude stand zonder draaiing stond in het startaanzicht scheef en (met de
  // oude iso-richting) ondersteboven: deze proef ziet het verschil.
  const zonder = richtingDoor(openFem3DViewCubeMaal(kubusVanuit(iso), openFem3DViewCubeVlakMatrix("boven", HALF)), [1, 0, 0]);
  check("zonder draaiing leest het dak in het startaanzicht schuin", Math.abs(zonder[1]) > 0.2, tekst(zonder));
  // Op ware grootte: de letterhoogte (lokaal y) verkort in het startaanzicht
  // op dak en vloer met sin(elevatie) ≈ 0,45, op de gevels met cos ≈ 0,89.
  // De rek langs de letterhoogte maakt ze even hoog.
  const schaalY = (k) => [1, 0, 0, 0, 0, k, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const letterHoogte = (vlak, richting, rek = openFem3DViewCubeNaamRek(vlak)) => {
    const m = openFem3DViewCubeMaal(openFem3DViewCubeMaal(openFem3DViewCubeMaal(kubusVanuit(richting),
      openFem3DViewCubeVlakMatrix(vlak, HALF)), draaiZ(openFem3DViewCubeNaamHoek(vlak))), schaalY(rek));
    const v = richtingDoor(m, [0, 1, 0]);
    return Math.hypot(v[0], v[1]);
  };
  check("gevels: geen rek", ["voor", "achter", "links", "rechts"].every((v) => openFem3DViewCubeNaamRek(v) === 1));
  check("dak en vloer: rek 1/tan(elevatie) van het startaanzicht ≈ 1,98",
    ["boven", "onder"].every((v) => Math.abs(openFem3DViewCubeNaamRek(v) - Math.hypot(iso[0], iso[1]) / iso[2]) < 1e-6),
    String(openFem3DViewCubeNaamRek("boven")));
  const gevel = letterHoogte("voor", iso);
  check("opzet: op de gevel Voor verkort de letterhoogte tot cos(elevatie) ≈ 0,89", Math.abs(gevel - 0.8926) < 1e-3, gevel.toFixed(4));
  check("Rechts even hoog als Voor", Math.abs(letterHoogte("rechts", iso) - gevel) < 1e-9);
  for (const [vlak, richting, wat] of [["boven", iso, "dak"], ["onder", [iso[0], iso[1], -iso[2]], "vloer van onderen"]]) {
    const h = letterHoogte(vlak, richting);
    check(`${wat}: de letters even hoog als op de gevels (${h.toFixed(4)})`, Math.abs(h - gevel) < 1e-4);
    check(`${wat}: zonder rek maar ${letterHoogte(vlak, richting, 1).toFixed(3)} (onleesbaar)`, letterHoogte(vlak, richting, 1) < 0.5);
  }
  check("de inline transform: draaiing en rek op het dak, niets op een gevel",
    openFem3DViewCubeNaamTransform("boven") === "rotate(-45deg) scaleY(1.979899)"
    && openFem3DViewCubeNaamTransform("onder") === "rotate(-135deg) scaleY(1.979899)" && openFem3DViewCubeNaamTransform("voor") === "",
    `${openFem3DViewCubeNaamTransform("boven")} | ${openFem3DViewCubeNaamTransform("onder")} | ${openFem3DViewCubeNaamTransform("voor")}`);
}

log("\n[7] welke doelen naar de kijker gericht zijn (toetsenbord)");
{
  const iso = kubusVanuit(openFem3DAanzichtRichting("iso").richting);
  const vlakken = OPEN_FEM_3D_VIEW_CUBE_VLAKKEN.filter((v) => openFem3DViewCubeNaarKijker(iso, v) >= OPEN_FEM_3D_VIEW_CUBE_ZICHTBAAR_VANAF);
  check("iso: dak, Voor en Rechts naar de kijker", vlakken.sort().join() === "boven,rechts,voor", vlakken.join());
  const doelen = openFem3DViewCubeZichtbareDoelen(iso);
  // 3 vlakken, 12 − 3 ribben (tussen twee achterkanten), 8 − 1 hoeken.
  check("iso: 19 doelen te bereiken (3 vlakken, 9 ribben, 7 hoeken)", doelen.length === 19, String(doelen.length));
  check("iso: niets aan de achterkant (Achter, Links, Vloer samen)", !doelen.some((d) => d.vlakken.every((v) => ["achter", "links", "onder"].includes(v))));
  check("iso: de ribbe Voor-Dak het best op Voor of het dak", ["voor", "boven"].includes(openFem3DViewCubeZichtbaarVlak(iso, openFem3DViewCubeDoel("-y+z"))));
  check("iso: de ribbe Achter-Dak alleen op het dak", openFem3DViewCubeZichtbaarVlak(iso, openFem3DViewCubeDoel("+y+z")) === "boven");
  check("iso: Achter is niet te bereiken", openFem3DViewCubeZichtbaarVlak(iso, openFem3DViewCubeDoel("+y")) === null);
  const voor = kubusVanuit([0, -1, 0]);
  const vooraanzicht = openFem3DViewCubeZichtbareDoelen(voor);
  check("vooraanzicht: alleen Voor met zijn 4 ribben en 4 hoeken (vlakken op hun kant tellen niet)",
    vooraanzicht.length === 9 && vooraanzicht.every((d) => d.vlakken.includes("voor")), vooraanzicht.map((d) => d.id).join(" "));
  const onder = kubusVanuit([0, 0, -1], [0, 1, 0]);
  check("onderaanzicht: de vloer en zijn ribben en hoeken", openFem3DViewCubeZichtbareDoelen(onder).every((d) => d.vlakken.includes("onder")));
  check("drempel: een vlak bijna op zijn kant (cos < 0,1) telt niet",
    openFem3DViewCubeZichtbaarVlak(kubusVanuit([Math.sin(0.05), -Math.cos(0.05), 0]), openFem3DViewCubeDoel("+x")) === null);
}

log("\n[8] het maaiveld");
{
  const m = openFem3DViewCubeMaaiveldMatrix(HALF);
  check("een echte rotatie (det +1)", Math.abs(det3(m) - 1) < 1e-12);
  check("in het vlak van de vloer: een halve ribbe onder het midden", dichtbij(openFem3DViewCubePunt(m, [0, 0, 0]), openFem3DViewCubeLokaal([0, 0, -HALF]), 1e-12),
    tekst(openFem3DViewCubePunt(m, [0, 0, 0])));
  check("voorkant naar boven (wereld +Z)", dichtbij(richtingDoor(m, [0, 0, 1]), openFem3DViewCubeLokaal([0, 0, 1]), 1e-12));
  const zicht = (richting, up) => richtingDoor(openFem3DViewCubeMaal(kubusVanuit(richting, up), m), [0, 0, 1])[2];
  check("van boven zichtbaar (iso)", zicht(openFem3DAanzichtRichting("iso").richting) > 0);
  check("van onderen de achterkant: verborgen, de vloer blijft zichtbaar", zicht([0, 0, -1], [0, 1, 0]) < 0
    && zicht([1, -1, -1].map((x) => x / Math.sqrt(3))) < 0);
}

log("\n[9] slepen vanuit Onder of Boven: geen omslag bij welke camera-afstand ook");
{
  // De echte OrbitControls (zonder DOM): een klik op Onder zet de camera recht
  // onder het doel met Y omhoog; controls.update() schuift haar met makeSafe
  // 1e-6 rad opzij. Een kleine sleepstap mag het beeld dan niet omklappen:
  // het scherm-boven blijft ≈ +Y (Onder) of ≈ +Y (Boven).
  check("de poolmarge ligt ruim tussen makeSafe (1e-6) en de sleepgrens (0,002 rad)",
    OPEN_FEM_3D_VIEW_CUBE_POOL_MARGE >= 50 * 1e-6 && OPEN_FEM_3D_VIEW_CUBE_POOL_MARGE <= (Math.PI / 2 - OPEN_FEM_3D_VIEW_CUBE_MAX_ELEVATIE) / 10);
  const proef = (richting, up, afstand, dElevatie) => {
    const camera = new THREE.PerspectiveCamera(50, 1.4, 0.01, 1e6);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera);
    const doel = new THREE.Vector3(0.5, -0.25, 3);
    camera.up.set(...up);
    controls.target.copy(doel);
    camera.position.copy(doel).addScaledVector(new THREE.Vector3(...richting), afstand);
    controls.update();
    const offset = camera.position.clone().sub(controls.target);
    const boven = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const [x, y, z] = openFem3DViewCubeDraai([offset.x, offset.y, offset.z], [boven.x, boven.y, boven.z], 0, dElevatie);
    camera.up.set(0, 0, 1);
    camera.position.set(doel.x + x, doel.y + y, doel.z + z);
    controls.update();
    return new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  };
  for (const [naam, richting, up, dElevatie] of [
    ["Onder", [0, 0, -1], [0, 1, 0], 0.01], ["Boven", [0, 0, 1], [0, 1, 0], -0.01],
  ]) {
    const omgeslagen = [];
    let n = 0;
    for (let e = -3; e <= 5; e += 0.0025) {
      const afstand = 10 ** e;
      n++;
      const boven = proef(richting, up, afstand, dElevatie);
      if (!(boven.y > 0.99)) omgeslagen.push(afstand.toPrecision(4));
    }
    check(`${naam}: ${n} camera-afstanden (1 mm tot 100 km), het scherm-boven blijft +Y`, omgeslagen.length === 0,
      `${omgeslagen.length} keer omgeslagen: ${omgeslagen.slice(0, 5).join(", ")}`);
  }
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);
