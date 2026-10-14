//! Montage van trek-alleen staven (`tensionOnlyFit`): verbanden die pas
//! gemonteerd worden als de montagelasten, bijvoorbeeld de permanente
//! belasting, al op het frame staan.
//!
//! Op het moment van monteren staat het frame lood en vervormd onder de
//! montagelasten, en het verband wordt gepast op de dan aanwezige afstand van
//! zijn eindknopen. Zijn spanningsloze lengte is daarna L + Δ0, met Δ0 de
//! verlenging van de koorde (u_j − u_i)·e_x in de montagetoestand, verminderd
//! met de vrije temperatuurverlenging van de staaf zelf in die toestand. In
//! elke berekening werkt Δ0 als gelijkwaardige uniforme temperatuur
//! ΔT = Δ0/(α·L), met dezelfde α als de kern (die van het materiaal, anders
//! 12e-6/K). Zo nemen de normaalkracht van de kern, de vrije verlenging in de
//! statuslus en de geometrische stijfheid van de tweede orde haar vanzelf mee.
//!
//! Bepaling van Δ0. Eén lineaire berekening onder alleen de montagelasten, met
//! alle staven actief (trek-alleen als gewone staaf, zodat het frame lood
//! staat), geeft de koordeverlenging e₁. Het verband draagt in die berekening
//! zelf mee: gepast op e₁ houdt het onder de montagelasten nog een rest ρ·N₁,
//! met ρ het aandeel van het verband in de stijfheid langs die vervorming (bij
//! een slank verband een paar procent). Trek-alleen kijkt alleen naar het
//! teken, dus ook die kleine rest op druk zou het verband uitschakelen.
//! Daarom past de adapter opnieuw op de nieuwe koorde, tot de krachten in de
//! verbanden niet meer veranderen; elke ronde houdt ρ van de vorige rest over.
//! Een kracht die niet afneemt, hoort bij een vervorming die het frame zonder
//! verbanden niet kan dragen (een scheefstandmechanisme). Die kracht blijft
//! in de verbanden, en voor dat deel krijgt het verband weer zijn lengte in
//! de lode stand: herhaald passen zou het frame daar alleen verder laten
//! overhellen (de correctie −(j−1)·N_j/k hieronder). Is het frame zonder
//! verbanden een mechanisme dat de montagelasten niet aandrijven (verticale
//! last op een scharnierend frame), dan zijn er meer passingen zonder kracht;
//! het passen geeft die met de kleinste lengteaanpassingen, en het frame staat
//! dan lood op de verschillen in kolomverkorting na.

use std::collections::{BTreeMap, HashMap};

use crate::{
    bedding::Los, shell::PlateGeometry, AnalysisKind, Member3D, SolveRequest3D, ThermalLoad3D,
};

/// Hoogstens zoveel montageberekeningen per verzoek.
const MAX_BEREKENINGEN: usize = 12;

/// De montage van de trek-alleen staven.
pub(crate) struct Montage {
    /// Δ0 per trek-alleen staaf in m, oplopend op staaf-id.
    pub delta_m: BTreeMap<usize, f64>,
    /// Aantal lineaire montageberekeningen; 0 bij lege montagelasten.
    pub berekeningen: usize,
    /// Grootste |N| in een trek-alleen staaf onder alleen de montagelasten,
    /// na het passen (kN, staaf-id).
    pub restkracht: Option<(f64, usize)>,
    /// `true` als de krachten na `MAX_BEREKENINGEN` nog veranderden.
    pub afgebroken: bool,
    /// Grootste |N| van alle staven in de eerste montageberekening (kN), de
    /// schaal voor wat als ruis telt.
    pub schaal: f64,
}

impl Montage {
    /// Aantal staven met een aanpassing van meer dan 1 µm.
    pub fn aangepast(&self) -> usize {
        self.delta_m.values().filter(|delta| delta.abs() > 1e-6).count()
    }

    /// Grootste |Δ0| in mm met de staaf-id.
    pub fn grootste_mm(&self) -> Option<(f64, usize)> {
        self.delta_m.iter()
            .map(|(id, delta)| (delta.abs() * 1000.0, *id))
            .max_by(|a, b| a.0.total_cmp(&b.0))
    }
}

/// Het verzoek waarmee de montage gerekend wordt: hetzelfde model met alleen
/// de montagelasten, lineair, zonder knikvormen en zonder opgelegde
/// verplaatsingen. `None` zonder `tensionOnlyFit`.
pub(crate) fn verzoek(request: &SolveRequest3D) -> Option<SolveRequest3D> {
    let lasten = request.tension_only_fit.as_ref()?;
    let mut verzoek = request.clone();
    verzoek.tension_only_fit = None;
    verzoek.tension_only_cross_rule = false;
    verzoek.analysis = AnalysisKind::Linear;
    verzoek.buckling_modes = 0;
    verzoek.nodal_loads = lasten.nodal_loads.clone();
    verzoek.member_loads = lasten.member_loads.clone();
    verzoek.member_point_loads = lasten.member_point_loads.clone();
    verzoek.thermal_loads = lasten.thermal_loads.clone();
    verzoek.surface_loads = lasten.surface_loads.clone();
    for support in &mut verzoek.supports {
        support.ux_prescribed_m = None;
        support.uy_prescribed_m = None;
        support.uz_prescribed_m = None;
        support.rx_prescribed_rad = None;
        support.ry_prescribed_rad = None;
        support.rz_prescribed_rad = None;
    }
    Some(verzoek)
}

