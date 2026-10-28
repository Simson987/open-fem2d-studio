//! Capaciteitsreductiefactor Φ voor slankheid en excentriciteit (§6.1.2.2,
//! bijlage G).

/// De excentriciteit boven of onder in de wand (§6.1.2.2 vgl. 6.5):
/// `e_i = |M_id| / N_id + e_he + e_init ≥ 0,05 t`. Alles in mm; `m_over_n`
/// is al `|M_id|/N_id` (inclusief het aandeel van horizontale belasting).
/// Geeft `(e_i, ondergrens actief)`.
pub fn e_i(m_over_n_mm: f64, e_init_mm: f64, t_mm: f64) -> (f64, bool) {
    let e = m_over_n_mm.abs() + e_init_mm;
    if e < 0.05 * t_mm { (0.05 * t_mm, true) } else { (e, false) }
}

/// `Φ_i = 1 − 2 e_i / t` (vgl. 6.4), niet kleiner dan 0.
pub fn phi_i(e_i_mm: f64, t_mm: f64) -> f64 {
    (1.0 - 2.0 * e_i_mm / t_mm).max(0.0)
}

/// De kruipexcentriciteit (vgl. 6.8): `e_k = 0,002 φ_∞ (h_ef/t_ef) √(t e_m)`.
pub fn e_k(phi_inf: f64, h_ef_mm: f64, t_ef_mm: f64, t_mm: f64, e_m_mm: f64) -> f64 {
    0.002 * phi_inf * (h_ef_mm / t_ef_mm) * (t_mm * e_m_mm.max(0.0)).sqrt()
}

/// Tussengrootheden van bijlage G.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PhiM {
    /// `A_1 = 1 − 2 e_mk / t` (G.2).
    pub a1: f64,
    /// `λ = (h_ef / t_ef) √(f_k / E)` (G.4).
    pub lambda: f64,
    /// `u = (λ − 0,063) / (0,73 − 1,17 e_mk / t)` (G.3).
    pub u: f64,
    /// `Φ_m = A_1 e^{−u²/2}` (G.1), niet kleiner dan 0.
    pub phi_m: f64,
}

/// Φ_m in het midden van de wand volgens bijlage G. `e_mk` is al op de
/// ondergrens 0,05 t gebracht (§6.1.2.2 vgl. 6.6).
pub fn phi_m(e_mk_mm: f64, t_mm: f64, h_ef_mm: f64, t_ef_mm: f64, f_k: f64, e_mod: f64) -> PhiM {
    let a1 = 1.0 - 2.0 * e_mk_mm / t_mm;
    let lambda = (h_ef_mm / t_ef_mm) * (f_k / e_mod).sqrt();
    let noemer = 0.73 - 1.17 * e_mk_mm / t_mm;
    if a1 <= 0.0 || noemer <= 0.0 {
        return PhiM { a1, lambda, u: f64::INFINITY, phi_m: 0.0 };
    }
    let u = (lambda - 0.063) / noemer;
    PhiM { a1, lambda, u, phi_m: (a1 * (-u * u / 2.0).exp()).max(0.0) }
}

/// Factor op `f_d` voor een kleine doorsnede (§6.1.2.1): bij een bruto
/// horizontale doorsnede `A < 0,1 m²` wordt `f_d` vermenigvuldigd met
/// `0,7 + 3A` (A in m²). Anders 1.
pub fn factor_kleine_doorsnede(a_m2: f64) -> f64 {
    if a_m2 < 0.1 { 0.7 + 3.0 * a_m2 } else { 1.0 }
}
