/**
 * stepLezer.ts — lezer voor het STEP-uitwisselingsbestand (ISO 10303-21),
 * de tekstvorm van IFC ("IFC-SPF").
 *
 * WAT HIJ LEEST
 *  - de kop: `ISO-10303-21;`, de sectie `HEADER;` met `FILE_DESCRIPTION`,
 *    `FILE_NAME`, `FILE_SCHEMA`, en één of meer secties `DATA;`;
 *  - records `#id = TYPE(arg, …);`, ook verspreid over meerdere regels en met
 *    commentaar (`/* … *\/`) tussen de delen;
 *  - samengestelde records `#id = (A(…) B(…));` (zelden in IFC): bewaard met
 *    hun delen, de importeur slaat ze over;
 *  - waarden: tekst (`'…'` met `''` en de escapes `\\`, `\X\hh`,
 *    `\X2\…\X0\`, `\X4\…\X0\`, `\S\c`, `\P?\`), getallen (`12`, `-1.5E-3`,
 *    `1.`), `$` (niet ingevuld), `*` (afgeleid), opsommingen `.X.`,
 *    verwijzingen `#12`, lijsten `(…)`, getypte waarden `IFCBOOLEAN(.T.)` en
 *    binaire waarden `"…"`.
 *
 * WAT HIJ NIET DOET
 * Hij kent geen schema: hij weet niet dat het derde attribuut van een
 * IfcStructuralCurveMember de naam is. Dat doet de importeur. Wel meldt hij
 * een kapot bestand met het regelnummer, in plaats van half te lezen.
 *
 * SNELHEID
 * Eén doorgang over de tekst met een index; geen reguliere expressie per
 * teken en geen tussenkopieën behalve voor teksten en getallen. Een bestand
 * van enkele MB is in een fractie van een seconde gelezen.
 */

/** Verwijzing naar een ander record: `#12`. */
export class StepRef {
  constructor(readonly id: number) {}
}

/** Opsomming: `.T.`, `.GLOBAL_COORDS.` (zonder punten, in hoofdletters). */
export class StepEnum {
  constructor(readonly waarde: string) {}
}

/** Getypte waarde: `IFCBOOLEAN(.T.)`, `IFCLENGTHMEASURE(2.5)`. */
export class StepGetypt {
  constructor(readonly type: string, readonly args: StepWaarde[]) {}
  /** De (enige) waarde; bij meer argumenten de eerste. */
  get waarde(): StepWaarde {
    return this.args[0] ?? null;
  }
}

/**
 * Een getal MET zijn tekst uit het bestand, alleen met de leesoptie
 * `getallenAlsTekst`. De resultatenlezer (`io/ifcResultaten.ts`) schaalt een
 * waarde exact door de decimale komma te verschuiven (m → mm, N → kN) in
 * plaats van door met 1000 te vermenigvuldigen, wat niet altijd bit-gelijk
 * terugkomt. Zonder de optie levert de lezer gewone getallen, zoals altijd.
 */
export class StepGetal {
  constructor(readonly tekst: string, readonly waarde: number) {}
}

/** `*`: een afgeleid attribuut; de waarde volgt uit andere attributen. */
export const STEP_AFGELEID: { readonly afgeleid: true } = Object.freeze({ afgeleid: true as const });

export type StepWaarde =
  | null
  | number
  | string
  | StepRef
  | StepEnum
  | StepGetypt
  | StepGetal
  | typeof STEP_AFGELEID
  | StepWaarde[];

export interface StepRecord {
  id: number;
  /** Entiteitstype in hoofdletters, bijvoorbeeld `IFCSTRUCTURALCURVEMEMBER`. */
  type: string;
  args: StepWaarde[];
  /** Alleen bij een samengesteld record: de delen, elk met type en argumenten. */
  delen?: { type: string; args: StepWaarde[] }[];
}

export interface StepKopRecord {
  type: string;
  args: StepWaarde[];
}

export interface StepBestand {
  kop: StepKopRecord[];
  /** De schema's uit `FILE_SCHEMA`, in hoofdletters, bijvoorbeeld `["IFC4"]`. */
  schemas: string[];
  records: Map<number, StepRecord>;
}

/** Een bestand dat geen geldig STEP-bestand is; de melding noemt de regel. */
export class StepLeesFout extends Error {
  constructor(melding: string) {
    super(melding);
    this.name = "StepLeesFout";
  }
}

const WIT = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0c]);

function isLetter(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f;
}

