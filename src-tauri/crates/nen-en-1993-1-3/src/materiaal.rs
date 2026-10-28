//! Staalsoorten en materiaalconstanten — NEN-EN 1993-1-3 §3.1, §3.2.
//!
//! # Welke staalsoorten, en waarom alleen deze
//!
//! Tabel 3.1a noemt voor koudgevormde producten de nominale waarden van de
//! basisvloeigrens `f_yb` en de treksterkte `f_u`. Hier staan alleen de rijen
//! waarvan de waarden zeker zijn:
//!
//! - EN 10025-2 (warmgewalst basismateriaal): S235, S275, S355 — dezelfde
//!   `f_y`/`f_u` als EN 1993-1-1 tabel 3.1 voor `t ≤ 40 mm`;
//! - EN 10346 (continu dompelverzinkt bandstaal, voorheen EN 10326/10147):
//!   S220GD, S250GD, S280GD, S320GD en S350GD (+Z, +ZA, …: de deklaag verandert
//!   de sterkte niet).
//!
//! Niet opgenomen (liever geen waarde dan een onzekere): S550GD (tabel 3.1b,
//! met eigen beperkingen), de koudgewalste soorten van EN 10268 en EN 10149
//! (HX…, S…MC) en roestvast staal.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Elasticiteitsmodulus, §3.2.6 (verwijst naar EN 1993-1-1 §3.2.6).
pub const E_STAAL: f64 = 210_000.0;
/// Glijdingsmodulus, §3.2.6.
pub const G_STAAL: f64 = 81_000.0;
/// Dwarscontractiecoëfficiënt in het elastische gebied, §3.2.6.
pub const NU_STAAL: f64 = 0.3;

/// Partiële factor voor de doorsnedeweerstand, EN 1993-1-3 §2(3), aanbevolen waarde.
pub const GAMMA_M0: f64 = 1.0;
/// Partiële factor voor de stabiliteit van staven, §2(3), aanbevolen waarde.
pub const GAMMA_M1: f64 = 1.0;
/// Partiële factor voor de netto doorsnede (breuk), §2(3), aanbevolen waarde.
pub const GAMMA_M2: f64 = 1.25;

/// Toepassingsgebied van de rekenregels, §3.2.4(1): kerndikte van staven
/// `0,45 mm ≤ t_cor ≤ 15 mm`.
pub const T_COR_MIN: f64 = 0.45;
pub const T_COR_MAX: f64 = 15.0;

/// Eén rij uit tabel 3.1a.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/koudgevormd/")]
pub struct KvStaalsoort {
    /// Aanduiding zoals de app en de toetsinvoer haar gebruiken, bijv. `"S350GD"`.
    pub aanduiding: String,
    /// Productnorm, bijv. `"EN 10346"`.
    pub productnorm: String,
    /// Basisvloeigrens `f_yb` (N/mm²).
    pub f_yb: f64,
    /// Treksterkte `f_u` (N/mm²).
    pub f_u: f64,
    pub bron: String,
}

fn rij(aanduiding: &str, productnorm: &str, f_yb: f64, f_u: f64) -> KvStaalsoort {
    KvStaalsoort {
        aanduiding: aanduiding.into(),
        productnorm: productnorm.into(),
        f_yb,
        f_u,
        bron: "NEN-EN 1993-1-3 tabel 3.1a".into(),
    }
}

/// De ondersteunde rijen van tabel 3.1a.
pub fn staalsoorten() -> Vec<KvStaalsoort> {
    vec![
        rij("S235", "EN 10025-2", 235.0, 360.0),
        rij("S275", "EN 10025-2", 275.0, 430.0),
        rij("S355", "EN 10025-2", 355.0, 510.0),
        rij("S220GD", "EN 10346", 220.0, 300.0),
        rij("S250GD", "EN 10346", 250.0, 330.0),
        rij("S280GD", "EN 10346", 280.0, 360.0),
        rij("S320GD", "EN 10346", 320.0, 390.0),
        rij("S350GD", "EN 10346", 350.0, 420.0),
    ]
}

/// De aanduidingen, in de volgorde van [`staalsoorten`] (voor schema-enums).
pub fn staalsoort_namen() -> Vec<String> {
    staalsoorten().into_iter().map(|s| s.aanduiding).collect()
}

fn normaliseer(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace() && *c != '-' && *c != '_').collect::<String>().to_uppercase()
}

/// Zoek een staalsoort. Een deklaagaanduiding (`+Z`, `+ZA`, `+AZ`, …) wordt
/// genegeerd: "S350GD+Z" is S350GD.
pub fn zoek_staalsoort(naam: &str) -> Result<KvStaalsoort, String> {
    let kern = naam.split('+').next().unwrap_or("");
    let sleutel = normaliseer(kern);
    staalsoorten()
        .into_iter()
        .find(|s| normaliseer(&s.aanduiding) == sleutel)
        .ok_or_else(|| {
            format!(
                "staalsoort \"{naam}\" staat niet in de ondersteunde rijen van tabel 3.1a ({})",
                staalsoort_namen().join(", ")
            )
        })
}

/// `ε = √(235 / f_yb)` (EN 1993-1-5 tabel 4.1 met `f_y = f_yb`, §5.5.2(1)).
pub fn epsilon(f_yb: f64) -> f64 {
    (235.0 / f_yb).sqrt()
}

/// Gemiddelde vloeigrens door koudvervormen, §3.2.2(3), formule (3.1):
///
/// `f_ya = f_yb + (f_u − f_yb) · k n t² / A_g ≤ (f_u + f_yb) / 2`
///
/// met `k = 7` voor koudwalsen (rolvormen) en `k = 5` voor andere methoden,
/// `n` het aantal buigingen van 90° met `r ≤ 5t` in de doorsnede, `t` de
/// kerndikte en `A_g` de bruto oppervlakte. De toets gebruikt `k = 5` (veilige
/// ondergrens: de vormmethode is geen invoer).
pub fn f_ya(f_yb: f64, f_u: f64, k: f64, n: f64, t: f64, a_g: f64) -> f64 {
    let v = f_yb + (f_u - f_yb) * k * n * t * t / a_g;
    v.min(0.5 * (f_u + f_yb)).max(f_yb)
}
