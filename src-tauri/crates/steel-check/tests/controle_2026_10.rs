//! Regressie op de controle van oktober 2026 (Open FEM Studio 2026.41.0),
//! de staalpunten B6, B7 en B15 en de grens van K5. De invoer is die van de
//! controle, als testdata in `design-mockup/testdata/controle-2026-10/`; de
//! verwachtingen zijn de HANDWAARDEN uit de controle, niet wat de kern gaf.
//!
//! * B6 — 6.2.8 bij V_Ed > 0,5·V_pl,Rd: (6.30) voor een I-profiel, en één
//!   UC-definitie (M_Ed/M_y,V,Rd) ook bij "voldoet niet".
//! * B7 — klasse 4: effectieve breedtes volgens NEN-EN 1993-1-5 4.4 en knik
//!   met A_eff (6.48)/(6.51), in plaats van "niet toetsbaar" met UC 0.
//! * B15 — w_fin van een vloer tegen ℓ_rep/250 (A1.4.3(4)), niet L/333.
//! * K5 — de grens bij een uitkraging: ℓ_rep = 2·L voor w_fin én w_add. (De
//!   zakking zelf, vanaf het ingeklemde eind, meet de invoerbouwer; zie
//!   `design-mockup/test-controle-2026-10.mjs`.)

use approx::assert_relative_eq;
use nen_en_1993_1_1_section::classification::CrossSectionClass;
use nen_en_1993_1_1_section::{CheckStatus, ResistanceCalc};
use serde_json::Value;
use steel_check::*;

const B6_A: &str = include_str!("../../../../design-mockup/testdata/controle-2026-10/b6-check-steel-beam-a.json");
const B6_B: &str = include_str!("../../../../design-mockup/testdata/controle-2026-10/b6-check-steel-beam-b.json");
const B7: &str = include_str!("../../../../design-mockup/testdata/controle-2026-10/b7-check-steel-beam.json");

/// De `arguments` van een opgeslagen MCP-aanroep als kerninvoer.
fn invoer(json: &str) -> BeamCheckInput {
    let v: Value = serde_json::from_str(json).expect("geldige JSON");
    serde_json::from_value(v["arguments"].clone()).expect("BeamCheckInput")
}

fn toets<'a>(r: &'a BeamCheckResult, id: &str) -> &'a NamedCheck {
    r.checks.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("toets {id} ontbreekt"))
}

fn weerstand<'a>(r: &'a BeamCheckResult, id: &str) -> &'a ResistanceCalc {
    match &toets(r, id).kind {
        CheckKind::Resistance(c) => c,
        CheckKind::Stability(_) => panic!("{id} is geen doorsnedetoets"),
    }
}

fn uc(c: &NamedCheck) -> Option<f64> {
    match &c.kind {
        CheckKind::Resistance(r) => r.uc.as_ref().map(|u| u.uc),
        CheckKind::Stability(s) => s.uc.as_ref().map(|u| u.uc),
    }
}

// ── B6 ──────────────────────────────────────────────────────────────────────

/// IPE 300 S235, V_z,Ed = 300 kN. Met de hand (controle): A_v = 2568 mm²,
/// V_pl,Rd = 348,42 kN, ρ = 0,5214, A_w = 278,6·7,1 = 1978,1 mm²,
/// M_y,V,Rd = (628 000 − ρ·A_w²/(4·7,1))·235·10⁻⁶ = 130,70 kNm.
/// De kern rekent met de catalogus-A_v = 2567 mm² (ρ = 0,52234) en komt op
/// 130,67 kNm: dezelfde formule, 0,02 % verschil uit A_v. Tot oktober 2026:
/// (1 − ρ)·M_pl = 70,49 kNm, UC 1,072 "voldoet niet".
#[test]
fn b6_run_b_voldoet_met_6_30() {
    let r = check_beam(invoer(B6_B));
    let mv = weerstand(&r, "6.2.8_combined_mv");
    assert_relative_eq!(mv.value, 130.70, max_relative = 5e-4);
    let u = mv.uc.as_ref().unwrap();
    assert_relative_eq!(u.uc, 0.765, max_relative = 2e-3);
    assert_relative_eq!(u.uc, 100.0 / mv.value, max_relative = 1e-12);
    assert_eq!(u.formula_latex, r"M_{y,Ed} / M_{y,V,Rd}");
    assert_eq!(mv.status, CheckStatus::Ok);
    // 6.2.10 met N = 0 zegt hetzelfde: (1 − ρ)·f_y alleen op het lijf.
    assert_relative_eq!(uc(toets(&r, "6.2.10_combined_mnv")).unwrap(), u.uc, max_relative = 1e-6);
    // De staaf voldoet: maatgevend is de dwarskracht zelf, 300/348,28 = 0,861.
    assert_eq!(r.status, CheckStatus::Ok);
    assert_relative_eq!(r.uc_max, 300.0 / 348.2837, max_relative = 1e-5);
}

