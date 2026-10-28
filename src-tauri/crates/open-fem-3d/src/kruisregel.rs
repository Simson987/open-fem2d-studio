//! Kruisregel voor trek-alleen staven (`tensionOnlyCrossRule`).
//!
//! Twee trek-alleen staven vormen een kruis als ze elkaar in hun inwendige
//! snijden: de kleinste afstand tussen hun assen is kleiner dan 1 mm, het
//! snijpunt ligt op beide staven binnen de staaf (beide parameters strikt
//! tussen 0 en 1, met dezelfde 1 mm afstand tot de einden) en ze delen geen
//! eindknoop. Twee assen die elkaar zo dicht naderen, liggen in één vlak. Gaat
//! door hetzelfde punt nog een derde trek-alleen staaf, dan telt het niet: de
//! regel werkt alleen op paren.
//!
//! De regel zelf staat in de statuslus (`trek_alleen::nieuwe_status`): per
//! kruis blijft altijd minstens één diagonaal actief, namelijk die met de
//! grootste algebraïsche normaalkracht, ook als zij een kleine drukkracht
//! houdt. Achtergrond: verkorten de kolommen onder verticale last, dan komen
//! beide diagonalen op druk en zou het vak zijn schoor verliezen.

use std::collections::HashMap;

use crate::SolveRequest3D;

/// Afstand (m) waaronder twee assen elkaar snijden, en de kleinste afstand
/// van het snijpunt tot een staafeinde.
const SNIJ_TOLERANTIE: f64 = 1e-3;

type V3 = [f64; 3];

