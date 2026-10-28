//! Legeringen en materiaalconstanten — NEN-EN 1999-1-1 §3.2.
//!
//! # Welke legeringen, en waarom alleen deze
//!
//! Alleen de vier 6xxx-legeringen in toestand T6 die als EXTRUSIEPROFIEL
//! (productvorm EP, ET, ER/B) het meest gebruikt worden, uit tabel 3.2b. De
//! sterkten zijn karakteristieke waarden (0,2 %-rekgrens `f_o`, treksterkte
//! `f_u`) en de sterkten in de warmte-beïnvloede zone (`f_o,haz`, `f_u,haz`)
//! met de bijbehorende reductiefactoren `ρ_o,haz = f_o,haz / f_o` en
//! `ρ_u,haz = f_u,haz / f_u`.
//!
//! Elke rij is intern controleerbaar: de tabel geeft ρ in twee decimalen en
//! dat moet gelijk zijn aan het quotiënt van de twee sterkten, afgerond. De
//! test `rho_haz_is_het_quotient_van_de_sterkten` bewaakt dat. Dat bewijst
//! geen juistheid van de sterkten zelf; die zijn overgenomen uit tabel 3.2b
//! (EN 1999-1-1:2007+A1:2009) en horen bij een normcontrole tegen de
//! normtekst te worden nagelopen. EN AW-6063 T6 (`f_o = 160`) en
//! EN AW-6082 T6, 5 < t ≤ 15 (`ρ_o,haz = 0,48`) komen overeen met de
//! uitgewerkte voorbeelden 1 en 3 van European Aluminium, *Introduction to
//! Eurocode 9*.
//!
//! Legeringen buiten deze lijst (5xxx, 7xxx, andere toestanden, platen en
//! plaatmateriaal uit tabel 3.2a) zijn bewust niet opgenomen: liever geen
//! waarde dan een onzekere.
//!
//! # HAZ-waarden
//!
//! De HAZ-sterkten van tabel 3.2b gelden voor MIG-lassen. Voor TIG-lassen en
//! voor dikkere platen geeft §6.1.6.2 een verdere verlaging; die is hier NIET
//! verwerkt en wordt in de toets als aanname gemeld.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Elasticiteitsmodulus, §3.2.5(1): `E = 70 000 N/mm²`.
pub const E_ALU: f64 = 70_000.0;
/// Glijdingsmodulus, §3.2.5(1): `G = 27 000 N/mm²`.
pub const G_ALU: f64 = 27_000.0;
/// Dwarscontractiecoëfficiënt, §3.2.5(1): `ν = 0,3`.
pub const NU_ALU: f64 = 0.3;
/// Volumieke massa, §3.2.5(1): `ρ = 2 700 kg/m³`.
pub const RHO_ALU: f64 = 2_700.0;

/// Partiële factor voor de weerstand van doorsneden en staven (vloeien,
/// lokale plooi, knik), tabel 6.1, aanbevolen waarde.
pub const GAMMA_M1: f64 = 1.10;
/// Partiële factor voor de weerstand van doorsneden in trek tot breuk,
/// tabel 6.1, aanbevolen waarde.
pub const GAMMA_M2: f64 = 1.25;

/// Knikklasse van de legering (tabel 3.2b, kolom "BC"): bepaalt de grenzen van
/// tabel 6.2, de constanten van tabel 6.3 en de knikkromme van tabel 6.6.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/aluminium/")]
pub enum Knikklasse {
    A,
    B,
}

/// Eén rij uit tabel 3.2b.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/aluminium/")]
pub struct AluminiumLegering {
    /// Aanduiding zoals de app en de toetsinvoer haar gebruiken, bijv.
    /// `"EN AW-6082 T6"`.
    pub aanduiding: String,
    /// Productvorm volgens tabel 3.2b, bijv. `"EP/O, EP/H"`.
    pub productvorm: String,
    /// Dikte-bereik waarvoor de rij geldt: `t_min < t ≤ t_max` (mm).
    pub t_min_mm: f64,
    pub t_max_mm: f64,
    /// 0,2 %-rekgrens `f_o` (N/mm²).
    pub f_o: f64,
    /// Treksterkte `f_u` (N/mm²).
    pub f_u: f64,
    /// HAZ-rekgrens `f_o,haz` (N/mm²).
    pub f_o_haz: f64,
    /// HAZ-treksterkte `f_u,haz` (N/mm²).
    pub f_u_haz: f64,
    /// `ρ_o,haz` zoals in de tabel (twee decimalen).
    pub rho_o_haz: f64,
    /// `ρ_u,haz` zoals in de tabel (twee decimalen).
    pub rho_u_haz: f64,
    pub knikklasse: Knikklasse,
    /// Vindplaats.
    pub bron: String,
}

