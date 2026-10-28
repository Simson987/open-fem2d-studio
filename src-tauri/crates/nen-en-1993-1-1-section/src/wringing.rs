//! NEN-EN 1993-1-1 §6.2.7 — wringing, voor de Saint-Venant-wringing.
//!
//! ## Wat de norm vraagt
//!
//! * 6.2.7(1), (6.23): T_Ed / T_Rd ≤ 1,0.
//! * 6.2.7(2): T_Ed = T_t,Ed + T_w,Ed (Saint-Venant en welving).
//! * 6.2.7(5): bij een elastische toetsing mag het vloeicriterium van
//!   6.2.1(5) gebruikt worden: (σ_x/(f_y/γ_M0))² + 3·(τ_Ed/(f_y/γ_M0))² ≤ 1.
//!   Voor zuivere schuifspanning geeft dat τ_Ed ≤ τ_Rd = f_y/(√3·γ_M0).
//! * 6.2.7(7): bij een gesloten holle doorsnede mag de welving verwaarloosd
//!   worden; bij een open I- of H-doorsnede de Saint-Venant-wringing.
//! * 6.2.7(9), (6.25)–(6.28): dwarskracht met wringing, V_Ed ≤ V_pl,T,Rd, met
//!   (6.26) voor een I- of H-doorsnede en (6.28) voor een buisprofiel:
//!   V_pl,T,Rd = (1 − τ_t,Ed/(f_y/(√3·γ_M0)))·V_pl,Rd.
//! * 6.2.8(4): bij wringing komt ρ uit V_pl,T,Rd.
//!
//! ## Wat hier gerekend wordt
//!
//! Alleen de Saint-Venant-wringing: τ_t,Ed = T_Ed / W_t, met het
//! wringweerstandsmoment W_t van de doorsnede (de aanroeper kiest W_t, zie de
//! `w_t_*`-functies). Daarmee T_Rd = W_t·τ_Rd. De welving (bimoment B_Ed,
//! σ_w,Ed, τ_w,Ed) komt niet uit een staafanalyse met zes vrijheidsgraden per
//! knoop; een doorsnede waar die er toe doet (open I, U) wordt door de
//! aanroeper niet met deze module getoetst, maar als "niet getoetst" gemeld.
//!
//! Tot oktober 2026 kende de staaltoets 6.2.7 niet: een CHS 88,9×4 S235 met
//! |T_Ed| = 6,75 kNm (T_Rd = 5,88 kNm, UC 1,15) kreeg status Ok met UC 0
//! (issue #249).

use mechanics::ForceStateSnapshot;

use crate::opmaak::{lx, nl, nv, stap};
use crate::{CheckStatus, ResistanceCalc, SteelGrade, UnityCheck};

/// Het id van de wringtoets (6.23).
pub const TOETS_WRINGING: &str = "6.2.7_torsion";

/// Het id van de toets op buiging en normaalkracht met de door de
/// wringschuifspanning verlaagde vloeigrens (6.2.7(5) met 6.2.1(5)).
pub const TOETS_WRINGING_NM: &str = "6.2.7_combined_nmt";

/// τ_Rd = f_y/(√3·γ_M0) in N/mm² (6.2.6(2), 6.2.7(5) met 6.2.1(5)).
pub fn tau_rd_mpa(grade: &SteelGrade) -> f64 {
    grade.fy_mpa / (3f64.sqrt() * grade.gamma_m0)
}

/// τ_t,Ed = |T_Ed|/W_t in N/mm², met T_Ed in kNm en W_t in mm³.
pub fn tau_t_ed_mpa(t_ed_knm: f64, w_t_mm3: f64) -> f64 {
    if w_t_mm3 > 0.0 {
        t_ed_knm.abs() * 1e6 / w_t_mm3
    } else {
        f64::INFINITY
    }
}

/// De factor V_pl,T,Rd / V_pl,Rd voor een buisprofiel, (6.28):
/// 1 − τ_t,Ed/(f_y/(√3·γ_M0)). Nooit negatief.
pub fn factor_v_pl_t_hol(tau_t_ed_mpa: f64, grade: &SteelGrade) -> f64 {
    (1.0 - tau_t_ed_mpa / tau_rd_mpa(grade)).max(0.0)
}

/// De factor V_pl,T,Rd / V_pl,Rd voor een I- of H-doorsnede, (6.26):
/// √(1 − τ_t,Ed/(1,25·f_y/(√3·γ_M0))). Nooit negatief.
pub fn factor_v_pl_t_i(tau_t_ed_mpa: f64, grade: &SteelGrade) -> f64 {
    (1.0 - tau_t_ed_mpa / (1.25 * tau_rd_mpa(grade))).max(0.0).sqrt()
}

/// De vloeigrens die naast een schuifspanning τ_t,Ed overblijft voor de
/// normaalspanning, volgens het vloeicriterium van 6.2.1(5):
/// σ ≤ (f_y/γ_M0)·√(1 − (τ/τ_Rd)²), dus f_y,T = f_y·√(1 − (τ_t,Ed/τ_Rd)²).
/// Nooit negatief.
pub fn fy_onder_wringing(tau_t_ed_mpa: f64, grade: &SteelGrade) -> f64 {
    let r = tau_t_ed_mpa / tau_rd_mpa(grade);
    grade.fy_mpa * (1.0 - r * r).max(0.0).sqrt()
}

