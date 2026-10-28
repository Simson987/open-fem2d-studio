//! Materiaal: de karakteristieke druksterkte van metselwerk (§3.6.1.2).
//!
//! `f_k = K · f_b^α · f_m^β` (vgl. 3.1). De exponenten liggen in de normtekst
//! vast (geen NDP); de constante `K` is een NDP (tabel 3.3) en komt daarom als
//! invoer met bron.
//!
//! | mortel | steen | α | β |
//! |---|---|---|---|
//! | algemene mortel | alle soorten | 0,7 | 0,3 |
//! | lijmmortel (lintvoeg 0,5–3 mm) | baksteen groep 1 en 4, kalkzandsteen, betonsteen, cellenbeton | 0,85 | 0 |
//! | lijmmortel | baksteen groep 2 en 3 | 0,7 | 0 |
//!
//! (Vergelijkingsnummers verschillen tussen de uitgave 2005 en A1:2012; de
//! verwijzingen hieronder noemen daarom het artikel, niet het nummer.)
//!
//! Lichte mortel, lijmmortel met kunststeen of natuursteen, en hol-gemetselde
//! lintvoegen (shell bedding) zitten niet in deze eerste versie: daar geeft
//! [`exponenten`] een reden terug in plaats van getallen.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Soort metselsteen (EN 771-1 t/m 771-6).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/metselwerk/")]
pub enum Steensoort {
    /// Baksteen (EN 771-1).
    Baksteen,
    /// Kalkzandsteen (EN 771-2).
    Kalkzandsteen,
    /// Betonsteen met grind/granulaat (EN 771-3).
    Betonsteen,
    /// Cellenbeton (EN 771-4).
    Cellenbeton,
    /// Kunststeen (EN 771-5).
    Kunststeen,
    /// Natuursteen (EN 771-6).
    Natuursteen,
}

/// Steengroep volgens tabel 3.1 (holtepercentage en wanddikten).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/metselwerk/")]
pub enum Steengroep {
    Groep1,
    Groep2,
    Groep3,
    Groep4,
}

/// Mortelsoort (§3.2.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/metselwerk/")]
pub enum Mortelsoort {
    /// Mortel voor algemene toepassing (general purpose mortar).
    Algemeen,
    /// Lijmmortel (thin layer mortar), lintvoeg 0,5 tot 3 mm.
    Lijm,
    /// Lichte mortel (lightweight mortar) — niet in deze eerste versie.
    Licht,
}

/// De exponenten α en β van vergelijking (3.1) met hun vergelijkingsnummer,
/// of de reden waarom de combinatie niet wordt ondersteund.
pub fn exponenten(soort: Steensoort, groep: Steengroep, mortel: Mortelsoort) -> Result<(f64, f64, &'static str), String> {
    use Steengroep::*;
    use Steensoort::*;
    match mortel {
        Mortelsoort::Algemeen => Ok((0.7, 0.3, "§3.6.1.2, algemene mortel")),
        Mortelsoort::Lijm => match (soort, groep) {
            (Baksteen, Groep1 | Groep4) | (Kalkzandsteen | Betonsteen | Cellenbeton, _) => {
                Ok((0.85, 0.0, "§3.6.1.2, lijmmortel"))
            }
            (Baksteen, Groep2 | Groep3) => Ok((0.7, 0.0, "§3.6.1.2, lijmmortel, baksteen groep 2/3")),
            (Kunststeen | Natuursteen, _) => Err(
                "lijmmortel met kunststeen of natuursteen valt buiten de lijmmortelgevallen van §3.6.1.2; \
                 niet getoetst"
                    .into(),
            ),
        },
        Mortelsoort::Licht => Err(
            "lichte mortel wordt in deze eerste versie niet ondersteund (§3.6.1.2); niet getoetst".into(),
        ),
    }
}

/// Bovengrenzen voor de invoer van vergelijking (3.1), §3.6.1.2(1):
/// `f_b ≤ 75 N/mm²` bij algemene mortel en `≤ 50 N/mm²` bij lijmmortel;
/// `f_m ≤ 20 N/mm²` en `f_m ≤ 2 f_b`. Een grotere waarde wordt afgekapt
/// (f_k neemt toe met f_b en f_m, dus afkappen is veilig); de tweede waarde
/// van het paar is de toelichting, leeg als er niets is afgekapt.
pub fn begrensde_sterkten(mortel: Mortelsoort, f_b: f64, f_m: f64) -> (f64, f64, Vec<String>) {
    let mut notes = Vec::new();
    let fb_max = if mortel == Mortelsoort::Lijm { 50.0 } else { 75.0 };
    let fb = if f_b > fb_max {
        notes.push(format!(
            "f_b = {f_b} N/mm² is afgekapt op {fb_max} N/mm² (§3.6.1.2(1): bovengrens voor f_k = K f_b^α f_m^β)"
        ));
        fb_max
    } else {
        f_b
    };
    let fm_max = 20.0_f64.min(2.0 * fb);
    let fm = if mortel == Mortelsoort::Algemeen && f_m > fm_max {
        notes.push(format!(
            "f_m = {f_m} N/mm² is afgekapt op min(20; 2·f_b) = {fm_max} N/mm² (§3.6.1.2(1))"
        ));
        fm_max
    } else {
        f_m
    };
    (fb, fm, notes)
}

/// `f_k = K · f_b^α · f_m^β` (vgl. 3.1), N/mm². `k` is de al eventueel met
/// 0,8 verminderde constante (langsvoeg, §3.6.1.2).
pub fn f_k(k: f64, f_b: f64, f_m: f64, alpha: f64, beta: f64) -> f64 {
    let fm_term = if beta == 0.0 { 1.0 } else { f_m.powf(beta) };
    k * f_b.powf(alpha) * fm_term
}

/// Factor op `K` bij een langsvoeg (een mortelvoeg evenwijdig aan het
/// wandvlak over (een deel van) de wandlengte): 0,8 (§3.6.1.2).
pub const FACTOR_LANGSVOEG: f64 = 0.8;
