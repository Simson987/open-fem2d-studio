// Issue #98: metselwerk volgens NEN-EN 1996-1-1 — formulier → bouwer → toetsbrug.
//
// ── HANDBEREKENING ─────────────────────────────────────────────────────────
// Kalkzandsteen groep 1 in lijmmortel, f_b = 20 N/mm², t = 120 mm,
// h = 2,60 m, l = 3,60 m, twee verstijvende wanden op 3,00 m, betonvloeren.
// NDP-waarden zijn TESTWAARDEN (geen NB): K = 0,80, γ_M = 1,7, K_E = 1000,
// φ_∞ = 1,5, f_vk0 = 0,4, f_xk1 = 0,2.
//   §3.6.1.2  f_k = 0,80·20^0,85 = 10,2086 N/mm²; f_d = 10,2086/1,7 = 6,00505
//   §5.5.1.2  ρ_4 = 0,75/(1 + (0,75·2600/3000)²) = 0,52724; h_ef = 1370,83 mm
//   §5.5.1.1  e_init = 1370,83/450 = 3,0463 mm
//   §6.1.2.2  boven: e = 0,6/60·1000 + 3,0463 = 13,0463; Φ = 1 − 2·13,0463/120 = 0,78256;
//             N_Rd = 0,78256·120·6,00505 = 563,92 kN/m
//   bijlage G midden: e_m = 7,6617, e_k = 1,0391, e_mk = 8,7008, λ = 0,36124,
//             u = 0,46227, Φ_m = 0,76834, N_Rd = 553,67 kN/m
//   §6.2      V = 40, N = 150 kN, M = 120 kNm: l_c = 3(1800 − 800) = 3000 mm,
//             σ_d = 0,41667, f_vk = 0,5·0,4 + 0,4·0,41667 = 0,36667 (ongevuld),
//             V_Rd = 0,36667/1,7·120·3000 = 77,647 kN
//   §6.3.1    M_Rd = 0,2/1,7·1000·120²/6 = 0,28235 kNm/m
// Dezelfde wand staat in src-tauri/crates/metselwerk-check/tests/handberekening.rs.
//
// Draaien met: node scripts/run-tests.mjs --filter=metselwerk-check

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HIER, "..");
const TOETSBRUG = join(REPO, "src-tauri", "target", "release", process.platform === "win32" ? "toetsbrug.exe" : "toetsbrug");

const { bouwMetselwerkInvoer, leegMetselwerkFormulier, leesGetal } = await import("./src/lib/metselwerkCheckBuilder.ts");

