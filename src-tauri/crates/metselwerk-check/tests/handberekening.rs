//! Handberekeningen voor de metselwerktoets (issue #98), per normartikel.
//!
//! Voorbeeldwand: kalkzandsteen groep 1 in lijmmortel, f_b = 20 N/mm²,
//! t = 120 mm, h = 2,60 m, wanddeel l = 3,60 m, verstijfd door twee dwarswanden
//! op 3,00 m, betonvloeren boven en onder.
//!
//! De NDP-waarden zijn TESTWAARDEN (bron "testwaarde"), geen NB-waarden:
//! K = 0,80, γ_M = 1,7, K_E = 1000, φ_∞ = 1,5, f_vk0 = 0,4, f_xk1 = 0,2.

use approx::assert_relative_eq;
use metselwerk_check::*;
use nen_en_1993_1_1_section::CheckStatus;
use nen_en_1996_1_1::slankheid::Steunranden;
use nen_en_1996_1_1::{Mortelsoort, Steengroep, Steensoort};
use steel_check::CheckKind;

fn nw(waarde: f64) -> Normwaarde {
    Normwaarde { waarde, bron: "testwaarde".into() }
}

fn wand() -> MetselwerkWandInput {
    MetselwerkWandInput {
        wand_id: 1,
        naam: "KZS 120".into(),
        materiaal: MetselwerkMateriaal {
            steensoort: Steensoort::Kalkzandsteen,
            steengroep: Steengroep::Groep1,
            mortel: Mortelsoort::Lijm,
            f_b_mpa: 20.0,
            f_m_mpa: None,
            k: nw(0.80),
            langsvoeg: false,
            gamma_m: nw(1.7),
            k_e: Some(nw(1000.0)),
            phi_inf: Some(nw(1.5)),
            f_vk0_mpa: Some(nw(0.4)),
            stootvoegen_gevuld: false,
            f_xk1_mpa: Some(nw(0.2)),
            f_xk2_mpa: None,
        },
        geometrie: WandGeometrie {
            t_mm: 120.0,
            h_m: 2.6,
            l_m: 3.6,
            steunranden: Steunranden::TweeVerticaleRanden { l_m: 3.0 },
            betonvloeren: true,
        },
        verticaal: Some(VerticaleBelasting {
            n_boven_kn_m: 60.0,
            m_boven_knm_m: 0.6,
            n_midden_kn_m: 65.0,
            m_midden_knm_m: 0.3,
            n_onder_kn_m: 70.0,
            m_onder_knm_m: 0.0,
        }),
        geconcentreerd: vec![],
        afschuiving: None,
        buiging: None,
    }
}

fn check<'a>(r: &'a MetselwerkWandResult, id: &str) -> &'a nen_en_1993_1_1_section::ResistanceCalc {
    let c = r.checks.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("toets {id} ontbreekt: {:?}", r.niet_getoetst));
    let CheckKind::Resistance(rc) = &c.kind else { panic!("{id} is geen weerstandstoets") };
    rc
}

fn stapwaarde(rc: &nen_en_1993_1_1_section::ResistanceCalc, id: &str) -> f64 {
    rc.deelstappen.iter().find(|s| s.id == id).and_then(|s| s.value).unwrap_or_else(|| panic!("stap {id}"))
}

/// §3.6.1.2: lijmmortel met kalkzandsteen: α = 0,85, β = 0.
/// f_k = 0,80 · 20^0,85 = 0,80 · 12,7607 = 10,2086 N/mm²; f_d = 10,2086/1,7 = 6,0050.
#[test]
fn f_k_lijmmortel_kalkzandsteen() {
    let r = check_metselwerk_wall(&wand());
    let s = r.sterkte.as_ref().unwrap();
    assert_eq!((s.alpha, s.beta), (0.85, 0.0));
    assert_relative_eq!(s.f_k_mpa, 10.208583, max_relative = 1e-6);
    assert_relative_eq!(s.f_d_mpa, 6.005049, max_relative = 1e-6);
    assert!(s.f_m_mpa.is_none());
}

