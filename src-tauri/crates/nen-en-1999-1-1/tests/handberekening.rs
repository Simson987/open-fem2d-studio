//! Handberekeningen tegen de rekenregels van NEN-EN 1999-1-1.
//!
//! Elke verwachte waarde is hier met de hand uitgeschreven (de getallen staan
//! in het commentaar), niet uit de implementatie overgenomen.

use approx::assert_relative_eq;
use nen_en_1999_1_1::klasse::{self, Deelsoort};
use nen_en_1999_1_1::materiaal::{zoek_legering, Knikklasse};
use nen_en_1999_1_1::{knik, weerstand, AluDoorsnede, Factoren};

/// I 200×100×6×10 in EN AW-6063 T6, ongelast.
/// Tabel 3.2b: f_o = 160, f_u = 195 N/mm², knikklasse A. ε = √(250/160) = 1,25.
#[test]
fn klassering_i_profiel_6063_tabel_6_2() {
    let m = zoek_legering("EN AW-6063 T6", 10.0).unwrap();
    assert_eq!((m.f_o, m.f_u, m.knikklasse), (160.0, 195.0, Knikklasse::A));
    let eps = klasse::epsilon(160.0);
    assert_relative_eq!(eps, 1.25, epsilon = 1e-12);

    // Flens, uitstekend: b = (100 − 6)/2 = 47, β = 47/10 = 4,7.
    // Grenzen 3ε / 4,5ε / 6ε = 3,75 / 5,625 / 7,5 → klasse 2.
    let g = klasse::grenzen(Knikklasse::A, false, Deelsoort::Uitstekend);
    let b = klasse::beta(Deelsoort::Uitstekend, 47.0, 10.0, 1.0);
    assert_relative_eq!(b, 4.7, epsilon = 1e-12);
    assert_eq!(klasse::klasse(b, eps, g), 2);

    // Lijf, inwendig, druk: β = 180/6 = 30 > 22ε = 27,5 → klasse 4.
    // ρ_c = 32/(30/1,25) − 220/(30/1,25)² = 32/24 − 220/576 = 0,951389 (tabel 6.3).
    let gi = klasse::grenzen(Knikklasse::A, false, Deelsoort::Inwendig);
    assert_eq!(klasse::klasse(30.0, eps, gi), 4);
    let rc = klasse::rho_c(30.0, eps, Knikklasse::A, false, Deelsoort::Inwendig);
    assert_relative_eq!(rc, 32.0 / 24.0 - 220.0 / 576.0, epsilon = 1e-12);
    assert_relative_eq!(rc, 0.951389, epsilon = 1e-6);

    // Lijf, zuivere buiging: ψ = −1 → η = 0,4, β = 0,4·30 = 12 ≤ 11ε = 13,75 → klasse 1.
    let bb = klasse::beta(Deelsoort::Inwendig, 180.0, 6.0, -1.0);
    assert_relative_eq!(bb, 12.0, epsilon = 1e-12);
    assert_eq!(klasse::klasse(bb, eps, gi), 1);
}

/// Doorsnedeweerstanden van dezelfde I-ligger (§6.2).
#[test]
fn weerstanden_i_profiel_6063() {
    let d = AluDoorsnede::IProfiel { h_mm: 200.0, b_mm: 100.0, tw_mm: 6.0, tf_mm: 10.0 };
    // A = 2·100·10 + 180·6 = 3080 mm².
    // A_eff (druk) = 2000 + 1080·0,951389 = 3027,5 mm².
    let rc = 32.0 / 24.0 - 220.0 / 576.0;
    let a_eff = d.oppervlak(1.0, rc);
    assert_relative_eq!(a_eff, 2000.0 + 1080.0 * rc, epsilon = 1e-9);
    // N_c,Rd = 3027,5·160/1,1 = 440 364 N.
    assert_relative_eq!(weerstand::n_c_rd(a_eff, 160.0), 3027.5 * 160.0 / 1.1, max_relative = 1e-6);
    assert_relative_eq!(weerstand::n_c_rd(a_eff, 160.0), 440_363.6, max_relative = 1e-6);
    // Trek: N_o,Rd = 3080·160/1,1 = 448 000 N; N_u,Rd = 0,9·3080·195/1,25 = 432 432 N.
    assert_relative_eq!(weerstand::n_o_rd(3080.0, 160.0), 448_000.0, max_relative = 1e-9);
    assert_relative_eq!(weerstand::n_u_rd(3080.0, 195.0), 432_432.0, max_relative = 1e-9);
    // Buiging klasse 2: W_pl = 100·10·190 + 6·180²/4 = 238 600 mm³,
    // M_o,Rd = 238 600·160/1,1 = 34,705 kNm.
    // W_el = I/100 = 20 982 667/100 = 209 826,7 mm³, M_u,Rd = 209 826,7·195/1,25 = 32,733 kNm.
    assert_relative_eq!(weerstand::m_o_rd(238_600.0, 160.0), 34_705_454.5, max_relative = 1e-8);
    let w_el = d.buigeigenschappen(Factoren::uniform(1.0)).w;
    assert_relative_eq!(w_el, 209_826.667, max_relative = 1e-8);
    assert_relative_eq!(weerstand::m_u_rd(w_el, 195.0), 32_732_960.0, max_relative = 1e-7);
    // Dwarskracht: h_w/t_w = 30 ≤ 39ε = 48,75; A_v = 180·6 = 1080,
    // V_Rd = 1080·160/(√3·1,1) = 90 696,5 N.
    assert_relative_eq!(weerstand::v_rd(1080.0, 160.0), 90_696.5, max_relative = 1e-6);
}

