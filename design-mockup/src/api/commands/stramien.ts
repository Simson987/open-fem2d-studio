/**
 * API-commando's voor het stramien: of het aan staat, en de assen in X en Y.
 * In 3D zijn dat de stramienlijnen op de plattegrond, in 2D de verticale
 * lijnen (alleen X). De levels, de assen in Z, hebben hun eigen commando's
 * (model3d.levels.*): daar schuiven gekoppelde knopen en platen mee.
 *
 * Zoals het venster Stramienen en levels: een lijst vervangt de huidige, en
 * een as met een bestaande naam houdt zijn id. Posities in m; het project
 * bewaart mm.
 *
 * Zuiver: geen React, geen DOM. Gaat mee in de sidecarbundel.
 */
import { ApiFout } from "../register";
import { documentCommando } from "../commandoHulp";
import type { ApiDocument } from "../projectDocument";
import { getal, jaNee, lijst, obj, tekst } from "../schemaBouw";
import { DEFAULT_STRUCTURAL_GRID, type GridAxisLine, type StructuralGrid } from "../../components/fem/femTypes";
import { openFem3DGridAxesFromMetres, openFem3DLevelHeightM } from "../../components/openFem3d/openFem3dLevels";

interface AsInvoer { label: string; positionM: number }

const stramien = (document: ApiDocument): StructuralGrid => document.structuralGrid ?? DEFAULT_STRUCTURAL_GRID;

const assenUit = (assen: readonly GridAxisLine[] = []) =>
  assen.map((as) => ({ id: as.id, label: as.label, positionM: openFem3DLevelHeightM(as) }));

const stramienUit = (grid: StructuralGrid) => ({
  enabled: grid.enabled,
  xAxes: assenUit(grid.xAxes),
  yAxes: assenUit(grid.yAxes),
  levels: grid.zAxes.map((level) => ({ id: level.id, label: level.label, heightM: openFem3DLevelHeightM(level) })),
});

const as = obj({
  label: tekst("Naam van de as, bijv. \"A\" of \"1\".", { minLength: 1 }),
  positionM: getal("Positie in m."),
}, ["label", "positionM"]);

function assenNaarMm(assen: readonly AsInvoer[], huidig: readonly GridAxisLine[], voorvoegsel: string, veld: string): GridAxisLine[] {
  try {
    return openFem3DGridAxesFromMetres(assen.map((item) => ({ label: item.label, position_m: item.positionM })), huidig, voorvoegsel, veld);
  } catch (fout) {
    throw new ApiFout("INVOER_ONGELDIG", fout instanceof Error ? fout.message : String(fout));
  }
}

const stramienLezen = documentCommando<Record<string, never>, unknown>({
  naam: "project.grid.get",
  beschrijving: "Het stramien lezen: aan of uit, de assen in X en Y (naam en positie in m) en de levels (hoogte in m).",
  invoer: obj({}),
  uitvoeren: (_invoer, document) => ({ uitkomst: stramienUit(stramien(document)) }),
});

const stramienZetten = documentCommando<{ enabled?: boolean; xAxes?: AsInvoer[]; yAxes?: AsInvoer[] }, unknown>({
  naam: "project.grid.set",
  beschrijving: "Het stramien zetten, zoals het venster Stramienen en levels: aan of uit, en de assen in X en/of Y. Een lijst vervangt de huidige; een as met een bestaande naam houdt zijn id. De levels zet model3d.levels.set.",
  invoer: obj({
    enabled: jaNee("Stramien aan (tonen en erop snappen) of uit."),
    xAxes: lijst(as, "Assen in X: lijnen met een vaste x (in 2D de verticale stramienlijnen)."),
    yAxes: lijst(as, "Assen in Y: lijnen met een vaste y (alleen in 3D)."),
  }),
  uitvoeren: ({ enabled, xAxes, yAxes }, document) => {
    if (enabled === undefined && xAxes === undefined && yAxes === undefined) {
      throw new ApiFout("INVOER_ONGELDIG", "Geef enabled, xAxes en/of yAxes.");
    }
    const grid = stramien(document);
    const nieuw: StructuralGrid = {
      ...grid,
      ...(enabled !== undefined ? { enabled } : {}),
      ...(xAxes ? { xAxes: assenNaarMm(xAxes, grid.xAxes, "x", "xAxes") } : {}),
      ...(yAxes ? { yAxes: assenNaarMm(yAxes, grid.yAxes ?? [], "y", "yAxes") } : {}),
    };
    return { uitkomst: stramienUit(nieuw), document: { ...document, structuralGrid: nieuw } };
  },
});

export const STRAMIEN_COMMANDOS = [stramienLezen, stramienZetten];
