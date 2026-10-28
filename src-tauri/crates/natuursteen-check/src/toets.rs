//! De elementtoets: sterkten uit proeven, buiging, druk, afschuiving,
//! oplegdruk, doorbuiging en verankering van een natuurstenen element.

use crate::input::*;
use crate::result::*;
use crate::statistiek::{self, Verdeling};
use mechanics::{ForceStateSnapshot, InternalForces};
use nen_en_1993_1_1_section::{CheckStatus, Deelstap, NamedValue, ResistanceCalc, UnityCheck};
use steel_check::{CheckKind, NamedCheck};

/// De normaanduiding in elk resultaat en rapport. Er is geen Eurocode voor
/// het ontwerp van natuurstenen elementen: de sterkten komen uit de
/// proefnormen, de karakteristieke waarde uit NEN-EN 1990 bijlage D, en de
/// materiaal- en reductiefactoren zijn opgave met bron.
pub const NORM: &str = "NEN-EN 1990 bijlage D (karakteristieke waarde uit proeven); \
    EN 12372 / EN 13161 (buigsterkte), EN 1926 (druksterkte), EN 13364 (breuklast ankergat)";

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

/// Krachtenstaat voor het rapport: `n_ed` DRUK positief (zoals de invoer).
fn staat(n: f64, v: f64, m: f64) -> ForceStateSnapshot {
    ForceStateSnapshot {
        combination_id: 0,
        position_mm: 0.0,
        forces: InternalForces { n_ed: n, vy_ed: 0.0, vz_ed: v, mt_ed: 0.0, my_ed: m, mz_ed: 0.0 },
    }
}

