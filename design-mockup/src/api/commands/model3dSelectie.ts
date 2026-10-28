/**
 * API-commando's voor de selectie in 3D: een selectie verfijnen zoals het
 * venster Selectiefilter (issue #94), met dezelfde zuivere functie
 * (`filterOpenFem3D`). Het document verandert niet; in de draaiende app zet
 * `select: true` de uitkomst als selectie, zoals Toepassen.
 */
import { ApiFout, type ApiCommando } from "../register";
import { nietGevonden } from "../commandoHulp";
import { model3dVan } from "../projectDocument";
import { eenVan, getal, id, jaNee, keuze, lijst, obj, tekst } from "../schemaBouw";
import type { ApiSchema } from "../schema";
import type { OpenFem3DModel } from "../../components/openFem3d/openFem3dModel";
import {
  openFem3DSelectionFromIds, type OpenFem3DLoadIds, type OpenFem3DLoadSelectionType, type OpenFem3DSelection,
} from "../../components/openFem3d/openFem3dSelection";
import { filterOpenFem3D, OPEN_FEM_3D_FILTER_LAST_SOORT, type OpenFem3DSelectieIds } from "../../components/openFem3d/openFem3dSelectieFilter";
import {
  FILTER_RICHTINGEN, FILTER_TYPEN, keurFilterCriteria, type FilterCriterium,
} from "../../components/selectieFilter/selectieFilter";

/** Het deel van de app dat dit commando gebruikt (`ApiAppActies.zetSelectie3D`). */
interface SelectieApp {
  zetSelectie3D?(selectie: OpenFem3DSelection): void;
}

/**
 * Invoer- en uitvoerveld per lastsoort van de selectie. Ook
 * `model3d.selection.delete` gebruikt deze velden: de uitkomst van het
 * filter gaat er zo ongewijzigd in, zoals Delete na Toepassen in de app.
 */
export const LAST_VELDEN: Record<OpenFem3DLoadSelectionType, string> = {
  nodalLoad: "nodalLoadIds",
  memberLoad: "memberLoadIds",
  memberPointLoad: "memberPointLoadIds",
  thermalLoad: "thermalLoadIds",
  surfaceLoad: "surfaceLoadIds",
  loadPanel: "loadPanelIds",
};
export const LAST_SOORTEN = Object.keys(LAST_VELDEN) as OpenFem3DLoadSelectionType[];
const LAST_NAAM: Record<OpenFem3DLoadSelectionType, string> = {
  nodalLoad: "3D-knooplast", memberLoad: "3D-lijnlast", memberPointLoad: "3D-puntlast op staaf",
  thermalLoad: "3D-temperatuurlast", surfaceLoad: "3D-vlaklast", loadPanel: "3D-belastingvlak",
};

/** De lastvelden van de invoer (id's per lastsoort). */
export type LastIdInvoer = {
  nodalLoadIds?: number[]; memberLoadIds?: number[]; memberPointLoadIds?: number[];
  thermalLoadIds?: number[]; surfaceLoadIds?: number[]; loadPanelIds?: number[];
};

type Invoer = LastIdInvoer & {
  nodeIds?: number[]; beamIds?: number[]; plateIds?: number[];
  criteria?: FilterCriterium[];
  select?: boolean;
};

/** De lasten van het model per lastsoort van de selectie. */
export const lastenVan = (model: OpenFem3DModel): Record<OpenFem3DLoadSelectionType, readonly { id: number }[]> => ({
  nodalLoad: model.loads ?? [], memberLoad: model.memberLoads ?? [], memberPointLoad: model.memberPointLoads ?? [],
  thermalLoad: model.thermalLoads ?? [], surfaceLoad: model.surfaceLoads ?? [], loadPanel: model.loadPanels ?? [],
});

const bestaat = (items: readonly { id: number }[], ids: readonly number[], soort: string) => {
  const set = new Set(items.map((item) => item.id));
  for (const gekozen of ids) if (!set.has(gekozen)) throw nietGevonden(soort, gekozen);
};

/** De lasten uit de invoer per soort, gecontroleerd tegen het model (een onbekende id → NIET_GEVONDEN). */
export function lastIdsUitInvoer(model: OpenFem3DModel, invoer: LastIdInvoer): OpenFem3DLoadIds {
  const lasten = lastenVan(model);
  const loads: OpenFem3DLoadIds = {};
  for (const soort of LAST_SOORTEN) {
    const gekozen = (invoer as Record<string, number[] | undefined>)[LAST_VELDEN[soort]] ?? [];
    bestaat(lasten[soort], gekozen, LAST_NAAM[soort]);
    if (gekozen.length) loads[soort] = gekozen;
  }
  return loads;
}

/** Het schema van de lastvelden; `rol` zegt wat de lasten in het commando doen. */
export function lastIdSchema(rol: string): Record<string, ApiSchema> {
  return {
    nodalLoadIds: lijst(id("Id van een knooplast."), `Knooplasten ${rol}.`),
    memberLoadIds: lijst(id("Id van een lijnlast."), `Lijnlasten ${rol}.`),
    memberPointLoadIds: lijst(id("Id van een puntlast op een staaf."), `Puntlasten op staven ${rol}.`),
    thermalLoadIds: lijst(id("Id van een temperatuurlast."), `Temperatuurlasten ${rol}.`),
    surfaceLoadIds: lijst(id("Id van een vlaklast."), `Vlaklasten ${rol}.`),
    loadPanelIds: lijst(id("Id van een belastingvlak."), `Belastingvlakken ${rol}.`),
  };
}

