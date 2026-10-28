// Issue #99: natuurstenen elementen — formulier → bouwer → toetsbrug.
//
// ── HANDBEREKENING ─────────────────────────────────────────────────────────
// Latei 100 × 200 mm, vrij opgelegd over 1,50 m, ingemetseld (zijdelings gesteund).
// Alle factoren zijn TESTWAARDEN (geen richtlijn): γ_M = 2,0, k_vocht = 0,9,
// k_duur = 0,8, γ_G = 1,2, ρ = 27 kN/m³, f_vk = 1,5, E = 50 000, grens l/500.
//   Buigproeven 14,2 15,8 13,5 16,1 14,9 15,3 N/mm², lognormaal:
//     k_6 = t(5; 0,95)·√(7/6) = 2,015048·1,080123 = 2,176501 (NEN-EN 1990 tabel D.1: 2,18)
//     m_Y = 2,703996, s_Y = 0,066560 ⇒ f_f,k = exp(m_Y − k_6 s_Y) = 12,92454 N/mm²
//     f_f,d = 0,9·0,8·12,92454/2,0 = 4,652836 N/mm²
//   q_Ed = 6,0 + 1,2·27·0,1·0,2 = 6,648 kN/m; M_Ed = 6,648·1,5²/8 = 1,869750 kNm
//   σ_t = 1,86975e6/(100·200²/6) = 2,804625 N/mm² ⇒ UC = 0,602778
//   V_Ed = 4,986 kN; τ = 1,5·4986/20 000 = 0,37395; f_v,d = 0,72·1,5/2 = 0,54 ⇒ UC = 0,6925
//   w = 5·5,04·1500⁴/(384·50 000·100·200³/12) = 0,099668 mm ≤ 3,0 mm
// Dezelfde latei staat in src-tauri/crates/natuursteen-check/tests/handberekening.rs.
//
// Draaien met: node scripts/run-tests.mjs --filter=natuursteen-check

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const TOETSBRUG = join(REPO, "src-tauri", "target", "release", process.platform === "win32" ? "toetsbrug.exe" : "toetsbrug");

const { bouwNatuursteenInvoer, leegNatuursteenFormulier, leesWaarden } = await import("./src/lib/natuursteenCheckBuilder.ts");

let passed = 0, failed = 0;
const log = (s = "") => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
}
function dicht(naam, gemeten, verwacht, tolRel) {
  ok(naam, Number.isFinite(gemeten) && Math.abs(gemeten - verwacht) <= tolRel * Math.abs(verwacht),
    `${Number(gemeten).toFixed(6)} vs ${verwacht.toFixed(6)}`);
}

// Handberekening in JS (t-kwantiel uit de tabel: t(5; 0,95) = 2,0150484).
const X = [14.2, 15.8, 13.5, 16.1, 14.9, 15.3];
const Y = X.map(Math.log);
const mY = Y.reduce((a, b) => a + b) / 6;
const sY = Math.sqrt(Y.reduce((a, y) => a + (y - mY) ** 2, 0) / 5);
const K6 = 2.0150484 * Math.sqrt(7 / 6);
const FFK = Math.exp(mY - K6 * sY);
const FFD = 0.72 * FFK / 2.0;
dicht("hand f_f,k = 12,92454 N/mm²", FFK, 12.92454, 1e-6);

function formulier() {
  const f = leegNatuursteenFormulier();
  const nw = (waarde) => ({ waarde, bron: "testwaarde" });
  Object.assign(f, {
    naam: "latei L1", soort: "Latei", steensoort: "testkalksteen", buigproef: "En12372",
    buig: { wijze: "Proefresultaten", waarden: "14,2; 15,8 13,5;16,1 14,9 15,3", verdeling: "Lognormaal", karakteristiek: "", bron: "testrapport" },
    druk: { wijze: "Karakteristiek", waarden: "", verdeling: "Lognormaal", karakteristiek: "80", bron: "testwaarde" },
    b: "100", h: "200", zijdelingsGesteund: true,
    belasting: "Ligger", schema: "VrijOpgelegd", l: "1,5", q: "6", f: "0", metEigenGewicht: true,
    metOplegging: true, fOpl: "5", aOpl: "100",
    metDoorbuiging: true, qSer: "4,5", fSer: "0",
  });
  f.opgave = { ...f.opgave, gammaM: nw("2,0"), kVocht: nw("0,9"), kDuur: nw("0,8"), fvk: nw("1,5"), e: nw("50000"),
    rho: nw("27"), gammaG: nw("1,2"), grens: nw("500") };
  return f;
}

log("\n[1] Bouwer");
ok("proefwaarden: komma, spatie en puntkomma", JSON.stringify(leesWaarden("14,2; 15,8 13,5")) === "[14.2,15.8,13.5]" && leesWaarden("1 x") === null);
const leeg = bouwNatuursteenInvoer(leegNatuursteenFormulier());
ok("leeg formulier: γ_M en buigsterkte verplicht, geen invoer",
  !leeg.invoer && leeg.fouten.some((f) => f.veld === "gammaM") && leeg.fouten.some((f) => f.veld === "buig"));
