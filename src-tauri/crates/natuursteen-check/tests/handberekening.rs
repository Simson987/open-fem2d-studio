//! Handberekeningen voor de natuursteentoets (issue #99).
//!
//! Alle materiaal-, reductie- en belastingsfactoren hieronder zijn
//! TESTWAARDEN (bron "testwaarde"), geen waarden uit een richtlijn.

use approx::assert_relative_eq;
use natuursteen_check::statistiek::{k_n, karakteristieke_waarde, t_kwantiel};
use natuursteen_check::*;
use nen_en_1993_1_1_section::{CheckStatus, ResistanceCalc};
use steel_check::CheckKind;

fn nw(waarde: f64) -> Normwaarde {
    Normwaarde { waarde, bron: "testwaarde".into() }
}

fn check<'a>(r: &'a NatuursteenElementResult, id: &str) -> &'a ResistanceCalc {
    let c = r.checks.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("toets {id} ontbreekt: {:?}", r.niet_getoetst));
    let CheckKind::Resistance(rc) = &c.kind else { panic!("{id} is geen weerstandstoets") };
    rc
}

fn uc(r: &NatuursteenElementResult, id: &str) -> (f64, f64, f64) {
    let u = check(r, id).uc.as_ref().unwrap();
    (u.ed, u.rd, u.uc)
}

// ── Statistiek: NEN-EN 1990 bijlage D ──────────────────────────────────────

/// Student-t-kwantielen: ν = 1 exact tan(0,45π) = 6,313752; ν = 2 exact
/// (2p−1)·√(2/(4p(1−p))) = 0,9·√(2/0,19) = 2,919986; tabelwaarden
/// t_{5;0,95} = 2,015048, t_{9;0,95} = 1,833113, t_{29;0,95} = 1,699127.
#[test]
fn student_t_kwantielen() {
    assert_relative_eq!(t_kwantiel(0.95, 1.0), (0.45 * std::f64::consts::PI).tan(), max_relative = 1e-9);
    assert_relative_eq!(t_kwantiel(0.95, 2.0), 0.9 * (2.0f64 / 0.19).sqrt(), max_relative = 1e-9);
    assert_relative_eq!(t_kwantiel(0.95, 5.0), 2.015048, max_relative = 1e-6);
    assert_relative_eq!(t_kwantiel(0.95, 9.0), 1.833113, max_relative = 1e-6);
    assert_relative_eq!(t_kwantiel(0.95, 29.0), 1.699127, max_relative = 1e-6);
}

/// k_n tegen NEN-EN 1990 tabel D.1 (5%-fractiel, V_X onbekend). De tabel is
/// afgerond: bij n = 8 staat er 2,00 waar de formule 1,8946·√(9/8) = 2,0095
/// geeft, bij n = 20 1,76 tegen 1,7291·√1,05 = 1,7718. De formule ligt daar
/// aan de veilige kant (grotere k_n); nergens meer dan 0,012 ernaast.
#[test]
fn k_n_tegen_tabel_d1() {
    for (n, tabel) in [(3, 3.37), (4, 2.63), (5, 2.33), (6, 2.18), (8, 2.00), (10, 1.92), (30, 1.73)] {
        let (_, k) = k_n(n).unwrap();
        assert!((k - tabel).abs() <= 0.01 && k >= tabel - 0.005, "n = {n}: k_n = {k:.4}, tabel {tabel}");
    }
    let (_, k20) = k_n(20).unwrap();
    assert_relative_eq!(k20, 1.729133 * 1.05f64.sqrt(), max_relative = 1e-5);
    assert!(k20 >= 1.76);
    assert!(k_n(2).is_err(), "tabel D.1 kent geen V_X-onbekend-waarde voor n < 3");
}

