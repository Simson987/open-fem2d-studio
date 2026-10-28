//! Veldextremen tussen de vaste stations van de kern (#242).
//!
//! De kern bemonstert elk element in 21 vaste punten (t = 0; 0,05; …; 1),
//! plus de plaatsen rond een puntlast. Een moment dat tussen twee stations
//! extreem is, ontbrak daardoor in `maxValue` en in de toetskrachten: bij een
//! driehoekslast 0 → 6 kN/m op x = 2…5 m van een ligger van 6 m ligt het
//! maximum op x = 2 + √3 = 3,732 m (9,4641 kNm), het station op 3,6 m gaf
//! 9,4347 kNm (−0,31 %).
//!
//! Een momentlijn is extreem waar haar afgeleide, de dwarskracht, nul is:
//! dM_y/dx = V_z en dM_z/dx = −V_y. Tussen twee opeenvolgende stations en
//! lastgrenzen is de dwarskracht van een element exact een veelterm van ten
//! hoogste de tweede graad (gelijkmatige of trapeziumlast). Die wordt uit drie
//! inwendige punten bepaald en exact op nul gezocht. Elk nulpunt wordt een
//! extra station van alle zes lijnen van dat element, zodat de lijnen van één
//! element dezelfde stations houden (nodig voor gedraaide hoofdassen) en de
//! staaltoets in dat punt de volledige set snedekrachten krijgt.

use rekenkern::{
    postprocess::diagrams_3d::{evaluate_diagram_3d_at, DiagramPoint3D, DiagramResults3D, ElementDiagram3D},
    types::ElementForces3D,
};

/// Twee stations binnen deze afstand (in t) gelden als hetzelfde.
const ZELFDE_T: f64 = 1e-9;

/// Nulpunten van de dwarskracht `soort` ("shearY" of "shearZ") strikt binnen
/// het element en niet op een bestaand station.
fn nulpunten(ef: &ElementForces3D, soort: &str, stations: &[f64]) -> Vec<f64> {
    let l = ef.length;
    if !(l > 0.0) { return Vec::new(); }
    let (verdeeld, punt) = if soort == "shearZ" {
        (&ef.distributed_loads_z, &ef.point_loads_z)
    } else {
        (&ef.distributed_loads_y, &ef.point_loads_y)
    };
    if verdeeld.is_empty() { return Vec::new(); } // zonder verdeelde last is V stuksgewijs constant
    let mut grenzen: Vec<f64> = stations.to_vec();
    for dl in verdeeld.iter() { grenzen.push(dl.a / l); grenzen.push(dl.b / l); }
    for pl in punt.iter() { grenzen.push(pl.a / l); }
    grenzen.retain(|t| (0.0..=1.0).contains(t));
    grenzen.sort_by(f64::total_cmp);
    grenzen.dedup_by(|a, b| (*a - *b).abs() < ZELFDE_T);

    let v = |t: f64| evaluate_diagram_3d_at(ef, soort, t);
    let schaal = stations.iter().map(|&t| v(t).abs()).fold(0.0, f64::max);
    if !(schaal > 0.0) { return Vec::new(); }
    let mut uit = Vec::new();
    for paar in grenzen.windows(2) {
        let (t0, t1) = (paar[0], paar[1]);
        let h = t1 - t0;
        if h < ZELFDE_T { continue; }
        // V(u) = c + b·u + a·u² met t = midden + u·h/4; u = −1, 0, 1 liggen
        // strikt binnen het interval, dus ook naast een sprong door een puntlast.
        let midden = 0.5 * (t0 + t1);
        let (vm, v0, vp) = (v(midden - 0.25 * h), v(midden), v(midden + 0.25 * h));
        let (a, b, c) = (0.5 * (vp + vm) - v0, 0.5 * (vp - vm), v0);
        let mut wortels = Vec::with_capacity(2);
        if a.abs() <= 1e-12 * schaal {
            if b.abs() > 1e-12 * schaal { wortels.push(-c / b); }
        } else {
            let d = b * b - 4.0 * a * c;
            if d >= 0.0 {
                // Numeriek stabiele vorm van de abc-formule.
                let q = -0.5 * (b + b.signum() * d.sqrt());
                if q != 0.0 { wortels.push(q / a); wortels.push(c / q); } else { wortels.push(0.0); }
            }
        }
        for u in wortels {
            let t = midden + u * 0.25 * h;
            if t > t0 + ZELFDE_T && t < t1 - ZELFDE_T { uit.push(t); }
        }
    }
    uit
}

