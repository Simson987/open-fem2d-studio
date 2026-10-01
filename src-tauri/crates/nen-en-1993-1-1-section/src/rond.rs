//! Massief rond staal (reeks "RD") — buiging gecombineerd met dwarskracht en
//! normaalkracht, §6.2.8, §6.2.9 en §6.2.10.
//!
//! ## Waarom een eigen uitwerking
//!
//! §6.2.9.1(5) geeft benaderingen van M_N,Rd voor I- en H-profielen en voor
//! kokers (zie `crate::interactie`), met het lijfaandeel a van die vormen. Een
//! massieve cirkel heeft geen lijf en geen flens, en §6.2.9.1 geeft voor haar
//! geen formule (wel voor de massieve RECHTHOEK, (6.32)). Dan geldt
//! §6.2.9.1(2) zelf: M_Ed ≤ M_N,Rd, met M_N,Rd "het rekenwaarde van het
//! plastisch moment, gereduceerd door de normaalkracht". Die reductie is voor
//! een cirkel exact af te leiden, en dat gebeurt hier.
//!
//! De unity check volgt dezelfde afspraak als `crate::interactie`: M_Ed/M_Rd
//! zolang het criterium voldoet, de evenredige overschrijding als het niet
//! voldoet.
//!
//! ## De plastische interactie van een massieve cirkel
//!
//! Volledig plastisch staat de doorsnede aan de ene kant van een rechte lijn op
//! +f_y en aan de andere kant op −f_y. Ligt die lijn op afstand r·cos β van het
//! middelpunt, dan is het kleinste deel een cirkelsegment met halve
//! middelpuntshoek β, met oppervlak A_s = r²(β − sin β·cos β) en statisch
//! moment (2/3)·r³·sin³β om het middelpunt. Daaruit:
//!
//! ```text
//!   n = N/N_pl = 1 − (2/π)·(β − sin β · cos β)
//!   m = M/M_pl = sin³β
//! ```
//!
//! (β = π/2: lijn door het middelpunt, n = 0 en m = 1; β = 0: n = 1, m = 0.)
//! Voor een gegeven n wordt β numeriek opgelost (n is monotoon dalend in β) en
//! M_N,Rd = M_pl,Rd·sin³β. Ter vergelijking bij n = 0,5: sin³β = 0,765, waar
//! de lineaire interactie (6.2) 0,5 zou geven.
//!
//! ## Buiging om twee assen
//!
//! Een cirkel heeft om elke as dezelfde weerstand. Buiging om y én z is dus
//! buiging om de resultante: M_Ed = √(M_y,Ed² + M_z,Ed²). Dat is precies
//! §6.2.9.1(6) met α = β = 2, de exponenten die de norm voor ronde doorsneden
//! geeft. De dwarskracht telt op dezelfde manier: V_Ed = √(V_y,Ed² + V_z,Ed²).
//!
//! ## Dwarskracht (§6.2.8, §6.2.10)
//!
//! Boven V_Ed > V_pl,Rd/2 rekent de norm met een gereduceerde vloeigrens
//! (1 − ρ)·f_y "voor het afschuifoppervlak". Bij een massieve cirkel is het
//! afschuifoppervlak (0,75·A, zie de catalogus) geen aanwijsbaar deel van de
//! doorsnede; de reductie wordt daarom op de HELE doorsnede toegepast. Dat is
//! de veilige kant: N_pl,Rd en M_pl,Rd gaan allebei met (1 − ρ) omlaag.

use std::f64::consts::PI;

use mechanics::ForceStateSnapshot;
use section_properties::SectionProperties;

use crate::opmaak::{lx, nl, nv, stap};
use crate::{CheckStatus, Deelstap, NamedValue, ResistanceCalc, SteelGrade, UnityCheck};

/// Welke van de drie combinaties.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RondCombinatie {
    /// §6.2.8: buiging en dwarskracht.
    BuigingDwarskracht,
    /// §6.2.9: buiging en normaalkracht.
    BuigingNormaalkracht,
    /// §6.2.10: buiging, normaal- en dwarskracht.
    BuigingNormaalDwars,
}

