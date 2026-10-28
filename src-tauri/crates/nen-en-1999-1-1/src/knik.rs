//! Knik van staven op druk — NEN-EN 1999-1-1 §6.3.1.

use crate::materiaal::Knikklasse;
use std::f64::consts::PI;

/// Imperfectiefactor `α` en grens `λ̄₀` van tabel 6.6.
pub fn kromme(knikklasse: Knikklasse) -> (f64, f64) {
    match knikklasse {
        Knikklasse::A => (0.20, 0.10),
        Knikklasse::B => (0.32, 0.00),
    }
}

/// Eulerse knikkracht `N_cr = π² E I / L_cr²` (N, mm).
pub fn n_cr(e: f64, i: f64, l_cr: f64) -> f64 {
    PI * PI * e * i / (l_cr * l_cr)
}

/// Relatieve slankheid `λ̄ = √(A_eff f_o / N_cr)`, §6.3.1.2(1).
pub fn lambda(a_eff: f64, f_o: f64, n_cr: f64) -> f64 {
    (a_eff * f_o / n_cr).sqrt()
}

/// `φ = 0,5 [1 + α (λ̄ − λ̄₀) + λ̄²]` en
/// `χ = 1 / (φ + √(φ² − λ̄²))`, `χ ≤ 1`, §6.3.1.2(1).
pub fn chi(lambda: f64, knikklasse: Knikklasse) -> (f64, f64) {
    let (alpha, l0) = kromme(knikklasse);
    let phi = 0.5 * (1.0 + alpha * (lambda - l0) + lambda * lambda);
    let chi = 1.0 / (phi + (phi * phi - lambda * lambda).sqrt());
    (phi, chi.min(1.0))
}
