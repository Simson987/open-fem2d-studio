#!/usr/bin/env node
/**
 * genereer-strip.mjs — platstaal (reeks "Strip <b>x<t>", EN 10058) aan de
 * profieldatabase toevoegen: 97 maten, b van 30 tot 200 mm, t van 5 tot 20 mm,
 * alleen de combinaties met b ≥ 2t.
 *
 * ── Waarom deze reeks ────────────────────────────────────────────────────────
 *
 * Windverbanden van strip (platstaal) werden bij het toetsen overgeslagen: het
 * profiel stond niet in de catalogus. Een IFC-model levert ze aan als
 * IfcRectangleProfileDef met de ProfileName "Strip 80x10"; dat is dus ook de
 * naam hier. De grootheden zijn GESLOTEN FORMULES van b en t:
 *
 *   A      = b·t
 *   I_y    = t·b³/12          (sterke as: de breedte b staat langs z)
 *   I_z    = b·t³/12
 *   W_el,y = t·b²/6,   W_el,z = b·t²/6
 *   W_pl,y = t·b²/4,   W_pl,z = b·t²/4
 *   i_y    = b/√12,    i_z    = t/√12
 *   I_t    = b·t³·(1/3 − 0,21·(t/b)·(1 − t⁴/(12·b⁴)))
 *   I_w    = 0                (zie hieronder)
 *   A_v    = ⅔·A               (zie hieronder)
 *
 * I_t is de bekende benadering voor een massieve rechthoek; de app rekent
 * dezelfde formule in `rectangleTorsionConstant` (3D-rekenroute). Voor b/t = 2
 * geeft zij 0,2289·b·t³ tegen 0,229 uit de exacte reeks; voor een slanke strip
 * nadert zij b·t³/3.
 *
 * ── De stand ─────────────────────────────────────────────────────────────────
 *
 * De breedte b loopt langs de lokale z-as en de dikte t langs de lokale y-as:
 * I_y is de sterke as, zoals bij elk ander catalogusprofiel. In de maten staat
 * daarom h = b (de breedte van de strip) en b = t_w = t_f = t (de dikte) — de
 * maat-volgorde van een rechthoek "breedte × hoogte" = t × b. Wie een strip
 * plat wil leggen (buiging om de zwakke as in het vlak), draait de staaf om
 * haar as, net als bij een I-profiel.
 *
 * ── Wat een normkeuze is en geen meetkunde ───────────────────────────────────
 *
 *   - A_v. NEN-EN 1993-1-1 6.2.6(3) heeft geen rij voor een massieve
 *     rechthoek. A_v valt dus onder 6.2.6(2) en is ⅔·A: de elastische
 *     schuifspanning van een rechthoek is het grootst op de neutrale lijn,
 *     τ_max = 1,5·V/A — dezelfde waarde als de doorsnedemotor voor een
 *     rechthoek geeft, en conservatief tegenover een volledig plastische
 *     schuifverdeling (A_v = A).
 *   - Knikkromme c om beide assen: tabel 6.2, rij "U-, T- en massieve
 *     profielen", voor elke staalsoort.
 *   - I_w = 0. Een massieve rechthoek heeft een kleine welvingsconstante, van
 *     de orde b³t³/144 (de motor rekent hem uit); voor een strip 200x20 van
 *     3 m verandert hij M_cr met 0,2 %. Hij telt alleen in M_cr, en kip wordt
 *     bij platstaal niet gerekend; 0 is dus zoals bij massief rond.
 *   - De dikte voor tabel 3.1 (f_y per dikteklasse) is t; t, t_w en t_f staan
 *     daarom op t. Alle maten in deze reeks hebben t ≤ 20 mm, dus de kolom
 *     t ≤ 40 mm.
 *
 * ── Wat er gecontroleerd wordt ──────────────────────────────────────────────
 *
 *   node scripts/genereer-strip.mjs --valideer
 *       Rekent elke maat door met dezelfde Rust-doorsnedemotor die de rest van
 *       de database vult (soort "Rechthoek", h = b, b = t) en legt de uitkomst
 *       naast de gesloten formules: A, I, W_el, W_pl en i horen op
 *       afrondingsruis samen te vallen (grens 1e-6 relatief), I_t binnen 1 %
 *       (numerieke torsieoplossing tegenover de benadering), en A_v exact op
 *       ⅔·A.
 *   node scripts/genereer-strip.mjs --schrijf
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

/** Breedten en dikten in mm; alleen de paren met b ≥ 2t horen erbij. */
const BREEDTEN = [30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 150, 160, 180, 200];
const DIKTEN = [5, 6, 8, 10, 12, 15, 20];
const MATEN = BREEDTEN.flatMap((b) => DIKTEN.filter((t) => b >= 2 * t).map((t) => [b, t]));

/** Tabel 6.2, rij "U-, T- en massieve profielen": kromme c om elke as. */
const KNIKKROMMEN = { y_axis: "c", z_axis: "c" };

/** Zes significante cijfers — zelfde afronding als de andere generatoren. */
function afgerond(x) {
  if (!Number.isFinite(x)) throw new Error(`Niet-eindig getal: ${x}`);
  if (x === 0) return 0;
  return Number(x.toPrecision(6));
}

/** I_t van een massieve rechthoek — dezelfde formule als `rectangleTorsionConstant`. */
function torsie(lang, kort) {
  return lang * kort ** 3 * (1 / 3 - 0.21 * (kort / lang) * (1 - kort ** 4 / (12 * lang ** 4)));
}