/// §3.6.1.2: algemene mortel, α = 0,7, β = 0,3, met langsvoeg K × 0,8.
/// Baksteen groep 2, f_b = 30, f_m = 10, K = 0,45:
/// f_k = 0,8·0,45 · 30^0,7 · 10^0,3 = 0,36 · 10,8140 · 1,99526 = 7,7676 N/mm².
#[test]
fn f_k_algemene_mortel_met_langsvoeg() {
    let mut w = wand();
    w.materiaal.steensoort = Steensoort::Baksteen;
    w.materiaal.steengroep = Steengroep::Groep2;
    w.materiaal.mortel = Mortelsoort::Algemeen;
    w.materiaal.f_b_mpa = 30.0;
    w.materiaal.f_m_mpa = Some(10.0);
    w.materiaal.k = nw(0.45);
    w.materiaal.langsvoeg = true;
    let r = check_metselwerk_wall(&w);
    let s = r.sterkte.as_ref().unwrap();
    let verwacht = 0.36 * 30f64.powf(0.7) * 10f64.powf(0.3);
    assert_relative_eq!(verwacht, 7.7676, max_relative = 1e-4);
    assert_relative_eq!(s.f_k_mpa, verwacht, max_relative = 1e-9);
    assert_relative_eq!(s.k, 0.36, max_relative = 1e-12);
}

/// §3.6.1.2(1): f_m ≤ min(20; 2 f_b) — f_m = 25 bij f_b = 30 wordt 20.
#[test]
fn f_m_wordt_afgekapt() {
    let mut w = wand();
    w.materiaal.mortel = Mortelsoort::Algemeen;
    w.materiaal.f_b_mpa = 30.0;
    w.materiaal.f_m_mpa = Some(25.0);
    let r = check_metselwerk_wall(&w);
    assert_eq!(r.sterkte.as_ref().unwrap().f_m_mpa, Some(20.0));
    assert!(r.notes.iter().any(|n| n.contains("afgekapt")));
}

/// §5.5.1.2: ρ_2 = 0,75 (betonvloeren, e_boven = 0,6/60 = 10 mm ≤ 0,25·120 = 30);
/// h = 2600 ≤ 1,15·3000: ρ_4 = 0,75 / (1 + (0,75·2600/3000)²) = 0,75/1,4225 = 0,52724;
/// h_ef = 1370,83 mm; h_ef/t = 11,424 ≤ 27.
#[test]
fn effectieve_hoogte_rho_4() {
    let r = check_metselwerk_wall(&wand());
    let eh = r.effectieve_hoogte.as_ref().unwrap();
    assert_eq!(eh.rho_2, 0.75);
    assert_eq!(eh.geval, "rho_4");
    assert_relative_eq!(eh.rho_n, 0.527241, max_relative = 1e-5);
    assert_relative_eq!(eh.h_ef_mm, 1370.826, max_relative = 1e-6);
    assert_relative_eq!(r.slankheid.unwrap(), 11.42355, max_relative = 1e-6);
    assert_relative_eq!(check(&r, "slankheid").uc.as_ref().unwrap().uc, 11.42355 / 27.0, max_relative = 1e-6);
}

/// §5.5.1.2: e bovenin > 0,25 t ⇒ ρ_2 = 1,0 ondanks betonvloeren.
/// M = 2,4 kNm/m, N = 60 kN/m ⇒ e = 40 mm > 30 mm.
#[test]
fn rho_2_is_1_bij_grote_excentriciteit_bovenin() {
    let mut w = wand();
    w.verticaal.as_mut().unwrap().m_boven_knm_m = 2.4;
    let r = check_metselwerk_wall(&w);
    let eh = r.effectieve_hoogte.unwrap();
    assert_eq!(eh.rho_2, 1.0);
    // ρ_4 = 1 / (1 + (2600/3000)²) = 1/1,75111 = 0,57107
    assert_relative_eq!(eh.rho_n, 0.571066, max_relative = 1e-5);
}

