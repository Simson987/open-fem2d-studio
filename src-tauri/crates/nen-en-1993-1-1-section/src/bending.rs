//! NEN-EN 1993-1-1 §6.2.5 — bending resistance.

use crate::classification::CrossSectionClass;
use crate::{CheckStatus, NamedValue, ResistanceCalc, SteelGrade, UnityCheck};
use mechanics::ForceStateSnapshot;
use section_properties::SectionProperties;

pub fn m_y_c_rd(
    p: &SectionProperties,
    grade: &SteelGrade,
    class: CrossSectionClass,
    force_state: ForceStateSnapshot,
) -> ResistanceCalc {
    // Issue #243 (punt 077): het label volgt de klasse. (6.13) M_pl,Rd voor
    // klasse 1 en 2, (6.14) M_el,Rd voor klasse 3, (6.15) met W_eff,min voor
    // klasse 4 (daar geeft de norm geen eigen naam, dus geen tussenterm). Voor
    // klasse 3 stond hier "M_pl,y,Rd = W_el,y·f_y/γ_M0": een plastisch label
    // bij een elastische weerstand.
    let (w_used, w_symbol, w_unit, m_term, vergelijking) = match class {
        CrossSectionClass::Class1 | CrossSectionClass::Class2 => {
            (p.wpl_y_mm3, r"W_{pl,y}", "mm³", r"M_{pl,y,Rd} = ", "(6.13)")
        }
        CrossSectionClass::Class3 => (p.wel_y_mm3, r"W_{el,y}", "mm³", r"M_{el,y,Rd} = ", "(6.14)"),
        CrossSectionClass::Class4 => (p.wel_y_mm3, r"W_{eff,y}", "mm³", "", "(6.15)"),
    };
    let m_c_rd_knm = w_used * grade.fy_mpa / grade.gamma_m0 * 1e-6;
    let m_ed_abs = force_state.forces.my_ed.abs();
    let uc = if m_c_rd_knm > 0.0 {
        m_ed_abs / m_c_rd_knm
    } else {
        0.0
    };
    let status = if uc <= 1.0 {
        CheckStatus::Ok
    } else {
        CheckStatus::NotOk
    };

    let title = if matches!(class, CrossSectionClass::Class1 | CrossSectionClass::Class2) {
        "Buigend moment (maatgevend)"
    } else {
        "Buigend moment"
    };

    ResistanceCalc {
        deelstappen: Vec::new(),
        id: "6.2.5_bending_y".to_string(),
        title: title.to_string(),
        article: format!("art. 6.2.5 {vergelijking}"),
        force_state,
        formula_latex: format!(
            r"M_{{y,c,Rd}} = {}\frac{{{} \cdot f_y}}{{\gamma_{{M0}}}}",
            m_term,
            w_symbol
        ),
        variables: vec![
            NamedValue {
                symbol: w_symbol.to_string(),
                value: w_used,
                unit: w_unit.to_string(),
            },
            NamedValue {
                symbol: "f_y".to_string(),
                value: grade.fy_mpa,
                unit: "MPa".to_string(),
            },
            NamedValue {
                symbol: r"\gamma_{M0}".to_string(),
                value: grade.gamma_m0,
                unit: "-".to_string(),
            },
        ],
        value: m_c_rd_knm,
        unit: "kNm".to_string(),
        uc: Some(UnityCheck {
            ed: m_ed_abs,
            rd: m_c_rd_knm,
            uc,
            formula_latex: r"M_{y,Ed} / M_{y,c,Rd}".to_string(),
        }),
        status,
        notes: vec![],
    }
}