/// Zes buigproeven (EN 12372): 14,2; 15,8; 13,5; 16,1; 14,9; 15,3 N/mm².
/// k_6 = 2,015048·√(7/6) = 2,176501.
/// Normaal: m = 14,96667, s = 0,983192 ⇒ f_k = 14,96667 − 2,176501·0,983192 = 12,82675.
/// Lognormaal: m_Y = 2,703996, s_Y = 0,066560 ⇒ f_k = exp(2,703996 − 2,176501·0,066560) = 12,92454.
#[test]
fn karakteristieke_buigsterkte_uit_zes_proeven() {
    let x = [14.2, 15.8, 13.5, 16.1, 14.9, 15.3];
    let n = karakteristieke_waarde(&x, Verdeling::Normaal).unwrap();
    assert_relative_eq!(n.k_n, 2.176501, max_relative = 1e-6);
    assert_relative_eq!(n.gemiddelde, 14.966667, max_relative = 1e-6);
    assert_relative_eq!(n.standaardafwijking, 0.983192, max_relative = 1e-6);
    assert_relative_eq!(n.karakteristiek, 12.826748, max_relative = 1e-6);
    let l = karakteristieke_waarde(&x, Verdeling::Lognormaal).unwrap();
    assert_relative_eq!(l.gemiddelde_ln.unwrap(), 2.7039958, max_relative = 1e-7);
    assert_relative_eq!(l.standaardafwijking_ln.unwrap(), 0.0665599, max_relative = 1e-5);
    assert_relative_eq!(l.karakteristiek, 12.924543, max_relative = 1e-6);
    // Te weinig proeven, of een onzinnige waarde: geweigerd.
    assert!(karakteristieke_waarde(&[14.0, 15.0], Verdeling::Normaal).is_err());
    assert!(karakteristieke_waarde(&[14.0, -1.0, 15.0], Verdeling::Normaal).is_err());
}

// ── Latei ──────────────────────────────────────────────────────────────────

/// Latei 100 × 200 mm, vrij opgelegd over 1,50 m, ingemetseld.
/// Buigsterkte: de zes proeven hierboven, lognormaal ⇒ f_f,k = 12,92454.
/// Reductiefactoren vocht 0,9 en duur 0,8 ⇒ k = 0,72; γ_M = 2,0:
///   f_f,d = 0,72·12,92454/2,0 = 4,652836 N/mm².
/// q_Ed = 6,0 + γ_G·ρ·b·h = 6,0 + 1,2·27·0,1·0,2 = 6,648 kN/m;
///   M_Ed = 6,648·1,5²/8 = 1,869750 kNm; V_Ed = 6,648·1,5/2 = 4,986 kN.
/// W = 100·200²/6 = 666 667 mm³; σ_t = 1,86975e6/666 667 = 2,804625 N/mm²;
///   UC = 2,804625/4,652836 = 0,602778.
/// Druk: f_c,k = 80 (opgegeven) ⇒ f_c,d = 0,72·80/2 = 28,8; σ_c = 2,804625.
/// Afschuiving: f_vk = 1,5 ⇒ f_v,d = 0,54; τ = 1,5·4986/20 000 = 0,37395.
///   UC = 0,37395/0,54 = 0,692500 — maatgevend (groter dan buiging 0,6028).
/// Oplegdruk: F = 5,0 kN op a = 100 mm ⇒ σ = 5000/(100·100) = 0,5 N/mm².
/// Doorbuiging: q = 4,5 + 0,54 = 5,04 N/mm, E = 50 000, I = 100·200³/12:
///   w = 5·5,04·1500⁴/(384·50 000·66 666 667) = 0,099668 mm ≤ 1500/500 = 3,0.
fn latei() -> NatuursteenElementInput {
    NatuursteenElementInput {
        element_id: 1,
        naam: "latei L1".into(),
        soort: ElementSoort::Latei,
        materiaal: NatuursteenMateriaal {
            steensoort: "testkalksteen".into(),
            buigproef: Buigproef::En12372,
            buigsterkte: SterkteOpgave::Proefresultaten {
                waarden: vec![14.2, 15.8, 13.5, 16.1, 14.9, 15.3],
                verdeling: Verdeling::Lognormaal,
                bron: "testrapport".into(),
            },
            druksterkte: Some(SterkteOpgave::Karakteristiek { waarde: 80.0, bron: "testwaarde".into() }),
            schuifsterkte: Some(nw(1.5)),
            gamma_m: nw(2.0),
            reductiefactoren: vec![
                Reductiefactor { naam: "vochttoestand".into(), waarde: 0.9, bron: "testwaarde".into() },
                Reductiefactor { naam: "belastingsduur".into(), waarde: 0.8, bron: "testwaarde".into() },
            ],
            e_modulus: Some(nw(50_000.0)),
            volumiek_gewicht: Some(nw(27.0)),
        },
        doorsnede: Doorsnede { b_mm: 100.0, h_mm: 200.0 },
        zijdelings_gesteund: true,
        belasting: Belasting::Ligger {
            schema: Liggerschema::VrijOpgelegd,
            l_m: 1.5,
            q_ed_kn_m: 6.0,
            f_ed_kn: 0.0,
            gamma_g: Some(nw(1.2)),
        },
        oplegging: Some(Oplegging { f_ed_kn: 5.0, a_mm: 100.0 }),
        doorbuiging: Some(Doorbuiging { q_ser_kn_m: 4.5, f_ser_kn: 0.0, grens: nw(500.0) }),
        verankering: None,
    }
}

