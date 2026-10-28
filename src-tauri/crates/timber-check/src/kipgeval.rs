//! Het belastinggeval van tabel 6.1 (EN 1995-1-1 6.3.3) voor de effectieve
//! kiplengte, AFGELEID uit het momentverloop als de invoer het niet noemt
//! (issue #220).
//!
//! # WAAROM
//!
//! Tot oktober 2026 viel een weggelaten `ltb_load_case` stil terug op
//! "gelijkmatig verdeelde belasting", l_ef = 0,9·l. Bij een constant moment
//! hoort volgens tabel 6.1 l_ef = 1,0·l: de kiptoets kwam dan 10 % te gunstig
//! uit (controle 2026-10-26, B2: UC 0,8898 in plaats van 0,9886). Bij een
//! uitkraging met gelijkmatige last (0,5·l) was dezelfde terugval juist te
//! streng.
//!
//! # HOE
//!
//! Tabel 6.1 kent vijf rijen:
//!
//! | oplegging        | belasting               | l_ef/l |
//! |------------------|-------------------------|--------|
//! | twee steunpunten | constant moment         | 1,0    |
//! | twee steunpunten | gelijkmatig verdeeld    | 0,9    |
//! | twee steunpunten | puntlast in het midden  | 0,8    |
//! | uitkraging       | gelijkmatig verdeeld    | 0,5    |
//! | uitkraging       | puntlast aan het einde  | 0,8    |
//!
//! Per UGT-combinatie wordt het momentverloop langs de staaf (de stations van
//! `forces_envelope`) genormeerd op zijn grootste waarde en vergeleken met de
//! vorm van elke rij: constant, de parabool 4ξ(1−ξ), de driehoek 1−|2ξ−1|, en
//! bij een uitkraging d² en d met d de afstand tot het vrije einde. Een
//! combinatie van de twee lastvormen van één oplegging (bijvoorbeeld eigen
//! gewicht plus een puntlast) krijgt de rij met de GROOTSTE l_ef van die twee.
//! Een verloop dat bij geen rij past (eindmomenten, doorgaande ligger,
//! wisselend teken, te weinig stations) krijgt l_ef = 1,0·l: de bovengrens van
//! de tabel. Over de combinaties telt de GROOTSTE l_ef — de veilige kant, want
//! een langere l_ef geeft een lagere σ_m,crit.
//!
//! Is de kipsteunafstand korter dan de staaf, dan is het verloop BINNEN een
//! kipveld niet dat van de staaf; dan geldt eveneens 1,0·ℓ.

use mechanics::ForcePoint;
use nen_en_1995_1_1::stability::{l_ef_geval_tekst, l_ef_verhouding, LtbLoadCase};

use crate::input::TimberBeamCheckInput;

/// Relatieve tolerantie op de genormeerde momentlijn.
const TOL: f64 = 0.01;
/// Minder stations dan dit: alleen "constant" is te herkennen.
const MIN_STATIONS_VORM: usize = 5;

/// Het belastinggeval voor l_ef en de notitie die zegt waar het vandaan komt.
/// `None` als de invoer het geval zelf noemt: dan geen extra notitie, zodat
/// een bestaande invoer met `ltb_load_case` geen getal en geen regel verandert.
pub(crate) fn kipgeval(input: &TimberBeamCheckInput) -> (LtbLoadCase, Option<String>) {
    if let Some(geval) = input.ltb_load_case {
        return (geval, None);
    }
    let (geval, reden) = afleiden(input);
    let tekst = format!(
        "Belastinggeval van tabel 6.1 AFGELEID uit het momentverloop, want 'ltb_load_case' is niet \
         opgegeven: {} (l_ef/ℓ = {}). {reden} Wijkt het werkelijke geval af, geef dan \
         'ltb_load_case' op.",
        l_ef_geval_tekst(geval),
        format!("{:.1}", l_ef_verhouding(geval)).replace('.', ","),
    );
    (geval, Some(tekst))
}

