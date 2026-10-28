// #231: in de MCP-modelvorm staat `selfWeightEnabled` standaard UIT. Dat
// moet het antwoord van solve/check ALTIJD zeggen, met het niet meegenomen
// gewicht in kN en per belastinggeval of het eigen gewicht erin zit.
//
// Model uit het issue: vrij opgelegde IPE300/S235, L = 200 m (bewust extreem),
// scharnier + rol, één blijvend geval G met q = 0,01 kN/m.
//
// Handberekening:
//   g_k = ρ·A·g = 7850 kg/m³ · 5380 mm² · 1e-6 · 9,81 m/s² = 0,41431 kN/m
//         (ρ staal EN 1991-1-1 tabel A.4; A IPE300 = 53,8 cm² uit de
//         profieldatabase; het issue rekent met 5381 mm² → 0,4144 kN/m)
//   G_eg = 0,41431 · 200 = 82,861 kN  (issue: 82,9 kN; weggevallen in run a)
//   run a: R = 0,01 · 200 / 2                     = 1,000 kN per steun
//   run b: R = (0,41431 + 0,01) · 200 / 2          = 42,431 kN per steun
//          (issue: 42,44 hand / 42,43 externe referentie)
//
// Draaien met: npx tsx test-eigen-gewicht-mcp.mjs
import { verwerkVerzoek } from "./src/mcp/sidecar.ts";

let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}${detail ? " — " + detail : ""}`); }
  else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};
const bijna = (a, b, tol) => Math.abs(a - b) <= tol;

const L = 200_000; // mm
const model = (extra) => ({
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: L, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, material: "S235", profile: "IPE300" }],
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
  plates: [],
  loadCases: [{ id: 1, name: "G", type: "dead" }, { id: 2, name: "Q", type: "live" }],
  loads: [
    { id: 1, type: "lineLoad", caseId: 1, beamId: 1, q: -0.01 },
    { id: 2, type: "lineLoad", caseId: 2, beamId: 1, q: -0.01 },
  ],
  ...extra,
});

const gk = (7850 * 5380e-6 * 9.81) / 1000; // kN/m
const G_EG = gk * (L / 1000);              // kN
const vraag = (op, m) => verwerkVerzoek({ v: 1, id: 1, op, payload: { model: m } });

console.log("[1] run a: selfWeightEnabled weggelaten");
{
  const r = vraag("solve", model({}));
  check("solve slaagt", r.ok === true, r.error?.melding ?? "");
  const sw = r.result?.self_weight;
  check("self_weight.enabled = false", sw?.enabled === false);
  check(`niet meegenomen staafgewicht = ${G_EG.toFixed(3)} kN (hand)`,
    bijna(sw?.beams_weight_kN, G_EG, 0.01), String(sw?.beams_weight_kN));
  check("per belastinggeval: G en Q zonder eigen gewicht",
    sw?.included_per_case?.["1"] === false && sw?.included_per_case?.["2"] === false,
    JSON.stringify(sw?.included_per_case));
  const melding = (r.result?.warnings ?? []).find((w) => w.includes("Eigen gewicht staat UIT"));
  check("warnings meldt dat eigen gewicht uitstaat", melding !== undefined);
  check("… met het weggevallen totaal 82,9 kN", melding?.includes("82,9 kN") === true, melding);
  check("… en waar het met selfWeightEnabled: true terechtkomt",
    melding?.includes("selfWeightEnabled: true") && melding?.includes("belastinggeval 1"), melding);
  const R = r.result?.per_case?.["1"]?.reactions;
  check("reactie per steun in G = 1,00 kN (zonder eigen gewicht)",
    bijna(R?.["1"]?.fz, 1.0, 1e-6) && bijna(R?.["2"]?.fz, 1.0, 1e-6), JSON.stringify(R));

  const c = vraag("check", model({}));
  check("check meldt het ook", c.ok === true
    && (c.result?.warnings ?? []).some((w) => w.includes("Eigen gewicht staat UIT"))
    && c.result?.self_weight?.enabled === false, c.error?.melding ?? "");
}

console.log("\n[2] run b: selfWeightEnabled: true");
{
  const r = vraag("solve", model({ selfWeightEnabled: true }));
  check("solve slaagt", r.ok === true, r.error?.melding ?? "");
  const sw = r.result?.self_weight;
  check("self_weight.enabled = true, in geval 1 \"G\"",
    sw?.enabled === true && sw?.case_id === 1 && sw?.case_name === "G", JSON.stringify(sw));
  check("per belastinggeval: alleen G draagt het eigen gewicht",
    sw?.included_per_case?.["1"] === true && sw?.included_per_case?.["2"] === false);
  check("geen uit-melding", !(r.result?.warnings ?? []).some((w) => w.includes("Eigen gewicht staat UIT")));
  const R = r.result?.per_case?.["1"]?.reactions;
  const Rhand = (gk + 0.01) * (L / 1000) / 2;
  check(`reactie per steun in G = ${Rhand.toFixed(3)} kN (hand)`,
    bijna(R?.["1"]?.fz, Rhand, 1e-3) && bijna(R?.["2"]?.fz, Rhand, 1e-3), JSON.stringify(R));
}

console.log("\n[3] geen staafgewicht en geen platen: geen melding");
{
  const m = model({});
  m.beams[0].material = "VRIJ:Gewichtloos E=210000 rho=0 f=235";
  m.beams[0].profile = "100x200";
  const r = vraag("solve", m);
  check("solve slaagt", r.ok === true, r.error?.melding ?? "");
  check("zonder gewicht om weg te laten: geen uit-melding",
    !(r.result?.warnings ?? []).some((w) => w.includes("Eigen gewicht staat UIT")),
    (r.result?.warnings ?? []).join(" | "));
}

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);
