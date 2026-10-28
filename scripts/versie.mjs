// Versienummer volgens de OpenAEC Blueprint: JJJJ.W.N (jaar, ISO-week zonder
// voorloopnul, volgnummer binnen de week vanaf 0). Git-tag: vJJJJ.W.N.
// Issues #216 (alles in de repo op hetzelfde nummer) en #211 (één script dat
// ook de solverbundel opnieuw bouwt, zodat er één consistente wijziging is).
//
// Het nummer staat op deze plekken, die gelijk moeten blijven:
//   - package.json en package-lock.json in de root en in design-mockup/;
//   - src-tauri/tauri.conf.json en src-tauri/Cargo.toml;
//   - Cargo.toml van elke crate in src-tauri/crates/ (behalve de vendored
//     openaec-layout, die het nummer van zijn bronproject houdt);
//   - de oude sjabloonmap design-mockup/src-tauri/ (tauri.conf.json, Cargo.toml);
//   - de bijbehorende regels in src-tauri/Cargo.lock en design-mockup/src-tauri/Cargo.lock;
//   - de MCP-solverbundel (fem-kernel.mjs neemt de versie uit design-mockup/package.json).
// De MSI krijgt een eigen nummer in src-tauri/tauri.windows.conf.json
// (bundle.windows.wix.version): Windows Installer staat als hoofdversie
// hooguit 255 toe, dus JJJJ.W.N wordt daar (JJJJ-2000).W.N.
//
// Gebruik (vanuit de root):
//   npm run versie                       toont alle plekken
//   npm run versie -- --check            faalt als iets afwijkt (ook de bundel)
//   npm run versie -- --set 2026.44.1    zet het nummer en bouwt de bundel
//   npm run versie -- --next             volgende nummer voor vandaag
//   ... --zonder-bundel                  bundel niet opnieuw bouwen
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const r = (...p) => join(ROOT, ...p);
const VORM = /^(\d{4})\.([1-9]\d?)\.(0|[1-9]\d*)$/;
const VENDORED = new Set(["openaec-layout"]);
const lees = (p) => readFileSync(p, "utf8");

const JSON_VERSIE = [
  "package.json",
  "design-mockup/package.json",
  "src-tauri/tauri.conf.json",
  "design-mockup/src-tauri/tauri.conf.json",
];
const NPM_LOCKS = ["package-lock.json", "design-mockup/package-lock.json"];
const crates = readdirSync(r("src-tauri/crates"))
  .filter((n) => existsSync(r("src-tauri/crates", n, "Cargo.toml")) && !VENDORED.has(n));
const TOML_VERSIE = [
  "src-tauri/Cargo.toml",
  "design-mockup/src-tauri/Cargo.toml",
  ...crates.map((n) => `src-tauri/crates/${n}/Cargo.toml`),
];
const BUNDEL = "src-tauri/crates/openaec-mcp-server/assets/fem-kernel.mjs";
const WINDOWS = "src-tauri/tauri.windows.conf.json";

const CARGO_VERSIE = /^(version = ")([^"]+)(")/m;
const cargoNaam = (p) => /^name = "([^"]+)"/m.exec(lees(r(p)))?.[1];
const lockRegel = (naam) => new RegExp(`(\\[\\[package\\]\\]\\nname = "${naam.replace(/[-]/g, "\\-")}"\\nversion = ")([^"]+)(")`);
/** Pakketten per Cargo.lock: welke crates er hun versie in hebben. */
const CARGO_LOCKS = {
  "src-tauri/Cargo.lock": ["src-tauri/Cargo.toml", ...crates.map((n) => `src-tauri/crates/${n}/Cargo.toml`)],
  "design-mockup/src-tauri/Cargo.lock": ["design-mockup/src-tauri/Cargo.toml"],
};

function msiVersie(v) {
  const [, j, w, n] = VORM.exec(v);
  return `${Number(j) - 2000}.${w}.${n}`;
}

