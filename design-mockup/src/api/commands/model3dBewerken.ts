/**
 * API-commando's om het 3D-model als geheel te bewerken: verplaatsen,
 * kopiëren, roteren en spiegelen van een selectie, een selectie verwijderen,
 * en de levels (de horizontale stramienassen) zetten en knopen of platen
 * eraan koppelen. Dezelfde functies als het transformatiepaneel en het
 * stramien in de app.
 */
import { ApiFout } from "../register";
import { documentCommando, nietGevonden, verdwenenIds } from "../commandoHulp";
import { metModel3d, model3dVan, type ApiDocument } from "../projectDocument";
import { eenVan, getal, id, keuze, lijst, obj, ofNull, tekst } from "../schemaBouw";
import { removeOpenFem3DSelection, type OpenFem3DModel } from "../../components/openFem3d/openFem3dModel";
import { openFem3DSelectionFromIds } from "../../components/openFem3d/openFem3dSelection";
import { LAST_SOORTEN, LAST_VELDEN, lastenVan, lastIdSchema, lastIdsUitInvoer, type LastIdInvoer } from "./model3dSelectie";
import { transformOpenFem3D, type OpenFem3DTransformCommand } from "../../components/openFem3d/openFem3dTransform";
import {
  applyOpenFem3DLevels, linkOpenFem3DToLevel, openFem3DLevelHeightM, openFem3DLevelRefusalText, openFem3DLevelsFromMetres,
  type OpenFem3DLevel, type OpenFem3DLevelRefusal,
} from "../../components/openFem3d/openFem3dLevels";
import { DEFAULT_STRUCTURAL_GRID, type StructuralGrid } from "../../components/fem/femTypes";

// ── Hulp ──────────────────────────────────────────────────────────────────

interface Selectie { nodeIds?: number[]; beamIds?: number[]; plateIds?: number[] }

/** Bestaan de knopen, staven en platen? Een onbekende id → NIET_GEVONDEN. */
function controleerIds(model: OpenFem3DModel, { nodeIds = [], beamIds = [], plateIds = [] }: Selectie) {
  for (const nodeId of nodeIds) if (!model.nodes.some((n) => n.id === nodeId)) throw nietGevonden("3D-knoop", nodeId);
  for (const beamId of beamIds) if (!model.beams.some((b) => b.id === beamId)) throw nietGevonden("3D-staaf", beamId);
  for (const plateId of plateIds) if (!(model.plates ?? []).some((p) => p.id === plateId)) throw nietGevonden("3D-plaat", plateId);
}

function controleerSelectie(model: OpenFem3DModel, { nodeIds = [], beamIds = [], plateIds = [] }: Selectie) {
  if (nodeIds.length + beamIds.length + plateIds.length === 0) {
    throw new ApiFout("INVOER_ONGELDIG", "Kies minstens één knoop, staaf of plaat.");
  }
  controleerIds(model, { nodeIds, beamIds, plateIds });
  return { type: "multi" as const, nodeIds, beamIds, plateIds };
}

function stramien(document: ApiDocument): StructuralGrid {
  return document.structuralGrid ?? DEFAULT_STRUCTURAL_GRID;
}

/**
 * Dezelfde zinnen als de meldingen in de app (ribbon.json,
 * `openFem3d.levels.refused.*`), hier zonder i18n omdat de sidecar die niet heeft.
 */
function levelWeigering(refusal: OpenFem3DLevelRefusal, levels: readonly OpenFem3DLevel[]): string {
  const { key, values } = openFem3DLevelRefusalText(refusal, levels);
  switch (key.split(".").pop()) {
    case "unknownLevel": return `Level ${values.level} bestaat niet (meer).`;
    case "heldByPlate":
      return `Knoop ${values.node} hoort bij plaat ${values.plate} op level ${values.level}. Kies het level voor die plaat, of ontkoppel die plaat eerst.`;
    case "zeroLengthBeam": return `Staaf ${values.beam} zou geen lengte meer hebben.`;
    default: return `De geometrie klopt dan niet meer: ${values.detail}`;
  }
}