/// §6.1.2.2 vgl. 6.4/6.5:
/// boven: e_i = 0,6/60·1000 + 1370,83/450 = 10 + 3,0463 = 13,0463 mm ≥ 6 mm;
///   Φ = 1 − 2·13,0463/120 = 0,78256; N_Rd = 0,78256·120·6,00505 = 563,92 kN/m.
/// onder: e_i = 0 + 3,0463 < 0,05·120 = 6 ⇒ 6 mm; Φ = 0,9; N_Rd = 648,55 kN/m.
#[test]
fn druk_boven_en_onder() {
    let r = check_metselwerk_wall(&wand());
    let b = check(&r, "druk_boven");
    assert_relative_eq!(stapwaarde(b, "e_i"), 13.046280, max_relative = 1e-6);
    assert_relative_eq!(stapwaarde(b, "phi_i"), 0.782562, max_relative = 1e-5);
    assert_relative_eq!(b.uc.as_ref().unwrap().rd, 563.9188, max_relative = 1e-6);
    let o = check(&r, "druk_onder");
    assert_relative_eq!(stapwaarde(o, "e_i"), 6.0, max_relative = 1e-12);
    assert_relative_eq!(o.uc.as_ref().unwrap().rd, 648.5453, max_relative = 1e-6);
}

/// Bijlage G en §6.1.2.2 vgl. 6.6–6.8, halverwege:
/// e_m = 0,3/65·1000 + 3,0463 = 4,6154 + 3,0463 = 7,6617 mm;
/// e_k = 0,002·1,5·11,4236·√(120·7,6617) = 0,034271·30,322 = 1,0391 mm;
/// e_mk = 8,7008 mm; A_1 = 1 − 2·8,7008/120 = 0,85499;
/// E = 1000·f_k; λ = 11,4236·√(1/1000) = 0,36124;
/// u = (0,36124 − 0,063)/(0,73 − 1,17·8,7008/120) = 0,29824/0,64517 = 0,46227;
/// Φ_m = 0,85499·e^(−0,46227²/2) = 0,85499·0,89865 = 0,76834;
/// N_Rd = 0,76834·120·6,00505 = 553,67 kN/m; UC = 65/553,67 = 0,1174.
#[test]
fn druk_halverwege_bijlage_g() {
    let r = check_metselwerk_wall(&wand());
    let m = check(&r, "druk_midden");
    assert_relative_eq!(stapwaarde(m, "e_m"), 7.661665, max_relative = 1e-6);
    assert_relative_eq!(stapwaarde(m, "e_k"), 1.039141, max_relative = 1e-5);
    assert_relative_eq!(stapwaarde(m, "e_mk"), 8.700806, max_relative = 1e-6);
    assert_relative_eq!(stapwaarde(m, "lambda"), 0.361244, max_relative = 1e-5);
    assert_relative_eq!(stapwaarde(m, "u"), 0.462275, max_relative = 1e-5);
    assert_relative_eq!(stapwaarde(m, "phi_m"), 0.768343, max_relative = 1e-5);
    assert_relative_eq!(m.uc.as_ref().unwrap().rd, 553.6728, max_relative = 1e-6);
    assert_relative_eq!(m.uc.as_ref().unwrap().uc, 0.117398, max_relative = 1e-5);
    // Alles getoetst, alles voldoet.
    assert_eq!(r.status, CheckStatus::Ok, "{:?}", r.niet_getoetst);
}

/// Zonder K_E of φ_∞ geen Φ_m: "niet getoetst", nooit "Ok".
#[test]
fn zonder_k_e_is_het_midden_niet_getoetst() {
    let mut w = wand();
    w.materiaal.k_e = None;
    let r = check_metselwerk_wall(&w);
    assert!(r.checks.iter().all(|c| c.id != "druk_midden"));
    assert!(r.niet_getoetst.iter().any(|n| n.contains("K_E")));
    assert_eq!(r.status, CheckStatus::NotApplicable);
}

/// Een NDP-waarde zonder bron wordt geweigerd.
#[test]
fn k_zonder_bron_weigert_de_wand() {
    let mut w = wand();
    w.materiaal.k.bron = "  ".into();
    let r = check_metselwerk_wall(&w);
    assert!(r.checks.is_empty());
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(r.niet_getoetst[0].contains("zonder bron"));
}

/// §6.1.2.1: A = t·l < 0,1 m² ⇒ f_d × (0,7 + 3A).
/// Penant 120 × 500: A = 0,06 m², factor 0,88; onder: N_Rd = 0,9·120·6,00505·0,88 = 570,72 kN/m.
#[test]
fn kleine_doorsnede_verlaagt_f_d() {
    let mut w = wand();
    w.geometrie.l_m = 0.5;
    let r = check_metselwerk_wall(&w);
    assert_relative_eq!(check(&r, "druk_onder").uc.as_ref().unwrap().rd, 0.9 * 120.0 * 6.005049 * 0.88, max_relative = 1e-6);
}

