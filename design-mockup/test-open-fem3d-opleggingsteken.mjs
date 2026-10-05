// Opleggingstekens in 3D voor de combinaties zonder eigen standaardteken:
// een verende oplegging (paal) en een starre combinatie zoals scharnier plus
// torsievast. Vroeger een grote oranje bol, die de veer eronder verborg.
//   - per veer de spoel met een plaatje aan het eind;
//   - per vaste translatie een klein oranje kegeltje met de punt naar de knoop;
//   - alle translaties vast: de gewone scharnierkegel met voetplaat;
//   - per vaste rotatie een donkere, gesloten ring om die as (de oranje ring
//     met asstaaf blijft het teken van de vrije draaias van een scharnier).
// De veer is een echte schroefveer (vijf windingen, een spoel van een halve
// maat breed); een rol is kegel, voetplaat, twee rollen en de ondergrond met
// arcering, zonder de grote donkere schijf van vroeger. Een inklemming is in
// dezelfde stijl een massief blok onder de knoop, met een donkere kraag om de
// knoop, op dezelfde ondergrond met arcering (vroeger een oranje schijf met
// schuine staafjes).
import * as THREE from "three";
const { addOpenFem3DConditionMarkers, openFem3DConditionMarkerSize } = await import("./src/components/openFem3d/openFem3dMarkers.ts");
const { OPEN_FEM_3D_SUPPORT_PRESETS, parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); } else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};