let passed = 0, failed = 0;
const log = (s = "") => process.stdout.write(s + "\n");
function ok(naam, voorwaarde, extra = "") {
  if (voorwaarde) { passed++; log(`  ✓ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
  else { failed++; log(`  ✗ ${naam}${extra ? "  (" + extra + ")" : ""}`); }
}
function dicht(naam, gemeten, verwacht, tolRel) {
  ok(naam, Number.isFinite(gemeten) && Math.abs(gemeten - verwacht) <= tolRel * Math.abs(verwacht),
    `${Number(gemeten).toFixed(5)} vs ${verwacht.toFixed(5)}`);
}

const FK = 0.8 * 20 ** 0.85;
const FD = FK / 1.7;
dicht("hand f_k = 10,2086 N/mm²", FK, 10.20858, 1e-6);

function formulier() {
  const f = leegMetselwerkFormulier();
  const nw = (waarde) => ({ waarde, bron: "testwaarde" });
  Object.assign(f, {
    naam: "KZS 120", steensoort: "Kalkzandsteen", steengroep: "Groep1", mortel: "Lijm", fb: "20",
    t: "120", h: "2,6", l: "3,6", steunranden: "TweeVerticaleRanden", lRand: "3", betonvloeren: true,
    nBoven: "60", mBoven: "0,6", nMidden: "65", mMidden: "0,3", nOnder: "70", mOnder: "0",
    metAfschuiving: true, vEd: "40", nEdV: "150", mEdV: "120",
    metBuiging: true, mEdUit: "0,2", breukvlak: "EvenwijdigAanLintvoegen",
    metGeconcentreerd: true, lastNaam: "latei", nEdc: "80", lB: "150", b: "100", a1: "300", hC: "2,6", e: "0",
  });
  f.ndp = { ...f.ndp, k: nw("0,80"), gammaM: nw("1,7"), kE: nw("1000"), phiInf: nw("1,5"), fvk0: nw("0,4"), fxk1: nw("0,2") };
  return f;
}

log("\n[1] Bouwer");
ok("komma als decimaalteken", leesGetal("0,6") === 0.6 && leesGetal("") === null && leesGetal("x") === null);
const leeg = bouwMetselwerkInvoer(leegMetselwerkFormulier());
ok("leeg formulier: K en γ_M verplicht, geen invoer", !leeg.invoer && leeg.fouten.some((f) => f.veld === "k") && leeg.fouten.some((f) => f.veld === "gammaM"));
const zonderBron = formulier();
zonderBron.ndp.kE = { waarde: "1000", bron: " " };
ok("NDP-waarde zonder bron wordt geweigerd", bouwMetselwerkInvoer(zonderBron).fouten.some((f) => f.veld === "kE" && f.melding.includes("bron")));
const algemeen = formulier();
algemeen.mortel = "Algemeen";
ok("algemene mortel vraagt f_m", bouwMetselwerkInvoer(algemeen).fouten.some((f) => f.veld === "fm"));
// Issue #99: natuursteenmetselwerk — groep 1 (§3.1.1), geen lijmmortel.
const natuur = formulier();
Object.assign(natuur, { steensoort: "Natuursteen", steengroep: "Groep2" });
ok("natuursteen buiten groep 1 → veldfout steengroep", bouwMetselwerkInvoer(natuur).fouten.some((f) => f.veld === "steengroep"));
Object.assign(natuur, { steengroep: "Groep1", mortel: "Lijm" });
ok("natuursteen in lijmmortel → veldfout mortel", bouwMetselwerkInvoer(natuur).fouten.some((f) => f.veld === "mortel"));
const { invoer, fouten } = bouwMetselwerkInvoer(formulier());
ok("volledig formulier: invoer zonder fouten", invoer && fouten.length === 0, JSON.stringify(fouten));
ok("NDP met bron naar de kern", invoer.materiaal.k.waarde === 0.8 && invoer.materiaal.k.bron === "testwaarde");
ok("f_xk2 leeg → niet meegestuurd", !("f_xk2_mpa" in invoer.materiaal));
ok("steunranden met afstand", invoer.geometrie.steunranden.soort === "TweeVerticaleRanden" && invoer.geometrie.steunranden.l_m === 3);

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
  const [r] = await roep("check_masonry_walls", [invoer]);
  const c = (id) => r.checks.find((x) => x.id === id)?.kind?.data;
  dicht("§3.6.1.2 f_k", r.sterkte.f_k_mpa, FK, 1e-9);
  dicht("§5.5.1.2 ρ_4", r.effectieve_hoogte.rho_n, 0.75 / (1 + (0.75 * 2600 / 3000) ** 2), 1e-12);
  dicht("§6.1.2.2 N_Rd boven = 563,92 kN/m", c("druk_boven").uc.rd, 563.9188, 1e-6);
  dicht("bijlage G N_Rd midden = 553,67 kN/m", c("druk_midden").uc.rd, 553.6728, 1e-6);
  dicht("§6.1.3 N_Rdc = 1,30769·15000·f_d", c("geconcentreerd_1").uc.rd, (1.25 + 300 / 5200) * 15000 * FD / 1000, 1e-9);
  dicht("§6.2 V_Rd = 77,647 kN", c("afschuiving").uc.rd, 77.64706, 1e-6);
  dicht("§6.3.1 M_Rd = 0,28235 kNm/m", c("buiging_uit_vlak").uc.rd, 0.2 / 1.7 * 1000 * 120 ** 2 / 6 / 1e6, 1e-9);
  ok("alles getoetst en voldoet → Ok", r.status === "Ok" && r.niet_getoetst.length === 0, r.niet_getoetst.join("; "));
  ok("bron van K in de toelichting", r.notes.some((n) => n.includes("K = 0.8 (bron: testwaarde)")));

  const zonderKe = structuredClone(invoer);
  delete zonderKe.materiaal.k_e;
  const [r2] = await roep("check_masonry_walls", [zonderKe]);
  ok("zonder K_E: Φ_m niet getoetst en nooit Ok", r2.status === "NotApplicable" && r2.niet_getoetst.some((n) => n.includes("K_E")));
  // Issue #99: natuursteen groep 1, algemene mortel, f_b = 40 (opgave), f_m = 10,
  // K = 0,45 en γ_M = 2,0 (TESTWAARDEN): f_k = 0,45·40^0,7·10^0,3 = 11,8756 N/mm².
  const ns = structuredClone(invoer);
  Object.assign(ns.materiaal, { steensoort: "Natuursteen", steengroep: "Groep1", mortel: "Algemeen", f_b_mpa: 40, f_m_mpa: 10,
    k: { waarde: 0.45, bron: "testwaarde" }, gamma_m: { waarde: 2.0, bron: "testwaarde" } });
  const [rn] = await roep("check_masonry_walls", [ns]);
  dicht("natuursteen f_k = 11,8756 N/mm²", rn.sterkte.f_k_mpa, 11.875571, 1e-6);
  ok("natuursteen: toelichting f_b uit de opgave", rn.notes.some((n) => n.includes("EN 771-6")));
  ns.materiaal.steengroep = "Groep3";
  const [rn3] = await roep("check_masonry_walls", [ns]);
  ok("natuursteen groep 3 → niet getoetst (§3.1.1)", rn3.status === "NotApplicable" && rn3.niet_getoetst[0].includes("§3.1.1"));
  const fout = structuredClone(invoer);
  fout.materiaal.f_vk_0 = 1;
  let geweigerd = false;
  try { await roep("check_masonry_walls", [fout]); } catch { geweigerd = true; }
  ok("tikfout in een veldnaam wordt geweigerd", geweigerd);
}

log("\n[3] Bron: drie wegen geregistreerd");
const lib = readFileSync(join(REPO, "src-tauri", "src", "lib.rs"), "utf8");
ok("Tauri: check_masonry_walls in generate_handler!", /generate_handler!\[[\s\S]*check_masonry_walls,[\s\S]*\]/.test(lib));
const brug = readFileSync(join(REPO, "src-tauri", "crates", "toetsbrug", "src", "lib.rs"), "utf8");
ok("toetsbrug: opdracht check_masonry_walls", brug.includes('"check_masonry_walls" =>'));

log(`\n${passed} geslaagd, ${failed} mislukt`);
if (failed > 0) process.exit(1);
