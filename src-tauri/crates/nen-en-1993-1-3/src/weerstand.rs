//! Doorsnedeweerstand (§6.1) en knik (§6.2) — losse formules. Krachten in N,
//! momenten in N·mm, spanningen in N/mm², lengten in mm.

use crate::materiaal::{E_STAAL, G_STAAL, GAMMA_M0, GAMMA_M1};
use std::f64::consts::PI;

/// Trek, §6.1.2(1): `N_t,Rd = f_ya A_g / γ_M0` (begrensd door `F_n,Rd` van de
/// netto doorsnede bij verbindingen, §8.4 — niet in deze functie).
pub fn n_t_rd(f_ya: f64, a_g: f64) -> f64 {
    f_ya * a_g / GAMMA_M0
}

/// Druk, §6.1.3(1): `N_c,Rd = A_eff f_yb / γ_M0`. Bij `A_eff = A_g` staat (6.2)
/// een verhoging naar `f_ya` toe; die wordt niet benut (veilig).
pub fn n_c_rd(a_eff: f64, f_yb: f64) -> f64 {
    a_eff * f_yb / GAMMA_M0
}

/// Buiging, §6.1.4.1(1): `M_c,Rd = W_eff f_yb / γ_M0`. Bij `W_eff = W_el` staat
/// (6.4) plastische reserve toe; die wordt niet benut (veilig).
pub fn m_c_rd(w_eff: f64, f_yb: f64) -> f64 {
    w_eff * f_yb / GAMMA_M0
}

/// Relatieve lijfslankheid voor afschuiving, §6.1.5(3), (6.10a) (lijf zonder
/// langsverstijvers): `λ̄_w = 0,346 (s_w/t) √(f_yb/E)`.
pub fn lambda_w(s_w: f64, t: f64, f_yb: f64) -> f64 {
    0.346 * s_w / t * (f_yb / E_STAAL).sqrt()
}

/// Afschuifplooisterkte `f_bv`, tabel 6.1, kolom "lijf zonder verstijving bij
/// de oplegging" (de veilige kolom; de oplegging is geen invoer):
/// `0,58 f_yb` voor `λ̄_w ≤ 0,83`, `0,48 f_yb/λ̄_w` tot 1,40, daarboven `0,67 f_yb/λ̄_w²`.
pub fn f_bv(lambda_w: f64, f_yb: f64) -> f64 {
    if lambda_w <= 0.83 {
        0.58 * f_yb
    } else if lambda_w < 1.40 {
        0.48 * f_yb / lambda_w
    } else {
        0.67 * f_yb / (lambda_w * lambda_w)
    }
}

/// Dwarskracht, §6.1.5(1), (6.8): `V_b,Rd = (h_w / sin φ) t f_bv / γ_M0` met
/// `φ = 90°`.
pub fn v_b_rd(h_w: f64, t: f64, f_bv: f64) -> f64 {
    h_w * t * f_bv / GAMMA_M0
}

/// Imperfectiefactor van knikkromme c (EN 1993-1-1 tabel 6.1).
pub const ALPHA_C: f64 = 0.49;

/// `(φ, χ)` volgens EN 1993-1-1 §6.3.1.2 (verwezen vanuit §6.2.2(2)).
pub fn chi(lambda: f64, alpha: f64) -> (f64, f64) {
    let phi = 0.5 * (1.0 + alpha * (lambda - 0.2) + lambda * lambda);
    if lambda <= 0.2 {
        return (phi, 1.0);
    }
    (phi, (1.0 / (phi + (phi * phi - lambda * lambda).sqrt())).min(1.0))
}

/// Eulerse knikkracht `π² E I / L²`.
pub fn n_cr(i: f64, l: f64) -> f64 {
    PI * PI * E_STAAL * i / (l * l)
}

/// Torsieknik, §6.2.3(5), (6.33a): `N_cr,T = (G I_t + π² E I_w / l_T²) / i_0²`.
pub fn n_cr_t(i_t: f64, i_w: f64, l_t: f64, i0_kw: f64) -> f64 {
    (G_STAAL * i_t + PI * PI * E_STAAL * i_w / (l_t * l_t)) / i0_kw
}

/// Buigtorsieknik van een om de y-as symmetrische doorsnede, §6.2.3(6), (6.35):
/// `N_cr,TF = N_cr,y/(2β) [1 + N_cr,T/N_cr,y − √((1 − N_cr,T/N_cr,y)² + 4 (y_0/i_0)² N_cr,T/N_cr,y)]`
/// met `β = 1 − (y_0/i_0)²`.
pub fn n_cr_tf(n_cr_y: f64, n_cr_t: f64, y0: f64, i0_kw: f64) -> f64 {
    let a = y0 * y0 / i0_kw;
    let beta = 1.0 - a;
    let r = n_cr_t / n_cr_y;
    n_cr_y / (2.0 * beta) * (1.0 + r - ((1.0 - r).powi(2) + 4.0 * a * r).sqrt())
}

/// Knikweerstand, §6.2.2(1): `N_b,Rd = χ A_eff f_yb / γ_M1`.
pub fn n_b_rd(chi: f64, a_eff: f64, f_yb: f64) -> f64 {
    chi * a_eff * f_yb / GAMMA_M1
}
