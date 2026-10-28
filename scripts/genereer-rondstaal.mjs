#!/usr/bin/env node
/**
 * genereer-rondstaal.mjs — massief rond staal (reeks "RD <d>", EN 10060) aan
 * de profieldatabase toevoegen: 17 diameters van 10 tot 64 mm.
 *
 * ── Waarom deze reeks ────────────────────────────────────────────────────────
 *
 * Windverbanden en trekstangen van rond staal (Ø24, Ø30) werden bij het
 * toetsen overgeslagen: het profiel stond niet in de catalogus. Deze reeks
 * voegt ze toe, met de grootheden als GESLOTEN FORMULES van de diameter — voor
 * een massieve cirkel is elke doorsnedegrootheid exact bekend, er valt niets
 * over te typen uit een tabel:
 *
 *   A    = π·d²/4
 *   I_y  = I_z = π·d⁴/64
 *   W_el = π·d³/32
 *   W_pl = d³/6            (twee halve cirkels, arm 4r/(3π) elk)
 *   i    = d/4
 *   I_t  = π·d⁴/32         (polair traagheidsmoment; een cirkel welft niet)
 *   I_w  = 0
 *   A_v  = 0,75·A          (zie hieronder)
 *
 * ── Wat een normkeuze is en geen meetkunde ───────────────────────────────────
 *
 *   - A_v. NEN-EN 1993-1-1 6.2.6(3) heeft geen rij voor massief rond — rij
 *     (g) gaat over de ronde BUIS. A_v valt dus onder 6.2.6(2) en is hier
 *     bepaald als 0,75·A: de elastische schuifspanning van een cirkel is het
 *     grootst op de neutrale lijn, τ_max = 4V/(3A), dus V = τ·0,75·A. Dat is
 *     dezelfde redenering als de massieve rechthoek van de doorsnedemotor
 *     (A_v = ⅔A, τ_max = 1,5V/A) en conservatief tegenover een volledig
 *     plastische schuifverdeling (A_v = A).
 *   - Knikkromme c om beide assen: tabel 6.2, rij "U-, T- en massieve
 *     profielen", voor elke staalsoort.
 *   - De dikte voor tabel 3.1 (f_y per dikteklasse): bij een massieve staaf is
 *     dat de diameter. Daarom staan t, t_w en t_f hier op d, net als de
 *     doorsnedemotor een massieve rechthoek administreert (t_w = b, t_f = h).
 *     Vanaf RD 42 geldt dan de kolom 40 mm < t ≤ 80 mm.
 *
 * ── Wat er gecontroleerd wordt ──────────────────────────────────────────────
 *
 *   node scripts/genereer-rondstaal.mjs --valideer
 *       Rekent elke diameter door met dezelfde Rust-doorsnedemotor die de
 *       rest van de database vult (soort "RoundBar", vier exacte kwartbogen)
 *       en legt de uitkomst naast de gesloten formules: A, I, W_el, W_pl en i
 *       horen op afrondingsruis samen te vallen (grens 1e-6 relatief), I_t
 *       binnen de numerieke insluiting van de torsiemotor (grens 0,5 %), en
 *       A_v exact op 0,75·A.
 *   node scripts/genereer-rondstaal.mjs --schrijf
 *       Voegt de profielen toe aan
 *       src-tauri/crates/steel-profiles/data/profiles.json. Bestaande regels
 *       blijven ongemoeid; een profiel waarvan de zoeksleutel al bestaat wordt
 *       overgeslagen.
 *   zonder vlaggen: alleen --valideer.
 *
 * De motor wordt zo nodig eerst gebouwd (cargo, release). Geen npm-afhankelijk-
 * heden.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const hier = dirname(fileURLToPath(import.meta.url));
const wortel = join(hier, "..");
const profielenPad = join(
  wortel, "src-tauri", "crates", "steel-profiles", "data", "profiles.json",
);

/* ==================================================================== *
 * 1. De reeks                                                          *
 * ==================================================================== */

/**
 * De diameters in mm. Gekozen zijn de maten waarvoor een metrische ISO-draad
 * met grove spoed bestaat (M10 … M64): de toetsing rekent de draadeinden van
 * een trekstaaf met draad M = d, en een diameter zonder bijbehorende draad kan
 * daar niet getoetst worden.
 */
const DIAMETERS = [10, 12, 16, 20, 24, 27, 30, 33, 36, 39, 42, 45, 48, 52, 56, 60, 64];

/** Tabel 6.2, rij "U-, T- en massieve profielen": kromme c om elke as. */
const KNIKKROMMEN = { y_axis: "c", z_axis: "c" };

