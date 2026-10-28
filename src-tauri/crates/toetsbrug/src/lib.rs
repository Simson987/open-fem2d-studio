//! `toetsbrug` — de normtoetsing als JSON-in / JSON-uit, zodat de browser er
//! ook bij kan.
//!
//! De toetsing draait in Rust en was daardoor alleen bereikbaar vanuit de
//! desktop-app: de frontend roept hem aan via Tauri's `invoke`, en dat bestaat
//! in een gewone browser niet. Wie de app op de dev-server bekeek, kreeg overal
//! waar toetsing hoort te staan een melding dat de desktop-app nodig is — in
//! het canvas én in het rapport.
//!
//! Deze crate biedt dezelfde functies aan als de Tauri-commands, met precies
//! dezelfde typen, zodat er geen tweede implementatie ontstaat. De dev-server
//! roept de binary aan (zie `vite.config.ts`) en geeft het antwoord door.
//!
//! ```text
//! echo '{"opdracht":"check_steel_beams","inputs":[…]}' | toetsbrug
//! ```
//!
//! WAAROM LIB + BIN
//! [`behandel`] staat in het libdeel en niet in `main.rs`, om dezelfde reden
//! als bij `openaec-mcp-server`: zo kan een test bij de werkelijke
//! opdrachtafhandeling zonder een proces te hoeven starten. De
//! drie-wegen-verificatie (`openaec-mcp-server/tests/drie_wegen_beton.rs`)
//! vergelijkt het antwoord van déze functie met dat van de MCP-server en van
//! de rekengang achter het Tauri-command. Zonder libdeel zou die vergelijking
//! de toetsbrug moeten naprogrammeren, en dan toont ze niets aan.
//!
//! De binary is een doorgeefluik: invoer op stdin, uitvoer op stdout, beide
//! JSON. Een fout komt terug als `{"fout": "…"}` met afsluitcode 1; de
//! aanroeper hoeft stderr niet te lezen.

use concrete_check::{
    ConcreteBeamCheckInput, DekkingslijnVerzoek, MnKappaRequest, SegmentStiffnessRequest,
};
// §5.8 — de kolomtoets. Apart van de `use` hierboven omdat die regel al door
// meer dan één spoor tegelijk wordt bewerkt.
use concrete_check::ConcreteColumnCheckRequest;
use nen_en_1992_1_1::{ConcreteCoverRequest, CreepCoefficientRequest, EffectiveFlangeWidthRequest};
use nen_en_1993_1_1_section::{S235, S275, S355, S420, S460};
use nen_en_1993_1_8_las::LasInput;
use openaec_native_fem::dispatch::NativeFemRequest;
use plaat_check::PlateCheckInput;
use serde::Deserialize;
use serde_json::Value;
use spanning_check::SpanningBeamCheckInput;
use aluminium_check::AluminiumBeamCheckInput;
use koudgevormd_check::KoudgevormdBeamCheckInput;
use steel_check::BeamCheckInput;
use timber_check::clt::CltBeamCheckInput;
use timber_check::TimberBeamCheckInput;

/// Eén verzoek. `opdracht` kiest de functie; de rest hangt daarvan af.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Verzoek {
    pub opdracht: String,
    /// Staaltoetsing: de staven die getoetst moeten worden.
    #[serde(default)]
    pub inputs: Option<Value>,
}

