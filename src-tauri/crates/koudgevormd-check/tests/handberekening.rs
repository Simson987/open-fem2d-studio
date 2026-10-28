//! Handberekening van de staaftoets: C 200×70×20×2 (r = 1,5) in S350GD.
//!
//! Doorsnedewaarden uit `nen-en-1993-1-3/tests/handberekening.rs`:
//! A_g = 744 mm², A_eff = 444,303 mm², W_eff,min = 40 727,70 mm³,
//! e_N,y = 4,5245 mm, W_z,eff,min = 6657,96 mm³, f_ya = 357,527 N/mm²,
//! V_b,Rd = 47,574 kN; I_y = 4 570 669, I_z = 491 337 mm⁴, I_t = 992 mm⁴,
//! I_w = 3,92731·10⁹ mm⁶, y_0 = −50,1529 mm (dwarskrachtcentrum − zwaartepunt).

use approx::assert_relative_eq;
use koudgevormd_check::{check_koudgevormd_beam, KoudgevormdBeamCheckInput, KoudgevormdBeamCheckResult};
use mechanics::{ForcePoint, InternalForces};
use nen_en_1993_1_1_section::CheckStatus;
use nen_en_1993_1_3::KvDoorsnede;
use steel_check::CheckKind;

fn punt(n: f64, vz: f64, my: f64) -> ForcePoint {
    ForcePoint {
        combination_id: 1,
        position_mm: 0.0,
        forces: InternalForces { n_ed: n, vy_ed: 0.0, vz_ed: vz, mt_ed: 0.0, my_ed: my, mz_ed: 0.0 },
    }
}

fn invoer(doorsnede: KvDoorsnede, punten: Vec<ForcePoint>, gesteund: bool) -> KoudgevormdBeamCheckInput {
    KoudgevormdBeamCheckInput {
        beam_id: 1,
        section_name: "KV-C 200x70x20x2 r1.5".into(),
        doorsnede,
        staalsoort: "S350GD".into(),
        length_m: 3.0,
        forces_envelope: punten,
        buckling_length_y_m: 3.0,
        buckling_length_z_m: 3.0,
        buckling_length_t_m: None,
        zijdelings_gesteund: gesteund,
        deflection_mm: None,
        deflection_limit_numerator: None,
    }
}

fn c200() -> KvDoorsnede {
    KvDoorsnede::CProfiel { h_mm: 200.0, b_mm: 70.0, c_mm: 20.0, t_mm: 2.0, r_mm: 1.5 }
}

fn uc(r: &KoudgevormdBeamCheckResult, id: &str) -> f64 {
    let c = r.checks.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("geen toets {id}: {:?}", r.checks.iter().map(|c| &c.id).collect::<Vec<_>>()));
    match &c.kind {
        CheckKind::Resistance(x) => x.uc.as_ref().expect("uc").uc,
        CheckKind::Stability(x) => x.uc.as_ref().expect("uc").uc,
    }
}

#[test]
fn zijdelings_gesteunde_ligger_in_buiging_voldoet() {
    // M_c,Rd = W_eff f_yb/γ_M0 = 40 727,70·350 = 14,2547 kNm → UC = 10/14,2547 = 0,70152
    let r = check_koudgevormd_beam(&invoer(c200(), vec![punt(0.0, 0.0, 10.0)], true));
    assert_relative_eq!(uc(&r, "kv_buiging"), 0.701523227, max_relative = 1e-8);
    assert!(r.niet_getoetst.is_empty(), "{:?}", r.niet_getoetst);
    assert_eq!(r.status, CheckStatus::Ok);
}

#[test]
fn zonder_zijdelingse_steun_nooit_voldoet() {
    let r = check_koudgevormd_beam(&invoer(c200(), vec![punt(0.0, 0.0, 10.0)], false));
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(r.niet_getoetst.iter().any(|s| s.contains("kip")));
    assert!(r.checks.iter().any(|c| c.id == "kv_kip"));
}

#[test]
fn dwarskracht_en_reductie_boven_halve_v() {
    // V_b,Rd = 47,574 kN. V = 30 kN > 0,5 V_b,Rd → (2·30/47,574 − 1)² = 0,066587;
    // M = 5 kNm: 5/14,2547 = 0,350765 → som 0,417352
    let r = check_koudgevormd_beam(&invoer(c200(), vec![punt(0.0, 30.0, 5.0)], true));
    assert_relative_eq!(uc(&r, "kv_dwarskracht"), 30.0 / 47.5739048309, max_relative = 1e-8);
    let v = (2.0 * 30.0 / 47.5739048309_f64 - 1.0).powi(2);
    assert_relative_eq!(uc(&r, "kv_n_m_v"), 5.0 / 14.25469551 + v, max_relative = 1e-7);
}

#[test]
fn trek_met_f_ya() {
    // N_t,Rd = f_ya A_g = 357,527·744 = 266,0 kN
    let r = check_koudgevormd_beam(&invoer(c200(), vec![punt(100.0, 0.0, 0.0)], false));
    assert_relative_eq!(uc(&r, "kv_trek"), 100.0 / 266.0, max_relative = 1e-9);
    assert_eq!(r.status, CheckStatus::Ok, "{:?}", r.niet_getoetst);
}

