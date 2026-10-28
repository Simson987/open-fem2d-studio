/**
 * alphaCr.ts — de kritieke lastfactor α_cr per UGT-combinatie, en wat de
 * norm daaraan verbindt.
 *
 * WAT DE NORM ZEGT (NEN-EN 1993-1-1)
 *
 *  * 5.2.1(3): een eerste-orde-berekening mag alleen wanneer de invloed van de
 *    vervormingen op de krachtsverdeling verwaarloosbaar is; het criterium is
 *    α_cr = F_cr/F_Ed ≥ 10 (elastisch). Daaronder moeten de tweede-orde-
 *    effecten in de berekening zitten.
 *  * 5.2.2(7)b: de staaftoets met kniklengte = systeemlengte veronderstelt
 *    krachten uit een tweede-orde-berekening mét de imperfecties van 5.3.
 *  * 5.2.2(8): wordt eerste orde gebruikt, dan hoort de kniklengte uit de
 *    zijdelingse knikvorm van het raamwerk te komen.
 *
 * WAT ER FOUT GING (basisaudit nr 27)
 *
 * De beginstand — eerste orde, scheefstand uit, kniklengte leeg (= systeem-
 * lengte) — volgde geen van beide routes en niets meldde dat. Gemeten op een
 * portaal 6 × 4 m HEA160 met scharnierende voeten: α_cr ≈ 1,0 bij N_Ed = 351 kN
 * per kolom, en de toets zei UC 0,474 "Ok"; met de zijdelingse kniklengte van
 * 9,96 m is het UC 1,272. Met q = 20 kN/m: α_cr = 4,64 (5.2) en χ_y 0,812 in
 * plaats van 0,300.
 *
 * HOE α_cr HIER WORDT BEPAALD
 *
 * Niet met de benadering (5.2) — die vraagt een verdiepingshoogte en een
 * horizontale belasting, en een algemeen 2D-model heeft die niet altijd —
 * maar rechtstreeks als de laagste kritieke lastfactor van het raamwerk: de
 * factor α waarbij K_e + α·K_g(N_Ed) singulier wordt, met N_Ed de normaal-
 * krachten van de combinatie. Dat is de definitie van α_cr in 5.2.1(3), en het
 * is dezelfde matrix waarmee de tweede-orde-berekening (P-Δ) van deze motor
 * rekent, zodat "α_cr < 1" hier precies betekent dat die berekening divergeert.
 * De zoektocht gaat met bisectie op het aantal niet-positieve pivots van de
 * gecondenseerde matrix (Sylvester): dat telt hoeveel knikvormen onder α
 * liggen, dus de functie is monotoon.
 *
 * Elke staaf wordt daarbij in TWEE elementen verdeeld (een extra snede op
 * L/2): met één cubisch element per staaf ligt de kritieke last van een
 * enkelvoudige knikvorm (halve sinus) 21,6 % te hoog, met twee ≤ 0,8 %.
 * Zwaaiknik van een portaal is met één element al nauwkeurig, maar de
 * tussenverdieping-knik van een doorgaande kolom niet.
 *
 * Een PENDELSTAAF (momentscharnier aan beide einden) blijft één element. Haar
 * eigen boogknik is een staafvorm met L_cr = L, en die dekt de staaftoets
 * (6.3.1); 5.2.1(3) gaat over instabiliteit in een globale vorm. Haar
 * bijdrage aan de zijwaartse vormen (P-Δ van een pendelkolom) blijft via de
 * koordterm van K_g behouden. Gemeten (controle 12 oktober 2026, B10): een
 * vakwerk 12 × 2 m met alleen scharnieren kreeg met de snede α_cr = 5,53 — de
 * Euler-last van één eindschoor — en daarmee "EERSTE ORDE NIET TOEGESTAAN",
 * terwijl hetzelfde vakwerk met stijve knopen α_cr = 11,5 gaf. Zonder de
 * snede: α_cr ≈ 768.
 *
 * Alleen knik IN het vlak: knik uit het vlak kent het model niet, en die
 * blijft de zaak van de staaftoets (6.3.1 om de z-as).
 *
 * Wat NIET wordt bepaald, en waarom dat gemeld wordt in plaats van geraden:
 *  * modellen met wandschijven — de membraan-K_g zit in het gemengde pad en
 *    is hier niet losgekoppeld;
 *  * modellen boven `maxDofs` vrijheidsgraden — de dichte eliminatie is O(n³)
 *    en zou de live-herberekening onwerkbaar maken.
 */
