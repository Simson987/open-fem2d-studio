//! De wandtoets: materiaal, slankheid, verticale belasting met Φ,
//! geconcentreerde lasten, afschuiving en buiging uit het vlak.

use crate::input::*;
use crate::result::*;
use mechanics::{ForceStateSnapshot, InternalForces};
use nen_en_1993_1_1_section::{CheckStatus, Deelstap, NamedValue, ResistanceCalc, UnityCheck};
use nen_en_1996_1_1::slankheid::{self, EffectieveHoogte, SLANKHEID_MAX};
use nen_en_1996_1_1::{afschuiving, buiging, capaciteit, geconcentreerd, materiaal, Mortelsoort, Steengroep, Steensoort, NORM};
use steel_check::{CheckKind, NamedCheck};

/// UC als de weerstand nul is (resultante buiten de kern, Φ = 0): een eindig
/// getal, want JSON kent geen oneindig.
const UC_ZONDER_WEERSTAND: f64 = 999.0;

fn nv(symbol: &str, value: f64, unit: &str) -> NamedValue {
    NamedValue { symbol: symbol.into(), value, unit: unit.into() }
}

#[allow(clippy::too_many_arguments)]
fn stap(id: &str, titel: &str, symbol: &str, article: &str, formule: &str, ingevuld: String,
        value: Option<f64>, unit: &str, notes: Vec<String>) -> Deelstap {
    Deelstap {
        id: id.into(),
        titel: titel.into(),
        symbol: symbol.into(),
        article: article.into(),
        formula_latex: formule.into(),
        ingevuld_latex: ingevuld,
        variables: Vec::new(),
        value,
        unit: unit.into(),
        notes,
    }
}

/// Een krachtenstaat voor het rapport. Een wand kent geen staafkrachten; `N`
/// (kN of kN/m) en `M` (kNm of kNm/m) staan hier in de velden `n_ed`
/// (DRUK positief, zoals de invoer) en `my_ed`, `V` in `vz_ed`.
fn staat(n: f64, v: f64, m: f64) -> ForceStateSnapshot {
    ForceStateSnapshot {
        combination_id: 0,
        position_mm: 0.0,
        forces: InternalForces { n_ed: n, vy_ed: 0.0, vz_ed: v, mt_ed: 0.0, my_ed: m, mz_ed: 0.0 },
    }
}

fn uc_van(ed: f64, rd: f64) -> f64 {
    if rd > 0.0 { ed / rd } else { UC_ZONDER_WEERSTAND }
}

#[allow(clippy::too_many_arguments)]
fn toets(id: &str, title: &str, article: &str, fs: ForceStateSnapshot, formule: &str, uc_formule: &str,
         ed: f64, rd: f64, unit: &str, variables: Vec<NamedValue>, deelstappen: Vec<Deelstap>,
         notes: Vec<String>) -> NamedCheck {
    let uc = uc_van(ed, rd);
    NamedCheck {
        id: id.into(),
        kind: CheckKind::Resistance(ResistanceCalc {
            id: id.into(),
            title: title.into(),
            article: article.into(),
            force_state: fs,
            formula_latex: formule.into(),
            variables,
            deelstappen,
            value: rd,
            unit: unit.into(),
            uc: Some(UnityCheck { ed, rd, uc, formula_latex: uc_formule.into() }),
            status: if uc <= 1.0 { CheckStatus::Ok } else { CheckStatus::NotOk },
            notes,
        }),
    }
}

/// Controleert een NDP-waarde met bron; `Err` met reden als hij onbruikbaar is.
fn normwaarde(naam: &str, w: &Normwaarde) -> Result<f64, String> {
    if !w.waarde.is_finite() || w.waarde <= 0.0 {
        return Err(format!("{naam} = {} is geen bruikbare waarde (verwacht een eindig getal > 0)", w.waarde));
    }
    if w.bron.trim().is_empty() {
        return Err(format!(
            "{naam} is opgegeven zonder bron; dit is een nationaal te kiezen parameter van NEN-EN 1996-1-1 \
             en moet met bron (NB-tabel, productverklaring) worden opgegeven"
        ));
    }
    Ok(w.waarde)
}

fn optionele_normwaarde(naam: &str, w: &Option<Normwaarde>, notes: &mut Vec<String>) -> Result<f64, String> {
    match w {
        None => Err(format!("{naam} is niet opgegeven (nationaal te kiezen parameter, met bron)")),
        Some(w) => {
            let v = normwaarde(naam, w)?;
            notes.push(format!("{naam} = {v} (bron: {})", w.bron.trim()));
            Ok(v)
        }
    }
}