/// W_t van een ronde buis of massief rond: τ_max = T·r/I_t, dus
/// W_t = 2·I_t/D (EN 10210-2 bijlage B: C_t = 2·W_el voor een CHS).
pub fn w_t_rond(i_t_mm4: f64, d_mm: f64) -> f64 {
    2.0 * i_t_mm4 / d_mm
}

/// W_t van een rechthoekige of vierkante koker volgens EN 10210-2:2006
/// bijlage B (en EN 10219-2 bijlage B): C_t = I_t/(t + K/t), met
/// K = 2·A_h·t/h, h = 2·((b − t) + (h − t)) − 2·R_c·(4 − π) de omtrek van de
/// hartlijn en A_h = (b − t)·(h − t) − R_c²·(4 − π) de door de hartlijn
/// ingesloten oppervlakte, R_c = (r_o + r_i)/2 de straal van de hartlijn in
/// de hoek. Voor warmvervaardigde kokers geeft EN 10210-2 bijlage B
/// r_o = 1,5·t en r_i = 1,0·t, dus R_c = 1,25·t. `i_t_mm4` is de I_t van de
/// catalogus.
pub fn w_t_koker(i_t_mm4: f64, h_mm: f64, b_mm: f64, t_mm: f64, r_c_mm: f64) -> f64 {
    let pi = std::f64::consts::PI;
    let r_c = r_c_mm.max(0.0);
    let omtrek = 2.0 * ((b_mm - t_mm) + (h_mm - t_mm)) - 2.0 * r_c * (4.0 - pi);
    let a_h = (b_mm - t_mm) * (h_mm - t_mm) - r_c * r_c * (4.0 - pi);
    let k = 2.0 * a_h * t_mm / omtrek;
    i_t_mm4 / (t_mm + k / t_mm)
}

/// W_t van een koker uit Bredt, voor een koker die alleen met maten bekend is
/// (geen catalogusprofiel): τ_max = T/(2·A_m·t_min), A_m = (b − t_w)·(h − t_f)
/// de door de hartlijn ingesloten oppervlakte (scherpe hoeken).
pub fn w_t_bredt(h_mm: f64, b_mm: f64, t_f_mm: f64, t_w_mm: f64) -> f64 {
    2.0 * (b_mm - t_w_mm) * (h_mm - t_f_mm) * t_f_mm.min(t_w_mm)
}

/// W_t van een massieve rechthoek of een dunwandige open doorsnede zonder
/// noemenswaardige welving (strip, hoeklijn): τ_max ≤ T·t_max/I_t. Voor een
/// rechthoek b×t is τ_max = T/(α·b·t²) en I_t = β·b·t³ met β ≤ α, dus
/// T·t/I_t = T/(β·b·t²) ≥ τ_max: aan de veilige kant.
pub fn w_t_open(i_t_mm4: f64, t_max_mm: f64) -> f64 {
    i_t_mm4 / t_max_mm
}