/// §5.5.1.4: h_ef/t_ef > 27 ⇒ niet voldaan. Alleen boven/onder, ρ_2 = 1,0
/// (houten vloeren), h = 3,5 m, t = 120: 3500/120 = 29,17.
#[test]
fn slankheid_boven_27_voldoet_niet() {
    let mut w = wand();
    w.geometrie.steunranden = Steunranden::BovenOnder;
    w.geometrie.betonvloeren = false;
    w.geometrie.h_m = 3.5;
    let r = check_metselwerk_wall(&w);
    assert_relative_eq!(r.slankheid.unwrap(), 3500.0 / 120.0, max_relative = 1e-12);
    assert_eq!(r.status, CheckStatus::NotOk);
}

/// §6.1.3, steengroep 1. Oplegging l_b = 150, b = 100, a_1 = 300, h_c = 2,6 m:
/// spreiding per zijde 1300/tan 60° = 750,56 mm ⇒ l_efm = 150 + 300 + 750,56 = 1200,56 mm;
/// A_b = 15000 mm², A_ef = 144067 mm², A_b/A_ef = 0,10412;
/// β = (1 + 0,3·300/2600)(1,5 − 1,1·0,10412) = 1,03462·1,38547 = 1,43343,
/// begrensd op min(1,25 + 300/5200; 1,5) = 1,30769;
/// N_Rdc = 1,30769·15000·6,00505/1000 = 117,79 kN.
#[test]
fn geconcentreerde_last_groep_1() {
    let mut w = wand();
    w.geconcentreerd.push(GeconcentreerdeLast {
        naam: "latei links".into(),
        n_edc_kn: 80.0,
        l_b_mm: 150.0,
        b_mm: 100.0,
        a1_mm: 300.0,
        h_c_m: 2.6,
        e_mm: 0.0,
    });
    let r = check_metselwerk_wall(&w);
    let c = check(&r, "geconcentreerd_1");
    assert_relative_eq!(stapwaarde(c, "l_efm"), 1200.5553, max_relative = 1e-6);
    assert_relative_eq!(stapwaarde(c, "beta"), 1.307692, max_relative = 1e-6);
    assert_relative_eq!(c.uc.as_ref().unwrap().rd, 117.79135, max_relative = 1e-6);
    // Groep 2: β = 1 ⇒ N_Rdc = 15000·6,00505/1000 = 90,08 kN.
    w.materiaal.steengroep = Steengroep::Groep2;
    let r = check_metselwerk_wall(&w);
    assert_relative_eq!(check(&r, "geconcentreerd_1").uc.as_ref().unwrap().rd, 90.07574, max_relative = 1e-6);
}

/// §6.1.3: een excentriciteit > t/4 valt buiten het artikel.
#[test]
fn geconcentreerde_last_te_excentrisch_is_niet_getoetst() {
    let mut w = wand();
    w.geconcentreerd.push(GeconcentreerdeLast {
        naam: String::new(), n_edc_kn: 10.0, l_b_mm: 100.0, b_mm: 100.0, a1_mm: 0.0, h_c_m: 2.6, e_mm: 31.0,
    });
    let r = check_metselwerk_wall(&w);
    assert!(r.niet_getoetst.iter().any(|n| n.contains("t/4")));
    assert_ne!(r.status, CheckStatus::Ok);
}