import type { Mesh } from "../../../core/fem/Mesh";
import {
  applyBoundaryConditions,
  assembleGlobalStiffnessWithGeometric,
  countNonPositivePivots,
  schakelAxiaalGroepenUit,
} from "../../../core/solver/NonlinearSolver";
import { buildMesh } from "./engine";
import type { LoadCombination } from "./combinations";
import type { ElementForces, MultiInput, SolverResult } from "./types";
import type { Analysetype } from "../femTypes";
import { noemerTekst, phiLosseKolom, phiVolgensNorm } from "../../../lib/scheefstandNorm";

/** De grens van EN 1993-1-1 5.2.1(3): eerste orde alleen bij α_cr ≥ 10. */
export const ALPHA_CR_GRENS_EERSTE_ORDE = 10;
/** Boven deze factor wordt niet verder gezocht; α_cr is dan "> 100". */
export const ALPHA_CR_ZOEKGRENS = 100;
/** Boven dit aantal vrijheidsgraden (na de halvering) wordt α_cr niet bepaald. */
export const ALPHA_CR_MAX_DOFS = 1500;

export interface AlphaCrUitkomst {
  combinatieId: number;
  naam: string;
  /** De kritieke lastfactor; `null` bij elke andere status dan "bepaald". */
  alphaCr: number | null;
  status:
    /** α_cr gevonden tussen 0 en de zoekgrens. */
    | "bepaald"
    /** Geen enkele staaf onder druk in deze combinatie: er is geen knikvorm. */
    | "geen_druk"
    /** Boven de zoekgrens geen singulariteit gevonden: α_cr > `grens`. */
    | "boven_grens"
    /** Niet bepaald, met `reden`. */
    | "niet_bepaald";
  grens?: number;
  reden?: string;
}

/**
 * Een staaf met een momentscharnier aan BEIDE einden (release `Ry` of een
 * `hinge`-aansluiting, zoals de engine ze leest). Een rotatieveer telt niet:
 * een release gaat daar al voor, en zonder release is het einde niet vrij.
 */
function isPendelstaaf(b: MultiInput["beams"][number]): boolean {
  const start = !!(b.releases?.startRy || b.startConnection === "hinge");
  const eind = !!(b.releases?.endRy || b.endConnection === "hinge");
  return start && eind;
}

