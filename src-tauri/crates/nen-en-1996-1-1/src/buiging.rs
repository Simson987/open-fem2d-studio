//! Buiging uit het vlak (§6.3.1).

/// `M_Rd = f_xd · Z` (vgl. 6.15) per meter wand, kNm/m, met
/// `Z = 1000 · t² / 6` mm³/m (elastisch weerstandsmoment van een strook van
/// 1 m) en `f_xd` in N/mm².
pub fn m_rd_knm_per_m(f_xd: f64, t_mm: f64) -> f64 {
    f_xd * 1000.0 * t_mm * t_mm / 6.0 / 1.0e6
}
