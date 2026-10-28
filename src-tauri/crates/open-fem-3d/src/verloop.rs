//! Verlopende staven (#73): een staaf in n gelijke delen, elk met een eigen
//! doorsnede (`partSectionIds`).
//!
//! Contract. `partSectionIds` verdeelt de staaf in n = lengte van de lijst
//! gelijke delen langs haar lengte (2 ≤ n ≤ 64); deel i, vanaf de beginknoop,
//! rekent met doorsnede `partSectionIds[i]`. `sectionId` blijft verplicht: de
//! doorsnede van het begin, voor weergave en terugval. Zonder het veld
//! verandert er niets. De app kiest n en de doorsnede per deel met dezelfde
//! regel als in 2D (het tussenprofiel in het midden van elk deel).
//!
//! Knippen. De adapter knipt de staaf op elke grens tussen twee delen met een
//! verschillende doorsnede, samen met de bestaande knippunten (tussenknopen en
//! plaatknopen, de rekenknopen van een bedding #106), en geeft elk kernelement
//! de doorsnede van het deel waarin zijn midden ligt (`doorsnede`). Twee
//! opeenvolgende delen met dezelfde stijfheidsgetallen (A, Iy, Iz, J en de
//! afschuifoppervlakken) zijn samen prismatisch: daar knipt de adapter niet.
//! Een staaf met overal dezelfde doorsnede rekent zo precies als een
//! ongeknipte staaf met die doorsnede.
//!
//! Een grens die binnen 1 % van een deellengte van een tussenknoop ligt, valt
//! op die knoop: zo ontstaat geen kernelement dat zo kort is dat de
//! stijfheidsmatrix er slecht geconditioneerd van wordt. De sprong in
//! doorsnede schuift dan hoogstens 1 % van een deel op. Elke andere grens
//! wordt een nieuwe rekenknoop op de staafas, met een id boven de hoogste
//! knoop-id (vóór de rekenknopen van een bedding). Die knopen staan niet in de
//! uitvoer; krachten, snedekrachtlijnen, knikgegevens en resultaten worden
//! weer samengevoegd tot de ene modelstaaf, zoals bij de andere knippunten.
//!
//! Lasten. Staaflasten behouden hun positie langs de hele staaf, zoals bij
//! elke geknipte staaf. Het contract kent geen eigen gewicht: de app geeft het
//! als staaflast per deel, ρ·g·A_i over [i·L/n, (i+1)·L/n].
//!
//! Wat per deel meegaat:
//! - stijfheid, temperatuurlast en de geometrische stijfheid van de tweede
//!   orde en de knik: die van elk kernelement met zijn eigen doorsnede
//!   (`tweede_orde` leest de doorsnede per element);
//! - knikgegevens: N en N_cr van de staaf zijn, zoals bij elke geknipte
//!   staaf, de grootste |N| langs de staaf en λ_cr·max|N| (λ_cr de eerste
//!   knikfactor); de kniklengte en slankheden horen bij het deel met de
//!   grootste spanning |N|/A (bij een constante N het kleinste deel), met de
//!   knikkracht λ_cr·|N_deel| van dat deel, zie `merge_buckling_members`;
//! - trek-alleen en montage: de delen staan axiaal in serie, dus
//!   A_eq = n / Σ(1/A_i) (`axiale_oppervlakte`). De N_vast van een globale
//!   last langs de staaf (`globale_lasten`), die de status buiten beschouwing
//!   laat, blijft die van een staaf met constante EA: bij een verlopende
//!   trek-alleen staaf onder zo'n last een benadering van de statusgrens, niet
//!   van de krachten;
//! - bedding: de deellengte van de grondveren volgt de grootste λ, dus de
//!   kleinste traagheid van de delen (`doorsneden`);
//! - torsievrijgave aan beide einden zonder plaatknopen: alleen het eerste
//!   deel krijgt de vrijgave (zoals bij een staaf op bedding), anders draaien
//!   de grensknopen vrij om de staafas.
//!
//! Deze module maakt geen `HashMap` of `HashSet` aan: elke nieuwe map schuift
//! de hashsleutels van de maps die daarna in deze draad ontstaan (ook in de
//! kern), en een verzoek zonder verlopende staaf hoort precies het oude
//! rekenpad te volgen.

use std::collections::HashSet;

use crate::shell::{add, dot, norm, scale, sub, V3};
use crate::{Member3D, Node3D, Section3D, SolveRequest3D};

/// Toegestaan aantal gelijke delen van een verlopende staaf.
pub(crate) const MIN_DELEN: usize = 2;
pub(crate) const MAX_DELEN: usize = 64;
/// Een grens binnen dit deel van een deellengte van een tussenknoop valt op
/// die knoop.
const SAMENVALLEN: f64 = 0.01;

