//! Doorsnedeklassen en lokale plooi — NEN-EN 1999-1-1 §6.1.4 en §6.1.5.
//!
//! Aluminium kent geen effectieve BREEDTE zoals EN 1993-1-5, maar een
//! effectieve DIKTE: een slank (klasse-4-)deel rekent met `ρ_c · t` over zijn
//! hele breedte (§6.1.5(1)).

use crate::materiaal::Knikklasse;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Soort plaatdeel, §6.1.4.1 en figuur 6.1.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/aluminium/")]
pub enum Deelsoort {
    /// Vlak uitstekend deel (één vrije rand), bijv. een halve flens.
    Uitstekend,
    /// Vlak inwendig deel (beide randen gesteund), bijv. een lijf of de flens
    /// van een koker.
    Inwendig,
}

/// `ε = √(250 / f_o)`, tabel 6.2 (f_o in N/mm²).
pub fn epsilon(f_o: f64) -> f64 {
    (250.0 / f_o).sqrt()
}

/// `η` voor een inwendig deel met spanningsgradiënt, §6.1.4.3(2) (6.1)/(6.2):
/// `η = 0,70 + 0,30 ψ` voor `1 ≥ ψ ≥ −1`, `η = 0,80 / (1 − ψ)` voor `ψ < −1`.
/// `ψ` = spanning aan de ene rand gedeeld door de grootste drukspanning.
pub fn eta_inwendig(psi: f64) -> f64 {
    if psi >= -1.0 {
        0.70 + 0.30 * psi.min(1.0)
    } else {
        0.80 / (1.0 - psi)
    }
}

/// Slankheid `β` van een deel, §6.1.4.3: `β = η · b / t`. Uniform gedrukt:
/// `ψ = 1`, dus `η = 1`. Voor een uitstekend deel wordt hier altijd `β = b/t`
/// aangehouden (de piekdruk aan de vrije rand, §6.1.4.3(2)a), wat voor elk
/// spanningsverloop veilig is.
pub fn beta(soort: Deelsoort, b: f64, t: f64, psi: f64) -> f64 {
    match soort {
        Deelsoort::Uitstekend => b / t,
        Deelsoort::Inwendig => eta_inwendig(psi) * b / t,
    }
}

/// De grenzen `β₁/ε`, `β₂/ε`, `β₃/ε` van tabel 6.2.
pub fn grenzen(knikklasse: Knikklasse, gelast: bool, soort: Deelsoort) -> [f64; 3] {
    use Deelsoort::*;
    use Knikklasse::*;
    match (knikklasse, gelast, soort) {
        (A, false, Uitstekend) => [3.0, 4.5, 6.0],
        (A, false, Inwendig) => [11.0, 16.0, 22.0],
        (A, true, Uitstekend) => [2.5, 4.0, 5.0],
        (A, true, Inwendig) => [9.0, 13.0, 18.0],
        (B, false, Uitstekend) => [3.5, 4.5, 5.0],
        (B, false, Inwendig) => [13.0, 16.5, 18.0],
        (B, true, Uitstekend) => [3.0, 3.5, 4.0],
        (B, true, Inwendig) => [10.0, 13.5, 15.0],
    }
}

/// De constanten `C₁`, `C₂` van tabel 6.3.
pub fn constanten_rho_c(knikklasse: Knikklasse, gelast: bool, soort: Deelsoort) -> [f64; 2] {
    use Deelsoort::*;
    use Knikklasse::*;
    match (knikklasse, gelast, soort) {
        (A, false, Inwendig) => [32.0, 220.0],
        (A, false, Uitstekend) => [10.0, 24.0],
        (A, true, Inwendig) | (B, false, Inwendig) => [29.0, 198.0],
        (A, true, Uitstekend) | (B, false, Uitstekend) => [9.0, 20.0],
        (B, true, Inwendig) => [25.0, 150.0],
        (B, true, Uitstekend) => [8.0, 16.0],
    }
}

/// Klasse 1…4 van één deel, §6.1.4.2: `β ≤ β₁` → 1, `β₁ < β ≤ β₂` → 2,
/// `β₂ < β ≤ β₃` → 3, `β > β₃` → 4.
pub fn klasse(beta: f64, eps: f64, g: [f64; 3]) -> u8 {
    if beta <= g[0] * eps {
        1
    } else if beta <= g[1] * eps {
        2
    } else if beta <= g[2] * eps {
        3
    } else {
        4
    }
}

/// Reductiefactor voor lokale plooi `ρ_c`, §6.1.5(2) (6.12):
/// `ρ_c = 1` voor `β ≤ β₃`, anders `ρ_c = C₁/(β/ε) − C₂/(β/ε)²`.
pub fn rho_c(beta: f64, eps: f64, knikklasse: Knikklasse, gelast: bool, soort: Deelsoort) -> f64 {
    let g = grenzen(knikklasse, gelast, soort);
    if beta <= g[2] * eps {
        return 1.0;
    }
    let [c1, c2] = constanten_rho_c(knikklasse, gelast, soort);
    let x = beta / eps;
    (c1 / x - c2 / (x * x)).min(1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tabel 6.2 en tabel 6.3 horen op `β = β₃` op elkaar aan te sluiten:
    /// `ρ_c(β₃) = 1`. Dat is een controle op beide tabellen tegelijk.
    #[test]
    fn rho_c_sluit_aan_op_de_klasse_3_grens() {
        for kk in [Knikklasse::A, Knikklasse::B] {
            for gelast in [false, true] {
                for soort in [Deelsoort::Uitstekend, Deelsoort::Inwendig] {
                    let b3 = grenzen(kk, gelast, soort)[2];
                    let [c1, c2] = constanten_rho_c(kk, gelast, soort);
                    let r = c1 / b3 - c2 / (b3 * b3);
                    assert!((r - 1.0).abs() < 1e-12, "{kk:?} {gelast} {soort:?}: {r}");
                }
            }
        }
    }

    #[test]
    fn eta_volgt_6_1_en_6_2() {
        assert!((eta_inwendig(1.0) - 1.0).abs() < 1e-12);
        assert!((eta_inwendig(-1.0) - 0.4).abs() < 1e-12);
        assert!((eta_inwendig(-3.0) - 0.2).abs() < 1e-12);
    }
}
