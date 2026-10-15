// Een vakwerk waarin alle staafeinden scharnieren, rekent (controle 12 oktober
// 2026, punt B10, issue #191).
//
// WAT ER MISGING
//  Een stabiel vakwerk met aan beide einden van elke staaf een momentscharnier
//  werd geweigerd: "[MODEL_ONOPLOSBAAR] Het stelsel is singulier: knoop 1 op
//  (0, 0) mm kan vrij draaien". Er is daar alleen een onbepaalde
//  knooprotatie, geen mechanisme; `validate_fem_model` gaf ok:true. De
//  3D-kern zet zulke draaiingen sinds #96 vast; de 2D-kern deed dat niet.
//
// WAT DEZE TEST VASTLEGT
//  [1] Het vakwerk van de controle (12 × 2 m, randen SHS100x100x5, wanden
//      SHS80x80x4, S355, 3 × 30 kN op de bovenrand) tegen de knopenmethode:
//      onderrand +67,5 kN, eindschoren −45·√13/2, bovenrand −90 kN,
//      middenstijl −30 kN, diagonalen +27,04 kN, stijlen 9 en 11 nul,
//      reacties 45 / 45 kN, en de zakking van knoop 3 met virtuele arbeid
//      Σ N·n·L/(EA). Alle momenten nul, geen reactiemoment. Eerste en
//      tweede orde, en validate en solve zijn het eens. Bij eerste orde geen
//      "EERSTE ORDE NIET TOEGESTAAN": de boogknik van één pendelstaaf
//      (α_cr = 5,53, de Euler-last van een eindschoor) is een staafvorm die
//      de staaftoets dekt (6.3.1, L_cr = L), geen globale vorm (5.2.1(3)).
//  [1b] α_cr telt een pendelkolom wél mee in de zijwaartse vorm (koordterm
//      van K_g): een ingeklemde kolom die een belaste pendelkolom stabiliseert,
//      P_cr = 3EI/h² (hand), en de melding over die globale vorm blijft — sinds
//      issue #199 informatief (B14), zonder "FOUT:".
//  [2] Een driescharnierspant en een pendelstaaf op een scharnieroplegging,
//      ook op het gemengde pad (met een schijf erbij). Een koppel op de nok
//      van het spant (alleen scharnierende einden) wordt op beide paden
//      geweigerd.
//  [3] Een echt mechanisme blijft een fout: een raamwerk dat zijdelings kan
//      wegzakken, en een koppel op een knoop met alleen scharnierende einden
//      (dan weigert ook validate).
//  [4] De gebouwde MCP-server: validate_fem_model en solve_fem_model.
//
// Draaien met: npx tsx test-vakwerk-scharnieren.mjs  (ook tegen de sidecarbundel)

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { verwerkVerzoek } = await import("./src/mcp/sidecar.ts");
const { valideerModel } = await import("./src/mcp/valideerModel.ts");
const { solveAllCases, solveAllCasesNonlinear } = await import("./src/components/fem/solver/engine.ts");
const { bouwMultiInput } = await import("./src/lib/modelNaarSolverInput.ts");
const { resolveSection } = await import("./src/lib/sectionResolver.ts");

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const win = process.platform === "win32";
const MCP_SERVER = join(REPO, "src-tauri", "target", "release", win ? "openaec-mcp-server.exe" : "openaec-mcp-server");

