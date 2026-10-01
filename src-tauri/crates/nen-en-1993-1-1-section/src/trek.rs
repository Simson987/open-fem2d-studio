//! NEN-EN 1993-1-1 §6.2.3 — trek voor elke doorsnede, en het draadeind van een
//! trekstaaf van massief rond staal.
//!
//! ## Twee toetsen, één trekweerstand
//!
//! §6.2.3(2) zegt dat de trekweerstand N_t,Rd de KLEINSTE is van
//!
//! * (a) de plastische weerstand van de brutodoorsnede, N_pl,Rd = A·f_y/γ_M0
//!   (6.6), en
//! * (b) de uiterste weerstand van de nettodoorsnede ter plaatse van de
//!   verzwakking, N_u,Rd = 0,9·A_net·f_u/γ_M2 (6.7).
//!
//! Voor elke doorsnede is (b) alleen te rekenen als de nettodoorsnede A_net
//! bekend is; die komt als invoer mee ([`n_t_rd`]). Zonder A_net is
//! N_t,Rd = N_pl,Rd, en zegt de toets dat.
//!
//! Bij een trekstaaf van rond staal is die verzwakking het DRAADEIND: de draad
//! is in de staaf gesneden, en de werkzame doorsnede daar is de
//! spanningsdoorsnede A_s van de draad (ISO 898-1). NEN-EN 1993-1-8 tabel 3.4
//! geeft voor een draadeind onder trek F_t,Rd = k₂·f_ub·A_s/γ_M2 met
//! k₂ = 0,9 — dezelfde vorm en dezelfde factor 0,9 als (6.7), met A_net = A_s.
//!
//! De twee staan hier als twee toetsen met elk een eigen id
//! ([`TOETS_TREK`] en [`TOETS_DRAADEIND`]), elk met formule en getallen. De
//! kleinste weerstand geeft de hoogste unity check en is daarmee vanzelf de
//! maatgevende: het rapport laat zo zien WELKE van de twee trek bepaalt, in
//! plaats van één min(…) waarvan de lezer de andere tak niet ziet.
//!
//! ## De spanningsdoorsnede uit de formule, niet uit een tabel
//!
//! A_s = π/4·(d − 0,9382·P)² (ISO 898-1): het gemiddelde van de flank- en de
//! kerndiameter, d₂ = d − 0,6495·P en d₃ = d − 1,2269·P, in het kwadraat. De
//! grove spoed P komt uit ISO 261. De gedrukte tabel van ISO 898-1 rondt A_s
//! af op drie of vier cijfers (M24: 353 mm² tegen 352,50 uit de formule); de
//! kern rekent met de formule, en `tests/draadeind.rs` legt de tabel ernaast.

use std::f64::consts::PI;

use mechanics::ForceStateSnapshot;
use section_properties::SectionProperties;

use crate::opmaak::{lx, nl, nv, stap};
use crate::{CheckStatus, NamedValue, ResistanceCalc, SteelGrade, UnityCheck};

/// Het id van de trektoets op de brutodoorsnede, §6.2.3 (6.6).
pub const TOETS_TREK: &str = "6.2.3_tension";

/// Het id van de trektoets op het draadeind: §6.2.3(2)(b) met A_net = A_s,
/// uitgewerkt met NEN-EN 1993-1-8 tabel 3.4.
pub const TOETS_DRAADEIND: &str = "6.2.3_threaded_end";

/// k₂ uit NEN-EN 1993-1-8 tabel 3.4 voor een bout of draadeind zonder
/// verzonken kop (bij een verzonken kop 0,63). Een draadeind aan een staaf is
/// nooit verzonken.
pub const K2_DRAAD: f64 = 0.9;

/// De grove spoed P (mm) van metrische ISO-draad M d volgens ISO 261, voor de
/// maten M10 tot en met M64. `None` voor een diameter zonder grove ISO-draad
/// in dit bereik — dan valt het draadeind niet te toetsen.
pub fn grove_spoed_mm(d_mm: f64) -> Option<f64> {
    const TABEL: [(f64, f64); 20] = [
        (10.0, 1.5),
        (12.0, 1.75),
        (14.0, 2.0),
        (16.0, 2.0),
        (18.0, 2.5),
        (20.0, 2.5),
        (22.0, 2.5),
        (24.0, 3.0),
        (27.0, 3.0),
        (30.0, 3.5),
        (33.0, 3.5),
        (36.0, 4.0),
        (39.0, 4.0),
        (42.0, 4.5),
        (45.0, 4.5),
        (48.0, 5.0),
        (52.0, 5.0),
        (56.0, 5.5),
        (60.0, 5.5),
        (64.0, 6.0),
    ];
    TABEL
        .iter()
        .find(|(d, _)| (d - d_mm).abs() < 1e-9)
        .map(|&(_, p)| p)
}

