//! §6.1.6 buiging (enkel en dubbel).

use mechanics::ForceStateSnapshot;
use nen_en_1993_1_1_section::{CheckStatus, NamedValue, ResistanceCalc, UnityCheck};

use crate::section::TimberSection;

/// Buigspanning |M|/W in N/mm2 (M in kNm, W in mm3).
pub fn sigma_m_mpa(m_ed_knm: f64, w_mm3: f64) -> f64 {
    if w_mm3 <= 0.0 {
        return 0.0;
    }
    m_ed_knm.abs() * 1e6 / w_mm3
}

/// §6.1.6, vergelijkingen (6.11) en (6.12):
///
///   sigma_m,y,d / f_m,y,d + k_m · sigma_m,z,d / f_m,z,d <= 1   (6.11)
///   k_m · sigma_m,y,d / f_m,y,d + sigma_m,z,d / f_m,z,d <= 1   (6.12)
///
/// UC = maximum van beide. k_m = 0,7 voor rechthoekige doorsneden.
///
/// Verificatie: de referentie-uitwerking voert geen zuivere buigingstoets op
/// (overal is ook normaalkracht aanwezig, waardoor §6.3.2 maatgevend is),
/// maar dezelfde buigtermen sigma_m,y,d/f_m,y,d + k_m·sigma_m,z,d/f_m,z,d
/// komen geverifieerd terug in (6.23): 22,3/14,8 + 0,7·0/16,1.
pub fn check_bending(
    section: &TimberSection,
    f_myd_mpa: f64,
    f_mzd_mpa: f64,
    k_m: f64,
    force_state: ForceStateSnapshot,
) -> ResistanceCalc {
    let sigma_my = sigma_m_mpa(force_state.forces.my_ed, section.w_y_mm3);
    let sigma_mz = sigma_m_mpa(force_state.forces.mz_ed, section.w_z_mm3);

    let term_y = if f_myd_mpa > 0.0 { sigma_my / f_myd_mpa } else { 0.0 };
    let term_z = if f_mzd_mpa > 0.0 { sigma_mz / f_mzd_mpa } else { 0.0 };
    let eq_6_11 = term_y + k_m * term_z;
    let eq_6_12 = k_m * term_y + term_z;
    let uc = eq_6_11.max(eq_6_12);

    let has_moment = sigma_my > 0.0 || sigma_mz > 0.0;
    let status = if !has_moment {
        CheckStatus::NotApplicable
    } else if uc <= 1.0 {
        CheckStatus::Ok
    } else {
        CheckStatus::NotOk
    };

    ResistanceCalc {
        deelstappen: Vec::new(),
        id: "6.1.6_bending".to_string(),
        title: "Buiging".to_string(),
        article: "art. 6.1.6 (6.11)(6.12)".to_string(),
        force_state,
        formula_latex: r"\frac{\sigma_{m,y,d}}{f_{m,y,d}} + k_m \frac{\sigma_{m,z,d}}{f_{m,z,d}} \le 1 \quad ; \quad k_m \frac{\sigma_{m,y,d}}{f_{m,y,d}} + \frac{\sigma_{m,z,d}}{f_{m,z,d}} \le 1".to_string(),
        variables: vec![
            NamedValue { symbol: r"\sigma_{m,y,d}".to_string(), value: sigma_my, unit: "N/mm²".to_string() },
            NamedValue { symbol: r"\sigma_{m,z,d}".to_string(), value: sigma_mz, unit: "N/mm²".to_string() },
            NamedValue { symbol: r"f_{m,y,d}".to_string(), value: f_myd_mpa, unit: "N/mm²".to_string() },
            NamedValue { symbol: r"f_{m,z,d}".to_string(), value: f_mzd_mpa, unit: "N/mm²".to_string() },
            NamedValue { symbol: "k_m".to_string(), value: k_m, unit: "-".to_string() },
            NamedValue { symbol: "(6.11)".to_string(), value: eq_6_11, unit: "-".to_string() },
            NamedValue { symbol: "(6.12)".to_string(), value: eq_6_12, unit: "-".to_string() },
        ],
        value: uc,
        unit: "-".to_string(),
        uc: Some(UnityCheck {
            ed: uc,
            rd: 1.0,
            uc,
            formula_latex: r"\max\left[(6.11), (6.12)\right]".to_string(),
        }),
        status,
        notes: vec![],
    }
}