/// Keur `partSectionIds` van één staaf: 2 t/m 64 delen, elk id bestaat.
pub(crate) fn keur(staaf: &Member3D, doorsnede_ids: &HashSet<usize>) -> Result<(), String> {
    let Some(ids) = &staaf.part_section_ids else { return Ok(()) };
    let n = ids.len();
    if !(MIN_DELEN..=MAX_DELEN).contains(&n) {
        return Err(format!(
            "staaf {}: partSectionIds bevat {n} doorsnede(n); een verlopende staaf heeft {MIN_DELEN} t/m {MAX_DELEN} gelijke delen, één doorsnede per deel",
            staaf.id,
        ));
    }
    for (index, id) in ids.iter().enumerate() {
        if !doorsnede_ids.contains(id) {
            return Err(format!(
                "staaf {}: deel {} van partSectionIds verwijst naar ontbrekende doorsnede {id}",
                staaf.id, index + 1,
            ));
        }
    }
    Ok(())
}

/// De doorsnede van het kernelement van `van` tot `tot` (m vanaf de
/// beginknoop) van een staaf met lengte `lengte`: die van het deel waarin zijn
/// midden ligt; zonder `partSectionIds` gewoon `sectionId`.
pub(crate) fn doorsnede(staaf: &Member3D, van: f64, tot: f64, lengte: f64) -> usize {
    let Some(ids) = &staaf.part_section_ids else { return staaf.section_id };
    let n = ids.len();
    let deel = (0.5 * (van + tot) / lengte * n as f64).floor().max(0.0) as usize;
    ids[deel.min(n - 1)]
}

fn zoek_doorsnede<'a>(request: &'a SolveRequest3D, staaf: &Member3D, id: usize) -> Result<&'a Section3D, String> {
    request.sections.iter().find(|s| s.id == id)
        .ok_or_else(|| format!("staaf {} verwijst naar ontbrekende doorsnede {id}", staaf.id))
}

fn zoek_knoop<'a>(request: &'a SolveRequest3D, staaf: &Member3D, id: usize) -> Result<&'a Node3D, String> {
    request.nodes.iter().find(|k| k.id == id)
        .ok_or_else(|| format!("staaf {} verwijst naar ontbrekende knoop {id}", staaf.id))
}

/// Dezelfde stijfheidsgetallen en maten: het kernelement is dan hetzelfde.
/// De maten tellen mee omdat een temperatuurverschil over de doorsnede met
/// de werkelijke hoogte en breedte rekent (#221).
fn gelijk(a: &Section3D, b: &Section3D) -> bool {
    a.id == b.id || (a.area_m2 == b.area_m2 && a.iy_m4 == b.iy_m4 && a.iz_m4 == b.iz_m4
        && a.torsion_j_m4 == b.torsion_j_m4 && a.shear_area_y_m2 == b.shear_area_y_m2
        && a.shear_area_z_m2 == b.shear_area_z_m2
        && a.height_m == b.height_m && a.width_m == b.width_m)
}

/// De verschillende doorsneden waarmee de staaf rekent, in volgorde van de
/// delen (zonder `partSectionIds` alleen `sectionId`).
pub(crate) fn doorsneden<'a>(request: &'a SolveRequest3D, staaf: &Member3D) -> Result<Vec<&'a Section3D>, String> {
    let Some(ids) = &staaf.part_section_ids else {
        return Ok(vec![zoek_doorsnede(request, staaf, staaf.section_id)?]);
    };
    let mut uit: Vec<&Section3D> = Vec::with_capacity(ids.len());
    for id in ids {
        let doorsnede = zoek_doorsnede(request, staaf, *id)?;
        if !uit.iter().any(|ander| gelijk(ander, doorsnede)) { uit.push(doorsnede); }
    }
    Ok(uit)
}

/// Axiale oppervlakte van de staaf als geheel: de delen staan in serie, dus
/// A_eq = n / Σ(1/A_i). Met overal dezelfde A precies die A.
pub(crate) fn axiale_oppervlakte(request: &SolveRequest3D, staaf: &Member3D) -> Result<f64, String> {
    let Some(ids) = &staaf.part_section_ids else {
        return Ok(zoek_doorsnede(request, staaf, staaf.section_id)?.area_m2);
    };
    let mut oppervlakten = Vec::with_capacity(ids.len());
    for id in ids { oppervlakten.push(zoek_doorsnede(request, staaf, *id)?.area_m2); }
    if oppervlakten.iter().all(|a| *a == oppervlakten[0]) { return Ok(oppervlakten[0]); }
    Ok(oppervlakten.len() as f64 / oppervlakten.iter().map(|a| 1.0 / a).sum::<f64>())
}

