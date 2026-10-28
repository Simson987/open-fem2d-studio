/** Materiaalinstellingen voor de ruimtelijke analyse; dezelfde modelregel als de UI. */
import { documentCommando } from "../commandoHulp";
import { metModel3d, model3dVan } from "../projectDocument";
import { eenVan, getal, obj, ofNull, tekst } from "../schemaBouw";
import { setOpenFem3DAnalysisMaterial, type OpenFem3DConcreteModulus } from "../../components/openFem3d/openFem3dAnalysisMaterial";

interface Invoer {
  material: string;
  concreteModulus?: OpenFem3DConcreteModulus | null;
  nu?: number | null;
}

const concreteModulus = eenVan([
  obj({ kind: { const: "ecm" } }, ["kind"], "Normale E_cm van de betonklasse."),
  obj({ kind: { const: "creep" }, phi: getal("Kruipcoëfficiënt φ ≥ 0; E_eff = E_cm/(1+φ).", { minimum: 0 }) },
    ["kind", "phi"], "Effectieve E met kruip."),
  obj({ kind: { const: "custom" }, eMpa: getal("Eigen analyse-E in MPa (= N/mm²).", { exclusiveMinimum: 0 }) },
    ["kind", "eMpa"], "Eigen analyse-E."),
]);

export const MODEL3D_ANALYSIS_MATERIAL_COMMANDOS = [documentCommando<Invoer, unknown>({
  naam: "model3d.material.setAnalysis",
  beschrijving: "Analyse-E en ν per 3D-materiaal instellen. Beton blijft dezelfde normklasse; ontbrekende E-keuze gebruikt E_cm. null wist de betreffende keuze. De instelling geldt voor alle staven en platen met deze materiaalnaam.",
  invoer: obj({
    material: tekst("Bestaande materiaalnaam in het 3D-model, bijvoorbeeld C30/37.", { minLength: 1 }),
    concreteModulus: ofNull(concreteModulus, "E_cm, E_cm/(1+φ), eigen E of null om de keuze te wissen."),
    nu: ofNull(getal("Dwarscontractiecoëfficiënt ν van dit materiaal, 0 ≤ ν < 0,5; null gebruikt de standaardwaarde.", { minimum: 0, exclusiveMaximum: 0.5 })),
  }, ["material"]),
  uitvoeren: ({ material, concreteModulus, nu }, document) => {
    const model = model3dVan(document);
    if (![...model.beams, ...(model.plates ?? [])].some((item) => item.material?.trim() === material)) {
      throw new Error(`Materiaal "${material}" is niet aan een 3D-staaf of -plaat toegewezen.`);
    }
    const current = model.analysisMaterials?.[material] ?? {};
    const next = {
      ...(concreteModulus === undefined ? (current.concreteModulus ? { concreteModulus: current.concreteModulus } : {})
        : concreteModulus === null ? {} : { concreteModulus }),
      ...(nu === undefined ? (current.nu !== undefined ? { nu: current.nu } : {})
        : nu === null ? {} : { nu }),
    };
    const changed = setOpenFem3DAnalysisMaterial(model, material, Object.keys(next).length ? next : null);
    return { uitkomst: { material, settings: changed.analysisMaterials?.[material] ?? null }, document: metModel3d(document, changed) };
  },
})];
