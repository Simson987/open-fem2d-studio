/**
 * Selectiefilter (issue #94): een selectie verfijnen op type, profiel,
 * materiaal, groep of staaftype, richting, level, lengte, belastinggeval en
 * lastsoort. Dit is de gedeelde kern van het venster Selectiefilter (2D en
 * 3D) en van het commando `model3d.selection.filter`; de adapters
 * (`openFem3dSelectieFilter.ts`, `fem/selectieFilter2d.ts`) maken van een
 * model en een selectie de lijst {@link FilterElement}en en zetten de
 * uitkomst terug in een selectie.
 *
 * REGELS
 *  - Elk criterium heeft een modus: `keep` (alleen deze houden) of `remove`
 *    (deze weghalen). Een element voldoet aan een criterium als het dat
 *    kenmerk heeft en de waarde ertussen staat. Bij `keep` valt dus ook weg
 *    wat het kenmerk niet heeft: "profiel HEA 200 houden" laat alleen die
 *    staven over, geen knopen of lasten. Bij `remove` blijft het staan.
 *  - Meerdere criteria gelden samen (EN): wat overblijft, haalt ze allemaal.
 *  - Een criterium zonder waarden (of een lengte zonder van en tot) doet niet
 *    mee.
 *  - Een oplegging is een knoop met een oplegging, zoals "Alle selecteren"
 *    bij Opleggingen in de verkenner: type `support` kiest die knopen.
 *  - Richting: verticaal als |ex·Z| > 0,95 (de kolomregel van 3D,
 *    `OPEN_FEM_3D_COLUMN_COSINE`), horizontaal als |ex·Z| < 0,05, anders
 *    schuin. Dezelfde grenzen in 2D (ex·Z = Δz/L).
 *  - Lengtes in mm; de grenzen tellen mee.
 *
 * Zuiver: geen React, geen DOM. Gaat via het API-commando mee in de
 * sidecarbundel.
 */
import { OPEN_FEM_3D_COLUMN_COSINE } from "../openFem3d/openFem3dModel";
import { BEAM_LOAD_ROLES } from "../fem/femTypes";

/** Het soort element in de basis van het filter. */
export type FilterElementSoort = "node" | "beam" | "plate" | "load";
/** Een waarde van het criterium type; `support` is een knoop met een oplegging. */
export type FilterType = FilterElementSoort | "support";
export type FilterRichting = "horizontal" | "vertical" | "sloped";
export type FilterModus = "keep" | "remove";
/**
 * Lastsoorten. 3D: knooplast (krachten en momenten), lijnlast, puntlast op
 * staaf, temperatuurlast, vlaklast, belastingvlak. 2D: puntlast op knoop,
 * moment, lijnlast, puntlast op staaf, temperatuurlast, randlast en puntlast
 * op een plaatrand.
 */
export type FilterLastSoort =
  | "nodal" | "moment" | "line" | "memberPoint" | "thermal" | "surface" | "edge" | "edgePoint" | "loadPanel";

export const FILTER_TYPEN: readonly FilterType[] = ["node", "beam", "plate", "load", "support"];
export const FILTER_RICHTINGEN: readonly FilterRichting[] = ["horizontal", "vertical", "sloped"];
export const FILTER_LAST_SOORTEN: readonly FilterLastSoort[] = [
  "nodal", "moment", "line", "memberPoint", "thermal", "surface", "edge", "edgePoint", "loadPanel",
];

/** Boven deze |ex·Z| is een staaf verticaal: dezelfde grens als een kolom in 3D. */
export const FILTER_VERTICAAL = OPEN_FEM_3D_COLUMN_COSINE;
/** Onder deze |ex·Z| is een staaf horizontaal. */
export const FILTER_HORIZONTAAL = 0.05;

/** Marge op de lengtegrenzen (mm), tegen afrondingsruis van m → mm. */
const LENGTE_MARGE_MM = 1e-6;

/** Eén element waarop het filter werkt, met de kenmerken die het heeft. */
export interface FilterElement {
  soort: FilterElementSoort;
  /** Id binnen zijn soort; een 3D-last is uniek met zijn `loadKind`. */
  id: number;
  /** Knoop: draagt een oplegging. */
  support?: boolean;
  /** Staaf: profielnaam ("" zonder profiel). */
  profile?: string;
  /** Staaf of plaat: materiaal ("" zonder materiaal). */
  material?: string;
  /** 3D-staaf: groep ("" zonder groep). */
  group?: string;
  /** 2D-staaf: staaftype (`BeamLoadRole`). */
  role?: string;
  direction?: FilterRichting;
  lengthMm?: number;
  /** Knoop, staaf of plaat: de levels waarop hij ligt (3D). */
  levels?: readonly string[];
  /** Last: belastinggeval en soort. */
  loadCase?: number;
  loadKind?: FilterLastSoort;
}

export type FilterTekstKenmerk = "profile" | "material" | "group" | "role" | "level";

