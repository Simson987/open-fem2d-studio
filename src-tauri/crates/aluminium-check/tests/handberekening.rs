//! Volledige staaftoetsen tegen handberekeningen (NEN-EN 1999-1-1).
//!
//! De verwachte waarden worden hier uit de normformules met de hand
//! uitgerekend (de tussengetallen staan in het commentaar), niet uit de
//! implementatie overgenomen.

use aluminium_check::{check_aluminium_beam, AluminiumBeamCheckInput, AluminiumBeamCheckResult, Lasstatus};
use approx::assert_relative_eq;
use mechanics::{ForcePoint, InternalForces};
use nen_en_1993_1_1_section::CheckStatus;
use nen_en_1999_1_1::AluDoorsnede;
use steel_check::CheckKind;

fn punt(n: f64, vz: f64, my: f64) -> ForcePoint {
    ForcePoint {
        combination_id: 1,
        position_mm: 0.0,
        forces: InternalForces { n_ed: n, vy_ed: 0.0, vz_ed: vz, mt_ed: 0.0, my_ed: my, mz_ed: 0.0 },
    }
}

fn i_200() -> AluDoorsnede {
    AluDoorsnede::IProfiel { h_mm: 200.0, b_mm: 100.0, tw_mm: 6.0, tf_mm: 10.0 }
}

fn invoer(d: AluDoorsnede, legering: &str, las: Lasstatus, punten: Vec<ForcePoint>) -> AluminiumBeamCheckInput {
    AluminiumBeamCheckInput {
        beam_id: 1,
        section_name: "test".into(),
        doorsnede: d,
        legering: legering.into(),
        lasstatus: las,
        length_m: 3.0,
        forces_envelope: punten,
        buckling_length_y_m: 3.0,
        buckling_length_z_m: 1.5,
        zijdelings_gesteund: false,
        deflection_mm: None,
        deflection_limit_numerator: None,
    }
}

fn uc(r: &AluminiumBeamCheckResult, id: &str) -> f64 {
    let c = r.checks.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("toets {id} ontbreekt: {:?}",
        r.checks.iter().map(|c| c.id.clone()).collect::<Vec<_>>()));
    match &c.kind {
        CheckKind::Resistance(x) => x.uc.as_ref().unwrap_or_else(|| panic!("{id} heeft geen UC")).uc,
        _ => panic!("{id} is geen weerstandstoets"),
    }
}

fn status(r: &AluminiumBeamCheckResult, id: &str) -> CheckStatus {
    match &r.checks.iter().find(|c| c.id == id).unwrap().kind {
        CheckKind::Resistance(x) => x.status,
        _ => unreachable!(),
    }
}

fn chi_a(lam: f64) -> f64 {
    let phi = 0.5 * (1.0 + 0.20 * (lam - 0.10) + lam * lam);
    (1.0 / (phi + (phi * phi - lam * lam).sqrt())).min(1.0)
}

