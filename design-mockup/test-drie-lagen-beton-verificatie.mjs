import assert from "node:assert/strict";
import { verdeelSchaalkrachten, toetsDrieLagenBuitenlagen } from "./src/lib/drieLagenBeton.ts";

const nabij = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} ±${tol}`);

// European Concrete Platform, EC2 Worked Examples, §6.15.6, tabel 6.11/6.13.
// Element 648: h=1,5 m, t_s=t_i=0,14 m, z=1,36 m. Eenheden zoals gepubliceerd.
const k648 = { nx: -9096, ny: -1779, nxy: 5, mx: 470, my: -239, mxy: -14, vx: -5, vy: -6 };
const e648 = verdeelSchaalkrachten(k648, 1500, 140, 140);
nabij(e648.hefboomMm, 1360, 0);
nabij(e648.boven.nx, -4893.3, 0.4);
nabij(e648.boven.ny, -713.5, 0.4);
nabij(e648.boven.nxy, 13.0, 0.3);
nabij(e648.onder.nx, -4202.2, 0.4);
nabij(e648.onder.ny, -1065.1, 0.4);
nabij(e648.onder.nxy, -7.7, 0.3);
const druk648 = toetsDrieLagenBuitenlagen({
  krachten: k648, dikteMm: 1500, dikteBovenMm: 140, dikteOnderMm: 140,
  wapeningBoven: { asX: 2260, asY: 2260 },
  wapeningOnder: { asX: 2260, asY: 2260 },
  fcdMpa: 17.1, fydMpa: 435, nuAccent: 0.8, drukmodel: "ec2-bijlage-f",
});
// Tabel 6.14: de aanvankelijk gekozen laagdikte is ontoereikend bij druk.
nabij(druk648.boven.sigmaBetondrukMpa, 35.0, 0.1);
nabij(druk648.onder.sigmaBetondrukMpa, 30.0, 0.1);
assert.equal(druk648.status, "deelcontrole_overschreden");

// Tweede, asymmetrischer gepubliceerd element: de afronding van de bron is
// ~0,1 kN/m; door de afgeronde momentwaarden is 0,5 kN/m passend.
const k93 = { nx: -4610, ny: -5746, nxy: -63, mx: -671, my: 499, mxy: -75, vx: -150, vy: 89 };
const e93 = verdeelSchaalkrachten(k93, 963, 140, 140);
nabij(e93.hefboomMm, 823, 0);
nabij(e93.boven.nx, -1489.8, 0.5);
nabij(e93.boven.ny, -3479.6, 0.5);
nabij(e93.boven.nxy, 59.3, 0.5);
nabij(e93.onder.nx, -3120.5, 0.5);
nabij(e93.onder.ny, -2266.7, 0.5);
nabij(e93.onder.nxy, -122.3, 0.5);

// Onafhankelijke evenwichtscheck voor alle drie componenten, ook bij
// ongelijke laagdikten. Moment is (n_onder-n_boven)·z/2.
const los = { nx: 80, ny: -30, nxy: 12, mx: 15, my: -9, mxy: 4, vx: 6, vy: 8 };
const v = verdeelSchaalkrachten(los, 300, 60, 90);
for (const [n, m] of [["nx", "mx"], ["ny", "my"], ["nxy", "mxy"]]) {
  nabij(v.boven[n] + v.onder[n], los[n], 1e-10);
  nabij((v.onder[n] * (300 - 90) / 2 - v.boven[n] * (300 - 60) / 2) / 1000,
    los[m], 1e-10);
}
// Na vergroting van de ongelijke lagen: gepubliceerd element 648, tabel 6.15.
const e648Dik = verdeelSchaalkrachten(k648, 1500, 300, 240);
nabij(e648Dik.hefboomMm, 1230, 0);
nabij(e648Dik.boven.nx, -5040.8, 1);
nabij(e648Dik.onder.nx, -4054.7, 1);

// Zuivere trek over twee buitenlagen: elke laag 50 kN/m, zodat bij
// f_yd=400 MPa per laag 125 mm²/m nodig is. De kern blijft ongekeurd.
const controle = toetsDrieLagenBuitenlagen({
  krachten: { nx: 100, ny: 0, nxy: 0, mx: 0, my: 0, mxy: 0, vx: 0, vy: 0 },
  dikteMm: 300, dikteBovenMm: 60, dikteOnderMm: 60,
  wapeningBoven: { asX: 125, asY: 0 }, wapeningOnder: { asX: 125, asY: 0 },
  fcdMpa: 20, fydMpa: 400, nuAccent: 0.8, drukmodel: "blaauwendraad-2021",
});
nabij(controle.boven.benodigdAsX, 125, 1e-12);
nabij(controle.onder.ucAsX, 1, 1e-12);
assert.equal(controle.status, "deelcontrole_voldoet");
assert.ok(controle.nietBeoordeeld.some((x) => x.includes("Kernlaag")));
assert.throws(() => verdeelSchaalkrachten(los, 100, 60, 60), /laagdikten/);

// Blaauwendraad e.a., Wapenen van Schijven en Platen (2021), p. 7–8.
// Dezelfde vier membraantakken worden per buitenschil toegepast. Bij m=0
// krijgt elke identieke schil de helft; de som van beide schillen moet de
// gepubliceerde wapenings- en drukdiagonaalkrachten teruggeven.
const mem = (nx, ny) => toetsDrieLagenBuitenlagen({
  krachten: { nx, ny, nxy: -330, mx: 0, my: 0, mxy: 0, vx: 0, vy: 0 },
  dikteMm: 300, dikteBovenMm: 100, dikteOnderMm: 100,
  wapeningBoven: { asX: 5000, asY: 5000 },
  wapeningOnder: { asX: 5000, asY: 5000 },
  fcdMpa: 20, fydMpa: 400, nuAccent: 0.8, drukmodel: "blaauwendraad-2021",
});
const tweerichtingen = mem(495, 400);
nabij((tweerichtingen.boven.benodigdAsX + tweerichtingen.onder.benodigdAsX) * 400 / 1000, 825, 1e-10);
nabij((tweerichtingen.boven.benodigdAsY + tweerichtingen.onder.benodigdAsY) * 400 / 1000, 730, 1e-10);
nabij((tweerichtingen.boven.sigmaBetondrukMpa + tweerichtingen.onder.sigmaBetondrukMpa) * 100, 660, 1e-10);
const eenrichting = mem(-495, 400);
nabij(eenrichting.boven.benodigdAsX + eenrichting.onder.benodigdAsX, 0, 0);
nabij((eenrichting.boven.benodigdAsY + eenrichting.onder.benodigdAsY) * 400 / 1000, 620, 1e-10);
nabij((eenrichting.boven.sigmaBetondrukMpa + eenrichting.onder.sigmaBetondrukMpa) * 100, 715, 0.1);
assert.equal(tweerichtingen.boven.grensBetondrukMpa, 20);

// Blaauwendraad (2021), vergelijking (22) en het kernvakwerk: de dwarskracht
// (3,4) heeft grootte 5 en induceert 0,9/1,6/1,2 kN/m in BEIDE buitenlagen.
const kern = toetsDrieLagenBuitenlagen({
  krachten: { nx: 0, ny: 0, nxy: 0, mx: 0, my: 0, mxy: 0, vx: 3, vy: 4 },
  dikteMm: 300, dikteBovenMm: 60, dikteOnderMm: 60,
  wapeningBoven: { asX: 100, asY: 100 },
  wapeningOnder: { asX: 100, asY: 100 },
  fcdMpa: 20, fydMpa: 400, nuAccent: 0.8, drukmodel: "blaauwendraad-2021",
  kernControle: { vRdcKNPerM: 4, tanTheta: 1,
    aanwezigeDwarskrachtWapeningMm2PerM2: 100, grensDiagonaalMpa: 12 },
});
nabij(kern.kern.benodigdAsvMm2PerM2, 5 / 240 * 1e6 / 400, 1e-10);
nabij(kern.kern.sigmaDiagonaalMpa, 10 / 240, 1e-12);
for (const laag of [kern.boven, kern.onder]) {
  nabij(laag.krachten.nx, 0.9, 1e-12);
  nabij(laag.krachten.ny, 1.6, 1e-12);
  nabij(laag.krachten.nxy, 1.2, 1e-12);
}
assert.equal(kern.status, "deelcontrole_voldoet");
const tekort = toetsDrieLagenBuitenlagen({
  krachten: { nx: 0, ny: 0, nxy: 0, mx: 0, my: 0, mxy: 0, vx: 3, vy: 4 },
  dikteMm: 300, dikteBovenMm: 60, dikteOnderMm: 60,
  wapeningBoven: { asX: 100, asY: 100 }, wapeningOnder: { asX: 100, asY: 100 },
  fcdMpa: 20, fydMpa: 400, nuAccent: 0.8, drukmodel: "blaauwendraad-2021",
  kernControle: { vRdcKNPerM: 4, tanTheta: 1,
    aanwezigeDwarskrachtWapeningMm2PerM2: 10, grensDiagonaalMpa: 12 },
});
assert.equal(tekort.status, "deelcontrole_overschreden");
console.log("3-lagenbeton tegen gepubliceerde schaalresultanten: OK");
