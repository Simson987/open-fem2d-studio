//! **Stap 0 — de rechthoek staat vast.**
//!
//! Deze test is geschreven VÓÓRDAT de doorsnede werd veralgemeend van "alleen
//! rechthoek" naar rechthoek/T/L, en hij legt de uitkomsten van de
//! referentiedoorsnede 300 × 500 op het laatste bit vast met `assert_eq!`.
//! Niet met een tolerantie: een tolerantie laat juist het soort verschuiving
//! door dat bij een brede mechanische verbouwing ontstaat — een uitdrukking
//! die stilletjes anders is gehaakt, een strookverdeling die net iets anders
//! uitvalt, een associatie van vermenigvuldigingen die verschuift.
//!
//! Wat hier staat, is dus geen normwaarde en geen handberekening; het is de
//! toestand van de kern op het moment vlak voor de verbouwing. Blijft deze
//! test groen, dan is er voor de rechthoek werkelijk niets veranderd.
//!
//! Referentiedoorsnede: b × h = 300 × 500 mm, C30/37, B500B, dekking 30 mm,
//! beugel Ø8, onder 3Ø16, waar vermeld boven 2Ø12.
//!
//! De handberekeningen staan in `tests/handberekening.rs`; de vormen T en L
//! in `tests/vormen.rs`.
//!
//! **Bewust verschoven door issue #239 (oktober 2026).** Sinds het door de
//! wapening verdrongen beton in de vezelintegratie (`mnkappa::internal_forces`)
//! wordt afgetrokken, zijn alle M-N-κ-, interactie-, M₀- en stijfheidswaarden
//! waarbij een staaflaag in gedrukt (of bij de stijfheid: getrokken, ongescheurd)
//! beton ligt opnieuw vastgelegd. De verschuivingen zijn klein (≤ 2 %) en
//! hebben één oorzaak: ter plaatse van elke laag telt σ_c(ε)·A_s niet meer als
//! beton. De controleerbare ankers staan in `tests/handberekening.rs`:
//! N_Rd = (150 000 − 829,38)·20 + 829,38·400 = 3 315,16 kN (was 3 331,75 kN,
//! bruto) en M(κ = 0) met netto (σ_s − f_cd) per laag. Het spanningsblok is
//! ongewijzigd en blijft hier bit-identiek.

use nen_en_1992_1_1::bending::stress_block;
use nen_en_1992_1_1::stiffness::{ei_secant, kappa_from_nm, m0_knm, m_cr_knm, StiffnessOptions};
use nen_en_1992_1_1::{
    axial_compression_capacity_kn, axial_tension_capacity_kn, concrete_class_by_name,
    interaction_diagram, mn_kappa_diagram, reinforcement_grade_by_name, solve_state,
    DesignMaterial, DesignSituation, MnKappaOptions, NonlinearBasis, RebarLayer, RebarRow,
    RectConcreteSection, ReinforcementCage, SteelBranch,
};

fn doorsnede() -> RectConcreteSection {
    RectConcreteSection::new(300.0, 500.0)
}

fn korf(boven: u32) -> ReinforcementCage {
    ReinforcementCage {
        cover_mm: 30.0,
        stirrup_diameter_mm: 8.0,
        top: RebarRow {
            count: boven,
            diameter_mm: 12.0,
        },
        bottom: RebarRow {
            count: 3,
            diameter_mm: 16.0,
        },
        ..ReinforcementCage::default()
    }
}

fn toetsmateriaal() -> DesignMaterial {
    DesignMaterial::new(
        nationale_bijlage::NationaleBijlage::NL,
        concrete_class_by_name("C30/37").unwrap(),
        reinforcement_grade_by_name("B500B").unwrap(),
        DesignSituation::PersistentTransient,
        SteelBranch::Horizontal,
    )
}

fn stijfheidsmateriaal(basis: NonlinearBasis) -> DesignMaterial {
    DesignMaterial::nonlinear(
        nationale_bijlage::NationaleBijlage::NL,
        concrete_class_by_name("C30/37").unwrap(),
        reinforcement_grade_by_name("B500B").unwrap(),
        DesignSituation::PersistentTransient,
        SteelBranch::Horizontal,
        basis,
        0.0,
    )
}

/// De meetkunde zelf: oppervlak en naam.
#[test]
fn meetkunde_van_de_rechthoek() {
    let s = doorsnede();
    assert_eq!(s.area_mm2(), 150000.0);
    assert_eq!(s.name(), "300 x 500");
    assert_eq!(s.b_mm, 300.0);
    assert_eq!(s.h_mm, 500.0);
}

