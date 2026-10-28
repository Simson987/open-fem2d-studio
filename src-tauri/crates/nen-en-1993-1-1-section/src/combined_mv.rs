//! NEN-EN 1993-1-1 §6.2.8 — buiging en dwarskracht.
//!
//! De toets werkt op één krachtentoestand. De staaltoets loopt de hele
//! omhullende af — elk station van elke belastingcombinatie — en houdt de
//! toestand met de hoogste unity check. De grootste dwarskracht en het grootste
//! moment liggen zelden op dezelfde plaats, en een plaats waar ze allebei groot
//! zijn kan maatgevend zijn zonder dat een van beide daar zijn maximum heeft:
//! een zware puntlast vlak bij een oplegging naast een gelijkmatige last die het
//! grootste veldmoment geeft. Tot oktober 2026 werd 6.2.8 alleen getoetst op het
//! punt met het grootste |M_y|, waar de dwarskracht vaak nul is.
//!
//! Per toestand, met V = |V_z,Ed| en M = |M_y,Ed|:
//!
//! ```text
//! ρ = 0                            als V ≤ V_pl,z,Rd/2          (6.2.8(2))
//! ρ = (2·V/V_pl,z,Rd − 1)²          anders                       (6.2.8(3))
//! ```
//!
//! ## M_y,V,Rd
//!
//! 6.2.8(3) verlaagt de vloeigrens tot (1 − ρ)·f_y voor het AFSCHUIFOPPERVLAK.
//! Voor een I- of H-profiel met gelijke flenzen en buiging om de sterke as
//! schrijft 6.2.8(5) dat uit als (6.30):
//!
//! ```text
//! M_y,V,Rd = (W_pl,y − ρ·A_w²/(4·t_w))·f_y/γ_M0,   maar M_y,V,Rd ≤ M_y,c,Rd
//! A_w = h_w·t_w,  h_w = h − 2·t_f
//! ```
//!
//! Dat geldt hier voor de dubbelsymmetrische I uit de catalogus en de gelaste
//! dubbelsymmetrische I (de vorm [`Interactievorm::I`]). Voor elke andere vorm
//! geeft de norm geen uitgeschreven formule; daar blijft de verlaagde
//! vloeigrens op de HELE doorsnede staan, M_y,V,Rd = (1 − ρ)·M_y,c,Rd: de
//! veilige kant (bij een koker ongeveer 4 % te streng, zie de controle van
//! oktober 2026).
//!
//! Tot oktober 2026 gold (1 − ρ)·M_y,c,Rd ook voor de I: bij een IPE 300 S235
//! met V_z,Ed = 300 kN gaf dat M_y,V,Rd = 70,5 kNm waar (6.30) 130,7 kNm geeft,
//! en een ligger met M_y,Ed = 100 kNm werd ten onrechte afgekeurd.
//!
//! ## De unity check
//!
//! Eén definitie: UC = M_y,Ed / M_y,V,Rd, of het criterium nu voldoet of niet.
//! Tot oktober 2026 werd bij "voldoet niet" de evenredige overschrijding
//! gemeld (1/λ), zodat dezelfde toets twee soorten getallen gaf.
//!
//! Alleen waar M_y,Ed / M_y,V,Rd niet bestaat — V_Ed > V_pl,Rd, waar ρ > 1 en de
//! formules van 6.2.8 niet meer gelden, of een M_y,V,Rd van nul — is de UC de
//! evenredige overschrijding: de factor waardoor V_z,Ed en M_y,Ed samen gedeeld
//! moeten worden om op de grens te komen. Die is eindig en groter dan 1, en er
//! staat dan bovenaan "V_Ed ≥ V_pl,Rd: de doorsnede bezwijkt al op
//! dwarskracht".

use mechanics::ForceStateSnapshot;
use section_properties::SectionProperties;

use crate::classification::CrossSectionClass;
use crate::interactie::{evenredige_uc, Interactievorm};
use crate::opmaak::{lx, nl, nv, stap};
use crate::{CheckStatus, Deelstap, ResistanceCalc, SteelGrade, UnityCheck};