/** Alle plekken met hun huidige waarde. */
function huidige() {
  const uit = {};
  for (const p of JSON_VERSIE) uit[p] = JSON.parse(lees(r(p))).version;
  for (const p of NPM_LOCKS) {
    const j = JSON.parse(lees(r(p)));
    uit[p] = j.version;
    uit[`${p} (packages[""])`] = j.packages?.[""]?.version;
  }
  for (const p of TOML_VERSIE) uit[p] = CARGO_VERSIE.exec(lees(r(p)))?.[2];
  for (const [lock, tomls] of Object.entries(CARGO_LOCKS)) {
    const tekst = lees(r(lock));
    for (const t of tomls) {
      const naam = cargoNaam(t);
      uit[`${lock} (${naam})`] = lockRegel(naam).exec(tekst)?.[2];
    }
  }
  uit[`${WINDOWS} (wix)`] = JSON.parse(lees(r(WINDOWS))).bundle?.windows?.wix?.version;
  return uit;
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dag = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dag);
  const jaar = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(jaar, 0, 1)) / 864e5 + 1) / 7);
  return { jaar, week };
}

function zet(v, metBundel) {
  if (!VORM.test(v)) {
    console.error(`ongeldig versienummer "${v}": verwacht JJJJ.W.N, bv. 2026.44.0`);
    process.exit(1);
  }
  // Alleen het versieveld vervangen, zodat opmaak en volgorde behouden blijven.
  for (const p of JSON_VERSIE) writeFileSync(r(p), lees(r(p)).replace(/("version":\s*")[^"]+(")/, `$1${v}$2`));
  for (const p of NPM_LOCKS) {
    // Eerste "version" is die van het project, de tweede die van packages[""].
    let n = 0;
    writeFileSync(r(p), lees(r(p)).replace(/("version":\s*")[^"]+(")/g, (m, a, b) => (n++ < 2 ? `${a}${v}${b}` : m)));
  }
  for (const p of TOML_VERSIE) writeFileSync(r(p), lees(r(p)).replace(CARGO_VERSIE, `$1${v}$3`));
  for (const [lock, tomls] of Object.entries(CARGO_LOCKS)) {
    let tekst = lees(r(lock));
    for (const t of tomls) tekst = tekst.replace(lockRegel(cargoNaam(t)), `$1${v}$3`);
    writeFileSync(r(lock), tekst);
  }
  const windows = JSON.parse(lees(r(WINDOWS)));
  windows.bundle.windows.wix = { ...windows.bundle.windows.wix, version: msiVersie(v) };
  writeFileSync(r(WINDOWS), JSON.stringify(windows, null, 2) + "\n");
  console.log(`versie ${v} (MSI ${msiVersie(v)})`);
  if (metBundel) {
    console.log("> npm run build:sidecar (de bundel draagt de versie)");
    const b = spawnSync("npm", ["run", "build:sidecar"], { cwd: r("design-mockup"), stdio: "inherit", shell: process.platform === "win32" });
    if (b.status !== 0) {
      console.error("build:sidecar mislukt; de bundel heeft nog de oude versie");
      process.exit(b.status ?? 1);
    }
  }
}

const args = process.argv.slice(2);
const metBundel = !args.includes("--zonder-bundel");
const nu = huidige();
const app = nu["design-mockup/package.json"];

if (args[0] === "--set") {
  zet(args[1] ?? "", metBundel);
} else if (args[0] === "--next") {
  const { jaar, week } = isoWeek(new Date());
  const m = VORM.exec(app);
  const n = m && Number(m[1]) === jaar && Number(m[2]) === week ? Number(m[3]) + 1 : 0;
  zet(`${jaar}.${week}.${n}`, metBundel);
} else if (args[0] === "--check") {
  const fouten = [];
  if (!VORM.test(app ?? "")) fouten.push(`design-mockup/package.json: "${app}" is geen JJJJ.W.N`);
  for (const [plek, v] of Object.entries(nu)) {
    const verwacht = plek.includes("(wix)") && VORM.test(app ?? "") ? msiVersie(app) : app;
    if (v !== verwacht) fouten.push(`${plek}: "${v}", verwacht "${verwacht}"`);
  }
  // De bundel neemt de versie letterlijk over (sidecar.ts → PAKKET_VERSIE).
  if (!lees(r(BUNDEL)).includes(`"${app}"`)) fouten.push(`${BUNDEL}: bevat versie "${app}" niet; draai npm run build:sidecar`);
  if (fouten.length) {
    console.error(fouten.join("\n"));
    process.exit(1);
  }
  console.log(`versie ${app} klopt op alle ${Object.keys(nu).length + 1} plekken`);
} else {
  for (const [plek, v] of Object.entries(nu)) console.log(`${plek}: ${v}`);
}