/// Run a: M_y,Ed loopt op tot 200 kNm op x = 1000 mm. Hand: UC = 200/130,70
/// = 1,530 — als verhouding, ook nu het criterium niet voldoet (tot oktober
/// 2026 de evenredige overschrijding 1,420).
#[test]
fn b6_run_a_voldoet_niet_met_dezelfde_uc_definitie() {
    let r = check_beam(invoer(B6_A));
    let mv = weerstand(&r, "6.2.8_combined_mv");
    assert_relative_eq!(mv.force_state.position_mm, 1000.0, max_relative = 1e-12);
    let u = mv.uc.as_ref().unwrap();
    assert_relative_eq!(u.uc, 1.530, max_relative = 2e-3);
    assert_relative_eq!(u.ed, 200.0, max_relative = 1e-12);
    assert_relative_eq!(u.rd, 130.70, max_relative = 5e-4);
    assert_eq!(mv.status, CheckStatus::NotOk);
    assert_eq!(r.status, CheckStatus::NotOk);
    assert_eq!(r.governing_check_id, "6.2.8_combined_mv");
    // 6.2.10 met N = 0 en M_z = 0 zegt hetzelfde als 6.2.8, en met dezelfde
    // definitie: M_y,Ed/M_y,V,Rd = 1,530, ook bij "voldoet niet". Tot de
    // herziening stond hier de evenredige overschrijding 1/λ = 1,374: V schaalde
    // mee en ρ daalde, zodat dezelfde krachten twee verschillende UC's kregen.
    let mnv = weerstand(&r, "6.2.10_combined_mnv");
    let u10 = mnv.uc.as_ref().unwrap();
    assert_relative_eq!(u10.uc, u.uc, max_relative = 1e-9);
    assert_relative_eq!(u10.ed, 200.0, max_relative = 1e-12);
    assert_relative_eq!(u10.rd, u.rd, max_relative = 1e-9);
    assert_ne!(u10.formula_latex, r"1/\lambda");
    assert_eq!(mnv.status, CheckStatus::NotOk);
}