/** Zes significante cijfers — zelfde afronding als de andere generatoren. */
function afgerond(x) {
  if (!Number.isFinite(x)) throw new Error(`Niet-eindig getal: ${x}`);
  if (x === 0) return 0;
  return Number(x.toPrecision(6));
}

/** De gesloten formules; zie de kop van dit bestand. */
function grootheden(d) {
  const a = (Math.PI * d * d) / 4;
  const i = (Math.PI * d ** 4) / 64;
  const wel = (Math.PI * d ** 3) / 32;
  const wpl = d ** 3 / 6;
  return {
    area_mm2: a,
    iy_mm4: i,
    iz_mm4: i,
    wel_y_mm3: wel,
    wel_z_mm3: wel,
    wpl_y_mm3: wpl,
    wpl_z_mm3: wpl,
    av_y_mm2: 0.75 * a,
    av_z_mm2: 0.75 * a,
    it_mm4: (Math.PI * d ** 4) / 32,
    iw_mm6: 0,
    iy_radius_mm: d / 4,
    iz_radius_mm: d / 4,
    h_mm: d,
    b_mm: d,
    tw_mm: d,
    tf_mm: d,
    r_mm: 0,
  };
}

/** Het profielrecord zoals het in profiles.json komt. */
function record(d) {
  const g = grootheden(d);
  const properties = {};
  for (const [k, v] of Object.entries(g)) properties[k] = afgerond(v);
  return {
    name: `RD ${d}`,
    kind: "RoundBar",
    geometry: { h: d, b: d, tw: d, tf: d, t: d, r: 0 },
    properties,
    buckling_curves: KNIKKROMMEN,
  };
}

/** Zelfde normalisatie als `lookup_key` in de Rust-crate (zonder de aliassen). */
const sleutel = (naam) => naam.replace(/[\s\-.]/g, "").toUpperCase();

/* ==================================================================== *
 * 2. De doorsnedemotor aanroepen                                       *
 * ==================================================================== */

const motorBin = join(
  wortel, "src-tauri", "target", "release",
  process.platform === "win32" ? "doorsnedemotor.exe" : "doorsnedemotor",
);

/** Bouwt de motor als hij ontbreekt of ouder is dan de Rust-bron. */
function draaiMotor(lijst) {
  const bronDir = join(wortel, "src-tauri", "crates", "section-properties", "src");
  const bronTijd = readdirSync(bronDir, { recursive: true })
    .map((f) => join(bronDir, String(f)))
    .filter((f) => f.endsWith(".rs"))
    .reduce((t, f) => Math.max(t, statSync(f).mtimeMs), 0);
  if (!existsSync(motorBin) || statSync(motorBin).mtimeMs < bronTijd) {
    console.log("Motor bouwen (cargo build --release)...");
    execFileSync(
      "cargo",
      ["build", "--release", "-q", "-p", "section-properties", "--bin", "doorsnedemotor"],
      { cwd: join(wortel, "src-tauri"), stdio: "inherit" },
    );
  }
  const invoerPad = join(tmpdir(), `rondstaal-in-${process.pid}.json`);
  const uitvoerPad = join(tmpdir(), `rondstaal-uit-${process.pid}.json`);
  writeFileSync(invoerPad, JSON.stringify(lijst), "utf8");
  try {
    execFileSync(motorBin, [invoerPad, uitvoerPad], { stdio: ["ignore", "ignore", "inherit"] });
    return JSON.parse(readFileSync(uitvoerPad, "utf8"));
  } finally {
    for (const f of [invoerPad, uitvoerPad]) {
      try { unlinkSync(f); } catch { /* al weg */ }
    }
  }
}

/* ==================================================================== *
 * 3. Validatie                                                         *
 * ==================================================================== */

/**
 * A, I, W en i volgen bij de motor uit exacte randintegralen over vier
 * kwartbogen; daar hoort alleen afrondingsruis tussen te zitten.
 */
const GRENS_EXACT = 1e-6;
/**
 * I_t volgt uit de numerieke torsieoplossing (driehoeken, acht per "wand");
 * voor een cirkel ligt die volgens de convergentietabel van `torsie.rs`
 * binnen 0,5 % van de exacte waarde.
 */
const GRENS_TORSIE = 5e-3;