/// I 200×100×6×10, EN AW-6063 T6 (f_o = 160, f_u = 195), ongelast,
/// N = −100 kN, V = 20 kN, M = 10 kNm.
#[test]
fn ongelast_i_profiel_druk_buiging_dwarskracht() {
    let r = check_aluminium_beam(&invoer(i_200(), "EN AW-6063 T6", Lasstatus::Geen, vec![punt(-100.0, 20.0, 10.0)]));
    let k = r.classificatie.as_ref().unwrap();
    // Flens β = 4,7 → klasse 2; lijf druk β = 30 > 27,5 → klasse 4; lijf buiging β = 12 → klasse 1.
    assert_eq!((k.klasse_druk, k.klasse_buiging), (4, 2));

    // A_eff = 2000 + 1080·(32/24 − 220/576) = 3027,5; N_c,Rd = 3027,5·160/1,1 = 440 364 N (6.2.4).
    let n_c = (2000.0 + 1080.0 * (32.0 / 24.0 - 220.0 / 576.0)) * 160.0 / 1.1;
    assert_relative_eq!(uc(&r, "alu_druk"), 100_000.0 / n_c, max_relative = 1e-9);
    assert_relative_eq!(uc(&r, "alu_druk"), 0.22709, epsilon = 1e-5);
    // M_Rd = min(238 600·160/1,1 ; 209 826,7·195/1,25) = 32,733 kNm (6.2.5).
    let w_el = (100.0 * 200f64.powi(3) / 12.0 - 94.0 * 180f64.powi(3) / 12.0) / 100.0;
    let m_rd = (238_600.0 * 160.0 / 1.1_f64).min(w_el * 195.0 / 1.25);
    assert_relative_eq!(m_rd, 32_732_960.0, max_relative = 1e-7);
    assert_relative_eq!(uc(&r, "alu_buiging"), 10.0e6 / m_rd, max_relative = 1e-9);
    // V_Rd = 1080·160/(√3·1,1) = 90 696 N (6.2.6).
    let v_rd = 1080.0 * 160.0 / (3f64.sqrt() * 1.1);
    assert_relative_eq!(uc(&r, "alu_dwarskracht"), 20_000.0 / v_rd, max_relative = 1e-9);
    // V/V_Rd = 0,22 ≤ 0,5 → geen reductie; lineaire interactie 0,2271 + 0,3055 = 0,5326 (6.2.9.1).
    assert_relative_eq!(uc(&r, "alu_n_m_v"), 100_000.0 / n_c + 10.0e6 / m_rd, max_relative = 1e-9);
    assert_relative_eq!(uc(&r, "alu_n_m_v"), 0.53259, epsilon = 1e-5);

    // Knik y (L = 3 m): N_cr = π²·70 000·20 982 667/3000² = 1 610 705 N, λ̄ = 0,5484, χ = 0,8909.
    let iy = w_el * 100.0;
    let pi2 = std::f64::consts::PI.powi(2);
    let a_eff = n_c * 1.1 / 160.0;
    let chi_y = chi_a((a_eff * 160.0 / (pi2 * 70_000.0 * iy / 9.0e6)).sqrt());
    assert_relative_eq!(chi_y, 0.89087, epsilon = 2e-5);
    assert_relative_eq!(uc(&r, "alu_knik_y"), 100_000.0 / (chi_y * n_c), max_relative = 1e-9);
    // Knik z (L = 1,5 m): I_z = 2·10·100³/12 + 180·6³/12 = 1 669 907 mm⁴,
    // N_cr = 512 752 N, λ̄ = 0,9720, φ = 1,0595, χ = 0,6750.
    let iz = 2.0 * 10.0 * 1.0e6 / 12.0 + 180.0 * 216.0 / 12.0;
    let chi_z = chi_a((a_eff * 160.0 / (pi2 * 70_000.0 * iz / 2.25e6)).sqrt());
    assert_relative_eq!(chi_z, 0.67505, epsilon = 2e-5);
    assert_relative_eq!(uc(&r, "alu_knik_z"), 100_000.0 / (chi_z * n_c), max_relative = 1e-9);

    // Kip en §6.3.3 zijn niet geïmplementeerd: nooit "voldoet".
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(r.niet_getoetst.iter().any(|s| s.contains("kip")));
    assert!(r.niet_getoetst.iter().any(|s| s.contains("6.3.3")));
    assert_eq!(r.governing_check_id, "alu_n_m_v");
    assert_relative_eq!(r.uc_max, 0.53259, epsilon = 1e-5);
}