/// §6.2.3 (6.17) en (6.18): buiging met trek evenwijdig aan de vezel.
/// De drie spanningen komen uit één snede en één belastingcombinatie.
pub fn check_bending_tension(
    section: &TimberSection,
    f_t0d_mpa: f64,
    f_myd_mpa: f64,
    f_mzd_mpa: f64,
    k_m: f64,
    force_state: ForceStateSnapshot,
) -> ResistanceCalc {
    let sigma_t = if section.a_mm2 > 0.0 {
        force_state.forces.n_ed.max(0.0) * 1e3 / section.a_mm2
    } else { 0.0 };
    let sigma_my = sigma_m_mpa(force_state.forces.my_ed, section.w_y_mm3);
    let sigma_mz = sigma_m_mpa(force_state.forces.mz_ed, section.w_z_mm3);
    let t = if f_t0d_mpa > 0.0 { sigma_t / f_t0d_mpa } else { 0.0 };
    let y = if f_myd_mpa > 0.0 { sigma_my / f_myd_mpa } else { 0.0 };
    let z = if f_mzd_mpa > 0.0 { sigma_mz / f_mzd_mpa } else { 0.0 };
    let eq_6_17 = t + y + k_m * z;
    let eq_6_18 = t + k_m * y + z;
    let uc = eq_6_17.max(eq_6_18);
    // Zonder trek of zonder moment niet van toepassing, en dan ook geen UC: een
    // getal naast "n.v.t." leest als een uitkomst (controle 2026-10, punt K3).
    let van_toepassing = sigma_t > 0.0 && (sigma_my > 0.0 || sigma_mz > 0.0);
    let status = if !van_toepassing {
        CheckStatus::NotApplicable
    } else if uc <= 1.0 { CheckStatus::Ok } else { CheckStatus::NotOk };
    ResistanceCalc {
        deelstappen: Vec::new(),
        id: "6.2.3_bending_tension".into(),
        title: "Buiging met trek".into(),
        article: "art. 6.2.3 (6.17)(6.18)".into(),
        force_state,
        formula_latex: r"\max\left[\frac{\sigma_{t,0,d}}{f_{t,0,d}}+\frac{\sigma_{m,y,d}}{f_{m,y,d}}+k_m\frac{\sigma_{m,z,d}}{f_{m,z,d}},\frac{\sigma_{t,0,d}}{f_{t,0,d}}+k_m\frac{\sigma_{m,y,d}}{f_{m,y,d}}+\frac{\sigma_{m,z,d}}{f_{m,z,d}}\right] \le 1".into(),
        variables: vec![
            NamedValue { symbol: r"\sigma_{t,0,d}".into(), value: sigma_t, unit: "N/mm²".into() },
            NamedValue { symbol: r"\sigma_{m,y,d}".into(), value: sigma_my, unit: "N/mm²".into() },
            NamedValue { symbol: r"\sigma_{m,z,d}".into(), value: sigma_mz, unit: "N/mm²".into() },
            NamedValue { symbol: r"f_{t,0,d}".into(), value: f_t0d_mpa, unit: "N/mm²".into() },
            NamedValue { symbol: r"f_{m,y,d}".into(), value: f_myd_mpa, unit: "N/mm²".into() },
            NamedValue { symbol: r"f_{m,z,d}".into(), value: f_mzd_mpa, unit: "N/mm²".into() },
            NamedValue { symbol: "k_m".into(), value: k_m, unit: "-".into() },
            NamedValue { symbol: "(6.17)".into(), value: eq_6_17, unit: "-".into() },
            NamedValue { symbol: "(6.18)".into(), value: eq_6_18, unit: "-".into() },
        ],
        value: if van_toepassing { uc } else { 0.0 },
        unit: "-".into(),
        uc: van_toepassing.then(|| UnityCheck { ed: uc, rd: 1.0, uc, formula_latex: r"\max[(6.17),(6.18)]".into() }),
        status,
        notes: vec!["6.2.3 toetst trek met tweeassige buiging op dezelfde snede; k_m = 0,7 voor een rechthoek, anders 1,0.".into()],
    }
}