/** De id's uit de invoer, gecontroleerd tegen het model; geen enkele id → `null` (het hele model). */
function idsUitInvoer(model: OpenFem3DModel, invoer: Invoer): OpenFem3DSelectieIds | null {
  const ids: OpenFem3DSelectieIds = {
    nodeIds: invoer.nodeIds ?? [], beamIds: invoer.beamIds ?? [], plateIds: invoer.plateIds ?? [], loads: {},
  };
  bestaat(model.nodes, ids.nodeIds, "3D-knoop");
  bestaat(model.beams, ids.beamIds, "3D-staaf");
  bestaat(model.plates ?? [], ids.plateIds, "3D-plaat");
  ids.loads = lastIdsUitInvoer(model, invoer);
  const aantal = ids.nodeIds.length + ids.beamIds.length + ids.plateIds.length
    + LAST_SOORTEN.reduce((n, soort) => n + (ids.loads[soort]?.length ?? 0), 0);
  return aantal === 0 ? null : ids;
}

// ── Schema ────────────────────────────────────────────────────────────────

const modus = keuze(["keep", "remove"], "keep: alleen wat voldoet houden (wat het kenmerk niet heeft, valt ook weg); remove: wat voldoet weghalen.");
const criterium = (property: ApiSchema, values: ApiSchema, beschrijving: string) =>
  obj({ property, mode: modus, values }, ["property", "mode", "values"], beschrijving);
const criteriumSchema = eenVan([
  criterium({ const: "type" }, lijst(keuze([...FILTER_TYPEN]), "node, beam, plate, load, support (een knoop met een oplegging)."),
    "Type element."),
  criterium(keuze(["profile", "material", "group", "level"]), lijst(tekst(), "Profielnaam (\"HEA 200\"), materiaal, groep of level-id; \"\" = zonder."),
    "Profiel of materiaal (staaf; materiaal ook plaat), groep (staaf), level (knoop, staaf of plaat op dat level; id uit model3d.levels.get)."),
  criterium({ const: "direction" }, lijst(keuze([...FILTER_RICHTINGEN]), "vertical: |ex·Z| > 0,95; horizontal: |ex·Z| < 0,05; anders sloped."),
    "Richting van een staaf."),
  criterium({ const: "loadCase" }, lijst(id("Id van een belastinggeval.")), "Belastinggeval van een last."),
  criterium({ const: "loadKind" }, lijst(keuze([...new Set(Object.values(OPEN_FEM_3D_FILTER_LAST_SOORT))]),
    "nodal (knooplast), line (lijnlast), memberPoint (puntlast op staaf), thermal, surface (vlaklast), loadPanel (belastingvlak)."),
  "Soort last."),
  obj({
    property: { const: "length" }, mode: modus,
    fromMm: getal("Vanaf deze lengte, mm (telt mee).", { minimum: 0 }),
    toMm: getal("Tot en met deze lengte, mm.", { minimum: 0 }),
  }, ["property", "mode"], "Lengte van een staaf in mm; van en/of tot."),
], "Een criterium.");

// ── Commando ──────────────────────────────────────────────────────────────

const selectieFilteren: ApiCommando<Invoer, unknown> = {
  naam: "model3d.selection.filter",
  beschrijving: "Een selectie verfijnen zoals het venster Selectiefilter: id's in, id's uit. Zonder id's werkt het op het hele model. "
    + "Criteria op type, profiel, materiaal, groep, richting, level, lengte (mm), belastinggeval en soort last; per criterium keep "
    + "(alleen deze houden) of remove (deze weghalen); alle criteria samen (EN). Het document verandert niet. In de draaiende app zet "
    + "select: true de uitkomst als selectie (zoals Toepassen); buiten de app zet het niets (selectionApplied: false).",
  invoer: obj({
    nodeIds: lijst(id("Id van een knoop."), "Knopen in de selectie."),
    beamIds: lijst(id("Id van een staaf."), "Staven in de selectie."),
    plateIds: lijst(id("Id van een plaat."), "Platen in de selectie."),
    ...lastIdSchema("in de selectie"),
    criteria: lijst(criteriumSchema, "De criteria; een criterium zonder waarden doet niet mee."),
    select: jaNee("In de draaiende app de uitkomst als selectie zetten (zoals Toepassen)."),
  }),
  soort: "document",
  uitvoeren: (invoer, context) => {
    const document = context.document!;
    const model = model3dVan(document);
    const criteria = invoer.criteria ?? [];
    try {
      keurFilterCriteria(criteria);
    } catch (fout) {
      throw new ApiFout("INVOER_ONGELDIG", fout instanceof Error ? fout.message : String(fout));
    }
    const ids = idsUitInvoer(model, invoer);
    const uit = filterOpenFem3D(model, document.structuralGrid?.zAxes ?? [], ids, criteria);
    const app = context.app as SelectieApp | undefined;
    const zetten = invoer.select === true && typeof app?.zetSelectie3D === "function";
    if (zetten) app!.zetSelectie3D!(openFem3DSelectionFromIds(uit.ids));
    const steunknopen = new Set((model.supports ?? []).map((support) => support.nodeId));
    return {
      uitkomst: {
        nodeIds: uit.ids.nodeIds,
        beamIds: uit.ids.beamIds,
        plateIds: uit.ids.plateIds,
        ...Object.fromEntries(LAST_SOORTEN.map((soort) => [LAST_VELDEN[soort], uit.ids.loads[soort] ?? []])),
        supportNodeIds: uit.ids.nodeIds.filter((nodeId) => steunknopen.has(nodeId)),
        counts: {
          nodes: uit.telling.node, beams: uit.telling.beam, plates: uit.telling.plate,
          loads: uit.telling.load, supports: uit.telling.support, total: uit.telling.total,
        },
        wholeModel: uit.heleModel,
        selectionApplied: zetten,
      },
    };
  },
};

export const MODEL3D_SELECTIE_COMMANDOS = [selectieFilteren];