const knopen = [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 10, y: 0, z: 0 }];
const s = openFem3DConditionMarkerSize(knopen);
const ORANJE = 0xd97706, DONKER = 0x475569, VEER = 0x7c3aed;
const VRIJ = { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
const AS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

/** De meshes van één oplegging op knoop 1 (één teken: geen bundeling). */
function teken(oplegging) {
  const model = parseOpenFem3DModel({ nodes: knopen, beams: [], supports: [{ nodeId: 1, ...oplegging }] });
  const groep = new THREE.Group();
  addOpenFem3DConditionMarkers(groep, model, { supports: true, loads: false });
  return groep.children.filter((c) => c instanceof THREE.Mesh);
}
const soort = (meshes, type) => meshes.filter((m) => m.geometry.type === type);
const kleur = (m) => m.material.color.getHex();
const lokaleY = (m) => new THREE.Vector3(0, 1, 0).applyQuaternion(m.quaternion);
const lokaleZ = (m) => new THREE.Vector3(0, 0, 1).applyQuaternion(m.quaternion);
const evenwijdig = (a, b) => Math.abs(Math.abs(a.dot(b)) - 1) < 1e-9;
/** Platen: dunne donkere cilinders (hoogte < 0,1 · maat). */
const platen = (meshes) => soort(meshes, "CylinderGeometry")
  .filter((m) => kleur(m) === DONKER && m.geometry.parameters.height < 0.1 * s);
const geenBol = (meshes) => soort(meshes, "SphereGeometry").length === 0;
const alleKnoop = (meshes) => meshes.every((m) => m.userData.type === "node" && m.userData.id === 1);

console.log("[1] paal: alleen een verticale veer");
{
  const m = teken({ ...VRIJ, springs: { kzKnPerM: 100000 } });
  check("geen bol meer", geenBol(m));
  check("de veer is zichtbaar (paarse spoel)", soort(m, "TubeGeometry").filter((t) => kleur(t) === VEER).length === 1);
  const p = platen(m);
  check("één plaatje, aan het eind van de veer (1,45–1,55 · maat onder de knoop)",
    p.length === 1 && p[0].position.z < -1.45 * s && p[0].position.z > -1.55 * s, p.map((x) => x.position.toArray()).join(" | "));
  check("… loodrecht op de veer", p.length === 1 && evenwijdig(lokaleY(p[0]), AS.z));
  check("geen kegel (geen vaste richting)", soort(m, "ConeGeometry").length === 0);
  check("alles hoort bij knoop 1 (selecteerbaar als de knoop)", alleKnoop(m));
}

console.log("\n[2] paal, statisch bepaald: u_x en u_y vast, verticale veer");
{
  const m = teken({ ...VRIJ, ux: true, uy: true, springs: { kzKnPerM: 100000 } });
  check("geen bol meer", geenBol(m));
  const kegels = soort(m, "ConeGeometry");
  check("twee kleine oranje kegeltjes", kegels.length === 2 && kegels.every((k) => kleur(k) === ORANJE
    && k.geometry.parameters.radius < 0.5 * s), String(kegels.length));
  for (const as of ["x", "y"]) {
    const k = kegels.find((kegel) => evenwijdig(lokaleY(kegel), AS[as]));
    check(`… langs ${as}, met de punt naar de knoop en het lijf aan de min-kant`,
      k !== undefined && lokaleY(k).dot(AS[as]) > 0.999 && k.position.dot(AS[as]) < 0,
      k && `${lokaleY(k).toArray()} @ ${k.position.toArray()}`);
  }
  check("een veer met een plaatje eronder en een plaatje achter elk kegeltje",
    soort(m, "TubeGeometry").length === 1 && platen(m).length === 3, String(platen(m).length));
}

console.log("\n[3] paal met horizontale veren: k_x, k_y en k_z");
{
  const m = teken({ ...VRIJ, springs: { kxKnPerM: 5000, kyKnPerM: 5000, kzKnPerM: 100000 } });
  check("geen bol meer", geenBol(m));
  check("drie veren", soort(m, "TubeGeometry").length === 3);
  const p = platen(m);
  check("drie plaatjes, elk aan het eind van zijn veer en loodrecht erop",
    p.length === 3 && ["x", "y", "z"].every((as) => p.some((plaat) => evenwijdig(lokaleY(plaat), AS[as])
      && plaat.position.dot(AS[as]) < -1.45 * s && plaat.position.dot(AS[as]) > -1.55 * s)),
    p.map((x) => `${lokaleY(x).toArray().map((v) => v.toFixed(2))}@${x.position.toArray().map((v) => v.toFixed(2))}`).join(" | "));
}

console.log("\n[4] scharnier plus torsievast: u_x, u_y, u_z en r_z vast");
{
  const m = teken({ ux: true, uy: true, uz: true, rx: false, ry: false, rz: true });
  check("geen bol meer", geenBol(m));
  const kegels = soort(m, "ConeGeometry");
  check("de gewone scharnierkegel, met de punt omhoog naar de knoop",
    kegels.length === 1 && Math.abs(kegels[0].geometry.parameters.radius - 0.7 * s) < 1e-12
      && lokaleY(kegels[0]).z > 0.999, String(kegels.length));
  check("met de voetplaat van een scharnier (1,08 · maat onder de knoop)",
    soort(m, "CylinderGeometry").some((c) => kleur(c) === DONKER && Math.abs(c.position.z + 1.08 * s) < 1e-9));
  const ringen = soort(m, "TorusGeometry");
  check("één donkere, gesloten ring om de z-as (torsie vast)",
    ringen.length === 1 && kleur(ringen[0]) === DONKER && Math.abs(ringen[0].geometry.parameters.arc - 2 * Math.PI) < 1e-12
      && evenwijdig(lokaleZ(ringen[0]), AS.z), ringen.map((r) => kleur(r).toString(16)).join());
  check("alles hoort bij knoop 1", alleKnoop(m));
}

console.log("\n[5] gedeeltelijk: alleen u_z en r_z vast");
{
  const m = teken({ ...VRIJ, uz: true, rz: true });
  check("geen bol meer", geenBol(m));
  const kegels = soort(m, "ConeGeometry");
  check("één klein kegeltje onder de knoop, punt omhoog",
    kegels.length === 1 && kegels[0].geometry.parameters.radius < 0.5 * s && lokaleY(kegels[0]).z > 0.999
      && kegels[0].position.z < 0, String(kegels.length));
  check("één donkere ring om de z-as", soort(m, "TorusGeometry").filter((r) => kleur(r) === DONKER).length === 1);
}

console.log("\n[6] de standaardtekens blijven zoals ze waren");
{
  const scharnier = teken(OPEN_FEM_3D_SUPPORT_PRESETS.pinned);
  check("scharnier: kegel en voetplaat, geen ring",
    soort(scharnier, "ConeGeometry").length === 1 && soort(scharnier, "TorusGeometry").length === 0
      && soort(scharnier, "CylinderGeometry").some((c) => Math.abs(c.position.z + 1.08 * s) < 1e-9));
  const draai = teken(OPEN_FEM_3D_SUPPORT_PRESETS.revoluteZ);
  check("scharnier met vrije z-as: de oranje ring (niet de donkere)",
    soort(draai, "TorusGeometry").length === 1 && kleur(soort(draai, "TorusGeometry")[0]) === ORANJE);
}

console.log("\n[7] de veer is een echte schroefveer, geen draadje");
{
  const veer = soort(teken({ ...VRIJ, springs: { kzKnPerM: 100000 } }), "TubeGeometry")[0];
  veer.geometry.computeBoundingBox();
  const doos = veer.geometry.boundingBox;
  check("de spoel is minstens 0,4 · maat breed (niet een dun lijntje)",
    doos.max.x - doos.min.x >= 0.4 * s && doos.max.y - doos.min.y >= 0.4 * s,
    `${((doos.max.x - doos.min.x) / s).toFixed(2)} × ${((doos.max.y - doos.min.y) / s).toFixed(2)} · maat`);
  check("hij loopt van de knoop tot het plaatje (1,4–1,5 · maat)",
    doos.max.z <= 0.05 * s && doos.min.z <= -1.4 * s && doos.min.z >= -1.55 * s, `${(doos.min.z / s).toFixed(2)} · maat`);
  // Windingen tellen: hoe vaak de spoel van de ene naar de andere kant van de as gaat.
  const buiten = veer.geometry.parameters.path.getPoints(400).filter((punt) => Math.abs(punt.x) > 0.05 * s);
  let wissels = 0;
  for (let i = 1; i < buiten.length; i++) if (Math.sign(buiten[i].x) !== Math.sign(buiten[i - 1].x)) wissels++;
  check("vijf windingen", wissels >= 9 && wissels <= 11, String(wissels));
}

console.log("\n[8] een rol: kegel, voetplaat, twee rollen en de ondergrond met arcering");
{
  const m = teken(OPEN_FEM_3D_SUPPORT_PRESETS.yRoller);
  check("geen bol en geen grote schijf meer", geenBol(m)
    && !soort(m, "CylinderGeometry").some((c) => c.geometry.parameters.radiusTop >= 0.8 * s));
  const kegels = soort(m, "ConeGeometry");
  check("één kegel langs y, met de punt naar de knoop", kegels.length === 1 && lokaleY(kegels[0]).dot(AS.y) > 0.999
    && kegels[0].position.dot(AS.y) < 0);
  const rollen = soort(m, "CylinderGeometry").filter((c) => kleur(c) === DONKER);
  check("twee donkere rollen, dwars op de vaste richting", rollen.length === 2
    && rollen.every((r) => Math.abs(lokaleY(r).dot(AS.y)) < 1e-9), String(rollen.length));
  const platenRol = soort(m, "BoxGeometry").filter((b) => b.geometry.parameters.width >= 1.4 * s);
  check("voetplaat en ondergrond, loodrecht op y", platenRol.length === 2
    && platenRol.every((b) => evenwijdig(lokaleY(b), AS.y)), String(platenRol.length));
  const diepte = (mesh) => -mesh.position.dot(AS.y);
  const [voet, grond] = [...platenRol].sort((a, b) => diepte(a) - diepte(b));
  check("in de volgorde knoop – kegel – voetplaat – rollen – ondergrond",
    platenRol.length === 2 && diepte(kegels[0]) < diepte(voet) && rollen.every((r) => diepte(r) > diepte(voet) && diepte(r) < diepte(grond)));
  const arcering = soort(m, "BoxGeometry").filter((b) => b.geometry.parameters.width < 0.1 * s);
  check("vier arceringsstreepjes achter de ondergrond", arcering.length === 4
    && arcering.every((b) => diepte(b) > diepte(grond)), String(arcering.length));
  check("alles hoort bij knoop 1", alleKnoop(m));
}

console.log("\n[9] een inklemming: de knoop vastgeklemd in een blok op de ondergrond met arcering");
{
  // Het oude teken (een oranje schijf met schuine staafjes) was onduidelijk.
  // Nu in de stijl van de rol: een massief oranje blok direct onder de knoop,
  // een donkere kraag om de knoop, de grijze ondergrond met dezelfde arcering.
  const m = teken(OPEN_FEM_3D_SUPPORT_PRESETS.fixed);
  const GRIJS = 0x94a3b8;
  const dozen = soort(m, "BoxGeometry");
  const maten = (b) => b.geometry.parameters;
  // Lokale y van een doos staat langs z (de vaste richting), zoals bij de rol.
  const boven = (b) => b.position.z + maten(b).height / 2;
  const onder = (b) => b.position.z - maten(b).height / 2;
  const blokken = dozen.filter((b) => kleur(b) === ORANJE);
  check("één oranje blok, rechtop", blokken.length === 1 && evenwijdig(lokaleY(blokken[0]), AS.z), String(blokken.length));
  const blok = blokken[0];
  check("… direct onder de knoop: de bovenkant op de knoop", blok && Math.abs(boven(blok)) < 1e-9 && blok.position.x === 0 && blok.position.y === 0,
    blok && `${(boven(blok) / s).toFixed(3)} · maat`);
  check("… massief: minstens een maat breed en 0,6 maat hoog", blok && maten(blok).width >= s && maten(blok).depth >= s
    && maten(blok).height >= 0.6 * s, blok && JSON.stringify(maten(blok)));
  const kragen = dozen.filter((b) => kleur(b) === DONKER && maten(b).width > 0.2 * s && maten(b).width < 0.6 * s);
  check("een donkere kraag om de knoop: de knoop zit erin vastgeklemd", kragen.length === 1
    && kragen[0].position.length() < 1e-9 && boven(kragen[0]) > 0 && onder(kragen[0]) < 0, String(kragen.length));
  const gronden = dozen.filter((b) => kleur(b) === GRIJS);
  check("de grijze ondergrond direct onder het blok, breder dan het blok", gronden.length === 1 && blok
    && Math.abs(boven(gronden[0]) - onder(blok)) < 1e-9 && maten(gronden[0]).width > maten(blok).width
    && evenwijdig(lokaleY(gronden[0]), AS.z), gronden.map((g) => (boven(g) / s).toFixed(3)).join());
  const arcering = dozen.filter((b) => kleur(b) === DONKER && maten(b).width < 0.1 * s);
  check("vier arceringsstreepjes onder de ondergrond", arcering.length === 4 && gronden.length === 1
    && arcering.every((b) => b.position.z < onder(gronden[0])), String(arcering.length));
  const rol = soort(teken(OPEN_FEM_3D_SUPPORT_PRESETS.zRoller), "BoxGeometry");
  const zelfde = (filter) => {
    const eigen = dozen.find(filter), vanRol = rol.find(filter);
    return eigen !== undefined && vanRol !== undefined && JSON.stringify(maten(eigen)) === JSON.stringify(maten(vanRol));
  };
  check("dezelfde ondergrond en arcering als de rol",
    zelfde((b) => kleur(b) === GRIJS) && zelfde((b) => kleur(b) === DONKER && maten(b).width < 0.1 * s));
  check("geen kegel, ring, rol of ronde schijf (duidelijk anders dan scharnier en rol)",
    soort(m, "ConeGeometry").length === 0 && soort(m, "TorusGeometry").length === 0 && soort(m, "CylinderGeometry").length === 0);
  check("alles hoort bij knoop 1 (selecteerbaar als de knoop)", alleKnoop(m));
  check("geen bol", geenBol(m));
  // Gebundeld (vanaf vier tekens): dezelfde delen, elk in een eigen GPU-batch.
  const vier = parseOpenFem3DModel({
    nodes: [0, 3, 6, 9].map((x, i) => ({ id: i + 1, x, y: 0, z: 0 })), beams: [],
    supports: [1, 2, 3, 4].map((nodeId) => ({ nodeId, ...OPEN_FEM_3D_SUPPORT_PRESETS.fixed })),
  });
  const groep = new THREE.Group();
  addOpenFem3DConditionMarkers(groep, vier, { supports: true, loads: false });
  check("vier inklemmingen: vier GPU-batches (blok, kraag, ondergrond, arcering) van selecteerbare knopen",
    groep.children.length === 4 && groep.children.every((c) => c instanceof THREE.InstancedMesh && c.userData.type === "node"),
    groep.children.map((c) => c.type).join());
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);