function valideer() {
  const invoer = DIAMETERS.map((d) => ({ naam: `RD ${d}`, soort: "RoundBar", h: d, b: d }));
  const uit = draaiMotor(invoer);
  if (uit.length !== DIAMETERS.length) {
    throw new Error(`Motor gaf ${uit.length} resultaten voor ${DIAMETERS.length} profielen.`);
  }
  console.log("=".repeat(78));
  console.log("VALIDATIE — gesloten formules tegenover de doorsnedemotor (soort RoundBar)");
  console.log("=".repeat(78));
  console.log(
    "profiel".padEnd(8) + "A".padStart(10) + "ΔA".padStart(10) + "ΔI".padStart(10) +
    "ΔWel".padStart(10) + "ΔWpl".padStart(10) + "ΔIt %".padStart(9) + "  Av/A",
  );
  const erg = [];
  let ergsteExact = 0;
  let ergsteTorsie = 0;
  for (let k = 0; k < DIAMETERS.length; k += 1) {
    const d = DIAMETERS[k];
    const f = grootheden(d);
    const m = uit[k];
    const r = (motor, formule) => (motor - formule) / formule;
    const exact = {
      A: r(m.area_mm2, f.area_mm2),
      Iy: r(m.iy_mm4, f.iy_mm4),
      Iz: r(m.iz_mm4, f.iz_mm4),
      Wel: r(m.wel_y_mm3, f.wel_y_mm3),
      Wpl: r(m.wpl_y_mm3, f.wpl_y_mm3),
      i: r(m.iy_radius_mm, f.iy_radius_mm),
    };
    const torsie = r(m.it_mm4, f.it_mm4);
    for (const [naam, afw] of Object.entries(exact)) {
      ergsteExact = Math.max(ergsteExact, Math.abs(afw));
      if (Math.abs(afw) > GRENS_EXACT) erg.push(`RD ${d}: ${naam} wijkt ${afw.toExponential(2)} af`);
    }
    ergsteTorsie = Math.max(ergsteTorsie, Math.abs(torsie));
    if (Math.abs(torsie) > GRENS_TORSIE) erg.push(`RD ${d}: I_t wijkt ${(torsie * 100).toFixed(3)} % af`);
    if (Math.abs(m.av_z_mm2 / m.area_mm2 - 0.75) > 1e-12) erg.push(`RD ${d}: A_v is niet 0,75·A`);
    if (m.iw_mm6 !== 0) erg.push(`RD ${d}: I_w = ${m.iw_mm6} in plaats van 0`);
    console.log(
      `RD ${d}`.padEnd(8) +
      f.area_mm2.toFixed(1).padStart(10) +
      exact.A.toExponential(1).padStart(10) +
      exact.Iy.toExponential(1).padStart(10) +
      exact.Wel.toExponential(1).padStart(10) +
      exact.Wpl.toExponential(1).padStart(10) +
      (torsie * 100).toFixed(3).padStart(9) +
      `  ${(m.av_z_mm2 / m.area_mm2).toFixed(2)}`,
    );
  }
  console.log();
  console.log(`Grootste afwijking A/I/W/i: ${ergsteExact.toExponential(2)} (grens ${GRENS_EXACT}).`);
  console.log(`Grootste afwijking I_t: ${(ergsteTorsie * 100).toFixed(3)} % (grens ${GRENS_TORSIE * 100} %).`);
  if (erg.length) {
    console.log(`\n!! ${erg.length} melding(en):`);
    for (const e of erg) console.log(`   ${e}`);
    process.exitCode = 1;
  } else {
    console.log("\nAlles binnen de grenzen: de gesloten formules en de motor beschrijven dezelfde doorsnede.");
  }
}

/* ==================================================================== *
 * 4. Wegschrijven                                                      *
 * ==================================================================== */

function schrijf() {
  valideer();
  if (process.exitCode === 1) {
    console.log("\nNiet geschreven: los eerst de gemelde afwijkingen op.");
    return;
  }
  const bestaand = JSON.parse(readFileSync(profielenPad, "utf8"));
  const bestaandeSleutels = new Set(bestaand.map((p) => sleutel(p.name)));
  const nieuw = [];
  const overgeslagen = [];
  for (const d of DIAMETERS) {
    const r = record(d);
    if (bestaandeSleutels.has(sleutel(r.name))) {
      overgeslagen.push(r.name);
      continue;
    }
    bestaandeSleutels.add(sleutel(r.name));
    nieuw.push(r);
  }
  if (nieuw.length === 0) {
    console.log("\nNiets toegevoegd: alle profielen stonden er al in.");
    return;
  }
  writeFileSync(profielenPad, `${JSON.stringify([...bestaand, ...nieuw], null, 2)}\n`, "utf8");
  console.log(`\nToegevoegd aan ${profielenPad}: ${nieuw.length} profielen.`);
  if (overgeslagen.length) console.log(`Overgeslagen (stonden er al): ${overgeslagen.join(", ")}`);
  console.log("\nDraai hierna in design-mockup/: node scripts/genereer-staalprofielen.mjs");
}

const vlaggen = process.argv.slice(2);
if (vlaggen.includes("--schrijf")) schrijf();
else valideer();