/// De spanningsdoorsnede A_s (mm²) van metrische draad met nominale diameter
/// `d_mm` en spoed `p_mm`, volgens ISO 898-1: A_s = π/4·(d − 0,9382·P)².
pub fn spanningsdoorsnede_mm2(d_mm: f64, p_mm: f64) -> f64 {
    PI / 4.0 * (d_mm - 0.9382 * p_mm).powi(2)
}

/// Trekkracht (kN, positief) in een krachtentoestand; `None` bij geen trek.
/// De kern rekent N trek-positief (`mechanics::InternalForces`).
fn trekkracht(force_state: &ForceStateSnapshot) -> Option<f64> {
    let n = force_state.forces.n_ed;
    (n > 0.0).then_some(n)
}

/// Status en unity check bij een trekweerstand `rd_kn`. Zonder trekkracht is
/// de toets NIET VAN TOEPASSING en heeft zij geen unity check — geen 0,00 die
/// als "voldoet" oogt, en geen getal dat een weergave die de status niet leest
/// als benutting zou kunnen optellen.
fn uitkomst(force_state: &ForceStateSnapshot, rd_kn: f64, uc_formule: &str) -> (Option<UnityCheck>, CheckStatus) {
    match trekkracht(force_state) {
        None => (None, CheckStatus::NotApplicable),
        Some(ed) => {
            let uc = if rd_kn > 0.0 { ed / rd_kn } else { f64::MAX };
            (
                Some(UnityCheck { ed, rd: rd_kn, uc, formula_latex: uc_formule.to_string() }),
                if uc <= 1.0 { CheckStatus::Ok } else { CheckStatus::NotOk },
            )
        }
    }
}

/// De notitie bij een toets zonder trekkracht.
fn geen_trek(force_state: &ForceStateSnapshot) -> String {
    format!(
        "Niet van toepassing: de omhullende bevat geen trekkracht (grootste N_Ed = {} kN, \
         combinatie {}, x = {} mm; N is trek-positief). De weerstand staat er ter informatie.",
        nl(force_state.forces.n_ed, 2),
        force_state.combination_id,
        nl(force_state.position_mm, 0)
    )
}

