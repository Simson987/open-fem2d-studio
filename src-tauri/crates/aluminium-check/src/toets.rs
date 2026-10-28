//! De staaftoets: klassering, doorsnedeweerstanden, interactie en knik.
//!
//! Elke toets wordt over ALLE punten van het krachtsverloop geëvalueerd; de
//! maatgevende (hoogste UC) staat in het resultaat met zijn krachtenstaat.

use crate::input::{AluminiumBeamCheckInput, Lasstatus};
use crate::result::*;
use mechanics::{ForcePoint, ForceStateSnapshot, InternalForces};
use nen_en_1993_1_1_section::{CheckStatus, Deelstap, NamedValue, ResistanceCalc, UnityCheck};
use nen_en_1999_1_1::klasse::{self, Deelsoort};
use nen_en_1999_1_1::materiaal::{E_ALU, GAMMA_M1, GAMMA_M2};
use nen_en_1999_1_1::{knik, weerstand, zoek_legering, AluDoorsnede, Deelrol, Factoren, NORM};
use steel_check::{CheckKind, NamedCheck};

/// Onder deze waarden telt een kracht als nul (kN, kNm).
const TOL_N_KN: f64 = 1e-3;
const TOL_M_KNM: f64 = 1e-3;

fn nv(symbol: &str, value: f64, unit: &str) -> NamedValue {
    NamedValue { symbol: symbol.to_string(), value, unit: unit.to_string() }
}

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

/// Een rij "niet getoetst" of "niet van toepassing" zonder unity check.
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

/// Het maatgevende punt van een toets: hoogste `ed/rd` over het verloop.
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

fn fout_resultaat(input: &AluminiumBeamCheckInput, reden: String) -> AluminiumBeamCheckResult {
    AluminiumBeamCheckResult {
        beam_id: input.beam_id,
        section_name: input.section_name.clone(),
        legering: input.legering.clone(),
        materiaal: None,
        lasstatus: input.lasstatus,
        norm: NORM.into(),
        classificatie: None,
        grootheden: None,
        checks: Vec::new(),
        uc_max: 0.0,
        status: CheckStatus::NotApplicable,
        governing_check_id: String::new(),
        niet_getoetst: vec![format!("hele staaf: {reden}")],
        notes: vec![reden],
    }
}

pub fn check_all_aluminium_beams(inputs: Vec<AluminiumBeamCheckInput>) -> Vec<AluminiumBeamCheckResult> {
    inputs.into_iter().map(|i| check_aluminium_beam(&i)).collect()
}

