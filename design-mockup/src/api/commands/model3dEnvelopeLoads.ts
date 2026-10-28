import { ApiFout } from "../register";
import { documentCommando } from "../commandoHulp";
import { model3dVan } from "../projectDocument";
import { keuze, getal, obj, tekst } from "../schemaBouw";
import { generateWind3DLoads } from "../../components/openFem3d/openFem3dWindGeneration";
import { generateRoofAndCladdingLoads } from "../../components/openFem3d/openFem3dRoofLoads";
import { applyGeneratedEnvelopeLoads } from "../../components/openFem3d/openFem3dGeneratedLoads";
import { synchroniseerStandaard } from "../../lib/combinatieBeheer";
import { combinatieStaatVan, metCombinatieStaat } from "./project";
import { NEDERLANDSE_WINDROUTE, requireWindCodeId, windCodeIdFromProjectInfo,
  type WindCodeId } from "../../lib/wind/windCodeRoute";
import type { Windgebied, TerreinCategorie } from "../../lib/wind/windEurocode";

interface Input {
  windCodeId?: WindCodeId;
  windgebied?: Windgebied;
  terreincategorie?: TerreinCategorie;
  manualPressureKnPerM2?: number;
  manualPressureSource?: string;
  structuralFactor?: number;
  backgroundPermeabilityFraction?: number;
  groundSnowKnPerM2?: number;
  snowExposure?: number;
  snowThermal?: number;
  imposedRoofKnPerM2?: number;
}

export const MODEL3D_ENVELOPE_LOAD_COMMANDOS = [documentCommando<Input, unknown>({
  naam: "model3d.envelope.generateLoads",
  beschrijving: "Genereer wind op gevel en dak, sneeuw, bekledingsgewicht en optioneel dakgebruik uit 3D-schilpanelen. Vervangt alleen eerder gegenereerde lasten; handmatige lasten blijven staan.",
  invoer: obj({
    windCodeId: keuze([NEDERLANDSE_WINDROUTE], "Expliciete windnormroute; ontbrekend betekent de historische Nederlandse route."),
    windgebied: keuze(["I", "II", "III"], "Nederlands windgebied. Windgeneratie vraagt ook terreincategorie."),
    terreincategorie: keuze(["0", "I", "II", "III", "IV"], "Terreincategorie voor wind. Windgeneratie vraagt ook windgebied."),
    manualPressureKnPerM2: getal("Handmatig onderbouwde stuwdruk q_p in kN/m²; alternatief voor windgebied en terreincategorie.", { exclusiveMinimum: 0 }),
    manualPressureSource: tekst("Herleidbare bron van de handmatig ingevoerde stuwdruk."),
    structuralFactor: getal("Constructiefactor c_s·c_d; standaard 1.", { exclusiveMinimum: 0 }),
    backgroundPermeabilityFraction: getal("Aangenomen achtergrondlekkage als fractie van het schiloppervlak, standaard 0,001 (0,1%).", { minimum: 0, maximum: 0.01 }),
    groundSnowKnPerM2: getal("Karakteristieke grondsneeuwlast s_k in kN/m²; ontbreekt of 0 slaat sneeuw over.", { minimum: 0 }),
    snowExposure: getal("Sneeuwblootstellingsfactor C_e; standaard 1.", { exclusiveMinimum: 0 }),
    snowThermal: getal("Sneeuwtemperatuurfactor C_t; standaard 1.", { exclusiveMinimum: 0 }),
    imposedRoofKnPerM2: getal("Optionele dakgebruikslast categorie H in kN/m² horizontale projectie.", { minimum: 0 }),
  }),
  uitvoeren: (input, document) => {
    const manualWind = input.manualPressureKnPerM2 !== undefined;
    if (manualWind && (input.windgebied !== undefined || input.terreincategorie !== undefined)) {
      throw new ApiFout("INVOER_ONGELDIG", "Kies óf handmatige stuwdruk óf windgebied en terreincategorie.");
    }
    if (!manualWind && input.manualPressureSource !== undefined) {
      throw new ApiFout("INVOER_ONGELDIG", "Een bron voor handmatige stuwdruk vraagt ook de handmatige stuwdruk.");
    }
    if (input.manualPressureSource && input.manualPressureSource.length > 500) {
      throw new ApiFout("INVOER_ONGELDIG", "De bron van de handmatige stuwdruk mag maximaal 500 tekens bevatten.");
    }
    if (Boolean(input.windgebied) !== Boolean(input.terreincategorie)) {
      throw new ApiFout("INVOER_ONGELDIG", "Geef voor wind zowel windgebied als terreincategorie, of geen van beide.");
    }
    const hasWind = manualWind || Boolean(input.windgebied);
    const model = model3dVan(document);
    const projectWindCodeId = windCodeIdFromProjectInfo(document.projectInfo);
    if (hasWind && input.windCodeId && input.windCodeId !== projectWindCodeId) {
      throw new ApiFout("INVOER_ONGELDIG", "De windnormroute van de invoer wijkt af van de projectuitgangspunten.");
    }
    const wind = hasWind
      ? generateWind3DLoads(model, {
        windCodeId: requireWindCodeId(projectWindCodeId),
        ...(manualWind
          ? { manualPressureKnPerM2: input.manualPressureKnPerM2,
            manualPressureSource: input.manualPressureSource }
          : { windgebied: input.windgebied, terreincategorie: input.terreincategorie }),
        structuralFactor: input.structuralFactor,
        backgroundPermeabilityFraction: input.backgroundPermeabilityFraction,
      }) : null;
    const roof = generateRoofAndCladdingLoads(model, {
      groundSnowKnPerM2: input.groundSnowKnPerM2 ?? 0,
      snowExposure: input.snowExposure ?? 1,
      snowThermal: input.snowThermal ?? 1,
      imposedRoofKnPerM2: input.imposedRoofKnPerM2,
    });
    const applied = applyGeneratedEnvelopeLoads(model, document.loadCases, wind, roof);
    const oldState = combinatieStaatVan(document).staat;
    const nextCaseId = Math.max(oldState.volgendGevalId, ...applied.loadCases.map((item) => item.id + 1));
    const synced = synchroniseerStandaard({ ...oldState, loadCases: applied.loadCases,
      volgendGevalId: nextCaseId }, { loadCases: oldState.loadCases,
      gevolgklasse: oldState.gevolgklasse, bijlage: oldState.bijlage });
    const activeLoadCaseId = applied.loadCases.some((item) => item.id === document.activeLoadCaseId)
      ? document.activeLoadCaseId : applied.loadCases[0].id;
    const nextDocument = metCombinatieStaat({ ...document, modelDimension: "3d", model3d: applied.model,
      activeLoadCaseId }, synced);
    const changed = applied.changed || document.modelDimension !== "3d"
      || JSON.stringify(nextDocument.combinations) !== JSON.stringify(document.combinations)
      || JSON.stringify(nextDocument.idTellers) !== JSON.stringify(document.idTellers)
      || activeLoadCaseId !== document.activeLoadCaseId;
    return {
      uitkomst: {
        changed, caseIds: applied.generatedCaseIds,
        panelIds: applied.generatedPanelIds, roofShape: roof.roofShape,
        combinationsCount: synced.combinations.length,
        warnings: [...(wind?.warnings ?? []), ...roof.warnings],
      },
      document: changed ? { ...nextDocument, model3d: applied.changed ? applied.model : { ...applied.model } } : document,
    };
  },
})];