impl RondCombinatie {
    pub fn id(self) -> &'static str {
        match self {
            Self::BuigingDwarskracht => "6.2.8_combined_mv",
            Self::BuigingNormaalkracht => "6.2.9_combined_mn",
            Self::BuigingNormaalDwars => "6.2.10_combined_mnv",
        }
    }

    fn titel(self) -> &'static str {
        match self {
            Self::BuigingDwarskracht => "Buiging en dwarskracht (massief rond)",
            Self::BuigingNormaalkracht => "Buiging en normaalkracht (massief rond)",
            Self::BuigingNormaalDwars => "Buiging, normaal- en dwarskracht (massief rond)",
        }
    }

    fn artikel(self) -> &'static str {
        match self {
            Self::BuigingDwarskracht => "art. 6.2.8",
            Self::BuigingNormaalkracht => "art. 6.2.9.1(2)",
            Self::BuigingNormaalDwars => "art. 6.2.10",
        }
    }

    fn met_normaalkracht(self) -> bool {
        !matches!(self, Self::BuigingDwarskracht)
    }

    fn met_dwarskracht(self) -> bool {
        !matches!(self, Self::BuigingNormaalkracht)
    }
}

/// β (rad) en m = M_N,Rd/M_pl,Rd bij een relatieve normaalkracht `n`, voor
/// een massieve cirkel; zie de moduletekst. Voor n ≤ 0 is β = π/2 en m = 1,
/// voor n ≥ 1 is β = 0 en m = 0.
pub fn interactie_rond(n: f64) -> (f64, f64) {
    if !(n > 0.0) {
        return (PI / 2.0, 1.0);
    }
    if n >= 1.0 {
        return (0.0, 0.0);
    }
    // n(β) = 1 − (2/π)(β − sin β cos β) daalt monotoon van 1 (β = 0) naar
    // 0 (β = π/2): halveren tot op de machineprecisie.
    let n_van = |b: f64| 1.0 - 2.0 / PI * (b - b.sin() * b.cos());
    let (mut lo, mut hi) = (0.0_f64, PI / 2.0);
    for _ in 0..200 {
        let mid = 0.5 * (lo + hi);
        if n_van(mid) > n {
            lo = mid;
        } else {
            hi = mid;
        }
        if hi - lo < 1e-15 {
            break;
        }
    }
    let beta = 0.5 * (lo + hi);
    (beta, beta.sin().powi(3))
}

/// De kern van [`combinatie_rond`] op één krachtentoestand: het resulterende
/// moment M_Ed, de gereduceerde momentweerstand, 1 − ρ en n — precies zoals
/// de toets ze rekent. De evenredige unity check roept dit aan met geschaalde
/// snedekrachten.
fn kern(
    p: &SectionProperties,
    grade: &SteelGrade,
    soort: RondCombinatie,
    f: &mechanics::InternalForces,
) -> (f64, f64, f64, f64) {
    let n_ed = if soort.met_normaalkracht() { f.n_ed.abs() } else { 0.0 };
    let m_ed = f.my_ed.hypot(f.mz_ed);
    let v_ed = if soort.met_dwarskracht() { f.vy_ed.hypot(f.vz_ed) } else { 0.0 };
    let n_pl_rd = p.area_mm2 * grade.fy_mpa / grade.gamma_m0 * 1e-3;
    let m_pl_rd = p.wpl_y_mm3 * grade.fy_mpa / grade.gamma_m0 * 1e-6;
    let v_pl_rd = p.av_z_mm2 * (grade.fy_mpa / 3f64.sqrt()) / grade.gamma_m0 * 1e-3;
    let rho = if soort.met_dwarskracht() && v_ed > 0.5 * v_pl_rd {
        (2.0 * v_ed / v_pl_rd - 1.0).powi(2)
    } else {
        0.0
    };
    let factor = 1.0 - rho;
    let n_pl_red = factor * n_pl_rd;
    let n_rel = if n_ed <= 0.0 {
        0.0
    } else if n_pl_red > 0.0 {
        n_ed / n_pl_red
    } else {
        f64::INFINITY
    };
    let (_, m_fac) = interactie_rond(n_rel);
    (m_ed, factor.max(0.0) * m_pl_rd * m_fac, factor, n_rel)
}