/// Knik om de sterke as, L_cr = 3 m (§6.3.1, tabel 6.6 klasse A: α = 0,20, λ̄₀ = 0,10).
#[test]
fn knik_i_profiel_6063_klasse_a() {
    let iy = 100.0 * 200f64.powi(3) / 12.0 - 94.0 * 180f64.powi(3) / 12.0; // 20 982 667 mm⁴
    let ncr = knik::n_cr(70_000.0, iy, 3000.0);
    // N_cr = π²·70 000·20 982 667 / 3000² = 1 610 705 N (π² = 9,869 604).
    assert_relative_eq!(ncr, std::f64::consts::PI.powi(2) * 70_000.0 * iy / 9.0e6, max_relative = 1e-12);
    assert_relative_eq!(ncr, 1_610_705.0, max_relative = 1e-6);
    let a_eff = 2000.0 + 1080.0 * (32.0 / 24.0 - 220.0 / 576.0);
    let lam = knik::lambda(a_eff, 160.0, ncr);
    // λ̄ = √(3027,5·160 / 1 610 705) = 0,54840.
    assert_relative_eq!(lam, 0.54840, epsilon = 2e-5);
    let (phi, chi) = knik::chi(lam, Knikklasse::A);
    // φ = 0,5[1 + 0,2(0,5484 − 0,1) + 0,5484²] = 0,69521; χ = 1/(φ + √(φ² − λ̄²)) = 0,89087.
    assert_relative_eq!(phi, 0.5 * (1.0 + 0.2 * (lam - 0.1) + lam * lam), epsilon = 1e-12);
    assert_relative_eq!(phi, 0.69521, epsilon = 2e-5);
    assert_relative_eq!(chi, 0.89087, epsilon = 2e-5);
    // Klasse B (α = 0,32, λ̄₀ = 0) geeft bij dezelfde λ̄ een kleinere χ.
    assert!(knik::chi(lam, Knikklasse::B).1 < chi);
    // Onder λ̄₀ is χ begrensd op 1.
    assert_eq!(knik::chi(0.05, Knikklasse::A).1, 1.0);
}

