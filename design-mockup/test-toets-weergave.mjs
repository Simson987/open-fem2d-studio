// De toetskrachten als diagram op het tekenvlak (issue #199, fase 6):
// `lib/toetsWeergave.ts` kiest welke combinatie van de TOETSSET het tekenvlak
// toont. Bewaakt:
//   1. een id uit de toetsset (ook de −x-variant id + 1 000 000) wordt getoond;
//   2. een id dat alleen in de resultaten bestaat niet, behalve met terugval:
//      dan de eerste UGT-toetscombinatie met krachten (niet een BGT);
//   3. zonder toetsronde niets;
//   4. `resultatenZijnToetskrachten`: alleen hetzelfde object telt.
// En dat de app de functie gebruikt voor de canvasprops en "Toon op
// tekenvlak" (broncontrole: de app staat niet in de bundel).
// Uitvoeren: npx tsx test-toets-weergave.mjs
import { readFileSync } from "node:fs";
const { kiesToetsCombinatie, resultatenZijnToetskrachten } = await import("./src/lib/toetsWeergave.ts");

let passed = 0, failed = 0;
const check = (n, c, d = "") => { if (c) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n}${d ? " — " + d : ""}`); } };

const r1 = { tag: "UGT +x" }, r1m = { tag: "UGT −x" }, r3 = { tag: "BGT" };
const set = {
  combinations: [
    { id: 3, name: "BGT", type: "sls" },
    { id: 1, name: "UGT (scheefstand +x)", type: "uls" },
    { id: 1_000_001, name: "UGT (scheefstand −x)", type: "uls" },
  ],
  combinationResults: new Map([[1, r1], [1_000_001, r1m], [3, r3]]),
};
check("id uit de toetsset", kiesToetsCombinatie(set, 1) === 1);
check("de −x-variant", kiesToetsCombinatie(set, 1_000_001) === 1_000_001);
check("onbekend id zonder terugval: null", kiesToetsCombinatie(set, 7) === null);
check("onbekend id met terugval: de eerste UGT (1), niet de BGT (3)", kiesToetsCombinatie(set, 7, true) === 1);
check("null met terugval: de eerste UGT", kiesToetsCombinatie(set, null, true) === 1);
check("geen toetsronde: null", kiesToetsCombinatie(null, 1, true) === null);
check("een combinatie zonder krachten telt niet",
  kiesToetsCombinatie({ ...set, combinationResults: new Map([[3, r3]]) }, 1, true) === null);
check("resultaten = toetskrachten bij hetzelfde object", resultatenZijnToetskrachten(set, new Map([[1, r1]]), 1));
check("niet bij een ander object met dezelfde inhoud", !resultatenZijnToetskrachten(set, new Map([[1, { tag: "UGT +x" }]]), 1));

const app = readFileSync(new URL("./src/App.tsx", import.meta.url), "utf8");
check("App: de canvasprops volgen de toetsweergave",
  /combinations=\{toetsWeergave \? toetsWeergave\.ronde\.combinations : fem\.rekenCombinaties\}/.test(app)
    && /combinationResults=\{toetsWeergave\s*\?\s*toetsWeergave\.ronde\.combinationResults/.test(app));
check("App: 'Toon op tekenvlak' schakelt naar de toetsset als de krachten verschillen",
  /kiesToetsCombinatie\(toetsing, id\) !== null\)\s*\{\s*setToetsWeergaveId\(id\)/.test(app));

console.log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);
