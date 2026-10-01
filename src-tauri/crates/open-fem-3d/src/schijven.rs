//! Starre horizontale schijven.
//!
//! Een schijf koppelt de verplaatsingen X en Y en de rotatie om Z van al haar
//! knopen als één star lichaam in het horizontale vlak. De verticale
//! verplaatsing en de rotaties om X en Y blijven per knoop vrij.
//!
//! De externe kern kent `Constraint::Diaphragm` (vlak "XY"): per slaafknoop
//! volgen ux en uy de meesterknoop met de starre rotatie om Z,
//! u_s = u_m − Δy·θz,m en v_s = v_m + Δx·θz,m. De eigen rotatie om Z van een
//! slaafknoop koppelt de kern daarbij niet. Die koppeling komt er hier bij met
//! een `EqualDOF` op rz per slaafknoop, zodat de hele schijf ook als één geheel
//! roteert.
//!
//! Opleggingen: de kern past de koppeling alleen toe op vrije vrijheidsgraden.
//! Een geblokkeerde ux, uy of rz op een slaafknoop blijft dus vast staan terwijl
//! de rest van de schijf beweegt; de schijf is dan niet meer star. Daarom:
//! - houdt geen enkele knoop de schijf in haar vlak vast, dan is de eerste
//!   knoop de meester;
//! - houdt precies één knoop haar vast, dan wordt die knoop de meester: zijn
//!   oplegging houdt dan de hele schijf star vast;
//! - liggen alle knopen in X en Y vast, dan koppelt de schijf niets en valt zij
//!   met een melding weg;
//! - in de overige gevallen (twee of meer vaste punten) is de verdeling van de
//!   reacties over die punten onbepaald en weigert de adapter het model.
//! Veren blijven vrije vrijheidsgraden en werken via de koppeling gewoon mee.

use std::collections::{HashMap, HashSet};

use rekenkern::types::{Constraint, DiaphragmConstraint, EqualDOFConstraint};

use crate::{SolveRequest3D, Support3D};

/// Toegestaan hoogteverschil tussen de knopen van één schijf, in m.
const HOOGTE_TOLERANTIE_M: f64 = 1e-3;

/// Houdt deze oplegging de knoop in het vlak van de schijf vast?
fn in_vlak_vast(support: &Support3D) -> bool {
    support.ux || support.uy || support.rz
}

fn opleggingen(request: &SolveRequest3D) -> HashMap<usize, &Support3D> {
    request.supports.iter().map(|support| (support.node_id, support)).collect()
}

