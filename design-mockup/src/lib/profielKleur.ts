/**
 * profielKleur.ts — "Profielen in kleur" (verkenner, tab Weergave; 2D en 3D):
 * elk profiel een eigen kleur op het tekenvlak, met een legenda welk profiel
 * welke kleur is. Geen React; het tekenvlak, de 3D-weergave en de legenda
 * lezen allemaal deze ene toekenning.
 *
 * TOEKENNING. Per uniek profiel één regel, gesorteerd op profielnaam (numeriek:
 * IPE 80 vóór IPE 200), en de kleuren uit het vaste palet in die volgorde. Dus:
 *   - stabiel: hetzelfde model geeft dezelfde kleuren, ongeacht de volgorde
 *     van de staven en ongeacht de taal (gesorteerd op de taalonafhankelijke
 *     naam, niet op de vertaalde weergave);
 *   - uniek: elk profiel een eigen kleur (tot 24 profielen, zie UITBREIDING);
 *   - "IPE 200" en "IPE200" zijn één profiel (zelfde regel als de 3D-batches);
 *   - komt dezelfde naam in verschillende materialen voor (200x600 in GL24h én
 *     C24), dan is dat per materiaal een eigen regel: "200x600 · GL24h";
 *   - staven zonder profiel krijgen een neutraal grijs en staan onderaan de
 *     legenda als "zonder profiel". Ze nemen geen paletkleur in.
 * Een profiel dat bijkomt, kan de kleur van de profielen die erna sorteren
 * verschuiven: de kleur volgt het profiel binnen dít model, niet een vaste
 * kleur per catalogusnaam (die zou bij twee profielen met toevallig dezelfde
 * kleur niets meer onderscheiden).
 *
 * PALET. Acht kleuren, gekozen en gecontroleerd met de zes controles van een
 * categorisch palet (OKLCH-lichtheid, chroma, kleurenblindheid, contrast):
 *   - leesbaar op het lichte (#FAFAF9) én het donkere (#27272A) tekenvlak en
 *     op het witte 3D-vlak: contrast ≥ 3:1 op alle drie;
 *   - buren in de legenda blijven onderscheidbaar bij protanopie en
 *     deuteranopie (ΔE_OK ≥ 10, doel 8) en bij normaal zien (ΔE_OK ≥ 21);
 *     geen twee paletkleuren liggen dichter dan ΔE_OK 11 bij elkaar;
 *   - GEEN oranje of amber: dat is de accentkleur van de staven en de
 *     selectiekleur (elke paletkleur ligt er ≥ ΔE_OK 12 vandaan). Een
 *     geselecteerde staaf blijft zo altijd herkenbaar.
 *
 * UITBREIDING. Meer profielen dan paletkleuren: de kleuren gaan een tweede en
 * derde ronde mee, met een tweede kenmerk erbij zodat elk profiel uniek blijft:
 *   - 2D: dezelfde kleur als streep- (ronde 2) en stippellijn (ronde 3). Een
 *     lijnsoort is in elk thema even goed te zien; een donkerder of lichter
 *     tint zou in één van de twee thema's wegvallen;
 *   - 3D: een donkere (ronde 2) en een lichte (ronde 3) variant van dezelfde
 *     tint. Het 3D-vlak is altijd wit, en een volume heeft geen lijnsoort.
 * Boven de 24 profielen herhaalt het patroon zich; de legenda noemt ze elk.
 *
 * VOORRANG. De selectie gaat altijd voor (2D: accentkleur met gloed; 3D: de
 * selectiekleur). In 3D gaat de unity-checkkleuring voor zolang die in beeld
 * is: dan kleuren ALLE staven naar hun UC en verdwijnt de profiellegenda, zodat
 * de twee kleurschema's nooit door elkaar staan. Het 2D-tekenvlak kleurt
 * staven niet naar hun UC (daar staat een label op het staafmidden) en de
 * snedekrachtlijnen liggen er in hun eigen kleur bovenop; de profielkleur blijft
 * daar dus staan.
 */
import { doorsnedeNaam, doorsnedeNaamVertaald } from "./verloopKeuze";
import type { Vertaalfunctie } from "./vertaalbareTekst";

/** Het vaste palet (#rrggbb), in deze volgorde toegekend. */
export const PROFIEL_PALET: readonly string[] = [
  "#508ff9", // blauw
  "#cd2e73", // framboos
  "#1178a5", // petrol
  "#298509", // groen
  "#bf6bd2", // orchidee
  "#8a9500", // olijf
  "#765dcf", // violet
  "#0e9a94", // blauwgroen
];

/**
 * 3D: per ronde de tinten van het palet — de basiskleur, een donkere (OKLCH
 * L − 0,14) en een lichte (L + 0,10) variant van dezelfde tint en chroma.
 */