/// De toets op één punt van de omhullende. De aanroeper loopt de omhullende
/// af en houdt de hoogste unity check; de notitie welk punt dat is, zet hij er
/// zelf bij.
pub fn combinatie_rond(
    p: &SectionProperties,
    grade: &SteelGrade,
    soort: RondCombinatie,
    force_state: ForceStateSnapshot,
) -> ResistanceCalc {
    let f = &force_state.forces;
    let n_ed = if soort.met_normaalkracht() { f.n_ed.abs() } else { 0.0 };
    let m_ed = f.my_ed.hypot(f.mz_ed);
    let v_ed = if soort.met_dwarskracht() { f.vy_ed.hypot(f.vz_ed) } else { 0.0 };

    let n_pl_rd = p.area_mm2 * grade.fy_mpa / grade.gamma_m0 * 1e-3;
    let m_pl_rd = p.wpl_y_mm3 * grade.fy_mpa / grade.gamma_m0 * 1e-6;
    let v_pl_rd = p.av_z_mm2 * (grade.fy_mpa / 3f64.sqrt()) / grade.gamma_m0 * 1e-3;

    let mut notes: Vec<String> = Vec::new();
    let mut deelstappen: Vec<Deelstap> = Vec::new();

    // ── Dwarskracht: ρ (6.2.8(3)) ─────────────────────────────────────────
    let rho = if soort.met_dwarskracht() && v_ed > 0.5 * v_pl_rd {
        (2.0 * v_ed / v_pl_rd - 1.0).powi(2)
    } else {
        0.0
    };
    if soort.met_dwarskracht() {
        let v_regel = format!(
            "V_Ed = √(V_y,Ed² + V_z,Ed²) = √({}² + {}²) = {} kN; V_pl,Rd = A_v·f_y/(√3·γ_M0) = {} kN \
             met A_v = 0,75·A.",
            nl(f.vy_ed, 3),
            nl(f.vz_ed, 3),
            nl(v_ed, 3),
            nl(v_pl_rd, 3)
        );
        notes.push(if rho == 0.0 {
            format!("{v_regel} V_Ed ≤ V_pl,Rd/2: de dwarskracht vermindert de momentweerstand niet (6.2.8(2)), ρ = 0.")
        } else {
            format!(
                "{v_regel} V_Ed > V_pl,Rd/2: ρ = (2·V_Ed/V_pl,Rd − 1)² = {} (6.2.8(3)); de vloeigrens \
                 is over de HELE doorsnede met (1 − ρ) verminderd — bij een massieve cirkel is het \
                 afschuifoppervlak geen aanwijsbaar deel, en dit is de veilige kant.",
                nl(rho, 4)
            )
        });
        deelstappen.push(stap(
            "rho",
            "Invloed van de dwarskracht",
            r"\rho",
            "art. 6.2.8(3)",
            r"\rho = \left( \frac{2 V_{Ed}}{V_{pl,Rd}} - 1 \right)^2 \quad (V_{Ed} > V_{pl,Rd}/2)".to_string(),
            if rho > 0.0 {
                format!(
                    r"\rho = \left( \frac{{2 \cdot {}}}{{{}}} - 1 \right)^2",
                    lx(v_ed, 3),
                    lx(v_pl_rd, 3)
                )
            } else {
                String::new()
            },
            vec![nv(r"V_{Ed}", v_ed, "kN"), nv(r"V_{pl,Rd}", v_pl_rd, "kN")],
            Some(rho),
            "-",
            vec![],
        ));
    }
    let factor = 1.0 - rho;

    // ── Normaalkracht: n, β en m (6.2.9.1(2)) ──────────────────────────────
    let n_pl_red = factor * n_pl_rd;
    let n_rel = if soort.met_normaalkracht() && n_pl_red > 0.0 { n_ed / n_pl_red } else { 0.0 };
    let (beta, m_fac) = interactie_rond(n_rel);
    if soort.met_normaalkracht() {
        deelstappen.push(stap(
            "n",
            "Relatieve normaalkracht",
            "n",
            "art. 6.2.9.1",
            if rho > 0.0 {
                r"n = \frac{N_{Ed}}{(1 - \rho) \cdot N_{pl,Rd}}".to_string()
            } else {
                r"n = \frac{N_{Ed}}{N_{pl,Rd}}".to_string()
            },
            if rho > 0.0 {
                format!(r"n = \frac{{{}}}{{{} \cdot {}}}", lx(n_ed, 3), lx(factor, 4), lx(n_pl_rd, 3))
            } else {
                format!(r"n = \frac{{{}}}{{{}}}", lx(n_ed, 3), lx(n_pl_rd, 3))
            },
            vec![nv(r"N_{Ed}", n_ed, "kN"), nv(r"N_{pl,Rd}", n_pl_rd, "kN")],
            Some(n_rel),
            "-",
            vec!["N_Ed als absolute waarde: trek en druk verminderen de momentweerstand even veel.".to_string()],
        ));
        deelstappen.push(stap(
            "beta",
            "Ligging van de plastische neutrale lijn",
            r"\beta",
            "art. 6.2.9.1(2)",
            r"n = 1 - \frac{2}{\pi} \left( \beta - \sin\beta \cos\beta \right)".to_string(),
            String::new(),
            vec![nv("n", n_rel, "-")],
            Some(beta),
            "rad",
            vec![
                "β is de halve middelpuntshoek van het cirkelsegment aan de andere kant van de \
                 plastische neutrale lijn; hij is numeriek uit deze vergelijking opgelost. β = π/2 \
                 is zuivere buiging (n = 0)."
                    .to_string(),
            ],
        ));
    }

    // ── Momentweerstand en belasting ───────────────────────────────────────
    let m_rd = factor * m_pl_rd * m_fac;
    let (formule, rd_symbool) = match soort {
        RondCombinatie::BuigingDwarskracht => (r"M_{V,Rd} = (1 - \rho) \cdot M_{pl,Rd}", "M_{V,Rd}"),
        RondCombinatie::BuigingNormaalkracht => (r"M_{N,Rd} = M_{pl,Rd} \cdot \sin^3(\beta)", "M_{N,Rd}"),
        RondCombinatie::BuigingNormaalDwars => {
            (r"M_{N,V,Rd} = (1 - \rho) \cdot M_{pl,Rd} \cdot \sin^3(\beta)", "M_{N,V,Rd}")
        }
    };
    deelstappen.push(stap(
        "m_rd",
        "Gereduceerde momentweerstand",
        rd_symbool,
        soort.artikel(),
        formule.to_string(),
        match soort {
            RondCombinatie::BuigingDwarskracht => {
                format!(r"{rd_symbool} = {} \cdot {}", lx(factor, 4), lx(m_pl_rd, 3))
            }
            RondCombinatie::BuigingNormaalkracht => {
                format!(r"{rd_symbool} = {} \cdot \sin^3({})", lx(m_pl_rd, 3), lx(beta, 4))
            }
            RondCombinatie::BuigingNormaalDwars => format!(
                r"{rd_symbool} = {} \cdot {} \cdot \sin^3({})",
                lx(factor, 4),
                lx(m_pl_rd, 3),
                lx(beta, 4)
            ),
        },
        {
            let mut v = vec![nv(r"M_{pl,Rd}", m_pl_rd, "kNm")];
            if soort.met_dwarskracht() {
                v.push(nv(r"\rho", rho, "-"));
            }
            if soort.met_normaalkracht() {
                v.push(nv(r"\beta", beta, "rad"));
            }
            v
        },
        Some(m_rd),
        "kNm",
        vec![format!(
            "M_pl,Rd = W_pl·f_y/γ_M0 = {} kNm, met W_pl = d³/6 om elke as.",
            nl(m_pl_rd, 3)
        )],
    ));
    deelstappen.push(stap(
        "m_ed",
        "Resulterend moment",
        r"M_{Ed}",
        "art. 6.2.9.1(6)",
        r"M_{Ed} = \sqrt{M_{y,Ed}^2 + M_{z,Ed}^2}".to_string(),
        format!(r"M_{{Ed}} = \sqrt{{{}^2 + {}^2}}", lx(f.my_ed, 3), lx(f.mz_ed, 3)),
        vec![nv(r"M_{y,Ed}", f.my_ed, "kNm"), nv(r"M_{z,Ed}", f.mz_ed, "kNm")],
        Some(m_ed),
        "kNm",
        vec![
            "Een cirkel heeft om elke as dezelfde weerstand, dus buiging om twee assen is buiging \
             om de resultante — §6.2.9.1(6) met α = β = 2."
                .to_string(),
        ],
    ));

    // ── Unity check ─────────────────────────────────────────────────────────
    //
    // Zolang het criterium voldoet: M_Ed/M_Rd. Voldoet het niet, dan de
    // evenredige overschrijding (zie `crate::interactie`): de factor waardoor
    // alle snedekrachten samen gedeeld moeten worden om op de interactiegrens
    // uit te komen. Eindig, precies 1,0 op de grens en nooit kleiner dan n —
    // ook als er geen momentweerstand meer over is (n ≥ 1 of ρ ≥ 1), waar
    // M_Ed/M_Rd niet bestaat.
    let voldoet = |f: &mechanics::InternalForces| -> bool {
        let (m_ed, m_rd, factor, n_rel) = kern(p, grade, soort, f);
        factor > 0.0 && n_rel <= 1.0 && (m_ed <= 0.0 || m_ed <= m_rd)
    };
    let uc = if voldoet(f) {
        if m_ed > 0.0 && m_rd > 0.0 { m_ed / m_rd } else { 0.0 }
    } else {
        crate::interactie::evenredige_uc(|l| {
            let mut g = *f;
            g.n_ed *= l;
            g.vy_ed *= l;
            g.vz_ed *= l;
            g.my_ed *= l;
            g.mz_ed *= l;
            voldoet(&g)
        })
    };
    let (uc_ed, uc_rd, uc_formule) = if voldoet(f) {
        (m_ed, m_rd, format!(r"M_{{Ed}} / {rd_symbool}"))
    } else {
        (uc, 1.0, r"1/\lambda".to_string())
    };
    // Bezwijkt de doorsnede al op normaal- of dwarskracht alleen, dan staat
    // dat bovenaan.
    if factor <= 0.0 {
        notes.insert(
            0,
            "V_Ed ≥ V_pl,Rd: de doorsnede bezwijkt al op dwarskracht; er is geen \
             momentweerstand over."
                .to_string(),
        );
    } else if n_rel >= 1.0 && uc > 1.0 {
        notes.insert(0, format!(
            "{} (n = {} ≥ 1). Er is geen momentweerstand over.",
            crate::interactie::MELDING_BEZWIJKT_OP_NORMAALKRACHT,
            nl(n_rel, 3)
        ));
    }
    if uc > 1.0 {
        notes.push(format!(
            "Het criterium voldoet niet. De unity check is de EVENREDIGE overschrijding: alle \
             snedekrachten (N, V en M) moeten samen door {} worden gedeeld om op de \
             interactiegrens uit te komen. Dat getal is eindig, is precies 1,0 op de grens en is \
             nooit kleiner dan n.",
            nl(uc, 3)
        ));
    }
    if soort.met_normaalkracht() {
        notes.push(format!(
            "Plastische interactie van een massieve cirkel: n = 1 − (2/π)(β − sin β·cos β), \
             M_N,Rd = M_pl,Rd·sin³β. Hier n = {}, β = {} rad, sin³β = {}. §6.2.9.1 geeft voor \
             massief rond geen benaderingsformule; (6.36) met de lijffractie a van een I is op deze \
             doorsnede niet van toepassing.",
            nl(n_rel, 4),
            nl(beta, 4),
            nl(m_fac, 4)
        ));
    }

    ResistanceCalc {
        deelstappen,
        id: soort.id().to_string(),
        title: soort.titel().to_string(),
        article: soort.artikel().to_string(),
        force_state,
        formula_latex: formule.to_string(),
        variables: {
            let mut v: Vec<NamedValue> = Vec::new();
            if soort.met_normaalkracht() {
                v.push(nv(r"N_{Ed}", n_ed, "kN"));
                v.push(nv(r"N_{pl,Rd}", n_pl_rd, "kN"));
                v.push(nv(r"\beta", beta, "rad"));
            }
            if soort.met_dwarskracht() {
                v.push(nv(r"V_{Ed}", v_ed, "kN"));
                v.push(nv(r"V_{pl,Rd}", v_pl_rd, "kN"));
                v.push(nv(r"\rho", rho, "-"));
            }
            v.push(nv(r"M_{pl,Rd}", m_pl_rd, "kNm"));
            v.push(nv(r"M_{Ed}", m_ed, "kNm"));
            v
        },
        value: m_rd,
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

    /// Twee punten van de exacte kromme, met de hand uit β:
    ///   β = π/3: n = 1 − (2/π)(π/3 − (√3/2)(1/2)) = 1 − (2/π)·0,614185 = 0,608998,
    ///            m = (√3/2)³ = 0,649519;
    ///   β = π/4: n = 1 − (2/π)(π/4 − 1/2) = 1 − (2/π)·0,285398 = 0,818310,
    ///            m = (1/√2)³ = 0,353553.
    #[test]
    fn interactie_raakt_de_exacte_kromme() {
        let (b1, m1) = interactie_rond(0.608_997_79);
        assert_relative_eq!(b1, PI / 3.0, max_relative = 1e-6);
        assert_relative_eq!(m1, 0.649_519, max_relative = 1e-5);
        let (b2, m2) = interactie_rond(0.818_309_9);
        assert_relative_eq!(b2, PI / 4.0, max_relative = 1e-6);
        assert_relative_eq!(m2, 0.353_553, max_relative = 1e-5);
        assert_eq!(interactie_rond(0.0), (PI / 2.0, 1.0));
        assert_eq!(interactie_rond(1.0), (0.0, 0.0));
    }

    /// De exacte kromme ligt overal op of boven de lineaire interactie
    /// m = 1 − n (6.2) — anders zou zij niet de plastische grens kunnen zijn.
    #[test]
    fn exacte_kromme_ligt_boven_de_lineaire() {
        for k in 1..100 {
            let n = k as f64 / 100.0;
            let (_, m) = interactie_rond(n);
            assert!(m >= 1.0 - n - 1e-12, "n = {n}: m = {m}");
        }
    }
}