function isCijfer(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

/** Hexadecimaal teken → waarde, of -1. */
function hex(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  return -1;
}

/**
 * De ruwe inhoud van een STEP-tekst (zonder de omsluitende quotes en met ''
 * al vervangen door ') → de bedoelde tekst. Een onbekende of kapotte escape
 * blijft letterlijk staan: liever een zichtbaar vreemd teken dan een naam
 * die stil verdwijnt.
 */
export function decodeerStepTekst(ruw: string): string {
  if (ruw.indexOf("\\") < 0) return ruw;
  let uit = "";
  let i = 0;
  while (i < ruw.length) {
    const c = ruw[i];
    if (c !== "\\") { uit += c; i += 1; continue; }
    const volgende = ruw[i + 1];
    if (volgende === "\\") { uit += "\\"; i += 2; continue; }
    // \X\hh — één teken uit ISO 8859-1.
    if (volgende === "X" && ruw[i + 2] === "\\" && i + 4 < ruw.length) {
      const a = hex(ruw.charCodeAt(i + 3)), b = hex(ruw.charCodeAt(i + 4));
      if (a >= 0 && b >= 0) { uit += String.fromCharCode(a * 16 + b); i += 5; continue; }
    }
    // \X2\hhhh…\X0\ (UTF-16) en \X4\hhhhhhhh…\X0\ (UCS-4).
    if (volgende === "X" && (ruw[i + 2] === "2" || ruw[i + 2] === "4") && ruw[i + 3] === "\\") {
      const breedte = ruw[i + 2] === "2" ? 4 : 8;
      const eind = ruw.indexOf("\\X0\\", i + 4);
      if (eind > 0) {
        const blok = ruw.slice(i + 4, eind);
        if (blok.length % breedte === 0 && /^[0-9A-Fa-f]*$/.test(blok)) {
          for (let k = 0; k < blok.length; k += breedte) {
            const code = parseInt(blok.slice(k, k + breedte), 16);
            uit += breedte === 4 ? String.fromCharCode(code) : String.fromCodePoint(code);
          }
          i = eind + 4;
          continue;
        }
      }
    }
    // \S\c — het teken c met 128 opgeteld: de bovenste helft van ISO 8859-1.
    if (volgende === "S" && ruw[i + 2] === "\\" && i + 3 < ruw.length) {
      uit += String.fromCharCode(ruw.charCodeAt(i + 3) + 128);
      i += 4;
      continue;
    }
    // \PA\ … \PI\ — keuze van het ISO 8859-deel. Alleen deel A (Latijn-1) is
    // in IFC gangbaar; de aanduiding zelf is geen tekst.
    if (volgende === "P" && ruw[i + 3] === "\\") {
      i += 4;
      continue;
    }
    // \N\ (einde van een \X2\-blok in oudere schrijvers) — negeren.
    if (volgende === "N" && ruw[i + 2] === "\\") { i += 3; continue; }
    uit += c;
    i += 1;
  }
  return uit;
}

class Lezer {
  pos = 0;

  constructor(readonly tekst: string, readonly getallenAlsTekst = false) {}

  regel(pos = this.pos): number {
    let regels = 1;
    for (let i = 0; i < pos && i < this.tekst.length; i += 1) if (this.tekst.charCodeAt(i) === 0x0a) regels += 1;
    return regels;
  }

  fout(melding: string, pos = this.pos): never {
    throw new StepLeesFout(`Regel ${this.regel(pos)}: ${melding}`);
  }

  /** Sla witruimte en commentaar over. */
  wit(): void {
    const t = this.tekst;
    for (;;) {
      while (this.pos < t.length && WIT.has(t.charCodeAt(this.pos))) this.pos += 1;
      if (t.charCodeAt(this.pos) === 0x2f && t.charCodeAt(this.pos + 1) === 0x2a) {
        const eind = t.indexOf("*/", this.pos + 2);
        if (eind < 0) this.fout("commentaar /* wordt niet afgesloten");
        this.pos = eind + 2;
        continue;
      }
      return;
    }
  }

  kijk(): number {
    this.wit();
    return this.tekst.charCodeAt(this.pos);
  }

  eis(teken: string): void {
    this.wit();
    if (this.tekst[this.pos] !== teken) {
      const gevonden = this.pos < this.tekst.length ? `'${this.tekst.slice(this.pos, this.pos + 12)}'` : "het einde van het bestand";
      this.fout(`'${teken}' verwacht, gevonden ${gevonden}`);
    }
    this.pos += 1;
  }

  /** Een sleutelwoord: letters, cijfers en '_' (ook '-' in `END-ISO-10303-21`). */
  woord(metStreep = false): string {
    this.wit();
    const t = this.tekst;
    const start = this.pos;
    if (t[start] === "!") this.pos += 1; // door de gebruiker gedefinieerd sleutelwoord
    while (this.pos < t.length) {
      const c = t.charCodeAt(this.pos);
      if (isLetter(c) || isCijfer(c) || (metStreep && c === 0x2d)) this.pos += 1;
      else break;
    }
    if (this.pos === start) this.fout(`sleutelwoord verwacht, gevonden '${t.slice(start, start + 12)}'`);
    return t.slice(start, this.pos).toUpperCase();
  }

  tekstwaarde(): string {
    // Op de openende quote.
    const t = this.tekst;
    const start = this.pos;
    this.pos += 1;
    let ruw = "";
    let stuk = this.pos;
    for (;;) {
      const i = t.indexOf("'", this.pos);
      if (i < 0) this.fout("tekst wordt niet afgesloten met een '", start);
      if (t[i + 1] === "'") {
        ruw += t.slice(stuk, i) + "'";
        this.pos = i + 2;
        stuk = this.pos;
        continue;
      }
      ruw += t.slice(stuk, i);
      this.pos = i + 1;
      break;
    }
    // Regeleinden in een tekst zijn opmaak van het bestand, geen inhoud.
    if (ruw.indexOf("\n") >= 0 || ruw.indexOf("\r") >= 0) ruw = ruw.replace(/[\r\n]/g, "");
    return decodeerStepTekst(ruw);
  }

  getal(): number | StepGetal {
    const t = this.tekst;
    const start = this.pos;
    while (this.pos < t.length) {
      const c = t.charCodeAt(this.pos);
      // cijfers, + - . E e
      if (isCijfer(c) || c === 0x2b || c === 0x2d || c === 0x2e || c === 0x45 || c === 0x65) this.pos += 1;
      else break;
    }
    const woord = t.slice(start, this.pos);
    const waarde = Number(woord);
    if (!Number.isFinite(waarde)) this.fout(`ongeldig getal '${woord}'`, start);
    return this.getallenAlsTekst ? new StepGetal(woord, waarde) : waarde;
  }

  waarde(): StepWaarde {
    const c = this.kijk();
    const t = this.tekst;
    if (c === 0x27) return this.tekstwaarde(); // '
    if (c === 0x23) { // #
      this.pos += 1;
      const start = this.pos;
      while (isCijfer(t.charCodeAt(this.pos))) this.pos += 1;
      if (this.pos === start) this.fout("verwijzing # zonder nummer");
      return new StepRef(Number(t.slice(start, this.pos)));
    }
    if (c === 0x24) { this.pos += 1; return null; } // $
    if (c === 0x2a) { this.pos += 1; return STEP_AFGELEID; } // *
    if (c === 0x2e) { // .ENUM.
      const eind = t.indexOf(".", this.pos + 1);
      if (eind < 0) this.fout("opsomming wordt niet afgesloten met een punt");
      const woord = t.slice(this.pos + 1, eind).trim().toUpperCase();
      if (!/^[A-Z_][A-Z0-9_]*$/.test(woord)) this.fout(`ongeldige opsomming '.${woord}.'`);
      this.pos = eind + 1;
      return new StepEnum(woord);
    }
    if (c === 0x28) return this.lijst(); // (
    if (c === 0x22) { // "binair"
      const eind = t.indexOf("\"", this.pos + 1);
      if (eind < 0) this.fout("binaire waarde wordt niet afgesloten");
      const waarde = t.slice(this.pos + 1, eind);
      this.pos = eind + 1;
      return waarde;
    }
    if (isCijfer(c) || c === 0x2d || c === 0x2b || c === 0x2e) return this.getal();
    if (isLetter(c) || c === 0x21) {
      const type = this.woord();
      const args = this.lijst();
      return new StepGetypt(type, args);
    }
    return this.fout(`onverwacht teken '${t.slice(this.pos, this.pos + 12)}'`);
  }

  lijst(): StepWaarde[] {
    this.eis("(");
    const uit: StepWaarde[] = [];
    if (this.kijk() === 0x29) { this.pos += 1; return uit; }
    for (;;) {
      uit.push(this.waarde());
      const c = this.kijk();
      if (c === 0x2c) { this.pos += 1; continue; } // ,
      if (c === 0x29) { this.pos += 1; return uit; } // )
      this.fout(`',' of ')' verwacht, gevonden '${this.tekst.slice(this.pos, this.pos + 12)}'`);
    }
  }

  /** `NAAM(args)` of, bij een samengesteld record, `(A(…) B(…))`. */
  recordInhoud(): { type: string; args: StepWaarde[]; delen?: { type: string; args: StepWaarde[] }[] } {
    if (this.kijk() === 0x28) {
      this.pos += 1;
      const delen: { type: string; args: StepWaarde[] }[] = [];
      while (this.kijk() !== 0x29) {
        if (this.pos >= this.tekst.length) this.fout("samengesteld record wordt niet afgesloten");
        const type = this.woord();
        delen.push({ type, args: this.lijst() });
      }
      this.pos += 1;
      return { type: delen.map((d) => d.type).join("+"), args: [], delen };
    }
    const type = this.woord();
    return { type, args: this.lijst() };
  }
}

/**
 * Lees een STEP-bestand. Gooit `StepLeesFout` met het regelnummer als de
 * tekst geen geldig STEP-bestand is.
 */
export function leesStep(tekst: string, opties: { getallenAlsTekst?: boolean } = {}): StepBestand {
  // Een byte-order-mark van een teksteditor is geen inhoud.
  const t = tekst.charCodeAt(0) === 0xfeff ? tekst.slice(1) : tekst;
  const lezer = new Lezer(t, opties.getallenAlsTekst === true);
  lezer.wit();
  if (t.startsWith("PK", lezer.pos)) {
    throw new StepLeesFout("Dit is een ingepakt bestand (ifcZIP). Pak het eerst uit en kies het .ifc-bestand.");
  }
  if (t.startsWith("<", lezer.pos)) {
    throw new StepLeesFout("Dit is een ifcXML-bestand. Alleen de STEP-vorm (.ifc, ISO 10303-21) wordt gelezen.");
  }
  const magisch = lezer.woord(true);
  if (magisch !== "ISO-10303-21") {
    throw new StepLeesFout("Dit is geen IFC-bestand in STEP-vorm: het begint niet met ISO-10303-21;.");
  }
  lezer.eis(";");

  const kop: StepKopRecord[] = [];
  const records = new Map<number, StepRecord>();
  for (;;) {
    lezer.wit();
    if (lezer.pos >= t.length) break; // geen END-ISO-10303-21: toegestaan als de rest heel is
    const sectie = lezer.woord(true);
    if (sectie === "END-ISO-10303-21") {
      lezer.eis(";");
      break;
    }
    if (sectie === "HEADER") {
      lezer.eis(";");
      for (;;) {
        const woord = lezer.woord(true);
        if (woord === "ENDSEC") { lezer.eis(";"); break; }
        kop.push({ type: woord, args: lezer.lijst() });
        lezer.eis(";");
      }
      continue;
    }
    if (sectie === "DATA") {
      // Editie 3 staat `DATA('naam', ('schema'));` toe.
      if (lezer.kijk() === 0x28) lezer.lijst();
      lezer.eis(";");
      for (;;) {
        const c = lezer.kijk();
        if (c === 0x23) {
          const start = lezer.pos;
          lezer.pos += 1;
          const begin = lezer.pos;
          while (isCijfer(t.charCodeAt(lezer.pos))) lezer.pos += 1;
          if (lezer.pos === begin) lezer.fout("recordnummer ontbreekt na #");
          const id = Number(t.slice(begin, lezer.pos));
          lezer.eis("=");
          const inhoud = lezer.recordInhoud();
          lezer.eis(";");
          if (records.has(id)) lezer.fout(`record #${id} staat twee keer in het bestand`, start);
          records.set(id, { id, ...inhoud });
          continue;
        }
        const woord = lezer.woord(true);
        if (woord === "ENDSEC") { lezer.eis(";"); break; }
        lezer.fout(`record (#nummer = …) of ENDSEC verwacht, gevonden '${woord}'`);
      }
      continue;
    }
    // ANCHOR, REFERENCE, SIGNATURE (editie 3): overslaan tot ENDSEC.
    const eind = t.indexOf("ENDSEC", lezer.pos);
    if (eind < 0) lezer.fout(`sectie ${sectie} wordt niet afgesloten met ENDSEC`);
    lezer.pos = eind + "ENDSEC".length;
    lezer.eis(";");
  }

  const schemaRecord = kop.find((record) => record.type === "FILE_SCHEMA");
  const schemaLijst = schemaRecord?.args[0];
  const schemas = Array.isArray(schemaLijst)
    ? schemaLijst.filter((s): s is string => typeof s === "string").map((s) => s.trim().toUpperCase())
    : [];
  return { kop, schemas, records };
}
