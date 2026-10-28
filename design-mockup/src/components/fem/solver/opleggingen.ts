/**
 * opleggingen.ts — opleggingen per knoop samenvoegen per vrijheidsgraad.
 *
 * WAAROM DIT BESTAAT (controle 26 oktober 2026, issue #223)
 *
 * #223 — Twee opleggingen op één knoop (bijvoorbeeld `pinned` + `rotSpring`
 *   voor een verend ingeklemde voet) werden niet per vrijheidsgraad
 *   samengevoegd: de engine zette per oplegging ALLE vrijheidsgraden van de
 *   knoop opnieuw, dus alleen de laatste telde. `pinned` gevolgd door
 *   `rotSpring` liet de knoop horizontaal en verticaal vrij (weigering zonder
 *   te zeggen waarom); `rotSpring` gevolgd door `pinned` rekende een vrij
 *   opgelegde ligger, maar de reactietabel nam de eerste oplegging en toonde
 *   −k·θ als fictief veermoment (44,98 kNm waar 22,50 kNm hoort).
 *
 * DE REGEL, voor alle wegen naar de kern (TS-engine, Rust-raamwerkroute,
 * validatie van de MCP en de modelcontrole van de app):
 *  - Per knoop en per richting (x, z, rotatie) één steun: vrij, star of veer.
 *  - Meerdere opleggingen op één knoop worden per richting samengevoegd.
 *    Star + star in dezelfde richting is onschuldig (zelfde steun). Star +
 *    veer of veer + veer in dezelfde richting is tegenstrijdig of dubbelzinnig
 *    en wordt GEWEIGERD met knoop en richting.
 *  - Een veer zonder positieve stijfheid telt (nog) als starre steun in
 *    die richting, zoals het contract in types.ts zegt.
 *
 * Puur: geen React, geen kern. De meldingen zijn Nederlands; de app vertaalt
 * via de bevinding in `lib/modelControle.ts`.
 */

/** Een richting op een knoop in het vlakke raamwerk. */
export type SteunRichting = "x" | "z" | "ry";

export type RichtingSteun =
  | { soort: "vrij" }
  | { soort: "star"; door: string }
  | { soort: "veer"; k: number; door: string };

/** De samengevoegde steun van één knoop. */
export interface KnoopSteun {
  nodeId: number;
  x: RichtingSteun;
  z: RichtingSteun;
  ry: RichtingSteun;
  /** De opleggingstypen op deze knoop, in invoervolgorde. */
  typen: string[];
}

export interface OpleggingBevinding {
  nodeId: number;
  ernst: "fout" | "waarschuwing";
  soort: "veerStijfheid" | "tegenstrijdig" | "samengevoegd";
  /** Nederlandse melding, met knoop en richting. */
  tekst: string;
  /** Plaatshouders voor de vertaalde melding in de app. */
  waarden: Record<string, string | number>;
}

/** Starre richtingen per opleggingstype. */
const STAR: Record<string, SteunRichting[]> = {
  fixed: ["x", "z", "ry"],
  pinned: ["x", "z"],
  xRoller: ["x"],
  zRoller: ["z"],
};

/** Verende richting per veertype. */
const VEER: Record<string, SteunRichting> = {
  xSpring: "x",
  zSpring: "z",
  rotSpring: "ry",
};

const RICHTING_NAAM: Record<SteunRichting, string> = {
  x: "horizontale richting (x)",
  z: "verticale richting (z)",
  ry: "rotatie (ry)",
};

/**
 * In welke eenheden staat `k`?
 *  - "model":  zoals in het model en de MCP-invoer — kN/mm resp. kNm/rad;
 *  - "solver": zoals in de solverinvoer (`liftSpringK`) — N/mm resp. N·mm/rad.
 * De meldingen tonen altijd de modeleenheden.
 */
export type VeerEenheden = "model" | "solver";

function kInModel(type: string, k: number, eenheden: VeerEenheden): number {
  if (eenheden === "model") return k;
  return type === "rotSpring" ? k / 1e6 : k / 1000;
}

function kTekst(type: string, k: number | undefined, eenheden: VeerEenheden): string {
  if (k === undefined) return "(ontbreekt)";
  if (!Number.isFinite(k)) return String(k);
  const waarde = kInModel(type, k, eenheden);
  const tekst = String(Number(waarde.toPrecision(6))).replace(".", ",").replace("-", "−");
  return `${tekst} ${type === "rotSpring" ? "kNm/rad" : "kN/mm"}`;
}

/** Een geldige veerstijfheid: eindig en strikt positief. */
export function isGeldigeVeerstijfheid(k: unknown): k is number {
  return typeof k === "number" && Number.isFinite(k) && k > 0;
}

/** Is dit opleggingstype een veer? */
export function isVeerType(type: string): boolean {
  return type in VEER;
}

function steunTekst(s: RichtingSteun, type: string, eenheden: VeerEenheden): string {
  if (s.soort === "vrij") return "vrij";
  if (s.soort === "star") return "star";
  return `verend (k = ${kTekst(type, s.k, eenheden)})`;
}

