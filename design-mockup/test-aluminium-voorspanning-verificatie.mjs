import assert from "node:assert/strict";
import { toetsAluminiumILigger } from "./src/lib/aluminiumCheck.ts";
import { voorspanDwarskrachtZonderBeugels, voorspanSpanningen } from "./src/lib/voorspanning.ts";

const nabij = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} ±${tol}`);

// European Aluminium, Introduction to Eurocode 9, worked example 1, p.55-56.
// Het voorbeeld noemt I=1,17e8 mm4 en eist I=1,18e8 mm4: het 'accepted'
// na afronden is strikt genomen een overschrijding. Ook M_Ed=49 kNm komt uit
// 22,2 kN/m terwijl vlak erboven q_Ed=33,2 kN/m staat. De test rekent de
// gepubliceerde invoer consequent door en verwacht daarom 73,2 kNm.
const alu = toetsAluminiumILigger({
  legering: "EN AW-6063-T6", lasstatus: "geen", zijdelingsGesteund: true,
  lengteMm: 4200, flensBreedteMm: 180, flensDikteMm: 12,
  lijfDikteMm: 6, totaleHoogteMm: 320, iyMm4: 1.17e8,
  momentEdNmm: 33.2 * 4200 ** 2 / 8, qSlsNmm: 23.9,
  doorbuigingsNoemer: 360,
});
nabij(alu.epsilon, 1.25, 0);
nabij(alu.betaFlens, 7.5, 0);
nabij(alu.momentRdNmm / 1e6, 106.36, 0.1);
nabij(alu.doorbuigingMm, 11.82, 0.1);
assert.equal(alu.status, "deelcontrole_overschreden");
assert.ok(alu.nietBeoordeeld.includes("Dwarskracht en interactie"));
assert.equal(toetsAluminiumILigger({
  legering: "EN AW-6063-T6", lasstatus: "aanwezig", zijdelingsGesteund: true,
  lengteMm: 4200, flensBreedteMm: 180, flensDikteMm: 12,
  lijfDikteMm: 6, totaleHoogteMm: 320, iyMm4: 1.17e8,
  momentEdNmm: 49e6, qSlsNmm: 23.9, doorbuigingsNoemer: 360,
}).status, "niet_getoetst");

// Federbeton / European Concrete Platform, EC2 Worked Examples 6.3, p.6-4:
// rechthoek 100x200, d=175, sigma_cp=5, fctd=1,66, v_min=0,626, k1=0,15.
const v = voorspanDwarskrachtZonderBeugels({
  bwMm: 100, hMm: 200, dMm: 175, sigmaCpMpa: 5,
  fctdMpa: 1.66, vMinMpa: 0.626, k1: 0.15,
});
nabij(v.gescheurdN / 1000, 24.08, 0.02);
nabij(v.ongescheurdN / 1000, 44.33, 0.1);

// Onafhankelijke elastische evenwichtsidentiteit: bij M_ext=P(e+W/A)
// is de ondervezel exact gedecomprimeerd (sigma=0).
const A = 200000, I = 4e9, h = 400, P = 1000000, e = 60;
const W = I / (h / 2);
const s = voorspanSpanningen({ oppervlakteMm2: A, iyMm4: I, hoogteMm: h,
  effectieveKrachtN: P, excentriciteitMm: e,
  uitwendigMomentNmm: P * (e + W / A) });
nabij(s.sigmaOnderMpa, 0, 1e-12);
nabij(s.decomprimerendMomentNmm, P * (e + W / A), 1e-6);
console.log("Aluminium- en voorspanreferenties: OK");
