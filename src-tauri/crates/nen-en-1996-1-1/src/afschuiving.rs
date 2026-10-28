//! Afschuiving in het vlak van de wand (§3.6.2, §6.2).

/// `f_vk` (§3.6.2): met gevulde stootvoegen `f_vk0 + 0,4 σ_d ≤ 0,065 f_b`,
/// met ongevulde stootvoegen `0,5 f_vk0 + 0,4 σ_d ≤ 0,045 f_b`.
/// Geeft `(f_vk, bovengrens, bovengrens actief)`.
pub fn f_vk(f_vk0: f64, sigma_d: f64, f_b: f64, stootvoeg_gevuld: bool) -> (f64, f64, bool) {
    let (basis, grens) = if stootvoeg_gevuld {
        (f_vk0 + 0.4 * sigma_d, 0.065 * f_b)
    } else {
        (0.5 * f_vk0 + 0.4 * sigma_d, 0.045 * f_b)
    };
    if basis > grens { (grens, grens, true) } else { (basis, grens, false) }
}

/// De lengte van het gedrukte deel van de wand `l_c` (§6.2(1)) bij een
/// lineaire spanningsverdeling zonder trek: met `e = |M|/N` is `l_c = l` als
/// `e ≤ l/6`, anders `l_c = 3 (l/2 − e)`; 0 als de resultante buiten de wand
/// valt of `N ≤ 0`. mm, N en N·mm.
pub fn l_c_mm(l_mm: f64, n_n: f64, m_nmm: f64) -> f64 {
    if n_n <= 0.0 {
        return 0.0;
    }
    let e = m_nmm.abs() / n_n;
    if e <= l_mm / 6.0 { l_mm } else { (3.0 * (l_mm / 2.0 - e)).max(0.0) }
}
