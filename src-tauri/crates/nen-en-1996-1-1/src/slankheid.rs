//! Effectieve hoogte en slankheid (§5.5.1).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Hoe de wand langs zijn randen is gesteund (§5.5.1.2).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/metselwerk/")]
#[serde(tag = "soort")]
#[serde(deny_unknown_fields)]
pub enum Steunranden {
    /// Alleen boven en onder gesteund (ρ_2).
    BovenOnder,
    /// Boven en onder, en langs één verticale rand verstijfd; de andere rand
    /// is vrij (ρ_3). `l_m` = afstand van de vrije rand tot het hart van de
    /// verstijvende wand.
    EenVerticaleRand { l_m: f64 },
    /// Boven en onder, en langs beide verticale randen verstijfd (ρ_4).
    /// `l_m` = afstand tussen de harten van de verstijvende wanden.
    TweeVerticaleRanden { l_m: f64 },
}

/// De uitkomst van §5.5.1.2.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/metselwerk/")]
pub struct EffectieveHoogte {
    /// ρ_2 (0,75 of 1,0) waarmee ρ_3/ρ_4 is bepaald.
    pub rho_2: f64,
    /// De gebruikte ρ_n.
    pub rho_n: f64,
    /// "rho_2", "rho_3" of "rho_4".
    pub geval: String,
    pub h_ef_mm: f64,
    pub notes: Vec<String>,
}

/// ρ_2 (§5.5.1.2): 0,75 als de wand boven en onder door betonvloeren of
/// -daken wordt gesteund (van twee kanten op dezelfde hoogte, of van één kant
/// met een oplegging van minstens 2/3 t) — maar 1,0 als de excentriciteit
/// van de belasting bovenin groter is dan 0,25 t. In alle andere gevallen
/// (houten vloeren, geen opgave) 1,0.
pub fn rho_2(betonvloeren: bool, e_boven_mm: Option<f64>, t_mm: f64) -> (f64, Vec<String>) {
    if !betonvloeren {
        return (1.0, vec!["ρ_2 = 1,0: geen gewapend-betonvloeren boven en onder opgegeven (§5.5.1.2)".into()]);
    }
    match e_boven_mm {
        Some(e) if e > 0.25 * t_mm => (
            1.0,
            vec![format!(
                "ρ_2 = 1,0: excentriciteit bovenin {e:.1} mm > 0,25·t = {:.1} mm (§5.5.1.2)",
                0.25 * t_mm
            )],
        ),
        Some(_) => (0.75, vec!["ρ_2 = 0,75: betonvloeren boven en onder, e bovenin ≤ 0,25·t (§5.5.1.2)".into()]),
        None => (
            1.0,
            vec!["ρ_2 = 1,0: de excentriciteit bovenin is niet bekend, dus 0,75 is niet aantoonbaar (§5.5.1.2)".into()],
        ),
    }
}

/// ρ_3 (§5.5.1.2): `h ≤ 3,5 l`: ρ_2 / (1 + (ρ_2 h / 3l)²); anders 1,5 l / h.
pub fn rho_3(rho_2: f64, h: f64, l: f64) -> f64 {
    if h <= 3.5 * l {
        rho_2 / (1.0 + (rho_2 * h / (3.0 * l)).powi(2))
    } else {
        1.5 * l / h
    }
}

/// ρ_4 (§5.5.1.2): `h ≤ 1,15 l`: ρ_2 / (1 + (ρ_2 h / l)²); anders 0,5 l / h.
pub fn rho_4(rho_2: f64, h: f64, l: f64) -> f64 {
    if h <= 1.15 * l {
        rho_2 / (1.0 + (rho_2 * h / l).powi(2))
    } else {
        0.5 * l / h
    }
}

/// `h_ef = ρ_n · h` (vgl. 5.2) met de juiste ρ_n.
///
/// Een verticale rand telt niet mee als `l ≥ 15 t` (één rand) of `l ≥ 30 t`
/// (twee randen): dan geldt de wand als alleen boven en onder gesteund
/// (§5.5.1.2). Dat ρ_2 dan wordt aangehouden is ook veilig, want ρ_3, ρ_4 ≤ ρ_2.
pub fn effectieve_hoogte(randen: Steunranden, rho_2: f64, h_mm: f64, t_mm: f64) -> EffectieveHoogte {
    let mut notes = Vec::new();
    let (rho_n, geval) = match randen {
        Steunranden::BovenOnder => (rho_2, "rho_2"),
        Steunranden::EenVerticaleRand { l_m } => {
            let l = l_m * 1000.0;
            if l >= 15.0 * t_mm {
                notes.push(format!("l = {l:.0} mm ≥ 15·t: de verticale rand telt niet mee, ρ_2 aangehouden (§5.5.1.2)"));
                (rho_2, "rho_2")
            } else {
                (rho_3(rho_2, h_mm, l), "rho_3")
            }
        }
        Steunranden::TweeVerticaleRanden { l_m } => {
            let l = l_m * 1000.0;
            if l >= 30.0 * t_mm {
                notes.push(format!("l = {l:.0} mm ≥ 30·t: de verticale randen tellen niet mee, ρ_2 aangehouden (§5.5.1.2)"));
                (rho_2, "rho_2")
            } else {
                (rho_4(rho_2, h_mm, l), "rho_4")
            }
        }
    };
    if geval != "rho_2" {
        notes.push(
            "Aangenomen dat de verstijvende wanden aan §5.5.1.2 voldoen en dat de wand geen openingen of \
             sleuven heeft die de verticale steun opheffen; dat wordt niet gecontroleerd."
                .into(),
        );
    }
    EffectieveHoogte { rho_2, rho_n, geval: geval.into(), h_ef_mm: rho_n * h_mm, notes }
}

/// De initiële excentriciteit `e_init = h_ef / 450` (§5.5.1.1).
pub fn e_init(h_ef_mm: f64) -> f64 {
    h_ef_mm / 450.0
}

/// De grootste slankheid `h_ef / t_ef` (§5.5.1.4).
pub const SLANKHEID_MAX: f64 = 27.0;
