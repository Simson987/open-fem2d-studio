import assert from "node:assert/strict";
import { valideerStaafResultaat3D, valideerSchaalResultaat3D, materialenVoor3DContract } from "./src/lib/toetsResultaat3d.ts";
import { toetsDrieLagenUit3D } from "./src/lib/drieLagenBeton.ts";
import { toetsStaalDoorsnede3D } from "./src/lib/staal3d.ts";

const r = {
  staafId: 7, combinatieId: 2, lengteM: 4,
  assen: { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } },
  stations: [
    { xM: 0, n: -100, vy: 20, vz: 30, t: 4, my: 50, mz: 60 },
    { xM: 4, n: -100, vy: -20, vz: -30, t: 4, my: -50, mz: -60 },
  ],
  herkomst: { soort: "geverifieerde-3d-solver", naam: "referentie", versie: "1" },
};
assert.equal(valideerStaafResultaat3D(r), r);
assert.equal(materialenVoor3DContract().length, 7);
const wijzig = (f) => { const c = structuredClone(r); f(c); return c; };
assert.throws(() => valideerStaafResultaat3D(wijzig((c) => { delete c.stations[0].mz; })), /alle zes/);
assert.throws(() => valideerStaafResultaat3D(wijzig((c) => { c.stations[0].t = NaN; })), /alle zes/);
assert.throws(() => valideerStaafResultaat3D(wijzig((c) => { c.assen.z.z = -1; })), /rechtshandig/);
assert.throws(() => valideerStaafResultaat3D(wijzig((c) => { c.stations[1].xM = 0; })), /strikt oplopende/);
assert.throws(() => valideerStaafResultaat3D(wijzig((c) => { c.herkomst.soort = "2d-projectie"; })), /herkomst/);
// SCI P363 §10.1.1: conservatieve som N/Npl,Rd + My/Mc,y,Rd + Mz/Mc,z,Rd.
const staal = toetsStaalDoorsnede3D({ resultaat: r, doorsnedeKlasse: 3,
  nRdKN: 500, myRdKNm: 200, mzRdKNm: 300 });
assert.equal(staal.status, "deelcontrole_voldoet");
assert.ok(Math.abs(staal.uc - 0.65) < 1e-12);
assert.ok(staal.nietBeoordeeld.some((x) => x.includes("Torsie")));
const staalTekort = toetsStaalDoorsnede3D({ resultaat: r, doorsnedeKlasse: 3,
  nRdKN: 100, myRdKNm: 200, mzRdKNm: 300 });
assert.equal(staalTekort.status, "deelcontrole_overschreden");
// SCI P374 voorbeeld 5: SHS 150x150x6,3, S355, N=600 kN,
// My=20 kNm, Mz=5 kNm, Npl,Rd=1271 kN, Mpl,Rd=68 kNm per as.
// De publicatie gebruikt de gunstiger §6.2.9.1-interactie; de conservatieve
// §6.2.1(7)-som moet eveneens onder 1 blijven (circa 0,840).
const publicatie = toetsStaalDoorsnede3D({
  resultaat: wijzig((c) => {
    for (const s of c.stations) Object.assign(s, { n: -600, my: 20, mz: 5, vy: 0, vz: 0, t: 0 });
  }),
  doorsnedeKlasse: 1, nRdKN: 1271, myRdKNm: 68, mzRdKNm: 68,
});
assert.ok(Math.abs(publicatie.uc - (600 / 1271 + 25 / 68)) < 1e-12);
assert.equal(publicatie.status, "deelcontrole_voldoet");
const schaal = { schaalId: 8, combinatieId: 2, assen: r.assen, herkomst: r.herkomst,
  krachten: { nx: 100, ny: 0, nxy: 0, mx: 0, my: 0, mxy: 0, vx: 0, vy: 0 } };
assert.equal(valideerSchaalResultaat3D(schaal), schaal);
const uit = toetsDrieLagenUit3D(schaal, {
  dikteMm: 300, dikteBovenMm: 60, dikteOnderMm: 60,
  wapeningBoven: { asX: 125, asY: 0 }, wapeningOnder: { asX: 125, asY: 0 },
  fcdMpa: 20, fydMpa: 400, nuAccent: 0.8, drukmodel: "blaauwendraad-2021",
});
assert.equal(uit.boven.benodigdAsX, 125);
const foutSchaal = structuredClone(schaal);
delete foutSchaal.krachten.vy;
assert.throws(() => toetsDrieLagenUit3D(foutSchaal, {
  dikteMm: 300, dikteBovenMm: 60, dikteOnderMm: 60,
  wapeningBoven: { asX: 125, asY: 0 }, wapeningOnder: { asX: 125, asY: 0 },
  fcdMpa: 20, fydMpa: 400, nuAccent: 0.8, drukmodel: "blaauwendraad-2021",
}), /acht krachtcomponenten/);
console.log("3D-resultaatcontract: zes krachten, assen en herkomst: OK");
