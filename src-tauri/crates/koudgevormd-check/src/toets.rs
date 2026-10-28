//! De staaftoets: effectieve doorsnede, doorsnedeweerstanden, interactie en knik.
//!
//! Elke toets wordt over ALLE punten van het krachtsverloop geëvalueerd; de
//! maatgevende (hoogste UC) staat in het resultaat met zijn krachtenstaat.

use crate::input::KoudgevormdBeamCheckInput;
use crate::result::*;
use mechanics::{ForcePoint, ForceStateSnapshot, InternalForces};
use nen_en_1993_1_1_section::{CheckStatus, Deelstap, NamedValue, ResistanceCalc, UnityCheck};
use nen_en_1993_1_3::effectief::{effectieve_doorsnede, Belastinggeval, EffectieveDoorsnede};
use nen_en_1993_1_3::materiaal::{f_ya, E_STAAL, GAMMA_M0, GAMMA_M1, GAMMA_M2};
use nen_en_1993_1_3::weerstand::{self, ALPHA_C};
use nen_en_1993_1_3::{zoek_staalsoort, KvDoorsnede, Plaatrol, NORM};
use steel_check::{CheckKind, NamedCheck};

/// Onder deze waarden telt een kracht als nul (kN, kNm).
const TOL_N_KN: f64 = 1e-3;
const TOL_M_KNM: f64 = 1e-3;
/// `k` in formule (3.1): 5 (niet-rolvormen), de veilige ondergrens.
const K_FYA: f64 = 5.0;

fn nv(symbol: &str, value: f64, unit: &str) -> NamedValue {
    NamedValue { symbol: symbol.to_string(), value, unit: unit.to_string() }
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

fn nul_staat() -> ForceStateSnapshot {
    ForceStateSnapshot {
        combination_id: 0,
        position_mm: 0.0,
        forces: InternalForces { n_ed: 0.0, vy_ed: 0.0, vz_ed: 0.0, mt_ed: 0.0, my_ed: 0.0, mz_ed: 0.0 },
    }
}

/// Een rij "niet getoetst" zonder unity check.
fn zonder_uc(id: &str, title: &str, article: &str, reden: String) -> NamedCheck {
    NamedCheck {
        id: id.into(),
        kind: CheckKind::Resistance(ResistanceCalc {
            id: id.into(),
            title: title.into(),
            article: article.into(),
            force_state: nul_staat(),
            formula_latex: String::new(),
            variables: Vec::new(),
            deelstappen: Vec::new(),
            value: 0.0,
            unit: String::new(),
            uc: None,
            status: CheckStatus::NotApplicable,
            notes: vec![reden],
        }),
    }
}

struct Maatgevend {
    punt: ForcePoint,
    ed: f64,
    rd: f64,
    uc: f64,
}

fn maatgevend<F>(punten: &[ForcePoint], f: F) -> Option<Maatgevend>
where
    F: Fn(&ForcePoint) -> Option<(f64, f64)>,
{
    let mut beste: Option<Maatgevend> = None;
    for p in punten {
        if let Some((ed, rd)) = f(p) {
            let uc = if rd > 0.0 { ed / rd } else { f64::INFINITY };
            if beste.as_ref().map_or(true, |b| uc > b.uc) {
                beste = Some(Maatgevend { punt: *p, ed, rd, uc });
            }
        }
    }
    beste
}

#[allow(clippy::too_many_arguments)]
fn met_uc(id: &str, title: &str, article: &str, m: &Maatgevend, formule: &str, uc_formule: &str,
          variables: Vec<NamedValue>, deelstappen: Vec<Deelstap>, unit: &str, notes: Vec<String>) -> NamedCheck {
    NamedCheck {
        id: id.into(),
        kind: CheckKind::Resistance(ResistanceCalc {
            id: id.into(),
            title: title.into(),
            article: article.into(),
            force_state: ForceStateSnapshot::from_point(&m.punt),
            formula_latex: formule.into(),
            variables,
            deelstappen,
            value: m.rd,
            unit: unit.into(),
            uc: Some(UnityCheck { ed: m.ed, rd: m.rd, uc: m.uc, formula_latex: uc_formule.into() }),
            status: if m.uc <= 1.0 { CheckStatus::Ok } else { CheckStatus::NotOk },
            notes,
        }),
    }
}

fn fout_resultaat(input: &KoudgevormdBeamCheckInput, reden: String) -> KoudgevormdBeamCheckResult {
    KoudgevormdBeamCheckResult {
        beam_id: input.beam_id,
        section_name: input.section_name.clone(),
        koudgevormd_staalsoort: input.staalsoort.clone(),
        materiaal: None,
        norm: NORM.into(),
        grootheden: None,
        effectief_druk: None,
        effectief_buiging: None,
        checks: Vec::new(),
        uc_max: 0.0,
        status: CheckStatus::NotApplicable,
        governing_check_id: String::new(),
        niet_getoetst: vec![format!("hele staaf: {reden}")],
        notes: vec![reden],
    }
}

fn rolnaam(r: Plaatrol) -> &'static str {
    match r {
        Plaatrol::Lijf => "lijf",
        Plaatrol::FlensBoven => "bovenflens",
        Plaatrol::FlensOnder => "onderflens",
        Plaatrol::LipBoven => "bovenlip",
        Plaatrol::LipOnder => "onderlip",
    }
}

