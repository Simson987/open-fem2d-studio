//! Handberekeningen voor de losse normregels van NEN-EN 1996-1-1 (issue #98).

use approx::assert_relative_eq;
use nen_en_1996_1_1::{afschuiving, capaciteit, geconcentreerd, materiaal, slankheid};
use nen_en_1996_1_1::{Mortelsoort, Steengroep, Steensoort};

/// §3.6.1.2: de exponenten per mortel en steen.
#[test]
fn exponenten() {
    use Mortelsoort::*;
    assert_eq!(materiaal::exponenten(Steensoort::Baksteen, Steengroep::Groep3, Algemeen).unwrap().0, 0.7);
    assert_eq!(materiaal::exponenten(Steensoort::Baksteen, Steengroep::Groep4, Lijm).unwrap().0, 0.85);
    assert_eq!(materiaal::exponenten(Steensoort::Baksteen, Steengroep::Groep2, Lijm).unwrap().0, 0.7);
    assert_eq!(materiaal::exponenten(Steensoort::Cellenbeton, Steengroep::Groep1, Lijm).unwrap().1, 0.0);
    assert!(materiaal::exponenten(Steensoort::Natuursteen, Steengroep::Groep1, Lijm).is_err());
    assert!(materiaal::exponenten(Steensoort::Kalkzandsteen, Steengroep::Groep1, Licht).is_err());
}

/// §5.5.1.2, één verticale rand: h = 2,7 m, l = 1,2 m, ρ_2 = 1,0.
/// h ≤ 3,5 l = 4,2 ⇒ ρ_3 = 1/(1 + (2700/3600)²) = 1/1,5625 = 0,64.
/// h = 5 m > 3,5·1,2 = 4,2 m ⇒ ρ_3 = 1,5·1,2/5 = 0,36.
#[test]
fn rho_3() {
    assert_relative_eq!(slankheid::rho_3(1.0, 2700.0, 1200.0), 0.64, max_relative = 1e-12);
    assert_relative_eq!(slankheid::rho_3(1.0, 5000.0, 1200.0), 0.36, max_relative = 1e-12);
}

/// §5.5.1.2, twee verticale randen: h > 1,15 l ⇒ ρ_4 = 0,5 l/h = 0,5·2/3 = 0,3333.
/// En l ≥ 30 t: de randen tellen niet mee (ρ_2).
#[test]
fn rho_4_en_lange_wand() {
    assert_relative_eq!(slankheid::rho_4(0.75, 3000.0, 2000.0), 1.0 / 3.0, max_relative = 1e-12);
    let eh = slankheid::effectieve_hoogte(slankheid::Steunranden::TweeVerticaleRanden { l_m: 3.0 }, 0.75, 2600.0, 100.0);
    assert_eq!(eh.geval, "rho_2");
    assert_relative_eq!(eh.h_ef_mm, 1950.0, max_relative = 1e-12);
}

/// Bijlage G: zonder slankheid (λ = 0,063) is u = 0 en Φ_m = A_1 = 1 − 2 e/t.
#[test]
fn phi_m_zonder_slankheid_is_a1() {
    // λ = (h_ef/t)·√(f_k/E) = 0,063 bij h_ef/t = 1,99223 en E = 1000 f_k.
    let h_ef = 0.063 * 1000f64.sqrt() * 100.0;
    let pm = capaciteit::phi_m(10.0, 100.0, h_ef, 100.0, 5.0, 5000.0);
    assert_relative_eq!(pm.u, 0.0, epsilon = 1e-12);
    assert_relative_eq!(pm.phi_m, 0.8, max_relative = 1e-12);
}

/// §6.1.3: a_1 = 0 (last aan het wandeinde) ⇒ β_max = 1,25 en de factor
/// (1 + 0,3 a_1/h_c) = 1; A_b/A_ef = 0,5 > 0,45 ⇒ 0,45: β = 1,5 − 0,495 = 1,005.
#[test]
fn beta_aan_wandeinde() {
    let b = geconcentreerd::beta(0.0, 2000.0, 50.0, 100.0);
    assert_relative_eq!(b.ab_aef, 0.45, max_relative = 1e-12);
    assert_relative_eq!(b.beta, 1.005, max_relative = 1e-12);
    assert_relative_eq!(b.beta_max, 1.25, max_relative = 1e-12);
    // l_efm aan het wandeinde: alleen spreiding naar één kant.
    let s = geconcentreerd::spreiding_per_zijde_mm(2000.0);
    assert_relative_eq!(s, 1000.0 / 3f64.sqrt(), max_relative = 1e-12);
    assert_relative_eq!(geconcentreerd::l_efm_mm(100.0, 0.0, 5000.0, 2000.0), 100.0 + s, max_relative = 1e-12);
}

/// §6.2: l_c bij e = l/6 nog de hele lengte, daarboven 3(l/2 − e).
#[test]
fn gedrukte_lengte() {
    assert_relative_eq!(afschuiving::l_c_mm(3000.0, 100.0, 50_000.0), 3000.0, max_relative = 1e-12);
    assert_relative_eq!(afschuiving::l_c_mm(3000.0, 100.0, 100_000.0), 1500.0, max_relative = 1e-12);
    assert_eq!(afschuiving::l_c_mm(3000.0, 0.0, 0.0), 0.0);
}
