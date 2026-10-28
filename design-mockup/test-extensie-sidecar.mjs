import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const { verwerkVerzoekAsync } = await import("./src/mcp/sidecar.ts");
const { deserializeProject } = await import("./src/io/projectFile.ts");

const hier = dirname(fileURLToPath(import.meta.url));
const fixture = join(hier, "test-fixtures", "extensie-voorbeeld");
const map = mkdtempSync(join(tmpdir(), "ofs-extensie-sidecar-"));
let geslaagd = 0;
const vraag = (payload) => verwerkVerzoekAsync({ v: 1, id: ++geslaagd, op: "extensie_importeren", payload });
try {
  const path = join(fixture, "voorbeeld.demofem");
  const saveAs = join(map, "import.ifcfem");
  const goed = await vraag({ path, saveAs, extensionDirs: [fixture] });
  assert.equal(goed.ok, true, JSON.stringify(goed));
  assert.equal(goed.result.extension.id, "org.openaec.voorbeeld");
  assert.equal(goed.result.messages.length, 2);
  const project = deserializeProject(readFileSync(saveAs, "utf8"));
  assert.equal(project.nodes.length, 4);
  assert.equal(project.beams.length, 3);
  console.log("  ✓ de voorbeeldextensie schrijft een project dat de app strikt kan openen");

  const onbekend = await vraag({ path: join(map, "onbekend.txt"), saveAs, extensionDirs: [fixture] });
  assert.equal(onbekend.ok, false);
  assert.equal(onbekend.error.code, "NIET_GEVONDEN");
  const uit = await vraag({ path, saveAs, extensionDirs: [fixture], disabledIds: ["org.openaec.voorbeeld"] });
  assert.equal(uit.ok, false);
  assert.equal(uit.error.code, "NIET_GEVONDEN");
  console.log("  ✓ onbekende bestandstypen en uitgeschakelde extensies worden geweigerd");

  const verkeerde = await vraag({ path, saveAs, extensionDirs: [fixture], importer: "niet-bestaand" });
  assert.equal(verkeerde.ok, false);
  assert.equal(verkeerde.error.code, "NIET_GEVONDEN");
  const ongeldigeInvoer = await vraag({ path, saveAs, extensionDirs: [fixture], extra: true });
  assert.equal(ongeldigeInvoer.ok, false);
  assert.equal(ongeldigeInvoer.error.code, "INVOER_ONGELDIG");
  console.log("  ✓ importeurkeuze en streng payload-schema");

  const foutMap = join(map, "fout-extensie");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(foutMap);
  writeFileSync(join(foutMap, "extension.json"), readFileSync(join(fixture, "extension.json")));
  writeFileSync(join(foutMap, "index.js"), "globalThis.openFemExtension = { importFile() { return { project: { version: 99 }, messages: [] }; } };");
  const voor = readFileSync(saveAs, "utf8");
  const fout = await vraag({ path, saveAs, extensionDirs: [foutMap] });
  assert.equal(fout.ok, false);
  assert.equal(fout.error.code, "BESTAND_ONLEESBAAR");
  assert.equal(readFileSync(saveAs, "utf8"), voor);
  console.log("  ✓ een ongeldig project laat het bestaande doelbestand onaangetast");

  console.log("4 geslaagd, 0 gefaald");
} finally {
  rmSync(map, { recursive: true, force: true });
}
