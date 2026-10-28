// Haalt de iconen uit de OpenAEC Blueprint-repository en schrijft ze naar
// design-mockup/src/components/ribbon/b2IconData.ts.
//
// Alleen de iconen die de broncode opvraagt met b2("<id>") komen erin:
//   - B2-iconen uit web/icons/*.svg (16 en 24 px, revisie in de sprite);
//   - FEM-iconen (fem.*) uit design/icon-drafts/fem/*.svg, en waar die
//     bestaat de 16 px-versie uit design/icon-drafts-small/fem/. Deze staan in
//     Blueprint nog als "visual-draft" (design/domain-icon-drafts.json).
//
// Gebruik: node scripts/b2-iconen.mjs <pad naar OpenAEC-Blueprint>
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "design-mockup/src");
const UIT = join(SRC, "components/ribbon/b2IconData.ts");
const BP = process.argv[2];
if (!BP || !existsSync(join(BP, "web/icons"))) {
  console.error("gebruik: node scripts/b2-iconen.mjs <pad naar OpenAEC-Blueprint>");
  process.exit(1);
}

// 1. Welke id's vraagt de code op?
function bestanden(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return bestanden(p);
    return /\.(ts|tsx)$/.test(n) && p !== UIT ? [p] : [];
  });
}
const gevraagd = new Set();
for (const f of bestanden(SRC)) {
  for (const m of readFileSync(f, "utf8").matchAll(/\bb2\(\s*"([a-z0-9.-]+)"/g)) gevraagd.add(m[1]);
}

// 2. B2-symbolen uit alle sprites (eerste vondst per id).
const symbolen = new Map();
for (const n of readdirSync(join(BP, "web/icons")).filter((n) => n.endsWith(".svg")).sort()) {
  const s = readFileSync(join(BP, "web/icons", n), "utf8");
  for (const m of s.matchAll(/<symbol id="i(16|24)-([^"]+)" viewBox="([^"]+)">([\s\S]*?)<\/symbol>/g)) {
    const [, maat, id, viewBox, inhoud] = m;
    const sleutel = `${maat}:${id}`;
    if (!symbolen.has(sleutel)) symbolen.set(sleutel, { viewBox, inhoud });
  }
}

// 3. FEM-ontwerpen: lijnwerk in #36363E wordt currentColor.
function femSvg(pad) {
  if (!existsSync(pad)) return undefined;
  const s = readFileSync(pad, "utf8").trim();
  const viewBox = /viewBox="([^"]+)"/.exec(s)[1];
  const attrs = /<svg([^>]*)>/.exec(s)[1]
    .replace(/\s(xmlns|width|height|viewBox)="[^"]*"/g, "")
    .replace(/#36363E/gi, "currentColor");
  const inhoud = s.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "").replace(/#36363E/gi, "currentColor");
  return { viewBox, inhoud: `<g${attrs}>${inhoud}</g>` };
}

const data = {};
const ontbreekt = [];
for (const id of [...gevraagd].sort()) {
  let groot, klein;
  if (id.startsWith("fem.")) {
    const naam = id.slice(4);
    groot = femSvg(join(BP, "design/icon-drafts/fem", `${naam}.svg`));
    klein = femSvg(join(BP, "design/icon-drafts-small/fem", `${naam}.svg`));
  } else {
    groot = symbolen.get(`24:${id}`);
    klein = symbolen.get(`16:${id}`);
  }
  if (!groot) { ontbreekt.push(id); continue; }
  data[id] = klein ? [groot.viewBox, groot.inhoud, klein.viewBox, klein.inhoud] : [groot.viewBox, groot.inhoud];
}
if (ontbreekt.length) {
  console.error(`niet gevonden in Blueprint: ${ontbreekt.join(", ")}`);
  process.exit(1);
}

let commit = "onbekend";
try {
  commit = execFileSync("git", ["-C", BP, "log", "-1", "--format=%h"], { encoding: "utf8" }).trim();
} catch { /* geen git-checkout */ }

const regels = Object.entries(data).map(([id, v]) => `  ${JSON.stringify(id)}: ${JSON.stringify(v)},`);
writeFileSync(UIT, `// Gegenereerd door scripts/b2-iconen.mjs uit OpenAEC-Blueprint (commit ${commit}).
// Niet met de hand aanpassen; gebruik b2() uit ./b2Icons.
// Per id: [viewBox 24 px, inhoud 24 px, viewBox 16 px?, inhoud 16 px?].
// fem.* zijn de FEM-ontwerpen (Blueprint: design/icon-drafts/fem, status visual-draft).
export const B2_DATA: Record<string, string[]> = {
${regels.join("\n")}
};
`);
console.log(`${Object.keys(data).length} iconen naar ${UIT.replace(ROOT + "/", "")} (Blueprint ${commit})`);