/// Het id van de toets.
pub const TOETS_MV: &str = "6.2.8_combined_mv";

/// EN 1993-1-1 art. 6.2.8(2) — mag het dwarskracht-effect op de
/// momentweerstand worden verwaarloosd?
///
/// Ja wanneer V_Ed ≤ V_pl,Rd/2. Alleen daarboven moet f_y worden gereduceerd
/// met (1 − ρ).
pub fn dwarskracht_verwaarloosbaar(v_ed_kn: f64, v_pl_rd_kn: f64) -> bool {
    v_ed_kn.abs() <= v_pl_rd_kn.abs() / 2.0
}

/// ρ van art. 6.2.8(3): 0 tot en met V_pl,Rd/2, daarboven
/// (2·V_Ed/V_pl,Rd − 1)².
pub fn rho(v_ed_kn: f64, v_pl_rd_kn: f64) -> f64 {
    if !(v_pl_rd_kn > 0.0) || dwarskracht_verwaarloosbaar(v_ed_kn, v_pl_rd_kn) {
        0.0
    } else {
        (2.0 * v_ed_kn.abs() / v_pl_rd_kn - 1.0).powi(2)
    }
}

/// De maten die (6.30) vraagt, als de doorsnede een I- of H-profiel met
/// gelijke flenzen is en alle maten bekend zijn: (A_w, t_w, W_pl,y, h_w).
fn maten_6_30(p: &SectionProperties, vorm: &Interactievorm) -> Option<(f64, f64, f64, f64)> {
    if !matches!(vorm, Interactievorm::I) {
        return None;
    }
    let h_w = p.h_mm - 2.0 * p.tf_mm;
    let ok = |v: f64| v.is_finite() && v > 0.0;
    (ok(h_w) && ok(p.tw_mm) && ok(p.wpl_y_mm3)).then(|| (h_w * p.tw_mm, p.tw_mm, p.wpl_y_mm3, h_w))
}

/// M_y,V,Rd in kNm bij een gegeven ρ (≤ 1): (6.30) voor de I met gelijke
/// flenzen, anders (1 − ρ)·M_y,c,Rd. Nooit boven M_y,c,Rd en nooit negatief.
fn m_y_v_rd(
    rho: f64,
    m_c_rd_knm: f64,
    grade: &SteelGrade,
    maten: Option<(f64, f64, f64, f64)>,
) -> f64 {
    if rho <= 0.0 {
        return m_c_rd_knm;
    }
    match maten {
        Some((a_w, t_w, w_pl, _)) => {
            let m = (w_pl - rho * a_w * a_w / (4.0 * t_w)) * grade.fy_mpa / grade.gamma_m0 * 1e-6;
            m.min(m_c_rd_knm).max(0.0)
        }
        None => (1.0 - rho).max(0.0) * m_c_rd_knm,
    }
}