export type FilterCriterium =
  | { property: "type"; mode: FilterModus; values: readonly FilterType[] }
  | { property: FilterTekstKenmerk; mode: FilterModus; values: readonly string[] }
  | { property: "direction"; mode: FilterModus; values: readonly FilterRichting[] }
  | { property: "loadCase"; mode: FilterModus; values: readonly number[] }
  | { property: "loadKind"; mode: FilterModus; values: readonly FilterLastSoort[] }
  | { property: "length"; mode: FilterModus; fromMm?: number; toMm?: number };

export type FilterKenmerk = FilterCriterium["property"];

/** Aantallen per type; `support` is het deel van de knopen met een oplegging. */
export interface FilterTelling {
  node: number;
  beam: number;
  plate: number;
  load: number;
  support: number;
  /** Knopen, staven, platen en lasten samen. */
  total: number;
}

export interface FilterKeuze<T> { value: T; count: number }

/** De waarden die in de basis voorkomen, met hun aantal: de keuzelijsten van het venster. */
export interface FilterKeuzes {
  type: FilterKeuze<FilterType>[];
  profile: FilterKeuze<string>[];
  material: FilterKeuze<string>[];
  group: FilterKeuze<string>[];
  role: FilterKeuze<string>[];
  direction: FilterKeuze<FilterRichting>[];
  level: FilterKeuze<string>[];
  loadCase: FilterKeuze<number>[];
  loadKind: FilterKeuze<FilterLastSoort>[];
  /** Kortste en langste staaf in de basis (mm); `null` zonder staven. */
  lengthMm: { min: number; max: number } | null;
}

/** Horizontaal, verticaal of schuin uit |ex·Z| (het teken telt niet). */
export function filterRichting(ezAbs: number): FilterRichting {
  const ez = Math.abs(ezAbs);
  if (ez > FILTER_VERTICAAL) return "vertical";
  if (ez < FILTER_HORIZONTAAL) return "horizontal";
  return "sloped";
}

const eindig = (waarde: number | undefined): waarde is number => typeof waarde === "number" && Number.isFinite(waarde);

/** Doet het criterium mee? Een lijst zonder waarden, of een lengte zonder grenzen, niet. */
export function filterCriteriumActief(criterium: FilterCriterium): boolean {
  if (criterium.property === "length") return eindig(criterium.fromMm) || eindig(criterium.toMm);
  return criterium.values.length > 0;
}

/**
 * Keur de criteria (voor de API): een lengte niet negatief en van niet groter
 * dan tot. Gooit een Error met een Nederlandse melding.
 */
export function keurFilterCriteria(criteria: readonly FilterCriterium[]): void {
  for (const criterium of criteria) {
    if (criterium.property !== "length") continue;
    const { fromMm, toMm } = criterium;
    if ((fromMm !== undefined && (!eindig(fromMm) || fromMm < 0)) || (toMm !== undefined && (!eindig(toMm) || toMm < 0))) {
      throw new Error("Een lengte in het filter is een getal van 0 mm of meer.");
    }
    if (eindig(fromMm) && eindig(toMm) && fromMm > toMm) {
      throw new Error(`De lengte "van" (${fromMm} mm) is groter dan "tot" (${toMm} mm).`);
    }
  }
}

/** Heeft het element dit kenmerk met een van de waarden van het criterium? */
export function voldoetAanCriterium(element: FilterElement, criterium: FilterCriterium): boolean {
  switch (criterium.property) {
    case "type":
      return criterium.values.some((type) => type === element.soort
        || (type === "support" && element.soort === "node" && element.support === true));
    case "profile": case "material": case "group": case "role": {
      const waarde = element[criterium.property];
      return waarde !== undefined && criterium.values.includes(waarde);
    }
    case "level":
      return (element.levels ?? []).some((level) => criterium.values.includes(level));
    case "direction":
      return element.direction !== undefined && criterium.values.includes(element.direction);
    case "loadCase":
      return element.loadCase !== undefined && criterium.values.includes(element.loadCase);
    case "loadKind":
      return element.loadKind !== undefined && criterium.values.includes(element.loadKind);
    case "length": {
      const lengte = element.lengthMm;
      if (lengte === undefined) return false;
      if (eindig(criterium.fromMm) && lengte < criterium.fromMm - LENGTE_MARGE_MM) return false;
      if (eindig(criterium.toMm) && lengte > criterium.toMm + LENGTE_MARGE_MM) return false;
      return true;
    }
  }
}

/** Wat overblijft na alle actieve criteria (EN), in de volgorde van de basis. */
export function filterElementen(elementen: readonly FilterElement[], criteria: readonly FilterCriterium[]): FilterElement[] {
  const actief = criteria.filter(filterCriteriumActief);
  return elementen.filter((element) => actief.every((criterium) =>
    voldoetAanCriterium(element, criterium) === (criterium.mode === "keep")));
}

export function filterTelling(elementen: readonly FilterElement[]): FilterTelling {
  const telling: FilterTelling = { node: 0, beam: 0, plate: 0, load: 0, support: 0, total: 0 };
  for (const element of elementen) {
    telling[element.soort] += 1;
    telling.total += 1;
    if (element.soort === "node" && element.support) telling.support += 1;
  }
  return telling;
}