/// De wringtoets (6.23) op één krachtentoestand: |T_Ed| ≤ T_Rd = W_t·τ_Rd.
/// `w_t_toelichting` zegt waar W_t vandaan komt; hij komt als eerste notitie
/// onder de toets.
pub fn t_rd(
    w_t_mm3: f64,
    w_t_toelichting: &str,
    grade: &SteelGrade,
    force_state: ForceStateSnapshot,
) -> ResistanceCalc {
    let tau_rd = tau_rd_mpa(grade);
    let t_rd_knm = w_t_mm3 * tau_rd * 1e-6;
    let t_ed = force_state.forces.mt_ed.abs();
    let tau_t = tau_t_ed_mpa(t_ed, w_t_mm3);
    let uc = if t_rd_knm > 0.0 { t_ed / t_rd_knm } else { f64::INFINITY };
    let deelstappen = vec![
        stap(
            "tau_rd",
            "Rekenwaarde van de schuifvloeigrens",
            r"\tau_{Rd}",
            "art. 6.2.7(5), 6.2.1(5)",
            r"\tau_{Rd} = \frac{f_y}{\sqrt{3} \cdot \gamma_{M0}}".to_string(),
            format!(r"\tau_{{Rd}} = \frac{{{}}}{{\sqrt{{3}} \cdot {}}}", lx(grade.fy_mpa, 0), lx(grade.gamma_m0, 2)),
            vec![nv("f_y", grade.fy_mpa, "N/mm²"), nv(r"\gamma_{M0}", grade.gamma_m0, "-")],
            Some(tau_rd),
            "N/mm²",
            vec![],
        ),
        stap(
            "tau_t_ed",
            "Schuifspanning door Saint-Venant-wringing",
            r"\tau_{t,Ed}",
            "art. 6.2.7(4)",
            r"\tau_{t,Ed} = \frac{T_{Ed}}{W_t}".to_string(),
            format!(r"\tau_{{t,Ed}} = \frac{{{} \cdot 10^6}}{{{}}}", lx(t_ed, 3), lx(w_t_mm3, 0)),
            vec![nv(r"T_{Ed}", t_ed, "kNm"), nv("W_t", w_t_mm3, "mm³")],
            Some(tau_t),
            "N/mm²",
            vec![],
        ),
    ];
    ResistanceCalc {
        deelstappen,
        id: TOETS_WRINGING.to_string(),
        title: "Wringing (Saint-Venant)".to_string(),
        article: "art. 6.2.7 (6.23)".to_string(),
        force_state,
        formula_latex: r"T_{Rd} = \frac{W_t \cdot f_y}{\sqrt{3} \cdot \gamma_{M0}}".to_string(),
        variables: vec![
            nv("W_t", w_t_mm3, "mm³"),
            nv("f_y", grade.fy_mpa, "MPa"),
            nv(r"\gamma_{M0}", grade.gamma_m0, "-"),
        ],
        value: t_rd_knm,
        unit: "kNm".to_string(),
        uc: Some(UnityCheck {
            ed: t_ed,
            rd: t_rd_knm,
            uc,
            formula_latex: r"T_{Ed} / T_{Rd}".to_string(),
        }),
        status: if uc <= 1.0 { CheckStatus::Ok } else { CheckStatus::NotOk },
        notes: vec![
            w_t_toelichting.to_string(),
            format!(
                "τ_t,Ed = {} N/mm² tegen τ_Rd = f_y/(√3·γ_M0) = {} N/mm². Alleen de \
                 Saint-Venant-wringing: de welving is volgens 6.2.7(7) bij deze doorsnede \
                 verwaarloosd.",
                nl(tau_t, 1),
                nl(tau_rd, 1)
            ),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::S235;
    use mechanics::InternalForces;

    /// Issue #249: CHS 88,9×4 S235, I_t = 1 926 800 mm⁴, |T_Ed| = 6,75 kNm.
    /// τ_t,Ed = 6,75·10⁶·44,45/1 926 800 = 155,7 N/mm²;
    /// τ_Rd = 235/√3 = 135,7 N/mm²; T_Rd = 135,68·43 347,6 = 5,881 kNm;
    /// UC = 6,75/5,881 = 1,148.
    #[test]
    fn chs_88_9x4_issue_249() {
        let w_t = w_t_rond(1_926_800.0, 88.9);
        assert!((w_t - 43_347.58).abs() < 0.1, "W_t = {w_t}");
        let s = ForceStateSnapshot {
            combination_id: 1,
            position_mm: 0.0,
            forces: InternalForces { mt_ed: -6.75, ..Default::default() },
        };
        let r = t_rd(w_t, "", &S235, s);
        assert!((r.value - 5.8813).abs() < 1e-3, "T_Rd = {}", r.value);
        let uc = r.uc.unwrap().uc;
        assert!((uc - 1.1477).abs() < 1e-3, "UC = {uc}");
        assert_eq!(r.status, CheckStatus::NotOk);
        assert!((tau_t_ed_mpa(6.75, w_t) - 155.72).abs() < 0.01);
    }

    /// (6.28) en (6.26) in de grensgevallen.
    #[test]
    fn factoren_v_pl_t() {
        let tau_rd = tau_rd_mpa(&S235);
        assert_eq!(factor_v_pl_t_hol(0.0, &S235), 1.0);
        assert!((factor_v_pl_t_hol(0.5 * tau_rd, &S235) - 0.5).abs() < 1e-12);
        assert_eq!(factor_v_pl_t_hol(2.0 * tau_rd, &S235), 0.0);
        assert!((factor_v_pl_t_i(0.625 * tau_rd, &S235) - 0.5f64.sqrt()).abs() < 1e-12);
        // 6.2.1(5): bij τ = τ_Rd/2 blijft √(1 − 1/4) = 0,866·f_y over.
        assert!((fy_onder_wringing(0.5 * tau_rd, &S235) - 235.0 * 0.75f64.sqrt()).abs() < 1e-9);
    }

    /// EN 10210-2 bijlage B voor RHS 200×100×6,3 (R_c = 1,25·t = 7,875 mm),
    /// omtrek 561,28 mm, A_h = 18 096,5 mm², K = 406,25 mm²; met
    /// I_t = 14 703 100 mm⁴ (catalogus) C_t = I_t/(6,3 + 64,48) = 207 730 mm³.
    /// Bredt met scherpe hoeken gaf 2·93,7·193,7·6,3 = 228 690 mm³.
    #[test]
    fn koker_en10210() {
        let w = w_t_koker(14_703_100.0, 200.0, 100.0, 6.3, 1.25 * 6.3);
        assert!((w - 207_730.0).abs() / 207_730.0 < 2e-3, "C_t = {w}");
        let b = w_t_bredt(200.0, 100.0, 6.3, 6.3);
        assert!((b - 228_686.0).abs() < 5.0, "Bredt = {b}");
    }
}
