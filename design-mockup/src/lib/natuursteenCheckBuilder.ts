/**
 * natuursteenCheckBuilder.ts — de invoer voor de natuursteentoets
 * (`check_natural_stone_elements`, crate `natuursteen-check`, issue #99) uit
 * het formulier "Natuursteen element toetsen".
 *
 * Er is (nog) geen natuurstenen staaf of plaat als modelobject; het element
 * wordt in het formulier beschreven. De bouwer leest de tekstvelden,
 * controleert ze en geeft de invoer of een lijst fouten.
 *
 * OPGAVE MET BRON
 * γ_M, de reductiefactoren (vocht, vorst, duur), f_vk, E, het volumiek
 * gewicht, γ_G, de doorbuigingsgrens en de ankerfactor hebben GEEN
 * standaardwaarde: elke waarde gaat met haar bron naar de kern. Een waarde
 * zonder bron, of een bron zonder waarde, is een fout. Een leeg optioneel
 * paar is toegestaan: de kern meldt dan wat hij daardoor niet kan toetsen.
 */
import type { NatuursteenElementInput } from "./types/natuursteen/NatuursteenElementInput";
import type { Normwaarde } from "./types/natuursteen/Normwaarde";
import type { SterkteOpgave } from "./types/natuursteen/SterkteOpgave";
import type { Reductiefactor } from "./types/natuursteen/Reductiefactor";
import type { ElementSoort } from "./types/natuursteen/ElementSoort";
import type { Buigproef } from "./types/natuursteen/Buigproef";
import type { Verdeling } from "./types/natuursteen/Verdeling";
import type { Liggerschema } from "./types/natuursteen/Liggerschema";
import { leesGetal } from "./metselwerkCheckBuilder";

export { leesGetal };

export const ELEMENTSOORTEN: readonly ElementSoort[] = ["Latei", "Dorpel", "Consoleplaat", "Vloerplaat", "Traptrede", "Gevelplaat"];
export const BUIGPROEVEN: readonly Buigproef[] = ["En12372", "En13161"];
export const VERDELINGEN: readonly Verdeling[] = ["Lognormaal", "Normaal"];
export const LIGGERSCHEMAS: readonly Liggerschema[] = ["VrijOpgelegd", "Uitkragend"];
export const BELASTINGSOORTEN = ["Ligger", "Krachten"] as const;
export type BelastingSoort = (typeof BELASTINGSOORTEN)[number];
/** Hoe een sterkte is opgegeven; "Geen" alleen voor de optionele druksterkte. */
export const STERKTEWIJZEN = ["Proefresultaten", "Karakteristiek"] as const;
export type SterkteWijze = (typeof STERKTEWIJZEN)[number] | "Geen";

/** De paren waarde + bron van het formulier. */
export const OPGAVE_VELDEN = ["gammaM", "kVocht", "kVorst", "kDuur", "fvk", "e", "rho", "gammaG", "grens", "gammaAnker"] as const;
export type OpgaveVeld = (typeof OPGAVE_VELDEN)[number];
/** De drie vaste reductiefactoren met hun naam voor de kern. */
export const REDUCTIEFACTOREN: readonly { veld: OpgaveVeld; naam: string }[] = [
  { veld: "kVocht", naam: "vochttoestand" },
  { veld: "kVorst", naam: "vorst" },
  { veld: "kDuur", naam: "belastingsduur" },
];

/** Een sterkte in het formulier: proefuitkomsten als tekst of één karakteristieke waarde. */
export interface SterkteVeld {
  wijze: SterkteWijze;
  /** Losse waarden, gescheiden door spatie, puntkomma of regeleinde ("14,2; 15,8 …"). */
  waarden: string;
  verdeling: Verdeling;
  karakteristiek: string;
  bron: string;
}

export interface NatuursteenFormulier {
  naam: string;
  soort: ElementSoort;
  steensoort: string;
  buigproef: Buigproef;
  buig: SterkteVeld;
  druk: SterkteVeld;
  opgave: Record<OpgaveVeld, { waarde: string; bron: string }>;
  b: string;
  h: string;
  zijdelingsGesteund: boolean;
  belasting: BelastingSoort;
  schema: Liggerschema;
  l: string; q: string; f: string;
  metEigenGewicht: boolean;
  mEd: string; vEd: string; nEd: string;
  metOplegging: boolean;
  fOpl: string; aOpl: string;
  metDoorbuiging: boolean;
  qSer: string; fSer: string;
  metVerankering: boolean;
  anker: SterkteVeld;
  fAnker: string;
}

