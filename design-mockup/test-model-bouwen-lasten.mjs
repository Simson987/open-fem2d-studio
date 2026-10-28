// #215: `gui_build_model` (bedieningsopdracht `model_bouwen`) met meerdere
// lasten in ÉÉN aanroep bewaarde alleen de laatste, met id 1.
//
// Oorzaak: `addLoad` las `latestRef.current`, en die ref werd pas na een
// render bijgewerkt. Een synchrone lus over `addLoad` (precies wat
// `model_bouwen` doet) zag dus vier keer dezelfde lege lastenlijst: elke last
// kreeg id 1 en de laatste `setLoads` won.
//
// Deze test roept de ECHTE hook aan, binnen één render van react-dom/server.
// Daar draaien geen effecten, dus de ref wordt alleen bijgewerkt als de
// mutator het zelf doet — precies de situatie van één synchrone opdracht.
// Een setter tijdens de render laat React de component opnieuw renderen; in
// die tweede ronde lezen we de state uit.
//
// Draaien met: npx tsx test-model-bouwen-lasten.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const i18next = (await import("i18next")).default;
const { initReactI18next } = await import("react-i18next");
await i18next.use(initReactI18next).init({
  lng: "cimode", ns: ["common"], defaultNS: "common", resources: {}, showSupportNotice: false,
});
const { useFemStore } = await import("./src/hooks/useFemStore.ts");

const HIER = dirname(fileURLToPath(import.meta.url));
let geslaagd = 0, gefaald = 0;
const check = (naam, ok, detail = "") => {
  if (ok) { geslaagd++; console.log(`  ✓ ${naam}`); }
  else { gefaald++; console.log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); }
};

// De vier lasten uit het issue, op staaf 1 tussen twee knopen.
const LASTEN_ZONDER_STAAF = [
  { type: "lineLoad", caseId: 1, beamId: 1, q: -0.55, qDir: "z", qCoord: "global" },
  { type: "pointForce", caseId: 2, beamId: 1, posFrac: 0.5, fz: -1.5 },
  { type: "lineLoad", caseId: 4, beamId: 1, q: -0.83, qDir: "z", qCoord: "local" },
  { type: "lineLoad", caseId: 6, beamId: 1, q: 1.162, qDir: "z", qCoord: "local" },
];

// De hook start met het voorbeeldmodel van een nieuw project; de test
// rekent daarom relatief aan wat er al staat.
let gedaan = false;
let voor = null;
let nieuw = null;
let uit = null;
function Proef() {
  const f = useFemStore();
  if (!gedaan) {
    gedaan = true;
    voor = { loads: f.loads.length, beams: f.beams.length, nodes: f.nodes.length,
      maxLoad: Math.max(0, ...f.loads.map((l) => l.id)) };
    // Dezelfde volgorde als `model_bouwen`: knopen, staven (met updates),
    // opleggingen, lasten — alles synchroon, zonder render ertussen.
    const n1 = f.addNode(0, 0);
    const n2 = f.addNode(6000, 0);
    const n3 = f.addNode(12000, 0);
    const b1 = f.addBeam(n1, n2);
    f.updateBeam(b1, { profile: "IPE300", material: "S235" });
    const b2 = f.addBeam(n2, n3);
    f.updateBeam(b2, { profile: "HEA200", material: "S355" });
    nieuw = { n: [n1, n2, n3], b: [b1, b2] };
    f.addSupport(n1, "pinned");
    f.addSupport(n3, "zRoller");
    for (const l of LASTEN_ZONDER_STAAF) f.addLoad({ ...l, beamId: b1 });
  } else if (uit === null) {
    uit = { loads: f.loads, beams: f.beams, nodes: f.nodes, supports: f.supports };
  }
  return null;
}
renderToStaticMarkup(React.createElement(Proef));

console.log("[1] meerdere lasten in één synchrone reeks (#215)");
check("de hook is opnieuw gerenderd en uitgelezen", uit !== null);
const nieuweLasten = (uit?.loads ?? []).slice(voor.loads);
check("vier lasten erbij (niet alleen de laatste)", uit.loads.length === voor.loads + 4,
  `voor ${voor.loads}, na ${uit.loads.length}`);
const verwacht = [1, 2, 3, 4].map((i) => voor.maxLoad + i);
check(`id's ${verwacht.join(", ")}: uniek en oplopend`,
  JSON.stringify(nieuweLasten.map((l) => l.id)) === JSON.stringify(verwacht),
  JSON.stringify(nieuweLasten.map((l) => l.id)));
check("alle id's in het model uniek", new Set(uit.loads.map((l) => l.id)).size === uit.loads.length);
check("volgorde en inhoud ongewijzigd (caseId 1, 2, 4, 6)",
  JSON.stringify(nieuweLasten.map((l) => l.caseId)) === "[1,2,4,6]"
    && nieuweLasten[3]?.q === 1.162 && nieuweLasten[1]?.fz === -1.5
    && nieuweLasten.every((l) => l.beamId === nieuw.b[0]),
  JSON.stringify(nieuweLasten));

console.log("\n[2] staven met updates in dezelfde reeks");
const staaf = (id) => uit.beams.find((b) => b.id === id);
check("twee staven erbij, met verschillende id's",
  uit.beams.length === voor.beams + 2 && nieuw.b[0] !== nieuw.b[1], JSON.stringify(nieuw.b));
check("de updates van de eerste staaf overleven het toevoegen van de tweede",
  staaf(nieuw.b[0])?.profile === "IPE300" && staaf(nieuw.b[0])?.material === "S235",
  JSON.stringify(staaf(nieuw.b[0])));
check("de tweede staaf draagt zijn eigen updates",
  staaf(nieuw.b[1])?.profile === "HEA200" && staaf(nieuw.b[1])?.material === "S355",
  JSON.stringify(staaf(nieuw.b[1])));
check("drie knopen erbij, met unieke id's",
  uit.nodes.length === voor.nodes + 3 && new Set(nieuw.n).size === 3);
check("beide opleggingen staan erin",
  uit.supports.some((s) => s.nodeId === nieuw.n[0] && s.type === "pinned")
    && uit.supports.some((s) => s.nodeId === nieuw.n[2] && s.type === "zRoller"));

console.log("\n[3] de bron");
const bron = readFileSync(join(HIER, "src", "hooks", "useFemStore.ts"), "utf8");
check("pushHistory werkt latestRef direct bij",
  /const pushHistory = useCallback[\s\S]{0,1500}werkBij\(latestRef/.test(bron));

console.log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);