/// §6.2.4 (6.19) en (6.20): buiging met druk evenwijdig aan de vezel, op
/// doorsnedeniveau (zonder knik):
///
///   (σ_c,0,d/f_c,0,d)² + σ_m,y,d/f_m,y,d + k_m·σ_m,z,d/f_m,z,d ≤ 1   (6.19)
///   (σ_c,0,d/f_c,0,d)² + k_m·σ_m,y,d/f_m,y,d + σ_m,z,d/f_m,z,d ≤ 1   (6.20)
///
/// De drie spanningen komen uit één snede en één belastingcombinatie, net als
/// bij (6.17)/(6.18). Niet van toepassing zonder druk of zonder moment. Bij een
/// slanke staaf (λ_rel > 0,3) is de kolomtoets (6.23)/(6.24) minstens zo
/// streng; deze toets staat er omdat de norm hem voor elke doorsnede vraagt.
pub fn check_bending_compression(
    section: &TimberSection,
    f_c0d_mpa: f64,
    f_myd_mpa: f64,
    f_mzd_mpa: f64,
    k_m: f64,
    force_state: ForceStateSnapshot,
) -> ResistanceCalc {
    let sigma_c = if section.a_mm2 > 0.0 {
        (-force_state.forces.n_ed).max(0.0) * 1e3 / section.a_mm2
    } else { 0.0 };
    let sigma_my = sigma_m_mpa(force_state.forces.my_ed, section.w_y_mm3);
    let sigma_mz = sigma_m_mpa(force_state.forces.mz_ed, section.w_z_mm3);
    let c = if f_c0d_mpa > 0.0 { sigma_c / f_c0d_mpa } else { 0.0 };
    let y = if f_myd_mpa > 0.0 { sigma_my / f_myd_mpa } else { 0.0 };
    let z = if f_mzd_mpa > 0.0 { sigma_mz / f_mzd_mpa } else { 0.0 };
    let eq_6_19 = c * c + y + k_m * z;
    let eq_6_20 = c * c + k_m * y + z;
    let uc = eq_6_19.max(eq_6_20);
    let van_toepassing = sigma_c > 0.0 && (sigma_my > 0.0 || sigma_mz > 0.0);
    let status = if !van_toepassing {
        CheckStatus::NotApplicable
    } else if uc <= 1.0 { CheckStatus::Ok } else { CheckStatus::NotOk };
    ResistanceCalc {
        deelstappen: Vec::new(),
        id: "6.2.4_bending_compression".into(),
        title: "Buiging met druk".into(),
        article: "art. 6.2.4 (6.19)(6.20)".into(),
        force_state,
        formula_latex: r"\max\left[\left(\frac{\sigma_{c,0,d}}{f_{c,0,d}}\right)^2+\frac{\sigma_{m,y,d}}{f_{m,y,d}}+k_m\frac{\sigma_{m,z,d}}{f_{m,z,d}},\left(\frac{\sigma_{c,0,d}}{f_{c,0,d}}\right)^2+k_m\frac{\sigma_{m,y,d}}{f_{m,y,d}}+\frac{\sigma_{m,z,d}}{f_{m,z,d}}\right] \le 1".into(),
        variables: vec![
            NamedValue { symbol: r"\sigma_{c,0,d}".into(), value: sigma_c, unit: "N/mm²".into() },
            NamedValue { symbol: r"\sigma_{m,y,d}".into(), value: sigma_my, unit: "N/mm²".into() },
            NamedValue { symbol: r"\sigma_{m,z,d}".into(), value: sigma_mz, unit: "N/mm²".into() },
            NamedValue { symbol: r"f_{c,0,d}".into(), value: f_c0d_mpa, unit: "N/mm²".into() },
            NamedValue { symbol: r"f_{m,y,d}".into(), value: f_myd_mpa, unit: "N/mm²".into() },
            NamedValue { symbol: r"f_{m,z,d}".into(), value: f_mzd_mpa, unit: "N/mm²".into() },
            NamedValue { symbol: "k_m".into(), value: k_m, unit: "-".into() },
            NamedValue { symbol: "(6.19)".into(), value: eq_6_19, unit: "-".into() },
            NamedValue { symbol: "(6.20)".into(), value: eq_6_20, unit: "-".into() },
        ],
        value: if van_toepassing { uc } else { 0.0 },
        unit: "-".into(),
        uc: van_toepassing.then(|| UnityCheck { ed: uc, rd: 1.0, uc, formula_latex: r"\max[(6.19),(6.20)]".into() }),
        status,
        notes: if van_toepassing {
            vec!["6.2.4 toetst druk met tweeassige buiging op dezelfde snede, zonder knik; de \
                  kolomtoets 6.3.2 rekent daarnaast met k_c. k_m = 0,7 voor een rechthoek, anders 1,0."
                .into()]
        } else {
            vec!["Niet van toepassing: op deze snede is er geen druk met buiging.".into()]
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use mechanics::InternalForces;

    fn snap(my: f64, mz: f64) -> ForceStateSnapshot {
        ForceStateSnapshot {
            combination_id: 12,
            position_mm: 3688.0,
            forces: InternalForces { my_ed: my, mz_ed: mz, ..Default::default() },
        }
    }

    #[test]
    fn buigspanning_referentie() {
        // Referentie: sigma_m,y,d = 72,170e6 / 3,24e6 = 22,3 N/mm2.
        let s = TimberSection::rechthoek(96.0, 450.0);
        assert_relative_eq!(sigma_m_mpa(72.170, s.w_y_mm3), 22.27, max_relative = 1e-3);
    }

    #[test]
    fn enkelvoudige_buiging_uc_conform_referentietermen() {
        // Buigterm uit (6.23): 22,3/14,8 = 1,51.
        let s = TimberSection::rechthoek(96.0, 450.0);
        let r = check_bending(&s, 14.769, 16.149, 0.7, snap(72.170, 0.0));
        assert_relative_eq!(r.uc.as_ref().unwrap().uc, 1.508, max_relative = 2e-3);
        assert_eq!(r.status, CheckStatus::NotOk);
    }

    #[test]
    fn dubbele_buiging_beide_vergelijkingen() {
        // Symmetrische controle van (6.11)/(6.12) met k_m = 0,7:
        // termen 0,5 en 0,4 → 6.11: 0,5+0,7·0,4 = 0,78; 6.12: 0,7·0,5+0,4 = 0,75.
        let s = TimberSection::rechthoek(100.0, 100.0);
        // W_y = W_z = 166667 mm3; f_d = 10 → M voor sigma=5: 0,833 kNm; sigma=4: 0,667.
        let m_y = 5.0 * s.w_y_mm3 / 1e6;
        let m_z = 4.0 * s.w_z_mm3 / 1e6;
        let r = check_bending(&s, 10.0, 10.0, 0.7, snap(m_y, m_z));
        assert_relative_eq!(r.uc.as_ref().unwrap().uc, 0.78, max_relative = 1e-6);
        assert_eq!(r.status, CheckStatus::Ok);
    }

    #[test]
    fn zonder_moment_niet_van_toepassing() {
        let s = TimberSection::rechthoek(96.0, 450.0);
        let r = check_bending(&s, 14.769, 16.149, 0.7, snap(0.0, 0.0));
        assert_eq!(r.status, CheckStatus::NotApplicable);
    }

    #[test]
    fn buiging_met_trek_gebruikt_beide_assen_op_hetzelfde_station() {
        let s = TimberSection::rechthoek(100.0, 200.0);
        let state = ForceStateSnapshot {
            combination_id: 7,
            position_mm: 1250.0,
            forces: InternalForces {
                n_ed: 40.0,
                my_ed: 2.0 * s.w_y_mm3 / 1e6,
                mz_ed: 3.0 * s.w_z_mm3 / 1e6,
                ..Default::default()
            },
        };
        let r = check_bending_tension(&s, 10.0, 10.0, 10.0, 0.7, state);
        // Trekterm 0,2; buigtermen 0,2 en 0,3. (6.17) = 0,61;
        // (6.18) = 0,64 en is dus maatgevend.
        assert_relative_eq!(r.uc.unwrap().uc, 0.64, max_relative = 1e-12);
        assert_eq!(r.force_state.combination_id, 7);
    }

    /// (6.19)/(6.20) met de hand: drukterm (0,5)² = 0,25, buigtermen 0,2 en
    /// 0,3; (6.19) = 0,25 + 0,2 + 0,7·0,3 = 0,66; (6.20) = 0,25 + 0,14 + 0,3
    /// = 0,69 maatgevend. Bij trek is de toets niet van toepassing.
    #[test]
    fn buiging_met_druk_volgens_6_19_en_6_20() {
        let s = TimberSection::rechthoek(100.0, 200.0);
        let state = |n: f64| ForceStateSnapshot {
            combination_id: 3,
            position_mm: 0.0,
            forces: InternalForces {
                n_ed: n,
                my_ed: 2.0 * s.w_y_mm3 / 1e6,
                mz_ed: 3.0 * s.w_z_mm3 / 1e6,
                ..Default::default()
            },
        };
        // σ_c = 100 kN / 20 000 mm² = 5 N/mm² tegen f_c,0,d = 10.
        let r = check_bending_compression(&s, 10.0, 10.0, 10.0, 0.7, state(-100.0));
        assert_relative_eq!(r.uc.as_ref().unwrap().uc, 0.69, max_relative = 1e-12);
        assert_eq!(r.status, CheckStatus::Ok);
        let t = check_bending_compression(&s, 10.0, 10.0, 10.0, 0.7, state(100.0));
        assert_eq!(t.status, CheckStatus::NotApplicable);
        assert!(t.uc.is_none());
    }
}