#[test]
fn latei_handberekening() {
    let r = check_natuursteen_element(&latei());
    let s = r.sterkte.as_ref().unwrap();
    assert_relative_eq!(s.k_totaal, 0.72, max_relative = 1e-12);
    assert_relative_eq!(s.buig.karakteristiek, 12.924543, max_relative = 1e-6);
    assert_relative_eq!(s.f_fd_mpa, 4.652836, max_relative = 1e-6);
    assert_relative_eq!(s.f_cd_mpa.unwrap(), 28.8, max_relative = 1e-12);
    assert_relative_eq!(s.f_vd_mpa.unwrap(), 0.54, max_relative = 1e-12);
    let k = r.krachten.as_ref().unwrap();
    assert_relative_eq!(k.q_totaal_kn_m.unwrap(), 6.648, max_relative = 1e-12);
    assert_relative_eq!(k.m_ed_knm, 1.86975, max_relative = 1e-12);
    assert_relative_eq!(k.v_ed_kn, 4.986, max_relative = 1e-12);

    let (ed, rd, u) = uc(&r, "buiging");
    assert_relative_eq!(ed, 2.804625, max_relative = 1e-9);
    assert_relative_eq!(rd, 4.652836, max_relative = 1e-6);
    assert_relative_eq!(u, 0.602778, max_relative = 1e-5);
    let (ed, rd, _) = uc(&r, "druk");
    assert_relative_eq!((ed, rd).0, 2.804625, max_relative = 1e-9);
    assert_relative_eq!(rd, 28.8, max_relative = 1e-12);
    let (ed, rd, _) = uc(&r, "afschuiving");
    assert_relative_eq!(ed, 0.37395, max_relative = 1e-9);
    assert_relative_eq!(rd, 0.54, max_relative = 1e-12);
    let (ed, _, _) = uc(&r, "oplegdruk");
    assert_relative_eq!(ed, 0.5, max_relative = 1e-12);
    let (ed, rd, _) = uc(&r, "doorbuiging");
    assert_relative_eq!(ed, 0.09966797, max_relative = 1e-6);
    assert_relative_eq!(rd, 3.0, max_relative = 1e-12);

    assert_relative_eq!(uc(&r, "afschuiving").2, 0.6925, max_relative = 1e-9);
    assert_eq!(r.governing_check_id, "afschuiving");
    assert_relative_eq!(r.uc_max, 0.6925, max_relative = 1e-9);
    assert_eq!(r.status, CheckStatus::Ok, "{:?}", r.niet_getoetst);
    assert!(r.notes.iter().any(|n| n.contains("γ_M = 2 (bron: testwaarde)")), "{:?}", r.notes);
    assert!(r.notes.iter().any(|n| n.contains("reductiefactor vochttoestand = 0.9")));
}

/// Kip: een latei met h > b die niet als zijdelings gesteund is opgegeven,
/// wordt nooit "voldoet".
#[test]
fn latei_zonder_zijdelingse_steun_is_niet_volledig_getoetst() {
    let mut e = latei();
    e.zijdelings_gesteund = false;
    let r = check_natuursteen_element(&e);
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(r.niet_getoetst.iter().any(|n| n.starts_with("kip")), "{:?}", r.niet_getoetst);
}