/// Het spanningsblok van 3.1.7(3): x, F_c, z_c en M_Rd, voor beide korven,
/// drie normaalkrachten en beide momentrichtingen.
#[test]
fn spanningsblok_is_bit_identiek() {
    let s = doorsnede();
    let m = toetsmateriaal();
    let k2 = korf(2).layers(s.h_mm);
    let k0 = korf(0).layers(s.h_mm);

    #[rustfmt::skip]
    let gevallen: &[(&[RebarLayer], f64, f64, f64, f64, f64, f64)] = &[
        (&k2,    0.0,  1.0,  50.43030073130204, 242.0654435102498,  0.2298278797074792,  113.29232963145907),
        (&k2,    0.0, -1.0,  38.26634726618205, 183.67846687767386, 0.2346934610935272,   45.959386590826256),
        (&k2, -400.0,  1.0, 117.48107958245234, 563.9091819957713,  0.20300756816701906, 188.2369635709053),
        (&k2, -400.0, -1.0,  72.0320124587995,  345.75365980223756, 0.22118719501648018, 127.86419432441916),
        (&k2,  200.0,  1.0,  29.381676538332904, 141.03204738399793, 0.23824732938466683,  70.87233019176824),
        (&k2,  200.0, -1.0,  29.240380177366816, 140.35382485136074, 0.23830384792905326,   4.336334997229951),
        (&k0,    0.0,  1.0,  54.63639398811435, 262.2546911429489,  0.22814544240475426, 113.33216951431505),
        (&k0,    0.0, -1.0,  33.35342421003892, 160.09643620818684, 0.23665863031598444,   5.228530262795423),
        (&k0, -400.0,  1.0, 137.9697273060233,  662.2546910689118,  0.1948121090775907,  182.51519009444777),
        (&k0, -400.0, -1.0,  61.3375978885546,  294.42046986506205, 0.22546496084457818,  87.91972385488195),
        (&k0,  200.0,  1.0,  12.969727314607958,  62.2546911101182, 0.24481210907415682,  68.74065921121299),
        (&k0,  200.0, -1.0,  12.969727314607958,  62.2546911101182, 0.24481210907415682, -38.259254750356604),
    ];
    for &(lagen, n, sign, x, f_c, z_c, m_rd) in gevallen {
        let r = stress_block(&s, lagen, &m, n, sign).expect("evenwicht");
        assert_eq!(r.x_mm, x, "x bij N = {n}, sign = {sign}");
        assert_eq!(r.f_c_kn, f_c, "F_c bij N = {n}, sign = {sign}");
        assert_eq!(r.z_c_m, z_c, "z_c bij N = {n}, sign = {sign}");
        assert_eq!(r.m_rd_knm, m_rd, "M_Rd bij N = {n}, sign = {sign}");
    }
}

/// Het M-κ-diagram: M_max, κ_u, M_u, x_u en de rekken bij bezwijken.
#[test]
fn mn_kappa_diagram_is_bit_identiek() {
    let s = doorsnede();
    let m = toetsmateriaal();
    let o = MnKappaOptions::default();
    let k2 = korf(2).layers(s.h_mm);
    let k0 = korf(0).layers(s.h_mm);

    #[rustfmt::skip]
    let gevallen: &[(&[RebarLayer], f64, f64, f64, f64, f64, f64, f64)] = &[
        (&k2,    0.0,  1.0, 113.12613603011955, 0.069949027700722,  50.03644961152629, 0.0035000009999224327, 0.028256857576205358),
        (&k2,    0.0, -1.0,  45.874483765557585, 0.09192107339948385, 38.07615457958591, 0.0035000009998802095, 0.038416008470284424),
        (&k2, -400.0,  1.0, 187.2362486760621,  0.02990582209602001, 117.0341008761252, 0.0035000009999690595, 0.010077242231624026),
        (&k2, -400.0, -1.0, 127.46018393068167, 0.04809453907385462,  72.77335571239588, 0.003500000999845345,  0.018431108817832362),
        (&k2,  200.0,  1.0,  70.66020590899,    0.10578288975283465,   28.600380978123315, 0.0030254309478978877, 0.045000000999889045),
        (&k2,  200.0, -1.0,   3.9780614839333293, 0.10508059645667629, 27.757274729993547, 0.0029167509846395497, 0.04500000099960484),
        (&k0,    0.0,  1.0, 113.1742295589604,  0.06429841631725415,  54.433704597253126, 0.0035000009998846122, 0.025691480008148773),
        (&k0,    0.0, -1.0,   5.177298634717863, 0.10507529621869285, 33.30945641697842, 0.003500000999897647,  0.0013334626261622268),
        (&k0, -400.0,  1.0, 181.4831400931255,  0.025656577979028233, 136.41729629160616, 0.0035000009999937923, 0.008148085402485026),
        (&k0, -400.0, -1.0,  87.65801937136705, 0.05668227195590722,   61.74771897957089, 0.003500000999856971,  0.0),
        (&k0,  200.0,  1.0,  68.64004487351322, 0.10295416111648042,   16.912265892554636, 0.0017411881475468266, 0.045000000999335286),
        (&k0,  200.0, -1.0, -38.27010457133185, 0.2308041994877184,    15.164373125032364, 0.0035000009998561663, 0.007116992176578886),
    ];
    for &(lagen, n, sign, m_max, kappa_u, x_u, eps_c, eps_s) in gevallen {
        let d = mn_kappa_diagram(&s, lagen, &m, n, sign, &o);
        assert_eq!(d.m_max_knm, m_max, "M_max bij N = {n}, sign = {sign}");
        assert_eq!(d.kappa_u_per_m, kappa_u, "κ_u bij N = {n}, sign = {sign}");
        assert_eq!(d.x_u_mm, x_u, "x_u bij N = {n}, sign = {sign}");
        assert_eq!(d.eps_c_u, eps_c, "ε_c,u bij N = {n}, sign = {sign}");
        assert_eq!(d.eps_s_u, eps_s, "ε_s,u bij N = {n}, sign = {sign}");
        assert_eq!(d.points.len(), 61);
    }
}