#[allow(clippy::too_many_arguments)]
fn rij(
    aanduiding: &str,
    productvorm: &str,
    t_min_mm: f64,
    t_max_mm: f64,
    f_o: f64,
    f_u: f64,
    f_o_haz: f64,
    f_u_haz: f64,
    rho_o_haz: f64,
    rho_u_haz: f64,
) -> AluminiumLegering {
    AluminiumLegering {
        aanduiding: aanduiding.to_string(),
        productvorm: productvorm.to_string(),
        t_min_mm,
        t_max_mm,
        f_o,
        f_u,
        f_o_haz,
        f_u_haz,
        rho_o_haz,
        rho_u_haz,
        // Alle 6xxx-legeringen in T6 hebben knikklasse A (tabel 3.2b).
        knikklasse: Knikklasse::A,
        bron: "NEN-EN 1999-1-1 tabel 3.2b (extrusieprofielen)".to_string(),
    }
}

/// De ondersteunde legeringen, per dikte-bereik. Een legering kan meer dan
/// één rij hebben (EN AW-6082 T6: t ≤ 5 en 5 < t ≤ 15).
pub fn legeringen() -> Vec<AluminiumLegering> {
    vec![
        rij("EN AW-6060 T6", "EP, ET, ER/B", 0.0, 15.0, 140.0, 170.0, 60.0, 100.0, 0.43, 0.59),
        rij("EN AW-6061 T6", "EP, ET, ER/B", 0.0, 20.0, 240.0, 260.0, 115.0, 175.0, 0.48, 0.67),
        rij("EN AW-6063 T6", "EP, ET, ER/B", 0.0, 25.0, 160.0, 195.0, 65.0, 110.0, 0.41, 0.56),
        rij("EN AW-6082 T6", "EP/O, EP/H", 0.0, 5.0, 250.0, 290.0, 125.0, 185.0, 0.50, 0.64),
        rij("EN AW-6082 T6", "EP/O, EP/H", 5.0, 15.0, 260.0, 310.0, 125.0, 185.0, 0.48, 0.60),
    ]
}

/// De unieke aanduidingen, in tabelvolgorde — voor een keuzelijst.
pub fn legering_namen() -> Vec<String> {
    let mut uit: Vec<String> = Vec::new();
    for l in legeringen() {
        if !uit.contains(&l.aanduiding) {
            uit.push(l.aanduiding);
        }
    }
    uit
}

/// Maak een aanduiding vergelijkbaar: hoofdletters, zonder spaties, koppel-
/// en liggende streepjes. "en aw 6082-t6" en "EN AW-6082 T6" zijn dan gelijk.
fn normaliseer(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '_')
        .flat_map(|c| c.to_uppercase())
        .collect()
}

/// Zoek de rij van tabel 3.2b voor deze legering en de grootste plaatdikte van
/// de doorsnede. De sterkte hangt van de dikte af; een dikte buiten elk
/// bereik geeft een fout — er wordt dan niet geëxtrapoleerd.
pub fn zoek_legering(aanduiding: &str, t_max_mm: f64) -> Result<AluminiumLegering, String> {
    let sleutel = normaliseer(aanduiding);
    let rijen: Vec<AluminiumLegering> = legeringen()
        .into_iter()
        .filter(|l| normaliseer(&l.aanduiding) == sleutel)
        .collect();
    if rijen.is_empty() {
        return Err(format!(
            "legering \"{aanduiding}\" staat niet in de tabel; ondersteund: {}",
            legering_namen().join(", ")
        ));
    }
    if !(t_max_mm.is_finite() && t_max_mm > 0.0) {
        return Err(format!("ongeldige plaatdikte {t_max_mm} mm"));
    }
    rijen
        .iter()
        .find(|l| t_max_mm > l.t_min_mm && t_max_mm <= l.t_max_mm)
        .cloned()
        .ok_or_else(|| {
            let max = rijen.iter().map(|l| l.t_max_mm).fold(0.0, f64::max);
            format!(
                "plaatdikte {t_max_mm} mm valt buiten het bereik van tabel 3.2b voor {} (t ≤ {max} mm)",
                rijen[0].aanduiding
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rho_haz_is_het_quotient_van_de_sterkten() {
        for l in legeringen() {
            let ro = (l.f_o_haz / l.f_o * 100.0).round() / 100.0;
            let ru = (l.f_u_haz / l.f_u * 100.0).round() / 100.0;
            assert_eq!(ro, l.rho_o_haz, "{} ρ_o,haz", l.aanduiding);
            assert_eq!(ru, l.rho_u_haz, "{} ρ_u,haz", l.aanduiding);
            assert!(l.f_u > l.f_o && l.f_u_haz > l.f_o_haz);
        }
    }

    #[test]
    fn dikte_kiest_de_rij_en_buiten_bereik_is_een_fout() {
        assert_eq!(zoek_legering("EN AW-6082 T6", 4.0).unwrap().f_o, 250.0);
        assert_eq!(zoek_legering("en aw 6082-t6", 5.0).unwrap().f_o, 250.0);
        assert_eq!(zoek_legering("EN AW-6082 T6", 5.01).unwrap().f_o, 260.0);
        assert!(zoek_legering("EN AW-6082 T6", 16.0).is_err());
        assert!(zoek_legering("EN AW-7020 T6", 4.0).is_err());
        assert_eq!(legering_namen().len(), 4);
    }
}