const tweeProeven = formulier();
tweeProeven.buig.waarden = "14 15";
ok("minder dan 3 proefwaarden geweigerd", bouwNatuursteenInvoer(tweeProeven).fouten.some((f) => f.veld === "buig" && f.melding.includes("3")));
const zonderBron = formulier();
zonderBron.opgave.kVocht = { waarde: "0,9", bron: "" };
ok("reductiefactor zonder bron geweigerd", bouwNatuursteenInvoer(zonderBron).fouten.some((f) => f.veld === "kVocht" && f.melding.includes("bron")));
const teGroot = formulier();
teGroot.opgave.kDuur = { waarde: "1,2", bron: "x" };
ok("reductiefactor > 1 geweigerd", bouwNatuursteenInvoer(teGroot).fouten.some((f) => f.veld === "kDuur"));
const { invoer, fouten } = bouwNatuursteenInvoer(formulier());
ok("volledig formulier: invoer zonder fouten", invoer && fouten.length === 0, JSON.stringify(fouten));
ok("twee reductiefactoren met naam en bron", invoer.materiaal.reductiefactoren.length === 2
  && invoer.materiaal.reductiefactoren[0].naam === "vochttoestand" && invoer.materiaal.reductiefactoren[1].naam === "belastingsduur");
ok("γ_G bij de ligger, volumiek gewicht bij het materiaal", invoer.belasting.gamma_g?.waarde === 1.2 && invoer.materiaal.volumiek_gewicht?.waarde === 27);
ok("k_vorst leeg → niet meegestuurd", !invoer.materiaal.reductiefactoren.some((r) => r.naam === "vorst"));

log("\n[2] Toetsbrug: handberekening");
if (!existsSync(TOETSBRUG)) {
  ok("toetsbrug gevonden — bouw hem met `cargo build --release -p toetsbrug`", false, TOETSBRUG);
} else {
  const roep = (opdracht, inputs) => new Promise((res, rej) => {
    const c = spawn(TOETSBRUG, [], { stdio: ["pipe", "pipe", "pipe"] });
    let o = ""; c.stdout.on("data", (d) => (o += d)); c.on("error", rej);
    c.on("close", (code) => (code === 0 ? res(JSON.parse(o)) : rej(new Error(`toetsbrug code ${code}: ${o}`))));
    c.stdin.end(JSON.stringify({ opdracht, inputs }));
  });
  const [r] = await roep("check_natural_stone_elements", [invoer]);
  const c = (id) => r.checks.find((x) => x.id === id)?.kind?.data;
  dicht("NEN-EN 1990 tabel D.1: k_6 = 2,176501", r.sterkte.buig.statistiek.k_n, K6, 1e-6);
  dicht("f_f,k lognormaal = 12,92454", r.sterkte.buig.karakteristiek, FFK, 1e-6);
  dicht("f_f,d = 4,652836", r.sterkte.f_fd_mpa, FFD, 1e-6);
  dicht("M_Ed = 1,869750 kNm", r.krachten.m_ed_knm, 1.86975, 1e-12);
  dicht("σ_t = 2,804625 N/mm²", c("buiging").uc.ed, 2.804625, 1e-9);
  dicht("UC buiging = 0,602778", c("buiging").uc.uc, 2.804625 / FFD, 1e-6);
  dicht("τ = 0,37395 N/mm²", c("afschuiving").uc.ed, 0.37395, 1e-9);
  dicht("oplegdruk 0,5 tegen f_c,d = 28,8", c("oplegdruk").uc.rd, 28.8, 1e-12);
  dicht("doorbuiging 0,099668 mm", c("doorbuiging").uc.ed, 5 * 5.04 * 1500 ** 4 / (384 * 50000 * (100 * 200 ** 3 / 12)), 1e-9);
  ok("maatgevend afschuiving, alles getoetst → Ok", r.governing_check_id === "afschuiving" && r.status === "Ok" && r.niet_getoetst.length === 0,
    r.niet_getoetst.join("; "));
  ok("bron van γ_M in de toelichting", r.notes.some((n) => n.includes("γ_M = 2 (bron: testwaarde)")));

  const zonderSteun = structuredClone(invoer);
  zonderSteun.zijdelings_gesteund = false;
  const [r2] = await roep("check_natural_stone_elements", [zonderSteun]);
  ok("h > b zonder zijdelingse steun: kip niet getoetst, nooit Ok", r2.status === "NotApplicable" && r2.niet_getoetst.some((n) => n.startsWith("kip")));
  const zonderFvk = structuredClone(invoer);
  delete zonderFvk.materiaal.schuifsterkte;
  const [r3] = await roep("check_natural_stone_elements", [zonderFvk]);
  ok("zonder f_vk: afschuiving niet getoetst, nooit Ok", r3.status === "NotApplicable" && r3.niet_getoetst.some((n) => n.startsWith("afschuiving")));
  const fout = structuredClone(invoer);
  fout.materiaal.gamma_M = 1;
  let geweigerd = false;
  try { await roep("check_natural_stone_elements", [fout]); } catch { geweigerd = true; }
  ok("tikfout in een veldnaam wordt geweigerd", geweigerd);
}

log("\n[3] Bron: drie wegen geregistreerd");
const lib = readFileSync(join(REPO, "src-tauri", "src", "lib.rs"), "utf8");
ok("Tauri: check_natural_stone_elements in generate_handler!", /generate_handler!\[[\s\S]*check_natural_stone_elements,[\s\S]*\]/.test(lib));
const brug = readFileSync(join(REPO, "src-tauri", "crates", "toetsbrug", "src", "lib.rs"), "utf8");
ok("toetsbrug: opdracht check_natural_stone_elements", brug.includes('"check_natural_stone_elements" =>'));
const mcp = readFileSync(join(REPO, "src-tauri", "crates", "openaec-mcp-server", "src", "natural_stone_tools.rs"), "utf8");
ok("MCP: tool check_natural_stone_elements", mcp.includes('"name": "check_natural_stone_elements"'));

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);