/// Eén trek-alleen staaf met wat de montage van haar nodig heeft.
struct Verband {
    id: usize,
    start: usize,
    eind: usize,
    /// Eenheidsvector van begin- naar eindknoop.
    ex: [f64; 3],
    lengte: f64,
    /// Axiale stijfheid EA/L in kN/m.
    stijfheid: f64,
    alpha: f64,
    /// Vrije temperatuurverlenging uit de montagelasten op de staaf zelf (m).
    eigen: f64,
}

fn verbanden(request: &SolveRequest3D, thermisch: &[ThermalLoad3D]) -> Vec<Verband> {
    let knopen: HashMap<usize, [f64; 3]> = request.nodes.iter()
        .map(|node| (node.id, [node.x, node.y, node.z])).collect();
    request.members.iter().filter(|staaf| staaf.tension_only).map(|staaf: &Member3D| {
        let (a, b) = (knopen[&staaf.start_node_id], knopen[&staaf.end_node_id]);
        let as_ = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let lengte = (as_[0] * as_[0] + as_[1] * as_[1] + as_[2] * as_[2]).sqrt();
        let materiaal = request.materials.iter().find(|m| m.id == staaf.material_id).unwrap();
        // Bij een verlopende staaf (#73) de delen in serie: n/Σ(1/A_i).
        let oppervlakte = crate::verloop::axiale_oppervlakte(request, staaf).expect("doorsnede is gekeurd");
        let alpha = materiaal.alpha_per_k.unwrap_or(12e-6);
        let delta_t: f64 = thermisch.iter()
            .filter(|load| load.member_id == staaf.id)
            .map(|load| load.delta_t_uniform_k)
            .sum();
        Verband {
            id: staaf.id,
            start: staaf.start_node_id,
            eind: staaf.end_node_id,
            ex: [as_[0] / lengte, as_[1] / lengte, as_[2] / lengte],
            lengte,
            stijfheid: materiaal.e_mpa * 1000.0 * oppervlakte / lengte,
            alpha,
            eigen: alpha * delta_t * lengte,
        }
    }).collect()
}

/// Het verzoek met Δ0 als gelijkwaardige uniforme temperatuur op elke
/// trek-alleen staaf met een aanpassing; nieuwe id's boven de bestaande.
pub(crate) fn met_aanpassing(request: &SolveRequest3D, delta_m: &BTreeMap<usize, f64>) -> SolveRequest3D {
    let mut verzoek = request.clone();
    let mut volgende = request.thermal_loads.iter().map(|load| load.id).max().unwrap_or(0) + 1;
    for verband in verbanden(request, &[]) {
        let delta = delta_m.get(&verband.id).copied().unwrap_or(0.0);
        if delta == 0.0 { continue; }
        verzoek.thermal_loads.push(ThermalLoad3D {
            id: volgende,
            member_id: verband.id,
            delta_t_uniform_k: delta / (verband.alpha * verband.lengte),
            delta_t_gradient_y_k: 0.0,
            delta_t_gradient_z_k: 0.0,
        });
        volgende += 1;
    }
    verzoek
}