const leegSterkte = (wijze: SterkteWijze): SterkteVeld => ({ wijze, waarden: "", verdeling: "Lognormaal", karakteristiek: "", bron: "" });

/** Een leeg formulier: geen opgaven, alleen buiging aan. */
export function leegNatuursteenFormulier(): NatuursteenFormulier {
  const opgave = Object.fromEntries(OPGAVE_VELDEN.map((v) => [v, { waarde: "", bron: "" }])) as NatuursteenFormulier["opgave"];
  return {
    naam: "", soort: "Latei", steensoort: "", buigproef: "En12372",
    buig: leegSterkte("Proefresultaten"), druk: leegSterkte("Geen"), opgave,
    b: "", h: "", zijdelingsGesteund: false,
    belasting: "Ligger", schema: "VrijOpgelegd", l: "", q: "", f: "0", metEigenGewicht: false,
    mEd: "", vEd: "0", nEd: "0",
    metOplegging: false, fOpl: "", aOpl: "",
    metDoorbuiging: false, qSer: "", fSer: "0",
    metVerankering: false, anker: leegSterkte("Proefresultaten"), fAnker: "",
  };
}

/** Losse proefwaarden uit tekst; `null` als er iets geen getal is. */
export function leesWaarden(s: string): number[] | null {
  const delen = s.split(/[;\s]+/).map((d) => d.trim()).filter((d) => d !== "");
  const uit: number[] = [];
  for (const d of delen) {
    const v = leesGetal(d);
    if (v === null) return null;
    uit.push(v);
  }
  return uit;
}

export interface NatuursteenBouwResultaat {
  invoer?: NatuursteenElementInput;
  /** Veldnaam en melding (Nederlands, zoals de kern). */
  fouten: { veld: string; melding: string }[];
}

