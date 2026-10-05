import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import SelectieFilterDialog from "./SelectieFilterDialog";
import type { FilterCriterium } from "./selectieFilter";
import type { OpenFem3DModel } from "../openFem3d/openFem3dModel";
import { openFem3DSelectionFromIds, type OpenFem3DSelection } from "../openFem3d/openFem3dSelection";
import {
  filterOpenFem3D, openFem3DFilterElementen, openFem3DSelectieIds, type OpenFem3DSelectieIds,
} from "../openFem3d/openFem3dSelectieFilter";
import { openFem3DLevelName, openFem3DLevelsByHeight } from "../openFem3d/openFem3dLevels";
import {
  filterElementen2D, filterSelectie2D, selectieIds2D, selectieUitIds2D, type Model2DVoorFilter, type SelectieIds2D,
} from "../fem/selectieFilter2d";
import { BEAM_LOAD_ROLE_SLEUTEL, type BeamLoadRole, type GridAxisLine, type LoadCase, type Selection } from "../fem/femTypes";

/**
 * Het venster Selectiefilter aan het 3D- en het 2D-model gekoppeld (issue
 * #94): de basis uit de selectie (of het hele model), en bij Toepassen de
 * nieuwe selectie uit dezelfde zuivere functie als het commando
 * `model3d.selection.filter` (`filterOpenFem3D`), resp. `filterSelectie2D`.
 */

/** De naam van een belastinggeval; het venster valt zonder naam terug op "Belastinggeval <id>". */
const gevalNaam = (loadCases: readonly LoadCase[]) => (id: number) =>
  loadCases.find((item) => item.id === id)?.name || undefined;

export function SelectieFilterVenster3D({ open, onClose, model, levels, loadCases, selection, onSelect }: {
  open: boolean;
  onClose: () => void;
  model: OpenFem3DModel;
  /** De levels: de horizontale stramienassen (`StructuralGrid.zAxes`). */
  levels: readonly GridAxisLine[];
  loadCases: readonly LoadCase[];
  selection: OpenFem3DSelection;
  /** De nieuwe selectie, met haar id's per soort; daarna sluit het venster. */
  onSelect: (selection: OpenFem3DSelection, ids: OpenFem3DSelectieIds) => void;
}) {
  const ids = useMemo(() => (open ? openFem3DSelectieIds(selection) : null), [open, selection]);
  const elementen = useMemo(() => (open ? openFem3DFilterElementen(model, levels, ids) : []), [open, model, levels, ids]);
  const levelNamen = useMemo(
    () => openFem3DLevelsByHeight(levels).map((level) => ({ id: level.id, naam: openFem3DLevelName(level) })), [levels]);
  const toepassen = (criteria: FilterCriterium[]) => {
    const uit = filterOpenFem3D(model, levels, ids, criteria);
    onSelect(openFem3DSelectionFromIds(uit.ids), uit.ids);
    onClose();
  };
  return <SelectieFilterDialog open={open} onClose={onClose} elementen={elementen} heleModel={ids === null}
    levels={levelNamen} belastinggevalNaam={gevalNaam(loadCases)} onToepassen={toepassen} />;
}

export function SelectieFilterVenster2D({ open, onClose, model, loadCases, selection, onSelect }: {
  open: boolean;
  onClose: () => void;
  model: Model2DVoorFilter;
  loadCases: readonly LoadCase[];
  selection: Selection;
  /** De nieuwe selectie, met haar id's per soort; daarna sluit het venster. */
  onSelect: (selection: Selection, ids: SelectieIds2D) => void;
}) {
  const { t } = useTranslation("common");
  const ids = useMemo(() => (open ? selectieIds2D(selection) : null), [open, selection]);
  const elementen = useMemo(() => (open ? filterElementen2D(model, ids) : []), [open, model, ids]);
  const toepassen = (criteria: FilterCriterium[]) => {
    const uit = filterSelectie2D(model, ids, criteria);
    onSelect(selectieUitIds2D(uit.ids), uit.ids);
    onClose();
  };
  return <SelectieFilterDialog open={open} onClose={onClose} elementen={elementen} heleModel={ids === null}
    belastinggevalNaam={gevalNaam(loadCases)}
    rolNaam={(rol) => t(BEAM_LOAD_ROLE_SLEUTEL[rol as BeamLoadRole] ?? rol)} onToepassen={toepassen} />;
}