/** Het belastinggeval dat de app na Toepassen met lasten toont; zie {@link filterLastGeval}. */
export interface FilterLastGeval {
  /** Het geval dat actief wordt (of blijft). */
  geval: number;
  /** De gekozen lasten liggen in meer dan één geval: niet alle staan in beeld. */
  meerdere: boolean;
}

/**
 * Welk belastinggeval de app actief maakt na Toepassen (2D en 3D): het
 * tekenvlak toont alleen de lasten van het actieve geval, dus zonder deze
 * stap stonden gefilterde lasten geselecteerd maar niet getekend. Liggen alle
 * gekozen lasten in één geval, dan dat geval. Liggen ze in meerdere, dan
 * blijft het actieve geval als er gekozen lasten in liggen, anders wordt het
 * het laagste; `meerdere` zegt dan dat een deel niet in beeld is (de app
 * meldt dat). `null` als er geen lasten gekozen zijn: dan blijft de weergave
 * zoals hij is.
 */
export function filterLastGeval(gevallen: readonly number[], actief: number): FilterLastGeval | null {
  if (gevallen.length === 0) return null;
  const geval = gevallen.includes(actief) ? actief : gevallen.reduce((a, b) => Math.min(a, b));
  return { geval, meerdere: new Set(gevallen).size > 1 };
}

/** Tekst oplopend en met getallen als getal (HEA 200 vóór HEA 1000); "" achteraan. */
function tekstVolgorde(a: string, b: string): number {
  if (a === "" || b === "") return a === b ? 0 : a === "" ? 1 : -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function tel<T>(waarden: Iterable<T>): Map<T, number> {
  const aantallen = new Map<T, number>();
  for (const waarde of waarden) aantallen.set(waarde, (aantallen.get(waarde) ?? 0) + 1);
  return aantallen;
}

const alsKeuzes = <T>(aantallen: Map<T, number>, volgorde: (a: T, b: T) => number): FilterKeuze<T>[] =>
  [...aantallen].map(([value, count]) => ({ value, count })).sort((a, b) => volgorde(a.value, b.value));

/**
 * De keuzelijsten: alleen waarden die in de basis voorkomen, met hun aantal.
 * Levels in de volgorde van `levelVolgorde` (van laag naar hoog), anders op
 * naam; belastinggevallen op id; staaftypen in de volgorde van de keuzelijst
 * in 2D (`BEAM_LOAD_ROLES`); typen, richtingen en lastsoorten in hun vaste
 * volgorde.
 */
export function filterKeuzes(elementen: readonly FilterElement[], levelVolgorde: readonly string[] = []): FilterKeuzes {
  const typen = new Map<FilterType, number>();
  for (const element of elementen) {
    typen.set(element.soort, (typen.get(element.soort) ?? 0) + 1);
    if (element.soort === "node" && element.support) typen.set("support", (typen.get("support") ?? 0) + 1);
  }
  const vast = <T>(lijst: readonly T[]) => (a: T, b: T) => lijst.indexOf(a) - lijst.indexOf(b);
  const tekst = (kenmerk: "profile" | "material" | "group" | "role", volgorde = tekstVolgorde) =>
    alsKeuzes(tel(elementen.flatMap((element) => element[kenmerk] === undefined ? [] : [element[kenmerk]!])), volgorde);
  const rollen = BEAM_LOAD_ROLES.map((rol) => rol.id as string);
  const rolPlaats = (rol: string) => (rollen.includes(rol) ? rollen.indexOf(rol) : rollen.length);
  const levelPlaats = (level: string) => {
    const plaats = levelVolgorde.indexOf(level);
    return plaats < 0 ? Number.MAX_SAFE_INTEGER : plaats;
  };
  const lengtes = elementen.flatMap((element) => element.lengthMm === undefined ? [] : [element.lengthMm]);
  return {
    type: alsKeuzes(typen, vast(FILTER_TYPEN)),
    profile: tekst("profile"),
    material: tekst("material"),
    group: tekst("group"),
    role: tekst("role", (a, b) => rolPlaats(a) - rolPlaats(b) || tekstVolgorde(a, b)),
    direction: alsKeuzes(tel(elementen.flatMap((element) => element.direction ? [element.direction] : [])), vast(FILTER_RICHTINGEN)),
    level: alsKeuzes(tel(elementen.flatMap((element) => element.levels ?? [])),
      (a, b) => levelPlaats(a) - levelPlaats(b) || tekstVolgorde(a, b)),
    loadCase: alsKeuzes(tel(elementen.flatMap((element) => element.loadCase === undefined ? [] : [element.loadCase])), (a, b) => a - b),
    loadKind: alsKeuzes(tel(elementen.flatMap((element) => element.loadKind ? [element.loadKind] : [])), vast(FILTER_LAST_SOORTEN)),
    // Met reduce en niet Math.min(...): een groot model heeft meer staven dan een aanroep argumenten aankan.
    lengthMm: lengtes.length
      ? { min: lengtes.reduce((a, b) => Math.min(a, b)), max: lengtes.reduce((a, b) => Math.max(a, b)) }
      : null,
  };
}