/// M(κ = 0) met het parabool-rechthoekdiagram — de getallen waar de
/// M₀-correctie van [`nen_en_1992_1_1::stiffness`] op rust.
#[test]
fn m0_en_normaalkrachtcapaciteiten_zijn_bit_identiek() {
    let s = doorsnede();
    let m = toetsmateriaal();
    let o = MnKappaOptions::default();
    let lagen = korf(2).layers(s.h_mm);

    for (n, verwacht) in [
        (0.0, 6.9534324955167175e-9),
        (-200.0, -0.8891005450204198),
        (-800.0, -3.764203672387587),
    ] {
        assert_eq!(
            solve_state(&s, &lagen, &m, n, 0.0, &o).unwrap().m_knm,
            verwacht,
            "M₀ bij N = {n}"
        );
    }
    assert_eq!(
        axial_compression_capacity_kn(&s, &lagen, &m, &o),
        3315.164575008128
    );
    assert_eq!(axial_tension_capacity_kn(&lagen, &m), 360.6002002381328);
}

/// Het N-M-interactiediagram (5 punten, 20 stroken).
#[test]
fn interactiediagram_is_bit_identiek() {
    let s = doorsnede();
    let m = toetsmateriaal();
    let lagen = korf(2).layers(s.h_mm);
    let punten = interaction_diagram(&s, &lagen, &m, 1.0, 5, &MnKappaOptions { n_strips: 20 });
    let verwacht = [
        (360.6002002381328, 0.0),
        (-558.3409935734323, 209.03041521721264),
        (-1477.2821873849975, 236.49693264474527),
        (-2396.2233811965625, 139.87854405726904),
        (-3315.164575008128, 0.0),
    ];
    assert_eq!(punten.len(), verwacht.len());
    for (p, (n, m_rd)) in punten.iter().zip(verwacht) {
        assert_eq!(p.n_kn, n);
        assert_eq!(p.m_rd_knm, m_rd);
    }
}

/// Het scheurmoment uit f_ctm. Bij een rechthoek is het weerstandsmoment voor
/// de onder- en de bovenvezel gelijk, dus de twee tekens zijn elkaars
/// tegengestelde. Voor een T geldt dat niet — zie `tests/vormen.rs`.
#[test]
fn scheurmoment_is_bit_identiek() {
    let s = doorsnede();
    let f_ctm = stijfheidsmateriaal(NonlinearBasis::DesignValues)
        .nonlinear
        .unwrap()
        .f_ctm;
    assert_eq!(f_ctm, 2.9);
    for (n, verwacht) in [
        (0.0, 36.25),
        (-400.0, 69.58333333333333),
        (300.0, 11.249999999999998),
    ] {
        assert_eq!(m_cr_knm(&s, f_ctm, n, 1.0), verwacht, "M_cr(+) bij N = {n}");
        assert_eq!(
            m_cr_knm(&s, f_ctm, n, -1.0),
            -verwacht,
            "M_cr(−) bij N = {n}"
        );
    }
}

