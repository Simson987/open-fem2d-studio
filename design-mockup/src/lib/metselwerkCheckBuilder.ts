/**
 * metselwerkCheckBuilder.ts — de invoer voor de NEN-EN 1996-1-1-kern
 * (`check_masonry_walls`, crate `metselwerk-check`, issue #98) uit het
 * formulier "Metselwerkwand toetsen".
 *
 * Er is (nog) geen metselwerkwand als modelobject (#97); de wand wordt daarom
 * in het formulier beschreven en de krachten worden ingetypt. De bouwer leest
 * de tekstvelden, controleert ze en geeft de invoer of een lijst fouten.
 *
 * NATIONAAL TE KIEZEN PARAMETERS
 * K, γ_M, K_E, φ_∞, f_vk0, f_xk1 en f_xk2 hebben GEEN standaardwaarde: elke
 * waarde gaat met haar bron naar de kern (zoals de rolschuif van CLT,
 * `cltFvRolK` + `cltFvRolKBron`). Een waarde zonder bron, of een bron zonder
 * waarde, is een fout. Een leeg optioneel paar is toegestaan: de kern meldt
 * dan de toets die hem nodig heeft als "niet getoetst".
 */
import type { MetselwerkWandInput } from "./types/metselwerk/MetselwerkWandInput";
import type { Normwaarde } from "./types/metselwerk/Normwaarde";
import type { Steensoort } from "./types/metselwerk/Steensoort";
import type { Steengroep } from "./types/metselwerk/Steengroep";
import type { Mortelsoort } from "./types/metselwerk/Mortelsoort";
import type { Breukvlak } from "./types/metselwerk/Breukvlak";
import type { Steunranden } from "./types/metselwerk/Steunranden";

export const STEENSOORTEN: readonly Steensoort[] = [
  "Baksteen", "Kalkzandsteen", "Betonsteen", "Cellenbeton", "Kunststeen", "Natuursteen",
];
export const STEENGROEPEN: readonly Steengroep[] = ["Groep1", "Groep2", "Groep3", "Groep4"];
export const MORTELSOORTEN: readonly Mortelsoort[] = ["Algemeen", "Lijm", "Licht"];
export const BREUKVLAKKEN: readonly Breukvlak[] = ["EvenwijdigAanLintvoegen", "LoodrechtOpLintvoegen"];
export type SteunrandSoort = Steunranden["soort"];
export const STEUNRANDSOORTEN: readonly SteunrandSoort[] = ["BovenOnder", "EenVerticaleRand", "TweeVerticaleRanden"];

/** De NDP-velden van het formulier: waarde en bron als tekst. */
export const NDP_VELDEN = ["k", "gammaM", "kE", "phiInf", "fvk0", "fxk1", "fxk2"] as const;
export type NdpVeld = (typeof NDP_VELDEN)[number];

export interface MetselwerkFormulier {
  naam: string;
  steensoort: Steensoort;
  steengroep: Steengroep;
  mortel: Mortelsoort;
  fb: string;
  fm: string;
  langsvoeg: boolean;
  stootvoegenGevuld: boolean;
  ndp: Record<NdpVeld, { waarde: string; bron: string }>;
  t: string;
  h: string;
  l: string;
  steunranden: SteunrandSoort;
  lRand: string;
  betonvloeren: boolean;
  metVerticaal: boolean;
  nBoven: string; mBoven: string;
  nMidden: string; mMidden: string;
  nOnder: string; mOnder: string;
  metGeconcentreerd: boolean;
  lastNaam: string; nEdc: string; lB: string; b: string; a1: string; hC: string; e: string;
  metAfschuiving: boolean;
  vEd: string; nEdV: string; mEdV: string;
  metBuiging: boolean;
  mEdUit: string;
  breukvlak: Breukvlak;
}

/** Een leeg formulier: geen NDP-waarden, alles uit. */
export function leegMetselwerkFormulier(): MetselwerkFormulier {
  const leeg = { waarde: "", bron: "" };
  return {
    naam: "",
    steensoort: "Kalkzandsteen", steengroep: "Groep1", mortel: "Lijm",
    fb: "", fm: "", langsvoeg: false, stootvoegenGevuld: false,
    ndp: { k: { ...leeg }, gammaM: { ...leeg }, kE: { ...leeg }, phiInf: { ...leeg }, fvk0: { ...leeg }, fxk1: { ...leeg }, fxk2: { ...leeg } },
    t: "", h: "", l: "", steunranden: "BovenOnder", lRand: "", betonvloeren: false,
    metVerticaal: true, nBoven: "", mBoven: "0", nMidden: "", mMidden: "0", nOnder: "", mOnder: "0",
    metGeconcentreerd: false, lastNaam: "", nEdc: "", lB: "", b: "", a1: "", hC: "", e: "0",
    metAfschuiving: false, vEd: "", nEdV: "", mEdV: "0",
    metBuiging: false, mEdUit: "", breukvlak: "EvenwijdigAanLintvoegen",
  };
}