/// Voegt het station iets toe? Alleen als het moment daar meer dan
/// `RELEVANT` van de grootste waarde van de lijn buiten beide buurstations
/// uitsteekt (boven het grootste of onder het kleinste); anders blijft de lijn
/// zoals de kern haar gaf (een extremum dat al op een station valt, of
/// afrondingsruis rond zo'n station).
fn telt(lijn: &ElementDiagram3D, waarde: f64, t: f64, schaal: f64) -> bool {
    let Some(rechts) = lijn.points.iter().position(|p| p.t > t) else { return false };
    if rechts == 0 { return false; }
    let (a, b) = (lijn.points[rechts - 1].value, lijn.points[rechts].value);
    let uitsteek = (waarde - a.max(b)).max(a.min(b) - waarde);
    uitsteek > RELEVANT * schaal.max(waarde.abs())
}

/// Relatieve drempel voor een extra station (zie `telt`).
const RELEVANT: f64 = 1e-9;

fn herbereken(lijn: &mut ElementDiagram3D) {
    lijn.max_value = lijn.points.iter().map(|p| p.value).fold(f64::NEG_INFINITY, f64::max);
    lijn.min_value = lijn.points.iter().map(|p| p.value).fold(f64::INFINITY, f64::min);
    // De kern bewaart de waarde met teken die de grootste absolute waarde heeft.
    lijn.max_abs_value = if lijn.max_value.abs() >= lijn.min_value.abs() { lijn.max_value } else { lijn.min_value };
}

/// Voeg per element de stations toe waar V_y of V_z nul is, met de exacte
/// waarden van alle zes lijnen daar, en werk max/min bij.
pub(crate) fn voeg_toe(element_forces: &[ElementForces3D], diagrammen: &mut DiagramResults3D) {
    let per_element: std::collections::HashMap<usize, &ElementForces3D> =
        element_forces.iter().map(|ef| (ef.element_id, ef)).collect();
    let index = |lijst: &[ElementDiagram3D]| -> std::collections::HashMap<usize, usize> {
        lijst.iter().enumerate().map(|(i, d)| (d.element_id, i)).collect()
    };
    let soorten = ["momentY", "momentZ", "shearY", "shearZ", "axial", "torsion"];
    let indexen: Vec<_> = [
        &diagrammen.moment_y, &diagrammen.moment_z, &diagrammen.shear_y,
        &diagrammen.shear_z, &diagrammen.axial, &diagrammen.torsion,
    ].iter().map(|lijst| index(lijst)).collect();
    for (&id, ef) in &per_element {
        let mut extra = Vec::new();
        for (lijst, i, dwars, moment) in [
            (&diagrammen.moment_y, indexen[0].get(&id), "shearZ", "momentY"),
            (&diagrammen.moment_z, indexen[1].get(&id), "shearY", "momentZ"),
        ] {
            let Some(&i) = i else { continue };
            let lijn = &lijst[i];
            let stations: Vec<f64> = lijn.points.iter().map(|p| p.t).collect();
            let schaal = lijn.points.iter().map(|p| p.value.abs()).fold(0.0, f64::max);
            for t in nulpunten(ef, dwars, &stations) {
                if telt(lijn, evaluate_diagram_3d_at(ef, moment, t), t, schaal) { extra.push(t); }
            }
        }
        if extra.is_empty() { continue; }
        extra.sort_by(f64::total_cmp);
        extra.dedup_by(|a, b| (*a - *b).abs() < ZELFDE_T);
        let lijsten = [
            &mut diagrammen.moment_y, &mut diagrammen.moment_z, &mut diagrammen.shear_y,
            &mut diagrammen.shear_z, &mut diagrammen.axial, &mut diagrammen.torsion,
        ];
        for (k, lijst) in lijsten.into_iter().enumerate() {
            let Some(&i) = indexen[k].get(&id) else { continue };
            let lijn = &mut lijst[i];
            let mut toegevoegd = false;
            for &t in &extra {
                if lijn.points.iter().any(|p| (p.t - t).abs() < ZELFDE_T) { continue; }
                lijn.points.push(DiagramPoint3D { t, value: evaluate_diagram_3d_at(ef, soorten[k], t) });
                toegevoegd = true;
            }
            if toegevoegd {
                lijn.points.sort_by(|p, q| p.t.total_cmp(&q.t));
                herbereken(lijn);
            }
        }
    }
}