/// Gelaste koker 120×60×4 in EN AW-6082 T6 (t ≤ 5: f_o = 250, f_u = 290,
/// ρ_o,haz = 0,50, ρ_u,haz = 0,64). ε = 1. Tabel 6.2 gelast, inwendig: 9/13/18.
#[test]
fn gelaste_koker_6082_klasse_en_haz() {
    let m = zoek_legering("EN AW-6082 T6", 4.0).unwrap();
    assert_eq!((m.f_o, m.f_u, m.rho_o_haz, m.rho_u_haz), (250.0, 290.0, 0.50, 0.64));
    let eps = klasse::epsilon(250.0);
    let g = klasse::grenzen(Knikklasse::A, true, Deelsoort::Inwendig);
    assert_eq!(g, [9.0, 13.0, 18.0]);
    // Flens: β = 52/4 = 13 → klasse 2. Lijf druk: β = 112/4 = 28 → klasse 4,
    // ρ_c = 29/28 − 198/28² = 1,035714 − 0,252551 = 0,783163.
    assert_eq!(klasse::klasse(13.0, eps, g), 2);
    assert_eq!(klasse::klasse(28.0, eps, g), 4);
    assert_relative_eq!(
        klasse::rho_c(28.0, eps, Knikklasse::A, true, Deelsoort::Inwendig),
        0.783163,
        epsilon = 1e-6
    );
    // HAZ ρ_o,haz = 0,50 < ρ_c → A_eff = 0,5·A = 0,5·1376 = 688 mm².
    let d = AluDoorsnede::Koker { h_mm: 120.0, b_mm: 60.0, t_mm: 4.0 };
    assert_relative_eq!(d.oppervlak(0.5, 0.5), 688.0, epsilon = 1e-9);
    // W_net met ρ_u,haz·t: flenzen 60 × 2,56 op 58 mm van de hartlijn,
    // lijven 2 × 2,56 × 112:
    // I = 2(60·2,56³/12 + 153,6·58²) + 5,12·112³/12 = 1 633 024,5 mm⁴, W = I/60.
    let i = 2.0 * (60.0 * 2.56f64.powi(3) / 12.0 + 153.6 * 58.0 * 58.0) + 5.12 * 112f64.powi(3) / 12.0;
    let w_net = d.buigeigenschappen(Factoren::uniform(0.64)).w;
    assert_relative_eq!(w_net, i / 60.0, max_relative = 1e-10);
    assert_relative_eq!(i, 1_633_024.5, max_relative = 1e-7);
}

/// Klasse-4-buiging: W_eff met ρ_c·t_f in de gedrukte flens (§6.1.5, §6.2.5).
/// I 200×160×5×6, EN AW-6063 T6: flens β = 77,5/6 = 12,917 > 6ε = 7,5,
/// ρ_c = 10/(β/ε) − 24/(β/ε)² = 0,742976.
#[test]
fn klasse_4_flens_effectief_weerstandsmoment() {
    let eps = 1.25;
    let beta = 77.5 / 6.0;
    let rc = klasse::rho_c(beta, eps, Knikklasse::A, false, Deelsoort::Uitstekend);
    let x = beta / eps;
    assert_relative_eq!(rc, 10.0 / x - 24.0 / (x * x), epsilon = 1e-12);
    assert_relative_eq!(rc, 0.742976, epsilon = 1e-6);

    let d = AluDoorsnede::IProfiel { h_mm: 200.0, b_mm: 160.0, tw_mm: 5.0, tf_mm: 6.0 };
    let e = d.buigeigenschappen(Factoren { flens_druk: rc, flens_trek: 1.0, lijf_druk: 1.0, lijf_trek: 1.0 });
    // Met de hand: bovenflens 160 × 6ρ_c op z = 197, onderflens 160 × 6 op
    // z = 3, lijf 5 × 188 op z = 100 (gemeten vanaf de onderkant).
    let tf = 6.0 * rc;
    let (a1, a2, a3) = (160.0 * tf, 960.0, 940.0);
    let zc = (a1 * 197.0 + a2 * 3.0 + a3 * 100.0) / (a1 + a2 + a3);
    let i = 160.0 * tf.powi(3) / 12.0 + a1 * (197.0 - zc).powi(2)
        + 160.0 * 216.0 / 12.0 + a2 * (3.0 - zc).powi(2)
        + 5.0 * 188f64.powi(3) / 12.0 + a3 * (100.0 - zc).powi(2);
    assert_relative_eq!(e.z_c, zc, max_relative = 1e-12);
    assert_relative_eq!(e.w, i / (200.0 - zc), max_relative = 1e-12);
    // De neutrale lijn zakt naar de trekflens: z_c ≈ 90,84 mm.
    assert_relative_eq!(zc, 90.841, epsilon = 1e-3);
}

/// §6.2.8: geen reductie tot V_Ed = 0,5 V_Rd, daarna (2V/V_Rd − 1)².
#[test]
fn dwarskrachtreductie_6_2_8() {
    assert_eq!(weerstand::rho_v(50.0, 100.0), 0.0);
    assert_relative_eq!(weerstand::rho_v(75.0, 100.0), 0.25, epsilon = 1e-12);
    assert_relative_eq!(weerstand::rho_v(100.0, 100.0), 1.0, epsilon = 1e-12);
}