/** Lineaire interpolatie van N (trek positief) op x langs de staaf. */
function normaalkrachtOp(ef: ElementForces, xMm: number): number {
  const xs = ef.stations_mm;
  const ns = ef.normalForce;
  if (xs.length === 0) return ef.N;
  if (xMm <= xs[0]) return ns[0] ?? 0;
  for (let i = 1; i < xs.length; i++) {
    if (xMm <= xs[i]) {
      const t = xs[i] === xs[i - 1] ? 0 : (xMm - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return (ns[i - 1] ?? 0) + t * ((ns[i] ?? 0) - (ns[i - 1] ?? 0));
    }
  }
  return ns[ns.length - 1] ?? 0;
}

/**
 * α_cr per UGT-combinatie van `combinaties`, met de normaalkrachten uit
 * `combinationResults`. Combinaties zonder resultaat en BGT-combinaties
 * worden overgeslagen.
 */
export function bepaalAlphaCr(
  input: MultiInput,
  combinaties: LoadCombination[],
  combinationResults: Map<number, SolverResult>,
  opties: { maxDofs?: number } = {},
): AlphaCrUitkomst[] {
  const maxDofs = opties.maxDofs ?? ALPHA_CR_MAX_DOFS;
  const uls = combinaties.filter((c) => c.type === "uls");
  if (uls.length === 0) return [];
  const nietBepaald = (reden: string): AlphaCrUitkomst[] =>
    uls.map((c) => ({ combinatieId: c.id, naam: c.name, alphaCr: null, status: "niet_bepaald", reden }));

  if (input.plates && input.plates.length > 0) {
    return nietBepaald(
      "het model bevat wandschijven; de kritieke lastfactor van het gemengde staaf-schijfstelsel " +
        "wordt hier niet bepaald",
    );
  }

  // Elke staaf in twee elementen (zie de toelichting bovenaan), behalve een
  // pendelstaaf. Een staaf die al een snede op L/2 heeft, krijgt geen tweede:
  // de adapter laat een snede op een bestaande knoop vervallen.
  const fijner: MultiInput = {
    ...input,
    beams: input.beams.map((b) => (isPendelstaaf(b) ? b : {
      ...b,
      extraSneden: [...new Set([...(b.extraSneden ?? []), 0.5])],
    })),
  };
  const gebouwd = buildMesh(fijner, () => 0);
  const mesh = gebouwd.mesh as Mesh;
  const numDofs = mesh.getNodeCount() * 3;
  if (numDofs > maxDofs) {
    return nietBepaald(
      `het model heeft na de verdeling in elementen ${numDofs} vrijheidsgraden, meer dan de ` +
        `${maxDofs} waarvoor de directe bepaling van α_cr is bedoeld`,
    );
  }
  const nul = new Array<number>(numDofs).fill(0);

  const uit: AlphaCrUitkomst[] = [];
  for (const combo of uls) {
    const res = combinationResults.get(combo.id);
    if (!res) {
      uit.push({ combinatieId: combo.id, naam: combo.name, alphaCr: null, status: "niet_bepaald", reden: "geen combinatieresultaat" });
      continue;
    }
    // N per rekenelement, in de tekenafspraak die de assemblage verwacht
    // (druk positief; zij klapt hem zelf om — zie NonlinearSolver).
    const axiaal = new Map<number, number>();
    let druk = false;
    for (const [uiId, eersteMeshId] of gebouwd.beamIdMap) {
      const ef = res.elements.get(uiId);
      if (!ef) continue;
      const segs = gebouwd.beamSegments.get(uiId) ?? [{ meshId: eersteMeshId, t0: 0, t1: 1 }];
      for (const seg of segs) {
        const n = normaalkrachtOp(ef, ((seg.t0 + seg.t1) / 2) * ef.L_mm);
        if (n < -1e-9) druk = true;
        axiaal.set(seg.meshId, -n);
      }
    }
    if (!druk) {
      uit.push({ combinatieId: combo.id, naam: combo.name, alphaCr: null, status: "geen_druk" });
      continue;
    }
    // Trek-alleen staven die in deze combinatie op druk stonden, doen ook
    // hier niet mee (issue #234): α_cr hoort bij de constructie zoals zij in
    // deze combinatie werkt, dus met de actieve staven. Zelfde losmaking als
    // in de solver; na deze combinatie terug.
    const herstel = schakelAxiaalGroepenUit(mesh, res.trekAlleenUitgeschakeld ?? []);
    try {
      const instabiel = (alpha: number): boolean => {
        const geschaald = new Map<number, number>();
        for (const [id, n] of axiaal) geschaald.set(id, n * alpha);
        const k = assembleGlobalStiffnessWithGeometric(mesh, geschaald, true);
        const { K } = applyBoundaryConditions(k, nul, mesh);
        return countNonPositivePivots(K) > 0;
      };

      // Zonder normaalkracht hoort het stelsel stabiel te zijn; is het dat niet,
      // dan is het model een mechanisme en zegt α_cr niets.
      if (instabiel(1e-9)) {
        uit.push({
          combinatieId: combo.id, naam: combo.name, alphaCr: null, status: "niet_bepaald",
          reden: "het stelsel is zonder normaalkracht al niet positief definiet (mechanisme of ontbrekende oplegging)",
        });
        continue;
      }
      let laag: number;
      let hoog: number;
      if (!instabiel(ALPHA_CR_GRENS_EERSTE_ORDE)) {
        if (!instabiel(ALPHA_CR_ZOEKGRENS)) {
          uit.push({ combinatieId: combo.id, naam: combo.name, alphaCr: null, status: "boven_grens", grens: ALPHA_CR_ZOEKGRENS });
          continue;
        }
        laag = ALPHA_CR_GRENS_EERSTE_ORDE;
        hoog = ALPHA_CR_ZOEKGRENS;
      } else {
        laag = 0;
        hoog = ALPHA_CR_GRENS_EERSTE_ORDE;
      }
      // Bisectie tot een relatieve nauwkeurigheid van ~0,1 % op de grens van 10.
      for (let i = 0; i < 16; i++) {
        const mid = (laag + hoog) / 2;
        if (instabiel(mid)) hoog = mid; else laag = mid;
      }
      uit.push({ combinatieId: combo.id, naam: combo.name, alphaCr: (laag + hoog) / 2, status: "bepaald" });
    } finally {
      herstel();
    }
  }
  return uit;
}

/** Een getal in de Nederlandse schrijfwijze. */
const nl = (v: number, d = 2): string => v.toFixed(d).replace(".", ",");

/** Kort: "α_cr = 4,64", "α_cr > 100", "geen druk", "niet bepaald". */
export function alphaCrLabel(u: AlphaCrUitkomst): string {
  switch (u.status) {
    case "bepaald": return `α_cr = ${nl(u.alphaCr ?? NaN)}`;
    case "boven_grens": return `α_cr > ${u.grens ?? ALPHA_CR_ZOEKGRENS}`;
    case "geen_druk": return "geen staaf onder druk";
    default: return `α_cr niet bepaald (${u.reden ?? "onbekende reden"})`;
  }
}

export interface StabiliteitsMelding {
  niveau: "fout" | "waarschuwing" | "info";
  tekst: string;
}

/**
 * Wat de gebruiker over α_cr hoort te horen, gegeven het analysetype en de
 * scheefstandschakelaar van de RESULTATEN.
 *
 * INFORMATIEF (issue #199, besluit B14). Tot 2026.42 was eerste orde met
 * α_cr < 10 een FOUT ("EERSTE ORDE NIET TOEGESTAAN … unity checks NIET
 * bruikbaar"), met een melding op het scherm en een rood vak in Inzichten. De
 * UGT-toets rekent sindsdien altijd zelf tweede orde (P-Δ) met scheefstand
 * (NEN-EN 1993-1-1 5.2.2(3)b en (7)b), dus de grens α_cr ≥ 10 van 5.2.1(3)
 * beslist niet meer of de unity checks bruikbaar zijn. Wat α_cr nog zegt,
 * gaat over de resultaten op het scherm: eerste orde toont de
 * tweede-ordevergroting niet, tweede orde zonder scheefstand mist de
 * imperfectie. Daarom zijn die regels "info".
 *
 * De enige FOUT is een geweigerde toets (B7): de tweede-ordeberekening van de
 * toets faalt, en er zijn geen toetskrachten. `weigering` is die reden als
 * tekst (`weigeringTekst`); leeg = de toets heeft krachten.
 */
export function stabiliteitsMeldingen(
  uitkomsten: AlphaCrUitkomst[],
  analysetype: Analysetype,
  scheefstandAan: boolean,
  weigering?: string | null,
): StabiliteitsMelding[] {
  const meldingen: StabiliteitsMelding[] = [];
  const eersteOrde = analysetype === "eersteOrde";
  if (weigering && weigering.trim() !== "") {
    meldingen.push({ niveau: "fout", tekst: `TOETSING GEWEIGERD: ${weigering}` });
  }
  const teLaag = uitkomsten.filter(
    (u) => u.status === "bepaald" && (u.alphaCr ?? Infinity) < ALPHA_CR_GRENS_EERSTE_ORDE,
  );
  if (teLaag.length > 0) {
    const laagste = teLaag.reduce((a, b) => ((b.alphaCr ?? Infinity) < (a.alphaCr ?? Infinity) ? b : a));
    const lijst = teLaag.map((u) => `${nl(u.alphaCr ?? NaN)} ("${u.naam}")`).join(", ");
    const kop =
      `α_cr = ${nl(laagste.alphaCr ?? NaN)} in combinatie "${laagste.naam}" (< ${ALPHA_CR_GRENS_EERSTE_ORDE})` +
      (teLaag.length > 1 ? ` (alle combinaties onder de grens: ${lijst})` : "") +
      ": ";
    if (eersteOrde) {
      meldingen.push({
        niveau: "info",
        tekst:
          kop +
          "de resultaten zijn eerste orde en tonen de tweede-orde-effecten (P-Δ) niet; NEN-EN 1993-1-1 " +
          "5.2.1(3) staat eerste orde alleen toe bij α_cr ≥ 10. De toetskrachten hangen daar niet van " +
          "af: de UGT-toets rekent altijd tweede orde (P-Δ) met scheefstand (5.2.2(3)b en (7)b). Kies " +
          "tweede orde (P-Δ) als ook de momentenlijnen, zakkingen en reacties de vergroting moeten tonen.",
      });
    } else if (!scheefstandAan) {
      meldingen.push({
        niveau: "info",
        tekst:
          kop +
          "de resultaten zijn tweede orde, maar zonder scheefstand (NEN-EN 1993-1-1 5.2.2(3) en 5.3.2 " +
          "vragen de imperfecties in de tweede-ordeberekening). De UGT-toets rekent altijd met " +
          "scheefstand; zet de scheefstand aan als ook de resultaten haar moeten tonen.",
      });
    } else {
      meldingen.push({
        niveau: "info",
        tekst:
          kop +
          "tweede orde met scheefstand — de route van NEN-EN 1993-1-1 5.2.2(3)b en (7)b; de " +
          "staaftoets mag dan de systeemlengte als kniklengte nemen.",
      });
    }
  }
  const nietBepaald = uitkomsten.filter((u) => u.status === "niet_bepaald");
  if (nietBepaald.length > 0 && eersteOrde) {
    const redenen = [...new Set(nietBepaald.map((u) => u.reden ?? "onbekende reden"))].join("; ");
    meldingen.push({
      niveau: "info",
      tekst:
        `α_cr is voor ${nietBepaald.length} combinatie(s) niet bepaald (${redenen}). Of eerste orde ` +
        `voor de resultaten volstaat (α_cr ≥ ${ALPHA_CR_GRENS_EERSTE_ORDE}, NEN-EN 1993-1-1 5.2.1(3)), ` +
        "is daar dus niet gecontroleerd; de toetskrachten zijn altijd tweede orde met scheefstand.",
    });
  }
  return meldingen;
}

// Een noemer om te tonen (200, 230,9); staat bij de scheefstand zelf, zodat ook
// de rapportweergave hem kan gebruiken zonder de rekenkern mee te laden.
export { noemerTekst };

/**
 * De toetskrachten in woorden (issue #199): de UGT-toets rekent altijd tweede
 * orde met scheefstand, los van de instellingen van de resultaten.
 */
export interface ToetsKrachtenOmschrijving {
  /** Het label van de toetsanalyse: "2e orde (P-Δ)" of "2e orde + fysisch". */
  label: string;
  /** 1/φ van de toets. */
  noemer: number;
  /** Waar de φ vandaan komt ("vaste noemer", "EN 1993-1-1 (5.5)", …). */
  bronLabel: string;
  /** In 2D +x en −x, in 3D +X, −X, +Y en −Y. */
  richtingen: "2d" | "3d";
  /** De resultaten waren al deze berekening; de toets rekende niets extra. */
  hergebruikt: boolean;
  /**
   * Er zit beton in het model. De systeemlengte van 5.2.2(7)b is een
   * staalregel; voor beton rekent de P-Δ met de ongescheurde elastische
   * stijfheid en blijft §5.8 ongewijzigd. `toetsKrachtenRegel` zegt dat dan.
   */
  metBeton?: boolean;
}

/** De invoer van `analyseToelichting`. */
export interface AnalyseToelichtingInvoer {
  /** De resultaten: het analysetype en de scheefstandschakelaar van het model. */
  resultaten: {
    analysetype: Analysetype;
    label: string;
    omschrijving: string;
    scheefstandAan: boolean;
    /** 1/φ van de resultaten; alleen van belang met de schakelaar aan. */
    scheefstandNoemer?: number;
  };
  toets: ToetsKrachtenOmschrijving;
  /** α_cr per UGT-combinatie: die van de toets, of zolang die er niet is die van de resultaten. */
  alphaCr: AlphaCrUitkomst[];
  /** Wat er verder te melden is (de meldingen van de toets, de eindstijfheid van hout). */
  meldingen?: readonly string[];
  /** De weigering van de toets (`weigeringTekst`); leeg = de toets heeft krachten. */
  weigering?: string | null;
}

/** De regel over de toetskrachten, ook los te gebruiken (MCP, 3D). */
export function toetsKrachtenRegel(toets: ToetsKrachtenOmschrijving): string {
  return (
    `Toetskrachten (UGT): ${toets.label} met scheefstand φ = 1/${noemerTekst(toets.noemer)} ` +
    `(${toets.bronLabel}), elke UGT-combinatie in ${toets.richtingen === "3d" ? "+X, −X, +Y en −Y" : "+x en −x"}, ` +
    "los van de keuze voor de resultaten; de staaftoets mag dan de systeemlengte als kniklengte " +
    "nemen (NEN-EN 1993-1-1 5.2.2(3)b en (7)b)." +
    (toets.metBeton
      ? " Voor beton geldt dat niet: daar rekent de P-Δ met de ongescheurde elastische stijfheid, wat " +
        "geen tweede orde volgens NEN-EN 1992-1-1 §5.8 is; de poort λ/λ_lim en §5.8 blijven ongewijzigd " +
        "en l₀ volgt §5.8.3.2 uit de kolominvoer."
      : "") +
    (toets.hergebruikt
      ? " De resultaten zijn al deze berekening; de toets gebruikt ze zonder nieuwe som."
      : "")
  );
}

/**
 * Het tekstblok voor het rapport, de PDF en de MCP-uitvoer: welke berekening
 * er is gedaan, α_cr per combinatie en de meldingen — één bron, zodat scherm,
 * papier en MCP niet uiteen kunnen lopen. Regels die met "!" beginnen zijn
 * waarschuwingen of fouten.
 *
 * TWEE BEREKENINGEN (issue #199). De eerste regel gaat over de RESULTATEN:
 * het gekozen analysetype, met of zonder scheefstand; zij gelden ook voor de
 * BGT-toetsen. De tweede over de TOETSKRACHTEN: altijd tweede orde (P-Δ) met
 * scheefstand φ = 1/…, met de systeemlengte volgens 5.2.2(7)b. De grens
 * α_cr ≥ 10 van 5.2.1(3) gaat alleen over de resultaten.
 */
export function analyseToelichting(invoer: AnalyseToelichtingInvoer): string {
  const { resultaten: r, toets, alphaCr: uitkomsten } = invoer;
  const regels: string[] = [];
  regels.push(
    `Resultaten: ${r.label}, ` +
      (r.scheefstandAan
        ? `met scheefstand${r.scheefstandNoemer !== undefined ? ` φ = 1/${noemerTekst(r.scheefstandNoemer)}` : ""}`
        : "zonder scheefstand") +
      `. ${r.omschrijving} Deze keuze geldt voor de resultaten (krachtsverdeling, zakkingen en ` +
      "reacties) en voor de BGT-toetsen (doorbuiging, h/300, scheurwijdte).",
  );
  regels.push(toetsKrachtenRegel(toets));
  regels.push("");
  if (uitkomsten.length === 0) {
    regels.push("Kritieke lastfactor α_cr: geen UGT-combinaties doorgerekend.");
  } else {
    regels.push(
      "Kritieke lastfactor α_cr per UGT-combinatie (NEN-EN 1993-1-1 5.2.1(3)): de factor op de " +
        "belasting van de combinatie waarbij K_e + α·K_g(N_Ed) singulier wordt — de laagste " +
        "knikvorm van het vlakke raamwerk met de normaalkrachten van die combinatie, elke staaf in " +
        "twee elementen (een pendelstaaf in één: haar eigen boogknik met L_cr = L dekt de " +
        "staaftoets). Alleen knik in het vlak; knik uit het vlak blijft de zaak van de staaftoets.",
    );
    for (const u of uitkomsten) regels.push(`    ${alphaCrLabel(u)}   [${u.naam}]`);
    regels.push(
      `Eerste orde is voor de resultaten toegestaan wanneer α_cr ≥ ${ALPHA_CR_GRENS_EERSTE_ORDE} ` +
        "(5.2.1(3)); daaronder tonen eerste-orderesultaten de tweede-orde-effecten niet. Voor de " +
        "toets is α_cr informatief: de toetskrachten zijn altijd tweede orde met scheefstand.",
    );
  }
  const meldingen = stabiliteitsMeldingen(uitkomsten, r.analysetype, r.scheefstandAan, invoer.weigering);
  const overig = (invoer.meldingen ?? []).filter((t) => t.trim() !== "");
  if (meldingen.length > 0 || overig.length > 0) {
    regels.push("");
    for (const m of meldingen) regels.push(m.niveau === "info" ? m.tekst : `! ${m.tekst}`);
    for (const t of overig) regels.push(`! ${t}`);
  }
  return regels.join("\n");
}

/**
 * Wat de toetsbouwers over de stabiliteit van de berekening meekrijgen. In de
 * app en via MCP is dat altijd de stabiliteit van de TOETS (`toetsSet2D`,
 * issue #199): tweede orde met scheefstand, de toets-φ en α_cr van de
 * toetsrekengang.
 *
 * Tot 2026.42 zette `alphaCrStaafNotitie` bij eerste orde met α_cr < 10 een
 * kanttekening bij elke gedrukte staaf (de terugval op de systeemlengte of 2·L
 * zonder zijdelingse knikvorm). Die is weg (B14): de toets rekent nooit eerste
 * orde, dus de grens α_cr ≥ 10 van 5.2.1(3) geldt voor de toets niet.
 */
export interface StabiliteitVoorToets {
  analysetype: Analysetype;
  alphaCr: AlphaCrUitkomst[];
  scheefstandAan: boolean;
  /**
   * De scheefstand φ (rad) waarmee de berekening de verticale lasten een
   * horizontale metgezel H = φ·V gaf. Nodig om te beslissen of de zijdelingse
   * knik van een losse kolom met een vrije kop in de krachten zit
   * (`zijdelingseKnikInVlakModel`). Ontbreekt → niet bekend, en dan geldt 2·L.
   * In de toetsset altijd de toets-φ.
   */
  scheefstandPhi?: number;
  /**
   * Per staaf de φ waarmee haar lasten zijn gerekend als die van
   * `scheefstandPhi` afwijkt: de eigen scheefstand van een losse kolom (issue
   * #199, fase 3, `eigenKolomScheefstand2D`). Daarmee haalt die kolom de
   * φ-eis van `zijdelingseKnikInVlakModel`.
   */
  scheefstandPhiPerStaaf?: ReadonlyMap<number, number>;
  /**
   * De toets rekent hout volgens NEN-EN 1995-1-1 (issue #199, fase 4,
   * instelling `houtToetsEN1995`): E_d = E_mean/γ_M, de boogimperfectie
   * e = 0,0025·l en de onderverdeling zitten in de toetskrachten. Dan mag de
   * houtbouwer de zijdelingse knik van een staande houten staaf als gedekt
   * melden (`zijdelingseKnikHoutInVlakModel`).
   */
  houtEN1995?: boolean;
}

/** Wat `zijdelingseKnikInVlakModel` beslist voor één staaf met een vrij eind. */
export interface ZijdelingseKnikBesluit {
  /** Het kernveld `zijdelingse_knik_in_analyse`; weg = geen as gedekt (2·L). */
  veld?: { y: boolean; z: boolean };
  /** Een kanttekening voor `staaf_notities` als de regel NET niet geldt. */
  notitie?: string;
}

/**
 * Of het VLAKKE model de zijdelingse knik van een STALEN staaf met een vrij
 * eind al in de krachten heeft, en dus om y de systeemlengte L geldt in plaats
 * van 2·L (NEN-EN 1993-1-1 5.2.2(7)b). Gaat naar het kernveld
 * `zijdelingse_knik_in_analyse`. Uit het vlak (z) ziet de berekening niets; daar
 * blijft het altijd 2·L.
 *
 * Gedekt is het alleen als ALLE vier gelden:
 *  - tweede orde (P-Δ of fysisch): eerste orde vergroot niets;
 *  - met scheefstand: zonder verplaatst een centrisch gedrukte kolom niet
 *    zijdelings, en tweede orde vergroot nul;
 *  - een STAANDE staaf (≥ 75°, `referentieVanStaaf`): de scheefstand is een
 *    horizontale metgezel H = φ·V bij de verticale last (`engine.ts`) en stoot
 *    de knikvorm van een kolom aan, niet die van een liggende uitkraging;
 *  - de φ van de berekening is minstens die van de kolom ZELF
 *    (`phiLosseKolom`: h = haar lengte, m = 1). De φ van het model middelt over
 *    alle kolommen en de hoogte van het gebouw; een kolom met een vrije kop
 *    hangt nergens aan en middelt met niets.
 *
 * Alleen voor staal. Hout houdt 2·L: NEN-EN 1995-1-1 eist bij tweede orde
 * E_d = E_mean/γ_M (2.2.2(1)P) en de boogimperfectie van 5.4.4(2), en de
 * P-Δ van deze app rekent met E_mean en zonder boogimperfectie. Dat zegt de
 * vaste houtmelding bij elke houtstaaf (`HOUT_TOETS_STAAFNOTITIE`).
 *
 * In de app en via MCP krijgt deze functie de stabiliteit van de TOETS
 * (`toetsSet2D`, issue #199): altijd tweede orde met scheefstand, met de φ van
 * de toets. De eerste twee voorwaarden zijn daar dus altijd waar; ze blijven
 * staan als bewaking voor een aanroeper met eigen stabiliteitsgegevens. De
 * voorwaarde "staand" en de φ-eis blijven echte voorwaarden. Met de eigen φ
 * per losse kolom (issue #199, fase 3, instelling `scheefstandEigenKolom`)
 * telt voor zo'n kolom de φ van haar eigen lasten (`scheefstandPhiPerStaaf`,
 * over `staafIds`: de staven van de getoetste lijn; de kleinste telt), en die
 * haalt de eis.
 *
 * Geldt alles behalve de φ-eis, dan komt er een kanttekening die zegt waarom
 * het toch 2·L is.
 */
/**
 * De houten tegenhanger van `zijdelingseKnikInVlakModel` (issue #199, fase 4):
 * om y de systeemlengte L voor een STAANDE houten staaf met één vrij eind, als
 * de toets hout volgens NEN-EN 1995-1-1 rekent (`houtEN1995`: E_d, boog e,
 * onderverdeling) en de φ van haar lasten minstens die van NEN-EN 1995-1-1
 * (5.1) is met h = haar lengte (0,005 voor h ≤ 5 m, 0,005·√(5/h) daarboven).
 * Zonder `houtEN1995` niets: dan 2·L, met de vaste houtmelding.
 */
export function zijdelingseKnikHoutInVlakModel(
  stabiliteit: StabiliteitVoorToets | undefined,
  staand: boolean,
  lengteM: number,
  staafIds: readonly number[] = [],
): ZijdelingseKnikBesluit {
  if (!staand || !stabiliteit?.houtEN1995) return {};
  if (stabiliteit.analysetype === "eersteOrde" || !stabiliteit.scheefstandAan) return {};
  const nodig = phiVolgensNorm("en1995", lengteM, 1).phi;
  const perStaaf = stabiliteit.scheefstandPhiPerStaaf;
  const eigen = perStaaf && staafIds.length > 0 && staafIds.every((id) => perStaaf.has(id))
    ? Math.min(...staafIds.map((id) => perStaaf.get(id)!))
    : undefined;
  const gebruikt = eigen ?? stabiliteit.scheefstandPhi;
  if (gebruikt !== undefined && Number.isFinite(gebruikt) && gebruikt >= nodig * (1 - 1e-9)) {
    return { veld: { y: true, z: false } };
  }
  return {
    notitie:
      "VRIJ STAAFEIND, HOUT VOLGENS NEN-EN 1995-1-1: de toets rekent E_d en de boogimperfectie, maar de " +
      (gebruikt !== undefined && Number.isFinite(gebruikt) && gebruikt > 0
        ? `scheefstand φ = 1/${nl(1 / gebruikt, 0)} is kleiner dan `
        : "scheefstand φ is niet bekend en dus niet aantoonbaar minstens ") +
      `φ = 1/${nl(1 / nodig, 0)} volgens NEN-EN 1995-1-1 (5.1) met h = ${nl(lengteM, 3)} m, haar eigen lengte. ` +
      "De kniklengte in het vlak blijft 2·L; zet 'φ losse kolom' aan of geef de kniklengte zelf op.",
  };
}

export function zijdelingseKnikInVlakModel(
  stabiliteit: StabiliteitVoorToets | undefined,
  staand: boolean,
  lengteM: number,
  staafIds: readonly number[] = [],
): ZijdelingseKnikBesluit {
  if (!staand) return {};
  if (!stabiliteit || stabiliteit.analysetype === "eersteOrde" || !stabiliteit.scheefstandAan) return {};
  const nodig = phiLosseKolom(lengteM);
  const perStaaf = stabiliteit.scheefstandPhiPerStaaf;
  const eigen = perStaaf && staafIds.length > 0 && staafIds.every((id) => perStaaf.has(id))
    ? Math.min(...staafIds.map((id) => perStaaf.get(id)!))
    : undefined;
  const gebruikt = eigen ?? stabiliteit.scheefstandPhi;
  if (gebruikt !== undefined && Number.isFinite(gebruikt) && gebruikt >= nodig * (1 - 1e-9)) {
    return { veld: { y: true, z: false } };
  }
  return {
    notitie:
      "VRIJ STAAFEIND, TWEEDE ORDE: de berekening is tweede orde met scheefstand, maar de " +
      (gebruikt !== undefined && Number.isFinite(gebruikt) && gebruikt > 0
        ? `scheefstand φ = 1/${nl(1 / gebruikt, 0)} van het model is kleiner dan `
        : "scheefstand φ van het model is niet bekend en dus niet aantoonbaar minstens ") +
      `φ = 1/${nl(1 / nodig, 0)} die deze kolom zelf hoort te krijgen (NEN-EN 1993-1-1 (5.5) met ` +
      `h = ${nl(lengteM, 3)} m, haar eigen lengte, en m = 1: een kolom met een vrije kop hangt ` +
      "nergens aan en middelt haar scheefstand met niets). Haar zijdelingse knik zit dus niet volledig in " +
      "de krachten, en de kniklengte in het vlak blijft 2·L. Wie L wil gebruiken, rekent met een " +
      "scheefstand van minstens die φ of geeft de kniklengte zelf op.",
  };
}
