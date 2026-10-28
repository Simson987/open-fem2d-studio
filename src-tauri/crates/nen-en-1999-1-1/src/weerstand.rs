//! Doorsnedeweerstanden — NEN-EN 1999-1-1 §6.2. Eenheden N en mm.
//!
//! Alleen de formules; welke oppervlakken en weerstandsmomenten (bruto, met
//! lokale plooi, met HAZ) erin gaan, bepaalt de aanroeper en legt hij vast in
//! zijn afleiding.

use crate::materiaal::{GAMMA_M1, GAMMA_M2};

/// Trek, §6.2.3(2): algemeen vloeien `N_o,Rd = A_g f_o / γ_M1`.
pub fn n_o_rd(a_g: f64, f_o: f64) -> f64 {
    a_g * f_o / GAMMA_M1
}

/// Trek, §6.2.3(2): breuk van de netto doorsnede `N_u,Rd = 0,9 A_net f_u / γ_M2`.
pub fn n_u_rd(a_net: f64, f_u: f64) -> f64 {
    0.9 * a_net * f_u / GAMMA_M2
}

/// Druk, §6.2.4(2): `N_c,Rd = A_eff f_o / γ_M1`.
pub fn n_c_rd(a_eff: f64, f_o: f64) -> f64 {
    a_eff * f_o / GAMMA_M1
}

/// Buiging, §6.2.5.1: `M_o,Rd = α W_el f_o / γ_M1` (hier met `α·W_el` als
/// één weerstandsmoment ingevuld).
pub fn m_o_rd(alpha_w: f64, f_o: f64) -> f64 {
    alpha_w * f_o / GAMMA_M1
}

/// Buiging, §6.2.5.1: `M_u,Rd = W_net f_u / γ_M2`.
pub fn m_u_rd(w_net: f64, f_u: f64) -> f64 {
    w_net * f_u / GAMMA_M2
}

/// Dwarskracht, §6.2.6(1), niet-slank lijf: `V_Rd = A_v f_o / (√3 γ_M1)`.
pub fn v_rd(a_v: f64, f_o: f64) -> f64 {
    a_v * f_o / (3f64.sqrt() * GAMMA_M1)
}

/// Grens voor een niet-slank lijf, §6.2.6(1): `h_w / t_w ≤ 39 ε`.
pub const LIJF_SLANK_GRENS: f64 = 39.0;

/// Reductie van `f_o` in het afschuifoppervlak bij grote dwarskracht, §6.2.8:
/// voor `V_Ed > 0,5 V_Rd` wordt `f_o` daar `f_o (1 − ρ_V)` met
/// `ρ_V = (2 V_Ed / V_Rd − 1)²`; anders 0.
pub fn rho_v(v_ed: f64, v_rd: f64) -> f64 {
    if v_rd <= 0.0 {
        return 1.0;
    }
    let r = v_ed.abs() / v_rd;
    if r <= 0.5 {
        0.0
    } else {
        ((2.0 * r - 1.0).powi(2)).min(1.0)
    }
}