/// §6.2 en §3.6.2, ongevulde stootvoegen. V = 40 kN, N = 150 kN, M = 120 kNm, l = 3600:
/// e = 800 mm > l/6 = 600 ⇒ l_c = 3(1800 − 800) = 3000 mm;
/// σ_d = 150000/(120·3000) = 0,41667 N/mm²;
/// f_vk = 0,5·0,4 + 0,4·0,41667 = 0,36667 ≤ 0,045·20 = 0,9;
/// f_vd = 0,36667/1,7 = 0,21569; V_Rd = 0,21569·120·3000/1000 = 77,647 kN; UC = 0,5152.
#[test]
fn afschuiving_met_gedrukt_deel() {
    let mut w = wand();
    w.afschuiving = Some(Afschuiving { v_ed_kn: 40.0, n_ed_kn: 150.0, m_ed_knm: 120.0 });
    let r = check_metselwerk_wall(&w);
    let c = check(&r, "afschuiving");
    assert_relative_eq!(stapwaarde(c, "l_c"), 3000.0, max_relative = 1e-12);
    assert_relative_eq!(stapwaarde(c, "f_vk"), 0.366667, max_relative = 1e-5);
    assert_relative_eq!(c.uc.as_ref().unwrap().rd, 77.64706, max_relative = 1e-6);
    // Gevulde stootvoegen: f_vk = 0,4 + 0,16667 = 0,56667 ≤ 0,065·20 = 1,3.
    w.materiaal.stootvoegen_gevuld = true;
    let r = check_metselwerk_wall(&w);
    assert_relative_eq!(stapwaarde(check(&r, "afschuiving"), "f_vk"), 0.566667, max_relative = 1e-5);
}

/// §3.6.2: bovengrens 0,045 f_b bij ongevulde stootvoegen. f_b = 5:
/// σ_d = 1500000/(120·3600) = 3,4722; 0,2 + 1,3889 = 1,5889 > 0,225 ⇒ f_vk = 0,225.
#[test]
fn afschuiving_bovengrens() {
    let mut w = wand();
    w.materiaal.f_b_mpa = 5.0;
    w.afschuiving = Some(Afschuiving { v_ed_kn: 10.0, n_ed_kn: 1500.0, m_ed_knm: 0.0 });
    let r = check_metselwerk_wall(&w);
    assert_relative_eq!(stapwaarde(check(&r, "afschuiving"), "f_vk"), 0.225, max_relative = 1e-12);
}

/// §6.3.1 vgl. 6.15: f_xd1 = 0,2/1,7 = 0,11765; Z = 1000·120²/6 = 2,4·10⁶ mm³/m;
/// M_Rd = 0,28235 kNm/m; M_Ed = 0,5 ⇒ UC = 1,771 > 1 ⇒ NotOk.
#[test]
fn buiging_uit_het_vlak() {
    let mut w = wand();
    w.buiging = Some(BuigingUitVlak { m_ed_knm_m: 0.5, breukvlak: Breukvlak::EvenwijdigAanLintvoegen });
    let r = check_metselwerk_wall(&w);
    let c = check(&r, "buiging_uit_vlak");
    assert_relative_eq!(c.uc.as_ref().unwrap().rd, 0.282353, max_relative = 1e-5);
    assert_relative_eq!(c.uc.as_ref().unwrap().uc, 1.770833, max_relative = 1e-5);
    assert_eq!(r.status, CheckStatus::NotOk);
    assert_eq!(r.governing_check_id, "buiging_uit_vlak");
    // Breukvlak loodrecht: f_xk2 ontbreekt ⇒ niet getoetst.
    w.buiging = Some(BuigingUitVlak { m_ed_knm_m: 0.1, breukvlak: Breukvlak::LoodrechtOpLintvoegen });
    let r = check_metselwerk_wall(&w);
    assert!(r.niet_getoetst.iter().any(|n| n.contains("f_xk2")));
    assert_eq!(r.status, CheckStatus::NotApplicable);
}

/// Niet ondersteunde materiaalcombinaties en ontbrekende mortel.
#[test]
fn niet_ondersteund_materiaal() {
    let mut w = wand();
    w.materiaal.mortel = Mortelsoort::Licht;
    assert!(check_metselwerk_wall(&w).niet_getoetst[0].contains("lichte mortel"));
    let mut w = wand();
    w.materiaal.mortel = Mortelsoort::Algemeen;
    w.materiaal.f_m_mpa = None;
    assert!(check_metselwerk_wall(&w).niet_getoetst[0].contains("f_m"));
}

/// De invoer is strikt: een tikfout in een veldnaam wordt geweigerd.
#[test]
fn invoer_is_strikt() {
    let mut v = serde_json::to_value(wand()).unwrap();
    v["geometrie"]["t_mn"] = serde_json::json!(1.0);
    assert!(serde_json::from_value::<MetselwerkWandInput>(v).is_err());
}