/**
 * Voeg de opleggingen per knoop en per richting samen. Geeft de samengevoegde
 * steun per knoop en de bevindingen (fouten en waarschuwingen) terug. Een
 * knoop met een fout staat er wel in, maar zonder de foute veer; de aanroeper
 * hoort bij een fout niet te rekenen.
 */
export function combineerOpleggingen(
  supports: readonly { nodeId: number; type: string; k?: number }[],
  eenheden: VeerEenheden = "model",
): { perKnoop: Map<number, KnoopSteun>; bevindingen: OpleggingBevinding[] } {
  const perKnoop = new Map<number, KnoopSteun>();
  const bevindingen: OpleggingBevinding[] = [];
  const metFout = new Set<number>();

  for (const s of supports) {
    const knoop: KnoopSteun = perKnoop.get(s.nodeId) ?? {
      nodeId: s.nodeId, x: { soort: "vrij" }, z: { soort: "vrij" }, ry: { soort: "vrij" }, typen: [],
    };
    perKnoop.set(s.nodeId, knoop);
    knoop.typen.push(s.type);

    const veerRichting = VEER[s.type];
    if (veerRichting !== undefined) {
      // Veer zonder positieve stijfheid: (nog) als starre steun in die
      // richting, zoals het contract in types.ts tot nu toe zegt.
      const effectief: RichtingSteun = isGeldigeVeerstijfheid(s.k)
        ? { soort: "veer", k: s.k, door: s.type }
        : { soort: "star", door: s.type };
      const huidig = knoop[veerRichting];
      if (huidig.soort !== "vrij") {
        metFout.add(s.nodeId);
        bevindingen.push({
          nodeId: s.nodeId, ernst: "fout", soort: "tegenstrijdig",
          tekst:
            `Knoop ${s.nodeId} heeft twee opleggingen in de ${RICHTING_NAAM[veerRichting]}: ` +
            `${huidig.door} (${huidig.soort === "star" ? "star" : "verend"}) en ${s.type} ` +
            `(${effectief.soort === "star" ? "star" : "verend"}). ` +
            "Dat is tegenstrijdig of dubbelzinnig; er wordt niet gegokt welke bedoeld is. " +
            "Houd per richting één steun aan (bij twee parallelle veren één veer met de " +
            "opgetelde stijfheid).",
          waarden: { knoop: s.nodeId, richting: veerRichting, eerste: huidig.door, tweede: s.type },
        });
        continue;
      }
      knoop[veerRichting] = effectief;
      continue;
    }

    for (const r of STAR[s.type] ?? []) {
      const huidig = knoop[r];
      if (huidig.soort === "veer") {
        metFout.add(s.nodeId);
        bevindingen.push({
          nodeId: s.nodeId, ernst: "fout", soort: "tegenstrijdig",
          tekst:
            `Knoop ${s.nodeId} heeft twee opleggingen in de ${RICHTING_NAAM[r]}: ` +
            `${huidig.door} (verend) en ${s.type} (star). ` +
            "Dat is tegenstrijdig of dubbelzinnig; er wordt niet gegokt welke bedoeld is. " +
            "Houd per richting één steun aan (bij twee parallelle veren één veer met de " +
            "opgetelde stijfheid).",
          waarden: { knoop: s.nodeId, richting: r, eerste: huidig.door, tweede: s.type },
        });
        continue;
      }
      if (huidig.soort === "vrij") knoop[r] = { soort: "star", door: s.type };
    }
  }

  // Meerdere opleggingen zonder tegenstrijdigheid: samengevoegd, en dat
  // hoort de gebruiker te weten (het kan een vergissing zijn).
  for (const knoop of perKnoop.values()) {
    if (knoop.typen.length < 2 || metFout.has(knoop.nodeId)) continue;
    const typeVan = (r: SteunRichting) => {
      const s = knoop[r];
      return s.soort === "vrij" ? "" : s.door;
    };
    const samen =
      `x ${steunTekst(knoop.x, typeVan("x"), eenheden)}, ` +
      `z ${steunTekst(knoop.z, typeVan("z"), eenheden)}, ` +
      `rotatie ${steunTekst(knoop.ry, typeVan("ry"), eenheden)}`;
    bevindingen.push({
      nodeId: knoop.nodeId, ernst: "waarschuwing", soort: "samengevoegd",
      tekst:
        `Knoop ${knoop.nodeId} heeft meer dan één oplegging (${knoop.typen.join(", ")}). ` +
        `Ze zijn per richting samengevoegd: ${samen}. Controleer of dat de bedoeling is.`,
      waarden: { knoop: knoop.nodeId, typen: knoop.typen.join(", "), samen },
    });
  }

  return { perKnoop, bevindingen };
}

/** Alleen de fouten, als één melding — voor de engine en de Rust-route. */
export function opleggingFoutmelding(
  supports: readonly { nodeId: number; type: string; k?: number }[],
  eenheden: VeerEenheden,
): string | null {
  const fouten = combineerOpleggingen(supports, eenheden).bevindingen.filter((b) => b.ernst === "fout");
  return fouten.length === 0 ? null : fouten.map((f) => f.tekst).join(" ");
}
