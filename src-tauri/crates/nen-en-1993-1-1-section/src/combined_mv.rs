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
//! M_y,V,Rd = (1 − ρ)·M_y,c,Rd
//! ```
//!
//! De verlaagde vloeigrens (1 − ρ)·f_y staat hier op de HELE doorsnede. De
//! norm verlaagt alleen het afschuifoppervlak; voor een I-profiel met gelijke
//! flenzen geeft (6.30) daarom een hogere M_y,V,Rd. Dit is de veilige kant, en
//! dezelfde afspraak als in 6.2.10 (`interactie`).
//!
//! De unity check volgt de afspraak van `interactie`: voldoet het criterium,
//! dan M_y,Ed/M_y,V,Rd; voldoet het niet, dan de EVENREDIGE overschrijding —
//! de factor waardoor V_z,Ed en M_y,Ed samen gedeeld moeten worden om op de
//! grens te komen. Die is eindig, precies 1 op de grens, en loopt niet naar
//! oneindig als V_Ed naar V_pl,Rd gaat. Zonder reductie (ρ = 0) valt hij samen
//! met M_y,Ed/M_y,c,Rd en staat hij er ook zo. Bij V_Ed > V_pl,Rd staat bovenaan
//! "V_Ed ≥ V_pl,Rd: de doorsnede bezwijkt al op dwarskracht". Met N_Ed = 0 en
//! alleen buiging om y komt 6.2.10 zo op dezelfde uitkomst.

use mechanics::ForceStateSnapshot;
use section_properties::SectionProperties;

use crate::classification::CrossSectionClass;
use crate::interactie::evenredige_uc;
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

/// Voldoet 6.2.8 bij V_z,Ed = `v` en M_y,Ed = `m` (beide ≥ 0)? Boven V_pl,Rd
/// is er geen weerstand meer over.
fn voldoet(v: f64, m: f64, v_pl: f64, m_c: f64) -> bool {
    v <= v_pl && m <= (1.0 - rho(v, v_pl)).max(0.0) * m_c
}