fn afleiden(input: &TimberBeamCheckInput) -> (LtbLoadCase, String) {
    let l_mm = input.length_m * 1e3;
    let uitkraging = input.is_cantilever;
    if input.ltb_segment_length_m > 0.0 && input.ltb_segment_length_m * 1e3 < l_mm - 1.0 {
        return (
            LtbLoadCase::ConstantMoment,
            "De kipsteunafstand is korter dan de staaf; het momentverloop binnen een kipveld is \
             niet dat van de staaf, dus geldt de bovengrens van tabel 6.1."
                .to_string(),
        );
    }
    if !(l_mm > 0.0) {
        return (
            LtbLoadCase::ConstantMoment,
            "Zonder staaflengte is er geen verloop te lezen; de bovengrens van tabel 6.1 geldt."
                .to_string(),
        );
    }

    // Per combinatie de stations, op positie.
    let mut combinaties: Vec<u32> = input.forces_envelope.iter().map(|p| p.combination_id).collect();
    combinaties.sort_unstable();
    combinaties.dedup();
    let globaal = input
        .forces_envelope
        .iter()
        .map(|p| p.forces.my_ed.abs())
        .fold(0.0_f64, f64::max);
    if !(globaal > 1e-9) {
        return (
            LtbLoadCase::ConstantMoment,
            "De staaf draagt geen moment om de sterke as; kip speelt dan niet, en de bovengrens van \
             tabel 6.1 is aangehouden."
                .to_string(),
        );
    }

    let mut beste: Option<(LtbLoadCase, u32, &'static str)> = None;
    for c in combinaties {
        let mut punten: Vec<&ForcePoint> =
            input.forces_envelope.iter().filter(|p| p.combination_id == c).collect();
        punten.sort_by(|a, b| {
            a.position_mm
                .partial_cmp(&b.position_mm)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        punten.dedup_by(|a, b| (a.position_mm - b.position_mm).abs() < 1e-6);
        let m_max = punten.iter().map(|p| p.forces.my_ed.abs()).fold(0.0_f64, f64::max);
        // Een combinatie met een verwaarloosbaar moment zegt niets over kip.
        if m_max < 0.01 * globaal {
            continue;
        }
        let (geval, waarom) = classificeer(&punten, l_mm, m_max, uitkraging);
        let nieuw = match &beste {
            None => true,
            Some((g, _, _)) => l_ef_verhouding(geval) > l_ef_verhouding(*g),
        };
        if nieuw {
            beste = Some((geval, c, waarom));
        }
    }
    match beste {
        Some((geval, c, waarom)) => (
            geval,
            format!(
                "Maatgevend (grootste l_ef over de UGT-combinaties) is combinatie {c}: {waarom}{}",
                if uitkraging { " De staaf heeft een vrij einde (uitkraging)." } else { "" }
            ),
        ),
        None => (
            LtbLoadCase::ConstantMoment,
            "Geen combinatie met een moment van betekenis; de bovengrens van tabel 6.1 is aangehouden."
                .to_string(),
        ),
    }
}

/// Past `v ≈ c·b` met één vormfunctie `b` en c > 0?
fn past_een(v: &[f64], b: &[f64]) -> bool {
    let bb: f64 = b.iter().map(|x| x * x).sum();
    if bb <= 0.0 {
        return false;
    }
    let c = v.iter().zip(b).map(|(x, y)| x * y).sum::<f64>() / bb;
    c > 0.0 && v.iter().zip(b).all(|(x, y)| (x - c * y).abs() <= TOL)
}

/// Past `v ≈ a·b1 + c·b2` met a, c ≥ 0 (kleinste kwadraten)?
fn past_twee(v: &[f64], b1: &[f64], b2: &[f64]) -> bool {
    let dot = |p: &[f64], q: &[f64]| p.iter().zip(q).map(|(x, y)| x * y).sum::<f64>();
    let (s11, s12, s22) = (dot(b1, b1), dot(b1, b2), dot(b2, b2));
    let (r1, r2) = (dot(v, b1), dot(v, b2));
    let det = s11 * s22 - s12 * s12;
    if det.abs() < 1e-12 {
        return false;
    }
    let a = (r1 * s22 - r2 * s12) / det;
    let c = (s11 * r2 - s12 * r1) / det;
    a >= -TOL
        && c >= -TOL
        && v.iter()
            .zip(b1.iter().zip(b2))
            .all(|(x, (p, q))| (x - a * p - c * q).abs() <= TOL)
}

fn classificeer(
    punten: &[&ForcePoint],
    l_mm: f64,
    m_max: f64,
    uitkraging: bool,
) -> (LtbLoadCase, &'static str) {
    // Normeren: het teken van het grootste moment positief, maximum 1.
    let teken = punten
        .iter()
        .map(|p| p.forces.my_ed)
        .fold(0.0_f64, |acc, m| if m.abs() > acc.abs() { m } else { acc })
        .signum();
    let v: Vec<f64> = punten.iter().map(|p| teken * p.forces.my_ed / m_max).collect();
    let xi: Vec<f64> = punten.iter().map(|p| (p.position_mm / l_mm).clamp(0.0, 1.0)).collect();

    if v.len() >= 2 && v.iter().all(|x| (x - v[0]).abs() <= TOL) {
        return (LtbLoadCase::ConstantMoment, "het moment is constant langs de staaf.");
    }
    if v.len() < MIN_STATIONS_VORM {
        return (
            LtbLoadCase::ConstantMoment,
            "te weinig stations om de vorm van het momentverloop te herkennen; de bovengrens \
             van tabel 6.1 is aangehouden.",
        );
    }
    if !uitkraging {
        let parabool: Vec<f64> = xi.iter().map(|x| 4.0 * x * (1.0 - x)).collect();
        let driehoek: Vec<f64> = xi.iter().map(|x| 1.0 - (2.0 * x - 1.0).abs()).collect();
        if past_een(&v, &parabool) {
            return (
                LtbLoadCase::UniformLoad,
                "het verloop is de parabool van een gelijkmatig verdeelde belasting op twee steunpunten.",
            );
        }
        if past_een(&v, &driehoek) {
            return (
                LtbLoadCase::ConcentratedMidspan,
                "het verloop is de driehoek van een puntlast in het midden op twee steunpunten.",
            );
        }
        if past_twee(&v, &parabool, &driehoek) {
            return (
                LtbLoadCase::UniformLoad,
                "het verloop is een gelijkmatig verdeelde belasting plus een puntlast in het midden \
                 op twee steunpunten; de rij met de grootste l_ef van die twee (0,9) is aangehouden.",
            );
        }
    } else {
        // Het vrije einde ligt op ξ = 0 of op ξ = 1; d = afstand ertoe.
        for d in [
            xi.iter().copied().collect::<Vec<f64>>(),
            xi.iter().map(|x| 1.0 - x).collect(),
        ] {
            let kwadraat: Vec<f64> = d.iter().map(|x| x * x).collect();
            if past_een(&v, &kwadraat) {
                return (
                    LtbLoadCase::CantileverUniform,
                    "het verloop is dat van een uitkraging met een gelijkmatig verdeelde belasting.",
                );
            }
            if past_een(&v, &d) {
                return (
                    LtbLoadCase::CantileverConcentratedEnd,
                    "het verloop is dat van een uitkraging met een puntlast aan het vrije einde.",
                );
            }
            if past_twee(&v, &kwadraat, &d) {
                return (
                    LtbLoadCase::CantileverConcentratedEnd,
                    "het verloop is dat van een uitkraging met een gelijkmatig verdeelde belasting \
                     plus een puntlast aan het vrije einde; de rij met de grootste l_ef van die twee \
                     (0,8) is aangehouden.",
                );
            }
        }
    }
    (
        LtbLoadCase::ConstantMoment,
        "het verloop past bij geen rij van tabel 6.1 (bijvoorbeeld eindmomenten of een doorgaande \
         ligger); de bovengrens van de tabel, 1,0·ℓ, is aangehouden.",
    )
}