/// De deelstappen van een effectieve doorsnede, voor het rapport.
fn effectief_stappen(e: &EffectieveDoorsnede, eps: f64, f_yb: f64, voorvoegsel: &str) -> Vec<Deelstap> {
    let mut v = vec![stap(
        &format!("{voorvoegsel}_epsilon"), "Materiaalparameter", r"\varepsilon", "EN 1993-1-5 tabel 4.1",
        r"\varepsilon = \sqrt{235 / f_{yb}}",
        format!(r"\varepsilon = \sqrt{{235 / {f_yb}}} = {eps:.4}"),
        Some(eps), "-", Vec::new(),
    )];
    for d in &e.delen {
        let naam = rolnaam(d.rol);
        let formule = if d.inwendig {
            r"\bar\lambda_p = \frac{b_p/t}{28{,}4 \varepsilon \sqrt{k_\sigma}};\ \rho = \frac{\bar\lambda_p - 0{,}055(3+\psi)}{\bar\lambda_p^2} \le 1"
        } else {
            r"\bar\lambda_p = \frac{b_p/t}{28{,}4 \varepsilon \sqrt{k_\sigma}};\ \rho = \frac{\bar\lambda_p - 0{,}188}{\bar\lambda_p^2} \le 1"
        };
        v.push(stap(
            &format!("{voorvoegsel}_rho_{naam}"),
            &format!("Effectieve breedte {naam} ({})", if d.inwendig { "inwendig" } else { "uitstekend" }),
            r"\rho", if d.inwendig { "EN 1993-1-5 4.4, tabel 4.1" } else { "EN 1993-1-5 4.4, tabel 4.2 / 5.5.3.2(5)" },
            formule,
            format!(
                r"b_p = {:.2},\ \psi = {:.3},\ k_\sigma = {:.3},\ \bar\lambda_p = {:.3},\ \rho = {:.4},\ b_{{eff}} = {:.2}\ \text{{mm}}",
                d.b_p_mm, d.psi, d.k_sigma, d.lambda_p, d.rho, d.b_eff_mm
            ),
            Some(d.rho), "-", Vec::new(),
        ));
    }
    for s in &e.verstijvers {
        let naam = rolnaam(s.rol);
        v.push(stap(
            &format!("{voorvoegsel}_chi_d_{naam}"),
            &format!("Randverstijver {naam} (vervormingsknik)"),
            r"\chi_d", "5.5.3.1, 5.5.3.2",
            r"K_1 = \frac{E t^3}{4(1-\nu^2)} \frac{1}{b_1^2 h_w + b_1^3 + 0{,}5 b_1 b_2 h_w k_f};\ \sigma_{cr,s} = \frac{2\sqrt{K_1 E I_s}}{A_s};\ \bar\lambda_d = \sqrt{f_{yb}/\sigma_{cr,s}}",
            format!(
                r"A_s = {:.2},\ I_s = {:.1},\ b_1 = {:.2},\ k_f = {},\ K_1 = {:.4},\ \sigma_{{cr,s}} = {:.1},\ \bar\lambda_d = {:.3},\ \chi_d = {:.4}",
                s.a_s_mm2, s.i_s_mm4, s.b1_mm, s.k_f, s.k_n_mm2, s.sigma_cr_s, s.lambda_d, s.chi_d
            ),
            Some(s.chi_d), "-",
            vec!["χ_d: 1 voor λ̄_d ≤ 0,65; 1,47 − 0,723 λ̄_d tot 1,38; daarboven 0,66/λ̄_d (5.12). Zonder iteratie (5.5.3.2(10) optioneel).".into()],
        ));
    }
    v
}

pub fn check_all_koudgevormd_beams(inputs: Vec<KoudgevormdBeamCheckInput>) -> Vec<KoudgevormdBeamCheckResult> {
    inputs.into_iter().map(|i| check_koudgevormd_beam(&i)).collect()
}

