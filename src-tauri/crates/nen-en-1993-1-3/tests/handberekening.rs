//! Handberekening van een C 200×70×20×2 (r = 1,5 mm) in S350GD tegen de crate.
//!
//! De verwachte getallen zijn met de hand (in losse stappen, met gesloten
//! formules waar die bestaan) uitgerekend en hier met hun stap vastgelegd; zie
//! de opmerkingen. Hartlijnmaten (§5.1(3), figuur 5.1):
//! `h_p = 198`, `b_p = 68`, `c_p = 19` mm; `ε = √(235/350) = 0,81941`.

use approx::assert_relative_eq;
use nen_en_1993_1_3::effectief::{chi_d, effectieve_doorsnede, k_sigma_lip, Belastinggeval};
use nen_en_1993_1_3::materiaal::{f_ya, zoek_staalsoort};
use nen_en_1993_1_3::weerstand::{chi, f_bv, lambda_w, n_cr_tf, ALPHA_C};
use nen_en_1993_1_3::KvDoorsnede;

fn c200() -> KvDoorsnede {
    KvDoorsnede::CProfiel { h_mm: 200.0, b_mm: 70.0, c_mm: 20.0, t_mm: 2.0, r_mm: 1.5 }
}

#[test]
fn tabel_3_1a_s350gd_en_deklaag() {
    let s = zoek_staalsoort("S350GD+Z").unwrap();
    assert_eq!((s.f_yb, s.f_u), (350.0, 420.0));
    assert!(zoek_staalsoort("S550GD").is_err(), "S550GD is bewust niet opgenomen");
}

#[test]
fn bruto_grootheden_en_hoeken() {
    let d = c200();
    // r = 1,5 ≤ 5t = 10 en ≤ 0,10·c_p = 1,9 → hoeken verwaarloosbaar (§5.1(3)).
    assert!(d.hoeken_verwaarloosbaar());
    assert_eq!(d.delta(), 0.0);
    let g = d.hartlijn_bruto().grootheden();
    // A = t(h_p + 2b_p + 2c_p) = 2·(198 + 136 + 38) = 744 mm²
    assert_relative_eq!(g.a, 744.0, max_relative = 1e-12);
    // y_c = (2·68·2·34 + 2·19·2·68)/744 = 19,3763 mm
    assert_relative_eq!(g.y_c, 19.376344086, max_relative = 1e-9);
    // I_y = t h_p³/12 + 2 b_p t (h_p/2)² + 2[t c_p³/12 + c_p t (h_p/2 − c_p/2)²] = 4 570 669 mm⁴
    assert_relative_eq!(g.i_y, 4_570_669.333, max_relative = 1e-9);
    assert_relative_eq!(g.i_z, 491_337.290, max_relative = 1e-8);
    // I_t = t³/3 · Σb = 8/3 · 372 = 992 mm⁴
    assert_relative_eq!(d.hartlijn_bruto().i_t(), 992.0, max_relative = 1e-12);
    // Gesloten formule (C met lippen, hartlijnmaten a = 198, b = 68, c = 19):
    // m = b(3a²b + c(6a² − 8c²)) / (a³ + 6a²b + c(8c² − 12ac + 6a²)) = 30,7765 mm
    // vanaf de lijfhartlijn, aan de kant zonder flenzen;
    // I_w: los nagerekend met een numerieke sectoriële integratie om dat
    // dwarskrachtcentrum (4000 deelstroken per plaatdeel, middelpuntregel):
    // 3,92731·10⁹ mm⁶. (Voor het kanaal zonder lippen toetst de unit-test
    // in `dunwandig.rs` I_w tegen de gesloten formule.)
    let (ys, zs, iw) = d.hartlijn_bruto().dwarskrachtcentrum_en_welving().unwrap();
    assert_relative_eq!(ys, -30.776528135, max_relative = 1e-8);
    assert!(zs.abs() < 1e-9);
    assert_relative_eq!(iw, 3_927_306_728.07, max_relative = 1e-7);
}

#[test]
fn gemiddelde_vloeigrens_formule_3_1() {
    // f_ya = 350 + (420 − 350)·5·4·2²/744 = 357,527 ≤ (420 + 350)/2 = 385
    assert_relative_eq!(f_ya(350.0, 420.0, 5.0, 4.0, 2.0, 744.0), 357.5268817, max_relative = 1e-9);
    // Begrenzing: k = 7, dikke plaat → (f_u + f_yb)/2.
    assert_eq!(f_ya(350.0, 420.0, 7.0, 4.0, 6.0, 744.0), 385.0);
}