let passed = 0, failed = 0;
const log = (s) => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? ` — ${extra}` : ""}`); }
}
function check(naam, waarde, verwacht, absTol = 1e-3) {
  const goed = Number.isFinite(waarde) && Math.abs(waarde - verwacht) <= absTol;
  ok(`${naam}: ${Number(waarde).toFixed(4)} ≈ ${verwacht.toFixed(4)}`, goed);
}

// ── Het vakwerk van de controle ─────────────────────────────────────────
const RAND = "SHS100x100x5", WAND = "SHS80x80x4";
const scharnier = { startRy: true, endRy: true };
const STAVEN = [
  [1, 1, 2, RAND], [2, 2, 3, RAND], [3, 3, 4, RAND], [4, 4, 5, RAND],
  [5, 1, 6, RAND], [6, 6, 7, RAND], [7, 7, 8, RAND], [8, 8, 5, RAND],
  [9, 2, 6, WAND], [10, 3, 7, WAND], [11, 4, 8, WAND], [12, 6, 3, WAND], [13, 3, 8, WAND],
];
const VAKWERK = () => ({
  nodes: [
    { id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 }, { id: 3, x: 6000, z: 0 }, { id: 4, x: 9000, z: 0 },
    { id: 5, x: 12000, z: 0 }, { id: 6, x: 3000, z: 2000 }, { id: 7, x: 6000, z: 2000 }, { id: 8, x: 9000, z: 2000 },
  ],
  beams: STAVEN.map(([id, from, to, profile]) => ({ id, from, to, profile, material: "S355", releases: { ...scharnier } })),
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 5, type: "zRoller" }],
  loadCases: [{ id: 1, name: "Permanent", type: "dead" }],
  loads: [6, 7, 8].map((nodeId, i) => ({ id: i + 1, type: "pointForce", nodeId, caseId: 1, fz: -30 })),
  selfWeightEnabled: false,
});
const COMBI = [{ id: 1, name: "G x 1,0", type: "uls", factors: { 1: 1 } }];
const metDefaults = (m) => ({ plates: [], scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1, ...m });

// Knopenmethode (kN): sin/cos van de schoren en diagonalen, L = √13 m.
const W13 = Math.sqrt(13);
const N_HAND = {
  1: 67.5, 2: 67.5, 3: 67.5, 4: 67.5,
  5: -45 * W13 / 2, 8: -45 * W13 / 2,
  6: -90, 7: -90,
  9: 0, 11: 0, 10: -30,
  12: 45 * W13 / 2 - 30 * W13 / 2, 13: 45 * W13 / 2 - 30 * W13 / 2,
};
// Virtuele arbeid: eenheidslast omlaag op knoop 3 → n per staaf.
const N_EENHEID = {
  1: 0.75, 2: 0.75, 3: 0.75, 4: 0.75, 5: -W13 / 4, 8: -W13 / 4, 6: -1.5, 7: -1.5,
  9: 0, 10: 0, 11: 0, 12: W13 / 4, 13: W13 / 4,
};
const E = 210000;
const A_RAND = resolveSection("S355", RAND).A, A_WAND = resolveSection("S355", WAND).A;
let zakking3 = 0; // mm
for (const [id, from, to, profile] of STAVEN) {
  const k = VAKWERK().nodes;
  const a = k.find((n) => n.id === from), b = k.find((n) => n.id === to);
  const Lmm = Math.hypot(b.x - a.x, b.z - a.z);
  zakking3 += (N_HAND[id] * 1000) * N_EENHEID[id] * Lmm / (E * (profile === RAND ? A_RAND : A_WAND));
}

// ─────────────────────────────────────────────────────────────────────────
log(`\n[1] Het vakwerk met alle staafeinden scharnierend (hand: zakking knoop 3 = ${zakking3.toFixed(3)} mm)`);
// ─────────────────────────────────────────────────────────────────────────
{
  const v = valideerModel(VAKWERK());
  ok("validate: ok:true", v.ok, JSON.stringify(v.errors));
  for (const [naam, oplosser] of [["eerste orde", solveAllCases], ["tweede orde", solveAllCasesNonlinear]]) {
    let r = null, fout = null;
    try { r = oplosser(bouwMultiInput(metDefaults(VAKWERK()))).perCase.get(1); } catch (e) { fout = e.message; }
    ok(`${naam}: rekent (was: "singulier, knoop 1 kan vrij draaien")`, r !== null, fout ?? "");
    if (!r) continue;
    for (const [id] of STAVEN) check(`${naam}: N${id} (kN)`, r.elements.get(id).N / 1000, N_HAND[id]);
    let mMax = 0;
    for (const ef of r.elements.values()) for (const m of [ef.M_start, ef.M_end, ...ef.bendingMoment]) mMax = Math.max(mMax, Math.abs(m));
    ok(`${naam}: alle momenten nul (|M| < 1 N·mm)`, mMax < 1, `${mMax} N·mm`);
    check(`${naam}: reactie knoop 1 = 45 kN`, r.reactions.get(1).fz / 1000, 45);
    check(`${naam}: reactie knoop 5 = 45 kN`, r.reactions.get(5).fz / 1000, 45);
    check(`${naam}: geen reactiemoment op de scharnieroplegging`, r.reactions.get(1).my / 1e6, 0, 1e-9);
    check(`${naam}: zakking knoop 3 (virtuele arbeid)`, -r.displacements.get(3).uz, zakking3, 1e-6 * Math.max(1, zakking3) + 1e-9);
    check(`${naam}: de onbepaalde knoopdraaiing ligt vast op 0`, r.displacements.get(1).ry, 0, 1e-15);
  }
  const s = verwerkVerzoek({ v: 1, id: 1, op: "solve", payload: { model: VAKWERK(), combinations: COMBI } });
  ok("sidecar solve rekent (validate en solve zijn het eens)", s.ok === true, `${s.error?.code}: ${s.error?.melding}`);
  check("sidecar: N12 (kN)", s.result?.combinations?.["1"]?.elements?.["12"]?.N, N_HAND[12]);
  // Eerste orde (de standaard): geen melding over α_cr. Met een snede op L/2
  // in elke pendelstaaf vond de bepaling de boogknik van de eindschoor
  // (π²EI/L² = 445 kN bij N = 81,1 kN: α_cr = 5,53).
  const meldingen = s.result?.warnings ?? [];
  ok("sidecar (eerste orde): geen \"EERSTE ORDE NIET TOEGESTAAN\" (was: α_cr = 5,53 door één eindschoor)",
    !meldingen.some((m) => /EERSTE ORDE NIET TOEGESTAAN/.test(m)), JSON.stringify(meldingen));
  const ac = s.result?.stability?.alpha_cr?.[0];
  ok("sidecar: α_cr van het vakwerk boven de grens van 10", ac?.status === "boven_grens" || (ac?.alpha_cr ?? 0) >= 10, JSON.stringify(ac));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[1b] α_cr: een belaste pendelkolom telt mee in de zijwaartse vorm");
// ─────────────────────────────────────────────────────────────────────────
{
  // Ingeklemde kolom 1–2 (HEA160, h = 4 m), via een pendelstaaf 2–3 gekoppeld
  // aan een pendelkolom 4–3 met P op de kop. De ingeklemde kolom draagt geen
  // normaalkracht; haar zijdelingse stijfheid is 3EI/h³, de pendelkolom haalt
  // daar P/h af: P_cr = 3EI/h² (de rek van de koppelstaaf kost 0,1 %).
  const h = 4000, P = 100; // mm, kN
  const EIk = 210000 * resolveSection("S235", "HEA160").I; // N·mm²
  const alphaHand = (3 * EIk) / (h * h) / (P * 1000);
  const hinge = { startRy: true, endRy: true };
  const model = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: h }, { id: 3, x: 6000, z: h }, { id: 4, x: 6000, z: 0 }],
    beams: [
      { id: 1, from: 1, to: 2, profile: "HEA160", material: "S235" },
      { id: 2, from: 2, to: 3, profile: "HEA160", material: "S235", releases: { ...hinge } },
      { id: 3, from: 4, to: 3, profile: "HEA160", material: "S235", releases: { ...hinge } },
    ],
    supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 4, type: "pinned" }],
    loadCases: [{ id: 1, name: "G", type: "dead" }],
    loads: [{ id: 1, type: "pointForce", nodeId: 3, caseId: 1, fz: -P }],
    selfWeightEnabled: false,
  };
  const s = verwerkVerzoek({ v: 1, id: 1, op: "solve", payload: { model, combinations: COMBI } });
  ok("sidecar solve rekent", s.ok === true, `${s.error?.code}: ${s.error?.melding}`);
  const ac = s.result?.stability?.alpha_cr?.[0];
  ok(`α_cr = 3EI/(h²·P) = ${alphaHand.toFixed(3)} (±1 %): ${ac?.alpha_cr}`,
    ac?.status === "bepaald" && Math.abs(ac.alpha_cr - alphaHand) <= 0.01 * alphaHand, JSON.stringify(ac));
  // GEWIJZIGD door issue #199 (B14). Tot 2026.42 was dit de FOUT "EERSTE ORDE
  // NIET TOEGESTAAN" (α_cr = 6,57 < 10 bij eerste orde). De toets rekent nu
  // altijd zelf P-Δ met scheefstand; de melding over de globale vorm blijft,
  // maar informatief en over de resultaten. Hetzelfde α_cr, dezelfde combinatie.
  const w = s.result?.warnings ?? [];
  ok("de melding over de globale vorm blijft: α_cr < 10, over de eerste-orderesultaten",
    w.some((m) => /^α_cr = \d+,\d+ in combinatie .* \(< 10\): de resultaten zijn eerste orde/.test(m)), JSON.stringify(w));
  ok("… informatief: geen \"FOUT:\" en geen \"EERSTE ORDE NIET TOEGESTAAN\" meer (B14)",
    !w.some((m) => m.startsWith("FOUT:") || /EERSTE ORDE NIET TOEGESTAAN/.test(m)), JSON.stringify(w));
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[2] Driescharnierspant en pendelstaaf, ook op het gemengde pad");
// ─────────────────────────────────────────────────────────────────────────
const st = (id, from, to, extra = {}) => ({ id, from, to, material: "S235", profile: "HEA160", ...extra });
const basis = { loadCases: [{ id: 1, name: "G", type: "dead" }], selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1 };
const schijfKnopen = [{ id: 11, x: 20000, z: 0 }, { id: 12, x: 21000, z: 0 }, { id: 13, x: 21000, z: 1000 }, { id: 14, x: 20000, z: 1000 }];
const schijf = [{ id: 1, nodeIds: [11, 12, 13, 14], thickness: 200, meshSize: 500 }];
const schijfSteun = [{ nodeId: 11, type: "fixed" }, { nodeId: 12, type: "fixed" }];
for (const metSchijf of [false, true]) {
  const pad = metSchijf ? "gemengd pad" : "raamwerkpad";
  // Driescharnierspant 45°: N = −F/(2·sin 45°) = −14,142 kN in beide staven.
  const spant = {
    ...basis,
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 3000 }, { id: 3, x: 6000, z: 0 }, ...(metSchijf ? schijfKnopen : [])],
    beams: [st(1, 1, 2, { releases: { endRy: true } }), st(2, 2, 3, { releases: { startRy: true } })],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 3, type: "pinned" }, ...(metSchijf ? schijfSteun : [])],
    plates: metSchijf ? schijf : [],
    loads: [{ id: 1, type: "pointForce", caseId: 1, nodeId: 2, fz: -20 }],
  };
  let r = null, fout = null;
  try { r = solveAllCases(bouwMultiInput(spant)).perCase.get(1); } catch (e) { fout = e.message; }
  ok(`${pad}: driescharnierspant rekent`, r !== null, fout ?? "");
  if (r) {
    check(`${pad}: N1 = −20/(2·sin 45°) kN`, r.elements.get(1).N / 1000, -20 / (2 * Math.SQRT1_2), 1e-2);
    check(`${pad}: N2 = −14,142 kN`, r.elements.get(2).N / 1000, -20 / (2 * Math.SQRT1_2), 1e-2);
    check(`${pad}: M in de nok = 0`, r.elements.get(1).M_end / 1e6, 0, 1e-6);
  }
  // Een koppel op de nok, waar alleen scharnierende einden samenkomen: een
  // echt mechanisme. Op het gemengde pad (`solveMixed`) is de kern het enige
  // vangnet van de app: de modelcontrole kent deze regel niet (alleen
  // `valideerModel` op de MCP-weg).
  const metKoppel = { ...spant, loads: [...spant.loads, { id: 2, type: "pointMoment", caseId: 1, nodeId: 2, my: 5 }] };
  fout = null;
  try { solveAllCases(bouwMultiInput(metKoppel)); } catch (e) { fout = e.message; }
  ok(`${pad}: koppel op de nok geweigerd ("knoop 2 … kan vrij draaien … er werkt een koppel op")`,
    fout !== null && /knoop 2 op \(3000, 3000\) mm kan vrij draaien/.test(fout) && /er werkt een koppel op/.test(fout), fout ?? "GEEN FOUT");
  // Pendelkolom met scharnieren aan beide einden op een scharnieroplegging.
  const pendel = {
    ...basis,
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 3000 }, { id: 3, x: 4000, z: 3000 }, { id: 4, x: 4000, z: 0 }, ...(metSchijf ? schijfKnopen : [])],
    beams: [st(1, 1, 2), st(2, 2, 3), st(3, 4, 3, { releases: { startRy: true, endRy: true } })],
    supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 4, type: "pinned" }, ...(metSchijf ? schijfSteun : [])],
    plates: metSchijf ? schijf : [],
    loads: [{ id: 1, type: "pointForce", caseId: 1, nodeId: 2, fx: 10 }],
  };
  r = null; fout = null;
  try { r = solveAllCases(bouwMultiInput(pendel)).perCase.get(1); } catch (e) { fout = e.message; }
  ok(`${pad}: pendelkolom op een scharnieroplegging rekent`, r !== null, fout ?? "");
  if (r) {
    const p = r.elements.get(3);
    check(`${pad}: pendel draagt geen moment (kNm)`, Math.max(Math.abs(p.M_start), Math.abs(p.M_end)) / 1e6, 0, 1e-6);
    check(`${pad}: pendel draagt geen dwarskracht (kN)`, p.V / 1000, 0, 1e-6);
    check(`${pad}: ΣFx = 0 — de inklemming neemt de 10 kN`, (r.reactions.get(1).fx + r.reactions.get(4).fx) / 1000, -10, 1e-6);
    check(`${pad}: pendelreactie = −N pendel (kN)`, r.reactions.get(4).fz / 1000, -p.N / 1000, 1e-6);
    check(`${pad}: geen reactiemoment op de scharnieroplegging`, r.reactions.get(4).my / 1e6, 0, 1e-9);
  }
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[3] Een echt mechanisme blijft een fout");
// ─────────────────────────────────────────────────────────────────────────
{
  // Raamwerk met scharnierende voeten en een scharnierende ligger: zijdelings
  // een mechanisme. Dat is geen onbepaalde knoopdraaiing.
  const raam = {
    ...basis, plates: [],
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 3000 }, { id: 3, x: 4000, z: 3000 }, { id: 4, x: 4000, z: 0 }],
    beams: [st(1, 1, 2, { releases: { startRy: true, endRy: true } }), st(2, 2, 3, { releases: { startRy: true, endRy: true } }),
      st(3, 4, 3, { releases: { startRy: true, endRy: true } })],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 4, type: "pinned" }],
    loads: [{ id: 1, type: "pointForce", caseId: 1, nodeId: 2, fx: 10 }],
  };
  let fout = null;
  try { solveAllCases(bouwMultiInput(raam)); } catch (e) { fout = e.message; }
  ok("zijdelings mechanisme: geweigerd als singulier, met verschuiven in de reden", fout !== null && /singulier/.test(fout) && /verschuiven/.test(fout), fout ?? "GEEN FOUT");

  // Een koppel op een knoop waar alle staafeinden scharnieren.
  const koppel = VAKWERK();
  koppel.loads.push({ id: 9, type: "pointMoment", nodeId: 3, caseId: 1, my: 5 });
  const v = valideerModel(koppel);
  ok("koppel op een scharnierknoop: validate weigert", !v.ok && v.errors.some((e) => e.startsWith("Koppel 9 op knoop 3: op deze knoop komen alleen scharnierende")), JSON.stringify(v.errors));
  fout = null;
  try { solveAllCases(bouwMultiInput(metDefaults(koppel))); } catch (e) { fout = e.message; }
  ok("koppel op een scharnierknoop: de kern weigert met knoop 3 en het koppel als reden",
    fout !== null && /knoop 3 op \(6000, 0\) mm kan vrij draaien/.test(fout) && /er werkt een koppel op/.test(fout), fout ?? "GEEN FOUT");
  const s = verwerkVerzoek({ v: 1, id: 1, op: "solve", payload: { model: koppel, combinations: COMBI } });
  ok("koppel op een scharnierknoop: sidecar MODEL_ONOPLOSBAAR", s.ok === false && s.error?.code === "MODEL_ONOPLOSBAAR", `${s.error?.code}: ${s.error?.melding}`);
}

// ─────────────────────────────────────────────────────────────────────────
log("\n[4] De gebouwde MCP-server");
// ─────────────────────────────────────────────────────────────────────────
function mcp(aanroepen) {
  return new Promise((klaar, mis) => {
    const k = spawn(MCP_SERVER, [], { stdio: ["pipe", "pipe", "pipe"] });
    const klok = setTimeout(() => { k.kill(); mis(new Error("MCP-server reageerde niet binnen 120 s")); }, 120_000);
    let buf = "";
    const antwoorden = new Map();
    k.on("error", (e) => { clearTimeout(klok); mis(e); });
    k.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const regel = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!regel) continue;
        const bericht = JSON.parse(regel);
        antwoorden.set(bericht.id, bericht);
        if (antwoorden.size === aanroepen.length + 1) {
          clearTimeout(klok);
          k.stdin.end();
          klaar(aanroepen.map((_, n) => antwoorden.get(n + 2)));
        }
      }
    });
    const schrijf = (o) => k.stdin.write(JSON.stringify(o) + "\n");
    schrijf({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-vakwerk-scharnieren", version: "1" } } });
    aanroepen.forEach((a, n) => schrijf({ jsonrpc: "2.0", id: n + 2, method: "tools/call", params: { name: a.name, arguments: a.arguments } }));
  });
}
function lees(antwoord) {
  if (antwoord?.error) return { fout: JSON.stringify(antwoord.error) };
  const r = antwoord?.result;
  const tekst = r?.content?.[0]?.text ?? "";
  if (r?.isError) return { fout: tekst };
  try { return { uit: r?.structuredContent ?? JSON.parse(tekst) }; } catch { return { fout: tekst }; }
}

if (!existsSync(MCP_SERVER)) {
  ok("MCP-server gevonden — bouw hem met `cargo build --release -p openaec-mcp-server` (na `npm run build:sidecar`)", false, MCP_SERVER);
} else {
  const a = (await mcp([
    { name: "validate_fem_model", arguments: { model: VAKWERK() } },
    { name: "solve_fem_model", arguments: { model: VAKWERK(), combinations: COMBI } },
  ])).map(lees);
  ok("MCP validate: ok:true", a[0].uit?.ok === true, JSON.stringify(a[0].uit?.errors ?? a[0].fout));
  ok("MCP solve: rekent (was MODEL_ONOPLOSBAAR)", a[1].uit !== undefined, (a[1].fout ?? "").slice(0, 200));
  ok("MCP solve: geen \"EERSTE ORDE NIET TOEGESTAAN\"", !(a[1].uit?.warnings ?? []).some((m) => /EERSTE ORDE NIET TOEGESTAAN/.test(m)),
    JSON.stringify(a[1].uit?.warnings));
  const c = a[1].uit?.combinations?.["1"];
  for (const id of [1, 5, 6, 10, 12]) check(`MCP N${id} (kN)`, c?.elements?.[String(id)]?.N, N_HAND[id]);
  check("MCP reactie knoop 1 (kN)", c?.reactions?.["1"]?.fz, 45);
  check("MCP zakking knoop 3 (mm)", -c?.displacements?.["3"]?.uz, zakking3, 1e-6 * Math.max(1, zakking3) + 1e-9);
}

log(`\n${failed === 0 ? "GESLAAGD" : "GEFAALD"}: ${passed} geslaagd, ${failed} gefaald.`);
process.exit(failed === 0 ? 0 : 1);