pub fn check_aluminium_beam(input: &AluminiumBeamCheckInput) -> AluminiumBeamCheckResult {
    let d: &AluDoorsnede = &input.doorsnede;
    if let Err(e) = d.valideer() {
        return fout_resultaat(input, e);
    }
    let pos = |v: f64| v.is_finite() && v > 0.0;
    if !(pos(input.length_m) && pos(input.buckling_length_y_m) && pos(input.buckling_length_z_m)) {
        return fout_resultaat(input, "lengte en kniklengten moeten positief zijn".into());
    }
    if input.forces_envelope.is_empty() {
        return fout_resultaat(input, "geen krachtsverloop opgegeven".into());
    }
    let mat = match zoek_legering(&input.legering, d.t_max()) {
        Ok(m) => m,
        Err(e) => return fout_resultaat(input, e),
    };

    let f_o = mat.f_o;
    let f_u = mat.f_u;
    let kk = mat.knikklasse;
    // Lasstatus onbekend: veilig rekenen ALSOF gelast, maar nooit "voldoet".
    let gelast = input.lasstatus != Lasstatus::Geen;
    let rho_o = if gelast { mat.rho_o_haz } else { 1.0 };
    let rho_u = if gelast { mat.rho_u_haz } else { 1.0 };
    let eps = klasse::epsilon(f_o);

    let mut notes: Vec<String> = Vec::new();
    let mut niet_getoetst: Vec<String> = Vec::new();
    notes.push(format!(
        "{} — {} ({}, {} < t ≤ {} mm): f_o = {} N/mm², f_u = {} N/mm², knikklasse {:?}; E = {} N/mm²",
        mat.bron, mat.aanduiding, mat.productvorm, mat.t_min_mm, mat.t_max_mm, f_o, f_u, kk, E_ALU
    ));
    notes.push(format!(
        "γ_M1 = {GAMMA_M1}, γ_M2 = {GAMMA_M2}: aanbevolen waarden tabel 6.1; een afwijkende Nederlandse nationale bijlage is niet verwerkt"
    ));
    notes.push("Doorsnede zonder afrondingsstralen gemodelleerd (veilig voor A, I, W en voor de vlakke breedte b in β)".into());
    match input.lasstatus {
        Lasstatus::Geen => notes.push("Lasstatus: geen lassen (opgegeven) — geen HAZ-reductie".into()),
        Lasstatus::Gelast => notes.push(format!(
            "Gelast (MIG aangenomen): de hele doorsnede is in de HAZ gerekend (§6.1.6) met ρ_o,haz = {} en ρ_u,haz = {}; b_haz en TIG-reductie (§6.1.6.2) niet bepaald",
            mat.rho_o_haz, mat.rho_u_haz
        )),
        Lasstatus::Onbekend => {
            notes.push(format!(
                "Lasstatus onbekend: veilig gerekend alsof de hele doorsnede in de HAZ ligt (ρ_o,haz = {}, ρ_u,haz = {})",
                mat.rho_o_haz, mat.rho_u_haz
            ));
            niet_getoetst.push(
                "lasstatus onbekend — geef op of de staaf gelast is; zonder opgave wordt niet als ongelast goedgekeurd (§6.1.6)".into(),
            );
        }
    }

    // ── Klassering, §6.1.4 / lokale plooi §6.1.5 ─────────────────────────
    let mut delen: Vec<AluDeelKlasse> = Vec::new();
    let mut rho_druk = (1.0_f64, 1.0_f64); // (flens, lijf)
    let mut rho_buig = (1.0_f64, 1.0_f64);
    for deel in d.delen() {
        for (belasting, psi) in [("druk", 1.0), ("buiging", if deel.rol == Deelrol::Lijf { -1.0 } else { 1.0 })] {
            let eta = match deel.soort {
                Deelsoort::Uitstekend => 1.0,
                Deelsoort::Inwendig => klasse::eta_inwendig(psi),
            };
            let beta = klasse::beta(deel.soort, deel.b, deel.t, psi);
            let g = klasse::grenzen(kk, gelast, deel.soort);
            let kl = klasse::klasse(beta, eps, g);
            let rc = klasse::rho_c(beta, eps, kk, gelast, deel.soort);
            let doel = if belasting == "druk" { &mut rho_druk } else { &mut rho_buig };
            match deel.rol {
                Deelrol::Flens => doel.0 = rc,
                Deelrol::Lijf => doel.1 = rc,
            }
            delen.push(AluDeelKlasse {
                rol: deel.rol,
                soort: deel.soort,
                belasting: belasting.into(),
                b_mm: deel.b,
                t_mm: deel.t,
                eta,
                beta,
                beta_1: g[0] * eps,
                beta_2: g[1] * eps,
                beta_3: g[2] * eps,
                klasse: kl,
                rho_c: rc,
            });
        }
    }
    let klasse_van = |b: &str| delen.iter().filter(|k| k.belasting == b).map(|k| k.klasse).max().unwrap_or(1);
    let klasse_druk = klasse_van("druk");
    let klasse_buiging = klasse_van("buiging");
    if d.delen().is_empty() {
        notes.push("Massieve doorsnede: geen dunwandige plaatdelen, dus geen lokale plooi (klasse 1)".into());
    }

    let mut klassestappen: Vec<Deelstap> = vec![stap(
        "epsilon", "Materiaalparameter", r"\varepsilon", "tabel 6.2",
        r"\varepsilon = \sqrt{250 / f_o}",
        format!(r"\varepsilon = \sqrt{{250 / {f_o}}} = {eps:.3}"),
        Some(eps), "-", Vec::new(),
    )];
    for k in &delen {
        let rol = match k.rol { Deelrol::Flens => "flens", Deelrol::Lijf => "lijf" };
        let soort = match k.soort { Deelsoort::Uitstekend => "uitstekend", Deelsoort::Inwendig => "inwendig" };
        klassestappen.push(stap(
            &format!("klasse_{rol}_{}", k.belasting),
            &format!("Klasse {rol} ({soort}, {})", k.belasting),
            r"\beta", "6.1.4.3, tabel 6.2",
            r"\beta = \eta \, b / t",
            format!(
                r"\beta = {:.2} \cdot {:.1} / {:.1} = {:.2};\ \beta_1/\beta_2/\beta_3 = {:.2}/{:.2}/{:.2} \Rightarrow \text{{klasse }} {}",
                k.eta, k.b_mm, k.t_mm, k.beta, k.beta_1, k.beta_2, k.beta_3, k.klasse
            ),
            Some(k.beta), "-",
            if k.klasse == 4 {
                vec![format!("klasse 4: ρ_c = {:.3} (6.1.5, tabel 6.3) op de dikte", k.rho_c)]
            } else {
                Vec::new()
            },
        ));
    }

    // ── Doorsnedegrootheden ──────────────────────────────────────────────
    let bruto = d.buigeigenschappen(Factoren::uniform(1.0));
    let a = bruto.a;
    let (w_pl, w_pl_lijf) = d.w_pl_y();
    let i_z = d.i_z();

    // Druk: A_eff met de kleinste van ρ_c en ρ_o,haz per deel (§6.2.4, §6.1.6.2).
    let a_eff = d.oppervlak(rho_druk.0.min(rho_o), rho_druk.1.min(rho_o));
    // Voor knik: alleen lokale plooi (de HAZ zit bij een las in κ, die hier
    // niet berekend wordt — gelaste staven krijgen geen kniktoets).
    let a_eff_knik = d.oppervlak(rho_druk.0, rho_druk.1);
    let mut n_c_rd = weerstand::n_c_rd(a_eff, f_o);
    if gelast {
        n_c_rd = n_c_rd.min(a * rho_u * f_u / GAMMA_M2);
    }
    // Trek, §6.2.3: algemeen vloeien en breuk van de doorsnede.
    let a_g = d.oppervlak(rho_o, rho_o);
    let a_net = d.oppervlak(rho_u, rho_u);
    let n_o = weerstand::n_o_rd(a_g, f_o);
    let n_u = weerstand::n_u_rd(a_net, f_u);
    let n_t_rd = n_o.min(n_u);

    // Buiging, §6.2.5.
    let (w_o, alpha_tekst) = match klasse_buiging {
        1 | 2 => (rho_o * w_pl, format!("klasse {klasse_buiging}: α·W = W_pl (·ρ_o,haz)")),
        3 => (
            d.buigeigenschappen(Factoren::uniform(rho_o)).w,
            "klasse 3: α = 1 aangehouden (veilige ondergrens van α_3, tabel 6.4)".to_string(),
        ),
        _ => (
            d.buigeigenschappen(Factoren {
                flens_druk: rho_buig.0.min(rho_o),
                flens_trek: rho_o,
                lijf_druk: rho_buig.1.min(rho_o),
                lijf_trek: rho_o,
            })
            .w,
            "klasse 4: W_eff met ρ_c·t in de gedrukte delen (6.1.5), neutrale lijn verschoven, zonder iteratie".to_string(),
        ),
    };
    let w_net = d.buigeigenschappen(Factoren::uniform(rho_u)).w;
    let m_o = weerstand::m_o_rd(w_o, f_o);
    let m_u = weerstand::m_u_rd(w_net, f_u);
    let m_rd = m_o.min(m_u);
    // Bijdrage van het lijf aan M_o,Rd — de reductie bij grote dwarskracht.
    let w_lijf = if klasse_buiging <= 2 { w_pl_lijf } else { d.w_el_lijf() };
    let m_lijf = w_lijf * rho_o * f_o / GAMMA_M1;

    // Dwarskracht, §6.2.6.
    let rho_v_haz = rho_o.min(rho_u);
    let a_v = d.a_v() * rho_v_haz;
    let lijf_slank = d
        .delen()
        .iter()
        .find(|x| x.rol == Deelrol::Lijf)
        .map(|x| x.b / x.t)
        .filter(|hw_tw| *hw_tw > weerstand::LIJF_SLANK_GRENS * eps);
    let v_rd = weerstand::v_rd(a_v, f_o);

    let grootheden = AluGrootheden {
        a_mm2: a,
        i_y_mm4: bruto.i_y,
        i_z_mm4: i_z,
        w_el_y_mm3: bruto.w,
        w_pl_y_mm3: w_pl,
        a_v_mm2: d.a_v(),
        a_eff_mm2: a_eff,
        w_o_mm3: w_o,
        w_net_mm3: w_net,
    };

    // ── Krachten (N, N·mm) ───────────────────────────────────────────────
    let punten = &input.forces_envelope;
    let n_n = |p: &ForcePoint| p.forces.n_ed * 1e3;
    let v_n = |p: &ForcePoint| p.forces.vz_ed.abs() * 1e3;
    let m_nmm = |p: &ForcePoint| p.forces.my_ed.abs() * 1e6;
    let max_druk_kn = punten.iter().map(|p| -p.forces.n_ed).fold(0.0, f64::max);
    let max_m_knm = punten.iter().map(|p| p.forces.my_ed.abs()).fold(0.0, f64::max);
    let max_v_kn = punten.iter().map(|p| p.forces.vz_ed.abs()).fold(0.0, f64::max);
    if punten.iter().any(|p| p.forces.mz_ed.abs() > TOL_M_KNM || p.forces.vy_ed.abs() > TOL_N_KN || p.forces.mt_ed.abs() > TOL_M_KNM) {
        niet_getoetst.push("buiging om de zwakke as, dwarskracht V_y en torsie zijn niet in deze toets opgenomen".into());
    }

    let mut checks: Vec<NamedCheck> = Vec::new();
    let haz_noot = |v: &mut Vec<String>| {
        if gelast {
            v.push(format!("HAZ: ρ_o,haz = {rho_o}, ρ_u,haz = {rho_u} over de hele doorsnede"));
        }
    };

    // Trek §6.2.3
    if let Some(m) = maatgevend(punten, |p| (n_n(p) > TOL_N_KN * 1e3).then(|| (n_n(p), n_t_rd))) {
        let mut nt = vec![format!("N_o,Rd = {:.1} kN, N_u,Rd = {:.1} kN", n_o / 1e3, n_u / 1e3)];
        nt.push("N_u,Rd ook zonder gaten gerekend (A_net = A): veilig".into());
        haz_noot(&mut nt);
        checks.push(met_uc(
            "alu_trek", "Trek", "6.2.3", &m,
            r"N_{t,Rd} = \min\left(A_g f_o / \gamma_{M1};\ 0{,}9 A_{net} f_u / \gamma_{M2}\right)",
            r"N_{Ed} / N_{t,Rd}",
            vec![nv("A_g", a_g, "mm²"), nv("A_{net}", a_net, "mm²"), nv("f_o", f_o, "N/mm²"), nv("f_u", f_u, "N/mm²"),
                 nv(r"\gamma_{M1}", GAMMA_M1, "-"), nv(r"\gamma_{M2}", GAMMA_M2, "-")],
            Vec::new(), "N", nt,
        ));
    }

    // Druk §6.2.4
    if let Some(m) = maatgevend(punten, |p| (-n_n(p) > TOL_N_KN * 1e3).then(|| (-n_n(p), n_c_rd))) {
        let mut nt = vec![format!("klasse bij druk: {klasse_druk}; A_eff = {a_eff:.1} mm² (A = {a:.1} mm²)")];
        haz_noot(&mut nt);
        if gelast {
            nt.push("bij een las ook begrensd door A·ρ_u,haz·f_u/γ_M2 (veilig)".into());
        }
        checks.push(met_uc(
            "alu_druk", "Druk", "6.2.4", &m,
            r"N_{c,Rd} = A_{eff} f_o / \gamma_{M1}", r"N_{Ed} / N_{c,Rd}",
            vec![nv("A_{eff}", a_eff, "mm²"), nv("f_o", f_o, "N/mm²"), nv(r"\gamma_{M1}", GAMMA_M1, "-")],
            klassestappen.clone(), "N", nt,
        ));
    }

    // Buiging §6.2.5
    if let Some(m) = maatgevend(punten, |p| (m_nmm(p) > TOL_M_KNM * 1e6).then(|| (m_nmm(p), m_rd))) {
        let mut nt = vec![
            alpha_tekst.clone(),
            format!("M_o,Rd = {:.2} kNm, M_u,Rd = {:.2} kNm (W_net = {w_net:.0} mm³, zonder gaten)", m_o / 1e6, m_u / 1e6),
        ];
        haz_noot(&mut nt);
        checks.push(met_uc(
            "alu_buiging", "Buiging", "6.2.5", &m,
            r"M_{Rd} = \min\left(\alpha W_{el} f_o / \gamma_{M1};\ W_{net} f_u / \gamma_{M2}\right)",
            r"M_{Ed} / M_{Rd}",
            vec![nv(r"\alpha W_{el}", w_o, "mm³"), nv("W_{net}", w_net, "mm³"), nv("f_o", f_o, "N/mm²"), nv("f_u", f_u, "N/mm²"),
                 nv(r"\gamma_{M1}", GAMMA_M1, "-"), nv(r"\gamma_{M2}", GAMMA_M2, "-")],
            klassestappen.clone(), "N·mm", nt,
        ));
    }

    // Dwarskracht §6.2.6
    let shear_ok = lijf_slank.is_none();
    if max_v_kn > TOL_N_KN {
        if let Some(hw_tw) = lijf_slank {
            niet_getoetst.push(format!(
                "dwarskracht: slank lijf h_w/t_w = {hw_tw:.1} > 39ε = {:.1}; plooi door afschuiving niet geïmplementeerd",
                39.0 * eps
            ));
            checks.push(zonder_uc("alu_dwarskracht", "Dwarskracht", "6.2.6",
                format!("slank lijf (h_w/t_w = {hw_tw:.1} > 39ε) — niet getoetst")));
        } else if let Some(m) = maatgevend(punten, |p| Some((v_n(p), v_rd))) {
            let mut nt = vec![format!("A_v = {a_v:.1} mm²")];
            if d.lijf().is_none() {
                nt.push("massieve rechthoek: A_v = A/1,5 (elastisch τ_max = 1,5 V/A; veilig t.o.v. η_v A)".into());
            }
            haz_noot(&mut nt);
            checks.push(met_uc(
                "alu_dwarskracht", "Dwarskracht", "6.2.6", &m,
                r"V_{Rd} = A_v f_o / (\sqrt{3} \gamma_{M1})", r"V_{Ed} / V_{Rd}",
                vec![nv("A_v", a_v, "mm²"), nv("f_o", f_o, "N/mm²"), nv(r"\gamma_{M1}", GAMMA_M1, "-")],
                Vec::new(), "N", nt,
            ));
        }
    }

    // N + M (+ V), §6.2.8–6.2.10
    let heeft_n = punten.iter().any(|p| n_n(p).abs() > TOL_N_KN * 1e3);
    let heeft_m = max_m_knm > TOL_M_KNM;
    if heeft_n && heeft_m {
        let interactie = |p: &ForcePoint| {
            let n = n_n(p);
            let n_rd = if n >= 0.0 { n_t_rd } else { n_c_rd };
            let rv = if shear_ok { weerstand::rho_v(v_n(p), v_rd) } else { 0.0 };
            let m_v = (m_rd - rv * m_lijf).max(0.0);
            n.abs() / n_rd + if m_v > 0.0 { m_nmm(p) / m_v } else { f64::INFINITY }
        };
        if let Some(m) = maatgevend(punten, |p| Some((interactie(p), 1.0))) {
            let mut nt = vec![
                "exponenten ξ₀ = η₀ = γ₀ = 1 en ω₀ = 1 (lineaire, veilige vorm van 6.2.9.1)".to_string(),
                "M_V,Rd = M_Rd − ρ_V·W_lijf·f_o/γ_M1 met ρ_V = (2V_Ed/V_Rd − 1)² als V_Ed > 0,5 V_Rd (6.2.8)".into(),
            ];
            haz_noot(&mut nt);
            checks.push(met_uc(
                "alu_n_m_v", "Normaalkracht, buiging en dwarskracht", "6.2.8–6.2.10", &m,
                r"\frac{|N_{Ed}|}{N_{Rd}} + \frac{M_{Ed}}{M_{V,Rd}} \le 1",
                r"\frac{|N_{Ed}|}{N_{Rd}} + \frac{M_{Ed}}{M_{V,Rd}}",
                vec![nv("N_{t,Rd}", n_t_rd, "N"), nv("N_{c,Rd}", n_c_rd, "N"), nv("M_{Rd}", m_rd, "N·mm"),
                     nv("V_{Rd}", v_rd, "N"), nv("W_{lijf}", w_lijf, "mm³")],
                Vec::new(), "-", nt,
            ));
        }
    } else if heeft_m && max_v_kn > TOL_N_KN && shear_ok {
        // Alleen M + V: buiging met gereduceerde M_V,Rd (6.2.8).
        let mv = |p: &ForcePoint| (m_rd - weerstand::rho_v(v_n(p), v_rd) * m_lijf).max(0.0);
        if let Some(m) = maatgevend(punten, |p| (m_nmm(p) > TOL_M_KNM * 1e6).then(|| (m_nmm(p), mv(p)))) {
            checks.push(met_uc(
                "alu_m_v", "Buiging en dwarskracht", "6.2.8", &m,
                r"M_{V,Rd} = M_{Rd} - \rho_V W_{lijf} f_o / \gamma_{M1},\ \rho_V = (2V_{Ed}/V_{Rd} - 1)^2",
                r"M_{Ed} / M_{V,Rd}",
                vec![nv("M_{Rd}", m_rd, "N·mm"), nv("V_{Rd}", v_rd, "N"), nv("W_{lijf}", w_lijf, "mm³")],
                Vec::new(), "N·mm", vec!["geen reductie zolang V_Ed ≤ 0,5 V_Rd".into()],
            ));
        }
    }

    // Knik §6.3.1
    if max_druk_kn > TOL_N_KN {
        if gelast {
            niet_getoetst.push(
                "knik (6.3.1) van een gelaste staaf: de HAZ-factor κ (tabel 6.5) is niet geïmplementeerd".into(),
            );
            checks.push(zonder_uc("alu_knik", "Knik", "6.3.1",
                "gelaste staaf (of lasstatus onbekend): κ volgens tabel 6.5 niet geïmplementeerd — niet getoetst".into()));
        } else {
            for (as_naam, i, l_m) in [("y", bruto.i_y, input.buckling_length_y_m), ("z", i_z, input.buckling_length_z_m)] {
                let l = l_m * 1e3;
                let ncr = knik::n_cr(E_ALU, i, l);
                let lam = knik::lambda(a_eff_knik, f_o, ncr);
                let (phi, chi) = knik::chi(lam, kk);
                let (alpha, l0) = knik::kromme(kk);
                let n_b = chi * a_eff_knik * f_o / GAMMA_M1;
                if let Some(m) = maatgevend(punten, |p| (-n_n(p) > TOL_N_KN * 1e3).then(|| (-n_n(p), n_b))) {
                    let stappen = vec![
                        stap("n_cr", "Eulerse knikkracht", "N_{cr}", "6.3.1.2",
                             r"N_{cr} = \pi^2 E I / L_{cr}^2",
                             format!(r"N_{{cr}} = \pi^2 \cdot {E_ALU} \cdot {i:.4e} / {l:.0}^2 = {:.1}\ \text{{kN}}", ncr / 1e3),
                             Some(ncr), "N", Vec::new()),
                        stap("lambda", "Relatieve slankheid", r"\bar\lambda", "6.3.1.2",
                             r"\bar\lambda = \sqrt{A_{eff} f_o / N_{cr}}",
                             format!(r"\bar\lambda = \sqrt{{{a_eff_knik:.1} \cdot {f_o} / {ncr:.0}}} = {lam:.3}"),
                             Some(lam), "-", Vec::new()),
                        stap("chi", "Knikfactor", r"\chi", "6.3.1.2, tabel 6.6",
                             r"\phi = 0{,}5[1 + \alpha(\bar\lambda - \bar\lambda_0) + \bar\lambda^2];\ \chi = 1/(\phi + \sqrt{\phi^2 - \bar\lambda^2}) \le 1",
                             format!(r"\alpha = {alpha},\ \bar\lambda_0 = {l0},\ \phi = {phi:.3},\ \chi = {chi:.3}"),
                             Some(chi), "-", Vec::new()),
                    ];
                    checks.push(met_uc(
                        &format!("alu_knik_{as_naam}"),
                        &format!("Knik om de {}-as", as_naam), "6.3.1", &m,
                        r"N_{b,Rd} = \kappa \chi A_{eff} f_o / \gamma_{M1}", r"N_{Ed} / N_{b,Rd}",
                        vec![nv(r"\kappa", 1.0, "-"), nv(r"\chi", chi, "-"), nv("A_{eff}", a_eff_knik, "mm²"),
                             nv("f_o", f_o, "N/mm²"), nv("L_{cr}", l, "mm"), nv("I", i, "mm⁴")],
                        stappen, "N",
                        vec![format!("κ = 1 (geen las); knikklasse {kk:?}"),
                             "torsie- en buigtorsieknik niet maatgevend voor dubbelsymmetrische I-, koker- en massieve doorsneden (6.3.1.4(2))".into()],
                    ));
                }
            }
        }
    }

    // Kip §6.3.2 en N+M-stabiliteit §6.3.3: nog niet geïmplementeerd.
    if heeft_m {
        if input.zijdelings_gesteund {
            notes.push("Kip (6.3.2) niet getoetst: de gebruiker verklaart dat de gedrukte rand over de hele lengte zijdelings gesteund is".into());
        } else {
            niet_getoetst.push("kip (6.3.2) is niet geïmplementeerd — alleen toetsbaar als de staaf zijdelings gesteund is opgegeven".into());
            checks.push(zonder_uc("alu_kip", "Kip", "6.3.2",
                "niet geïmplementeerd; geef 'zijdelings gesteund' op als kip uitgesloten is".into()));
        }
    }
    if max_druk_kn > TOL_N_KN && heeft_m {
        niet_getoetst.push("staaf op druk en buiging (6.3.3) is niet geïmplementeerd".into());
        checks.push(zonder_uc("alu_knik_buiging", "Druk en buiging (stabiliteit)", "6.3.3",
            "niet geïmplementeerd — de doorsnede-interactie (6.2.9) is geen stabiliteitstoets".into()));
    }

    // Doorbuiging §7.2 (grens = projecteis).
    match (input.deflection_mm, input.deflection_limit_numerator) {
        (Some(w), Some(n)) if w.is_finite() && n.is_finite() && n > 0.0 => {
            let grens = input.length_m * 1e3 / n;
            let m = Maatgevend {
                punt: punten[0],
                ed: w.abs(),
                rd: grens,
                uc: w.abs() / grens,
            };
            checks.push(met_uc(
                "alu_doorbuiging", "Doorbuiging (BGT)", "7.2", &m,
                r"w \le L / n", r"w / (L/n)",
                vec![nv("w", w.abs(), "mm"), nv("L", input.length_m * 1e3, "mm"), nv("n", n, "-")],
                Vec::new(), "mm",
                vec!["EN 1999-1-1 §7.2 geeft geen grenswaarde: de noemer is een projecteis; E = 70 000 N/mm² in de analyse".into()],
            ));
        }
        _ => notes.push("Doorbuiging (7.2) niet getoetst: geen BGT-doorbuiging met grens opgegeven".into()),
    }

    // ── Samenvatting ─────────────────────────────────────────────────────
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

    AluminiumBeamCheckResult {
        beam_id: input.beam_id,
        section_name: input.section_name.clone(),
        legering: mat.aanduiding.clone(),
        materiaal: Some(mat),
        lasstatus: input.lasstatus,
        norm: NORM.into(),
        classificatie: Some(AluClassificatie { epsilon: eps, gelast, klasse_druk, klasse_buiging, delen }),
        grootheden: Some(grootheden),
        checks,
        uc_max,
        status,
        governing_check_id: governing,
        niet_getoetst,
        notes,
    }
}