/// §6.2.8 op één krachtentoestand: M_y,Ed tegen M_y,V,Rd = (1 − ρ)·M_y,c,Rd.
///
/// `v_pl_rd_kn` is V_pl,z,Rd van 6.2.6, `m_c_rd_knm` de M_y,c,Rd van 6.2.5
/// (W_pl,y bij klasse 1 en 2, W_el,y bij klasse 3).
pub fn check_combined_mv(
    _p: &SectionProperties, _grade: &SteelGrade, _class: CrossSectionClass,
    v_pl_rd_kn: f64, m_c_rd_knm: f64,
    force_state: ForceStateSnapshot,
) -> ResistanceCalc {
    let v = force_state.forces.vz_ed.abs();
    let m = force_state.forces.my_ed.abs();
    let rho = rho(v, v_pl_rd_kn);
    let factor = (1.0 - rho).max(0.0);
    let m_v_rd = factor * m_c_rd_knm;
    let bezweken_v = v > v_pl_rd_kn;
    let ok = voldoet(v, m, v_pl_rd_kn, m_c_rd_knm);
    // Zonder reductie (ρ = 0, dus V ≤ V_pl,Rd/2) is de evenredige
    // overschrijding precies M_y,Ed/M_y,c,Rd: wie V en M samen verkleint, houdt
    // ρ op nul. Dan staat de UC er gewoon als die verhouding.
    let klassiek = ok || rho == 0.0;
    let uc = if klassiek {
        if m > 0.0 { m / m_v_rd } else { 0.0 }
    } else {
        evenredige_uc(|l| voldoet(l * v, l * m, v_pl_rd_kn, m_c_rd_knm))
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
    } else {
        notes.push(format!(
            "V_z,Ed = {} kN > V_pl,z,Rd/2 = {} kN: ρ = (2·V_Ed/V_pl,Rd − 1)² = {} (6.2.8(3)). De \
             verlaagde vloeigrens (1 − ρ)·f_y is op de HELE doorsnede gezet: M_y,V,Rd = \
             (1 − ρ)·M_y,c,Rd = {} kNm. De norm verlaagt alleen het afschuifoppervlak (voor een \
             I-profiel met gelijke flenzen geeft (6.30) meer); dit is de veilige kant.",
            nl(v, 3),
            nl(v_pl_rd_kn / 2.0, 3),
            nl(rho, 4),
            nl(m_v_rd, 3)
        ));
    }
    if !klassiek {
        notes.push(format!(
            "Het criterium voldoet niet. De unity check is de EVENREDIGE overschrijding: V_z,Ed en \
             M_y,Ed moeten samen door {} worden gedeeld om op de grens van 6.2.8 uit te komen. Dat \
             getal is eindig en precies 1,0 op de grens; M_y,Ed/M_y,V,Rd zou bij V_Ed → V_pl,Rd \
             naar oneindig lopen.",
            nl(uc, 3)
        ));
    }

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
            "art. 6.2.8(3)",
            r"M_{y,V,Rd} = (1 - \rho) \cdot M_{y,c,Rd}".to_string(),
            format!(r"M_{{y,V,Rd}} = (1 - {}) \cdot {}", lx(rho, 4), lx(m_c_rd_knm, 3)),
            vec![nv(r"\rho", rho, "-"), nv(r"M_{y,c,Rd}", m_c_rd_knm, "kNm")],
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
        article: "art. 6.2.8".to_string(),
        force_state,
        formula_latex: r"M_{y,V,Rd} = (1 - \rho) \cdot M_{y,c,Rd}".to_string(),
        variables: vec![
            nv(r"V_{z,Ed}", v, "kN"),
            nv(r"V_{z,pl,Rd}", v_pl_rd_kn, "kN"),
            nv(r"M_{y,c,Rd}", m_c_rd_knm, "kNm"),
            nv(r"\rho", rho, "-"),
            nv(r"M_{y,Ed}", m, "kNm"),
        ],
        value: m_v_rd,
        unit: "kNm".to_string(),
        uc: Some(UnityCheck { ed: uc_ed, rd: uc_rd, uc, formula_latex: uc_formule }),
        status: if uc <= 1.0 { CheckStatus::Ok } else { CheckStatus::NotOk },
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
            forces: InternalForces { vz_ed: v, my_ed: m, ..Default::default() },
        }
    }

    fn toets(v: f64, m: f64) -> ResistanceCalc {
        let p = SectionProperties::default();
        check_combined_mv(&p, &crate::S235, CrossSectionClass::Class1, 400.0, 200.0, toestand(v, m))
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

    /// Voldoet niet: V = 300, M = 160 > 150. De evenredige UC λ* volgt uit
    /// 160λ = 200·(1 − (1,5λ − 1)²): 2,25λ² − 2,2λ = 0 → λ* = 2,2/2,25 =
    /// 0,977778 (de wortel boven 1/1,5, waar ρ meedoet), UC = 1/λ* = 1,022727.
    #[test]
    fn voldoet_niet_evenredig() {
        let r = toets(300.0, 160.0);
        assert_relative_eq!(r.uc.as_ref().unwrap().uc, 2.25 / 2.2, max_relative = 1e-9);
        assert_eq!(r.status, CheckStatus::NotOk);
        assert!(r.notes.iter().any(|t| t.starts_with("Het criterium voldoet niet")));
    }

    /// Voldoet niet zonder dwarskrachtinvloed (V ≤ V_pl,Rd/2): de UC is dan
    /// gewoon M/M_c,Rd = 250/200 = 1,25, als die verhouding opgeschreven.
    #[test]
    fn voldoet_niet_zonder_rho_blijft_de_verhouding() {
        let r = toets(150.0, 250.0);
        let uc = r.uc.as_ref().unwrap();
        assert_relative_eq!(uc.uc, 1.25, max_relative = 1e-12);
        assert_eq!((uc.ed, uc.rd), (250.0, 200.0));
        assert!(r.notes.iter().all(|t| !t.starts_with("Het criterium voldoet niet")));
    }

    /// Boven V_pl,Rd: eindige UC en de melding bovenaan. Zonder moment is de
    /// evenredige UC precies V/V_pl,Rd = 500/400 = 1,25.
    #[test]
    fn boven_v_pl_bezweken() {
        let r = toets(500.0, 0.0);
        assert_relative_eq!(r.uc.as_ref().unwrap().uc, 1.25, max_relative = 1e-9);
        assert!(r.notes[0].starts_with("V_Ed ≥ V_pl,Rd: de doorsnede bezwijkt al op dwarskracht"));
    }
}