export const PROFIEL_PALET_3D: readonly (readonly string[])[] = [
  PROFIEL_PALET,
  ["#2663c9", "#92084c", "#004e6f", "#185705", "#9240a4", "#626a09", "#5032a0", "#0c6c67"],
  ["#84b2fe", "#f15391", "#3c97c5", "#4ba436", "#e08af4", "#a8b539", "#937cf1", "#42bab3"],
];

/**
 * 2D: per ronde de lijnsoort (stroke-dasharray bij de ronde lijnkoppen van de
 * staaflijn): doorgetrokken, gestreept, gestippeld.
 */
export const PROFIEL_STREPEN: readonly string[] = ["", "10 7", "0.1 6"];

/** Staven zonder profiel: neutraal grijs, leesbaar in beide thema's (≥ 3:1). */
export const ZONDER_PROFIEL_KLEUR = "#8a8a8a";

/** Wat de toekenning van een staaf nodig heeft. */
export interface ProfielKleurStaaf {
  id: number;
  /**
   * De taalonafhankelijke doorsnedenaam (sleutel en sortering), bijvoorbeeld
   * "IPE270" of "IPE 300 → IPE 200 (verlopend)". Leeg of ontbrekend = geen
   * profiel.
   */
  profiel?: string | null;
  /** De naam in de taal van de interface; standaard `profiel`. */
  weergave?: string | null;
  materiaal?: string | null;
}

/** Eén regel van de legenda: een profiel met zijn kleur en zijn staven. */
export interface ProfielKleurRegel {
  /** Stabiele sleutel: genormaliseerde naam, met materiaal als dat onderscheidt. */
  sleutel: string;
  /** Wat de legenda toont ("IPE 270", "200x600 · GL24h"); leeg bij zonder profiel. */
  naam: string;
  /** Het materiaal als het deze regel onderscheidt, anders null. */
  materiaal: string | null;
  zonderProfiel: boolean;
  /** Plaats in de toekenning (0 = eerste paletkleur); −1 bij zonder profiel. */
  index: number;
  /** Kleur in het palet (0–7). */
  slot: number;
  /** Ronde door het palet (0 = eerste acht profielen). */
  ronde: number;
  /** De kleur op het 2D-tekenvlak en in de 2D-legenda. */
  kleur: string;
  /** De 2D-lijnsoort (stroke-dasharray); "" = doorgetrokken. */
  streep: string;
  /** De kleur in de 3D-weergave en de 3D-legenda. */
  kleur3d: string;
  aantal: number;
  /** De staaf-id's, oplopend. */
  staven: number[];
}

export interface ProfielKleuring {
  /** De legenda: profielen op volgorde, "zonder profiel" als laatste. */
  regels: ProfielKleurRegel[];
  perStaaf: Map<number, ProfielKleurRegel>;
}

/** Vaste, taalonafhankelijke sortering: numeriek, hoofdletterongevoelig. */
const SORTEER = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

const netjes = (s: string) => s.trim().replace(/\s+/g, " ");
/** "IPE 200", "ipe200" en "IPE200" → "IPE200" (zoals de 3D-profielbatches). */
const naamSleutel = (s: string) => netjes(s).toUpperCase().replace(/\s+(?=\d)/g, "");
const vergelijk = (a: string, b: string) => SORTEER.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/** De kleur, lijnsoort en 3D-kleur voor plaats `index` in de toekenning. */
export function profielKleurVoorIndex(index: number): { slot: number; ronde: number; kleur: string; streep: string; kleur3d: string } {
  const n = PROFIEL_PALET.length;
  const slot = index % n;
  const ronde = Math.floor(index / n);
  return {
    slot,
    ronde,
    kleur: PROFIEL_PALET[slot],
    streep: PROFIEL_STREPEN[ronde % PROFIEL_STREPEN.length],
    kleur3d: PROFIEL_PALET_3D[ronde % PROFIEL_PALET_3D.length][slot],
  };
}

/** Alle staven met dezelfde genormaliseerde naam, per materiaal. */
interface NaamGroep {
  sleutel: string;
  /** De getoonde schrijfwijze: de kleinste, dus niet afhankelijk van de staafvolgorde. */
  profiel: string;
  weergave: string;
  perMateriaal: Map<string | null, number[]>;
}

/**
 * De kleurtoekenning voor een model: één regel per uniek profiel (met
 * materiaal waar dat onderscheidt), gesorteerd op naam, plus "zonder profiel".
 */