/// De secante buigstijfheid met (3.14), in beide grenstoestanden: κ, EI, M₀,
/// M_cr, de ongescheurde vergelijkingswaarde en ζ.
#[test]
fn secante_stijfheid_is_bit_identiek() {
    let s = doorsnede();
    let o = MnKappaOptions::default();
    let so = StiffnessOptions::default();
    let lagen: Vec<RebarLayer> = korf(2).layers(s.h_mm);

    #[rustfmt::skip]
    let ugt: &[(f64, f64, f64, f64, f64, f64, f64)] = &[
        //  N       M      κ                       EI                  M₀                   M_cr                κ uit kappa_from_nm
        (   0.0,  30.0, 0.0016768047970009928, 17891.170190862853,    0.0,                 36.25,              0.0016768047970009928),
        (   0.0,  90.0, 0.005168881498444914, 17411.89075955349,   0.0,                 36.25,              0.005168881498444914),
        (-800.0, 100.0, 0.0016683905745385988, 61564.331415200584, -2.7133502608912146,  102.91666666666666,  0.0016683905745385988),
    ];
    let m_ugt = stijfheidsmateriaal(NonlinearBasis::DesignValues);
    assert_eq!(
        m0_knm(&s, &lagen, &m_ugt, -800.0, 1.0, &o).unwrap(),
        -2.7133502608912146
    );
    for &(n, mm, kappa, ei, m0, m_cr, kappa_los) in ugt {
        let r = ei_secant(&s, &lagen, &m_ugt, n, mm, &so).unwrap();
        assert_eq!(r.kappa_per_m, kappa, "κ UGT bij N = {n}, M = {mm}");
        assert_eq!(r.ei_knm2, ei, "EI UGT bij N = {n}, M = {mm}");
        assert_eq!(r.m0_knm, m0, "M₀ UGT bij N = {n}, M = {mm}");
        assert_eq!(r.m_cr_knm, m_cr, "M_cr UGT bij N = {n}, M = {mm}");
        assert_eq!(r.ei_uncracked_knm2, 85937.5);
        assert!(r.tension_stiffening.is_none());
        assert_eq!(
            kappa_from_nm(&s, &lagen, &m_ugt, n, mm, &o)
                .unwrap()
                .kappa_per_m,
            kappa_los
        );
    }

    #[rustfmt::skip]
    let bgt: &[(f64, f64, f64, f64, f64, f64, f64, f64)] = &[
        //  N       M      κ                        EI                   M₀                  M_cr                ζ                   κ uit kappa_from_nm
        (   0.0,  30.0, 0.0002647690291764501, 113306.30358585896,  0.0,                 36.25,              0.0,                0.0002647690291745396),
        (   0.0,  90.0, 0.004236510360657899,   21243.899421509654, 0.0,                 36.25,              0.8384427554484952, 0.004895270947165383),
        (-800.0, 100.0, 0.0009638532880355404, 105802.58710025158, -1.9781714592441397,  102.91666666666666,  0.0,                0.000963853288016258),
    ];
    // De laatste kolom (κ uit kappa_from_nm) is per platform op het laatste bit
    // verschillend: die iteratie loopt via f64::powf, en de C-wiskundebibliotheek
    // van het platform rondt daar niet overal gelijk af. Hierboven de waarden van
    // Linux; op Windows wijken ze 8, 12 en 16 ULP af. Beide staan vast, geen
    // tolerantie: alle andere kolommen zijn op beide platforms bit-gelijk.
    let kappa_los_windows = [
        0.00026476902917453964,
        0.004890027153973537,
        0.0009571983416309292,
    ];
    let m_bgt = stijfheidsmateriaal(NonlinearBasis::MeanValues);
    assert_eq!(
        m0_knm(&s, &lagen, &m_bgt, -800.0, 1.0, &o).unwrap(),
        -1.9781714592441397
    );
    for (i, &(n, mm, kappa, ei, m0, m_cr, zeta, kappa_los_linux)) in bgt.iter().enumerate() {
        let kappa_los = if cfg!(windows) {
            kappa_los_windows[i]
        } else {
            kappa_los_linux
        };
        let r = ei_secant(&s, &lagen, &m_bgt, n, mm, &so).unwrap();
        assert_eq!(r.kappa_per_m, kappa, "κ BGT bij N = {n}, M = {mm}");
        assert_eq!(r.ei_knm2, ei, "EI BGT bij N = {n}, M = {mm}");
        assert_eq!(r.m0_knm, m0, "M₀ BGT bij N = {n}, M = {mm}");
        assert_eq!(r.m_cr_knm, m_cr, "M_cr BGT bij N = {n}, M = {mm}");
        assert_eq!(r.ei_uncracked_knm2, 103125.0);
        assert_eq!(
            r.tension_stiffening.unwrap().zeta,
            zeta,
            "ζ bij N = {n}, M = {mm}"
        );
        assert_eq!(
            kappa_from_nm(&s, &lagen, &m_bgt, n, mm, &o)
                .unwrap()
                .kappa_per_m,
            kappa_los
        );
    }
}
