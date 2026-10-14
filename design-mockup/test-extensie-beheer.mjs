import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { maakExtensieStore, MeerdereImporteursFout } from "./src/extensies/extensieStore.ts";
import { laadExtensieScript } from "./src/mcp/extensieSidecar.ts";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "test-fixtures", "extensie-voorbeeld");
const manifest = readFileSync(join(fixture, "extension.json"), "utf8");
const script = readFileSync(join(fixture, "index.js"), "utf8");
const tweedeManifest = manifest.replace("org.openaec.voorbeeld", "org.openaec.tweede");
let tweedeAanwezig = false;
const bytes = [...readFileSync(join(fixture, "voorbeeld.demofem"))];
const instellingen = new Map([["extensies.mappen", ["/gekoppeld"]], ["extensies.uit", ["org.openaec.voorbeeld"]]]);
const aanroepen = [];
const bron = {
  async getSetting(key, fallback) { return instellingen.get(key) ?? fallback; },
  async setSetting(key, value) { instellingen.set(key, value); },
  async invoke(naam, args) {
    aanroepen.push([naam, args]);
    if (naam === "extensies_lezen") return [
      { map: "/gekoppeld", bron: "gekoppeld", manifestTekst: manifest },
      ...(tweedeAanwezig ? [{ map: "/tweede", bron: "gekoppeld", manifestTekst: tweedeManifest }] : []),
      { map: "/kapot", bron: "geinstalleerd", fout: "Ongeldig manifest" },
    ];
    if (naam === "extensie_bestand_lezen") {
      assert.ok(args.ingeschakeldeIds.includes("org.openaec.voorbeeld"));
      return bytes;
    }
    if (naam === "extensie_script_lezen") return script;
    if (naam === "extensie_zip_installeren") return "/geinstalleerd/nieuw";
    if (naam === "extensie_verwijderen") return null;
    throw Error(`Onbekend commando ${naam}`);
  },
  async draaiScript(tekst, input) { return laadExtensieScript(tekst, input.fileName).importFile(input); },
};

const winkel = maakExtensieStore(bron);
await winkel.getState().laden();
assert.equal(winkel.getState().kaarten.length, 2);
assert.equal(winkel.getState().kaarten[0].ingeschakeld, false);
assert.match(winkel.getState().kaarten[1].fout, /Ongeldig manifest/);
console.log("  ✓ kaarten tonen een uitgeschakelde extensie en een kapot manifest");

await winkel.getState().zetIngeschakeld("org.openaec.voorbeeld", true);
assert.deepEqual(instellingen.get("extensies.uit"), []);
assert.equal(winkel.getState().kaarten[0].ingeschakeld, true);
await winkel.getState().koppelMap("/nog-een-map");
assert.deepEqual(instellingen.get("extensies.mappen"), ["/gekoppeld", "/nog-een-map"]);
await winkel.getState().ontkoppel("/nog-een-map");
assert.deepEqual(instellingen.get("extensies.mappen"), ["/gekoppeld"]);
console.log("  ✓ aan/uit, koppelen en ontkoppelen worden per machine bewaard");

const resultaat = await winkel.getState().importeer("/model/voorbeeld.demofem");
assert.match(resultaat.uitkomst.projectTekst, /"format"/);
assert.equal(resultaat.uitkomst.meldingen.length, 2);
assert.equal(resultaat.extensie.id, "org.openaec.voorbeeld");
assert.ok(aanroepen.some(([naam]) => naam === "extensie_bestand_lezen"));
console.log("  ✓ import gebruikt Rust-bytes, het extensiescript en de strikte projectlezer");

tweedeAanwezig = true;
await winkel.getState().laden();
await assert.rejects(() => winkel.getState().importeer("/model/voorbeeld.demofem"), (fout) => {
  assert.ok(fout instanceof MeerdereImporteursFout);
  assert.deepEqual(fout.keuzes.map((keuze) => keuze.id), ["org.openaec.voorbeeld/demofem", "org.openaec.tweede/demofem"]);
  return true;
});
const gekozen = await winkel.getState().importeer("/model/voorbeeld.demofem", "org.openaec.tweede/demofem");
assert.equal(gekozen.extensie.id, "org.openaec.tweede");
tweedeAanwezig = false;
await winkel.getState().laden();
console.log("  ✓ bij twee importeurs kiest de app de gevraagde extensie en importeur");

await assert.rejects(() => winkel.getState().importeer("/model/ongekend.txt"), /Geen ingeschakelde importeur/);
await winkel.getState().zetIngeschakeld("org.openaec.voorbeeld", false);
await assert.rejects(() => winkel.getState().importeer("/model/voorbeeld.demofem"), /Geen ingeschakelde importeur/);
console.log("  ✓ onbekend en uitgeschakeld bestandstype worden geweigerd");

await winkel.getState().installeerZip("/pakket.zip");
await winkel.getState().verwijder("/geinstalleerd/nieuw");
assert.ok(aanroepen.some(([naam, args]) => naam === "extensie_zip_installeren" && args.zipPad === "/pakket.zip"));
assert.ok(aanroepen.some(([naam]) => naam === "extensie_verwijderen"));
assert.equal(typeof MeerdereImporteursFout, "function");
console.log("  ✓ installeren en verwijderen lopen via Rust en verversen de kaarten");

console.log("6 geslaagd, 0 gefaald");
