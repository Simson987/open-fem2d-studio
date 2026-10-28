// Momentenlijnen in 3D aan de trekzijde (openFem3dDiagramSide.ts), getoetst
// met een echte berekening door de 3D-kern: een ligger op twee steunpunten
// (6 m, 10 kN/m) buigt door naar de kant van de last, en daar — aan de
// trekzijde — hoort de momentenlijn te liggen.
//   [1] zwaartekracht (lokaal −z): My in het veld positief, de lijn onder de staaf;
//   [2] een last in −y: de lijn aan de −y-kant (Mz negatief, langs +ey);
//   [3] dwarskrachten volgen hun as;
//   [4] in elke richting (±x, ±y, diagonaal, schuin, met rol) ligt de lijn
//       onder de staaf.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";

const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { buildOpenFem3DSolveRequest } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const { openFem3DDiagramDirection } = await import("./src/components/openFem3d/openFem3dDiagramSide.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};

const binary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const kern = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${binary}`, import.meta.url));
if (!existsSync(kern)) {
  console.log(`Bouw eerst de Rust-rekenkern (${kern}) of zet OPEN_FEM_3D_SOLVER_PATH.`);
  process.exit(1);
}

const VRIJ = { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
/** Ligger langs +x op twee steunpunten met één gelijkmatige last; geeft de diagrammen. */
function reken(last) {
  const model = parseOpenFem3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235" }],
    supports: [{ nodeId: 1, ...VRIJ, ux: true, uy: true, uz: true, rx: true }, { nodeId: 2, ...VRIJ, uy: true, uz: true }],
    memberLoads: [{ id: 1, beamId: 1, caseId: 1, qyStart: 0, qyEnd: 0, qzStart: 0, qzEnd: 0, ...last, startPositionM: 0, endPositionM: 6 }],
  });
  const uit = spawnSync(kern, [], { input: JSON.stringify({ ...buildOpenFem3DSolveRequest(model, "linear", 1), bucklingModes: 0 }) });
  if (uit.status !== 0) throw new Error(`3D-kern: exit ${uit.status}; ${uit.stderr.toString().slice(0, 300)}`);
  return JSON.parse(uit.stdout.toString()).diagrams;
}
const inHetMidden = (punten) => punten.reduce((a, b) => (Math.abs(b.t - 0.5) < Math.abs(a.t - 0.5) ? b : a)).value;
// De lokale assen van een horizontale staaf langs +x, zoals het tekenvlak ze neemt.
const assen = { ey: new THREE.Vector3(0, 1, 0), ez: new THREE.Vector3(0, 0, 1) };
/** Waar de lijn in het midden ligt: richting × waarde. */
const uitslag = (component, waarde) => openFem3DDiagramDirection(component, assen).multiplyScalar(waarde);

console.log("[1] zwaartekracht: de momentenlijn onder de staaf");
{
  const d = reken({ qzStart: -10, qzEnd: -10 });
  const my = inHetMidden(d.momentY[0].points);
  check("My in het veld = +qL²/8 = +45 kNm", Math.abs(my - 45) < 1e-6, String(my));
  const punt = uitslag("momentY", my);
  check("de lijn ligt onder de staaf (trekzijde)", punt.z < 0 && Math.abs(punt.y) < 1e-12, punt.toArray().join(", "));
}

console.log("\n[2] een last in −y: de lijn aan de −y-kant");
{
  const d = reken({ qyStart: -10, qyEnd: -10 });
  const mz = inHetMidden(d.momentZ[0].points);
  check("Mz in het veld = −45 kNm", Math.abs(mz + 45) < 1e-6, String(mz));
  const punt = uitslag("momentZ", mz);
  check("de lijn ligt aan de kant waar de staaf naartoe buigt (trekzijde)", punt.y < 0 && Math.abs(punt.z) < 1e-12, punt.toArray().join(", "));
}

console.log("\n[3] dwarskrachten volgen hun as");
check("Vy langs +ey, Vz langs +ez", uitslag("shearY", 1).equals(assen.ey) && uitslag("shearZ", 1).equals(assen.ez));

console.log("\n[4] elke ligger-richting: de lijn onder de staaf bij een last in −Z");
{
  // De asregel van het tekenvlak (memberAxes) en van de kern: lokaal z is
  // globaal Z loodrecht op de staaf geprojecteerd, lokaal y = z × x, daarna de rol.
  const assenVan = (delta, rol) => {
    const ex = delta.clone().normalize();
    const omhoog = Math.abs(ex.z) > 0.999 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const ez = omhoog.addScaledVector(ex, -omhoog.dot(ex)).normalize();
    const ey = new THREE.Vector3().crossVectors(ez, ex).normalize();
    if (rol !== 0) { ey.applyAxisAngle(ex, rol); ez.applyAxisAngle(ex, rol); }
    return { ey, ez };
  };
  const gevallen = [
    ["langs −x", [6, 0, 0], [0, 0, 0], 0],
    ["langs +y", [0, 0, 0], [0, 6, 0], 0],
    ["langs −y", [0, 6, 0], [0, 0, 0], 0],
    ["diagonaal", [0, 0, 0], [4, 3, 0], 0],
    ["spant schuin omhoog", [0, 0, 0], [6, 0, 1], 0],
    ["spant schuin omlaag", [6, 0, 1], [0, 0, 0], 0],
    ["langs +x, rol 90°", [0, 0, 0], [6, 0, 0], Math.PI / 2],
    ["langs +x, rol 180°", [0, 0, 0], [6, 0, 0], Math.PI],
  ];
  for (const [naam, [xa, ya, za], [xb, yb, zb], rol] of gevallen) {
    const delta = new THREE.Vector3(xb - xa, yb - ya, zb - za);
    const as = assenVan(delta, rol);
    const g = new THREE.Vector3(0, 0, -10);
    const qy = g.dot(as.ey), qz = g.dot(as.ez);
    // Torsie vastzetten om de globale as waar de staaf het meest langs loopt.
    const torsie = Math.abs(delta.y) > Math.abs(delta.x) ? { ry: true } : { rx: true };
    const model = parseOpenFem3DModel({
      nodes: [{ id: 1, x: xa, y: ya, z: za }, { id: 2, x: xb, y: yb, z: zb }],
      beams: [{ id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE 300", material: "S235", rollAngleRad: rol }],
      supports: [{ nodeId: 1, ...VRIJ, ux: true, uy: true, uz: true, ...torsie }, { nodeId: 2, ...VRIJ, ux: true, uy: true, uz: true }],
      memberLoads: [{ id: 1, beamId: 1, caseId: 1, qyStart: qy, qyEnd: qy, qzStart: qz, qzEnd: qz, startPositionM: 0, endPositionM: delta.length() }],
    });
    const uit = spawnSync(kern, [], { input: JSON.stringify({ ...buildOpenFem3DSolveRequest(model, "linear", 1), bucklingModes: 0 }) });
    if (uit.status !== 0) { check(naam, false, `3D-kern: exit ${uit.status}`); continue; }
    const d = JSON.parse(uit.stdout.toString()).diagrams;
    const punt = openFem3DDiagramDirection("momentY", as).multiplyScalar(inHetMidden(d.momentY[0].points))
      .add(openFem3DDiagramDirection("momentZ", as).multiplyScalar(inHetMidden(d.momentZ[0].points)));
    check(`${naam}: de lijn ligt onder de staaf`, punt.z < -1, punt.toArray().map((v) => v.toFixed(2)).join(", "));
  }
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);