#[test]
fn kolom_druk_knik_en_buigtorsieknik() {
    // N = 50 kN druk, L_y = L_z = l_T = 3 m.
    let r = check_koudgevormd_beam(&invoer(c200(), vec![punt(-50.0, 0.0, 0.0)], false));
    // Druk: N_c,Rd = 444,303·350 = 155,506 kN
    assert_relative_eq!(uc(&r, "kv_druk"), 50.0 / 155.50590016, max_relative = 1e-8);
    // e_N,y: 50/155,506 + 50·10³·4,5245/(6657,96·350) = 0,418612
    assert_relative_eq!(uc(&r, "kv_n_m_v"), 0.418611503, max_relative = 1e-7);
    // Knik z: N_cr,z = π²·210000·491 337/3000² = 113,150 kN; λ̄ = √(444,30·350/113 150) = 1,17232;
    // kromme c: χ = 0,44719 → N_b,Rd = 69,541 kN
    assert_relative_eq!(uc(&r, "kv_knik_z"), 50.0 / 69.54101207, max_relative = 1e-6);
    // Knik y: N_cr,y = 1052,58 kN, λ̄ = 0,38437, χ = 0,90556 → 140,820 kN
    assert_relative_eq!(uc(&r, "kv_knik_y"), 50.0 / 140.81952592, max_relative = 1e-6);
    // Buigtorsieknik: i_0² = (I_y + I_z)/A + y_0² = 9319,08 mm²;
    // N_cr,T = (81 000·992 + π²·210 000·3,92731·10⁹/3000²)/9319,08 = 105,673 kN;
    // (6.35): β = 1 − y_0²/i_0² = 0,73009 → N_cr,TF = 102,677 kN; λ̄ = 1,23065, χ = 0,41940
    // → N_b,Rd = 65,220 kN
    assert_relative_eq!(uc(&r, "kv_buigtorsieknik"), 50.0 / 65.21963891, max_relative = 1e-6);
    // Stabiliteit met N·e_N,y is niet geïmplementeerd → nooit "voldoet".
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(r.niet_getoetst.iter().any(|s| s.contains("e_N,y")));
}

#[test]
fn z_profiel_knik_om_hoofdassen_en_geen_excentriciteit() {
    let z = KvDoorsnede::ZProfiel { h_mm: 200.0, b_mm: 70.0, c_mm: 20.0, t_mm: 2.0, r_mm: 1.5 };
    let r = check_koudgevormd_beam(&invoer(z, vec![punt(-30.0, 0.0, 2.0)], true));
    for id in ["kv_knik_u", "kv_knik_v", "kv_torsieknik", "kv_knik_buiging", "kv_n_m_v"] {
        assert!(uc(&r, id) > 0.0, "{id}");
    }
    // Puntsymmetrisch: e_N = 0, dus N_Ed/N_c,Rd + M/M_c,Rd zonder ΔM.
    let e = r.effectief_druk.as_ref().unwrap();
    assert!(e.e_ny_mm.abs() < 1e-9);
    let w = r.effectief_buiging.as_ref().unwrap().w_y_min();
    assert_relative_eq!(uc(&r, "kv_n_m_v"), 30e3 / (e.a_eff_mm2 * 350.0) + 2e6 / (w * 350.0), max_relative = 1e-9);
    assert_eq!(r.status, if r.uc_max <= 1.0 { CheckStatus::Ok } else { CheckStatus::NotOk });
}

#[test]
fn buiten_de_maatgrenzen_nooit_voldoet() {
    // c/b = 35/50 = 0,7 > 0,6 (§5.2(2)).
    let d = KvDoorsnede::CProfiel { h_mm: 200.0, b_mm: 50.0, c_mm: 35.0, t_mm: 2.0, r_mm: 1.0 };
    let r = check_koudgevormd_beam(&invoer(d, vec![punt(0.0, 0.0, 0.1)], true));
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(r.niet_getoetst.iter().any(|s| s.contains("5.2")));
}

#[test]
fn onbekende_staalsoort_en_ongeldige_maat() {
    let mut i = invoer(c200(), vec![punt(0.0, 0.0, 1.0)], true);
    i.staalsoort = "S550GD".into();
    let r = check_koudgevormd_beam(&i);
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(r.checks.is_empty());
    let d = KvDoorsnede::CProfiel { h_mm: 200.0, b_mm: 70.0, c_mm: 0.0, t_mm: 2.0, r_mm: 1.0 };
    let r = check_koudgevormd_beam(&invoer(d, vec![punt(0.0, 0.0, 1.0)], true));
    assert_eq!(r.status, CheckStatus::NotApplicable);
}

#[test]
fn doorbuiging_met_effectieve_stijfheid() {
    // I_y/I_y,eff = 4 570 669/4 259 675 = 1,073009; w = 10 mm, L/250 = 12 mm → UC = 0,894174
    let mut i = invoer(c200(), vec![punt(0.0, 0.0, 1.0)], true);
    i.deflection_mm = Some(10.0);
    i.deflection_limit_numerator = Some(250.0);
    let r = check_koudgevormd_beam(&i);
    assert_relative_eq!(uc(&r, "kv_doorbuiging"), 10.0 * (4_570_669.333 / 4_259_675.490) / 12.0, max_relative = 1e-8);
}