fn positief(naam: &str, v: f64) -> Result<(), String> {
    if v.is_finite() && v > 0.0 { Ok(()) } else { Err(format!("{naam} = {v} moet een eindig getal > 0 zijn")) }
}

fn fout_resultaat(input: &MetselwerkWandInput, reden: String) -> MetselwerkWandResult {
    MetselwerkWandResult {
        wand_id: input.wand_id,
        naam: input.naam.clone(),
        norm: NORM.into(),
        sterkte: None,
        effectieve_hoogte: None,
        slankheid: None,
        checks: Vec::new(),
        uc_max: 0.0,
        status: CheckStatus::NotApplicable,
        governing_check_id: String::new(),
        niet_getoetst: vec![format!("hele wand: {reden}")],
        notes: vec![reden],
    }
}

/// Materiaal: α, β, K, f_k, γ_M, f_d (§3.6.1.2, §2.4.3).
fn sterkte(m: &MetselwerkMateriaal, notes: &mut Vec<String>) -> Result<(MetselwerkSterkte, Vec<Deelstap>), String> {
    positief("f_b", m.f_b_mpa)?;
    // Natuursteenmetselwerk (issue #99): groep 1 (§3.1.1), f_b uit de opgave.
    if m.steensoort == Steensoort::Natuursteen {
        materiaal::controleer_natuursteen(m.steengroep)?;
        notes.push(materiaal::TOELICHTING_FB_NATUURSTEEN.into());
    }
    let (alpha, beta, artikel) = materiaal::exponenten(m.steensoort, m.steengroep, m.mortel)?;
    let f_m_in = match (m.mortel, m.f_m_mpa) {
        (Mortelsoort::Algemeen, None) => {
            return Err("f_m (druksterkte van de mortel) is verplicht bij algemene mortel (§3.6.1.2)".into())
        }
        (_, Some(v)) => {
            positief("f_m", v)?;
            Some(v)
        }
        (_, None) => None,
    };
    let k_in = normwaarde("K", &m.k)?;
    let gamma_m = normwaarde("γ_M", &m.gamma_m)?;
    if gamma_m < 1.0 {
        return Err(format!("γ_M = {gamma_m} < 1,0 is geen materiaalfactor"));
    }
    notes.push(format!("K = {k_in} (bron: {})", m.k.bron.trim()));
    notes.push(format!("γ_M = {gamma_m} (bron: {})", m.gamma_m.bron.trim()));

    let (f_b, f_m, afgekapt) = materiaal::begrensde_sterkten(m.mortel, m.f_b_mpa, f_m_in.unwrap_or(0.0));
    notes.extend(afgekapt.iter().cloned());
    let k = if m.langsvoeg { k_in * materiaal::FACTOR_LANGSVOEG } else { k_in };
    let f_m_gebruikt = if beta == 0.0 { None } else { Some(f_m) };
    let f_k = materiaal::f_k(k, f_b, f_m, alpha, beta);
    let f_d = f_k / gamma_m;

    let mut stappen = Vec::new();
    stappen.push(stap(
        "k", "Constante K", "K", "§3.6.1.2", if m.langsvoeg { "K = 0{,}8 \\cdot K_{tabel}" } else { "K = K_{tabel}" },
        if m.langsvoeg { format!("K = 0{{,}}8 \\cdot {k_in} = {k:.3}") } else { format!("K = {k:.3}") },
        Some(k), "-",
        vec![if m.langsvoeg {
            "Langsvoeg in de wand: K × 0,8 (§3.6.1.2).".into()
        } else {
            "Geen langsvoeg opgegeven.".into()
        }],
    ));
    stappen.push(stap(
        "f_k", "Karakteristieke druksterkte", "f_k", artikel,
        "f_k = K \\, f_b^{\\alpha} \\, f_m^{\\beta}",
        if beta == 0.0 {
            format!("f_k = {k:.3} \\cdot {f_b}^{{{alpha}}} = {f_k:.3}")
        } else {
            format!("f_k = {k:.3} \\cdot {f_b}^{{{alpha}}} \\cdot {f_m}^{{{beta}}} = {f_k:.3}")
        },
        Some(f_k), "N/mm²", vec![format!("α = {alpha}, β = {beta}")],
    ));
    stappen.push(stap(
        "f_d", "Rekenwaarde druksterkte", "f_d", "§2.4.3",
        "f_d = f_k / \\gamma_M", format!("f_d = {f_k:.3} / {gamma_m} = {f_d:.3}"),
        Some(f_d), "N/mm²", Vec::new(),
    ));
    Ok((
        MetselwerkSterkte { alpha, beta, k, f_b_mpa: f_b, f_m_mpa: f_m_gebruikt, f_k_mpa: f_k, gamma_m, f_d_mpa: f_d, e_mpa: None },
        stappen,
    ))
}

