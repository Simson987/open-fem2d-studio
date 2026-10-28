//! §6.4.2 enkelzijdig verlopende liggers (single tapered beams).
//!
//! Bij een ligger waarvan één rand schuin loopt, staat de buigspanning aan die
//! schuine rand onder een hoek α met de vezel. Daar werkt naast σ_m ook een
//! schuifspanning en een spanning loodrecht op de vezel, en de buigsterkte
//! wordt daarom met k_m,α verlaagd (EN 1995-1-1 6.4.2):
//!
//! ```text
//!   σ_m,α,d ≤ k_m,α · f_m,d                                           (6.38)
//!   σ_m,α,d = σ_m,0,d = 6·M_d / (b·h²)                                (6.37)
//!   trek aan de schuine rand:
//!   k_m,α = 1 / √(1 + (f_m,d/(0,75·f_v,d)·tan α)² + (f_m,d/f_t,90,d·tan²α)²)   (6.39)
//!   druk aan de schuine rand:
//!   k_m,α = 1 / √(1 + (f_m,d/(1,5·f_v,d)·tan α)² + (f_m,d/f_c,90,d·tan²α)²)    (6.40)
//! ```
//!
//! (6.39) geeft bij elke invoer de kleinere k_m,α (0,75 < 1,5 en
//! f_t,90 < f_c,90), dus "schuine rand op trek" is de ongunstigste aanname. Die
//! geldt als niet is opgegeven welke rand schuin is: een 2D-model legt dat niet
//! vast (issue #253).
//!
//! De BRIS-normtekstcontrole meldt een afwijking van (6.39) in de Nederlandse
//! tekst; hier staat de Engelse versie, zoals in de hand- en
//! referentieberekening van de controle.

use mechanics::ForceStateSnapshot;
use nen_en_1993_1_1_section::{CheckStatus, NamedValue, ResistanceCalc, UnityCheck};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::bending::sigma_m_mpa;
use crate::section::TimberSection;

/// Welke rand van een verlopende houten ligger schuin loopt (6.4.2).
///
/// Het momentteken bepaalt per doorsnede of die rand op trek of op druk staat:
/// een positief M_y geeft trek ONDER en druk BOVEN (dezelfde conventie als de
/// rest van de houtkern, zie `clt::CltMechanics::layer_edge_stresses`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/timber/")]
pub enum SchuineRand {
    /// De bovenrand loopt schuin, de onderrand is recht.
    Boven,
    /// De onderrand loopt schuin, de bovenrand is recht.
    Onder,
    /// Beide randen lopen symmetrisch schuin, elk met tan α = Δh/(2L). Eén van
    /// beide staat altijd op trek, dus (6.39) is maatgevend.
    Beide,
}

/// k_m,α volgens (6.39) (`trek` = true, schuine rand op trek) of (6.40).
pub fn k_m_alpha(f_md: f64, f_vd: f64, f_90d: f64, tan_alpha: f64, trek: bool) -> f64 {
    // `f_90d` is f_t,90,d bij (6.39) en f_c,90,d bij (6.40).
    let factor_v = if trek { 0.75 } else { 1.5 };
    if !(f_vd > 0.0 && f_90d > 0.0) {
        return 0.0;
    }
    let a = f_md / (factor_v * f_vd) * tan_alpha;
    let b = f_md / f_90d * tan_alpha * tan_alpha;
    1.0 / (1.0 + a * a + b * b).sqrt()
}

/// De rekensterkten die §6.4.2 nodig heeft, in N/mm².
#[derive(Clone, Copy, Debug)]
pub struct Sterkten642 {
    pub f_md: f64,
    pub f_vd: f64,
    pub f_t90d: f64,
    pub f_c90d: f64,
}

fn nl(x: f64, cijfers: usize) -> String {
    format!("{x:.cijfers$}").replace('.', ",")
}