/// §6.2.3: de trekweerstand N_t,Rd van een staaf van elke doorsnedevorm.
///
/// Zonder nettodoorsnede (`a_net_mm2` is `None`) is dat de plastische
/// weerstand van de brutodoorsnede, N_pl,Rd = A·f_y/γ_M0 (6.6), en zegt de
/// toets dat er geen A_net is opgegeven. Met een nettodoorsnede is het de
/// kleinste van (6.6) en de uiterste weerstand van de nettodoorsnede,
/// N_u,Rd = 0,9·A_net·f_u/γ_M2 (6.7) — §6.2.3(2). De aanroeper keurt A_net
/// vooraf (0 < A_net ≤ A); hier wordt een niet-positieve of niet-eindige
/// waarde als "niet opgegeven" gelezen.
///
/// `force_state` hoort het punt met de GROOTSTE TREKKRACHT uit de omhullende te
/// zijn. Is daar geen trek, dan is de toets niet van toepassing (zie
/// [`uitkomst`]): geen unity check, wel de weerstand ter informatie.
pub fn n_t_rd(
    p: &SectionProperties,
    grade: &SteelGrade,
    a_net_mm2: Option<f64>,
    force_state: ForceStateSnapshot,
) -> ResistanceCalc {
    let n_pl_rd_kn = p.area_mm2 * grade.fy_mpa / grade.gamma_m0 * 1e-3;
    let a_net = a_net_mm2.filter(|a| a.is_finite() && *a > 0.0);
    let n_u_rd_kn = a_net.map(|a| 0.9 * a * grade.fu_mpa / grade.gamma_m2 * 1e-3);
    let n_t_rd_kn = n_u_rd_kn.map_or(n_pl_rd_kn, |nu| n_pl_rd_kn.min(nu));
    let (uc, status) = uitkomst(&force_state, n_t_rd_kn, r"N_{t,Ed} / N_{t,Rd}");

    let mut notes = Vec::new();
    if status == CheckStatus::NotApplicable {
        notes.push(geen_trek(&force_state));
    }
    let mut variables = vec![
        NamedValue { symbol: "A".to_string(), value: p.area_mm2, unit: "mm²".to_string() },
        NamedValue { symbol: "f_y".to_string(), value: grade.fy_mpa, unit: "MPa".to_string() },
        NamedValue { symbol: r"\gamma_{M0}".to_string(), value: grade.gamma_m0, unit: "-".to_string() },
    ];
    let mut deelstappen = Vec::new();
    let (formule, artikel) = match (a_net, n_u_rd_kn) {
        (Some(a), Some(n_u)) => {
            variables.push(NamedValue { symbol: r"A_{net}".to_string(), value: a, unit: "mm²".to_string() });
            variables.push(NamedValue { symbol: "f_u".to_string(), value: grade.fu_mpa, unit: "MPa".to_string() });
            variables.push(NamedValue { symbol: r"\gamma_{M2}".to_string(), value: grade.gamma_m2, unit: "-".to_string() });
            deelstappen.push(stap(
                "n_pl_rd",
                "Plastische weerstand van de brutodoorsnede",
                r"N_{pl,Rd}",
                "art. 6.2.3(2)a (6.6)",
                r"N_{pl,Rd} = \frac{A \cdot f_y}{\gamma_{M0}} \cdot 10^{-3}".to_string(),
                format!(
                    r"N_{{pl,Rd}} = \frac{{{} \cdot {}}}{{{}}} \cdot 10^{{-3}}",
                    lx(p.area_mm2, 1),
                    lx(grade.fy_mpa, 0),
                    lx(grade.gamma_m0, 2)
                ),
                vec![nv("A", p.area_mm2, "mm²"), nv("f_y", grade.fy_mpa, "MPa"), nv(r"\gamma_{M0}", grade.gamma_m0, "-")],
                Some(n_pl_rd_kn),
                "kN",
                vec!["Delen door 1000 zet N om in kN.".to_string()],
            ));
            deelstappen.push(stap(
                "n_u_rd",
                "Uiterste weerstand van de nettodoorsnede",
                r"N_{u,Rd}",
                "art. 6.2.3(2)b (6.7)",
                r"N_{u,Rd} = \frac{0{,}9 \cdot A_{net} \cdot f_u}{\gamma_{M2}} \cdot 10^{-3}".to_string(),
                format!(
                    r"N_{{u,Rd}} = \frac{{0{{,}}9 \cdot {} \cdot {}}}{{{}}} \cdot 10^{{-3}}",
                    lx(a, 1),
                    lx(grade.fu_mpa, 0),
                    lx(grade.gamma_m2, 2)
                ),
                vec![nv(r"A_{net}", a, "mm²"), nv("f_u", grade.fu_mpa, "MPa"), nv(r"\gamma_{M2}", grade.gamma_m2, "-")],
                Some(n_u),
                "kN",
                vec![],
            ));
            deelstappen.push(stap(
                "n_t_rd",
                "Trekweerstand",
                r"N_{t,Rd}",
                "art. 6.2.3(2)",
                r"N_{t,Rd} = \min\left( N_{pl,Rd};\; N_{u,Rd} \right)".to_string(),
                format!(r"N_{{t,Rd}} = \min\left( {};\; {} \right)", lx(n_pl_rd_kn, 3), lx(n_u, 3)),
                vec![nv(r"N_{pl,Rd}", n_pl_rd_kn, "kN"), nv(r"N_{u,Rd}", n_u, "kN")],
                Some(n_t_rd_kn),
                "kN",
                vec![],
            ));
            notes.push(format!(
                "§6.2.3(2): N_t,Rd is de kleinste van N_pl,Rd = {} kN (6.6, brutodoorsnede) en \
                 N_u,Rd = {} kN (6.7, nettodoorsnede A_net = {} mm²); maatgevend is {}. A_net is \
                 aangenomen op de plaats van de grootste trekkracht, de veilige kant.",
                nl(n_pl_rd_kn, 2),
                nl(n_u, 2),
                nl(a, 1),
                if n_u < n_pl_rd_kn { "de nettodoorsnede" } else { "de brutodoorsnede" }
            ));
            notes.push(
                "Niet in deze toets: de capaciteitseis N_pl,Rd ≤ N_u,Rd (6.8) bij dissipatief \
                 gedrag en de voorgespannen verbinding van categorie C (6.9)."
                    .to_string(),
            );
            (
                r"N_{t,Rd} = \min\left( \frac{A \cdot f_y}{\gamma_{M0}};\; \frac{0{,}9 \cdot A_{net} \cdot f_u}{\gamma_{M2}} \right)".to_string(),
                "art. 6.2.3 (6.6)/(6.7)".to_string(),
            )
        }
        _ => {
            notes.push(
                "Geen nettodoorsnede opgegeven: N_t,Rd = N_pl,Rd = A·f_y/γ_M0 (6.6). Heeft de staaf \
                 gaten of een andere verzwakking, geef dan A_net op; dan geldt ook \
                 N_u,Rd = 0,9·A_net·f_u/γ_M2 (6.7) en is de kleinste van beide maatgevend \
                 (§6.2.3(2))."
                    .to_string(),
            );
            (
                r"N_{t,Rd} = N_{pl,Rd} = \frac{A \cdot f_y}{\gamma_{M0}}".to_string(),
                "art. 6.2.3 (6.6)".to_string(),
            )
        }
    };
    ResistanceCalc {
        deelstappen,
        id: TOETS_TREK.to_string(),
        title: "Trek".to_string(),
        article: artikel,
        force_state,
        formula_latex: formule,
        variables,
        value: n_t_rd_kn,
        unit: "kN".to_string(),
        uc,
        status,
        notes,
    }
}