fn min(a: V3, b: V3) -> V3 { [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
fn punt(a: V3, d: V3, t: f64) -> V3 { [a[0] + t * d[0], a[1] + t * d[1], a[2] + t * d[2]] }
fn inproduct(a: V3, b: V3) -> f64 { a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
fn lengte(a: V3) -> f64 { inproduct(a, a).sqrt() }

struct As {
    id: usize,
    knopen: [usize; 2],
    begin: V3,
    richting: V3,
    lengte: f64,
}

/// Kleinste afstand van een punt tot een staafas (als lijnstuk).
fn afstand_tot(staaf: &As, p: V3) -> f64 {
    let t = (inproduct(min(p, staaf.begin), staaf.richting) / (staaf.lengte * staaf.lengte)).clamp(0.0, 1.0);
    lengte(min(p, punt(staaf.begin, staaf.richting, t)))
}

/// Alle kruisen als paren staaf-id's (kleinste eerst), oplopend.
pub(crate) fn kruisen(request: &SolveRequest3D) -> Vec<(usize, usize)> {
    let knopen: HashMap<usize, V3> = request.nodes.iter().map(|node| (node.id, [node.x, node.y, node.z])).collect();
    let mut assen: Vec<As> = request.members.iter().filter(|staaf| staaf.tension_only).map(|staaf| {
        let begin = knopen[&staaf.start_node_id];
        let richting = min(knopen[&staaf.end_node_id], begin);
        As { id: staaf.id, knopen: [staaf.start_node_id, staaf.end_node_id], begin, richting, lengte: lengte(richting) }
    }).collect();
    assen.sort_by_key(|staaf| staaf.id);
    let mut paren: Vec<(usize, usize, V3)> = Vec::new();
    for (i, a) in assen.iter().enumerate() {
        for b in &assen[i + 1..] {
            if a.knopen.iter().any(|knoop| b.knopen.contains(knoop)) { continue; }
            // Dichtstbijzijnde punten a.begin + s·a.richting en b.begin + t·b.richting.
            let w = min(a.begin, b.begin);
            let (aa, ab, bb) = (inproduct(a.richting, a.richting), inproduct(a.richting, b.richting), inproduct(b.richting, b.richting));
            let (aw, bw) = (inproduct(a.richting, w), inproduct(b.richting, w));
            let noemer = aa * bb - ab * ab;
            // Evenwijdige assen snijden elkaar niet in één punt.
            if noemer <= 1e-12 * aa * bb { continue; }
            let s = (ab * bw - bb * aw) / noemer;
            let t = (aa * bw - ab * aw) / noemer;
            let (pa, pb) = (punt(a.begin, a.richting, s), punt(b.begin, b.richting, t));
            if lengte(min(pa, pb)) >= SNIJ_TOLERANTIE { continue; }
            let binnen = |parameter: f64, staaf: &As| {
                parameter * staaf.lengte > SNIJ_TOLERANTIE && (1.0 - parameter) * staaf.lengte > SNIJ_TOLERANTIE
            };
            if !binnen(s, a) || !binnen(t, b) { continue; }
            paren.push((a.id, b.id, [(pa[0] + pb[0]) / 2.0, (pa[1] + pb[1]) / 2.0, (pa[2] + pb[2]) / 2.0]));
        }
    }
    paren.into_iter()
        .filter(|(a, b, snijpunt)| !assen.iter()
            .any(|staaf| staaf.id != *a && staaf.id != *b && afstand_tot(staaf, *snijpunt) < SNIJ_TOLERANTIE))
        .map(|(a, b, _)| (a, b))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::kruisen;
    use crate::{AnalysisKind, Material3D, Member3D, Node3D, Section3D, SolveRequest3D};

    /// Trek-alleen staven tussen de opgegeven punten; elke staaf eigen knopen.
    fn model(staven: &[([f64; 3], [f64; 3])]) -> SolveRequest3D {
        let mut nodes = Vec::new();
        let mut members = Vec::new();
        for (index, (a, b)) in staven.iter().enumerate() {
            let (i, j) = (2 * index + 1, 2 * index + 2);
            nodes.push(Node3D { id: i, x: a[0], y: a[1], z: a[2] });
            nodes.push(Node3D { id: j, x: b[0], y: b[1], z: b[2] });
            members.push(Member3D {
                id: index + 1, start_node_id: i, end_node_id: j, material_id: 1, section_id: 1,
                releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: vec![], tension_only: true,
                bedding: None, part_section_ids: None,
            });
        }
        SolveRequest3D {
            schema_version: 1, analysis: AnalysisKind::Linear, nodes,
            materials: vec![Material3D { id: 1, name: "S235".into(), e_mpa: 210_000.0, nu: 0.3, g_mpa: None, alpha_per_k: None }],
            sections: vec![Section3D { id: 1, name: "strip".into(), area_m2: 5e-4, iy_m4: 1e-8, iz_m4: 1e-8,
                torsion_j_m4: 1e-8, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }],
            members, supports: vec![], nodal_loads: vec![], member_loads: vec![], member_point_loads: vec![],
            thermal_loads: vec![], plates: vec![], shell_elements: vec![], surface_loads: vec![], diaphragms: vec![], node_links: vec![],
            tension_only_fit: None, tension_only_cross_rule: true, max_iterations: 50, tolerance: 1e-10, buckling_modes: 0,
        }
    }

    #[test]
    fn twee_diagonalen_van_een_vak_vormen_een_kruis() {
        // Vak 6 × 4 m in het XZ-vlak: de diagonalen snijden in (3, 0, 2).
        let vak = model(&[([0.0, 0.0, 0.0], [6.0, 0.0, 4.0]), ([6.0, 0.0, 0.0], [0.0, 0.0, 4.0])]);
        assert_eq!(kruisen(&vak), vec![(1, 2)]);
    }

    #[test]
    fn scheve_assen_kruisen_alleen_binnen_een_millimeter() {
        // De tweede diagonaal ligt 0,5 mm resp. 2 mm voor het vlak van de eerste.
        for (y, kruis) in [(0.0005, true), (0.002, false)] {
            let vak = model(&[([0.0, 0.0, 0.0], [6.0, 0.0, 4.0]), ([6.0, y, 0.0], [0.0, y, 4.0])]);
            assert_eq!(!kruisen(&vak).is_empty(), kruis, "afstand {y} m");
        }
    }

    #[test]
    fn een_gedeelde_knoop_een_t_aansluiting_en_evenwijdige_staven_zijn_geen_kruis() {
        // V-verband: beide staven eindigen in (3, 0, 4); als losse knopen op
        // dezelfde plaats snijden de assen in een eindpunt (parameter 1).
        let v = model(&[([0.0, 0.0, 0.0], [3.0, 0.0, 4.0]), ([6.0, 0.0, 0.0], [3.0, 0.0, 4.0])]);
        assert!(kruisen(&v).is_empty());
        // T: de tweede staaf eindigt midden op de eerste.
        let t = model(&[([0.0, 0.0, 0.0], [6.0, 0.0, 0.0]), ([3.0, 0.0, 4.0], [3.0, 0.0, 0.0])]);
        assert!(kruisen(&t).is_empty());
        // Evenwijdig en overlappend.
        let evenwijdig = model(&[([0.0, 0.0, 0.0], [6.0, 0.0, 0.0]), ([1.0, 0.0, 0.0], [5.0, 0.0, 0.0])]);
        assert!(kruisen(&evenwijdig).is_empty());
    }

    #[test]
    fn drie_staven_door_een_punt_tellen_niet() {
        let drie = model(&[
            ([0.0, 0.0, 0.0], [6.0, 0.0, 4.0]),
            ([6.0, 0.0, 0.0], [0.0, 0.0, 4.0]),
            ([0.0, 0.0, 2.0], [6.0, 0.0, 2.0]),
        ]);
        assert!(kruisen(&drie).is_empty());
        // Een derde staaf die het kruis elders snijdt, laat het kruis staan
        // en vormt met elke diagonaal een eigen paar.
        let elders = model(&[
            ([0.0, 0.0, 0.0], [6.0, 0.0, 4.0]),
            ([6.0, 0.0, 0.0], [0.0, 0.0, 4.0]),
            ([0.0, 0.0, 1.0], [6.0, 0.0, 1.0]),
        ]);
        assert_eq!(kruisen(&elders), vec![(1, 2), (1, 3), (2, 3)]);
    }
}