pub fn check_koudgevormd_beam(input: &KoudgevormdBeamCheckInput) -> KoudgevormdBeamCheckResult {
    let d: &KvDoorsnede = &input.doorsnede;
    if let Err(e) = d.valideer() {
        return fout_resultaat(input, e);
    }
    let pos = |v: f64| v.is_finite() && v > 0.0;
    let l_t_m = input.buckling_length_t_m.unwrap_or(input.length_m);
    if !(pos(input.length_m) && pos(input.buckling_length_y_m) && pos(input.buckling_length_z_m) && pos(l_t_m)) {
        return fout_resultaat(input, "lengte en kniklengten moeten positief zijn".into());
    }
    if input.forces_envelope.is_empty() {
        return fout_resultaat(input, "geen krachtsverloop opgegeven".into());
    }
    let mat = match zoek_staalsoort(&input.staalsoort) {
        Ok(m) => m,
        Err(e) => return fout_resultaat(input, e),
    };
    let f_yb = mat.f_yb;
    let f_u = mat.f_u;
    let eps = nen_en_1993_1_3::materiaal::epsilon(f_yb);
    let t = d.t();
    let is_z = d.is_z();

    let mut notes: Vec<String> = Vec::new();
    let mut niet_getoetst: Vec<String> = Vec::new();
    notes.push(format!(
        "{} — {} ({}): f_yb = {f_yb} N/mm², f_u = {f_u} N/mm²; E = {E_STAAL} N/mm²",
        mat.bron, mat.aanduiding, mat.productnorm
    ));
    notes.push(format!(
        "γ_M0 = {GAMMA_M0}, γ_M1 = {GAMMA_M1}, γ_M2 = {GAMMA_M2}: aanbevolen waarden EN 1993-1-3 §2(3); een afwijkende Nederlandse nationale bijlage is niet verwerkt"
    ));
    notes.push(format!("t = {t} mm is de kerndikte t_cor (zonder zinklaag, §3.2.4(3)); maten buitenwerks, hartlijnmodel met scherpe hoeken (§5.1(3))"));

    for m in d.buiten_maatgrenzen(f_yb) {
        niet_getoetst.push(format!("doorsnede buiten de rekenregels van deel 1-3: {m} — bepaling door proeven (§5.2(1))"));
    }
    let delta = d.delta();
    if delta > 0.0 {
        notes.push(format!(
            "afgeronde hoeken niet verwaarloosbaar (r = {} mm > 5t of > 0,10 b_p, §5.1(3)): δ = {delta:.4} (5.1d); A·(1−δ), I·(1−2δ), I_w·(1−4δ), ook voor de effectieve grootheden",
            d.r()
        ));
    } else {
        notes.push("afgeronde hoeken verwaarloosd: r ≤ 5t en r ≤ 0,10 b_p (§5.1(3))".into());
    }
    if d.heeft_lippen() && !d.lip_verstijft() {
        notes.push(format!("c/b = {:.3} < 0,2: de lip telt niet als randverstijver (§5.2(3)); de gedrukte flens is uitstekend gerekend", d.c() / d.b()));
    }

    // ── Bruto grootheden ────────────────────────────────────────────────
    let bruto = d.hartlijn_bruto();
    let gb = bruto.grootheden();
    let a_g = gb.a * (1.0 - delta);
    let i_y = gb.i_y * (1.0 - 2.0 * delta);
    let i_z = gb.i_z * (1.0 - 2.0 * delta);
    let i_yz = gb.i_yz * (1.0 - 2.0 * delta);
    let i_t = bruto.i_t();
    let (y_s, z_s, i_w_sh) = bruto.dwarskrachtcentrum_en_welving().unwrap_or((gb.y_c, gb.z_c, 0.0));
    let i_w = i_w_sh * (1.0 - 4.0 * delta);
    let (y0, z0) = (y_s - gb.y_c, z_s - gb.z_c);
    let w_el_y = i_y / (0.5 * d.h());
    let fya = f_ya(f_yb, f_u, K_FYA, d.aantal_zettingen(), t, a_g);
    let grootheden = KvGrootheden {
        a_mm2: a_g, y_c_mm: gb.y_c, i_y_mm4: i_y, i_z_mm4: i_z, i_yz_mm4: i_yz, i_t_mm4: i_t, i_w_mm6: i_w,
        y_0_mm: y0, z_0_mm: z0, w_el_y_mm3: w_el_y, delta, f_ya: fya,
    };

    // ── Effectieve doorsneden ───────────────────────────────────────────
    let e_druk = effectieve_doorsnede(d, f_yb, Belastinggeval::Druk);
    let e_buig = effectieve_doorsnede(d, f_yb, Belastinggeval::Buiging);
    for b in e_druk.buiten_bereik.iter().chain(e_buig.buiten_bereik.iter()) {
        if !niet_getoetst.iter().any(|x| x.contains(b.as_str())) {
            niet_getoetst.push(format!("effectieve doorsnede: {b}"));
        }
    }
    let a_eff = e_druk.a_eff_mm2;
    let w_eff = e_buig.w_y_min().min(w_el_y);
    let stappen_druk = effectief_stappen(&e_druk, eps, f_yb, "druk");
    let stappen_buig = effectief_stappen(&e_buig, eps, f_yb, "buig");

    let n_t_rd = weerstand::n_t_rd(fya, a_g);
    let n_c_rd = weerstand::n_c_rd(a_eff, f_yb);
    let m_c_rd = weerstand::m_c_rd(w_eff, f_yb);
    let m_cz_rd = weerstand::m_c_rd(e_druk.w_z_min_mm3, f_yb);
    let (hp, _, _) = d.hartlijn();
    let lw = weerstand::lambda_w(hp, t, f_yb);
    let fbv = weerstand::f_bv(lw, f_yb);
    let v_rd = weerstand::v_b_rd(hp, t, fbv);
    // Verschuiving van de neutrale lijn bij druk (§6.1.3(4), §6.1.9).
    let e_ny = e_druk.e_ny_mm.abs();
    let e_nz = e_druk.e_nz_mm.abs();

    // ── Krachten (N, N·mm) ──────────────────────────────────────────────
    let punten = &input.forces_envelope;
    let n_n = |p: &ForcePoint| p.forces.n_ed * 1e3;
    let v_n = |p: &ForcePoint| p.forces.vz_ed.abs() * 1e3;
    let m_nmm = |p: &ForcePoint| p.forces.my_ed.abs() * 1e6;
    let max_druk_kn = punten.iter().map(|p| -p.forces.n_ed).fold(0.0, f64::max);
    let max_m_knm = punten.iter().map(|p| p.forces.my_ed.abs()).fold(0.0, f64::max);
    let max_v_kn = punten.iter().map(|p| p.forces.vz_ed.abs()).fold(0.0, f64::max);
    let heeft_druk = max_druk_kn > TOL_N_KN;
    let heeft_n = punten.iter().any(|p| n_n(p).abs() > TOL_N_KN * 1e3);
    let heeft_m = max_m_knm > TOL_M_KNM;
    let heeft_v = max_v_kn > TOL_N_KN;
    if punten.iter().any(|p| p.forces.mz_ed.abs() > TOL_M_KNM || p.forces.vy_ed.abs() > TOL_N_KN || p.forces.mt_ed.abs() > TOL_M_KNM) {
        niet_getoetst.push("buiging om de zwakke as, dwarskracht V_y en torsie zijn niet in deze toets opgenomen".into());
    }
    if heeft_m {
        if is_z {
            notes.push("Z-profiel: buiging om de y-as (evenwijdig aan de flenzen) — geldig als de staaf zijdelings gesteund is; de hoofdassen zijn gedraaid".into());
        } else {
            notes.push("C/U-profiel: een belasting door het lijf grijpt niet aan in het dwarskrachtcentrum; de wringing die daaruit volgt is alleen gedekt bij een over de lengte tegen wringen gesteunde staaf".into());
        }
    }

    let mut checks: Vec<NamedCheck> = Vec::new();

    // Trek §6.1.2
    if let Some(m) = maatgevend(punten, |p| (n_n(p) > TOL_N_KN * 1e3).then(|| (n_n(p), n_t_rd))) {
        checks.push(met_uc(
            "kv_trek", "Trek", "6.1.2", &m,
            r"N_{t,Rd} = f_{ya} A_g / \gamma_{M0}", r"N_{Ed} / N_{t,Rd}",
            vec![nv("f_{ya}", fya, "N/mm²"), nv("A_g", a_g, "mm²"), nv(r"\gamma_{M0}", GAMMA_M0, "-")],
            vec![stap("f_ya", "Gemiddelde vloeigrens", "f_{ya}", "3.2.2, (3.1)",
                r"f_{ya} = f_{yb} + (f_u - f_{yb}) \frac{k n t^2}{A_g} \le \frac{f_u + f_{yb}}{2}",
                format!(r"f_{{ya}} = {f_yb} + ({f_u} - {f_yb}) \frac{{{K_FYA} \cdot {} \cdot {t}^2}}{{{a_g:.1}}} = {fya:.2}", d.aantal_zettingen()),
                Some(fya), "N/mm²",
                vec!["k = 5 (veilige ondergrens; k = 7 voor rolvormen niet benut); niet na een warmtebehandeling boven 580 °C (§3.2.2(5))".into()])],
            "N",
            vec!["F_n,Rd van de netto doorsnede bij verbindingen (§8.4) is niet getoetst: zonder gaten gerekend".into()],
        ));
    }

    // Druk §6.1.3
    if let Some(m) = maatgevend(punten, |p| (-n_n(p) > TOL_N_KN * 1e3).then(|| (-n_n(p), n_c_rd))) {
        checks.push(met_uc(
            "kv_druk", "Druk", "6.1.3", &m,
            r"N_{c,Rd} = A_{eff} f_{yb} / \gamma_{M0}", r"N_{Ed} / N_{c,Rd}",
            vec![nv("A_{eff}", a_eff, "mm²"), nv("A_g", a_g, "mm²"), nv("f_{yb}", f_yb, "N/mm²"), nv(r"\gamma_{M0}", GAMMA_M0, "-")],
            stappen_druk.clone(), "N",
            vec![
                format!("A_eff = {a_eff:.1} mm² (A_g = {a_g:.1} mm²); verschuiving zwaartepunt e_N,y = {:.2} mm, e_N,z = {:.2} mm", e_druk.e_ny_mm, e_druk.e_nz_mm),
                "de verhoging naar f_ya bij een volledig effectieve doorsnede (6.2) is niet benut (veilig)".into(),
            ],
        ));
    }

    // Buiging §6.1.4.1
    if let Some(m) = maatgevend(punten, |p| (m_nmm(p) > TOL_M_KNM * 1e6).then(|| (m_nmm(p), m_c_rd))) {
        checks.push(met_uc(
            "kv_buiging", "Buiging", "6.1.4.1", &m,
            r"M_{c,Rd} = W_{eff} f_{yb} / \gamma_{M0}", r"M_{Ed} / M_{c,Rd}",
            vec![nv("W_{eff}", w_eff, "mm³"), nv("W_{el}", w_el_y, "mm³"), nv("f_{yb}", f_yb, "N/mm²"), nv(r"\gamma_{M0}", GAMMA_M0, "-")],
            stappen_buig.clone(), "N·mm",
            vec![
                format!("W_eff,boven = {:.0} mm³, W_eff,onder = {:.0} mm³ (kleinste gebruikt; geldt voor beide momentrichtingen)", e_buig.w_y_boven_mm3, e_buig.w_y_onder_mm3),
                "plastische reserve (6.4) bij W_eff = W_el niet benut (veilig)".into(),
            ],
        ));
    }

    // Dwarskracht §6.1.5
    if heeft_v {
        if let Some(m) = maatgevend(punten, |p| Some((v_n(p), v_rd))) {
            checks.push(met_uc(
                "kv_dwarskracht", "Dwarskracht", "6.1.5", &m,
                r"V_{b,Rd} = \frac{h_w}{\sin\phi} t f_{bv} / \gamma_{M0}", r"V_{Ed} / V_{b,Rd}",
                vec![nv("h_w", hp, "mm"), nv("t", t, "mm"), nv("f_{bv}", fbv, "N/mm²"), nv(r"\gamma_{M0}", GAMMA_M0, "-")],
                vec![stap("lambda_w", "Relatieve lijfslankheid", r"\bar\lambda_w", "6.1.5, (6.10a)",
                    r"\bar\lambda_w = 0{,}346 \frac{s_w}{t} \sqrt{f_{yb}/E}",
                    format!(r"\bar\lambda_w = 0{{,}}346 \cdot {hp:.1}/{t} \cdot \sqrt{{{f_yb}/{E_STAAL}}} = {lw:.3} \Rightarrow f_{{bv}} = {fbv:.1}"),
                    Some(lw), "-",
                    vec!["tabel 6.1, kolom zonder verstijving bij de oplegging (veilig)".into()])],
                "N", Vec::new(),
            ));
        }
    }

    // N + M + V, §6.1.8–6.1.10 (lineair, met e_N bij druk)
    let e_n_aanwezig = heeft_druk && (e_ny > 1e-6 || e_nz > 1e-6);
    if (heeft_n && heeft_m) || (heeft_m && heeft_v) || e_n_aanwezig {
        let interactie = |p: &ForcePoint| {
            let n = n_n(p);
            let (n_rd, dm_y, dm_z) = if n >= 0.0 { (n_t_rd, 0.0, 0.0) } else { (n_c_rd, -n * e_nz, -n * e_ny) };
            let v = v_n(p);
            let term_v = if v > 0.5 * v_rd { (2.0 * v / v_rd - 1.0).powi(2) } else { 0.0 };
            n.abs() / n_rd + (m_nmm(p) + dm_y) / m_c_rd + if dm_z > 0.0 { dm_z / m_cz_rd } else { 0.0 } + term_v
        };
        if let Some(m) = maatgevend(punten, |p| Some((interactie(p), 1.0))) {
            let mut nt = vec![
                "druk: N_Ed/N_c,Rd + (M_y,Ed + ΔM_y)/M_cy,Rd,com + ΔM_z/M_cz,Rd,com (6.25) met ΔM = N_Ed·e_N; trek: N_Ed/N_t,Rd + M_y,Ed/M_cy,Rd (6.1.8) met de kleinste W_eff".into(),
                "dwarskracht (6.27): + (1 − M_f,Rd/M_pl,Rd)(2V_Ed/V_w,Rd − 1)² als V_Ed > 0,5 V_w,Rd, met M_f,Rd = 0 (veilig)".into(),
            ];
            if e_ny > 1e-6 {
                nt.push(format!(
                    "M_cz,Rd,com = {:.3} kNm met W_z,eff,min van de effectieve doorsnede bij UNIFORME druk ({:.0} mm³): benadering aan de veilige kant van de effectieve doorsnede bij buiging om z",
                    m_cz_rd / 1e6, e_druk.w_z_min_mm3
                ));
            }
            checks.push(met_uc(
                "kv_n_m_v", "Normaalkracht, buiging en dwarskracht", "6.1.8–6.1.10", &m,
                r"\frac{N_{Ed}}{N_{Rd}} + \frac{M_{y,Ed} + \Delta M_{y,Ed}}{M_{cy,Rd}} + \frac{\Delta M_{z,Ed}}{M_{cz,Rd,com}} + \left(\frac{2V_{Ed}}{V_{w,Rd}} - 1\right)^2 \le 1",
                r"\sum",
                vec![nv("N_{t,Rd}", n_t_rd, "N"), nv("N_{c,Rd}", n_c_rd, "N"), nv("M_{cy,Rd}", m_c_rd, "N·mm"),
                     nv("M_{cz,Rd,com}", m_cz_rd, "N·mm"), nv("e_{N,y}", e_ny, "mm"), nv("e_{N,z}", e_nz, "mm"), nv("V_{w,Rd}", v_rd, "N")],
                Vec::new(), "-", nt,
            ));
        }
    }

    // Knik §6.2.2 en (buig)torsieknik §6.2.3
    let mut n_b_rd_min = f64::INFINITY;
    if heeft_druk {
        let l_y = input.buckling_length_y_m * 1e3;
        let l_z = input.buckling_length_z_m * 1e3;
        let l_t = l_t_m * 1e3;
        let i0_kw = (i_y + i_z) / a_g + y0 * y0 + z0 * z0;
        let n_cr_t = weerstand::n_cr_t(i_t, i_w, l_t, i0_kw);
        // (id, titel, artikel, N_cr, uitleg)
        let mut vormen: Vec<(String, String, &str, f64, String)> = Vec::new();
        if is_z {
            // Puntsymmetrisch: dwarskrachtcentrum = zwaartepunt; knik om de
            // hoofdassen met de grootste van beide kniklengten (veilig).
            let (i_u, i_v, hoek) = grootheden_hoofdassen(i_y, i_z, i_yz);
            let l = l_y.max(l_z);
            vormen.push(("kv_knik_u".into(), "Knik om de hoofdas u".into(), "6.2.2", weerstand::n_cr(i_u, l),
                format!("I_u = {i_u:.0} mm⁴ (hoek {:.1}°), L_cr = max(L_y, L_z) = {l:.0} mm", hoek.to_degrees())));
            vormen.push(("kv_knik_v".into(), "Knik om de hoofdas v".into(), "6.2.2", weerstand::n_cr(i_v, l),
                format!("I_v = {i_v:.0} mm⁴, L_cr = max(L_y, L_z) = {l:.0} mm")));
            vormen.push(("kv_torsieknik".into(), "Torsieknik".into(), "6.2.3", n_cr_t,
                format!("N_cr,T = (G I_t + π² E I_w / l_T²)/i_0² met l_T = {l_t:.0} mm, i_0² = {i0_kw:.1} mm² (y_0 = z_0 = 0)")));
        } else {
            let n_cr_y = weerstand::n_cr(i_y, l_y);
            let n_cr_z = weerstand::n_cr(i_z, l_z);
            let n_cr_tf = weerstand::n_cr_tf(n_cr_y, n_cr_t, y0, i0_kw);
            vormen.push(("kv_knik_y".into(), "Knik om de y-as".into(), "6.2.2", n_cr_y, format!("I_y = {i_y:.0} mm⁴, L_cr = {l_y:.0} mm")));
            vormen.push(("kv_knik_z".into(), "Knik om de z-as".into(), "6.2.2", n_cr_z, format!("I_z = {i_z:.0} mm⁴, L_cr = {l_z:.0} mm")));
            vormen.push(("kv_buigtorsieknik".into(), "Buigtorsieknik".into(), "6.2.3", n_cr_tf.min(n_cr_t),
                format!(
                    "N_cr,T = {:.1} kN (l_T = {l_t:.0} mm, I_t = {i_t:.1} mm⁴, I_w = {i_w:.4e} mm⁶), N_cr,y = {:.1} kN, y_0 = {y0:.2} mm, i_0² = {i0_kw:.1} mm² → N_cr,TF = {:.1} kN (6.35)",
                    n_cr_t / 1e3, n_cr_y / 1e3, n_cr_tf / 1e3
                )));
        }
        for (id, titel, art, ncr, uitleg) in vormen {
            let lam = (a_eff * f_yb / ncr).sqrt();
            let (phi, x) = weerstand::chi(lam, ALPHA_C);
            let n_b = weerstand::n_b_rd(x, a_eff, f_yb);
            n_b_rd_min = n_b_rd_min.min(n_b);
            if let Some(m) = maatgevend(punten, |p| (-n_n(p) > TOL_N_KN * 1e3).then(|| (-n_n(p), n_b))) {
                let stappen = vec![
                    stap("n_cr", "Kritieke last", "N_{cr}", art, r"N_{cr}", format!(r"N_{{cr}} = {:.1}\ \text{{kN}}", ncr / 1e3), Some(ncr), "N", vec![uitleg.clone()]),
                    stap("lambda", "Relatieve slankheid", r"\bar\lambda", "6.2.2(2)",
                         r"\bar\lambda = \sqrt{A_{eff} f_{yb} / N_{cr}}",
                         format!(r"\bar\lambda = \sqrt{{{a_eff:.1} \cdot {f_yb} / {ncr:.0}}} = {lam:.3}"), Some(lam), "-", Vec::new()),
                    stap("chi", "Knikfactor", r"\chi", "6.2.2, EN 1993-1-1 6.3.1.2",
                         r"\phi = 0{,}5[1 + \alpha(\bar\lambda - 0{,}2) + \bar\lambda^2];\ \chi = 1/(\phi + \sqrt{\phi^2 - \bar\lambda^2}) \le 1",
                         format!(r"\alpha = {ALPHA_C},\ \phi = {phi:.3},\ \chi = {x:.3}"), Some(x), "-", Vec::new()),
                ];
                checks.push(met_uc(
                    &id, &titel, art, &m,
                    r"N_{b,Rd} = \chi A_{eff} f_{yb} / \gamma_{M1}", r"N_{Ed} / N_{b,Rd}",
                    vec![nv(r"\chi", x, "-"), nv("A_{eff}", a_eff, "mm²"), nv("f_{yb}", f_yb, "N/mm²"), nv(r"\gamma_{M1}", GAMMA_M1, "-")],
                    stappen, "N",
                    vec!["knikkromme c (α = 0,49) voor elke knikvorm: de ongunstigste kromme van tabel 6.3 voor open profielen (veilig)".into()],
                ));
            }
        }
    }

    // Kip §6.2.4
    if heeft_m {
        if input.zijdelings_gesteund {
            notes.push("Kip (6.2.4) niet getoetst: de gebruiker verklaart dat de staaf over de hele lengte zijdelings en tegen wringen gesteund is".into());
        } else {
            niet_getoetst.push("kip (6.2.4) is niet geïmplementeerd — alleen toetsbaar als de staaf zijdelings gesteund is opgegeven; gordingen met dakbeschot (10.1) vallen buiten deze toets".into());
            checks.push(zonder_uc("kv_kip", "Kip", "6.2.4",
                "niet geïmplementeerd; geef 'zijdelings gesteund' op als kip uitgesloten is".into()));
        }
    }

    // Druk + buiging, stabiliteit §6.2.5
    if heeft_druk && (heeft_m || e_ny > 1e-6) {
        if e_ny > 1e-6 {
            niet_getoetst.push(format!(
                "stabiliteit bij druk met het extra moment N·e_N,y om de zwakke as (e_N,y = {e_ny:.2} mm, §6.1.3(4)) is niet geïmplementeerd (§6.2.5 / EN 1993-1-1 §6.3.3)"
            ));
            checks.push(zonder_uc("kv_knik_buiging", "Druk en buiging (stabiliteit)", "6.2.5",
                "niet geïmplementeerd voor een doorsnede met verschuiving e_N om de zwakke as (C, U)".into()));
        } else if !input.zijdelings_gesteund {
            niet_getoetst.push("staaf op druk en buiging (6.2.5) zonder zijdelingse steun: kip niet geïmplementeerd, dus ook 6.2.5 niet".into());
            checks.push(zonder_uc("kv_knik_buiging", "Druk en buiging (stabiliteit)", "6.2.5",
                "niet getoetst — vereist M_b,Rd (kip)".into()));
        } else if let Some(m) = maatgevend(punten, |p| {
            (-n_n(p) > TOL_N_KN * 1e3).then(|| ((-n_n(p) / n_b_rd_min).powf(0.8) + (m_nmm(p) / m_c_rd).powf(0.8), 1.0))
        }) {
            checks.push(met_uc(
                "kv_knik_buiging", "Druk en buiging (stabiliteit)", "6.2.5", &m,
                r"\left(\frac{N_{Ed}}{N_{b,Rd}}\right)^{0{,}8} + \left(\frac{M_{Ed}}{M_{b,Rd}}\right)^{0{,}8} \le 1",
                r"\sum",
                vec![nv("N_{b,Rd}", n_b_rd_min, "N"), nv("M_{b,Rd}", m_c_rd, "N·mm")],
                Vec::new(), "-",
                vec!["(6.36), §6.2.5(2); N_b,Rd = kleinste van alle knikvormen; M_b,Rd = M_c,Rd omdat de staaf zijdelings gesteund is opgegeven".into()],
            ));
        }
    }

    // Doorbuiging §7 (grens = projecteis).
    match (input.deflection_mm, input.deflection_limit_numerator) {
        (Some(w), Some(n)) if w.is_finite() && n.is_finite() && n > 0.0 => {
            let grens = input.length_m * 1e3 / n;
            // §7.1(3): stijfheid met de effectieve doorsnede. Die bij f_yb
            // (buiging) is de kleinste, dus de schaling is veilig.
            let factor = (i_y / e_buig.i_y_eff_mm4).max(1.0);
            let w_eff = w.abs() * factor;
            let m = Maatgevend { punt: punten[0], ed: w_eff, rd: grens, uc: w_eff / grens };
            checks.push(met_uc(
                "kv_doorbuiging", "Doorbuiging (BGT)", "7.1", &m,
                r"w \cdot I_y / I_{y,eff} \le L / n", r"w_{eff} / (L/n)",
                vec![nv("w", w.abs(), "mm"), nv("I_y/I_{y,eff}", factor, "-"), nv("L", input.length_m * 1e3, "mm"), nv("n", n, "-")],
                Vec::new(), "mm",
                vec!["de analyse rekent met de bruto doorsnede; w is opgeschaald met I_y/I_y,eff van de effectieve doorsnede bij f_yb (§7.1(3), veilig)".into()],
            ));
        }
        _ => notes.push("Doorbuiging (7) niet getoetst: geen BGT-doorbuiging met grens opgegeven".into()),
    }

    // ── Samenvatting ────────────────────────────────────────────────────
    let mut uc_max = 0.0_f64;
    let mut governing = String::new();
    let mut niet_ok = false;
    for c in &checks {
        if let CheckKind::Resistance(r) = &c.kind {
            if let Some(u) = &r.uc {
                if u.uc > uc_max || governing.is_empty() {
                    uc_max = uc_max.max(u.uc);
                    governing = c.id.clone();
                }
            }
            if r.status == CheckStatus::NotOk {
                niet_ok = true;
            }
        }
    }
    let status = if niet_ok {
        CheckStatus::NotOk
    } else if !niet_getoetst.is_empty() {
        CheckStatus::NotApplicable
    } else {
        CheckStatus::Ok
    };

    KoudgevormdBeamCheckResult {
        beam_id: input.beam_id,
        section_name: input.section_name.clone(),
        koudgevormd_staalsoort: mat.aanduiding.clone(),
        materiaal: Some(mat),
        norm: NORM.into(),
        grootheden: Some(grootheden),
        effectief_druk: Some(e_druk),
        effectief_buiging: Some(e_buig),
        checks,
        uc_max,
        status,
        governing_check_id: governing,
        niet_getoetst,
        notes,
    }
}

/// `(I_u, I_v, hoek)` uit `I_y`, `I_z`, `I_yz`.
fn grootheden_hoofdassen(i_y: f64, i_z: f64, i_yz: f64) -> (f64, f64, f64) {
    let m = 0.5 * (i_y + i_z);
    let r = (0.25 * (i_y - i_z).powi(2) + i_yz * i_yz).sqrt();
    (m + r, m - r, 0.5 * (-2.0 * i_yz).atan2(i_y - i_z))
}