pub fn check_all_metselwerk_walls(inputs: Vec<MetselwerkWandInput>) -> Vec<MetselwerkWandResult> {
    inputs.into_iter().map(|i| check_metselwerk_wall(&i)).collect()
}

pub fn check_metselwerk_wall(input: &MetselwerkWandInput) -> MetselwerkWandResult {
    let g = &input.geometrie;
    for (naam, v) in [("t", g.t_mm), ("h", g.h_m), ("l", g.l_m)] {
        if let Err(e) = positief(naam, v) {
            return fout_resultaat(input, e);
        }
    }
    match g.steunranden {
        slankheid::Steunranden::EenVerticaleRand { l_m } | slankheid::Steunranden::TweeVerticaleRanden { l_m } => {
            if let Err(e) = positief("l (afstand verstijvende rand)", l_m) {
                return fout_resultaat(input, e);
            }
        }
        slankheid::Steunranden::BovenOnder => {}
    }
    let mut notes = vec![
        "Enkelsteens wand: t_ef = t (§5.5.1.3); spouwmuren en wanden met penanten als verstijving niet ondersteund.".into(),
    ];
    let (mut sterkte, materiaalstappen) = match sterkte(&input.materiaal, &mut notes) {
        Ok(s) => s,
        Err(e) => return fout_resultaat(input, e),
    };

    let t = g.t_mm;
    let h = g.h_m * 1000.0;
    let l = g.l_m * 1000.0;
    let mut checks: Vec<NamedCheck> = Vec::new();
    let mut niet_getoetst: Vec<String> = Vec::new();

    // ── Effectieve hoogte en slankheid (§5.5.1) ─────────────────────────────
    let e_boven = input.verticaal.as_ref().and_then(|v| {
        (v.n_boven_kn_m > 0.0).then(|| (v.m_boven_knm_m / v.n_boven_kn_m).abs() * 1000.0)
    });
    let (rho_2, mut rho_notes) = slankheid::rho_2(g.betonvloeren, e_boven, t);
    let eh: EffectieveHoogte = slankheid::effectieve_hoogte(g.steunranden, rho_2, h, t);
    rho_notes.extend(eh.notes.iter().cloned());
    let h_ef = eh.h_ef_mm;
    let t_ef = t;
    let slankheid_ = h_ef / t_ef;
    let e_init = slankheid::e_init(h_ef);
    let slankstappen = vec![
        stap("rho_n", "Reductiefactor effectieve hoogte", "\\rho_n", "§5.5.1.2", "\\rho_n",
             format!("\\rho_2 = {rho_2}, \\; \\rho_n = {:.3}", eh.rho_n), Some(eh.rho_n), "-", rho_notes.clone()),
        stap("h_ef", "Effectieve hoogte", "h_{ef}", "§5.5.1.2", "h_{ef} = \\rho_n \\, h",
             format!("h_{{ef}} = {:.3} \\cdot {h:.0} = {h_ef:.0}", eh.rho_n), Some(h_ef), "mm", Vec::new()),
        stap("e_init", "Initiële excentriciteit", "e_{init}", "§5.5.1.1", "e_{init} = h_{ef} / 450",
             format!("e_{{init}} = {h_ef:.0} / 450 = {e_init:.2}"), Some(e_init), "mm", Vec::new()),
    ];
    checks.push(toets(
        "slankheid", "Slankheid", "§5.5.1.4", staat(0.0, 0.0, 0.0),
        "h_{ef} / t_{ef} \\le 27", "\\frac{h_{ef}/t_{ef}}{27}", slankheid_, SLANKHEID_MAX, "-",
        vec![nv("h_{ef}", h_ef, "mm"), nv("t_{ef}", t_ef, "mm")], slankstappen.clone(), Vec::new(),
    ));

    // ── Verticale belasting (§6.1.2) ────────────────────────────────────────
    if let Some(v) = &input.verticaal {
        let a_m2 = t * l / 1.0e6;
        let factor_a = capaciteit::factor_kleine_doorsnede(a_m2);
        let f_d_wand = sterkte.f_d_mpa * factor_a;
        let mut a_notes = Vec::new();
        if factor_a < 1.0 {
            a_notes.push(format!(
                "A = t·l = {a_m2:.4} m² < 0,1 m²: f_d × (0,7 + 3A) = × {factor_a:.3} (§6.1.2.1)"
            ));
        }
        // Boven en onder: Φ_i (vgl. 6.4/6.5).
        for (id, titel, n, m) in [
            ("druk_boven", "Druk bovenin de wand", v.n_boven_kn_m, v.m_boven_knm_m),
            ("druk_onder", "Druk onderin de wand", v.n_onder_kn_m, v.m_onder_knm_m),
        ] {
            if !(n.is_finite() && n > 0.0 && m.is_finite()) {
                niet_getoetst.push(format!(
                    "{titel}: N = {n} kN/m is geen drukkracht; metselwerk zonder druk wordt hier niet getoetst \
                     (buiging uit het vlak: §6.3)"
                ));
                continue;
            }
            let m_over_n = (m / n).abs() * 1000.0;
            let (e_i, ondergrens) = capaciteit::e_i(m_over_n, e_init, t);
            let phi = capaciteit::phi_i(e_i, t);
            let n_rd = phi * t * f_d_wand;
            let mut stappen = materiaalstappen.clone();
            stappen.extend(slankstappen.iter().cloned());
            stappen.push(stap(
                "e_i", "Excentriciteit", "e_i", "§6.1.2.2", "e_i = \\frac{M_{id}}{N_{id}} + e_{init} \\ge 0{,}05\\,t",
                format!("e_i = {m_over_n:.2} + {e_init:.2} = {:.2} \\Rightarrow {e_i:.2}", m_over_n + e_init),
                Some(e_i), "mm",
                if ondergrens { vec!["Ondergrens 0,05·t maatgevend.".into()] } else { Vec::new() },
            ));
            stappen.push(stap(
                "phi_i", "Capaciteitsreductiefactor", "\\Phi_i", "§6.1.2.2", "\\Phi_i = 1 - 2 e_i / t",
                format!("\\Phi_i = 1 - 2 \\cdot {e_i:.2} / {t} = {phi:.3}"), Some(phi), "-", Vec::new(),
            ));
            checks.push(toets(
                id, titel, "§6.1.2", staat(n, 0.0, m),
                "N_{Rd} = \\Phi_i \\, t \\, f_d", "\\frac{N_{Ed}}{N_{Rd}}", n, n_rd, "kN/m",
                vec![nv("\\Phi_i", phi, "-"), nv("t", t, "mm"), nv("f_d", f_d_wand, "N/mm²")],
                stappen, a_notes.clone(),
            ));
        }
        // Midden: Φ_m (bijlage G).
        let (n, m) = (v.n_midden_kn_m, v.m_midden_knm_m);
        let mut mid_notes = a_notes.clone();
        let k_e = optionele_normwaarde("K_E", &input.materiaal.k_e, &mut notes);
        let phi_inf = optionele_normwaarde("φ_∞", &input.materiaal.phi_inf, &mut notes);
        if !(n.is_finite() && n > 0.0 && m.is_finite()) {
            niet_getoetst.push(format!(
                "Druk halverwege de wand: N = {n} kN/m is geen drukkracht; niet getoetst"
            ));
        } else {
            match (k_e, phi_inf) {
                (Err(e), _) | (_, Err(e)) => niet_getoetst.push(format!(
                    "Druk halverwege de wand (Φ_m, bijlage G): {e}"
                )),
                (Ok(k_e), Ok(phi_inf)) => {
                    let e_mod = k_e * sterkte.f_k_mpa;
                    sterkte.e_mpa = Some(e_mod);
                    let e_m = (m / n).abs() * 1000.0 + e_init;
                    let e_k = capaciteit::e_k(phi_inf, h_ef, t_ef, t, e_m);
                    let e_mk_ruw = e_m + e_k;
                    let ondergrens = e_mk_ruw < 0.05 * t;
                    let e_mk = e_mk_ruw.max(0.05 * t);
                    let pm = capaciteit::phi_m(e_mk, t, h_ef, t_ef, sterkte.f_k_mpa, e_mod);
                    let n_rd = pm.phi_m * t * f_d_wand;
                    let mut stappen = materiaalstappen.clone();
                    stappen.extend(slankstappen.iter().cloned());
                    stappen.push(stap(
                        "e_mod", "Elasticiteitsmodulus", "E", "§3.7.2", "E = K_E \\, f_k",
                        format!("E = {k_e} \\cdot {:.3} = {e_mod:.0}", sterkte.f_k_mpa), Some(e_mod), "N/mm²", Vec::new(),
                    ));
                    stappen.push(stap(
                        "e_m", "Excentriciteit halverwege", "e_m", "§6.1.2.2",
                        "e_m = \\frac{M_{md}}{N_{md}} + e_{init}",
                        format!("e_m = {:.2} + {e_init:.2} = {e_m:.2}", e_m - e_init), Some(e_m), "mm", Vec::new(),
                    ));
                    stappen.push(stap(
                        "e_k", "Kruipexcentriciteit", "e_k", "§6.1.2.2",
                        "e_k = 0{,}002 \\, \\varphi_\\infty \\frac{h_{ef}}{t_{ef}} \\sqrt{t \\, e_m}",
                        format!("e_k = 0{{,}}002 \\cdot {phi_inf} \\cdot {slankheid_:.2} \\cdot \\sqrt{{{t} \\cdot {e_m:.2}}} = {e_k:.2}"),
                        Some(e_k), "mm",
                        vec!["e_k altijd meegenomen, ook bij een kleine slankheid (veilig).".into()],
                    ));
                    stappen.push(stap(
                        "e_mk", "Excentriciteit met kruip", "e_{mk}", "§6.1.2.2", "e_{mk} = e_m + e_k \\ge 0{,}05\\,t",
                        format!("e_{{mk}} = {e_m:.2} + {e_k:.2} = {e_mk_ruw:.2} \\Rightarrow {e_mk:.2}"),
                        Some(e_mk), "mm",
                        if ondergrens { vec!["Ondergrens 0,05·t maatgevend.".into()] } else { Vec::new() },
                    ));
                    stappen.push(stap(
                        "lambda", "Slankheidsparameter", "\\lambda", "bijlage G",
                        "\\lambda = \\frac{h_{ef}}{t_{ef}} \\sqrt{f_k / E}",
                        format!("\\lambda = {slankheid_:.2} \\sqrt{{{:.3} / {e_mod:.0}}} = {:.4}", sterkte.f_k_mpa, pm.lambda),
                        Some(pm.lambda), "-", Vec::new(),
                    ));
                    stappen.push(stap(
                        "u", "Hulpgrootheid u", "u", "bijlage G",
                        "u = \\frac{\\lambda - 0{,}063}{0{,}73 - 1{,}17\\, e_{mk}/t}",
                        format!("u = \\frac{{{:.4} - 0{{,}}063}}{{0{{,}}73 - 1{{,}}17 \\cdot {e_mk:.2}/{t}}} = {:.4}", pm.lambda, pm.u),
                        Some(pm.u), "-", Vec::new(),
                    ));
                    stappen.push(stap(
                        "phi_m", "Capaciteitsreductiefactor halverwege", "\\Phi_m", "bijlage G",
                        "\\Phi_m = A_1 \\, e^{-u^2/2}, \\; A_1 = 1 - 2 e_{mk}/t",
                        format!("\\Phi_m = {:.4} \\cdot e^{{-{:.4}^2/2}} = {:.4}", pm.a1, pm.u, pm.phi_m),
                        Some(pm.phi_m), "-", Vec::new(),
                    ));
                    mid_notes.push("Φ_m volgens de informatieve bijlage G.".into());
                    checks.push(toets(
                        "druk_midden", "Druk halverwege de wand", "§6.1.2", staat(n, 0.0, m),
                        "N_{Rd} = \\Phi_m \\, t \\, f_d", "\\frac{N_{Ed}}{N_{Rd}}", n, n_rd, "kN/m",
                        vec![nv("\\Phi_m", pm.phi_m, "-"), nv("t", t, "mm"), nv("f_d", f_d_wand, "N/mm²")],
                        stappen, mid_notes,
                    ));
                }
            }
        }
    }

    // ── Geconcentreerde lasten (§6.1.3) ─────────────────────────────────────
    for (i, last) in input.geconcentreerd.iter().enumerate() {
        let id = format!("geconcentreerd_{}", i + 1);
        let titel = format!("Geconcentreerde last {}", if last.naam.trim().is_empty() { (i + 1).to_string() } else { last.naam.clone() });
        let geldig = [("N_Edc", last.n_edc_kn), ("l_b", last.l_b_mm), ("b", last.b_mm), ("h_c", last.h_c_m)]
            .iter()
            .try_for_each(|(n, v)| positief(n, *v))
            .and_then(|_| if last.a1_mm.is_finite() && last.a1_mm >= 0.0 { Ok(()) } else { Err("a_1 moet ≥ 0 zijn".into()) })
            .and_then(|_| if last.a1_mm + last.l_b_mm <= l + 1e-9 { Ok(()) } else { Err("de oplegging valt buiten de wandlengte l".into()) })
            .and_then(|_| if last.b_mm <= t + 1e-9 { Ok(()) } else { Err("de opleggingsbreedte b is groter dan de wanddikte t".into()) });
        if let Err(e) = geldig {
            niet_getoetst.push(format!("{titel}: {e}"));
            continue;
        }
        if last.e_mm.abs() > t / 4.0 + 1e-9 {
            niet_getoetst.push(format!(
                "{titel}: excentriciteit {} mm > t/4 = {} mm; §6.1.3 is dan niet van toepassing",
                last.e_mm, t / 4.0
            ));
            continue;
        }
        let h_c = last.h_c_m * 1000.0;
        let a_b = last.l_b_mm * last.b_mm;
        let l_efm = geconcentreerd::l_efm_mm(last.l_b_mm, last.a1_mm, l, h_c);
        let a_ef = l_efm * t;
        let mut cnotes = vec![
            "Halverwege de wand onder de oplegging moet ook §6.1.2 voldoen, met deze last gespreid; neem hem op \
             in de verticale belasting van de wand (niet apart gecontroleerd)."
                .to_string(),
            "Hol-gemetselde lintvoegen (shell bedding) worden niet ondersteund.".to_string(),
        ];
        let (beta_v, beta_stap) = if input.materiaal.steengroep == Steengroep::Groep1 {
            let b = geconcentreerd::beta(last.a1_mm, h_c, a_b, a_ef);
            (b.beta, stap(
                "beta", "Verhogingsfactor", "\\beta", "§6.1.3",
                "\\beta = \\left(1 + 0{,}3 \\frac{a_1}{h_c}\\right)\\left(1{,}5 - 1{,}1 \\frac{A_b}{A_{ef}}\\right), \\; 1 \\le \\beta \\le \\min(1{,}25 + \\frac{a_1}{2 h_c}; 1{,}5)",
                format!(
                    "\\beta = (1 + 0{{,}}3 \\cdot {} / {h_c:.0})(1{{,}}5 - 1{{,}}1 \\cdot {:.3}) = {:.3} \\Rightarrow {:.3}",
                    last.a1_mm, b.ab_aef, b.beta_formule, b.beta
                ),
                Some(b.beta), "-",
                vec![format!("β_max = {:.3}; A_b/A_ef begrensd op 0,45.", b.beta_max)],
            ))
        } else {
            cnotes.push("Steengroep 2, 3 of 4: β = 1,0 (§6.1.3).".into());
            (1.0, stap("beta", "Verhogingsfactor", "\\beta", "§6.1.3", "\\beta = 1{,}0", "\\beta = 1{,}0".into(),
                       Some(1.0), "-", Vec::new()))
        };
        let n_rdc = beta_v * a_b * sterkte.f_d_mpa / 1000.0;
        let mut stappen = materiaalstappen.clone();
        stappen.push(stap(
            "l_efm", "Effectieve lengte halverwege", "l_{efm}", "§6.1.3 fig. 6.2",
            "l_{efm} = l_b + \\text{spreiding onder } 60^\\circ \\text{ tot } h_c/2",
            format!("l_{{efm}} = {l_efm:.0}"), Some(l_efm), "mm",
            vec!["Spreiding per zijde (h_c/2)/tan 60°, begrensd door de wandeinden.".into()],
        ));
        stappen.push(stap(
            "a_ef", "Effectieve oppervlakte", "A_{ef}", "§6.1.3", "A_{ef} = l_{efm} \\, t",
            format!("A_{{ef}} = {l_efm:.0} \\cdot {t} = {a_ef:.0}"), Some(a_ef), "mm²", Vec::new(),
        ));
        stappen.push(beta_stap);
        checks.push(toets(
            &id, &titel, "§6.1.3", staat(last.n_edc_kn, 0.0, 0.0),
            "N_{Rdc} = \\beta \\, A_b \\, f_d", "\\frac{N_{Edc}}{N_{Rdc}}", last.n_edc_kn, n_rdc, "kN",
            vec![nv("\\beta", beta_v, "-"), nv("A_b", a_b, "mm²"), nv("f_d", sterkte.f_d_mpa, "N/mm²")],
            stappen, cnotes,
        ));
    }

    // ── Afschuiving (§6.2) ──────────────────────────────────────────────────
    if let Some(a) = &input.afschuiving {
        let mut snotes = Vec::new();
        match optionele_normwaarde("f_vk0", &input.materiaal.f_vk0_mpa, &mut notes) {
            Err(e) => niet_getoetst.push(format!("Afschuiving (§6.2): {e}")),
            Ok(_) if !(a.v_ed_kn.is_finite() && a.n_ed_kn.is_finite() && a.m_ed_knm.is_finite()) => {
                niet_getoetst.push("Afschuiving (§6.2): V, N of M is geen eindig getal".into())
            }
            Ok(f_vk0) => {
                let n_n = a.n_ed_kn * 1000.0;
                let l_c = afschuiving::l_c_mm(l, n_n, a.m_ed_knm * 1.0e6);
                let sigma_d = if l_c > 0.0 { n_n / (t * l_c) } else { 0.0 };
                let (f_vk, grens, begrensd) =
                    afschuiving::f_vk(f_vk0, sigma_d, sterkte.f_b_mpa, input.materiaal.stootvoegen_gevuld);
                let f_vd = f_vk / sterkte.gamma_m;
                let v_rd = f_vd * t * l_c / 1000.0;
                if !input.materiaal.stootvoegen_gevuld {
                    snotes.push("Ongevulde stootvoegen: 0,5·f_vk0 en grens 0,045·f_b (§3.6.2).".into());
                }
                if a.n_ed_kn <= 0.0 {
                    snotes.push("Geen drukkracht: l_c = 0, het wanddeel kan geen schuifkracht opnemen.".into());
                }
                snotes.push("σ_d hoort bij de ongunstigste (doorgaans kleinste) gelijktijdige drukkracht (§6.2).".into());
                let mut stappen = materiaalstappen.clone();
                stappen.push(stap(
                    "l_c", "Lengte gedrukt deel", "l_c", "§6.2",
                    "l_c = l \\text{ als } e \\le l/6, \\text{ anders } 3(l/2 - e), \\; e = M/N",
                    format!("l_c = {l_c:.0}"), Some(l_c), "mm",
                    vec!["Lineaire spanningsverdeling, geen trek.".into()],
                ));
                stappen.push(stap(
                    "sigma_d", "Gemiddelde drukspanning op het gedrukte deel", "\\sigma_d", "§6.2",
                    "\\sigma_d = N_{Ed} / (t \\, l_c)", format!("\\sigma_d = {sigma_d:.3}"), Some(sigma_d), "N/mm²", Vec::new(),
                ));
                stappen.push(stap(
                    "f_vk", "Karakteristieke schuifsterkte", "f_{vk}", "§3.6.2",
                    if input.materiaal.stootvoegen_gevuld {
                        "f_{vk} = f_{vk0} + 0{,}4 \\sigma_d \\le 0{,}065 f_b"
                    } else {
                        "f_{vk} = 0{,}5 f_{vk0} + 0{,}4 \\sigma_d \\le 0{,}045 f_b"
                    },
                    format!("f_{{vk}} = {f_vk:.4}"), Some(f_vk), "N/mm²",
                    if begrensd { vec![format!("Bovengrens {grens:.3} N/mm² maatgevend.")] } else { Vec::new() },
                ));
                stappen.push(stap(
                    "f_vd", "Rekenwaarde schuifsterkte", "f_{vd}", "§2.4.3", "f_{vd} = f_{vk} / \\gamma_M",
                    format!("f_{{vd}} = {f_vk:.4} / {} = {f_vd:.4}", sterkte.gamma_m), Some(f_vd), "N/mm²", Vec::new(),
                ));
                checks.push(toets(
                    "afschuiving", "Afschuiving in het vlak", "§6.2", staat(a.n_ed_kn, a.v_ed_kn, a.m_ed_knm),
                    "V_{Rd} = f_{vd} \\, t \\, l_c", "\\frac{V_{Ed}}{V_{Rd}}", a.v_ed_kn.abs(), v_rd, "kN",
                    vec![nv("f_{vd}", f_vd, "N/mm²"), nv("t", t, "mm"), nv("l_c", l_c, "mm")], stappen, snotes,
                ));
            }
        }
    }

    // ── Buiging uit het vlak (§6.3.1) ───────────────────────────────────────
    if let Some(b) = &input.buiging {
        let (naam, w) = match b.breukvlak {
            Breukvlak::EvenwijdigAanLintvoegen => ("f_xk1", &input.materiaal.f_xk1_mpa),
            Breukvlak::LoodrechtOpLintvoegen => ("f_xk2", &input.materiaal.f_xk2_mpa),
        };
        match optionele_normwaarde(naam, w, &mut notes) {
            Err(e) => niet_getoetst.push(format!("Buiging uit het vlak (§6.3.1): {e}")),
            Ok(_) if !b.m_ed_knm_m.is_finite() => {
                niet_getoetst.push("Buiging uit het vlak (§6.3.1): M_Ed is geen eindig getal".into())
            }
            Ok(f_xk) => {
                let f_xd = f_xk / sterkte.gamma_m;
                let z = 1000.0 * t * t / 6.0;
                let m_rd = buiging::m_rd_knm_per_m(f_xd, t);
                let mut stappen = materiaalstappen.clone();
                stappen.push(stap(
                    "f_xd", "Rekenwaarde buigtreksterkte", "f_{xd}", "§6.3.1", "f_{xd} = f_{xk} / \\gamma_M",
                    format!("f_{{xd}} = {f_xk} / {} = {f_xd:.4}", sterkte.gamma_m), Some(f_xd), "N/mm²", Vec::new(),
                ));
                stappen.push(stap(
                    "z", "Weerstandsmoment per meter", "Z", "§6.3.1", "Z = 1000 \\, t^2 / 6",
                    format!("Z = 1000 \\cdot {t}^2 / 6 = {z:.0}"), Some(z), "mm³/m", Vec::new(),
                ));
                let mut bnotes = vec![
                    "Het gunstige effect van een gelijktijdige drukspanning (schijnbare buigtreksterkte) is niet \
                     meegenomen (veilig)."
                        .to_string(),
                    "Het moment komt uit de invoer; momentcoëfficiënten voor tweezijdig dragende panelen (bijlage E) \
                     en boogwerking (§6.3.2) worden hier niet bepaald."
                        .to_string(),
                ];
                if b.breukvlak == Breukvlak::EvenwijdigAanLintvoegen {
                    bnotes.push(
                        "f_xk1 mag niet worden gebruikt als bezwijken van de wand tot instorten of verlies van \
                         stabiliteit van het gebouw leidt (§6.3.1) — controleer dat zelf."
                            .into(),
                    );
                }
                checks.push(toets(
                    "buiging_uit_vlak", "Buiging uit het vlak", "§6.3.1", staat(0.0, 0.0, b.m_ed_knm_m),
                    "M_{Rd} = f_{xd} \\, Z", "\\frac{M_{Ed}}{M_{Rd}}", b.m_ed_knm_m.abs(), m_rd, "kNm/m",
                    vec![nv("f_{xd}", f_xd, "N/mm²"), nv("Z", z, "mm³/m")], stappen, bnotes,
                ));
            }
        }
    }

    if input.verticaal.is_none() && input.geconcentreerd.is_empty() && input.afschuiving.is_none() && input.buiging.is_none() {
        niet_getoetst.push("geen belasting opgegeven: alleen de slankheid is getoetst".into());
    }

    // ── Samenvatting ────────────────────────────────────────────────────────
    let mut uc_max = 0.0;
    let mut governing = String::new();
    let mut niet_ok = false;
    for c in &checks {
        let CheckKind::Resistance(r) = &c.kind else { continue };
        if let Some(u) = &r.uc {
            if u.uc > uc_max || governing.is_empty() {
                uc_max = u.uc;
                governing = c.id.clone();
            }
        }
        if r.status == CheckStatus::NotOk {
            niet_ok = true;
        }
    }
    let status = if niet_ok {
        CheckStatus::NotOk
    } else if !niet_getoetst.is_empty() {
        CheckStatus::NotApplicable
    } else {
        CheckStatus::Ok
    };
    MetselwerkWandResult {
        wand_id: input.wand_id,
        naam: input.naam.clone(),
        norm: NORM.into(),
        sterkte: Some(sterkte),
        effectieve_hoogte: Some(eh),
        slankheid: Some(slankheid_),
        checks,
        uc_max,
        status,
        governing_check_id: governing,
        niet_getoetst,
        notes,
    }
}
