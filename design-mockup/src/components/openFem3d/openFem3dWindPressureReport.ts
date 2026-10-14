import type { AfleidingsRegel } from "../../lib/wind/windEurocode";
import type { OpenFem3DLoadPanel } from "./openFem3dModel";

export interface WindPressureReportSource {
  windCodeId: string;
  referenceHeightM: number;
  pressureKnPerM2: number;
  derivation: readonly AfleidingsRegel[];
  pressureMethod?: "en-terreinprofiel" | "handmatig-opgegeven" | "nbc-static";
  loadPanelIds: number[];
}
export interface InternalPressureReportSource {
  windCodeId: string;
  coefficient: number;
  derivation: readonly AfleidingsRegel[];
  loadPanelIds: number[];
}

/** Read the saved calculation, rather than recalculating from possibly changed project settings. */
export function openFem3DWindPressureReport(loadPanels: readonly OpenFem3DLoadPanel[]): {
  sources: WindPressureReportSource[];
  missingPanelIds: number[];
  internalSources: InternalPressureReportSource[];
  missingInternalPanelIds: number[];
} {
  const sources = new Map<string, WindPressureReportSource>();
  const missingPanelIds: number[] = [];
  const internalSources = new Map<string, InternalPressureReportSource>();
  const missingInternalPanelIds: number[] = [];
  for (const panel of loadPanels) {
    const generated = panel.generated;
    if (generated?.source !== "envelope3d"
      || (generated.internalPressureCoefficient === undefined && generated.windCodeId === undefined)) continue;
    if (generated.internalPressureCoefficient !== undefined) {
      if (!generated.windCodeId || !generated.windInternalPressureDerivation?.length) {
        missingInternalPanelIds.push(panel.id);
      } else {
        const key = JSON.stringify([generated.windCodeId, generated.internalPressureCoefficient,
          generated.windInternalPressureDerivation]);
        const existing = internalSources.get(key);
        if (existing) existing.loadPanelIds.push(panel.id);
        else internalSources.set(key, { windCodeId: generated.windCodeId,
          coefficient: generated.internalPressureCoefficient,
          derivation: generated.windInternalPressureDerivation, loadPanelIds: [panel.id] });
      }
    }
    if (!generated.windCodeId || generated.windReferenceHeightM === undefined
      || !generated.windPressureDerivation?.length) {
      missingPanelIds.push(panel.id);
      continue;
    }
    const key = JSON.stringify([generated.windCodeId, generated.windReferenceHeightM,
      generated.referencePressureKnPerM2, generated.windPressureDerivation, generated.windPressureMethod]);
    const existing = sources.get(key);
    if (existing) {
      existing.loadPanelIds.push(panel.id);
    } else {
      sources.set(key, {
        windCodeId: generated.windCodeId,
        referenceHeightM: generated.windReferenceHeightM,
        pressureKnPerM2: generated.referencePressureKnPerM2,
        derivation: generated.windPressureDerivation,
        pressureMethod: generated.windPressureMethod,
        loadPanelIds: [panel.id],
      });
    }
  }
  return { sources: [...sources.values()], missingPanelIds,
    internalSources: [...internalSources.values()], missingInternalPanelIds };
}
