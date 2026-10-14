// De 3D-rapporttabellen moeten echte minima en maxima uit alle berekende
// combinaties gebruiken, ook een veldmoment tussen de staafeinden.
import assert from "node:assert/strict";
import { openFem3DDoorlopendeOmhullenden, openFem3DRapportOmhullenden } from "./src/components/openFem3d/openFem3dRapportOmhullenden.ts";

const combinaties = [
  { id: 1, name: "UGT 1", type: "uls" },
  { id: 2, name: "UGT 2", type: "uls" },
  { id: 3, name: "BGT", type: "sls" },
  { id: 4, name: "niet berekend", type: "uls" },
];
const krachten = (n, my) => ({
  memberId: 7, lengthM: 6, nStartKn: n, nEndKn: n + 1,
  vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
  torsionStartKnm: 0, torsionEndKnm: 0,
  myStartKnm: 0, myEndKnm: 0, mzStartKnm: 0, mzEndKnm: 0,
  myVeld: my,
});
const resultaat = (n, my, fz, ux) => {
  const { myVeld, ...staaf } = krachten(n, my);
  return {
    memberForces: [staaf],
    diagrams: {
      axial: [], shearY: [], shearZ: [], torsion: [], momentZ: [],
      momentY: [{ memberId: 7, points: [
        { t: 0, value: 0 }, { t: 0.5, value: myVeld }, { t: 1, value: 0 },
      ] }],
    },
    reactions: [{ nodeId: 1, fx: 0, fy: 0, fz, mx: 0, my: 0, mz: 0 }],
    displacements: [{ nodeId: 2, ux, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 }],
  };
};
const rijen = openFem3DRapportOmhullenden(combinaties, new Map([
  [1, resultaat(10, 20, -15, 0.001)],
  [2, resultaat(-5, -25, 8, -0.002)],
  [3, resultaat(3, 5, 2, 0.003)],
]));
const rij = (soort, groep, grootheid) => rijen.find((r) =>
  r.soort === soort && r.groep === groep && r.grootheid === grootheid);

const my = rij("uls", "staaf", "My");
assert.equal(my.min.waarde, -25);
assert.equal(my.min.combinatieId, 2);
assert.equal(my.min.positieM, 3);
assert.equal(my.max.waarde, 20);
assert.equal(my.max.combinatieId, 1);
assert.equal(my.max.positieM, 3);
assert.equal(rij("uls", "staaf", "N").min.waarde, -5);
assert.equal(rij("uls", "staaf", "N").max.waarde, 11);

const reactie = rij("uls", "reactie", "Fz");
assert.equal(reactie.min.waarde, -15);
assert.equal(reactie.max.waarde, 8);
assert.equal(reactie.max.combinatie, "UGT 2");

const verplaatsing = rij("uls", "verplaatsing", "Ux");
assert.equal(verplaatsing.min.waarde, -2);
assert.equal(verplaatsing.max.waarde, 1);
assert.equal(verplaatsing.eenheid, "mm");
assert.equal(rij("sls", "verplaatsing", "Ux").max.waarde, 3);
assert.equal(rij("sls", "staaf", "My").max.waarde, 5);
assert.ok(rijen.every((r) => r.min.combinatieId !== 4 && r.max.combinatieId !== 4));

const ketenModel = {
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 6, y: 0, z: 0 },
    { id: 3, x: 12, y: 0, z: 0 }, { id: 4, x: 0, y: 5, z: 0 },
    { id: 5, x: 6, y: 5, z: 0 }, { id: 6, x: 6, y: 3, z: 0 },
  ],
  beams: [
    { id: 7, startNodeId: 1, endNodeId: 2, name: "Ligger A" },
    { id: 8, startNodeId: 2, endNodeId: 3, name: "Ligger A" },
    { id: 9, startNodeId: 4, endNodeId: 5, name: "Ligger A" },
  ],
};
const rij8 = {
  ...my, id: 8,
  min: { waarde: -40, combinatieId: 2, combinatie: "UGT 2", positieM: 2 },
  max: { waarde: 30, combinatieId: 1, combinatie: "UGT 1", positieM: 4 },
};
const doorlopend = openFem3DDoorlopendeOmhullenden(ketenModel, [...rijen, rij8]);
assert.equal(doorlopend.length, 1, "geen onvolledige ketenresultaten voor andere componenten");
const doorlopendMy = doorlopend.find((r) => r.soort === "uls" && r.grootheid === "My");
assert.deepEqual(doorlopendMy.deelIds, [7, 8]);
assert.equal(doorlopendMy.lengteM, 12);
assert.equal(doorlopendMy.min.waarde, -40);
assert.equal(doorlopendMy.min.positieM, 8);
assert.equal(doorlopendMy.max.waarde, 30);
assert.equal(doorlopendMy.max.positieM, 10);
assert.ok(doorlopend.every((r) => !r.deelIds.includes(9)));
assert.equal(openFem3DDoorlopendeOmhullenden(ketenModel,
  [...rijen, { ...rij8, combinatieIds: new Set([1]) }]).length, 0,
"een segment zonder uitkomst voor UGT 2 mag geen volledige ketenomhullende opleveren");
assert.equal(openFem3DDoorlopendeOmhullenden({ ...ketenModel,
  beams: [...ketenModel.beams, { id: 10, startNodeId: 2, endNodeId: 6, name: "Ligger A" }],
}, [...rijen, rij8]).length, 0, "een aftakking is geen doorlopende staaf");
assert.equal(openFem3DDoorlopendeOmhullenden({ ...ketenModel,
  beams: ketenModel.beams.map((b) => b.id === 8 ? { ...b, rollAngleRad: 0.1 } : b),
}, [...rijen, rij8]).length, 0, "verschillende lokale assen mogen niet worden vermengd");
console.log("3D-rapport: omhullenden en doorlopende staaf met globale x correct");