/// Bepaal Δ0 voor alle trek-alleen staven; `None` zonder `tensionOnlyFit`.
pub(crate) fn bepaal(
    request: &SolveRequest3D,
    platen: &HashMap<usize, PlateGeometry>,
) -> Result<Option<Montage>, String> {
    let Some(basis) = verzoek(request) else { return Ok(None) };
    let verbanden = verbanden(&basis, &basis.thermal_loads);
    let mut delta_m: BTreeMap<usize, f64> = verbanden.iter().map(|verband| (verband.id, 0.0)).collect();
    let leeg = basis.nodal_loads.is_empty() && basis.member_loads.is_empty()
        && basis.member_point_loads.is_empty() && basis.thermal_loads.is_empty()
        && basis.surface_loads.is_empty();
    if leeg || verbanden.is_empty() {
        return Ok(Some(Montage { delta_m, berekeningen: 0, restkracht: None, afgebroken: false, schaal: 1.0 }));
    }
    let mut vorige: Option<Vec<f64>> = None;
    let mut schaal = 1.0;
    for berekening in 1..=MAX_BEREKENINGEN {
        // De montage rekent met alle grondveren van een bedding (lineair).
        let uitkomst = crate::solve_fixed(&met_aanpassing(&basis, &delta_m), platen, AnalysisKind::Linear, 0, &Los::new())
            .map_err(|fout| format!("montageberekening van de trek-alleen staven: {fout}"))?;
        let verplaatsing: HashMap<usize, [f64; 3]> = uitkomst.displacements.iter()
            .map(|d| (d.node_id, [d.ux, d.uy, d.uz])).collect();
        // Koordeverlenging min de eigen vrije temperatuurverlenging: de lengte
        // waarop het verband in deze toestand spanningsloos zou passen.
        let koorde: Vec<f64> = verbanden.iter().map(|verband| {
            let (a, b) = (verplaatsing[&verband.start], verplaatsing[&verband.eind]);
            (0..3).map(|as_| (b[as_] - a[as_]) * verband.ex[as_]).sum::<f64>() - verband.eigen
        }).collect();
        let krachten: Vec<f64> = verbanden.iter().zip(&koorde)
            .map(|(verband, koorde)| verband.stijfheid * (koorde - delta_m[&verband.id]))
            .collect();
        if berekening == 1 {
            // Numerieke ruis in N schaalt met de grootste normaalkracht.
            schaal = uitkomst.member_forces.iter()
                .map(|f| f.n_start_kn.abs().max(f.n_end_kn.abs()))
                .fold(1.0, f64::max);
            if koorde.iter().all(|koorde| koorde.abs() <= 1e-12) {
                return Ok(Some(Montage {
                    delta_m, berekeningen: 1, restkracht: grootste(&verbanden, &krachten), afgebroken: false, schaal,
                }));
            }
        }
        if let Some(vorige) = &vorige {
            let verandering = krachten.iter().zip(vorige).map(|(nu, toen)| (nu - toen).abs()).fold(0.0, f64::max);
            let tolerantie = 1e-9 * schaal;
            if verandering <= tolerantie || berekening == MAX_BEREKENINGEN {
                // Een kracht die niet meer afneemt, liet bij elke ronde het
                // verband N/k langer of korter passen; zet dat terug zodat het
                // frame bij het monteren lood blijft.
                let rondes = (berekening - 1) as f64;
                for (verband, kracht) in verbanden.iter().zip(&krachten) {
                    *delta_m.get_mut(&verband.id).unwrap() -= rondes * kracht / verband.stijfheid;
                }
                return Ok(Some(Montage {
                    delta_m,
                    berekeningen: berekening,
                    restkracht: grootste(&verbanden, &krachten),
                    afgebroken: verandering > tolerantie,
                    schaal,
                }));
            }
        }
        for (verband, koorde) in verbanden.iter().zip(&koorde) {
            delta_m.insert(verband.id, *koorde);
        }
        vorige = Some(krachten);
    }
    unreachable!("de laatste montageberekening rondt altijd af")
}

fn grootste(verbanden: &[Verband], krachten: &[f64]) -> Option<(f64, usize)> {
    verbanden.iter().zip(krachten)
        .map(|(verband, kracht)| (kracht.abs(), verband.id))
        .max_by(|a, b| a.0.total_cmp(&b.0))
}

/// De regel voor de diagnostiek.
pub(crate) fn diagnose(montage: &Montage, aantal: usize) -> Vec<String> {
    if montage.berekeningen == 0 {
        return vec![format!(
            "Montage trek-alleen: de montagelasten zijn leeg; alle {aantal} trek-alleen staven zijn spanningsloos in de onvervormde stand (Δ0 = 0)."
        )];
    }
    let mut regels = vec![match montage.grootste_mm() {
        Some((grootste, id)) if montage.aangepast() > 0 => format!(
            "Montage trek-alleen: {} van {aantal} trek-alleen staven zijn gepast op hun lengte onder de montagelasten; grootste |Δ0| = {grootste:.3} mm (staaf {id}); {} lineaire montageberekening(en).",
            montage.aangepast(), montage.berekeningen,
        ),
        _ => format!(
            "Montage trek-alleen: de montagelasten veranderen de lengte van geen enkele trek-alleen staaf (|Δ0| ≤ 0.001 mm); {} lineaire montageberekening(en).",
            montage.berekeningen,
        ),
    }];
    if let Some((kracht, id)) = montage.restkracht {
        // Onder 1e-4 van de grootste normaalkracht is het passen voltooid.
        if kracht > 1e-4 * montage.schaal {
            regels.push(format!(
                "Montage trek-alleen: onder alleen de montagelasten houden de verbanden een kracht die het frame zonder verbanden niet kan dragen; grootste |N| = {kracht:.3} kN (staaf {id})."
            ));
        }
    }
    if montage.afgebroken {
        regels.push(format!(
            "Montage trek-alleen: na {} montageberekeningen veranderden de verbandkrachten nog; langs een vervorming die bijna een mechanisme is, blijft een deel van de montagekracht in de verbanden.",
            montage.berekeningen,
        ));
    }
    regels
}