#[test]
fn effectieve_doorsnede_bij_druk() {
    let e = effectieve_doorsnede(&c200(), 350.0, Belastinggeval::Druk);
    // Flens (inwendig, k_σ = 4): λ̄_p = (68/2)/(28,4·0,81941·2) = 0,73052 > 0,673
    //   ρ = (0,73052 − 0,22)/0,73052² = 0,95664; b_e1 = b_e2 = 32,526 mm.
    let flens = &e.delen[0];
    assert_relative_eq!(flens.lambda_p, 0.730517581, max_relative = 1e-8);
    assert_relative_eq!(flens.rho, 0.956641811, max_relative = 1e-8);
    // Lip: c_p/b_p = 0,279 ≤ 0,35 → k_σ = 0,5 (5.13b); λ̄_p = 0,57732 ≤ 0,748 → ρ = 1.
    assert_eq!(k_sigma_lip(19.0 / 68.0), 0.5);
    assert_relative_eq!(e.delen[1].lambda_p, 0.577324987, max_relative = 1e-8);
    assert_eq!(e.delen[1].rho, 1.0);
    // Verstijver: A_s = 2(32,526 + 19) = 103,05 mm²; b₁ = 57,734 mm; I_s = 3329,7 mm⁴;
    // druk → k_f = 1: K₁ = 210000·8/(4·0,91) / (b₁²·198 + b₁³ + 0,5 b₁²·198) = 0,39034 N/mm²
    // σ_cr,s = 2√(K E I_s)/A_s = 320,63 N/mm²; λ̄_d = √(350/320,63) = 1,04479;
    // χ_d = 1,47 − 0,723·1,04479 = 0,71462 (5.12b).
    let v = &e.verstijvers[0];
    assert_relative_eq!(v.a_s_mm2, 103.051643119, max_relative = 1e-8);
    assert_relative_eq!(v.b1_mm, 57.733991268, max_relative = 1e-8);
    assert_relative_eq!(v.i_s_mm4, 3329.732186896, max_relative = 1e-8);
    assert_relative_eq!(v.k_n_mm2, 0.390338985, max_relative = 1e-8);
    assert_relative_eq!(v.sigma_cr_s, 320.634565143, max_relative = 1e-8);
    assert_relative_eq!(v.chi_d, 0.714617098, max_relative = 1e-8);
    assert_relative_eq!(chi_d(v.lambda_d), v.chi_d, max_relative = 1e-12);
    // Lijf (ψ = 1): λ̄_p = 99/(28,4·0,81941·2) = 2,12710; ρ = (2,1271 − 0,22)/2,1271² = 0,42150;
    // b_eff = 83,457 mm.
    let lijf = e.delen.last().unwrap();
    assert_relative_eq!(lijf.rho, 0.421500892, max_relative = 1e-8);
    // A_eff = 2[32,526·2 + χ_d·2·(32,526 + 19)] + 83,457·2 = 444,30 mm²
    assert_relative_eq!(e.a_eff_mm2, 444.302571878, max_relative = 1e-9);
    // Verschuiving van het zwaartepunt naar de lippen: e_N,y = 23,901 − 19,376 = 4,5245 mm
    assert_relative_eq!(e.e_ny_mm, 4.524496934, max_relative = 1e-8);
    assert!(e.e_nz_mm.abs() < 1e-9);
    // I_z,eff = 300 268 mm⁴; W_z,eff,min = I/(b_p + t/2 − y_c,eff) = 6658,0 mm³
    assert_relative_eq!(e.i_z_eff_mm4, 300_268.391, max_relative = 1e-8);
    assert_relative_eq!(e.w_z_min_mm3, 6657.959878, max_relative = 1e-8);
}

#[test]
fn effectieve_doorsnede_bij_buiging() {
    let e = effectieve_doorsnede(&c200(), 350.0, Belastinggeval::Buiging);
    // Verstijver bovenflens met k_f = 0: K₁ = 0,54145, σ_cr,s = 377,63, λ̄_d = 0,96272,
    // χ_d = 1,47 − 0,723·0,96272 = 0,77395.
    assert_eq!(e.verstijvers.len(), 1);
    assert_relative_eq!(e.verstijvers[0].chi_d, 0.773953005, max_relative = 1e-8);
    // Lijf: zwaartepunt met effectieve drukflens + bruto lijf z = −3,9288 mm →
    // ψ = (−99 + 3,9288)/(99 + 3,9288) = −0,92366; k_σ = 7,81 − 6,29ψ + 9,78ψ² = 21,9636;
    // λ̄_p = 0,90775; ρ = (0,90775 − 0,055(3 − 0,92366))/0,90775² = 0,96304;
    // b_c = 102,93, b_eff = 99,124, b_e1 = 39,650, b_e2 = 59,475.
    let lijf = e.delen.last().unwrap();
    assert_relative_eq!(lijf.psi, -0.923660166, max_relative = 1e-8);
    assert_relative_eq!(lijf.k_sigma, 21.963610895, max_relative = 1e-8);
    assert_relative_eq!(lijf.rho, 0.963038190, max_relative = 1e-8);
    // Eind: z_c = −4,5891, I_y,eff = 4 259 675 mm⁴, W_boven = 40 727,7, W_onder = 44 645,6 mm³.
    assert_relative_eq!(e.z_c_mm, -4.589145431, max_relative = 1e-8);
    assert_relative_eq!(e.i_y_eff_mm4, 4_259_675.490, max_relative = 1e-8);
    assert_relative_eq!(e.w_y_boven_mm3, 40_727.701453, max_relative = 1e-8);
    assert_relative_eq!(e.w_y_onder_mm3, 44_645.606724, max_relative = 1e-8);
    // M_c,Rd = 40 727,7·350/1,0 = 14,2547 kNm
}