pub fn behandel(v: Verzoek) -> Result<Value, String> {
    match v.opdracht.as_str() {
        "solve_native_fem" => {
            let inputs = v.inputs.ok_or("solve_native_fem vraagt om `inputs`")?;
            let request: NativeFemRequest =
                serde_json::from_value(inputs).map_err(|e| format!("native FEM-invoer: {e}"))?;
            serde_json::to_value(openaec_native_fem::dispatch::solve_native_fem(request)?)
                .map_err(|e| e.to_string())
        }
        "list_steel_profiles" => {
            serde_json::to_value(steel_profiles::db().all()).map_err(|e| e.to_string())
        }
        "list_steel_grades" => {
            serde_json::to_value(vec![S235, S275, S355, S420, S460]).map_err(|e| e.to_string())
        }
        // Hout (NEN-EN 1995-1-1): de sterkteklassen en de toetsing per staaf.
        // Ook als MCP-tool bereikbaar onder dezelfde naam
        // (`openaec-mcp-server/src/timber_tools.rs`); de drie wegen delen de
        // typen en lopen door `timber_check::check_all_timber_beams`.
        "list_timber_grades" => {
            serde_json::to_value(nen_en_1995_1_1::strength_class_names()).map_err(|e| e.to_string())
        }
        "check_steel_beams" => {
            let inputs = v.inputs.ok_or("check_steel_beams vraagt om `inputs`")?;
            let inputs: Vec<BeamCheckInput> =
                serde_json::from_value(inputs).map_err(|e| format!("staafinvoer: {e}"))?;
            serde_json::to_value(steel_check::check_all_beams(inputs)).map_err(|e| e.to_string())
        }
        "check_timber_beams" => {
            let inputs = v.inputs.ok_or("check_timber_beams vraagt om `inputs`")?;
            let inputs: Vec<TimberBeamCheckInput> =
                serde_json::from_value(inputs).map_err(|e| format!("staafinvoer: {e}"))?;
            serde_json::to_value(timber_check::check_all_timber_beams(inputs))
                .map_err(|e| e.to_string())
        }
        // Kruislaaghout: standaardopbouwen (voorinstellingen) en de toetsing
        // per lamel. Zelfde typen als de Tauri-commands en als de MCP-tools
        // van dezelfde naam (`openaec-mcp-server/src/timber_tools.rs`); de
        // toetsing loopt langs alle drie de wegen door
        // `timber_check::clt::check_all_clt_beams`, zodat er geen tweede lus
        // over de staven bestaat.
        "list_clt_presets" => {
            serde_json::to_value(nen_en_1995_1_1::clt::clt_presets()).map_err(|e| e.to_string())
        }
        "check_clt_beams" => {
            let inputs = v.inputs.ok_or("check_clt_beams vraagt om `inputs`")?;
            let inputs: Vec<CltBeamCheckInput> =
                serde_json::from_value(inputs).map_err(|e| format!("CLT-staafinvoer: {e}"))?;
            serde_json::to_value(timber_check::clt::check_all_clt_beams(inputs))
                .map_err(|e| e.to_string())
        }
        // Beton (NEN-EN 1992-1-1): sterkteklassen met alle tabel 3.1-waarden,
        // de B500-klassen, de toetsing per staaf en het losse M-N-κ-diagram
        // voor de wapeningskorf in de eigenschappen. Deze vier zijn ook als
        // MCP-tool bereikbaar (`openaec-mcp-server/src/concrete_tools.rs`);
        // de drie wegen delen dezelfde typen en dezelfde rekengang.
        "list_concrete_classes" => {
            serde_json::to_value(nen_en_1992_1_1::CONCRETE_CLASSES).map_err(|e| e.to_string())
        }
        "list_reinforcement_grades" => {
            serde_json::to_value(nen_en_1992_1_1::REINFORCEMENT_GRADES).map_err(|e| e.to_string())
        }
        // Deze weg leest `ConcreteBeamCheckInput` RECHTSTREEKS, dus elk veld dat
        // aan dat type wordt toegevoegd reist hier mee zonder dat hier iets
        // hoeft te veranderen — ook `reinforcement_zones`, de wapening die
        // langs de staaf verschilt (§9.2.1.3, §9.2.2). Dat is precies waarom er
        // hier geen eigen veldenlijst staat: een tweede opsomming zou uit de
        // pas kunnen lopen met het type. De MCP-weg heeft die opsomming wél
        // nodig (een JSON-schema kan niet anders) en is daarom de enige van de
        // drie die bij een nieuw veld moet worden bijgewerkt.
        "check_concrete_beams" => {
            let inputs = v.inputs.ok_or("check_concrete_beams vraagt om `inputs`")?;
            let inputs: Vec<ConcreteBeamCheckInput> =
                serde_json::from_value(inputs).map_err(|e| format!("betonstaafinvoer: {e}"))?;
            serde_json::to_value(concrete_check::check_all_concrete_beams(inputs))
                .map_err(|e| e.to_string())
        }
        "concrete_mn_kappa" => {
            let inputs = v.inputs.ok_or("concrete_mn_kappa vraagt om `inputs`")?;
            let verzoek: MnKappaRequest =
                serde_json::from_value(inputs).map_err(|e| format!("korfinvoer: {e}"))?;
            let uit = concrete_check::mn_kappa(verzoek)?;
            serde_json::to_value(uit).map_err(|e| e.to_string())
        }
        // De stateloze stijfheidsdienst voor de fysisch niet-lineaire tweede
        // orde (5.8.6): één staaf, in segmenten, elk met zijn eigen secante
        // buigstijfheid. Zonder `segment_forces` komt alleen de indeling terug.
        "concrete_segment_stiffness" => {
            let inputs = v
                .inputs
                .ok_or("concrete_segment_stiffness vraagt om `inputs`")?;
            let verzoek: SegmentStiffnessRequest = serde_json::from_value(inputs)
                .map_err(|e| format!("segmentstijfheidsinvoer: {e}"))?;
            let uit = concrete_check::segment_stiffness(verzoek)?;
            serde_json::to_value(uit).map_err(|e| e.to_string())
        }
        // §5.8 los van een volledige staaftoetsing: de kniklengte l₀, λ = l₀/i
        // (5.14) en de slankheidsgrens λ_lim = 20·A·B·C/√n waaronder de
        // tweede-orde-effecten mogen vervallen — door de nationale bijlage bij
        // 5.8.3.1(1) als EIS gesteld. Daarbij φ_ef (5.19) met de drie
        // voorwaarden van 5.8.4(4), en de §9.5-detaillering.
        //
        // Geschoord of ongeschoord is INVOER: §5.8.1 noemt het uitdrukkelijk
        // een aanname in de berekening, en het scheelt een factor twee in l₀.
        // Zelfde typen en dezelfde rekengang (`concrete_check::kolomtoetsen`)
        // als het Tauri-command en het MCP-gereedschap van dezelfde naam; die
        // rekengang zit óók in `check_concrete_beams`, zodat de losse toets en
        // de staaftoetsing niet uit elkaar kunnen lopen.
        "concrete_column_check" => {
            let inputs = v.inputs.ok_or("concrete_column_check vraagt om `inputs`")?;
            let verzoek: ConcreteColumnCheckRequest =
                serde_json::from_value(inputs).map_err(|e| format!("kolominvoer: {e}"))?;
            let uit = concrete_check::column_check(verzoek)?;
            serde_json::to_value(uit).map_err(|e| e.to_string())
        }
        // De dekkingslijn van één staaf: §9.2.1.3 met figuur 9.2 voor de
        // momenten en §6.2 voor de dwarskracht, als GEGEVENS. Per plaats de
        // benodigde en de aanwezige waarde, met per punt het bewijs; op een
        // zonegrens twee punten met dezelfde x, links en rechts van de sprong.
        //
        // Het verzoek draagt de betonstaaf in `beam` als
        // `ConcreteBeamCheckInput` — hetzelfde type als `check_concrete_beams`
        // hierboven, en ook hier RECHTSTREEKS gelezen, zodat elk veld dat aan
        // dat type wordt toegevoegd vanzelf meereist.
        "concrete_dekkingslijn" => {
            let inputs = v.inputs.ok_or("concrete_dekkingslijn vraagt om `inputs`")?;
            let verzoek: DekkingslijnVerzoek =
                serde_json::from_value(inputs).map_err(|e| format!("dekkingslijninvoer: {e}"))?;
            let uit = concrete_check::dekkingslijn(verzoek)?;
            serde_json::to_value(uit).map_err(|e| e.to_string())
        }
        // De meewerkende flensbreedte van een T- of L-ligger (5.3.2.1), per
        // gebied uit figuur 5.2. Zelfde typen als het Tauri-command en de
        // MCP-tool; er wordt hier niet gerekend.
        "concrete_effective_flange_width" => {
            let inputs = v
                .inputs
                .ok_or("concrete_effective_flange_width vraagt om `inputs`")?;
            let verzoek: EffectiveFlangeWidthRequest =
                serde_json::from_value(inputs).map_err(|e| format!("flensbreedte-invoer: {e}"))?;
            let uit = nen_en_1992_1_1::beff::effective_flange_width_request(verzoek)?;
            serde_json::to_value(uit).map_err(|e| e.to_string())
        }
        // De milieuklassen van tabel 4.1 en de dekkingstoets van 4.4.1. Zelfde
        // typen als het Tauri-command en de MCP-tool; de rekengang staat in
        // `nen_en_1992_1_1::dekking` en nergens anders.
        //
        // `concrete_cover_check` toetst ÉÉN betonoppervlak — 4.4.1.1(1)P meet
        // de dekking tot "het dichtstbijzijnde betonoppervlak". De invoer
        // roept hem één keer per zijde aan en zet `side` op "Top", "Bottom" of
        // "Sides"; dat veld verandert geen getal maar benoemt het antwoord,
        // zodat drie uitkomsten naast elkaar uit elkaar te houden zijn.
        "list_exposure_classes" => {
            serde_json::to_value(nen_en_1992_1_1::EXPOSURE_CLASSES).map_err(|e| e.to_string())
        }
        "concrete_cover_check" => {
            let inputs = v.inputs.ok_or("concrete_cover_check vraagt om `inputs`")?;
            let verzoek: ConcreteCoverRequest =
                serde_json::from_value(inputs).map_err(|e| format!("dekkingsinvoer: {e}"))?;
            let uit = nen_en_1992_1_1::dekking::concrete_cover_request(verzoek)?;
            serde_json::to_value(uit).map_err(|e| e.to_string())
        }
        // De kruipcoëfficiënt volgens bijlage B (B.1–B.9). Zelfde typen als het
        // Tauri-command en de MCP-tool; de rekengang staat in
        // `nen_en_1992_1_1::kruip` en nergens anders.
        "concrete_creep_coefficient" => {
            let inputs = v
                .inputs
                .ok_or("concrete_creep_coefficient vraagt om `inputs`")?;
            let verzoek: CreepCoefficientRequest =
                serde_json::from_value(inputs).map_err(|e| format!("kruipinvoer: {e}"))?;
            let uit = nen_en_1992_1_1::kruip::creep_coefficient_request(verzoek)?;
            serde_json::to_value(uit).map_err(|e| e.to_string())
        }
        // Vrije spanningstoets: geen norm, alleen een doorsnede en een
        // toelaatbare spanning, getoetst op de vergelijkspanning van von
        // Mises. Zelfde typen als het Tauri-command.
        "check_stress_beams" => {
            let inputs = v.inputs.ok_or("check_stress_beams vraagt om `inputs`")?;
            let inputs: Vec<SpanningBeamCheckInput> =
                serde_json::from_value(inputs).map_err(|e| format!("spanningsinvoer: {e}"))?;
            serde_json::to_value(spanning_check::check_all_spanning_beams(inputs))
                .map_err(|e| e.to_string())
        }
        // Aluminium (NEN-EN 1999-1-1, issue #5): legeringen en staaftoets.
        // Zelfde typen en functies als het Tauri-command en de MCP-tools van
        // dezelfde naam (`openaec-mcp-server/src/aluminium_tools.rs`).
        "list_aluminium_alloys" => {
            serde_json::to_value(aluminium_check::list_aluminium_alloys()).map_err(|e| e.to_string())
        }
        "check_aluminium_beams" => {
            let inputs = v.inputs.ok_or("check_aluminium_beams vraagt om `inputs`")?;
            let inputs: Vec<AluminiumBeamCheckInput> =
                serde_json::from_value(inputs).map_err(|e| format!("aluminiuminvoer: {e}"))?;
            serde_json::to_value(aluminium_check::check_all_aluminium_beams(inputs))
                .map_err(|e| e.to_string())
        }
        // Koudgevormde profielen (NEN-EN 1993-1-3, issue #4): staalsoorten en
        // staaftoets. Zelfde typen en functies als het Tauri-command en de
        // MCP-tools van dezelfde naam (`openaec-mcp-server/src/koudgevormd_tools.rs`).
        "list_koudgevormd_staalsoorten" => {
            serde_json::to_value(koudgevormd_check::list_koudgevormd_staalsoorten()).map_err(|e| e.to_string())
        }
        "check_koudgevormd_beams" => {
            let inputs = v.inputs.ok_or("check_koudgevormd_beams vraagt om `inputs`")?;
            let inputs: Vec<KoudgevormdBeamCheckInput> =
                serde_json::from_value(inputs).map_err(|e| format!("invoer koudgevormd: {e}"))?;
            serde_json::to_value(koudgevormd_check::check_all_koudgevormd_beams(inputs))
                .map_err(|e| e.to_string())
        }
        // Platen (wandschijven): de elementspanningen per UGT-combinatie getoetst
        // aan de norm van het plaatmateriaal. Zelfde typen en dezelfde functie
        // als het Tauri-command en het MCP-gereedschap `check_plates`.
        "check_plates" => {
            let inputs = v.inputs.ok_or("check_plates vraagt om `inputs`")?;
            let inputs: Vec<PlateCheckInput> =
                serde_json::from_value(inputs).map_err(|e| format!("plaatinvoer: {e}"))?;
            serde_json::to_value(plaat_check::check_all_plates(inputs)).map_err(|e| e.to_string())
        }
        // Doorlopende langslassen in een samengestelde doorsnede, getoetst
        // volgens NEN-EN 1993-1-8 4.5.3.3. De schuifstroom per naad komt van de
        // aanroeper mee (die kent de meetkunde van de doorsnede); deze kern
        // doet de normkant. Zelfde typen als het Tauri-command.
        "check_fillet_welds" => {
            let inputs = v.inputs.ok_or("check_fillet_welds vraagt om `inputs`")?;
            let inputs: Vec<LasInput> =
                serde_json::from_value(inputs).map_err(|e| format!("lasinvoer: {e}"))?;
            serde_json::to_value(nen_en_1993_1_8_las::toets_lassen(&inputs))
                .map_err(|e| e.to_string())
        }
        andere => Err(format!("onbekende opdracht: {andere}")),
    }
}

