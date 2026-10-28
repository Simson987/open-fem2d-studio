//! Geconcentreerde last (§6.1.3).

/// Spreidingshoek van een geconcentreerde last naar het midden van de wand:
/// 60° met de horizontaal (§6.1.3, figuur 6.2). Per zijde spreidt de last over
/// `(h_c/2) / tan 60°`.
pub fn spreiding_per_zijde_mm(h_c_mm: f64) -> f64 {
    0.5 * h_c_mm / 60f64.to_radians().tan()
}

/// De effectieve lengte `l_efm` op halve hoogte van de wand (figuur 6.2),
/// begrensd door de wandeinden. `a1` = afstand van het wandeinde tot de
/// dichtstbijzijnde rand van de oplegging, `l_b` = opleglengte, `l_wand` =
/// lengte van de wand. Alles in mm.
pub fn l_efm_mm(l_b: f64, a1: f64, l_wand: f64, h_c: f64) -> f64 {
    let s = spreiding_per_zijde_mm(h_c);
    let links = s.min(a1.max(0.0));
    let rechts = s.min((l_wand - a1 - l_b).max(0.0));
    l_b + links + rechts
}

/// Tussengrootheden van vgl. 6.10.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Beta {
    /// `A_b / A_ef`, voor de formule begrensd op 0,45.
    pub ab_aef: f64,
    /// De formulewaarde vóór begrenzing.
    pub beta_formule: f64,
    /// Bovengrens `min(1,25 + a1/(2 h_c); 1,5)`.
    pub beta_max: f64,
    /// De gebruikte β: tussen 1,0 en `beta_max`.
    pub beta: f64,
}

/// `β = (1 + 0,3 a1/h_c)(1,5 − 1,1 A_b/A_ef)` (vgl. 6.10), met
/// `1,0 ≤ β ≤ min(1,25 + a1/(2h_c); 1,5)` en `A_b/A_ef ≤ 0,45`.
/// Alleen voor steengroep 1 zonder hol-gemetselde lintvoegen (§6.1.3);
/// anders is β = 1 (§6.1.3) — die keuze maakt de aanroeper.
pub fn beta(a1_mm: f64, h_c_mm: f64, a_b: f64, a_ef: f64) -> Beta {
    let ab_aef = (a_b / a_ef).min(0.45);
    let beta_formule = (1.0 + 0.3 * a1_mm / h_c_mm) * (1.5 - 1.1 * ab_aef);
    let beta_max = (1.25 + a1_mm / (2.0 * h_c_mm)).min(1.5);
    Beta { ab_aef, beta_formule, beta_max, beta: beta_formule.clamp(1.0, beta_max) }
}
