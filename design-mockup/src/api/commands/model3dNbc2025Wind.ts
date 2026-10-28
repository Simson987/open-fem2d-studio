import { documentCommando } from "../commandoHulp";
import { model3dVan } from "../projectDocument";
import { getal, jaNee, keuze, obj, tekst } from "../schemaBouw";
import { generateNbc2025EnvelopeWindLoadsForLimitStates,
  nbc2025ProjectedHorizontalResultants } from "../../components/openFem3d/openFem3dNbc2025Wind";
import { nbc2025HorizontalWindActions } from "../../lib/wind/nbc2025PartialWind";
import type { NbcRectangularWindBuildingInput } from "../../lib/wind/nbc2025RectangularWindPlan";

type Input = NbcRectangularWindBuildingInput & {
  windCodeId: "ca-nbc-2025";
  internalPressureCoefficientMin: number;
  internalPressureCoefficientMax: number;
  internalCoefficientSource: string;
};

/** Read-only access to the verified NBC kernel while project adoption remains explicit. */
export const MODEL3D_NBC_2025_WIND_COMMANDOS = [documentCommando<Input, unknown>({
  naam: "model3d.nbc2025.previewWind",
  beschrijving: "Bereken een NBC 2025-proefplan voor een rechthoekig laag gebouw met plat dak: UGT/BGT-druk per schilvlak, exacte 3D-driehoeklasten en horizontale §4.1.7.9-acties. Wijzigt het project niet en kiest geen provinciaal geldende norm; bron voor q, Ct, Cpi en eigenfrequentie is verplicht.",
  invoer: obj({
    windCodeId: keuze(["ca-nbc-2025"], "Expliciet gekozen norm voor deze proefberekening."),
    widthXM: getal("Buitenmaat X in m.", { exclusiveMinimum: 0 }),
    widthYM: getal("Buitenmaat Y in m.", { exclusiveMinimum: 0 }),
    heightM: getal("Gebouwhoogte in m; maximaal 20 m en kleiner dan beide plattegrondmaten.", { exclusiveMinimum: 0 }),
    naturalFrequencyHz: getal("Laagste eigenfrequentie in Hz; minimaal 1 Hz.", { exclusiveMinimum: 0 }),
    naturalFrequencySource: tekst("Herleidbare bron van de laagste eigenfrequentie.", { minLength: 1 }),
    noWakeOrChannelling: jaNee("Bevestig dat er geen wake- of kanaaleffect is."),
    referencePressureKPa: getal("Projectspecifieke NBC-referentiedruk q met jaarlijkse overschrijdingskans 1/500 in kPa.", { exclusiveMinimum: 0 }),
    referencePressureSource: tekst("Herleidbare bron van q, inclusief plaats en kaarteditie.", { minLength: 1 }),
    importanceCategory: keuze(["low", "normal", "high", "post-disaster"], "NBC-belangcategorie."),
    terrain: keuze(["open", "rough"], "NBC-terreinprofiel; overgangsterrein wordt niet ondersteund."),
    topographicFactor: getal("NBC-topografiefactor Ct, minimaal 1.", { minimum: 1 }),
    topographicFactorSource: tekst("Herleidbare bron van Ct.", { minLength: 1 }),
    internalPressureCoefficientMin: getal("Onderbouwde minimumwaarde van Cpi."),
    internalPressureCoefficientMax: getal("Onderbouwde maximumwaarde van Cpi."),
    internalCoefficientSource: tekst("Herleidbare bron van de Cpi-grenzen.", { minLength: 1 }),
  }, ["windCodeId", "widthXM", "widthYM", "heightM", "naturalFrequencyHz", "naturalFrequencySource",
    "noWakeOrChannelling", "referencePressureKPa", "referencePressureSource", "importanceCategory", "terrain",
    "topographicFactor", "topographicFactorSource", "internalPressureCoefficientMin",
    "internalPressureCoefficientMax", "internalCoefficientSource"]),
  uitvoeren: ({ windCodeId: _windCodeId, ...input }, document) => {
    const model = model3dVan(document);
    const wind = generateNbc2025EnvelopeWindLoadsForLimitStates(model, input);
    const projected = nbc2025ProjectedHorizontalResultants(model, wind);
    const actions = (["uls", "sls"] as const).flatMap((limitState) => {
      const cases = wind.cases.filter((item) => item.limitState === limitState);
      return nbc2025HorizontalWindActions(cases, input.widthXM, input.widthYM,
        new Map(cases.map((item) => [item.key, projected.get(item.key)!])));
    });
    return { uitkomst: { windCodeId: wind.windCodeId, cases: wind.cases, loads: wind.loads,
      projectedHorizontalResultants: Object.fromEntries(projected), horizontalActions: actions } };
  },
})];