#[allow(clippy::too_many_arguments)]
fn toets(id: &str, title: &str, article: &str, fs: ForceStateSnapshot, formule: &str, uc_formule: &str,
         ed: f64, rd: f64, unit: &str, variables: Vec<NamedValue>, deelstappen: Vec<Deelstap>,
         notes: Vec<String>) -> NamedCheck {
    let uc = if rd > 0.0 { ed / rd } else { UC_ZONDER_WEERSTAND };
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

fn bron_verplicht(naam: &str, bron: &str) -> Result<(), String> {
    if bron.trim().is_empty() {
        Err(format!("{naam} is opgegeven zonder bron; geef de bron (proefrapport, productverklaring, richtlijn)"))
    } else {
        Ok(())
    }
}

/// Een opgegeven waarde met bron; `Err` met reden als hij onbruikbaar is.
fn normwaarde(naam: &str, w: &Normwaarde) -> Result<f64, String> {
    if !w.waarde.is_finite() || w.waarde <= 0.0 {
        return Err(format!("{naam} = {} is geen bruikbare waarde (verwacht een eindig getal > 0)", w.waarde));
    }
    bron_verplicht(naam, &w.bron)?;
    Ok(w.waarde)
}

fn positief(naam: &str, v: f64) -> Result<(), String> {
    if v.is_finite() && v > 0.0 { Ok(()) } else { Err(format!("{naam} = {v} moet een eindig getal > 0 zijn")) }
}

fn niet_negatief(naam: &str, v: f64) -> Result<(), String> {
    if v.is_finite() && v >= 0.0 { Ok(()) } else { Err(format!("{naam} = {v} moet een eindig getal ≥ 0 zijn")) }
}

/// De karakteristieke waarde van een sterkte, met de afleiding als deelstappen.
/// `sym` is het LaTeX-symbool (`f_{f,k}`), `eenheid` die van de waarden.
fn afleiding(naam: &str, sym: &str, opgave: &SterkteOpgave, eenheid: &str)
    -> Result<(SterkteAfleiding, Vec<Deelstap>), String> {
    match opgave {
        SterkteOpgave::Karakteristiek { waarde, bron } => {
            positief(naam, *waarde)?;
            bron_verplicht(naam, bron)?;
            let s = stap(
                &format!("{sym}_opgave"), &format!("{naam} (opgegeven)"), sym, "opgave",
                sym, format!("{sym} = {waarde}"), Some(*waarde), eenheid,
                vec![format!("Opgegeven karakteristieke waarde (bron: {}).", bron.trim())],
            );
            Ok((SterkteAfleiding { karakteristiek: *waarde, statistiek: None, bron: bron.trim().into() }, vec![s]))
        }
        SterkteOpgave::Proefresultaten { waarden, verdeling, bron } => {
            bron_verplicht(naam, bron)?;
            let st = statistiek::karakteristieke_waarde(waarden, *verdeling).map_err(|e| format!("{naam}: {e}"))?;
            let n = st.n;
            let mut stappen = vec![
                stap(&format!("{sym}_m"), &format!("{naam}: gemiddelde en spreiding"), "m_X", "NEN-EN 1990 §D.7.2",
                     "m_X = \\tfrac{1}{n}\\sum x_i, \\; s_X = \\sqrt{\\tfrac{\\sum (x_i - m_X)^2}{n-1}}",
                     format!("n = {n}, \\; m_X = {:.3}, \\; s_X = {:.3}, \\; V_X = {:.3}",
                             st.gemiddelde, st.standaardafwijking, st.variatiecoefficient),
                     Some(st.gemiddelde), eenheid, vec![format!("Proefrapport: {}.", bron.trim())]),
                stap(&format!("{sym}_kn"), "Fractielfactor (V_X onbekend)", "k_n", "NEN-EN 1990 tabel D.1",
                     "k_n = t_{n-1;\\,0{,}95} \\sqrt{1 + 1/n}",
                     format!("k_n = {:.3} \\cdot \\sqrt{{1 + 1/{n}}} = {:.3}", st.t_095, st.k_n),
                     Some(st.k_n), "-",
                     vec!["5%-fractiel, V_X onbekend (tabel D.1, Bayesiaans).".into()]),
            ];
            let k = st.karakteristiek;
            stappen.push(match verdeling {
                Verdeling::Normaal => stap(
                    &format!("{sym}_k"), &format!("{naam}: karakteristieke waarde"), sym, "NEN-EN 1990 (D.1)",
                    &format!("{sym} = m_X - k_n \\, s_X"),
                    format!("{sym} = {:.3} - {:.3} \\cdot {:.3} = {k:.3}", st.gemiddelde, st.k_n, st.standaardafwijking),
                    Some(k), eenheid, vec!["Normale verdeling.".into()],
                ),
                Verdeling::Lognormaal => {
                    let (my, sy) = (st.gemiddelde_ln.unwrap_or(0.0), st.standaardafwijking_ln.unwrap_or(0.0));
                    stap(
                        &format!("{sym}_k"), &format!("{naam}: karakteristieke waarde"), sym, "NEN-EN 1990 (D.2)",
                        &format!("{sym} = \\exp(m_Y - k_n \\, s_Y), \\; Y = \\ln X"),
                        format!("{sym} = \\exp({my:.4} - {:.3} \\cdot {sy:.4}) = {k:.3}", st.k_n),
                        Some(k), eenheid, vec!["Lognormale verdeling.".into()],
                    )
                }
            });
            Ok((SterkteAfleiding { karakteristiek: k, statistiek: Some(st), bron: bron.trim().into() }, stappen))
        }
    }
}

/// Alle materiaalgrootheden; `Err` als er iets wezenlijks ontbreekt.
fn sterkte(m: &NatuursteenMateriaal, notes: &mut Vec<String>)
    -> Result<(NatuursteenSterkte, Vec<Deelstap>, Vec<Deelstap>), String> {
    let gamma_m = normwaarde("γ_M", &m.gamma_m)?;
    if gamma_m < 1.0 {
        return Err(format!("γ_M = {gamma_m} < 1,0 is geen materiaalfactor"));
    }
    notes.push(format!("γ_M = {gamma_m} (bron: {})", m.gamma_m.bron.trim()));
    let mut k_totaal = 1.0;
    let mut k_tekst = Vec::new();
    for r in &m.reductiefactoren {
        if r.naam.trim().is_empty() {
            return Err("een reductiefactor zonder naam".into());
        }
        if !(r.waarde.is_finite() && r.waarde > 0.0 && r.waarde <= 1.0) {
            return Err(format!("reductiefactor {} = {} moet liggen in (0; 1]", r.naam.trim(), r.waarde));
        }
        bron_verplicht(&format!("reductiefactor {}", r.naam.trim()), &r.bron)?;
        k_totaal *= r.waarde;
        k_tekst.push(format!("{}", r.waarde));
        notes.push(format!("reductiefactor {} = {} (bron: {})", r.naam.trim(), r.waarde, r.bron.trim()));
    }
    if m.reductiefactoren.is_empty() {
        notes.push(
            "Geen reductiefactoren opgegeven voor vochttoestand, vorst of belastingsduur: f_d = f_k / γ_M. \
             Controleer of de toepassing (buiten, vochtig, blijvende belasting) een factor vraagt."
                .into(),
        );
    }
    let k_formule = if k_tekst.is_empty() { "1".to_string() } else { k_tekst.join(" \\cdot ") };
    notes.push(match m.buigproef {
        Buigproef::En12372 => "Buigsterkte volgens EN 12372 (geconcentreerde last).".into(),
        Buigproef::En13161 => "Buigsterkte volgens EN 13161 (constant moment).".into(),
    });
    notes.push(
        "γ_M en de reductiefactoren gelden gelijk voor buig-, druk- en schuifsterkte.".into(),
    );

    let (buig, mut buigstappen) = afleiding("buigsterkte", "f_{f,k}", &m.buigsterkte, "N/mm²")?;
    let f_fd = k_totaal * buig.karakteristiek / gamma_m;
    buigstappen.push(stap(
        "f_fd", "Rekenwaarde buigsterkte", "f_{f,d}", "opgave",
        "f_{f,d} = k \\, f_{f,k} / \\gamma_M",
        format!("f_{{f,d}} = {k_formule} \\cdot {:.3} / {gamma_m} = {f_fd:.3}", buig.karakteristiek),
        Some(f_fd), "N/mm²", Vec::new(),
    ));

    let mut drukstappen = Vec::new();
    let (druk, f_cd) = match &m.druksterkte {
        Some(o) => {
            let (d, mut st) = afleiding("druksterkte", "f_{c,k}", o, "N/mm²")?;
            let f_cd = k_totaal * d.karakteristiek / gamma_m;
            st.push(stap(
                "f_cd", "Rekenwaarde druksterkte", "f_{c,d}", "opgave",
                "f_{c,d} = k \\, f_{c,k} / \\gamma_M",
                format!("f_{{c,d}} = {k_formule} \\cdot {:.3} / {gamma_m} = {f_cd:.3}", d.karakteristiek),
                Some(f_cd), "N/mm²", vec!["Druksterkte volgens EN 1926.".into()],
            ));
            drukstappen = st;
            (Some(d), Some(f_cd))
        }
        None => (None, None),
    };
    let (f_vk, f_vd) = match &m.schuifsterkte {
        Some(w) => {
            let v = normwaarde("f_vk", w)?;
            notes.push(format!("f_vk = {v} N/mm² (bron: {})", w.bron.trim()));
            (Some(v), Some(k_totaal * v / gamma_m))
        }
        None => (None, None),
    };
    Ok((
        NatuursteenSterkte { gamma_m, k_totaal, buig, f_fd_mpa: f_fd, druk, f_cd_mpa: f_cd, f_vk_mpa: f_vk, f_vd_mpa: f_vd },
        buigstappen,
        drukstappen,
    ))
}

fn fout_resultaat(input: &NatuursteenElementInput, reden: String) -> NatuursteenElementResult {
    NatuursteenElementResult {
        element_id: input.element_id,
        naam: input.naam.clone(),
        soort: input.soort,
        norm: NORM.into(),
        sterkte: None,
        krachten: None,
        checks: Vec::new(),
        uc_max: 0.0,
        status: CheckStatus::NotApplicable,
        governing_check_id: String::new(),
        niet_getoetst: vec![format!("hele element: {reden}")],
        notes: vec![reden],
    }
}

/// `M_Ed`, `V_Ed`, `N_Ed` en de totale lijnlast uit de belasting.
fn rekenkrachten(input: &NatuursteenElementInput, notes: &mut Vec<String>) -> Result<(Rekenkrachten, Vec<Deelstap>), String> {
    let d = &input.doorsnede;
    match &input.belasting {
        Belasting::Krachten { m_ed_knm, v_ed_kn, n_ed_kn } => {
            for (n, v) in [("M_Ed", m_ed_knm), ("V_Ed", v_ed_kn), ("N_Ed", n_ed_kn)] {
                if !v.is_finite() {
                    return Err(format!("{n} = {v} is geen eindig getal"));
                }
            }
            Ok((Rekenkrachten { m_ed_knm: *m_ed_knm, v_ed_kn: *v_ed_kn, n_ed_kn: *n_ed_kn, q_totaal_kn_m: None }, Vec::new()))
        }
        Belasting::Ligger { schema, l_m, q_ed_kn_m, f_ed_kn, gamma_g } => {
            positief("l", *l_m)?;
            niet_negatief("q_Ed", *q_ed_kn_m)?;
            niet_negatief("F_Ed", *f_ed_kn)?;
            let mut stappen = Vec::new();
            let mut q = *q_ed_kn_m;
            if let Some(gg) = gamma_g {
                let gamma_g = normwaarde("γ_G", gg)?;
                let rho = match &input.materiaal.volumiek_gewicht {
                    Some(w) => normwaarde("volumiek gewicht", w)?,
                    None => return Err("γ_G is opgegeven maar het volumiek gewicht van het materiaal (EN 1936) ontbreekt".into()),
                };
                let g_k = rho * d.b_mm * d.h_mm / 1.0e6;
                q += gamma_g * g_k;
                notes.push(format!("γ_G = {gamma_g} (bron: {}); volumiek gewicht {rho} kN/m³ (bron: {})",
                    gg.bron.trim(), input.materiaal.volumiek_gewicht.as_ref().map(|w| w.bron.trim()).unwrap_or("")));
                stappen.push(stap(
                    "q_totaal", "Lijnlast incl. eigen gewicht", "q_{Ed}", "",
                    "q_{Ed} = q_{Ed,opg} + \\gamma_G \\, \\rho \\, b \\, h",
                    format!("q_{{Ed}} = {q_ed_kn_m} + {gamma_g} \\cdot {rho} \\cdot {:.3} \\cdot {:.3} = {q:.3}",
                            d.b_mm / 1000.0, d.h_mm / 1000.0),
                    Some(q), "kN/m", Vec::new(),
                ));
            } else {
                notes.push("Geen γ_G opgegeven: q_Ed bevat het eigen gewicht al.".into());
            }
            let l = *l_m;
            let f = *f_ed_kn;
            let (m, v, fm, fv) = match schema {
                Liggerschema::VrijOpgelegd => (
                    q * l * l / 8.0 + f * l / 4.0,
                    q * l / 2.0 + f / 2.0,
                    "M_{Ed} = q l^2/8 + F l/4",
                    "V_{Ed} = q l/2 + F/2",
                ),
                Liggerschema::Uitkragend => (
                    q * l * l / 2.0 + f * l,
                    q * l + f,
                    "M_{Ed} = q l^2/2 + F l",
                    "V_{Ed} = q l + F",
                ),
            };
            stappen.push(stap("m_ed", "Rekenmoment", "M_{Ed}", "", fm,
                format!("M_{{Ed}} = {m:.3}"), Some(m), "kNm",
                vec![format!("l = {l} m, q = {q:.3} kN/m, F = {f} kN ({schema:?}).")]));
            stappen.push(stap("v_ed", "Rekendwarskracht", "V_{Ed}", "", fv,
                format!("V_{{Ed}} = {v:.3}"), Some(v), "kN", Vec::new()));
            Ok((Rekenkrachten { m_ed_knm: m, v_ed_kn: v, n_ed_kn: 0.0, q_totaal_kn_m: Some(q) }, stappen))
        }
    }
}

pub fn check_all_natuursteen_elements(inputs: Vec<NatuursteenElementInput>) -> Vec<NatuursteenElementResult> {
    inputs.into_iter().map(|i| check_natuursteen_element(&i)).collect()
}

pub fn check_natuursteen_element(input: &NatuursteenElementInput) -> NatuursteenElementResult {
    let d = &input.doorsnede;
    for (naam, v) in [("b", d.b_mm), ("h", d.h_mm)] {
        if let Err(e) = positief(naam, v) {
            return fout_resultaat(input, e);
        }
    }
    let mut notes = vec![format!("Steen: {}.", input.materiaal.steensoort.trim())];
    let (sterkte, buigstappen, drukstappen) = match sterkte(&input.materiaal, &mut notes) {
        Ok(s) => s,
        Err(e) => return fout_resultaat(input, e),
    };
    let (kr, krachtstappen) = match rekenkrachten(input, &mut notes) {
        Ok(k) => k,
        Err(e) => return fout_resultaat(input, e),
    };

    let (b, h) = (d.b_mm, d.h_mm);
    let a = b * h;
    let w = b * h * h / 6.0;
    let m_abs = kr.m_ed_knm.abs();
    let n = kr.n_ed_kn;
    let mut checks = Vec::new();
    let mut niet_getoetst = Vec::new();
    let fs = staat(n, kr.v_ed_kn, kr.m_ed_knm);

    // ── Buiging: trekrand ───────────────────────────────────────────────────
    let sigma_m = m_abs * 1.0e6 / w;
    let sigma_n_trek = (-n).max(0.0) * 1.0e3 / a;
    let sigma_t = sigma_m + sigma_n_trek;
    let mut st = buigstappen.clone();
    st.extend(krachtstappen.iter().cloned());
    st.push(stap(
        "sigma_t", "Trekspanning in de uiterste vezel", "\\sigma_{t,Ed}", "",
        "\\sigma_{t,Ed} = \\frac{|M_{Ed}|}{W} + \\frac{\\max(0, -N_{Ed})}{A}, \\; W = b h^2 / 6",
        format!("\\sigma_{{t,Ed}} = \\frac{{{:.0}}}{{{w:.0}}} + \\frac{{{:.0}}}{{{a:.0}}} = {sigma_t:.3}",
                m_abs * 1.0e6, (-n).max(0.0) * 1.0e3),
        Some(sigma_t), "N/mm²",
        if n > 0.0 { vec!["Gunstige drukkracht niet in rekening gebracht (veilige kant).".into()] } else { Vec::new() },
    ));
    checks.push(toets(
        "buiging", "Buiging (trekrand)", "σ ≤ f_f,d", fs.clone(),
        "\\sigma_{t,Ed} \\le f_{f,d}", "\\frac{\\sigma_{t,Ed}}{f_{f,d}}", sigma_t, sterkte.f_fd_mpa, "N/mm²",
        vec![nv("b", b, "mm"), nv("h", h, "mm"), nv("W", w, "mm³"), nv("M_{Ed}", kr.m_ed_knm, "kNm"), nv("N_{Ed}", n, "kN")],
        st, Vec::new(),
    ));

    // ── Druk: drukrand ──────────────────────────────────────────────────────
    let sigma_c = sigma_m + n.max(0.0) * 1.0e3 / a;
    match sterkte.f_cd_mpa {
        Some(f_cd) if sigma_c > 0.0 => {
            let mut st = drukstappen.clone();
            st.push(stap(
                "sigma_c", "Drukspanning in de uiterste vezel", "\\sigma_{c,Ed}", "",
                "\\sigma_{c,Ed} = \\frac{|M_{Ed}|}{W} + \\frac{\\max(0, N_{Ed})}{A}",
                format!("\\sigma_{{c,Ed}} = {sigma_m:.3} + {:.3} = {sigma_c:.3}", n.max(0.0) * 1.0e3 / a),
                Some(sigma_c), "N/mm²", Vec::new(),
            ));
            checks.push(toets(
                "druk", "Druk (drukrand)", "σ ≤ f_c,d", fs.clone(),
                "\\sigma_{c,Ed} \\le f_{c,d}", "\\frac{\\sigma_{c,Ed}}{f_{c,d}}", sigma_c, f_cd, "N/mm²",
                vec![nv("A", a, "mm²"), nv("W", w, "mm³")], st, Vec::new(),
            ));
        }
        Some(_) => {}
        None if n > 0.0 => niet_getoetst.push(format!(
            "druk: N_Ed = {n} kN maar geen druksterkte (EN 1926) opgegeven"
        )),
        None if m_abs > 0.0 => notes.push(
            "Drukrand niet apart getoetst (geen druksterkte opgegeven): zonder normaalkracht is σ_c = σ_t, en de \
             druksterkte van natuursteen ligt ver boven de buigsterkte. Geef de druksterkte (EN 1926) op om dit \
             expliciet te toetsen."
                .into(),
        ),
        None => {}
    }
    if n > 0.0 {
        niet_getoetst.push(format!(
            "knik: N_Ed = {n} kN (druk); stabiliteit van een gedrukt natuurstenen element wordt niet getoetst"
        ));
    }

    // ── Kip ─────────────────────────────────────────────────────────────────
    if m_abs > 0.0 {
        if h <= b {
            notes.push("h ≤ b: buiging om de zwakke as, kip is niet mogelijk.".into());
        } else if input.zijdelings_gesteund {
            notes.push("Element opgegeven als zijdelings gesteund (bijv. ingemetseld): kip niet maatgevend.".into());
        } else {
            niet_getoetst.push(
                "kip: h > b en het element is niet als zijdelings gesteund opgegeven; kip wordt niet getoetst".into(),
            );
        }
    }

    // ── Afschuiving ─────────────────────────────────────────────────────────
    let v_abs = kr.v_ed_kn.abs();
    if v_abs > 0.0 {
        match (sterkte.f_vk_mpa, sterkte.f_vd_mpa) {
            (Some(f_vk), Some(f_vd)) => {
                let tau = 1.5 * v_abs * 1.0e3 / a;
                let mut st = krachtstappen.clone();
                st.push(stap(
                    "f_vd", "Rekenwaarde schuifsterkte", "f_{v,d}", "opgave", "f_{v,d} = k \\, f_{v,k} / \\gamma_M",
                    format!("f_{{v,d}} = {:.3} \\cdot {f_vk} / {} = {f_vd:.3}", sterkte.k_totaal, sterkte.gamma_m),
                    Some(f_vd), "N/mm²", Vec::new(),
                ));
                st.push(stap(
                    "tau", "Schuifspanning (rechthoek)", "\\tau_{Ed}", "", "\\tau_{Ed} = 1{,}5 \\, V_{Ed} / (b h)",
                    format!("\\tau_{{Ed}} = 1{{,}}5 \\cdot {:.0} / {a:.0} = {tau:.3}", v_abs * 1.0e3),
                    Some(tau), "N/mm²", Vec::new(),
                ));
                checks.push(toets(
                    "afschuiving", "Afschuiving", "τ ≤ f_v,d", fs.clone(),
                    "\\tau_{Ed} \\le f_{v,d}", "\\frac{\\tau_{Ed}}{f_{v,d}}", tau, f_vd, "N/mm²",
                    vec![nv("V_{Ed}", kr.v_ed_kn, "kN"), nv("A", a, "mm²")], st, Vec::new(),
                ));
            }
            _ => niet_getoetst.push(format!(
                "afschuiving: V_Ed = {} kN maar geen schuifsterkte f_vk (met bron) opgegeven", kr.v_ed_kn
            )),
        }
    }

    // ── Oplegdruk ───────────────────────────────────────────────────────────
    if let Some(o) = &input.oplegging {
        let geldig = positief("opleglengte a", o.a_mm).and_then(|_| niet_negatief("F_Ed oplegging", o.f_ed_kn));
        match (geldig, sterkte.f_cd_mpa) {
            (Err(e), _) => niet_getoetst.push(format!("oplegdruk: {e}")),
            (Ok(()), None) => niet_getoetst.push("oplegdruk: geen druksterkte (EN 1926) opgegeven".into()),
            (Ok(()), Some(f_cd)) => {
                let sigma = o.f_ed_kn * 1.0e3 / (o.a_mm * b);
                let mut st = drukstappen.clone();
                st.push(stap(
                    "sigma_opl", "Oplegdruk", "\\sigma_{Ed}", "", "\\sigma_{Ed} = F_{Ed} / (a \\, b)",
                    format!("\\sigma_{{Ed}} = {:.0} / ({} \\cdot {b}) = {sigma:.3}", o.f_ed_kn * 1.0e3, o.a_mm),
                    Some(sigma), "N/mm²",
                    vec!["Gelijkmatige oplegdruk over a × b, zonder spreiding of randafstand.".into()],
                ));
                checks.push(toets(
                    "oplegdruk", "Oplegdruk", "σ ≤ f_c,d", staat(o.f_ed_kn, 0.0, 0.0),
                    "F_{Ed} / (a b) \\le f_{c,d}", "\\frac{\\sigma_{Ed}}{f_{c,d}}", sigma, f_cd, "N/mm²",
                    vec![nv("F_{Ed}", o.f_ed_kn, "kN"), nv("a", o.a_mm, "mm"), nv("b", b, "mm")], st, Vec::new(),
                ));
            }
        }
    }

    // ── Doorbuiging (BGT) ───────────────────────────────────────────────────
    if let Some(db) = &input.doorbuiging {
        match doorbuiging(input, db, b, h) {
            Ok(c) => checks.push(c),
            Err(e) => niet_getoetst.push(format!("doorbuiging: {e}")),
        }
    }

    // ── Verankering (EN 13364) ──────────────────────────────────────────────
    if let Some(v) = &input.verankering {
        match verankering(v) {
            Ok(c) => checks.push(c),
            Err(e) => niet_getoetst.push(format!("verankering: {e}")),
        }
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
    NatuursteenElementResult {
        element_id: input.element_id,
        naam: input.naam.clone(),
        soort: input.soort,
        norm: NORM.into(),
        sterkte: Some(sterkte),
        krachten: Some(kr),
        checks,
        uc_max,
        status,
        governing_check_id: governing,
        niet_getoetst,
        notes,
    }
}

/// `w ≤ l / grens` voor een ligger (elastisch, ongescheurd, korte duur).
fn doorbuiging(input: &NatuursteenElementInput, db: &Doorbuiging, b: f64, h: f64) -> Result<NamedCheck, String> {
    let Belasting::Ligger { schema, l_m, gamma_g, .. } = &input.belasting else {
        return Err("alleen bij belasting als ligger (overspanning en schema nodig)".into());
    };
    let e = match &input.materiaal.e_modulus {
        Some(w) => normwaarde("E", w)?,
        None => return Err("geen elasticiteitsmodulus (EN 14146, met bron) opgegeven".into()),
    };
    let grens = normwaarde("doorbuigingsgrens", &db.grens)?;
    niet_negatief("q_ser", db.q_ser_kn_m)?;
    niet_negatief("F_ser", db.f_ser_kn)?;
    let mut q = db.q_ser_kn_m; // kN/m = N/mm
    let mut notes = vec![
        format!("E = {e} N/mm² (bron: {}); grens l/{grens} (bron: {})",
            input.materiaal.e_modulus.as_ref().map(|w| w.bron.trim()).unwrap_or(""), db.grens.bron.trim()),
        "Elastisch, ongescheurd, zonder kruip of afschuifvervorming.".into(),
    ];
    if gamma_g.is_some() {
        if let Some(rho) = &input.materiaal.volumiek_gewicht {
            let g_k = rho.waarde * b * h / 1.0e6;
            q += g_k;
            notes.push(format!("Eigen gewicht g_k = {g_k:.3} kN/m meegenomen (ongefactoreerd)."));
        }
    }
    let l = l_m * 1000.0;
    let i = b * h.powi(3) / 12.0;
    let f = db.f_ser_kn * 1.0e3;
    let (w, formule) = match schema {
        Liggerschema::VrijOpgelegd => (
            5.0 * q * l.powi(4) / (384.0 * e * i) + f * l.powi(3) / (48.0 * e * i),
            "w = \\frac{5 q l^4}{384 E I} + \\frac{F l^3}{48 E I}",
        ),
        Liggerschema::Uitkragend => (
            q * l.powi(4) / (8.0 * e * i) + f * l.powi(3) / (3.0 * e * i),
            "w = \\frac{q l^4}{8 E I} + \\frac{F l^3}{3 E I}",
        ),
    };
    let w_lim = l / grens;
    let st = vec![stap(
        "w", "Doorbuiging", "w", "", formule,
        format!("I = {i:.0} \\; mm^4, \\; w = {w:.3}"), Some(w), "mm", Vec::new(),
    )];
    Ok(toets(
        "doorbuiging", "Doorbuiging (BGT)", "w ≤ l / grens", staat(0.0, 0.0, 0.0),
        "w \\le l / grens", "\\frac{w}{l/grens}", w, w_lim, "mm",
        vec![nv("l", l, "mm"), nv("E", e, "N/mm²"), nv("I", i, "mm⁴"), nv("q", q, "N/mm"), nv("F", f, "N")],
        st, notes,
    ))
}

/// `F_Ed ≤ F_k / γ` met F_k de karakteristieke breuklast bij het ankergat.
fn verankering(v: &Verankering) -> Result<NamedCheck, String> {
    let (afl, mut st) = afleiding("breuklast ankergat", "F_{k}", &v.breuklast, "kN")?;
    let gamma = normwaarde("γ verankering", &v.gamma)?;
    if gamma < 1.0 {
        return Err(format!("γ = {gamma} < 1,0 is geen veiligheidsfactor"));
    }
    niet_negatief("F_Ed anker", v.f_ed_kn)?;
    let f_rd = afl.karakteristiek / gamma;
    st.push(stap(
        "f_rd_anker", "Rekenwaarde breuklast", "F_{Rd}", "", "F_{Rd} = F_k / \\gamma",
        format!("F_{{Rd}} = {:.3} / {gamma} = {f_rd:.3}", afl.karakteristiek), Some(f_rd), "kN",
        vec![format!("γ = {gamma} (bron: {}).", v.gamma.bron.trim())],
    ));
    Ok(toets(
        "verankering", "Verankering (breuklast ankergat)", "EN 13364", staat(0.0, v.f_ed_kn, 0.0),
        "F_{Ed} \\le F_k / \\gamma", "\\frac{F_{Ed}}{F_{Rd}}", v.f_ed_kn, f_rd, "kN",
        vec![nv("F_{Ed}", v.f_ed_kn, "kN"), nv("F_k", afl.karakteristiek, "kN")], st,
        vec!["Plaatdikte en gatpositie volgens EN 1469 zijn niet getoetst; alleen de breuklast per anker.".into()],
    ))
}