/// Een knippunt op een grens tussen twee delen met een verschillende doorsnede.
#[derive(Debug, Clone)]
pub(crate) struct Grens {
    /// De rekenknoop: een nieuwe knoop van de adapter, of een tussenknoop van
    /// het model binnen 1 % van een deellengte.
    pub knoop: usize,
    /// Afstand tot de beginknoop in m.
    pub s: f64,
    /// Door de adapter aangelegd (geen modelknoop).
    pub nieuw: bool,
    pub punt: V3,
}

/// De knippunten van één verlopende staaf (alleen staven met minstens één).
#[derive(Debug, Clone)]
pub(crate) struct Staaf {
    pub member_id: usize,
    /// Van begin naar eind.
    pub grenzen: Vec<Grens>,
}

/// Alle verlopende staven van een verzoek die geknipt worden.
#[derive(Debug, Clone, Default)]
pub(crate) struct Plan {
    pub staven: Vec<Staaf>,
    /// Nieuwe grensknopen (id, punt), oplopend op id.
    pub nieuwe_knopen: Vec<(usize, V3)>,
    /// Eerste vrije knoop-id na de grensknopen (voor de rekenknopen van een
    /// bedding); zonder grensknopen de hoogste knoop-id plus één.
    pub volgende_id: usize,
}

impl Plan {
    /// De grenzen van staaf `member_id`; leeg als zij niet geknipt wordt.
    pub fn grenzen(&self, member_id: usize) -> &[Grens] {
        self.staven.iter().find(|staaf| staaf.member_id == member_id)
            .map(|staaf| staaf.grenzen.as_slice()).unwrap_or(&[])
    }

    /// Hetzelfde verzoek geeft altijd dezelfde knopen en id's.
    pub fn bouw(request: &SolveRequest3D) -> Result<Plan, String> {
        let mut volgende = request.nodes.iter().map(|knoop| knoop.id).max().unwrap_or(0) + 1;
        let mut plan = Plan { volgende_id: volgende, ..Plan::default() };
        if !request.members.iter().any(|staaf| staaf.part_section_ids.is_some()) {
            return Ok(plan);
        }
        for staaf in &request.members {
            let Some(ids) = &staaf.part_section_ids else { continue };
            let n = ids.len();
            let mut verschil = Vec::new();
            for k in 1..n {
                let (links, rechts) = (zoek_doorsnede(request, staaf, ids[k - 1])?, zoek_doorsnede(request, staaf, ids[k])?);
                if !gelijk(links, rechts) { verschil.push(k); }
            }
            if verschil.is_empty() { continue; }
            let a = zoek_knoop(request, staaf, staaf.start_node_id)?;
            let b = zoek_knoop(request, staaf, staaf.end_node_id)?;
            let begin = [a.x, a.y, a.z];
            let as_ = sub([b.x, b.y, b.z], begin);
            let lengte = norm(as_);
            let richting = scale(as_, 1.0 / lengte);
            let h = lengte / n as f64;
            // De tussenknopen van het model met hun plaats langs de staaf.
            let mut tussen: Vec<(usize, f64, V3)> = Vec::with_capacity(staaf.intermediate_node_ids.len());
            for id in &staaf.intermediate_node_ids {
                let knoop = zoek_knoop(request, staaf, *id)?;
                let punt = [knoop.x, knoop.y, knoop.z];
                tussen.push((*id, dot(sub(punt, begin), richting), punt));
            }
            let mut grenzen = Vec::with_capacity(verschil.len());
            for k in verschil {
                let s = k as f64 * lengte / n as f64;
                let dichtst = tussen.iter()
                    .filter(|(_, t, _)| (t - s).abs() <= SAMENVALLEN * h)
                    .min_by(|p, q| (p.1 - s).abs().total_cmp(&(q.1 - s).abs()));
                grenzen.push(match dichtst {
                    Some((id, t, punt)) => Grens { knoop: *id, s: *t, nieuw: false, punt: *punt },
                    None => {
                        let id = volgende;
                        volgende += 1;
                        let punt = add(begin, scale(as_, k as f64 / n as f64));
                        plan.nieuwe_knopen.push((id, punt));
                        Grens { knoop: id, s, nieuw: true, punt }
                    }
                });
            }
            plan.staven.push(Staaf { member_id: staaf.id, grenzen });
        }
        plan.volgende_id = volgende;
        Ok(plan)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AnalysisKind, Material3D};

    fn doorsnede_met(id: usize, a: f64) -> Section3D {
        Section3D { id, name: format!("d{id}"), area_m2: a, iy_m4: a * 1e-2, iz_m4: a * 2e-2, torsion_j_m4: a * 1e-3,
            shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }
    }

