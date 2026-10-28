//! Knoopkoppelingen (#97): een slaafknoop volgt een meesterknoop op dezelfde
//! plek in de gekozen globale vrijheidsgraden (EqualDOF van de kern).
//!
//! Aanleiding: een latei boven een opening in een metselwerkwand moet het
//! metselwerk verticaal dragen, maar mag de penanten niet horizontaal koppelen.
//! Deelt de latei alle knopen met de wandplaat, dan werkt zij als drukstaaf
//! tussen de penanten. Wand, latei en funderingsbalk vormen dan samen een
//! vakwerkligger, en de funderingsbalk wordt ontlast: dat sluit het besluit in
//! #97 juist uit. De adapter rekent de koppeling niet zelf; hij geeft haar aan
//! de kern als `EqualDOF`.
//!
//! Regels: beide knopen bestaan, verschillen en liggen binnen 1·10⁻⁶ m op
//! dezelfde plek (een koppeling zonder hefboom). Er is minstens één
//! vrijheidsgraad. Een slaafknoop heeft maar één meester, is zelf geen meester,
//! zit in geen schijf, en heeft in de gekoppelde vrijheidsgraden geen
//! oplegging: de kern koppelt alleen vrije vrijheidsgraden.

use std::collections::{HashMap, HashSet};

use rekenkern::types::{Constraint, EqualDOFConstraint};
use serde::{Deserialize, Serialize};

use crate::SolveRequest3D;

/// Knoopkoppeling in globale vrijheidsgraden.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodeLink3D {
    pub id: usize,
    pub master_node_id: usize,
    pub slave_node_id: usize,
    #[serde(default)] pub ux: bool,
    #[serde(default)] pub uy: bool,
    #[serde(default)] pub uz: bool,
    #[serde(default)] pub rx: bool,
    #[serde(default)] pub ry: bool,
    #[serde(default)] pub rz: bool,
}

impl NodeLink3D {
    fn dofs(&self) -> Vec<usize> {
        [self.ux, self.uy, self.uz, self.rx, self.ry, self.rz].iter().enumerate()
            .filter(|(_, on)| **on).map(|(index, _)| index).collect()
    }
}

pub(crate) fn valideer(request: &SolveRequest3D) -> Result<(), String> {
    if request.node_links.is_empty() { return Ok(()); }
    let knopen: HashMap<usize, [f64; 3]> = request.nodes.iter().map(|n| (n.id, [n.x, n.y, n.z])).collect();
    let steunen: HashMap<usize, &crate::Support3D> = request.supports.iter().map(|s| (s.node_id, s)).collect();
    let in_schijf: HashSet<usize> = request.diaphragms.iter().flat_map(|d| d.node_ids.iter().copied()).collect();
    let meesters: HashSet<usize> = request.node_links.iter().map(|k| k.master_node_id).collect();
    let mut ids = HashSet::new();
    let mut slaven = HashSet::new();
    for koppeling in &request.node_links {
        let naam = format!("knoopkoppeling {}", koppeling.id);
        if koppeling.id == 0 { return Err("knoopkoppeling-id 0 is niet toegestaan".into()); }
        if !ids.insert(koppeling.id) { return Err(format!("dubbele knoopkoppeling-id {}", koppeling.id)); }
        let (Some(m), Some(s)) = (knopen.get(&koppeling.master_node_id), knopen.get(&koppeling.slave_node_id)) else {
            return Err(format!("{naam} verwijst naar een ontbrekende knoop"));
        };
        if koppeling.master_node_id == koppeling.slave_node_id {
            return Err(format!("{naam} koppelt knoop {} aan zichzelf", koppeling.slave_node_id));
        }
        let afstand = ((m[0] - s[0]).powi(2) + (m[1] - s[1]).powi(2) + (m[2] - s[2]).powi(2)).sqrt();
        if afstand > 1e-6 {
            return Err(format!("{naam}: meester- en slaafknoop liggen {afstand:.3e} m uit elkaar (moet dezelfde plek zijn)"));
        }
        let dofs = koppeling.dofs();
        if dofs.is_empty() { return Err(format!("{naam} koppelt geen enkele vrijheidsgraad")); }
        if !slaven.insert(koppeling.slave_node_id) {
            return Err(format!("knoop {} is slaaf van meer dan één knoopkoppeling", koppeling.slave_node_id));
        }
        if meesters.contains(&koppeling.slave_node_id) {
            return Err(format!("knoop {} is zowel meester als slaaf van een knoopkoppeling", koppeling.slave_node_id));
        }
        if in_schijf.contains(&koppeling.slave_node_id) {
            return Err(format!("{naam}: slaafknoop {} zit ook in een schijf", koppeling.slave_node_id));
        }
        if let Some(steun) = steunen.get(&koppeling.slave_node_id) {
            let vast = [steun.ux, steun.uy, steun.uz, steun.rx, steun.ry, steun.rz];
            if dofs.iter().any(|&d| vast[d]) {
                return Err(format!("{naam}: slaafknoop {} is opgelegd in een gekoppelde vrijheidsgraad", koppeling.slave_node_id));
            }
        }
    }
    Ok(())
}

pub(crate) fn constraints(request: &SolveRequest3D) -> Vec<Constraint> {
    request.node_links.iter().map(|k| Constraint::EqualDOF(EqualDOFConstraint {
        master_node: k.master_node_id,
        slave_node: k.slave_node_id,
        dofs: k.dofs(),
    })).collect()
}