/// Zelfde ligger, alleen M = 30 kNm en V = 60 kN, zijdelings gesteund:
/// V/V_Rd = 0,66155 > 0,5 → ρ_V = (2·0,66155 − 1)² = 0,10439 (6.2.8),
/// M_V,Rd = 32 732 960 − 0,10439·48 600·160/1,1 = 31 995 012 N·mm.
#[test]
fn buiging_met_grote_dwarskracht_6_2_8_en_doorbuiging() {
    let mut i = invoer(i_200(), "EN AW-6063 T6", Lasstatus::Geen, vec![punt(0.0, 60.0, 30.0)]);
    i.zijdelings_gesteund = true;
    i.deflection_mm = Some(8.0);
    i.deflection_limit_numerator = Some(250.0);
    let r = check_aluminium_beam(&i);
    let v_rd = 1080.0 * 160.0 / (3f64.sqrt() * 1.1);
    let rho_v = (2.0 * 60_000.0 / v_rd - 1.0).powi(2);
    assert_relative_eq!(rho_v, 0.10439, epsilon = 1e-5);
    let m_v = 32_732_960.0 - rho_v * (6.0 * 180.0 * 180.0 / 4.0) * 160.0 / 1.1;
    assert_relative_eq!(uc(&r, "alu_m_v"), 30.0e6 / m_v, max_relative = 1e-6);
    assert_relative_eq!(uc(&r, "alu_m_v"), 0.93764, epsilon = 1e-4);
    // Doorbuiging: 8 mm tegen 3000/250 = 12 mm.
    assert_relative_eq!(uc(&r, "alu_doorbuiging"), 8.0 / 12.0, max_relative = 1e-12);
    assert!(r.niet_getoetst.is_empty(), "{:?}", r.niet_getoetst);
    assert_eq!(r.status, CheckStatus::Ok);
    assert_eq!(r.governing_check_id, "alu_m_v");
}

/// Gelaste koker 120×60×4, EN AW-6082 T6 (t ≤ 5: f_o = 250, f_u = 290,
/// ρ_o,haz = 0,50, ρ_u,haz = 0,64), hele doorsnede in de HAZ.
#[test]
fn gelaste_koker_haz_trek_en_druk() {
    let koker = AluDoorsnede::Koker { h_mm: 120.0, b_mm: 60.0, t_mm: 4.0 };
    // A = 60·120 − 52·112 = 1376 mm².
    // Druk: A_eff = 0,5·1376 = 688 (ρ_o,haz < ρ_c = 0,783) → 688·250/1,1 = 156 364 N;
    // begrenzing A·ρ_u,haz·f_u/γ_M2 = 1376·0,64·290/1,25 = 204 308 N speelt niet.
    let r = check_aluminium_beam(&invoer(koker.clone(), "EN AW-6082 T6", Lasstatus::Gelast, vec![punt(-50.0, 0.0, 0.0)]));
    let n_c = 688.0 * 250.0 / 1.1;
    assert_relative_eq!(uc(&r, "alu_druk"), 50_000.0 / n_c, max_relative = 1e-9);
    // Knik van een gelaste staaf: κ (tabel 6.5) niet geïmplementeerd → niet getoetst.
    assert!(r.checks.iter().any(|c| c.id == "alu_knik"));
    assert_eq!(status(&r, "alu_knik"), CheckStatus::NotApplicable);
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(r.classificatie.as_ref().unwrap().gelast);

    // Trek: N_o,Rd = 0,5·1376·250/1,1 = 156 364 N; N_u,Rd = 0,9·0,64·1376·290/1,25 = 183 877 N.
    let r = check_aluminium_beam(&invoer(koker, "EN AW-6082 T6", Lasstatus::Gelast, vec![punt(100.0, 0.0, 0.0)]));
    let n_t = (0.5 * 1376.0 * 250.0 / 1.1_f64).min(0.9 * 0.64 * 1376.0 * 290.0 / 1.25);
    assert_relative_eq!(n_t, 156_363.64, max_relative = 1e-7);
    assert_relative_eq!(uc(&r, "alu_trek"), 100_000.0 / n_t, max_relative = 1e-9);
    // Alleen trek, alles getoetst: een gelaste staaf kan wél voldoen.
    assert_eq!(r.status, CheckStatus::Ok);
}