const levelsUit = (levels: readonly OpenFem3DLevel[]) =>
  levels.map((level) => ({ id: level.id, label: level.label, heightM: openFem3DLevelHeightM(level) }));

// ── Schemadelen ───────────────────────────────────────────────────────────

const selectieVelden = {
  nodeIds: lijst(id("Id van een 3D-knoop."), "Knopen."),
  beamIds: lijst(id("Id van een 3D-staaf."), "Staven (hun knopen gaan mee)."),
  plateIds: lijst(id("Id van een 3D-plaat."), "Platen (hun knopen en openingen gaan mee)."),
};
const as = keuze(["x", "y", "z"], "Globale as.");
const transformatie = eenVan([
  obj({ kind: { const: "move" }, dx: getal("m"), dy: getal("m"), dz: getal("m") }, ["kind", "dx", "dy", "dz"], "Verplaatsen."),
  obj({ kind: { const: "copy" }, dx: getal("m"), dy: getal("m"), dz: getal("m") }, ["kind", "dx", "dy", "dz"], "Kopiëren met deze verschuiving."),
  obj({ kind: { const: "rotate" }, axis: as, angleDeg: getal("Hoek in graden; positief volgens de rechterhandregel (tegen de klok in, gezien vanaf de positieve kant van de as).") },
    ["kind", "axis", "angleDeg"], "Roteren om een globale as door het gemiddelde van de geselecteerde knopen."),
  obj({ kind: { const: "mirror" }, axis: as, offset: getal("Plaats van het spiegelvlak op die as, m.") }, ["kind", "axis", "offset"],
    "Spiegelen in het vlak loodrecht op de as."),
], "De bewerking.");

// ── Commando's ────────────────────────────────────────────────────────────

const transformeren = documentCommando<Selectie & { command: OpenFem3DTransformCommand }, unknown>({
  naam: "model3d.transform",
  beschrijving: "Een selectie verplaatsen, kopiëren, roteren of spiegelen, zoals het transformatiepaneel. De uitkomst noemt de selectie erna (bij kopiëren de nieuwe elementen). Zou een staaf op een verticale bedding (kKnPerM3) daardoor (bijna) verticaal komen te staan, dan wordt de bewerking geweigerd.",
  invoer: obj({ ...selectieVelden, command: transformatie }, ["command"]),
  uitvoeren: ({ command, ...selectie }, document) => {
    const model = model3dVan(document);
    const resultaat = transformOpenFem3D(model, controleerSelectie(model, selectie), command);
    return { uitkomst: { selection: resultaat.selection }, document: metModel3d(document, resultaat.model) };
  },
});

/** Uitvoerveld per lastsoort: removedNodalLoadIds, removedMemberLoadIds, … */
const verwijderdVeld = (veld: string) => `removed${veld[0].toUpperCase()}${veld.slice(1)}`;

const selectieVerwijderen = documentCommando<Selectie & LastIdInvoer, unknown>({
  naam: "model3d.selection.delete",
  beschrijving: "Knopen, staven, platen en lasten in één keer verwijderen, met alles wat eraan hangt (zoals Delete in de app). "
    + "De lastvelden zijn die van model3d.selection.filter, zodat een gefilterde selectie met lasten er zo in kan; een selectie "
    + "met alleen lasten mag ook. De uitkomst noemt alles wat verdween, ook wat met een knoop, staaf of plaat meeging.",
  invoer: obj({ ...selectieVelden, ...lastIdSchema("die weg moeten") }),
  uitvoeren: (invoer, document) => {
    const model = model3dVan(document);
    const { nodeIds = [], beamIds = [], plateIds = [] } = invoer;
    controleerIds(model, { nodeIds, beamIds, plateIds });
    const loads = lastIdsUitInvoer(model, invoer);
    const selectie = openFem3DSelectionFromIds({ nodeIds, beamIds, plateIds, loads });
    if (!selectie) throw new ApiFout("INVOER_ONGELDIG", "Kies minstens één knoop, staaf, plaat of last.");
    const nieuw = removeOpenFem3DSelection(model, selectie);
    const lastenVoor = lastenVan(model), lastenNa = lastenVan(nieuw);
    return {
      uitkomst: {
        removedNodeIds: verdwenenIds(model.nodes, nieuw.nodes),
        removedBeamIds: verdwenenIds(model.beams, nieuw.beams),
        removedPlateIds: verdwenenIds(model.plates, nieuw.plates),
        ...Object.fromEntries(LAST_SOORTEN.map((soort) =>
          [verwijderdVeld(LAST_VELDEN[soort]), verdwenenIds(lastenVoor[soort], lastenNa[soort])])),
      },
      document: metModel3d(document, nieuw),
    };
  },
});