/// 6.2.10 MET NORMAALKRACHT, de lijf-alleen-tak: IPE 300 S235 (catalogus: A =
/// 5380 mm², A_v,z = 2567 mm², W_pl,y = 628 000 mm³, b = 150, t_f = 10,7,
/// t_w = 7,1, h_w = 300 − 2·10,7 = 278,6 mm), N_Ed = −300 kN, V_z,Ed = 300 kN,
/// M_y,Ed = 100 kNm. Met de hand:
///   V_pl,z,Rd  = 2567·235/√3 = 348,284 kN; ρ = (2·300/348,284 − 1)² = 0,52234
///   A_w        = 278,6·7,1 = 1978,06 mm²
///   N_pl,V,Rd  = (A − ρ·A_w)·f_y = (5380 − 1033,22)·235 = 1021,49 kN
///   M_pl,y,V,Rd = (628 000 − ρ·A_w²/(4·t_w))·f_y = 130,668 kNm (6.30)
///   n          = 300/1021,49 = 0,29369
///   a          = (A − ρ·A_w − 2·b·t_f)/(A − ρ·A_w) = (4346,78 − 3210)/4346,78 = 0,26152
///   M_N,y,Rd   = 130,668·(1 − 0,29369)/(1 − 0,5·0,26152) = 106,176 kNm (6.36)
///   UC         = 100/106,176 = 0,94183
/// (De controle rekende met A = 5381 en A_v = 2568: N_pl,V,Rd = 1021,7 kN,
/// a = 0,2617 en UC 0,9416 — 0,02 % verschil, uit de catalogusmaten.)
#[test]
fn b6_6_2_10_met_normaalkracht_alleen_het_lijf_verlaagd() {
    let mut inv = invoer(B6_B);
    for p in inv.forces_envelope.iter_mut() {
        p.forces.n_ed = -300.0;
    }
    let r = check_beam(inv);
    let mnv = weerstand(&r, "6.2.10_combined_mnv");
    let var = |sym: &str| mnv.variables.iter().find(|v| v.symbol == sym).unwrap_or_else(|| panic!("{sym}")).value;

    let v_pl = 2567.0 * 235.0 / 3f64.sqrt() * 1e-3;
    let rho = (2.0 * 300.0 / v_pl - 1.0f64).powi(2);
    let a_w = (300.0 - 2.0 * 10.7) * 7.1;
    let n_pl_v = (5380.0 - rho * a_w) * 235.0 * 1e-3;
    let m_pl_v = (628_000.0 - rho * a_w * a_w / (4.0 * 7.1)) * 235.0 * 1e-6;
    let n = 300.0 / n_pl_v;
    let a = (5380.0 - rho * a_w - 2.0 * 150.0 * 10.7) / (5380.0 - rho * a_w);
    let m_n = (m_pl_v * (1.0 - n) / (1.0 - 0.5 * a)).min(m_pl_v);
    assert_relative_eq!(rho, 0.52234, max_relative = 1e-4);
    assert_relative_eq!(n_pl_v, 1021.49, max_relative = 1e-5);
    assert_relative_eq!(m_pl_v, 130.668, max_relative = 1e-5);
    assert_relative_eq!(a, 0.26152, max_relative = 1e-4);
    assert_relative_eq!(m_n, 106.176, max_relative = 1e-5);

    assert_relative_eq!(var("N_{pl,Rd}"), n_pl_v, max_relative = 1e-9);
    assert_relative_eq!(var("M_{pl,y,Rd}"), m_pl_v, max_relative = 1e-9);
    assert_relative_eq!(var("a"), a, max_relative = 1e-9);
    assert_relative_eq!(mnv.value, m_n, max_relative = 1e-9);
    let u = mnv.uc.as_ref().unwrap();
    assert_relative_eq!(u.uc, 100.0 / m_n, max_relative = 1e-9);
    assert_relative_eq!(u.uc, 0.94183, max_relative = 1e-4);
    assert_eq!(u.formula_latex, r"M_{y,Ed} / M_{N,y,Rd}");
    assert_eq!(mnv.status, CheckStatus::Ok);
    // De ingevulde a-stap rekent op dezelfde verminderde doorsnede.
    let stap_a = mnv.deelstappen.iter().find(|d| d.id == "a").expect("deelstap a");
    assert!(stap_a.formula_latex.contains(r"\rho A_w"), "{}", stap_a.formula_latex);
}

// ── B7: lijfplooi — nooit "voldoet" bij een geweigerde schuiftoets ──────────

/// IPE 600 S460, L = 6 m, N_Ed = −1500 kN, M_y,Ed = 600 kNm in het midden.
/// h_w/t_w = (600 − 2·19)/12 = 46,83 > 72ε/η = 72·√(235/460)/1,2 = 42,89: de
/// plooitoets van NEN-EN 1993-1-5 §5 is nodig en niet geïmplementeerd, dus
/// 6.2.6 om z, 6.2.8 en 6.2.10 zijn geweigerd. V_pl,z,Rd = 8380·460/√3 =
/// 2225,57 kN is een bovengrens (6.2.6(1)).
fn ipe600_s460(v_z_kn: f64) -> BeamCheckInput {
    let punt = |x: f64, m: f64| mechanics::ForcePoint {
        combination_id: 1,
        position_mm: x,
        forces: mechanics::InternalForces { n_ed: -1500.0, vy_ed: 0.0, vz_ed: v_z_kn, mt_ed: 0.0, my_ed: m, mz_ed: 0.0 },
    };
    let mut inv = invoer(B6_B);
    inv.beam_id = 2;
    inv.profile_name = "IPE600".to_string();
    inv.steel_grade = "S460".to_string();
    inv.length_m = 6.0;
    inv.forces_envelope = vec![punt(0.0, 0.0), punt(3000.0, 600.0), punt(6000.0, 0.0)];
    inv.lateral_bracing.top_flange_positions = vec![0.0, 0.25, 0.5, 0.75, 1.0];
    inv.lateral_bracing.bottom_flange_positions = vec![0.0, 0.25, 0.5, 0.75, 1.0];
    inv
}