/// Controleer de schijven van een verzoek; de algemene invoercontrole is al gedaan.
pub(crate) fn valideer(request: &SolveRequest3D) -> Result<(), String> {
    let knopen: HashMap<_, _> = request.nodes.iter().map(|node| (node.id, node)).collect();
    let steunen = opleggingen(request);
    let mut schijf_ids = HashSet::new();
    let mut eigenaar: HashMap<usize, usize> = HashMap::new();
    for schijf in &request.diaphragms {
        if schijf.id == 0 { return Err("schijf-id 0 is niet toegestaan".into()); }
        if !schijf_ids.insert(schijf.id) { return Err(format!("dubbele schijf-id {}", schijf.id)); }
        if schijf.node_ids.len() < 2 {
            return Err(format!("schijf {} koppelt minder dan twee knopen", schijf.id));
        }
        for &knoop in &schijf.node_ids {
            if !knopen.contains_key(&knoop) {
                return Err(format!("schijf {} verwijst naar ontbrekende knoop {knoop}", schijf.id));
            }
            match eigenaar.insert(knoop, schijf.id) {
                Some(ander) if ander == schijf.id => {
                    return Err(format!("schijf {} noemt knoop {knoop} twee keer", schijf.id));
                }
                Some(ander) => {
                    return Err(format!(
                        "knoop {knoop} hoort bij schijf {ander} én schijf {}; een knoop hoort bij hoogstens één schijf",
                        schijf.id,
                    ));
                }
                None => {}
            }
        }
        let mut laag = knopen[&schijf.node_ids[0]];
        let mut hoog = laag;
        for id in &schijf.node_ids {
            let knoop = knopen[id];
            if knoop.z < laag.z { laag = knoop; }
            if knoop.z > hoog.z { hoog = knoop; }
        }
        // Een kleine marge voorkomt dat precies 1 mm door afronding wordt geweigerd.
        if hoog.z - laag.z > HOOGTE_TOLERANTIE_M + 1e-9 {
            return Err(format!(
                "schijf {}: de knopen liggen niet op één hoogte; knoop {} ligt op z = {:.4} m en knoop {} op z = {:.4} m ({:.1} mm verschil). Een starre horizontale schijf vraagt alle knopen binnen 1 mm op dezelfde hoogte.",
                schijf.id, laag.id, laag.z, hoog.id, hoog.z, (hoog.z - laag.z) * 1000.0,
            ));
        }
        for &knoop in &schijf.node_ids {
            let Some(steun) = steunen.get(&knoop) else { continue };
            if steun.ux_prescribed_m.is_some() || steun.uy_prescribed_m.is_some() || steun.rz_prescribed_rad.is_some() {
                return Err(format!(
                    "schijf {}: knoop {knoop} heeft een opgelegde verplaatsing in X, Y of rotatie om Z; binnen een starre schijf wordt dat nog niet ondersteund",
                    schijf.id,
                ));
            }
        }
        let vast: Vec<usize> = schijf.node_ids.iter().copied()
            .filter(|knoop| steunen.get(knoop).is_some_and(|steun| in_vlak_vast(steun)))
            .collect();
        let alles_vast = schijf.node_ids.iter()
            .all(|knoop| steunen.get(knoop).is_some_and(|steun| steun.ux && steun.uy));
        if vast.len() >= 2 && !alles_vast {
            return Err(format!(
                "schijf {}: de knopen {} zijn in het vlak van de schijf (X, Y of rotatie om Z) opgelegd. Een starre schijf kan in haar vlak op één knoop worden vastgehouden; bij meer vaste punten is de verdeling van de reacties onbepaald. Houd de schijf op één knoop vast, of laat de schijf weg als al haar knopen in X en Y vastliggen.",
                schijf.id,
                vast.iter().map(|id| id.to_string()).collect::<Vec<_>>().join(", "),
            ));
        }
    }
    Ok(())
}

/// Koppelingen voor de kern en eventuele meldingen (schijven die wegvallen).
pub(crate) fn koppelingen(request: &SolveRequest3D) -> (Vec<Constraint>, Vec<String>) {
    let steunen = opleggingen(request);
    let mut koppelingen = Vec::new();
    let mut meldingen = Vec::new();
    for schijf in &request.diaphragms {
        let alles_vast = schijf.node_ids.iter()
            .all(|knoop| steunen.get(knoop).is_some_and(|steun| steun.ux && steun.uy));
        if alles_vast {
            meldingen.push(format!(
                "Schijf {}: alle knopen liggen in X en Y vast; de schijf koppelt niets en is weggelaten.",
                schijf.id,
            ));
            continue;
        }
        let meester = schijf.node_ids.iter().copied()
            .find(|knoop| steunen.get(knoop).is_some_and(|steun| in_vlak_vast(steun)))
            .unwrap_or(schijf.node_ids[0]);
        let slaven: Vec<usize> = schijf.node_ids.iter().copied().filter(|&knoop| knoop != meester).collect();
        koppelingen.push(Constraint::Diaphragm(DiaphragmConstraint {
            master_node: meester,
            slave_nodes: slaven.clone(),
            plane: "XY".into(),
        }));
        for slaaf in slaven {
            koppelingen.push(Constraint::EqualDOF(EqualDOFConstraint {
                master_node: meester,
                slave_node: slaaf,
                dofs: vec![5],
            }));
        }
    }
    (koppelingen, meldingen)
}
