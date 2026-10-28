//! Torsie volgens §6.1.8 en een apart benoemde interactie met dwarskracht.

use mechanics::ForceStateSnapshot;
use nen_en_1993_1_1_section::{CheckStatus, NamedValue, ResistanceCalc, UnityCheck};

use crate::{section::TimberSection, shear};

/// Saint-Venant-torsieweerstandsmoment van een massieve rechthoek (mm³).
/// De oneven Fourier-termen convergeren snel; 30 termen geven voor b = h
/// meer dan 12 significante cijfers.
pub fn w_tor_rect_mm3(b_mm: f64, h_mm: f64) -> f64 {
    let b = b_mm.min(h_mm);
    let h = b_mm.max(h_mm);
    if !(b > 0.0 && h > 0.0) { return 0.0; }
    let ratio = h / b;
    let mut sum_j = 0.0;
    let mut sum_k = 0.0;
    for i in 0..30 {
        let n = (2 * i + 1) as f64;
        let x = n * std::f64::consts::PI * ratio / 2.0;
        sum_j += x.tanh() / n.powi(5);
        // 1/cosh(x) tends to zero; avoid overflowing cosh for very thin strips.
        if x < 700.0 { sum_k += 1.0 / (n * n * x.cosh()); }
    }
    let pi = std::f64::consts::PI;
    let j = h * b.powi(3) / 3.0 * (1.0 - 192.0 * sum_j / (pi.powi(5) * ratio));
    let k = 1.0 - 8.0 * sum_k / pi.powi(2);
    j / (k * b)
}

/// Vormfactor (6.15) van een rechthoek, met h de grootste maat.
pub fn k_shape_rect(b_mm: f64, h_mm: f64) -> f64 {
    let b = b_mm.min(h_mm);
    let h = b_mm.max(h_mm);
    if b <= 0.0 { return 0.0; }
    (1.0 + 0.05 * h / b).min(1.3)
}

pub fn check_torsion(section: &TimberSection, f_vd_mpa: f64, state: ForceStateSnapshot) -> ResistanceCalc {
    let t = state.forces.mt_ed.abs();
    let known = section.rechthoekig;
    let w = if known { w_tor_rect_mm3(section.b_mm, section.h_mm) } else { 0.0 };
    let k = if known { k_shape_rect(section.b_mm, section.h_mm) } else { 0.0 };
    let tau = if w > 0.0 { t * 1e6 / w } else { 0.0 };
    let rd = k * f_vd_mpa;
    let uc = if rd > 0.0 { tau / rd } else { 0.0 };
    let status = if t < 1e-12 || !known { CheckStatus::NotApplicable }
        else if uc <= 1.0 { CheckStatus::Ok } else { CheckStatus::NotOk };
    let notes = if t < 1e-12 { vec!["Geen torsie op deze snede.".into()] }
        else if !known { vec!["Torsie is NIET getoetst: (6.15) geeft k_shape alleen voor een cirkel en een rechthoek; W_tor van deze eigen doorsnede ontbreekt.".into()] }
        else { vec!["W_tor volgens de Saint-Venant-reeks voor een rechthoek; k_shape volgens (6.15). De scheurfactor k_cr van (6.13a) geldt hier niet.".into()] };
    ResistanceCalc {
        deelstappen: vec![], id: "6.1.8_torsion".into(), title: "Torsie".into(),
        article: "art. 6.1.8 (6.14)(6.15)".into(), force_state: state,
        formula_latex: r"\tau_{tor,d}=\frac{|T_{Ed}|}{W_{tor}}\le k_{shape}f_{v,d}".into(),
        variables: vec![
            NamedValue { symbol: r"T_{Ed}".into(), value: t, unit: "kNm".into() },
            NamedValue { symbol: "W_{tor}".into(), value: w, unit: "mm³".into() },
            NamedValue { symbol: "k_{shape}".into(), value: k, unit: "-".into() },
            NamedValue { symbol: r"f_{v,d}".into(), value: f_vd_mpa, unit: "N/mm²".into() },
        ],
        value: tau, unit: "N/mm²".into(),
        uc: (t >= 1e-12 && known).then_some(UnityCheck { ed: tau, rd, uc, formula_latex: r"\tau_{tor,d}/(k_{shape}f_{v,d})".into() }),
        status, notes,
    }
}