#[cfg(test)]
mod native_fem_tests {
    use super::*;

    #[test]
    fn native_square_mesh_uses_the_shared_dispatcher_contract() {
        let value = serde_json::json!({
            "opdracht": "solve_native_fem",
            "inputs": { "kind": "squareMesh", "input": {
                "originX": 0, "originY": 0, "widthM": 2, "heightM": 2,
                "cellSizeM": 1, "materialId": 1, "thicknessM": 0.1
            }}
        });
        let request: Verzoek = serde_json::from_value(value).unwrap();
        let answer = behandel(request).unwrap();
        assert_eq!(answer["kind"], "squareMesh");
        assert_eq!(answer["result"]["nodes"].as_array().unwrap().len(), 9);
    }

    #[test]
    fn j2_sparse_pcg_reaches_the_shared_dispatcher_contract() {
        let mut inputs: Value = serde_json::from_str(include_str!(
            "../../native-fem/examples/volume3d-j2-steel-coupon.json"
        ))
        .unwrap();
        inputs["input"]["options"]["linearBackend"] = "sparsePcg".into();
        inputs["input"]["options"]["pcgThreads"] = 2.into();
        let request = Verzoek {
            opdracht: "solve_native_fem".into(),
            inputs: Some(inputs),
        };
        let answer = behandel(request).unwrap();
        assert_eq!(answer["kind"], "volume3dJ2");
        assert_eq!(answer["result"]["linearBackendUsed"], "sparsePcg");
        assert!(answer["result"]["trueFreeResidualKn"].as_f64().unwrap() < 1e-4);
    }

