// De meldingen van de 3D-kern in het rapport (#61): de kern toetst "bijna
// verticaal" tegen Y in plaats van Z. Die meldingen vallen weg; de juiste toets
// met Z omhoog meldt alleen staven die bijna, maar niet precies verticaal staan.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const { openFem3DMeldingen } = await import("./src/components/openFem3d/openFem3dMeldingen.ts");
const { parseOpenFem3DModel } = await import("./src/components/openFem3d/openFem3dModel.ts");
const { buildOpenFem3DSolveRequest } = await import("./src/components/openFem3d/openFem3dSolver.ts");
const { deserializeProject } = await import("./src/io/projectFile.ts");
const HIER = dirname(fileURLToPath(import.meta.url));
let geslaagd = 0, gefaald = 0;
const log = (s) => console.log(s);
const check = (naam, ok, detail = "") => { if (ok) { geslaagd++; log(`  ✓ ${naam}`); } else { gefaald++; log(`  ✗ ${naam}${detail ? " — " + detail : ""}`); } };

log("[1] filter en eigen toets");
const hoek = (graden) => ({ x: Math.sin(graden * Math.PI / 180), z: Math.cos(graden * Math.PI / 180) });
const scheef = hoek(4.4);   // cos ≈ 0,99705: bijna verticaal
const flauw = hoek(10);     // cos ≈ 0,985: gewoon schuin
const model = parseOpenFem3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 0, y: 6, z: 0 },          // staaf langs Y
    { id: 3, x: 0, y: 0, z: 4 },                                       // exact verticaal (1→3)
    { id: 4, x: scheef.x * 4, y: 0, z: scheef.z * 4 },                 // bijna verticaal (1→4)
    { id: 5, x: flauw.x * 4, y: 0, z: flauw.z * 4 },                   // schuin (1→5)
  ],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "HEA 200", material: "S235" },
    { id: 2, startNodeId: 1, endNodeId: 3, profileName: "HEA 200", material: "S235" },
    { id: 3, startNodeId: 1, endNodeId: 4, profileName: "HEA 200", material: "S235" },
    { id: 4, startNodeId: 1, endNodeId: 5, profileName: "HEA 200", material: "S235" },
  ],
});
const kernMeldingen = [
  "Element 1 is nearly vertical (|cos|=1.000000) and uses default orientation — local y/z axes are near the switching threshold; consider specifying an explicit orientation vector",
  "Een andere melding van de kern",
];
const m = openFem3DMeldingen(kernMeldingen, model);
check("de onterechte melding (staaf langs Y) valt weg", !m.kern.some((x) => /nearly vertical/.test(x)));
check("andere meldingen van de kern blijven staan", m.kern.length === 1 && m.kern[0] === "Een andere melding van de kern");
check("alleen de bijna verticale staaf wordt gemeld (niet exact verticaal, niet schuin)",
  JSON.stringify(m.bijnaVerticaal.map((x) => x.beamId)) === "[3]", JSON.stringify(m.bijnaVerticaal));
check("met |cos| t.o.v. Z", Math.abs(m.bijnaVerticaal[0].cos - Math.cos(4.4 * Math.PI / 180)) < 1e-12);

log("\n[2] het rapport gebruikt het filter");
const rapport = readFileSync(join(HIER, "src", "components", "openFem3d", "OpenFem3DReport.tsx"), "utf8");
check("OpenFem3DReport toont openFem3DMeldingen, niet de ruwe lijst",
  /openFem3DMeldingen\(result\.diagnostics, model\)/.test(rapport) && !/result\.diagnostics\.map\(/.test(rapport));

log("\n[3] met de kern: de staalhal");
const solverBinary = process.platform === "win32" ? "open-fem-3d.exe" : "open-fem-3d";
const solverPath = process.env.OPEN_FEM_3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
if (!existsSync(solverPath)) {
  log("  · overgeslagen: bouw eerst de 3D-kern (cargo build -p open-fem-3d)");
} else {
  const hal = deserializeProject(readFileSync(join(HIER, "..", "docs", "verificatie", "3d-raamwerk", "staalhal-60x30.ifcfem"), "utf8")).model3d;
  const request = { ...buildOpenFem3DSolveRequest(hal, "linear", 1), bucklingModes: 0 };
  const result = await new Promise((ok, fout) => {
    const c = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] }); const uit = [];
    c.stdout.on("data", (d) => uit.push(d)); c.on("error", fout);
    c.on("close", () => { try { ok(JSON.parse(Buffer.concat(uit).toString())); } catch (e) { fout(e); } });
    c.stdin.end(JSON.stringify(request));
  });
  const ruw = result.diagnostics.filter((x) => /is nearly vertical/.test(x)).length;
  const gefilterd = openFem3DMeldingen(result.diagnostics, hal);
  // Sinds #61 filtert ook de adapter (crates/open-fem-3d, summarize_diagnostics)
  // deze melding: de kern geeft hem via geen enkele weg meer (app, toetsbrug, MCP).
  check(`de kern geeft geen onterechte meldingen meer voor staven langs Y (${ruw})`, ruw === 0);
  check("na het filter: geen enkele 'nearly vertical' meer", !gefilterd.kern.some((x) => /nearly vertical/.test(x)));
  check("en geen bijna verticale staven in de hal (de kolommen staan exact verticaal)", gefilterd.bijnaVerticaal.length === 0);
}

log(`\n${geslaagd} geslaagd, ${gefaald} gefaald`);
process.exit(gefaald > 0 ? 1 : 0);