/// Eigen, conservatieve aanvulling: de som van de maximale benuttingen uit
/// torsie en dwarskracht. De Eurocode en NB geven hiervoor geen interactie.
pub fn check_torsion_shear(section: &TimberSection, f_vd_mpa: f64, k_cr: f64, state: ForceStateSnapshot) -> ResistanceCalc {
    let torsion = check_torsion(section, f_vd_mpa, state);
    let shear_tau = shear::tau_resultant_rect_mpa(state.forces.vy_ed, state.forces.vz_ed, section, k_cr);
    let shear_uc = if f_vd_mpa > 0.0 { shear_tau / f_vd_mpa } else { 0.0 };
    let torsion_uc = torsion.uc.as_ref().map(|u| u.uc).unwrap_or(0.0);
    let uc = torsion_uc + shear_uc;
    let status = if torsion.uc.is_none() { CheckStatus::NotApplicable }
        else if uc <= 1.0 { CheckStatus::Ok } else { CheckStatus::NotOk };
    ResistanceCalc {
        deelstappen: vec![], id: "6.1.8_torsion_shear_extension".into(),
        title: "Torsie met dwarskracht (eigen aanvulling)".into(),
        article: "eigen aanvulling bij art. 6.1.7 en 6.1.8".into(), force_state: state,
        formula_latex: r"\frac{\tau_{tor,d}}{k_{shape}f_{v,d}}+\frac{\sqrt{\tau_{y,d}^2+\tau_{z,d}^2}}{f_{v,d}}\le1".into(),
        variables: vec![
            NamedValue { symbol: "UC_{tor}".into(), value: torsion_uc, unit: "-".into() },
            NamedValue { symbol: "UC_{shear}".into(), value: shear_uc, unit: "-".into() },
        ],
        value: uc, unit: "-".into(),
        uc: torsion.uc.map(|_| UnityCheck { ed: uc, rd: 1.0, uc, formula_latex: "eigen aanvulling".into() }),
        status,
        notes: vec!["Eigen aanvulling, geen normregel: som van de maxima van torsie- en dwarskrachtschuifspanning op dezelfde snede; een conservatieve bovengrens. k_shape staat alleen op de torsieterm.".into()],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use mechanics::InternalForces;

    #[test]
    fn rechthoekige_weerstand_en_vormfactor() {
        assert_relative_eq!(w_tor_rect_mm3(100.0, 100.0) / 100.0_f64.powi(3), 0.2082, max_relative = 3e-4);
        assert_relative_eq!(w_tor_rect_mm3(100.0, 200.0) / (200.0 * 100.0_f64.powi(2)), 0.2459, max_relative = 3e-4);
        assert_relative_eq!(k_shape_rect(100.0, 200.0), 1.1);
        assert_relative_eq!(k_shape_rect(100.0, 1000.0), 1.3);
    }

    #[test]
    fn torsie_en_dwarskracht_op_dezelfde_snede() {
        let section = TimberSection::rechthoek(100.0, 200.0);
        let state = ForceStateSnapshot { combination_id: 4, position_mm: 1200.0,
            forces: InternalForces { vy_ed: 10.0, vz_ed: 20.0, mt_ed: 1.0, ..Default::default() } };
        let t = check_torsion(&section, 4.0, state);
        let s = check_torsion_shear(&section, 4.0, 1.0, state);
        let expected_t = 1e6 / w_tor_rect_mm3(100.0, 200.0) / (1.1 * 4.0);
        let expected_s = 1.5 * 10.0_f64.hypot(20.0) * 1e3 / (100.0 * 200.0 * 4.0);
        assert_relative_eq!(t.uc.unwrap().uc, expected_t, max_relative = 1e-12);
        assert_relative_eq!(s.uc.unwrap().uc, expected_t + expected_s, max_relative = 1e-12);
    }
}