/// De trekweerstand van het draadeind van een staaf van massief rond staal met
/// diameter `d_mm`: N_t,Rd,draad = k₂·f_u·A_s/γ_M2 (NEN-EN 1993-1-8 tabel 3.4,
/// §6.2.3(2)(b) met A_net = A_s).
///
/// Aangenomen is een GESNEDEN draad M d in de staaf zelf: draaddiameter =
/// staafdiameter, met grove spoed. Voor f_ub staat de treksterkte f_u van de
/// staalsoort van de staaf (tabel 3.1, al voor de dikte t = d gekozen door de
/// aanroeper). Heeft `d_mm` geen grove ISO-draad in [`grove_spoed_mm`], dan is
/// de toets niet uit te voeren en komt hij terug als NotApplicable mét reden.
pub fn n_t_rd_draadeind(d_mm: f64, grade: &SteelGrade, force_state: ForceStateSnapshot) -> ResistanceCalc {
    let titel = format!("Trek in het draadeind (M{})", lx(d_mm, 1).replace("{,}", ","));
    let artikel = "NEN-EN 1993-1-8 tabel 3.4".to_string();
    let formule = r"N_{t,Rd,draad} = \frac{k_2 \cdot f_u \cdot A_s}{\gamma_{M2}}".to_string();

    let Some(p_mm) = grove_spoed_mm(d_mm) else {
        return ResistanceCalc {
            deelstappen: Vec::new(),
            id: TOETS_DRAADEIND.to_string(),
            title: titel,
            article: artikel,
            force_state,
            formula_latex: formule,
            variables: vec![],
            value: 0.0,
            unit: "kN".to_string(),
            uc: None,
            status: CheckStatus::NotApplicable,
            notes: vec![format!(
                "Niet getoetst: voor een staaf van Ø{} mm is geen metrische ISO-draad met grove spoed \
                 (ISO 261, M10 t/m M64) bekend, dus de spanningsdoorsnede A_s van het draadeind is \
                 niet te bepalen. Toets het draadeind met de werkelijke draad.",
                nl(d_mm, 1)
            )],
        };
    };

    let a_s = spanningsdoorsnede_mm2(d_mm, p_mm);
    let n_rd_kn = K2_DRAAD * grade.fu_mpa * a_s / grade.gamma_m2 * 1e-3;
    let (uc, status) = uitkomst(&force_state, n_rd_kn, r"N_{t,Ed} / N_{t,Rd,draad}");

    let deelstappen = vec![
        stap(
            "spoed",
            &format!("Grove spoed van de draad M{}", nl(d_mm, 0)),
            "P",
            "ISO 261",
            String::new(),
            String::new(),
            vec![nv("d", d_mm, "mm"), nv("P", p_mm, "mm")],
            Some(p_mm),
            "mm",
            vec![format!(
                "Het draadeind is gesneden in de staaf zelf: draad M{} met de grove spoed \
                 P = {} mm. Een opgestuikt draadeind (draad groter dan de staaf) valt hier niet \
                 onder.",
                nl(d_mm, 0),
                nl(p_mm, 2)
            )],
        ),
        stap(
            "a_s",
            "Spanningsdoorsnede van de draad",
            "A_s",
            "ISO 898-1",
            r"A_s = \frac{\pi}{4} \left( d - 0{,}9382 \cdot P \right)^2".to_string(),
            format!(
                r"A_s = \frac{{\pi}}{{4}} \left( {} - 0{{,}}9382 \cdot {} \right)^2",
                lx(d_mm, 1),
                lx(p_mm, 2)
            ),
            vec![nv("d", d_mm, "mm"), nv("P", p_mm, "mm")],
            Some(a_s),
            "mm²",
            vec![
                "Het kwadraat van het gemiddelde van de flankdiameter d_2 = d − 0,6495·P en de \
                 kerndiameter d_3 = d − 1,2269·P. Gerekend met de formule; de gedrukte tabel van \
                 ISO 898-1 rondt A_s af."
                    .to_string(),
            ],
        ),
        stap(
            "n_t_rd_draad",
            "Trekweerstand van het draadeind",
            r"N_{t,Rd,draad}",
            "NEN-EN 1993-1-8 tabel 3.4",
            r"N_{t,Rd,draad} = \frac{k_2 \cdot f_u \cdot A_s}{\gamma_{M2}} \cdot 10^{-3}".to_string(),
            format!(
                r"N_{{t,Rd,draad}} = \frac{{{} \cdot {} \cdot {}}}{{{}}} \cdot 10^{{-3}}",
                lx(K2_DRAAD, 2),
                lx(grade.fu_mpa, 0),
                lx(a_s, 2),
                lx(grade.gamma_m2, 2)
            ),
            vec![
                nv("k_2", K2_DRAAD, "-"),
                nv("f_u", grade.fu_mpa, "MPa"),
                nv("A_s", a_s, "mm²"),
                nv(r"\gamma_{M2}", grade.gamma_m2, "-"),
            ],
            Some(n_rd_kn),
            "kN",
            vec!["Delen door 1000 zet N om in kN.".to_string()],
        ),
    ];

    let mut notes = Vec::new();
    if status == CheckStatus::NotApplicable {
        notes.push(geen_trek(&force_state));
    }
    notes.push(format!(
        "Draadeind M{} (P = {} mm): A_s = {} mm². k_2 = 0,9 (NEN-EN 1993-1-8 tabel 3.4, geen \
         verzonken kop); voor f_ub is de treksterkte f_u = {} N/mm² van de staalsoort van de staaf \
         genomen, en γ_M2 = {}. Dit is §6.2.3(2)(b) met A_net = A_s.",
        nl(d_mm, 0),
        nl(p_mm, 2),
        nl(a_s, 1),
        nl(grade.fu_mpa, 0),
        nl(grade.gamma_m2, 2)
    ));
    notes.push(format!(
        "Maatgevend voor trek is de kleinste van N_pl,Rd = A·f_y/γ_M0 (toets \"{TOETS_TREK}\") en \
         N_t,Rd,draad; de toets met de hoogste unity check wijst hem aan."
    ));
    notes.push(
        "Niet in deze staaftoets: het ponsen van moer of kop door de aansluitplaat (B_p,Rd, \
         tabel 3.4) en de aansluiting zelf."
            .to_string(),
    );

    ResistanceCalc {
        deelstappen,
        id: TOETS_DRAADEIND.to_string(),
        title: titel,
        article: artikel,
        force_state,
        formula_latex: formule,
        variables: vec![
            NamedValue { symbol: "k_2".to_string(), value: K2_DRAAD, unit: "-".to_string() },
            NamedValue { symbol: "f_u".to_string(), value: grade.fu_mpa, unit: "MPa".to_string() },
            NamedValue { symbol: "A_s".to_string(), value: a_s, unit: "mm²".to_string() },
            NamedValue { symbol: r"\gamma_{M2}".to_string(), value: grade.gamma_m2, unit: "-".to_string() },
        ],
        value: n_rd_kn,
        unit: "kN".to_string(),
        uc,
        status,
        notes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::S235;
    use approx::assert_relative_eq;
    use mechanics::InternalForces;

    fn toestand(n_kn: f64) -> ForceStateSnapshot {
        ForceStateSnapshot {
            combination_id: 1,
            position_mm: 0.0,
            forces: InternalForces { n_ed: n_kn, ..Default::default() },
        }
    }

    /// M24: P = 3,0 mm, A_s = π/4·(24 − 2,8146)² = π/4·21,1854² = 352,503 mm².
    #[test]
    fn spanningsdoorsnede_m24_uit_de_formule() {
        assert_eq!(grove_spoed_mm(24.0), Some(3.0));
        assert_relative_eq!(spanningsdoorsnede_mm2(24.0, 3.0), 352.503, max_relative = 1e-6);
        assert_eq!(grove_spoed_mm(25.0), None);
    }

    /// Zonder trek geen unity check en status NotApplicable, maar wel de
    /// weerstand.
    #[test]
    fn zonder_trek_niet_van_toepassing() {
        let p = SectionProperties { area_mm2: 452.389, ..Default::default() };
        let r = n_t_rd(&p, &S235, None, toestand(-10.0));
        assert_eq!(r.status, CheckStatus::NotApplicable);
        assert!(r.uc.is_none());
        assert_relative_eq!(r.value, 452.389 * 235.0 * 1e-3, max_relative = 1e-12);
        let d = n_t_rd_draadeind(24.0, &S235, toestand(0.0));
        assert_eq!(d.status, CheckStatus::NotApplicable);
        assert!(d.uc.is_none());
    }

    /// Zonder A_net is N_t,Rd = N_pl,Rd, en de toets zegt dat. HEA 200 S235
    /// (A = 5380 mm²) op 1300 kN trek, boven N_pl,Rd:
    ///   N_pl,Rd = 5380·235/1,0·10⁻³ = 1264,3 kN, UC = 1300/1264,3 = 1,028237.
    #[test]
    fn zonder_nettodoorsnede_alleen_n_pl_rd() {
        let p = SectionProperties { area_mm2: 5380.0, ..Default::default() };
        let r = n_t_rd(&p, &S235, None, toestand(1300.0));
        assert_relative_eq!(r.value, 1264.3, max_relative = 1e-12);
        assert_relative_eq!(r.uc.as_ref().unwrap().uc, 1300.0 / 1264.3, max_relative = 1e-12);
        assert_eq!(r.status, CheckStatus::NotOk);
        assert_eq!(r.article, "art. 6.2.3 (6.6)");
        assert!(r.notes.iter().any(|t| t.starts_with("Geen nettodoorsnede opgegeven")), "{:?}", r.notes);
        assert!(r.deelstappen.is_empty());
    }

    /// Met A_net = 4500 mm² op dezelfde HEA 200 S235:
    ///   N_pl,Rd = 1264,3 kN (6.6)
    ///   N_u,Rd  = 0,9·4500·360/1,25·10⁻³ = 1166,4 kN (6.7) — de kleinste
    ///   UC      = 1300/1166,4 = 1,114540
    #[test]
    fn met_nettodoorsnede_de_kleinste_van_6_6_en_6_7() {
        let p = SectionProperties { area_mm2: 5380.0, ..Default::default() };
        let r = n_t_rd(&p, &S235, Some(4500.0), toestand(1300.0));
        assert_relative_eq!(r.value, 1166.4, max_relative = 1e-12);
        assert_relative_eq!(r.uc.as_ref().unwrap().uc, 1300.0 / 1166.4, max_relative = 1e-12);
        assert_eq!(r.article, "art. 6.2.3 (6.6)/(6.7)");
        let stap = |id: &str| r.deelstappen.iter().find(|d| d.id == id).and_then(|d| d.value).unwrap();
        assert_relative_eq!(stap("n_pl_rd"), 1264.3, max_relative = 1e-12);
        assert_relative_eq!(stap("n_u_rd"), 1166.4, max_relative = 1e-12);
        assert_relative_eq!(stap("n_t_rd"), 1166.4, max_relative = 1e-12);
        // Een ruime A_net laat de brutodoorsnede maatgevend: 0,9·5300·360/1,25
        // = 1373,76 kN > 1264,3 kN.
        let ruim = n_t_rd(&p, &S235, Some(5300.0), toestand(1300.0));
        assert_relative_eq!(ruim.value, 1264.3, max_relative = 1e-12);
    }
}