/// De toets van §6.4.2 op één doorsnede van een verlopende ligger.
///
/// `tan_alpha_enkel` = |h_eind − h_begin| / L, de helling als één rand schuin
/// loopt. `rand` = `None`: niet opgegeven, ongunstigste aanname (6.39).
pub fn check_tapered_edge(
    section: &TimberSection,
    f: Sterkten642,
    tan_alpha_enkel: f64,
    rand: Option<SchuineRand>,
    force_state: ForceStateSnapshot,
) -> ResistanceCalc {
    let m = force_state.forces.my_ed;
    let sigma = sigma_m_mpa(m, section.w_y_mm3);
    // Welke vergelijking, en met welke helling.
    let (tan_alpha, trek, toelichting) = match rand {
        None => (
            tan_alpha_enkel,
            true,
            "Welke rand schuin loopt is niet opgegeven (een 2D-model legt dat niet vast). Getoetst \
             is de ONGUNSTIGSTE aanname: één schuine rand, op trek, (6.39). (6.39) geeft altijd \
             de kleinere k_m,α dan (6.40). Geef 'schuine_rand' op (Boven, Onder of Beide) om met \
             de werkelijke rand te toetsen."
                .to_string(),
        ),
        Some(SchuineRand::Beide) => (
            tan_alpha_enkel / 2.0,
            true,
            "Beide randen lopen symmetrisch schuin, elk met tan α = Δh/(2L). Bij elk momentteken \
             staat één schuine rand op trek, dus (6.39) is maatgevend."
                .to_string(),
        ),
        Some(r) => {
            // Positief M_y: trek onder, druk boven.
            let schuin_op_trek = match r {
                SchuineRand::Onder => m >= 0.0,
                SchuineRand::Boven => m < 0.0,
                SchuineRand::Beide => true,
            };
            let rand_tekst = if r == SchuineRand::Boven { "bovenrand" } else { "onderrand" };
            (
                tan_alpha_enkel,
                schuin_op_trek,
                format!(
                    "De {rand_tekst} loopt schuin (opgegeven). Met M_y,d = {} kNm (positief = trek \
                     onder) staat die rand op {}, dus {}.",
                    nl(m, 2),
                    if schuin_op_trek { "TREK" } else { "DRUK" },
                    if schuin_op_trek { "(6.39)" } else { "(6.40)" }
                ),
            )
        }
    };
    let f_90 = if trek { f.f_t90d } else { f.f_c90d };
    let k = k_m_alpha(f.f_md, f.f_vd, f_90, tan_alpha, trek);
    let rd = k * f.f_md;
    let getoetst = rd > 0.0 && sigma > 0.0;
    let uc = if rd > 0.0 { sigma / rd } else { 0.0 };
    let alpha_graden = tan_alpha.atan().to_degrees();
    let (vgl, f90_symbool, factor_v) = if trek {
        ("(6.39)", r"f_{t,90,d}", "0,75")
    } else {
        ("(6.40)", r"f_{c,90,d}", "1,5")
    };
    ResistanceCalc {
        deelstappen: Vec::new(),
        id: "6.4.2_tapered_edge".to_string(),
        title: "Buiging aan de schuine rand (verlopende ligger)".to_string(),
        article: format!("art. 6.4.2 (6.38) {vgl}"),
        force_state,
        formula_latex: format!(
            r"\sigma_{{m,\alpha,d}} \le k_{{m,\alpha}} f_{{m,d}} \quad ; \quad k_{{m,\alpha}} = \frac{{1}}{{\sqrt{{1 + \left(\frac{{f_{{m,d}}}}{{{} f_{{v,d}}}} \tan\alpha\right)^2 + \left(\frac{{f_{{m,d}}}}{{{f90_symbool}}} \tan^2\alpha\right)^2}}}}",
            factor_v.replace(',', "{,}")
        ),
        variables: vec![
            NamedValue { symbol: r"\tan\alpha".to_string(), value: tan_alpha, unit: "-".to_string() },
            NamedValue { symbol: r"\alpha".to_string(), value: alpha_graden, unit: "°".to_string() },
            NamedValue { symbol: r"\sigma_{m,\alpha,d}".to_string(), value: sigma, unit: "N/mm²".to_string() },
            NamedValue { symbol: r"f_{m,d}".to_string(), value: f.f_md, unit: "N/mm²".to_string() },
            NamedValue { symbol: r"f_{v,d}".to_string(), value: f.f_vd, unit: "N/mm²".to_string() },
            NamedValue { symbol: f90_symbool.to_string(), value: f_90, unit: "N/mm²".to_string() },
            NamedValue { symbol: r"k_{m,\alpha}".to_string(), value: k, unit: "-".to_string() },
        ],
        value: rd,
        unit: "N/mm²".to_string(),
        uc: getoetst.then(|| UnityCheck {
            ed: sigma,
            rd,
            uc,
            formula_latex: r"\sigma_{m,\alpha,d} / (k_{m,\alpha} f_{m,d})".to_string(),
        }),
        status: if !getoetst {
            CheckStatus::NotApplicable
        } else if uc <= 1.0 {
            CheckStatus::Ok
        } else {
            CheckStatus::NotOk
        },
        notes: vec![
            toelichting,
            format!(
                "σ_m,α,d = σ_m,0,d = 6·M_d/(b·h²) met de PLAATSELIJKE hoogte (6.37); k_m,α = {} \
                 bij tan α = {} (α = {}°). Engelse tekst van (6.39) aangehouden: de \
                 BRIS-normtekstcontrole meldt daarin een afwijking in de Nederlandse uitgave.",
                nl(k, 3),
                nl(tan_alpha, 4),
                nl(alpha_graden, 2)
            ),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use mechanics::InternalForces;

    /// Issue #253: C24, tan α = 0,10. f_m,d/f_v,d = 24/4 = 6;
    /// (6.39): 1/√(1 + 0,8² + 0,6²) = 1/√2 = 0,7071;
    /// (6.40): 1/√(1 + 0,4² + 0,096²) = 0,92481.
    #[test]
    fn k_m_alpha_volgens_de_handberekening() {
        let k = 0.6 / 1.3;
        let (fm, fv, ft90, fc90) = (24.0 * k, 4.0 * k, 0.4 * k, 2.5 * k);
        assert_relative_eq!(k_m_alpha(fm, fv, ft90, 0.1, true), 1.0 / 2f64.sqrt(), max_relative = 1e-12);
        assert_relative_eq!(k_m_alpha(fm, fv, fc90, 0.1, false), 0.92481, max_relative = 1e-4);
        // Geen helling: geen verlaging.
        assert_relative_eq!(k_m_alpha(fm, fv, ft90, 0.0, true), 1.0);
    }

    fn staat(my: f64) -> ForceStateSnapshot {
        ForceStateSnapshot {
            combination_id: 1,
            position_mm: 3000.0,
            forces: InternalForces { my_ed: my, ..Default::default() },
        }
    }

    /// Issue #253: x = 3000 mm, h = 300 mm, b = 100 mm, M_d = 12 kNm →
    /// σ = 8,00 N/mm²; f_m,d = 11,08; UC (6.39) = 1,021, (6.40) = 0,781.
    #[test]
    fn uc_aan_de_schuine_rand() {
        let k = 0.6 / 1.3;
        let f = Sterkten642 { f_md: 24.0 * k, f_vd: 4.0 * k, f_t90d: 0.4 * k, f_c90d: 2.5 * k };
        let s = TimberSection::rechthoek(100.0, 300.0);
        let r = check_tapered_edge(&s, f, 0.1, None, staat(12.0));
        assert_relative_eq!(r.uc.as_ref().unwrap().ed, 8.0, max_relative = 1e-12);
        assert_relative_eq!(r.uc.as_ref().unwrap().uc, 1.02138, max_relative = 1e-5);
        assert_eq!(r.status, CheckStatus::NotOk);
        // Onderrand schuin, positief moment: trek → (6.39).
        let onder = check_tapered_edge(&s, f, 0.1, Some(SchuineRand::Onder), staat(12.0));
        assert_relative_eq!(onder.uc.as_ref().unwrap().uc, 1.02138, max_relative = 1e-5);
        // Bovenrand schuin, positief moment: druk → (6.40).
        let boven = check_tapered_edge(&s, f, 0.1, Some(SchuineRand::Boven), staat(12.0));
        assert_relative_eq!(boven.uc.as_ref().unwrap().uc, 0.78095, max_relative = 1e-4);
        assert!(boven.article.contains("(6.40)"));
        // Negatief moment draait het om.
        let boven_neg = check_tapered_edge(&s, f, 0.1, Some(SchuineRand::Boven), staat(-12.0));
        assert!(boven_neg.article.contains("(6.39)"));
        // Beide randen: halve helling, (6.39).
        let beide = check_tapered_edge(&s, f, 0.1, Some(SchuineRand::Beide), staat(12.0));
        let kb = k_m_alpha(f.f_md, f.f_vd, f.f_t90d, 0.05, true);
        assert_relative_eq!(beide.uc.as_ref().unwrap().uc, 8.0 / (kb * f.f_md), max_relative = 1e-12);
        // Zonder moment: niet van toepassing, geen UC.
        let nul = check_tapered_edge(&s, f, 0.1, None, staat(0.0));
        assert!(nul.uc.is_none());
        assert_eq!(nul.status, CheckStatus::NotApplicable);
    }
}