/// Lasstatus onbekend: dezelfde (veilige) getallen als gelast, maar nooit "voldoet".
#[test]
fn onbekende_lasstatus_geeft_nooit_voldoet() {
    let koker = AluDoorsnede::Koker { h_mm: 120.0, b_mm: 60.0, t_mm: 4.0 };
    let gelast = check_aluminium_beam(&invoer(koker.clone(), "EN AW-6082 T6", Lasstatus::Gelast, vec![punt(10.0, 0.0, 0.0)]));
    let onbekend = check_aluminium_beam(&invoer(koker, "EN AW-6082 T6", Lasstatus::Onbekend, vec![punt(10.0, 0.0, 0.0)]));
    assert_eq!(uc(&gelast, "alu_trek"), uc(&onbekend, "alu_trek"));
    assert_eq!(gelast.status, CheckStatus::Ok);
    assert_eq!(onbekend.status, CheckStatus::NotApplicable);
    assert!(onbekend.niet_getoetst.iter().any(|s| s.contains("lasstatus onbekend")));
}

/// Een overschrijding blijft een overschrijding, ook als er iets niet getoetst is.
#[test]
fn overschrijding_wint_van_niet_getoetst() {
    let r = check_aluminium_beam(&invoer(i_200(), "EN AW-6063 T6", Lasstatus::Geen, vec![punt(0.0, 0.0, 40.0)]));
    assert!(uc(&r, "alu_buiging") > 1.0);
    assert_eq!(r.status, CheckStatus::NotOk);
}

/// Een slank lijf (h_w/t_w > 39ε): dwarskracht niet getoetst, met reden.
#[test]
fn slank_lijf_dwarskracht_niet_getoetst() {
    // I 400×100×4×10, 6063: h_w/t_w = 380/4 = 95 > 39·1,25 = 48,75.
    let d = AluDoorsnede::IProfiel { h_mm: 400.0, b_mm: 100.0, tw_mm: 4.0, tf_mm: 10.0 };
    let mut i = invoer(d, "EN AW-6063 T6", Lasstatus::Geen, vec![punt(0.0, 10.0, 0.0)]);
    i.zijdelings_gesteund = true;
    let r = check_aluminium_beam(&i);
    assert_eq!(status(&r, "alu_dwarskracht"), CheckStatus::NotApplicable);
    assert!(r.niet_getoetst.iter().any(|s| s.contains("slank lijf")));
    assert_eq!(r.status, CheckStatus::NotApplicable);
}

#[test]
fn onbekende_legering_en_dikte_buiten_tabel_worden_geweigerd() {
    let r = check_aluminium_beam(&invoer(i_200(), "EN AW-7020 T6", Lasstatus::Geen, vec![punt(0.0, 0.0, 1.0)]));
    assert!(r.checks.is_empty());
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(r.notes[0].contains("niet in de tabel"));
    // 6060 T6 alleen t ≤ 15 mm.
    let dik = AluDoorsnede::Rechthoek { b_mm: 20.0, h_mm: 100.0 };
    let r = check_aluminium_beam(&invoer(dik, "EN AW-6060 T6", Lasstatus::Geen, vec![punt(0.0, 0.0, 1.0)]));
    assert!(r.checks.is_empty());
    assert!(r.notes[0].contains("buiten het bereik"));
}

#[test]
fn onbekend_veld_en_ontbrekende_lasstatus_worden_geweigerd() {
    let geldig = serde_json::json!({
        "beam_id": 1, "section_name": "x",
        "doorsnede": { "vorm": "Rechthoek", "b_mm": 10.0, "h_mm": 50.0 },
        "legering": "EN AW-6063 T6", "lasstatus": "Geen", "length_m": 1.0,
        "forces_envelope": [], "buckling_length_y_m": 1.0, "buckling_length_z_m": 1.0
    });
    assert!(serde_json::from_value::<AluminiumBeamCheckInput>(geldig.clone()).is_ok());
    let mut tikfout = geldig.clone();
    tikfout["zijdelings_gestuend"] = true.into();
    assert!(serde_json::from_value::<AluminiumBeamCheckInput>(tikfout).is_err());
    let mut zonder = geldig.clone();
    zonder.as_object_mut().unwrap().remove("lasstatus");
    assert!(serde_json::from_value::<AluminiumBeamCheckInput>(zonder).is_err());
    let mut in_doorsnede = geldig;
    in_doorsnede["doorsnede"]["t_mm"] = 3.0.into();
    assert!(serde_json::from_value::<AluminiumBeamCheckInput>(in_doorsnede).is_err());
}