export function profielKleuring(staven: readonly ProfielKleurStaaf[]): ProfielKleuring {
  const perNaam = new Map<string, NaamGroep>();
  const zonder: number[] = [];
  for (const s of staven) {
    const profiel = netjes(s.profiel ?? "");
    if (profiel === "") { zonder.push(s.id); continue; }
    const sleutel = naamSleutel(profiel);
    const materiaal = netjes(s.materiaal ?? "") || null;
    const weergave = netjes(s.weergave ?? "") || profiel;
    let g = perNaam.get(sleutel);
    if (!g) { g = { sleutel, profiel, weergave, perMateriaal: new Map() }; perNaam.set(sleutel, g); }
    if (vergelijk(profiel, g.profiel) < 0 || (profiel === g.profiel && vergelijk(weergave, g.weergave) < 0)) {
      g.profiel = profiel;
      g.weergave = weergave;
    }
    const ids = g.perMateriaal.get(materiaal);
    if (ids) ids.push(s.id); else g.perMateriaal.set(materiaal, [s.id]);
  }
  const groepen: { sleutel: string; profiel: string; weergave: string; materiaal: string | null; onderscheid: boolean; staven: number[] }[] = [];
  for (const g of perNaam.values()) {
    const onderscheid = g.perMateriaal.size > 1;
    for (const [materiaal, ids] of g.perMateriaal) {
      groepen.push({ sleutel: g.sleutel, profiel: g.profiel, weergave: g.weergave, materiaal, onderscheid, staven: ids });
    }
  }
  groepen.sort((a, b) =>
    vergelijk(a.profiel, b.profiel) || vergelijk(a.materiaal ?? "", b.materiaal ?? "") || vergelijk(a.sleutel, b.sleutel));
  const regels: ProfielKleurRegel[] = groepen.map((g, index) => ({
    sleutel: g.onderscheid ? `${g.sleutel}|${(g.materiaal ?? "").toUpperCase()}` : g.sleutel,
    naam: g.onderscheid ? `${g.weergave} · ${g.materiaal ?? "—"}` : g.weergave,
    materiaal: g.onderscheid ? g.materiaal : null,
    zonderProfiel: false,
    index,
    ...profielKleurVoorIndex(index),
    aantal: g.staven.length,
    staven: [...g.staven].sort((a, b) => a - b),
  }));
  if (zonder.length > 0) {
    regels.push({
      sleutel: "",
      naam: "",
      materiaal: null,
      zonderProfiel: true,
      index: -1,
      slot: -1,
      ronde: 0,
      kleur: ZONDER_PROFIEL_KLEUR,
      streep: "",
      kleur3d: ZONDER_PROFIEL_KLEUR,
      aantal: zonder.length,
      staven: [...zonder].sort((a, b) => a - b),
    });
  }
  const perStaaf = new Map<number, ProfielKleurRegel>();
  for (const r of regels) for (const id of r.staven) perStaaf.set(id, r);
  return { regels, perStaaf };
}

/**
 * De toekenning voor de staven van het 2D-model. Sleutel en sortering op de
 * taalonafhankelijke doorsnedenaam (een verlopende staaf is een eigen profiel:
 * "IPE 300 → IPE 200 (verlopend)"), de legenda in de taal van de interface.
 * Zonder materiaal: S235, zoals de verkenner en de solver.
 */
export function profielKleuring2d(
  beams: readonly { id: number; material?: string; profile?: string; profileEnd?: string }[],
  t: Vertaalfunctie,
): ProfielKleuring {
  return profielKleuring(beams.map((b) => ({
    id: b.id,
    profiel: b.profile ? doorsnedeNaam(b) : null,
    weergave: b.profile ? doorsnedeNaamVertaald(b, t) : null,
    materiaal: b.material ?? "S235",
  })));
}

/**
 * De toekenning voor de staven van een 3D-model (`profileName`, `material`).
 * Een verlopende staaf (`profileNameEnd`, #73) is een eigen profiel met
 * dezelfde naam als in 2D: "IPE 300 → IPE 200 (verlopend)"; met `t` staat de
 * legenda in de taal van de interface.
 */
export function openFem3DProfielKleuring(
  beams: readonly { id: number; profileName?: string; profileNameEnd?: string; material?: string }[],
  t?: Vertaalfunctie,
): ProfielKleuring {
  return profielKleuring(beams.map((b) => {
    const als2d = { material: b.material, profile: b.profileName, profileEnd: b.profileNameEnd };
    return {
      id: b.id,
      profiel: b.profileName ? doorsnedeNaam(als2d) : null,
      ...(b.profileName && t ? { weergave: doorsnedeNaamVertaald(als2d, t) } : {}),
      materiaal: b.material ?? null,
    };
  }));
}

/**
 * Kleurt de 3D-weergave de staven naar hun profiel? Alleen met de optie aan,
 * en NIET zolang de unity-checkkleuring in beeld is (`utilization` aan en er
 * zijn toetsuitkomsten): die gaat voor, voor alle staven tegelijk.
 */
export function profielKleurenActief3d(
  zicht: { profileColors?: boolean; utilization?: boolean },
  aantalUcWaarden: number,
): boolean {
  return zicht.profileColors === true && !(zicht.utilization === true && aantalUcWaarden > 0);
}

/** "#rrggbb" → 0xrrggbb, voor Three.js. */
export function kleurGetal(kleur: string): number {
  return Number.parseInt(kleur.replace(/^#/, ""), 16);
}