const levelsZetten = documentCommando<{ levels: { label: string; heightM: number }[] }, unknown>({
  naam: "model3d.levels.set",
  beschrijving: "De levels (bouwlagen) zetten: elk een naam en een hoogte in m. Een level met een bestaande naam houdt zijn koppelingen; gekoppelde knopen en platen schuiven mee met de hoogte. Een level dat verdwijnt, laat zijn knopen los.",
  invoer: obj({
    levels: lijst(obj({ label: tekst("Naam van het level, bijv. \"vloer 1\".", { minLength: 1 }), heightM: getal("Hoogte in m.") },
      ["label", "heightM"]), "Alle levels; vervangt de huidige lijst."),
  }, ["levels"]),
  uitvoeren: ({ levels }, document) => {
    const grid = stramien(document);
    let nieuweLevels: OpenFem3DLevel[];
    try {
      nieuweLevels = openFem3DLevelsFromMetres(levels.map((l) => ({ label: l.label, position_m: l.heightM })), grid.zAxes);
    } catch (fout) {
      throw new ApiFout("INVOER_ONGELDIG", fout instanceof Error ? fout.message : String(fout));
    }
    const resultaat = applyOpenFem3DLevels(model3dVan(document), nieuweLevels);
    if (!resultaat.ok) throw new ApiFout("GEWEIGERD", levelWeigering(resultaat.refusal, nieuweLevels), { refusal: resultaat.refusal });
    return {
      uitkomst: { levels: levelsUit(nieuweLevels) },
      document: { ...metModel3d(document, resultaat.model), structuralGrid: { ...grid, zAxes: nieuweLevels } },
    };
  },
});

const levelKoppelen = documentCommando<{ nodeIds?: number[]; plateIds?: number[]; levelId: string | null }, unknown>({
  naam: "model3d.node.linkLevel",
  beschrijving: "Knopen en platen aan een level koppelen (ze gaan op die hoogte liggen en schuiven mee) of ontkoppelen (levelId null).",
  invoer: obj({
    nodeIds: selectieVelden.nodeIds, plateIds: selectieVelden.plateIds,
    levelId: ofNull(tekst("Id van een level (zie model3d.levels.set)."), "Level; null ontkoppelt."),
  }, ["levelId"]),
  uitvoeren: ({ nodeIds = [], plateIds = [], levelId }, document) => {
    const model = model3dVan(document);
    controleerSelectie(model, { nodeIds, plateIds });
    const levels = stramien(document).zAxes;
    const resultaat = linkOpenFem3DToLevel(model, { nodeIds, plateIds }, levelId, levels);
    if (!resultaat.ok) throw new ApiFout("GEWEIGERD", levelWeigering(resultaat.refusal, levels), { refusal: resultaat.refusal });
    return { uitkomst: { nodeIds, plateIds, levelId }, document: metModel3d(document, resultaat.model) };
  },
});

const levelsLezen = documentCommando<Record<string, never>, unknown>({
  naam: "model3d.levels.get",
  beschrijving: "De levels van het project lezen, met hun id, naam en hoogte in m.",
  invoer: obj({}),
  uitvoeren: (_invoer, document) => ({ uitkomst: { levels: levelsUit(stramien(document).zAxes) } }),
});

export const MODEL3D_BEWERKEN_COMMANDOS = [transformeren, selectieVerwijderen, levelsZetten, levelKoppelen, levelsLezen];