/** De gesloten formules; zie de kop van dit bestand. */
function grootheden(b, t) {
  const a = b * t;
  return {
    area_mm2: a,
    iy_mm4: (t * b ** 3) / 12,
    iz_mm4: (b * t ** 3) / 12,
    wel_y_mm3: (t * b ** 2) / 6,
    wel_z_mm3: (b * t ** 2) / 6,
    wpl_y_mm3: (t * b ** 2) / 4,
    wpl_z_mm3: (b * t ** 2) / 4,
    av_y_mm2: (2 * a) / 3,
    av_z_mm2: (2 * a) / 3,
    it_mm4: torsie(b, t),
    iw_mm6: 0,
    iy_radius_mm: b / Math.sqrt(12),
    iz_radius_mm: t / Math.sqrt(12),
    h_mm: b,
    b_mm: t,
    tw_mm: t,
    tf_mm: t,
    r_mm: 0,
  };
}

/** Het profielrecord zoals het in profiles.json komt. */
function record(b, t) {
  const g = grootheden(b, t);
  const properties = {};
  for (const [k, v] of Object.entries(g)) properties[k] = afgerond(v);
  return {
    name: `Strip ${b}x${t}`,
    kind: "FlatBar",
    geometry: { h: b, b: t, tw: t, tf: t, t, r: 0 },
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
  const invoerPad = join(tmpdir(), `strip-in-${process.pid}.json`);
  const uitvoerPad = join(tmpdir(), `strip-uit-${process.pid}.json`);
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

/** A, I, W en i volgen bij de motor uit exacte randintegralen over vier rechte randen. */
const GRENS_EXACT = 1e-6;
/** I_t: numerieke torsieoplossing tegenover de benadering voor een rechthoek. */
const GRENS_TORSIE = 1e-2;

function valideer() {
  const invoer = MATEN.map(([b, t]) => ({ naam: `Strip ${b}x${t}`, soort: "Rechthoek", h: b, b: t }));
  const uit = draaiMotor(invoer);
  if (uit.length !== MATEN.length) {
    throw new Error(`Motor gaf ${uit.length} resultaten voor ${MATEN.length} profielen.`);
  }
  console.log("=".repeat(78));
  console.log("VALIDATIE — gesloten formules tegenover de doorsnedemotor (soort Rechthoek)");
  console.log("=".repeat(78));
  console.log(
    "profiel".padEnd(14) + "A".padStart(9) + "ΔIy".padStart(10) + "ΔIz".padStart(10) +
    "ΔWpl,y".padStart(10) + "ΔWpl,z".padStart(10) + "ΔIt %".padStart(9) + "  Av/A",
  );
  const erg = [];
  let ergsteExact = 0;
  let ergsteTorsie = 0;
  for (let k = 0; k < MATEN.length; k += 1) {
    const [b, t] = MATEN[k];
    const naam = `Strip ${b}x${t}`;
    const f = grootheden(b, t);
    const m = uit[k];
    const r = (motor, formule) => (motor - formule) / formule;
    const exact = {
      A: r(m.area_mm2, f.area_mm2),
      Iy: r(m.iy_mm4, f.iy_mm4),
      Iz: r(m.iz_mm4, f.iz_mm4),
      Wely: r(m.wel_y_mm3, f.wel_y_mm3),
      Welz: r(m.wel_z_mm3, f.wel_z_mm3),
      Wply: r(m.wpl_y_mm3, f.wpl_y_mm3),
      Wplz: r(m.wpl_z_mm3, f.wpl_z_mm3),
      iy: r(m.iy_radius_mm, f.iy_radius_mm),
      iz: r(m.iz_radius_mm, f.iz_radius_mm),
    };
    const dIt = r(m.it_mm4, f.it_mm4);
    for (const [naamG, afw] of Object.entries(exact)) {
      ergsteExact = Math.max(ergsteExact, Math.abs(afw));
      if (Math.abs(afw) > GRENS_EXACT) erg.push(`${naam}: ${naamG} wijkt ${afw.toExponential(2)} af`);
    }
    ergsteTorsie = Math.max(ergsteTorsie, Math.abs(dIt));
    if (Math.abs(dIt) > GRENS_TORSIE) erg.push(`${naam}: I_t wijkt ${(dIt * 100).toFixed(3)} % af`);
    if (Math.abs(m.av_z_mm2 / m.area_mm2 - 2 / 3) > 1e-12) erg.push(`${naam}: A_v is niet ⅔·A`);
    // I_w: de motor geeft de kleine welvingsconstante van een massieve
    // rechthoek (orde b³t³/144). De catalogus zet hem op 0, zoals gevraagd en
    // zoals bij massief rond: I_w telt alleen in M_cr, en kip wordt bij
    // platstaal niet gerekend (zie de toetsing). Ter controle dat het om die
    // kleine constante gaat en niet om een fout: niet negatief en niet groter
    // dan de dunwandige waarde b³t³/144, die een bovengrens is (een dikkere
    // rechthoek welft minder).
    if (!(m.iw_mm6 >= 0 && m.iw_mm6 <= 1.01 * (b ** 3 * t ** 3) / 144)) {
      erg.push(`${naam}: I_w van de motor (${m.iw_mm6}) ligt niet tussen 0 en b³t³/144`);
    }
    console.log(
      naam.padEnd(14) +
      f.area_mm2.toFixed(0).padStart(9) +
      exact.Iy.toExponential(1).padStart(10) +
      exact.Iz.toExponential(1).padStart(10) +
      exact.Wply.toExponential(1).padStart(10) +
      exact.Wplz.toExponential(1).padStart(10) +
      (dIt * 100).toFixed(3).padStart(9) +
      `  ${(m.av_z_mm2 / m.area_mm2).toFixed(3)}`,
    );
  }
  console.log();
  console.log(`${MATEN.length} maten.`);
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
  for (const [b, t] of MATEN) {
    const r = record(b, t);
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