/// V_z,Ed = 2600 kN > V_pl,z,Rd = 2225,57 kN: de doorsnede bezwijkt al op
/// dwarskracht, wat de plooitoets ook zou zeggen. Status "voldoet niet", met
/// de dwarskracht als maatgevende toets (UC = 2600/2225,57 = 1,1682). Tot de
/// herziening: status Ok met uc_max 0,675.
#[test]
fn b7_lijfplooi_met_v_boven_v_pl_voldoet_niet() {
    let r = check_beam(ipe600_s460(2600.0));
    assert_eq!(r.classification, CrossSectionClass::Class4);
    let v = weerstand(&r, "6.2.6_shear_z");
    let v_pl = 8380.0 * 460.0 / 3f64.sqrt() * 1e-3;
    assert_relative_eq!(v.value, v_pl, max_relative = 1e-9);
    assert_relative_eq!(v_pl, 2225.57, max_relative = 1e-5);
    assert_relative_eq!(v.uc.as_ref().unwrap().uc, 2600.0 / v_pl, max_relative = 1e-9);
    assert_eq!(v.status, CheckStatus::NotOk);
    assert!(v.notes.iter().any(|n| n.contains("bovengrens")), "{:?}", v.notes);
    for id in ["6.2.8_combined_mv", "6.2.10_combined_mnv"] {
        assert_eq!(weerstand(&r, id).status, CheckStatus::NotApplicable, "{id}");
    }
    assert_eq!(r.status, CheckStatus::NotOk);
    assert_eq!(r.governing_check_id, "6.2.6_shear_z");
    assert_relative_eq!(r.uc_max, 1.1682, max_relative = 1e-4);
}

/// V_z,Ed = 1500 kN ≤ V_pl,z,Rd: zonder plooitoets is niet te zeggen of de
/// staaf voldoet. Status n.v.t. ("NIET VOLLEDIG GETOETST: lijfplooi …"), nooit
/// Ok — ook al blijven alle gerekende UC's onder 1.
#[test]
fn b7_lijfplooi_met_v_onder_v_pl_is_niet_volledig_getoetst() {
    let r = check_beam(ipe600_s460(1500.0));
    assert!(r.uc_max <= 1.0, "{} {}", r.uc_max, r.governing_check_id);
    let v = toets(&r, "6.2.6_shear_z");
    assert!(uc(v).is_none());
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert_eq!(
        r.governing_check_id,
        "NIET VOLLEDIG GETOETST: lijfplooi onder schuifkracht: h_w/t_w = 46.8 > 72ε/η = 42.9; \
         NEN-EN 1993-1-5 §5 (bijdrage van het lijf en de flenzen aan V_b,Rd) is niet geïmplementeerd"
    );
    // Zonder dwarskracht speelt de lijfplooi niet: dan wél "voldoet".
    let zonder_v = check_beam(ipe600_s460(0.0));
    assert_eq!(zonder_v.status, CheckStatus::Ok, "{}", zonder_v.governing_check_id);
}

// ── B7 ──────────────────────────────────────────────────────────────────────

/// IPE 300 S355, L = 3 m, N_Ed = −500 kN. Met de hand (controle): lijf c/t =
/// 35,01 > 42ε = 34,17 → klasse 4; ρ = 0,937, A_eff = 5269 mm²; N_c,Rd =
/// 1870,5 kN (UC 0,267); knik om z, kromme b: λ̄ = 1,160, χ = 0,500,
/// N_b,Rd = 936,0 kN, UC 0,534. Tot oktober 2026: alle toetsen "n.v.t.",
/// uc_max = 0.
#[test]
fn b7_klasse_4_wordt_getoetst_met_a_eff() {
    let r = check_beam(invoer(B7));
    assert_eq!(r.classification, CrossSectionClass::Class4);
    assert_eq!(r.status, CheckStatus::Ok, "{}", r.governing_check_id);
    assert!(!r.governing_check_id.starts_with("NIET TOETSBAAR"));

    let druk = weerstand(&r, "6.2.4_compression");
    assert_relative_eq!(druk.value, 1870.5, max_relative = 5e-4);
    assert_relative_eq!(druk.uc.as_ref().unwrap().uc, 0.267, max_relative = 3e-3);
    assert_eq!(druk.article, "art. 6.2.4 (6.11)");

    let knik = match &toets(&r, "6.3.1_buckling").kind {
        CheckKind::Stability(s) => s,
        CheckKind::Resistance(_) => panic!("6.3.1 is een stabiliteitstoets"),
    };
    let tussen = |s: &str| knik.intermediate_values.iter().find(|v| v.symbol == s).unwrap().value;
    assert_relative_eq!(tussen(r"\bar{\lambda}_z"), 1.160, max_relative = 2e-3);
    assert_relative_eq!(tussen(r"\chi_z"), 0.500, max_relative = 2e-3);
    assert_relative_eq!(knik.value, 936.0, max_relative = 2e-3);
    assert_relative_eq!(knik.uc.as_ref().unwrap().uc, 0.534, max_relative = 2e-3);
    assert_relative_eq!(r.uc_max, 0.534, max_relative = 2e-3);

    // Trek en dwarskracht hangen niet van de klasse af en zijn gerekend (hier
    // zonder trek: n.v.t. met reden; dwarskracht 0).
    assert_eq!(weerstand(&r, "6.2.6_shear_z").status, CheckStatus::Ok);
}