    fn verzoek(ids: Vec<usize>, tussen: Vec<Node3D>) -> SolveRequest3D {
        let mut nodes = vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 5, x: 8.0, y: 0.0, z: 0.0 }];
        let tussenknopen = tussen.iter().map(|k| k.id).collect();
        nodes.extend(tussen);
        SolveRequest3D {
            schema_version: 2, analysis: AnalysisKind::Linear, nodes,
            materials: vec![Material3D { id: 1, name: "staal".into(), e_mpa: 210_000.0, nu: 0.3, g_mpa: None, alpha_per_k: None }],
            sections: vec![doorsnede_met(1, 0.04), doorsnede_met(2, 0.03), doorsnede_met(3, 0.02), doorsnede_met(4, 0.03)],
            members: vec![Member3D { id: 1, start_node_id: 1, end_node_id: 5, material_id: 1, section_id: 1,
                releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: tussenknopen,
                tension_only: false, bedding: None, part_section_ids: Some(ids) }],
            supports: vec![], nodal_loads: vec![], member_loads: vec![], member_point_loads: vec![],
            thermal_loads: vec![], plates: vec![], shell_elements: vec![], surface_loads: vec![], diaphragms: vec![], node_links: vec![],
            tension_only_fit: None, tension_only_cross_rule: false, max_iterations: 50, tolerance: 1e-8, buckling_modes: 0,
        }
    }

    /// Grenzen alleen waar de doorsnede verandert; 2 en 4 zijn gelijk (zelfde getallen).
    #[test]
    fn grenzen_alleen_waar_de_doorsnede_verandert() {
        let plan = Plan::bouw(&verzoek(vec![1, 1, 2, 4, 3, 3, 3, 1], vec![])).unwrap();
        let grenzen = plan.grenzen(1);
        let plaatsen: Vec<f64> = grenzen.iter().map(|g| g.s).collect();
        assert_eq!(plaatsen, vec![2.0, 4.0, 7.0]);
        assert!(grenzen.iter().all(|g| g.nieuw));
        assert_eq!(grenzen.iter().map(|g| g.knoop).collect::<Vec<_>>(), vec![6, 7, 8]);
        assert_eq!(plan.volgende_id, 9);
        assert_eq!(plan.nieuwe_knopen[1], (7, [4.0, 0.0, 0.0]));
        // Overal gelijk: niet knippen.
        let gelijk = Plan::bouw(&verzoek(vec![2, 4, 2], vec![])).unwrap();
        assert!(gelijk.staven.is_empty() && gelijk.nieuwe_knopen.is_empty() && gelijk.volgende_id == 6);
    }

    /// Een tussenknoop binnen 1 % van een deellengte vangt de grens; verder weg niet.
    #[test]
    fn een_tussenknoop_vlak_bij_een_grens_vangt_haar() {
        let tussen = vec![Node3D { id: 9, x: 4.015, y: 0.0, z: 0.0 }, Node3D { id: 10, x: 2.03, y: 0.0, z: 0.0 }];
        let plan = Plan::bouw(&verzoek(vec![1, 2, 3, 1], tussen)).unwrap();
        let grenzen = plan.grenzen(1);
        assert_eq!(grenzen.len(), 3);
        assert!(grenzen[0].nieuw && grenzen[0].s == 2.0, "2,03 ligt 1,5 % van een deel weg: {grenzen:?}");
        assert!(!grenzen[1].nieuw && grenzen[1].knoop == 9 && (grenzen[1].s - 4.015).abs() < 1e-12);
        assert!(grenzen[2].nieuw && grenzen[2].s == 6.0);
        assert_eq!(plan.volgende_id, 13);
    }

    /// Het element krijgt de doorsnede van het deel waarin zijn midden ligt.
    #[test]
    fn doorsnede_van_het_midden() {
        let staaf = &verzoek(vec![1, 2, 3, 4], vec![]).members[0];
        assert_eq!(doorsnede(staaf, 0.0, 2.0, 8.0), 1);
        assert_eq!(doorsnede(staaf, 2.0, 4.0, 8.0), 2);
        assert_eq!(doorsnede(staaf, 3.9, 4.2, 8.0), 3);
        assert_eq!(doorsnede(staaf, 6.0, 8.0, 8.0), 4);
        let mut prismatisch = staaf.clone();
        prismatisch.part_section_ids = None;
        assert_eq!(doorsnede(&prismatisch, 6.0, 8.0, 8.0), 1);
    }

    /// Axiaal in serie: A_eq = n/Σ(1/A_i); gelijke delen geven precies A.
    #[test]
    fn axiale_oppervlakte_in_serie() {
        let r = verzoek(vec![1, 3], vec![]);
        let a = axiale_oppervlakte(&r, &r.members[0]).unwrap();
        assert!((a - 2.0 / (1.0 / 0.04 + 1.0 / 0.02)).abs() < 1e-15);
        let r = verzoek(vec![3, 3, 3], vec![]);
        assert_eq!(axiale_oppervlakte(&r, &r.members[0]).unwrap(), 0.02);
        assert_eq!(doorsneden(&r, &r.members[0]).unwrap().len(), 1);
    }
}