export function bouwNatuursteenInvoer(f: NatuursteenFormulier, elementId = 1): NatuursteenBouwResultaat {
  const fouten: NatuursteenBouwResultaat["fouten"] = [];
  const getal = (veld: string, s: string, opties: { positief?: boolean; nulToegestaan?: boolean } = {}): number => {
    const v = leesGetal(s);
    if (v === null) {
      fouten.push({ veld, melding: "verplicht getal" });
      return NaN;
    }
    if (opties.positief && !(v > 0)) fouten.push({ veld, melding: "moet groter dan 0 zijn" });
    if (opties.nulToegestaan && v < 0) fouten.push({ veld, melding: "moet 0 of groter zijn" });
    return v;
  };
  const opgave = (veld: OpgaveVeld, verplicht: boolean): Normwaarde | undefined => {
    const { waarde, bron } = f.opgave[veld];
    const v = leesGetal(waarde);
    const heeftBron = bron.trim() !== "";
    if (v === null && !heeftBron) {
      if (verplicht) fouten.push({ veld, melding: "verplicht, met bron" });
      return undefined;
    }
    if (v === null || !(v > 0)) {
      fouten.push({ veld, melding: "waarde ontbreekt of is niet groter dan 0" });
      return undefined;
    }
    if (!heeftBron) {
      fouten.push({ veld, melding: "bron ontbreekt (richtlijn, productverklaring of proefrapport)" });
      return undefined;
    }
    return { waarde: v, bron: bron.trim() };
  };
  const sterkte = (veld: string, s: SterkteVeld): SterkteOpgave | undefined => {
    if (s.wijze === "Geen") return undefined;
    if (s.bron.trim() === "") fouten.push({ veld, melding: "bron ontbreekt (proefrapport of productverklaring)" });
    if (s.wijze === "Karakteristiek") {
      return { soort: "Karakteristiek", waarde: getal(veld, s.karakteristiek, { positief: true }), bron: s.bron.trim() };
    }
    const waarden = leesWaarden(s.waarden);
    if (waarden === null) fouten.push({ veld, melding: "proefwaarden: alleen getallen, gescheiden door spatie of puntkomma" });
    else if (waarden.length < 3) fouten.push({ veld, melding: "minstens 3 proefwaarden (NEN-EN 1990 tabel D.1)" });
    else if (waarden.some((v) => !(v > 0))) fouten.push({ veld, melding: "proefwaarden moeten groter dan 0 zijn" });
    return { soort: "Proefresultaten", waarden: waarden ?? [], verdeling: s.verdeling, bron: s.bron.trim() };
  };

  const buigsterkte = sterkte("buig", f.buig);
  const druksterkte = sterkte("druk", f.druk);
  const gammaM = opgave("gammaM", true);
  const reductiefactoren: Reductiefactor[] = [];
  for (const { veld, naam } of REDUCTIEFACTOREN) {
    const r = opgave(veld, false);
    if (r && r.waarde > 1) fouten.push({ veld, melding: "een reductiefactor ligt tussen 0 en 1" });
    if (r) reductiefactoren.push({ naam, waarde: r.waarde, bron: r.bron });
  }
  const fvk = opgave("fvk", false);
  const e = opgave("e", f.metDoorbuiging);
  const rho = opgave("rho", f.metEigenGewicht && f.belasting === "Ligger");
  if (f.steensoort.trim() === "") fouten.push({ veld: "steensoort", melding: "verplicht (naam van de steen)" });

  const invoer: NatuursteenElementInput = {
    element_id: elementId,
    naam: f.naam.trim(),
    soort: f.soort,
    materiaal: {
      steensoort: f.steensoort.trim(),
      buigproef: f.buigproef,
      buigsterkte: buigsterkte ?? { soort: "Karakteristiek", waarde: NaN, bron: "" },
      ...(druksterkte ? { druksterkte } : {}),
      ...(fvk ? { schuifsterkte: fvk } : {}),
      gamma_m: gammaM ?? { waarde: NaN, bron: "" },
      reductiefactoren,
      ...(e ? { e_modulus: e } : {}),
      ...(rho ? { volumiek_gewicht: rho } : {}),
    },
    doorsnede: { b_mm: getal("b", f.b, { positief: true }), h_mm: getal("h", f.h, { positief: true }) },
    zijdelings_gesteund: f.zijdelingsGesteund,
    belasting: f.belasting === "Ligger"
      ? {
        soort: "Ligger", schema: f.schema, l_m: getal("l", f.l, { positief: true }),
        q_ed_kn_m: getal("q", f.q, { nulToegestaan: true }), f_ed_kn: getal("f", f.f, { nulToegestaan: true }),
        ...(f.metEigenGewicht ? (() => { const g = opgave("gammaG", true); return g ? { gamma_g: g } : {}; })() : {}),
      }
      : { soort: "Krachten", m_ed_knm: getal("mEd", f.mEd), v_ed_kn: getal("vEd", f.vEd), n_ed_kn: getal("nEd", f.nEd) },
  };
  if (f.metOplegging) {
    invoer.oplegging = { f_ed_kn: getal("fOpl", f.fOpl, { nulToegestaan: true }), a_mm: getal("aOpl", f.aOpl, { positief: true }) };
  }
  if (f.metDoorbuiging) {
    const grens = opgave("grens", true);
    invoer.doorbuiging = {
      q_ser_kn_m: getal("qSer", f.qSer, { nulToegestaan: true }), f_ser_kn: getal("fSer", f.fSer, { nulToegestaan: true }),
      grens: grens ?? { waarde: NaN, bron: "" },
    };
  }
  if (f.metVerankering) {
    const breuklast = sterkte("anker", f.anker.wijze === "Geen" ? { ...f.anker, wijze: "Proefresultaten" } : f.anker);
    const gamma = opgave("gammaAnker", true);
    invoer.verankering = {
      breuklast: breuklast ?? { soort: "Karakteristiek", waarde: NaN, bron: "" },
      gamma: gamma ?? { waarde: NaN, bron: "" },
      f_ed_kn: getal("fAnker", f.fAnker, { nulToegestaan: true }),
    };
  }
  return fouten.length > 0 ? { fouten } : { invoer, fouten };
}