// ── B15 en K5: de grens ─────────────────────────────────────────────────────

fn ligger(l_m: f64, klasse: DeflectionClass, w: f64, w_perm: f64) -> (ResistanceCalc, ResistanceCalc) {
    deflection::check_deflection_pair(w, 0.0, w_perm, l_m, klasse, 333, 0.0, false)
}

/// B15: IPE 300 S235, L = 6 m, vloer. Hand: w_G = 5·10·6000⁴/(384·EI) =
/// 9,617 mm, w_Q = 20 000·6000³/(48·EI) = 5,129 mm; w_fin = 14,746 mm tegen
/// 0,004·6000 = 24,0 mm → UC 0,614 (tot oktober 2026: L/333, UC 0,818);
/// w_add = 5,129 mm tegen 0,003·6000 = 18,0 mm → UC 0,285.
#[test]
fn b15_vloer_w_fin_tegen_l_250() {
    let (fin, add) = ligger(6.0, DeflectionClass::Floor, -14.746, -9.617);
    assert_relative_eq!(fin.uc.as_ref().unwrap().rd, 24.0, max_relative = 1e-12);
    assert_relative_eq!(fin.uc.as_ref().unwrap().uc, 0.614, max_relative = 2e-3);
    assert_relative_eq!(add.uc.as_ref().unwrap().rd, 18.0, max_relative = 1e-12);
    assert_relative_eq!(add.uc.as_ref().unwrap().uc, 0.285, max_relative = 2e-3);
}

/// K5: uitkraging HEA 200, L = 3 m, klasse uitkraging. Hand: zakking van het
/// vrije eind w_kar = 18,138 mm, w_G = 6,530 mm. ℓ_rep = 2·3000 = 6000 mm
/// voor beide grenzen: w_fin ≤ 0,004·6000 = 24 mm → UC 0,756; w_add = 11,608
/// mm ≤ 0,003·6000 = 18 mm → UC 0,645. (Tot oktober 2026: w_fin tegen
/// L/150 = 20 mm op de staaflengte, w_add op 2·L — twee lengtes.)
#[test]
fn k5_uitkraging_beide_grenzen_op_l_rep_2l() {
    let (fin, add) = ligger(3.0, DeflectionClass::Cantilever, -18.138, -6.530);
    let l = |c: &ResistanceCalc| c.variables.iter().find(|v| v.symbol == "L").unwrap().value;
    assert_eq!(l(&fin), 6000.0);
    assert_eq!(l(&add), 6000.0);
    assert_relative_eq!(fin.uc.as_ref().unwrap().rd, 24.0, max_relative = 1e-12);
    assert_relative_eq!(fin.uc.as_ref().unwrap().uc, 18.138 / 24.0, max_relative = 1e-12);
    assert_relative_eq!(add.uc.as_ref().unwrap().uc, 11.608 / 18.0, max_relative = 1e-12);
    // Dezelfde grens via de losse vlag, bij een andere klasse.
    let (fin_vlag, _) = deflection::check_deflection_pair(-18.138, 0.0, -6.530, 3.0, DeflectionClass::Floor, 333, 0.0, true);
    assert_relative_eq!(fin_vlag.uc.as_ref().unwrap().rd, 24.0, max_relative = 1e-12);
}