/// Een te zware last: q = 20 kN/m ⇒ q_Ed = 20,648, M = 5,80725 kNm,
/// σ_t = 8,710875 > 4,652836 ⇒ UC = 1,872168, NotOk.
#[test]
fn latei_te_zwaar_belast_voldoet_niet() {
    let mut e = latei();
    e.belasting = Belasting::Ligger {
        schema: Liggerschema::VrijOpgelegd, l_m: 1.5, q_ed_kn_m: 20.0, f_ed_kn: 0.0, gamma_g: Some(nw(1.2)),
    };
    let r = check_natuursteen_element(&e);
    let (ed, _, u) = uc(&r, "buiging");
    assert_relative_eq!(ed, 8.710875, max_relative = 1e-9);
    assert_relative_eq!(u, 8.710875 / 4.652836, max_relative = 1e-6);
    assert_eq!(r.status, CheckStatus::NotOk);
}

// ── Consoleplaat ───────────────────────────────────────────────────────────

/// Consoleplaat, strook b = 1000 mm, h = 30 mm, uitkraging 0,30 m, puntlast
/// F = 1,5 kN aan het eind, q_Ed = 0 (geen γ_G: eigen gewicht in q).
/// f_f,k = 10 (opgegeven), γ_M = 2,0, geen reductiefactoren ⇒ f_f,d = 5,0.
/// M = 1,5·0,3 = 0,45 kNm; W = 1000·30²/6 = 150 000 ⇒ σ_t = 3,0; UC = 0,6.
/// h ≤ b ⇒ geen kip. V = 1,5 kN maar geen f_vk ⇒ afschuiving niet getoetst.
fn consoleplaat() -> NatuursteenElementInput {
    let mut e = latei();
    e.naam = "console".into();
    e.soort = ElementSoort::Consoleplaat;
    e.materiaal.buigsterkte = SterkteOpgave::Karakteristiek { waarde: 10.0, bron: "testwaarde".into() };
    e.materiaal.reductiefactoren = vec![];
    e.materiaal.schuifsterkte = None;
    e.materiaal.druksterkte = None;
    e.doorsnede = Doorsnede { b_mm: 1000.0, h_mm: 30.0 };
    e.zijdelings_gesteund = false;
    e.belasting = Belasting::Ligger { schema: Liggerschema::Uitkragend, l_m: 0.3, q_ed_kn_m: 0.0, f_ed_kn: 1.5, gamma_g: None };
    e.oplegging = None;
    e.doorbuiging = None;
    e
}

#[test]
fn consoleplaat_zonder_schuifsterkte_is_nooit_ok() {
    let r = check_natuursteen_element(&consoleplaat());
    let (ed, rd, u) = uc(&r, "buiging");
    assert_relative_eq!(ed, 3.0, max_relative = 1e-12);
    assert_relative_eq!(rd, 5.0, max_relative = 1e-12);
    assert_relative_eq!(u, 0.6, max_relative = 1e-12);
    assert!(r.notes.iter().any(|n| n.contains("h ≤ b")));
    assert!(r.notes.iter().any(|n| n.contains("Geen reductiefactoren")));
    assert!(r.niet_getoetst.iter().any(|n| n.starts_with("afschuiving")), "{:?}", r.niet_getoetst);
    assert_eq!(r.status, CheckStatus::NotApplicable);
    // Met f_vk = 1,0: f_v,d = 0,5; τ = 1,5·1500/30 000 = 0,075 ⇒ volledig getoetst.
    let mut e = consoleplaat();
    e.materiaal.schuifsterkte = Some(nw(1.0));
    let r = check_natuursteen_element(&e);
    let (ed, rd, _) = uc(&r, "afschuiving");
    assert_relative_eq!(ed, 0.075, max_relative = 1e-12);
    assert_relative_eq!(rd, 0.5, max_relative = 1e-12);
    assert_eq!(r.status, CheckStatus::Ok, "{:?}", r.niet_getoetst);
}

// ── Gevelplaat: verankering (EN 13364) ─────────────────────────────────────