/// §6.2.8 op één krachtentoestand: M_y,Ed tegen M_y,V,Rd.
///
/// `v_pl_rd_kn` is V_pl,z,Rd van 6.2.6, `m_c_rd_knm` de M_y,c,Rd van 6.2.5
/// (W_pl,y bij klasse 1 en 2, W_el,y bij klasse 3, W_eff,y bij klasse 4).
/// `vorm` beslist of (6.30) geldt: alleen bij [`Interactievorm::I`].
pub fn check_combined_mv(
    p: &SectionProperties,
    grade: &SteelGrade,
    _class: CrossSectionClass,
    vorm: &Interactievorm,
    v_pl_rd_kn: f64,
    m_c_rd_knm: f64,
    force_state: ForceStateSnapshot,
) -> ResistanceCalc {
    let v = force_state.forces.vz_ed.abs();
    let m = force_state.forces.my_ed.abs();
    let rho = rho(v, v_pl_rd_kn);
    let maten = maten_6_30(p, vorm);
    let bezweken_v = v > v_pl_rd_kn;
    // Boven V_pl,Rd is ρ > 1 en bestaat (6.30) niet meer; de weerstand wordt
    // dan niet uitgerekend maar als nul genomen (zie `voldoet`).
    let m_v_rd = if bezweken_v {
        0.0
    } else {
        m_y_v_rd(rho, m_c_rd_knm, grade, maten)
    };
    let voldoet = |v: f64, m: f64| -> bool {
        v <= v_pl_rd_kn
            && m <= m_y_v_rd(
                crate::combined_mv::rho(v, v_pl_rd_kn),
                m_c_rd_knm,
                grade,
                maten,
            )
    };
    // Eén definitie, M_y,Ed/M_y,V,Rd; de evenredige overschrijding alleen waar
    // die verhouding niet bestaat (V_Ed > V_pl,Rd of M_y,V,Rd = 0).
    let klassiek = !bezweken_v && (m_v_rd > 0.0 || m == 0.0);
    let uc = if klassiek {
        if m > 0.0 {
            m / m_v_rd
        } else {
            0.0
        }
    } else {
        evenredige_uc(|l| voldoet(l * v, l * m))
    };

    let mut notes: Vec<String> = Vec::new();
    if bezweken_v {
        notes.push(
            "V_Ed ≥ V_pl,Rd: de doorsnede bezwijkt al op dwarskracht; er is geen \
             momentweerstand over."
                .to_string(),
        );
    }
    if rho == 0.0 {
        notes.push(format!(
            "V_z,Ed = {} kN ≤ V_pl,z,Rd/2 = {} kN: de dwarskracht vermindert de momentweerstand \
             niet (6.2.8(2)), ρ = 0 en M_y,V,Rd = M_y,c,Rd = {} kNm.",
            nl(v, 3),
            nl(v_pl_rd_kn / 2.0, 3),
            nl(m_c_rd_knm, 3)
        ));
    } else if let Some((a_w, t_w, w_pl, h_w)) = maten {
        let m_630 = (w_pl - rho * a_w * a_w / (4.0 * t_w)) * grade.fy_mpa / grade.gamma_m0 * 1e-6;
        notes.push(format!(
            "V_z,Ed = {} kN > V_pl,z,Rd/2 = {} kN: ρ = (2·V_Ed/V_pl,Rd − 1)² = {} (6.2.8(3)). De \
             verlaagde vloeigrens (1 − ρ)·f_y geldt alleen voor het afschuifoppervlak, het lijf: \
             voor een I-profiel met gelijke flenzen en buiging om de sterke as is dat (6.30), \
             M_y,V,Rd = (W_pl,y − ρ·A_w²/(4·t_w))·f_y/γ_M0 met A_w = h_w·t_w = {} · {} = {} mm² \
             (h_w = h − 2·t_f). Dat geeft {} kNm{}.",
            nl(v, 3),
            nl(v_pl_rd_kn / 2.0, 3),
            nl(rho, 4),
            nl(h_w, 1),
            nl(t_w, 1),
            nl(a_w, 1),
            nl(m_630, 3),
            if m_630 > m_c_rd_knm {
                format!(
                    ", begrensd op M_y,c,Rd = {} kNm (6.2.8(5))",
                    nl(m_c_rd_knm, 3)
                )
            } else {
                String::new()
            }
        ));
    } else {
        notes.push(format!(
            "V_z,Ed = {} kN > V_pl,z,Rd/2 = {} kN: ρ = (2·V_Ed/V_pl,Rd − 1)² = {} (6.2.8(3)). De \
             norm verlaagt de vloeigrens tot (1 − ρ)·f_y voor het afschuifoppervlak, maar geeft \
             alleen voor een I-profiel met gelijke flenzen een uitgeschreven formule (6.30). Voor \
             deze doorsnede is de verlaagde vloeigrens op de HELE doorsnede gezet: M_y,V,Rd = \
             (1 − ρ)·M_y,c,Rd = {} kNm — de veilige kant.",
            nl(v, 3),
            nl(v_pl_rd_kn / 2.0, 3),
            nl(rho, 4),
            nl(m_v_rd, 3)
        ));
    }
    if !klassiek {
        notes.push(format!(
            "M_y,Ed/M_y,V,Rd bestaat hier niet (V_Ed > V_pl,Rd, of geen momentweerstand over). De \
             unity check is daarom de EVENREDIGE overschrijding: V_z,Ed en M_y,Ed moeten samen door \
             {} worden gedeeld om op de grens van 6.2.8 uit te komen.",
            nl(uc, 3)
        ));
    }

    let (formule_mv, ingevuld_mv, variabelen_mv) = match maten {
        Some((a_w, t_w, w_pl, _)) if rho > 0.0 => (
            r"M_{y,V,Rd} = \left( W_{pl,y} - \frac{\rho A_w^2}{4 t_w} \right) \frac{f_y}{\gamma_{M0}} \le M_{y,c,Rd}".to_string(),
            format!(
                r"M_{{y,V,Rd}} = \left( {} - \frac{{{} \cdot {}^2}}{{4 \cdot {}}} \right) \cdot \frac{{{}}}{{{}}} \cdot 10^{{-6}}",
                lx(w_pl, 0),
                lx(rho, 4),
                lx(a_w, 1),
                lx(t_w, 1),
                lx(grade.fy_mpa, 0),
                lx(grade.gamma_m0, 2)
            ),
            vec![
                nv(r"W_{pl,y}", w_pl, "mm³"),
                nv(r"\rho", rho, "-"),
                nv(r"A_w", a_w, "mm²"),
                nv(r"t_w", t_w, "mm"),
                nv(r"M_{y,c,Rd}", m_c_rd_knm, "kNm"),
            ],
        ),
        _ => (
            r"M_{y,V,Rd} = (1 - \rho) \cdot M_{y,c,Rd}".to_string(),
            format!(r"M_{{y,V,Rd}} = (1 - {}) \cdot {}", lx(rho, 4), lx(m_c_rd_knm, 3)),
            vec![nv(r"\rho", rho, "-"), nv(r"M_{y,c,Rd}", m_c_rd_knm, "kNm")],
        ),
    };

    let deelstappen: Vec<Deelstap> = vec![
        stap(
            "rho",
            "Invloed van de dwarskracht",
            r"\rho",
            if rho > 0.0 { "art. 6.2.8(3)" } else { "art. 6.2.8(2)" },
            r"\rho = \left( \frac{2 V_{z,Ed}}{V_{z,pl,Rd}} - 1 \right)^2 \quad (V_{z,Ed} > V_{z,pl,Rd}/2)".to_string(),
            if rho > 0.0 {
                format!(r"\rho = \left( \frac{{2 \cdot {}}}{{{}}} - 1 \right)^2", lx(v, 3), lx(v_pl_rd_kn, 3))
            } else {
                String::new()
            },
            vec![nv(r"V_{z,Ed}", v, "kN"), nv(r"V_{z,pl,Rd}", v_pl_rd_kn, "kN")],
            Some(rho),
            "-",
            if rho > 0.0 {
                vec![]
            } else {
                vec!["V_z,Ed ≤ V_z,pl,Rd/2: ρ = 0 (6.2.8(2)).".to_string()]
            },
        ),
        stap(
            "m_v_rd",
            "Momentweerstand met dwarskracht",
            r"M_{y,V,Rd}",
            if maten.is_some() && rho > 0.0 { "art. 6.2.8(5) (6.30)" } else { "art. 6.2.8(3)" },
            formule_mv.clone(),
            ingevuld_mv,
            variabelen_mv,
            Some(m_v_rd),
            "kNm",
            vec![],
        ),
    ];

    let (uc_ed, uc_rd, uc_formule) = if klassiek {
        (m, m_v_rd, r"M_{y,Ed} / M_{y,V,Rd}".to_string())
    } else {
        (uc, 1.0, r"1/\lambda".to_string())
    };

    ResistanceCalc {
        deelstappen,
        id: TOETS_MV.to_string(),
        title: "Buiging en dwarskracht".to_string(),
        article: if maten.is_some() && rho > 0.0 {
            "art. 6.2.8 (6.30)"
        } else {
            "art. 6.2.8"
        }
        .to_string(),
        force_state,
        formula_latex: formule_mv,
        variables: vec![
            nv(r"V_{z,Ed}", v, "kN"),
            nv(r"V_{z,pl,Rd}", v_pl_rd_kn, "kN"),
            nv(r"M_{y,c,Rd}", m_c_rd_knm, "kNm"),
            nv(r"\rho", rho, "-"),
            nv(r"M_{y,Ed}", m, "kNm"),
        ],
        value: m_v_rd,
        unit: "kNm".to_string(),
        uc: Some(UnityCheck {
            ed: uc_ed,
            rd: uc_rd,
            uc,
            formula_latex: uc_formule,
        }),
        status: if uc <= 1.0 {
            CheckStatus::Ok
        } else {
            CheckStatus::NotOk
        },
        notes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use mechanics::InternalForces;

    fn toestand(v: f64, m: f64) -> ForceStateSnapshot {
        ForceStateSnapshot {
            combination_id: 1,
            position_mm: 0.0,
            forces: InternalForces {
                vz_ed: v,
                my_ed: m,
                ..Default::default()
            },
        }
    }

    /// Een doorsnede zonder maten en zonder I-vorm: (1 − ρ)·M_y,c,Rd.
    fn toets(v: f64, m: f64) -> ResistanceCalc {
        let p = SectionProperties::default();
        check_combined_mv(
            &p,
            &crate::S235,
            CrossSectionClass::Class1,
            &Interactievorm::Lineair(String::new()),
            400.0,
            200.0,
            toestand(v, m),
        )
    }

    /// IPE 300 (catalogusmaten) met de (6.30)-formule.
    fn ipe300() -> SectionProperties {
        SectionProperties {
            area_mm2: 5381.0,
            h_mm: 300.0,
            b_mm: 150.0,
            tw_mm: 7.1,
            tf_mm: 10.7,
            r_mm: 15.0,
            wpl_y_mm3: 628.0e3,
            ..Default::default()
        }
    }

    /// Tot en met V_pl,Rd/2 geen reductie: UC = M/M_c,Rd.
    #[test]
    fn onder_de_helft_geen_reductie() {
        let r = toets(200.0, 150.0);
        assert_eq!(r.value, 200.0);
        assert_relative_eq!(r.uc.unwrap().uc, 0.75, max_relative = 1e-12);
    }

    /// V = 300 van V_pl = 400: ρ = (1,5 − 1)² = 0,25, M_V,Rd = 0,75·200 = 150;
    /// M = 120 → UC = 120/150 = 0,8.
    #[test]
    fn boven_de_helft_met_rho() {
        let r = toets(300.0, 120.0);
        assert_relative_eq!(r.value, 150.0, max_relative = 1e-12);
        assert_relative_eq!(r.uc.unwrap().uc, 0.8, max_relative = 1e-12);
    }

    /// Voldoet niet: V = 300, M = 160 > 150. Eén UC-definitie, ook bij
    /// "voldoet niet": UC = M_y,Ed/M_y,V,Rd = 160/150 = 1,0667. Tot oktober 2026
    /// stond hier de evenredige overschrijding 2,25/2,2 = 1,0227 (controle
    /// 2026-10, punt B6: twee definities in één toets).
    #[test]
    fn voldoet_niet_met_dezelfde_verhouding() {
        let r = toets(300.0, 160.0);
        let uc = r.uc.as_ref().unwrap();
        assert_relative_eq!(uc.uc, 160.0 / 150.0, max_relative = 1e-12);
        assert_eq!((uc.ed, uc.rd), (160.0, 150.0));
        assert_eq!(r.status, CheckStatus::NotOk);
    }

    /// Voldoet niet zonder dwarskrachtinvloed (V ≤ V_pl,Rd/2): de UC is dan
    /// gewoon M/M_c,Rd = 250/200 = 1,25, als die verhouding opgeschreven.
    #[test]
    fn voldoet_niet_zonder_rho_blijft_de_verhouding() {
        let r = toets(150.0, 250.0);
        let uc = r.uc.as_ref().unwrap();
        assert_relative_eq!(uc.uc, 1.25, max_relative = 1e-12);
        assert_eq!((uc.ed, uc.rd), (250.0, 200.0));
    }

    /// Boven V_pl,Rd: eindige UC en de melding bovenaan. Zonder moment is de
    /// evenredige UC precies V/V_pl,Rd = 500/400 = 1,25.
    #[test]
    fn boven_v_pl_bezweken() {
        let r = toets(500.0, 0.0);
        assert_relative_eq!(r.uc.as_ref().unwrap().uc, 1.25, max_relative = 1e-9);
        assert!(r.notes[0].starts_with("V_Ed ≥ V_pl,Rd: de doorsnede bezwijkt al op dwarskracht"));
    }

    /// Controle 2026-10, punt B6: IPE 300 S235, V_z,Ed = 300 kN, V_pl,z,Rd =
    /// 348,42 kN (A_v = 2568 mm²). Met de hand:
    ///   ρ = (2·300/348,42 − 1)² = 0,5214;
    ///   A_w = (300 − 2·10,7)·7,1 = 1978,06 mm²;
    ///   M_y,V,Rd = (628 000 − 0,5214·1978,06²/(4·7,1))·235·10⁻⁶ = 130,70 kNm.
    /// M_y,Ed = 100 kNm → UC 0,765 (voldoet); 200 kNm → UC 1,530.
    #[test]
    fn ipe300_volgens_6_30() {
        let p = ipe300();
        let v_pl = 2568.0 * 235.0 / 3f64.sqrt() * 1e-3;
        let m_c = 628.0e3 * 235.0 * 1e-6;
        let rho_hand = (2.0 * 300.0 / v_pl - 1.0f64).powi(2);
        let m_v_hand = (628.0e3 - rho_hand * 1978.06f64.powi(2) / (4.0 * 7.1)) * 235.0 * 1e-6;
        assert_relative_eq!(m_v_hand, 130.70, max_relative = 1e-4);
        for (m, uc_hand, status) in [
            (100.0, 0.765, CheckStatus::Ok),
            (200.0, 1.530, CheckStatus::NotOk),
        ] {
            let r = check_combined_mv(
                &p,
                &crate::S235,
                CrossSectionClass::Class1,
                &Interactievorm::I,
                v_pl,
                m_c,
                toestand(300.0, m),
            );
            assert_relative_eq!(r.value, m_v_hand, max_relative = 1e-9);
            let uc = r.uc.as_ref().unwrap();
            assert_relative_eq!(uc.uc, m / m_v_hand, max_relative = 1e-12);
            assert_relative_eq!(uc.uc, uc_hand, max_relative = 2e-3);
            assert_eq!(uc.formula_latex, r"M_{y,Ed} / M_{y,V,Rd}");
            assert_eq!(r.status, status);
        }
    }

    /// (6.30) nooit boven M_y,c,Rd: bij klasse 3 is dat W_el,y·f_y.
    #[test]
    fn formule_6_30_begrensd_op_m_c_rd() {
        let p = ipe300();
        let v_pl = 2568.0 * 235.0 / 3f64.sqrt() * 1e-3;
        // V net boven de helft: ρ klein, (6.30) ligt dan boven W_el,y·f_y.
        let m_el = 557.0e3 * 235.0 * 1e-6;
        let r = check_combined_mv(
            &p,
            &crate::S235,
            CrossSectionClass::Class3,
            &Interactievorm::I,
            v_pl,
            m_el,
            toestand(0.51 * v_pl, 50.0),
        );
        assert_relative_eq!(r.value, m_el, max_relative = 1e-12);
    }
}