    #[test]
    fn prestressed_beam_accepts_piecewise_modulus_and_shear_links_through_bridge() {
        let value = serde_json::json!({
            "opdracht": "solve_native_fem",
            "inputs": { "kind": "prestressedBeam", "input": {
                "spanM": 10,
                "section": {
                    "areaM2": 0.5, "inertiaM4": 0.02,
                    "topFibreM": 0.3, "bottomFibreM": 0.3, "eMpa": 30000
                },
                "stiffnessSegments": [
                    {"startM": 0, "endM": 5, "eMpa": 30000},
                    {"startM": 5, "endM": 10, "eMpa": 15000}
                ],
                "tendon": {"kind": "parabolic", "endEccentricityM": 0, "midEccentricityM": 0.2},
                "initialForceKn": 1000,
                "lossFraction": 0.2,
                "serviceUniformDownwardKnPerM": 16,
                "shearLinks": {
                    "webWidthMm": 300,
                    "effectiveDepthMm": 500,
                    "leverArmMm": 450,
                    "alphaCw": 1,
                    "nu1": 0.6,
                    "fcdMpa": 20,
                    "fywdMpa": 435,
                    "cotTheta": 2,
                    "providedAswMm2": 157,
                    "providedSpacingMm": 150
                }
            }}
        });
        let request: Verzoek = serde_json::from_value(value).unwrap();
        let answer = behandel(request).unwrap();
        assert_eq!(answer["kind"], "prestressedBeam");
        assert_eq!(
            answer["result"]["service"]["stations"][3]["effectiveEMpa"],
            15000.0
        );
        assert!(
            answer["result"]["service"]["stations"][3]["shearLinks"]
                ["requiredAswPerSpacingMm2PerMm"]
                .as_f64()
                .unwrap()
                > 0.0
        );
    }
}