/// Vijf breukproeven bij het ankergat: 2,1; 2,4; 2,2; 1,9; 2,3 kN, normaal.
/// k_5 = 2,131847·√1,2 = 2,335321; m = 2,18, s = 0,192354
///   ⇒ F_k = 2,18 − 2,335321·0,192354 = 1,730792 kN.
/// γ = 2,5 ⇒ F_Rd = 0,692317 kN; F_Ed = 0,6 ⇒ UC = 0,866655.
#[test]
fn gevelplaat_verankering() {
    let mut e = consoleplaat();
    e.soort = ElementSoort::Gevelplaat;
    e.materiaal.schuifsterkte = Some(nw(1.0));
    e.belasting = Belasting::Krachten { m_ed_knm: 0.0, v_ed_kn: 0.0, n_ed_kn: 0.0 };
    e.verankering = Some(Verankering {
        breuklast: SterkteOpgave::Proefresultaten {
            waarden: vec![2.1, 2.4, 2.2, 1.9, 2.3],
            verdeling: Verdeling::Normaal,
            bron: "testrapport".into(),
        },
        gamma: nw(2.5),
        f_ed_kn: 0.6,
    });
    let r = check_natuursteen_element(&e);
    let (ed, rd, u) = uc(&r, "verankering");
    assert_eq!(ed, 0.6);
    assert_relative_eq!(rd, 1.730792 / 2.5, max_relative = 1e-6);
    assert_relative_eq!(u, 0.866655, max_relative = 1e-5);
    assert_eq!(r.status, CheckStatus::Ok, "{:?}", r.niet_getoetst);
}

// ── Niet getoetst en weigeringen ───────────────────────────────────────────

/// Druk zonder druksterkte: druk en knik niet getoetst. Trekrand bij
/// N = 10 kN druk: de gunstige druk telt niet mee (σ_t = M/W).
#[test]
fn drukkracht_zonder_druksterkte() {
    let mut e = consoleplaat();
    e.materiaal.schuifsterkte = Some(nw(1.0));
    e.belasting = Belasting::Krachten { m_ed_knm: 0.45, v_ed_kn: 0.0, n_ed_kn: 10.0 };
    let r = check_natuursteen_element(&e);
    assert_relative_eq!(uc(&r, "buiging").0, 3.0, max_relative = 1e-12);
    assert!(r.niet_getoetst.iter().any(|n| n.starts_with("druk:")));
    assert!(r.niet_getoetst.iter().any(|n| n.starts_with("knik")));
    assert_eq!(r.status, CheckStatus::NotApplicable);
    // Trek N = −30 kN telt wel mee: σ_t = 3,0 + 30 000/30 000 = 4,0.
    e.belasting = Belasting::Krachten { m_ed_knm: 0.45, v_ed_kn: 0.0, n_ed_kn: -30.0 };
    assert_relative_eq!(uc(&check_natuursteen_element(&e), "buiging").0, 4.0, max_relative = 1e-12);
}

#[test]
fn opgave_zonder_bron_weigert_het_element() {
    let mut e = latei();
    e.materiaal.gamma_m.bron = " ".into();
    let r = check_natuursteen_element(&e);
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(r.niet_getoetst[0].contains("bron"));
    let mut e = latei();
    e.materiaal.reductiefactoren[0].waarde = 1.2;
    assert!(check_natuursteen_element(&e).niet_getoetst[0].contains("(0; 1]"));
    let mut e = latei();
    e.materiaal.volumiek_gewicht = None;
    assert!(check_natuursteen_element(&e).niet_getoetst[0].contains("volumiek gewicht"));
}

#[test]
fn doorbuiging_bij_krachten_is_niet_getoetst() {
    let mut e = latei();
    e.belasting = Belasting::Krachten { m_ed_knm: 1.0, v_ed_kn: 1.0, n_ed_kn: 0.0 };
    let r = check_natuursteen_element(&e);
    assert!(r.niet_getoetst.iter().any(|n| n.starts_with("doorbuiging")), "{:?}", r.niet_getoetst);
    assert_eq!(r.status, CheckStatus::NotApplicable);
}

#[test]
fn invoer_is_strikt() {
    let mut v = serde_json::to_value(latei()).unwrap();
    v["doorsnede"]["h_mn"] = serde_json::json!(1.0);
    assert!(serde_json::from_value::<NatuursteenElementInput>(v).is_err());
    let mut v = serde_json::to_value(latei()).unwrap();
    v["belasting"]["q_ed"] = serde_json::json!(1.0);
    assert!(serde_json::from_value::<NatuursteenElementInput>(v).is_err());
    let mut v = serde_json::to_value(latei()).unwrap();
    v["materiaal"]["buigsterkte"]["n"] = serde_json::json!(6);
    assert!(serde_json::from_value::<NatuursteenElementInput>(v).is_err());
    // Rondgang zonder verlies.
    let v = serde_json::to_value(latei()).unwrap();
    assert!(serde_json::from_value::<NatuursteenElementInput>(v).is_ok());
}