/** Een getal uit een tekstveld; komma als decimaalteken toegestaan. */
export function leesGetal(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export interface MetselwerkBouwResultaat {
  invoer?: MetselwerkWandInput;
  /** Veldnaam en melding (Nederlands, zoals de kern). */
  fouten: { veld: string; melding: string }[];
}

export function bouwMetselwerkInvoer(f: MetselwerkFormulier, wandId = 1): MetselwerkBouwResultaat {
  const fouten: MetselwerkBouwResultaat["fouten"] = [];
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
  const ndp = (veld: NdpVeld, verplicht: boolean): Normwaarde | undefined => {
    const { waarde, bron } = f.ndp[veld];
    const v = leesGetal(waarde);
    const heeftBron = bron.trim() !== "";
    if (v === null && !heeftBron) {
      if (verplicht) fouten.push({ veld, melding: "verplicht, met bron (nationaal te kiezen parameter)" });
      return undefined;
    }
    if (v === null || !(v > 0)) {
      fouten.push({ veld, melding: "waarde ontbreekt of is niet groter dan 0" });
      return undefined;
    }
    if (!heeftBron) {
      fouten.push({ veld, melding: "bron ontbreekt (NB-tabel of productverklaring)" });
      return undefined;
    }
    return { waarde: v, bron: bron.trim() };
  };

  const fb = getal("fb", f.fb, { positief: true });
  const fm = f.mortel === "Algemeen" ? getal("fm", f.fm, { positief: true }) : leesGetal(f.fm);
  const k = ndp("k", true);
  const gammaM = ndp("gammaM", true);
  const kE = ndp("kE", false);
  const phiInf = ndp("phiInf", false);
  const fvk0 = ndp("fvk0", false);
  const fxk1 = ndp("fxk1", false);
  const fxk2 = ndp("fxk2", false);
  const t = getal("t", f.t, { positief: true });
  const h = getal("h", f.h, { positief: true });
  const l = getal("l", f.l, { positief: true });
  let steunranden: Steunranden = { soort: "BovenOnder" };
  if (f.steunranden !== "BovenOnder") {
    steunranden = { soort: f.steunranden, l_m: getal("lRand", f.lRand, { positief: true }) };
  }

  const invoer: MetselwerkWandInput = {
    wand_id: wandId,
    naam: f.naam.trim(),
    materiaal: {
      steensoort: f.steensoort,
      steengroep: f.steengroep,
      mortel: f.mortel,
      f_b_mpa: fb,
      ...(fm !== null && Number.isFinite(fm) ? { f_m_mpa: fm } : {}),
      k: k ?? { waarde: NaN, bron: "" },
      langsvoeg: f.langsvoeg,
      gamma_m: gammaM ?? { waarde: NaN, bron: "" },
      ...(kE ? { k_e: kE } : {}),
      ...(phiInf ? { phi_inf: phiInf } : {}),
      ...(fvk0 ? { f_vk0_mpa: fvk0 } : {}),
      stootvoegen_gevuld: f.stootvoegenGevuld,
      ...(fxk1 ? { f_xk1_mpa: fxk1 } : {}),
      ...(fxk2 ? { f_xk2_mpa: fxk2 } : {}),
    },
    geometrie: { t_mm: t, h_m: h, l_m: l, steunranden, betonvloeren: f.betonvloeren },
    geconcentreerd: [],
  };
  if (f.metVerticaal) {
    invoer.verticaal = {
      n_boven_kn_m: getal("nBoven", f.nBoven), m_boven_knm_m: getal("mBoven", f.mBoven),
      n_midden_kn_m: getal("nMidden", f.nMidden), m_midden_knm_m: getal("mMidden", f.mMidden),
      n_onder_kn_m: getal("nOnder", f.nOnder), m_onder_knm_m: getal("mOnder", f.mOnder),
    };
  }
  if (f.metGeconcentreerd) {
    invoer.geconcentreerd.push({
      naam: f.lastNaam.trim(),
      n_edc_kn: getal("nEdc", f.nEdc, { positief: true }),
      l_b_mm: getal("lB", f.lB, { positief: true }),
      b_mm: getal("b", f.b, { positief: true }),
      a1_mm: getal("a1", f.a1, { nulToegestaan: true }),
      h_c_m: getal("hC", f.hC, { positief: true }),
      e_mm: getal("e", f.e),
    });
  }
  if (f.metAfschuiving) {
    invoer.afschuiving = { v_ed_kn: getal("vEd", f.vEd), n_ed_kn: getal("nEdV", f.nEdV), m_ed_knm: getal("mEdV", f.mEdV) };
  }
  if (f.metBuiging) {
    invoer.buiging = { m_ed_knm_m: getal("mEdUit", f.mEdUit), breukvlak: f.breukvlak };
  }
  return fouten.length > 0 ? { fouten } : { invoer, fouten };
}