#[test]
fn afschuiving_tabel_6_1() {
    // λ̄_w = 0,346·198/2·√(350/210000) = 1,39841 → 0,83 < λ̄_w < 1,40:
    // f_bv = 0,48·350/1,39841 = 120,136 N/mm²; V_b,Rd = 198·2·120,136 = 47,574 kN
    let lw = lambda_w(198.0, 2.0, 350.0);
    assert_relative_eq!(lw, 1.398413694, max_relative = 1e-8);
    assert_relative_eq!(f_bv(lw, 350.0), 120.136123310, max_relative = 1e-8);
    // Boven 1,40 (zonder verstijving bij de oplegging): 0,67 f_yb/λ̄_w².
    assert_relative_eq!(f_bv(2.0, 350.0), 0.67 * 350.0 / 4.0, max_relative = 1e-12);
}

#[test]
fn knikkromme_c_en_buigtorsieknik() {
    // λ̄ = 1: φ = 0,5(1 + 0,49·0,8 + 1) = 1,196; χ = 1/(1,196 + √(1,196² − 1)) = 1/1,85206 = 0,53994
    let (phi, x) = chi(1.0, ALPHA_C);
    assert_relative_eq!(phi, 1.196, max_relative = 1e-12);
    assert_relative_eq!(x, 0.539939, max_relative = 1e-5);
    // (6.35) met y₀ = 0 valt terug op min(N_cr,y, N_cr,T).
    assert_relative_eq!(n_cr_tf(1000.0, 400.0, 0.0, 1.0e4), 400.0, max_relative = 1e-12);
    assert_relative_eq!(n_cr_tf(300.0, 400.0, 0.0, 1.0e4), 300.0, max_relative = 1e-12);
}

#[test]
fn z_profiel_is_puntsymmetrisch() {
    let d = KvDoorsnede::ZProfiel { h_mm: 200.0, b_mm: 70.0, c_mm: 20.0, t_mm: 2.0, r_mm: 1.5 };
    let g = d.hartlijn_bruto().grootheden();
    assert!(g.y_c.abs() < 1e-9 && g.z_c.abs() < 1e-9);
    // Zelfde I_y als de C (de flenzen liggen op dezelfde hoogte).
    assert_relative_eq!(g.i_y, 4_570_669.333, max_relative = 1e-9);
    assert!(g.i_yz.abs() > 1.0, "Z: hoofdassen gedraaid");
    let (ys, zs, _) = d.hartlijn_bruto().dwarskrachtcentrum_en_welving().unwrap();
    assert!(ys.abs() < 1e-6 && zs.abs() < 1e-6, "dwarskrachtcentrum = zwaartepunt");
    let e = effectieve_doorsnede(&d, 350.0, Belastinggeval::Druk);
    assert!(e.e_ny_mm.abs() < 1e-9 && e.e_nz_mm.abs() < 1e-9);
    // A_eff gelijk aan die van de C (zelfde plaatdelen, k_f = 1).
    assert_relative_eq!(e.a_eff_mm2, 444.302571878, max_relative = 1e-9);
}

#[test]
fn grote_straal_geeft_delta_en_lip_onder_0_2_telt_niet() {
    // r = 3 > 0,10·c_p = 1,9 → δ = 0,43·4·3/372 = 0,013871
    let d = KvDoorsnede::CProfiel { h_mm: 200.0, b_mm: 70.0, c_mm: 20.0, t_mm: 2.0, r_mm: 3.0 };
    assert_relative_eq!(d.delta(), 0.43 * 4.0 * 3.0 / 372.0, max_relative = 1e-12);
    // c/b = 12/70 < 0,2 → lip genegeerd (§5.2(3)): uitstekende flens, geen verstijver.
    let k = KvDoorsnede::CProfiel { h_mm: 200.0, b_mm: 70.0, c_mm: 12.0, t_mm: 2.0, r_mm: 1.0 };
    let e = effectieve_doorsnede(&k, 350.0, Belastinggeval::Druk);
    assert!(e.verstijvers.is_empty());
    assert!(!e.delen[0].inwendig);
    // b/t = 35, maar c/b = 0,7 > 0,6 → buiten §5.2(2).
    let lang = KvDoorsnede::CProfiel { h_mm: 200.0, b_mm: 50.0, c_mm: 35.0, t_mm: 2.0, r_mm: 1.0 };
    assert!(!lang.buiten_maatgrenzen(350.0).is_empty());
    assert!(c200().buiten_maatgrenzen(350.0).is_empty());
}