pub fn m_z_c_rd(
    p: &SectionProperties,
    grade: &SteelGrade,
    class: CrossSectionClass,
    force_state: ForceStateSnapshot,
) -> ResistanceCalc {
    let (w_used, w_symbol) = match class {
        CrossSectionClass::Class1 | CrossSectionClass::Class2 => (p.wpl_z_mm3, r"W_{pl,z}"),
        _ => (p.wel_z_mm3, r"W_{el,z}"),
    };
    let m_c_rd = w_used * grade.fy_mpa / grade.gamma_m0 * 1e-6;
    let m_ed = force_state.forces.mz_ed.abs();
    let uc = if m_c_rd > 0.0 { m_ed / m_c_rd } else { 0.0 };

    ResistanceCalc {
        deelstappen: Vec::new(),
        id: "6.2.5_bending_z".to_string(),
        title: "Buigend moment (z-as)".to_string(),
        article: "art. 6.2.5".to_string(),
        force_state,
        formula_latex: format!(
            r"M_{{z,c,Rd}} = \frac{{{} \cdot f_y}}{{\gamma_{{M0}}}}",
            w_symbol
        ),
        variables: vec![
            NamedValue {
                symbol: w_symbol.to_string(),
                value: w_used,
                unit: "mm³".to_string(),
            },
            NamedValue {
                symbol: "f_y".to_string(),
                value: grade.fy_mpa,
                unit: "MPa".to_string(),
            },
            NamedValue {
                symbol: r"\gamma_{M0}".to_string(),
                value: grade.gamma_m0,
                unit: "-".to_string(),
            },
        ],
        value: m_c_rd,
        unit: "kNm".to_string(),
        uc: Some(UnityCheck {
            ed: m_ed,
            rd: m_c_rd,
            uc,
            formula_latex: r"M_{z,Ed} / M_{z,c,Rd}".to_string(),
        }),
        status: if uc <= 1.0 {
            CheckStatus::Ok
        } else {
            CheckStatus::NotOk
        },
        notes: vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{classification::CrossSectionClass, S235};
    use approx::assert_relative_eq;
    use mechanics::InternalForces;
    use section_properties::i_section::i_section_props;

    /// Calc 2 Beam 1 page 50: M_y,c,Rd = M_pl,y,Rd = 354113 × 235 / 1.00 × 10⁻⁶ = 83.217 kNm
    /// M_y,Ed = 87.84 kNm → UC = 1.06 NOT OK
    #[test]
    fn calc2_beam1_bending() {
        let mut p = i_section_props(160.0, 160.0, 8.0, 13.0, 15.0);
        p.wpl_y_mm3 = 354113.0;
        let f = InternalForces {
            n_ed: -226.027,
            vz_ed: -35.136,
            my_ed: -87.84,
            ..Default::default()
        };
        let snap = ForceStateSnapshot {
            combination_id: 2,
            position_mm: 2500.0,
            forces: f,
        };
        let result = m_y_c_rd(&p, &S235, CrossSectionClass::Class1, snap);
        assert_relative_eq!(result.value, 83.217, max_relative = 1e-3);
        assert_relative_eq!(result.uc.unwrap().uc, 1.06, max_relative = 0.02);
        assert_eq!(result.status, CheckStatus::NotOk);
    }

    /// Issue #243, punt 077: HEA300 S355, klasse 3, M_y,Ed = 400 kNm.
    /// W_el,y = 1260·10³ mm³ (catalogus) → M_el,y,Rd = 1260·10³·355/1,0 =
    /// 447,3 kNm, UC = 400/447,3 = 0,8943. Het label is elastisch, (6.14).
    #[test]
    fn klasse_3_heet_elastisch() {
        let mut p = i_section_props(290.0, 300.0, 8.5, 14.0, 27.0);
        p.wel_y_mm3 = 1_260_000.0;
        let snap = ForceStateSnapshot {
            combination_id: 1,
            position_mm: 0.0,
            forces: InternalForces { my_ed: 400.0, ..Default::default() },
        };
        let r = m_y_c_rd(&p, &crate::S355, CrossSectionClass::Class3, snap);
        assert_relative_eq!(r.value, 447.3, max_relative = 1e-9);
        assert_relative_eq!(r.uc.as_ref().unwrap().uc, 400.0 / 447.3, max_relative = 1e-9);
        assert!(r.formula_latex.contains(r"M_{el,y,Rd} = \frac{W_{el,y}"), "{}", r.formula_latex);
        assert!(!r.formula_latex.contains("pl"), "{}", r.formula_latex);
        assert_eq!(r.article, "art. 6.2.5 (6.14)");
        // Klasse 1/2 blijft plastisch (6.13), klasse 4 noemt W_eff (6.15).
        let r1 = m_y_c_rd(&p, &crate::S355, CrossSectionClass::Class1, snap);
        assert!(r1.formula_latex.contains(r"M_{pl,y,Rd} = \frac{W_{pl,y}"));
        assert_eq!(r1.article, "art. 6.2.5 (6.13)");
        let r4 = m_y_c_rd(&p, &crate::S355, CrossSectionClass::Class4, snap);
        assert!(r4.formula_latex.contains(r"M_{y,c,Rd} = \frac{W_{eff,y}"));
        assert_eq!(r4.article, "art. 6.2.5 (6.15)");
    }
}
