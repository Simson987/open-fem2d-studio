//! NDP's bij **NEN-EN 1995-1-1** — houtconstructies.
//!
//! De Nederlandse rij komt uit NEN-EN 1995-1-1:2005+A2:2014+NB:2013.
//!
//! WAT HIER BEWUST NIET STAAT: k_mod (tabel 3.1) en k_def (tabel 3.2). Die
//! staan niet in de NDP-lijst van het voorwoord — ze zijn door de Eurocode zelf
//! vastgelegd en dus geen nationale keuze. Ze horen in
//! `nen_en_1995_1_1::factors` te blijven; hier zouden ze de indruk wekken dat
//! een ander land ze mag wijzigen.

use crate::NationaleBijlage;

/// De nationaal bepaalde parameters bij NEN-EN 1995-1-1.
#[derive(Clone, Copy, Debug)]
pub struct Ndp1995 {
    /// γ_M voor massief hout — tabel 2.3 bij 2.4.1. De Nederlandse tekst na
    /// OPMERKING 2 luidt "Er wordt geen verdere informatie gegeven": Nederland
    /// houdt de aanbevolen waarde aan. Ook dát is een nationale keuze, en
    /// daarom staat het getal hier en niet als losse constante in de normcrate.
    pub gamma_m_massief: f64,
    /// γ_M voor gelijmd gelamineerd hout — tabel 2.3.
    pub gamma_m_gelamineerd: f64,
    /// k_cr bij een prismatische doorsnede — NB bij 6.1.7. De aanbeveling van
    /// A1 (0,67) geldt in Nederland NIET; de nationale keuze is 1,0.
    pub k_cr_prismatisch: f64,
    /// k_cr bij een lijfdikte kleiner dan de helft van de flensbreedte — NB bij
    /// 6.1.7, OPMERKING 1. Daartussen mag lineair worden geïnterpoleerd.
    pub k_cr_dun_lijf: f64,
    /// De noemer van de eindzakkingsgrens w_fin ≤ L/n — 7.2(2) met de NB.
    pub noemer_w_fin: f64,
    /// De noemer van de grens voor de bijkomende zakking w_add ≤ L/n —
    /// 7.2(2) met de NB.
    pub noemer_w_add: f64,
}

impl Ndp1995 {
    /// De rij van deze bijlage. Uitputtende `match`.
    pub const fn voor(bijlage: NationaleBijlage) -> Self {
        match bijlage {
            NationaleBijlage::NL => NDP_1995_NL,
        }
    }
}

/// De Nederlandse rij — NEN-EN 1995-1-1:2005+A2:2014+NB:2013.
pub const NDP_1995_NL: Ndp1995 = Ndp1995 {
    gamma_m_massief: 1.30,
    gamma_m_gelamineerd: 1.25,
    k_cr_prismatisch: 1.0,
    k_cr_dun_lijf: 0.8,
    noemer_w_fin: 250.0,
    // NEN-EN 1990:2002/NB:2019 A1.4.3(3): w₂ + w₃ ≤ 3/1000·ℓ_rep voor
    // "overige vloeren" — EXACT 1000/3 (issue #236). Tot oktober 2026 333,
    // een grens die 0,1 % te ruim was.
    noemer_w_add: 1000.0 / 3.0,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nl_rij_volgens_de_nationale_bijlage() {
        let n = Ndp1995::voor(NationaleBijlage::NL);
        assert_eq!((n.gamma_m_massief, n.gamma_m_gelamineerd), (1.30, 1.25));
        assert_eq!((n.k_cr_prismatisch, n.k_cr_dun_lijf), (1.0, 0.8));
        assert_eq!((n.noemer_w_fin, n.noemer_w_add), (250.0, 1000.0 / 3.0));
        // Issue #236: 3/1000·L exact, L = 4000 → 12,000 mm (niet 12,012).
        assert!((4000.0 / n.noemer_w_add - 12.0).abs() < 1e-12);
    }
}
