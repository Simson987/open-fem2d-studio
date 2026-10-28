//! Montage van trek-alleen staven (`tensionOnlyFit`) en de kruisregel
//! (`tensionOnlyCrossRule`), elk met een gesloten oplossing.
//!
//! Eenheden: m, kN, kNm; E = 210 000 MPa = 2,1·10⁸ kN/m², ν = 0,3.
//!
//! Het geklemde portaal (6 × 4 m in het XZ-vlak) heeft ingeklemde kolomvoeten,
//! een scharnierende ligger en een kruisverband van twee trek-alleen strips.
//! De kolomkop draait vrij (ligger en strips scharnieren), dus in het vlak is
//! elke kolomkop een veer k_h = 3EI/h³ dwars en k_v = EA/h langs de kolom; de
//! ligger is een staaf k_b = EA/w, een strip k_d = EA/L met richting (c, s),
//! c = w/L, s = h/L, L = √52. Met verticale lasten P op beide koppen en een
//! horizontale last H op knoop 3 volgen de verplaatsingen uit vier
//! vergelijkingen (zie `een_diagonaal` en `geen_diagonaal`).

use open_fem_3d::{
    solve, AnalysisKind, BucklingSummary, EndReleases3D, Material3D, Member3D, NodalLoad3D, Node3D,
    Section3D, SolveRequest3D, SolveResult3D, Support3D, TensionOnlyFit3D,
};

const E: f64 = 210_000.0 * 1000.0;
const B: f64 = 6.0;
const H: f64 = 4.0;
const A_KOLOM: f64 = 0.01;
const I_KOLOM: f64 = 1e-4;
const A_STRIP: f64 = 5e-4;

fn doorsnede(id: usize, area: f64, i: f64, j: f64) -> Section3D {
    Section3D { id, name: format!("doorsnede {id}"), area_m2: area, iy_m4: i, iz_m4: i,
        torsion_j_m4: j, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }
}

fn staaf(id: usize, begin: usize, eind: usize, sectie: usize) -> Member3D {
    Member3D { id, start_node_id: begin, end_node_id: eind, material_id: 1, section_id: sectie,
        releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: vec![], tension_only: false, bedding: None, part_section_ids: None }
}

fn scharnierend(mut staaf: Member3D) -> Member3D {
    staaf.releases = EndReleases3D { my_start: true, my_end: true, mz_start: true, mz_end: true,
        torsion_start: false, torsion_end: false };
    staaf
}

fn trek_alleen(mut staaf: Member3D) -> Member3D {
    staaf.tension_only = true;
    scharnierend(staaf)
}

fn knoop(id: usize, x: f64, y: f64, z: f64) -> Node3D { Node3D { id, x, y, z } }

fn vast(node_id: usize) -> Support3D {
    Support3D { node_id, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true, ..Default::default() }
}

fn last(id: usize, node_id: usize, fx: f64, fz: f64) -> NodalLoad3D {
    NodalLoad3D { id, node_id, fx, fy: 0.0, fz, mx: 0.0, my: 0.0, mz: 0.0 }
}

fn verzoek(nodes: Vec<Node3D>, members: Vec<Member3D>, supports: Vec<Support3D>, nodal_loads: Vec<NodalLoad3D>) -> SolveRequest3D {
    SolveRequest3D {
        schema_version: 1, analysis: AnalysisKind::Linear, nodes,
        materials: vec![Material3D { id: 1, name: "S235".into(), e_mpa: 210_000.0, nu: 0.3, g_mpa: None, alpha_per_k: None }],
        sections: vec![doorsnede(1, A_KOLOM, I_KOLOM, I_KOLOM), doorsnede(2, A_STRIP, 1e-8, 1e-8)],
        members, supports, nodal_loads, member_loads: vec![], member_point_loads: vec![],
        thermal_loads: vec![], plates: vec![], shell_elements: vec![], surface_loads: vec![], diaphragms: vec![], node_links: vec![],
        tension_only_fit: None, tension_only_cross_rule: false,
        max_iterations: 50, tolerance: 1e-10, buckling_modes: 0,
    }
}

/// Geklemd portaal met P op beide koppen en H op knoop 3. Staaf 4 = 1→4,
/// staaf 5 = 2→3: H naar +X rekt staaf 4 en drukt staaf 5.
fn portaal(p: f64, h: f64) -> SolveRequest3D {
    let mut lasten = Vec::new();
    if p != 0.0 { lasten.extend([last(1, 3, 0.0, -p), last(2, 4, 0.0, -p)]); }
    if h != 0.0 { lasten.push(last(3, 3, h, 0.0)); }
    verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, B, 0.0, 0.0), knoop(3, 0.0, 0.0, H), knoop(4, B, 0.0, H)],
        vec![
            staaf(1, 1, 3, 1), staaf(2, 2, 4, 1), scharnierend(staaf(3, 3, 4, 1)),
            trek_alleen(staaf(4, 1, 4, 2)), trek_alleen(staaf(5, 2, 3, 2)),
        ],
        vec![vast(1), vast(2)],
        lasten,
    )
}

/// Montage onder de permanente last: P op beide koppen, factor 1.
fn montage_g(p: f64) -> TensionOnlyFit3D {
    TensionOnlyFit3D { nodal_loads: vec![last(1, 3, 0.0, -p), last(2, 4, 0.0, -p)], ..Default::default() }
}

struct Stijfheid { kv: f64, kh: f64, kb: f64, kd: f64, c: f64, s: f64 }

fn stijfheid() -> Stijfheid {
    let l = (B * B + H * H).sqrt();
    Stijfheid {
        kv: E * A_KOLOM / H, kh: 3.0 * E * I_KOLOM / H.powi(3), kb: E * A_KOLOM / B, kd: E * A_STRIP / l,
        c: B / l, s: H / l,
    }
}

/// Alleen staaf 4 actief (P op beide koppen, H op knoop 3). Knoop 3 hangt
/// aan kolom en ligger, knoop 4 ook aan de strip:
///   (k_h + k_b)·u3 − k_b·u4 = H,   k_v·w3 = −P
///   −k_b·u3 + (k_h + k_b + k_d c²)·u4 + k_d c s·w4 = 0
///   k_d c s·u4 + (k_v + k_d s²)·w4 = −P
/// Uitkomst (N4, u3, w3, u4, w4); N4 = k_d·(c·u4 + s·w4), trek positief.
fn een_diagonaal(p: f64, h: f64) -> (f64, f64, f64, f64, f64) {
    let k = stijfheid();
    let noemer = k.kh + k.kb + k.kd * k.c * k.c - k.kb * k.kb / (k.kh + k.kb)
        - (k.kd * k.c * k.s).powi(2) / (k.kv + k.kd * k.s * k.s);
    let rechts = k.kb * h / (k.kh + k.kb) + k.kd * k.c * k.s * p / (k.kv + k.kd * k.s * k.s);
    let u4 = rechts / noemer;
    let u3 = (h + k.kb * u4) / (k.kh + k.kb);
    let w4 = (-p - k.kd * k.c * k.s * u4) / (k.kv + k.kd * k.s * k.s);
    (k.kd * (k.c * u4 + k.s * w4), u3, -p / k.kv, u4, w4)
}

/// Beide strips inactief: twee ingeklemde kolommen gekoppeld door de ligger.
/// u3 = H·(k_h + k_b)/(k_h·(k_h + 2k_b)), u4 = H·k_b/(k_h·(k_h + 2k_b)), w = −P/k_v.
fn geen_diagonaal(p: f64, h: f64) -> (f64, f64, f64) {
    let k = stijfheid();
    let n = k.kh * (k.kh + 2.0 * k.kb);
    (h * (k.kh + k.kb) / n, h * k.kb / n, -p / k.kv)
}

fn dichtbij(werkelijk: f64, verwacht: f64, relatief: f64, absoluut: f64, wat: &str) {
    let verschil = (werkelijk - verwacht).abs();
    assert!(verschil <= absoluut.max(verwacht.abs() * relatief),
        "{wat}: berekend {werkelijk:.12e}, verwacht {verwacht:.12e}, verschil {verschil:.3e}");
}

fn verplaatsing(r: &SolveResult3D, knoop: usize) -> [f64; 6] {
    let d = r.displacements.iter().find(|d| d.node_id == knoop).unwrap();
    [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz]
}

fn normaalkracht(r: &SolveResult3D, staaf: usize) -> f64 {
    let f = r.member_forces.iter().find(|f| f.member_id == staaf).unwrap();
    assert!((f.n_start_kn - f.n_end_kn).abs() <= 1e-9 * f.n_start_kn.abs().max(1.0), "N constant langs staaf {staaf}");
    f.n_start_kn
}

fn delta_mm(r: &SolveResult3D, staaf: usize) -> f64 {
    r.tension_only_fit.iter().find(|f| f.member_id == staaf).unwrap().delta_mm
}

fn knikfactor(r: &SolveResult3D) -> f64 {
    match &r.buckling {
        BucklingSummary::Available { modes, .. } => modes[0].load_factor,
        other => panic!("knikfactor verwacht, kreeg {other:?}"),
    }
}

// ─── Montage ────────────────────────────────────────────────────────────────

/// Onder G alleen: zonder montage staan beide strips op druk (de kolommen
/// verkorten) en vallen ze weg; met montage onder G passen ze precies op de
/// koorde van het frame zonder strips en dragen ze niets. Die koorde verkort
/// met s·P/k_v: Δ0 = −s·P·h/(E·A). Eén lineaire berekening met actieve strips
/// zou de strips korter dan die koorde laten (ze dragen zelf mee) en onder G
/// een rest ρ·N₁ op druk overhouden, met ρ = k_d·[c s]·K⁻¹·[c s]ᵀ ≈ 0,022 en
/// N₁ ≈ −7,5 kN; daarom past de adapter opnieuw tot die rest weg is.
#[test]
fn montage_onder_g_laat_de_strips_spanningsloos_en_actief() {
    let p = 500.0;
    let k = stijfheid();
    let zonder = solve(portaal(p, 0.0)).unwrap();
    assert_eq!(zonder.inactive_members, vec![4, 5], "zonder montage drukt de kolomverkorting beide strips");
    assert!(zonder.tension_only_fit.is_empty());

    let mut req = portaal(p, 0.0);
    req.tension_only_fit = Some(montage_g(p));
    let met = solve(req).unwrap();
    assert!(met.inactive_members.is_empty(), "gepast op de koorde onder G doen beide strips mee");
    for strip in [4, 5] {
        dichtbij(normaalkracht(&met, strip), 0.0, 0.0, 1e-6, "N strip onder G na montage");
        dichtbij(delta_mm(&met, strip), -k.s * p / k.kv * 1000.0, 1e-6, 0.0, "Δ0 = −s·P/k_v");
    }
    assert_eq!(met.tension_only_fit.len(), 2);
    // Met en zonder montage: de kolommen verkorten P/k_v en niets beweegt opzij.
    for r in [&zonder, &met] {
        for knoop in [3, 4] {
            let u = verplaatsing(r, knoop);
            dichtbij(u[2], -p / k.kv, 1e-9, 0.0, "w kolomkop");
            dichtbij(u[0], 0.0, 0.0, 1e-12, "u kolomkop");
        }
    }
    assert!(met.diagnostics.iter().any(|d| d.starts_with("Montage trek-alleen: 2 van 2 trek-alleen staven zijn gepast")),
        "{:?}", met.diagnostics);
    assert!(!met.diagnostics.iter().any(|d| d.contains("niet kan dragen")), "geen restkracht: {:?}", met.diagnostics);
}

/// G + H met montage onder G is gelijk aan H alleen bij dezelfde actieve set:
/// strip 5 valt weg, strip 4 draagt N4(H) uit `een_diagonaal(0, H)`, en de
/// verplaatsingen zijn die van H plus de kolomverkorting P/k_v.
#[test]
fn montage_superpositie_g_plus_h_is_h_alleen() {
    let (p, h) = (500.0, 10.0);
    let k = stijfheid();
    let alleen_h = solve(portaal(0.0, h)).unwrap();
    assert_eq!(alleen_h.inactive_members, vec![5]);
    let (n4, u3, _, u4, w4) = een_diagonaal(0.0, h);
    dichtbij(normaalkracht(&alleen_h, 4), n4, 1e-9, 1e-12, "N4 onder H alleen");

    let mut req = portaal(p, h);
    req.tension_only_fit = Some(montage_g(p));
    let r = solve(req).unwrap();
    assert_eq!(r.inactive_members, vec![5], "zelfde actieve set als onder H alleen");
    dichtbij(normaalkracht(&r, 4), n4, 1e-6, 1e-9, "N4(G + H) = N4(H)");
    dichtbij(normaalkracht(&r, 4), normaalkracht(&alleen_h, 4), 1e-6, 1e-9, "superpositie");
    dichtbij(verplaatsing(&r, 3)[0], u3, 1e-6, 1e-12, "u3");
    dichtbij(verplaatsing(&r, 4)[0], u4, 1e-6, 1e-12, "u4");
    dichtbij(verplaatsing(&r, 4)[2], w4 - p / k.kv, 1e-6, 1e-12, "w4 = w4(H) − P/k_v");
    dichtbij(verplaatsing(&r, 3)[2], -p / k.kv, 1e-6, 1e-12, "w3: knoop 3 hangt alleen aan kolom en ligger");
}

/// Zonder montage blijft het oude gedrag: de kolomverkorting onder G drukt
/// strip 4 mee, dus N4 = N4 uit `een_diagonaal(P, H)` (kleiner dan onder H
/// alleen), en het resultaat kent de nieuwe velden niet.
#[test]
fn zonder_montage_rekent_het_verband_als_voorheen() {
    let (p, h) = (500.0, 10.0);
    let r = solve(portaal(p, h)).unwrap();
    assert_eq!(r.inactive_members, vec![5]);
    let (n4, u3, w3, u4, w4) = een_diagonaal(p, h);
    dichtbij(normaalkracht(&r, 4), n4, 1e-9, 1e-12, "N4 met kolomverkorting");
    assert!(n4 < een_diagonaal(0.0, h).0, "de verkorting onder G drukt de strip");
    for (wat, werkelijk, verwacht) in [("u3", verplaatsing(&r, 3)[0], u3), ("w3", verplaatsing(&r, 3)[2], w3),
        ("u4", verplaatsing(&r, 4)[0], u4), ("w4", verplaatsing(&r, 4)[2], w4)] {
        dichtbij(werkelijk, verwacht, 1e-9, 1e-15, wat);
    }
    assert!(r.tension_only_fit.is_empty() && r.cross_rule_members.is_empty());
    assert!(!r.diagnostics.iter().any(|d| d.starts_with("Montage") || d.starts_with("Kruisregel")));
    let json = serde_json::to_value(&r).unwrap();
    assert!(json.get("tensionOnlyFit").is_none() && json.get("crossRuleMembers").is_none(),
        "zonder montage en kruisregel blijft het resultaat gelijk van vorm");
    // Ook het verzoek zelf blijft bij serialiseren zonder de nieuwe velden.
    let verzoek = serde_json::to_value(portaal(p, h)).unwrap();
    assert!(verzoek.get("tensionOnlyFit").is_none() && verzoek.get("tensionOnlyCrossRule").is_none());
}

/// Δ0 klopt voor elke montagelast, ook een scheve: portaal met scharnierende
/// voeten (zonder strips een mechanisme) en P alleen op knoop 3. Kolom 1
/// verkort δ = P·h/(E·A). Zonder strips is het frame verder vrij om opzij te
/// gaan; de passing met de kleinste lengteaanpassing (de vorm die het passen
/// oplevert) verdeelt de verkorting van koorde 2→3, s·δ, gelijk over beide
/// strips: Δ0 = −s·δ/2 voor allebei, en het frame staat dan x = −s·δ/(2c) uit
/// het lood: binnen de kolomverkorting. Onder die last dragen strips en
/// ligger niets en draagt kolom 1 de hele P.
#[test]
fn montage_onder_een_scheve_last_verdeelt_de_verkorting_over_het_kruis() {
    let p = 300.0;
    let k = stijfheid();
    let voet = |node_id| Support3D { node_id, ux: true, uy: true, uz: true, rx: true, ry: false, rz: true, ..Default::default() };
    let mut req = portaal(0.0, 0.0);
    req.supports = vec![voet(1), voet(2)];
    req.nodal_loads = vec![last(1, 3, 0.0, -p)];
    req.tension_only_fit = Some(TensionOnlyFit3D { nodal_loads: vec![last(7, 3, 0.0, -p)], ..Default::default() });
    let r = solve(req).unwrap();
    assert!(r.inactive_members.is_empty());
    let delta = p / k.kv;
    for strip in [4, 5] {
        dichtbij(delta_mm(&r, strip), -k.s * delta / 2.0 * 1000.0, 1e-6, 0.0, "Δ0 = −s·δ/2");
        dichtbij(normaalkracht(&r, strip), 0.0, 0.0, 1e-6, "strip draagt niets");
    }
    dichtbij(normaalkracht(&r, 1), -p, 1e-9, 0.0, "kolom 1 draagt P");
    dichtbij(normaalkracht(&r, 2), 0.0, 0.0, 1e-6, "kolom 2");
    dichtbij(normaalkracht(&r, 3), 0.0, 0.0, 1e-6, "ligger");
    let x = -k.s * delta / (2.0 * k.c);
    dichtbij(verplaatsing(&r, 3)[0], x, 1e-6, 0.0, "scheefstand knoop 3");
    dichtbij(verplaatsing(&r, 4)[0], x, 1e-6, 0.0, "scheefstand knoop 4");
    dichtbij(verplaatsing(&r, 3)[2], -delta, 1e-9, 0.0, "w3 = −δ");
    dichtbij(verplaatsing(&r, 4)[2], 0.0, 0.0, 1e-12, "w4");
}

/// Een montagelast die alleen de trek-alleen staaf kan dragen (een hanger: de
/// knoop eronder is verticaal nergens anders aan vast) blijft in die staaf;
/// het passen verandert er niets aan en haar lengte blijft L (Δ0 = 0). Zonder
/// de terugzetting zou elke ronde de hanger N/k langer passen.
#[test]
fn montage_laat_een_onmisbare_trek_alleen_staaf_haar_kracht_houden() {
    let p = 20.0;
    let onder = Support3D { node_id: 2, ux: true, uy: true, uz: false, rx: true, ry: true, rz: true, ..Default::default() };
    let mut req = verzoek(
        vec![knoop(1, 0.0, 0.0, H), knoop(2, 0.0, 0.0, 0.0)],
        vec![trek_alleen(staaf(1, 1, 2, 2))],
        vec![vast(1), onder],
        vec![last(1, 2, 0.0, -p)],
    );
    req.tension_only_fit = Some(TensionOnlyFit3D { nodal_loads: vec![last(1, 2, 0.0, -p)], ..Default::default() });
    let r = solve(req).unwrap();
    assert!(r.inactive_members.is_empty());
    dichtbij(normaalkracht(&r, 1), p, 1e-9, 0.0, "hanger draagt P");
    dichtbij(delta_mm(&r, 1), 0.0, 0.0, 1e-9, "hanger op zijn tekenlengte");
    dichtbij(verplaatsing(&r, 2)[2], -p * H / (E * A_STRIP), 1e-9, 0.0, "uz = −P·L/(E·A)");
    assert!(r.diagnostics.iter().any(|d| d.contains("niet kan dragen; grootste |N| = 20.000 kN (staaf 1)")),
        "{:?}", r.diagnostics);
}

/// Tweede orde: met montage doen de strips onder G mee (N ≈ 0), dus ook in de
/// knikanalyse. Zonder montage vallen ze weg en knikken de ingeklemde kolommen
/// als uitkragers: α_cr = π²/4·EI/(P·h²) = 6,477 (Euler, L_cr = 2h). De
/// adapter rekent de kolommen in de knikanalyse in vier delen (K4, #186); de
/// eindige-elementenwaarde ligt dan 0,003 % boven de exacte (bovengrens van
/// Rayleigh–Ritz). Met één element per kolom gaf K_G (Przemieniecki)
/// det(K − λ·K_G) = 0 → 135μ² − 156μ + 12 = 0 met μ = λ·P·h²/(30EI), dus
/// α_cr = 2,4856·EI/(P·h²) = 6,526: 0,75 % te hoog; die waarde stond hier
/// tot oktober 2026. De kolomkoppen zijn in Y vastgehouden, zodat het vlak
/// van het portaal maatgevend is. Met actieve strips is de zijdelingse
/// stijfheid ruim tien keer groter (2·k_d·c² = 20 161 kN/m tegen
/// 2·3EI/h³ = 1 969 kN/m).
#[test]
fn montage_houdt_de_strips_in_de_knikanalyse() {
    let p = 500.0;
    let k = stijfheid();
    let kop = |node_id| Support3D { node_id, uy: true, ..Default::default() };
    let tweede_orde = |montage: bool| {
        let mut req = portaal(p, 0.0);
        req.supports.extend([kop(3), kop(4)]);
        req.analysis = AnalysisKind::PDelta;
        req.buckling_modes = 3;
        if montage { req.tension_only_fit = Some(montage_g(p)); }
        solve(req).unwrap()
    };
    let zonder = tweede_orde(false);
    assert_eq!(zonder.inactive_members, vec![4, 5]);
    let alpha_uitkrager = std::f64::consts::PI.powi(2) / 4.0 * E * I_KOLOM / (p * H * H);
    assert!(knikfactor(&zonder) >= alpha_uitkrager, "bovengrens: {} < {alpha_uitkrager}", knikfactor(&zonder));
    dichtbij(knikfactor(&zonder), alpha_uitkrager, 1e-4, 0.0, "α_cr uitkragende kolommen");

    let met = tweede_orde(true);
    assert!(met.inactive_members.is_empty());
    for strip in [4, 5] {
        dichtbij(normaalkracht(&met, strip), 0.0, 0.0, 1e-6, "N strip in tweede orde");
        dichtbij(delta_mm(&met, strip), -k.s * p / k.kv * 1000.0, 1e-6, 0.0, "Δ0 lineair bepaald");
    }
    assert!(knikfactor(&met) > 5.0 * knikfactor(&zonder),
        "met strips {} tegen zonder {}", knikfactor(&met), knikfactor(&zonder));
}

/// De montagelasten krijgen dezelfde keuring als de gewone lasten.
#[test]
fn montagelasten_worden_gekeurd_als_gewone_lasten() {
    let mut req = portaal(10.0, 0.0);
    req.tension_only_fit = Some(TensionOnlyFit3D { nodal_loads: vec![last(1, 99, 0.0, -1.0)], ..Default::default() });
    let fout = solve(req).unwrap_err();
    assert!(fout.starts_with("tensionOnlyFit: belasting 1 verwijst naar ontbrekende knoop 99"), "{fout}");

    let mut req = portaal(10.0, 0.0);
    req.tension_only_fit = Some(TensionOnlyFit3D { nodal_loads: vec![last(1, 3, 0.0, 0.0)], ..Default::default() });
    assert!(solve(req).unwrap_err().contains("bevat alleen nulwaarden"));

    // Strikt contract: een onbekend veld in tensionOnlyFit wordt geweigerd.
    let mut json = serde_json::to_value(portaal(10.0, 0.0)).unwrap();
    json["tensionOnlyFit"] = serde_json::json!({ "nodalLoad": [] });
    let fout = serde_json::from_value::<SolveRequest3D>(json).unwrap_err().to_string();
    assert!(fout.contains("unknown field `nodalLoad`"), "{fout}");
    let mut json = serde_json::to_value(portaal(10.0, 0.0)).unwrap();
    json["tensionOnlyFit"] = serde_json::json!({});
    json["tensionOnlyCrossRule"] = serde_json::json!(true);
    let verzoek: SolveRequest3D = serde_json::from_value(json).unwrap();
    assert!(verzoek.tension_only_cross_rule && verzoek.tension_only_fit.is_some());
    // Lege montagelasten: Δ0 = 0 voor elke strip, met een melding.
    let r = solve(verzoek).unwrap();
    assert!(r.tension_only_fit.iter().all(|f| f.delta_mm == 0.0) && r.tension_only_fit.len() == 2);
    assert!(r.diagnostics.iter().any(|d| d.contains("de montagelasten zijn leeg")), "{:?}", r.diagnostics);
}

// ─── Kruisregel ─────────────────────────────────────────────────────────────

/// Grote verticale last (P = 2000 kN) en kleine horizontale (H = 2 kN): de
/// kolomverkorting drukt beide strips. Zonder regel vallen ze allebei weg en
/// dragen de uitkragende kolommen H (`geen_diagonaal`); strip 4 zou dan nog
/// steeds verkorten. Met de regel blijft strip 4 actief, de diagonaal met de
/// grootste N (H rekt haar), met N4 uit `een_diagonaal(P, H)`: een kleine
/// drukkracht, terwijl strip 5 bij die verplaatsingen veel sterker gedrukt zou
/// worden (dus geen wissel).
#[test]
fn kruisregel_houdt_de_diagonaal_met_de_grootste_normaalkracht() {
    let (p, h) = (2000.0, 2.0);
    let k = stijfheid();
    let zonder = solve(portaal(p, h)).unwrap();
    assert_eq!(zonder.inactive_members, vec![4, 5]);
    let (u3, u4, w) = geen_diagonaal(p, h);
    dichtbij(verplaatsing(&zonder, 3)[0], u3, 1e-9, 0.0, "u3 zonder strips");
    dichtbij(verplaatsing(&zonder, 4)[0], u4, 1e-9, 0.0, "u4 zonder strips");
    assert!(k.c * u4 + k.s * w < 0.0, "strip 4 verkort ook zonder strips");

    let mut req = portaal(p, h);
    req.tension_only_cross_rule = true;
    let met = solve(req).unwrap();
    assert_eq!(met.inactive_members, vec![5]);
    assert_eq!(met.cross_rule_members, vec![4]);
    let (n4, u3, w3, _, _) = een_diagonaal(p, h);
    assert!(n4 < 0.0, "de gehouden diagonaal houdt een kleine drukkracht");
    dichtbij(normaalkracht(&met, 4), n4, 1e-9, 1e-12, "N4 uit de stijfheid");
    let n5 = k.kd * (-k.c * u3 + k.s * w3);
    assert!(n5 < n4, "strip 5 zou sterker gedrukt worden: {n5} < {n4}");
    let regel = met.diagnostics.iter().find(|d| d.starts_with("Kruisregel")).unwrap();
    assert!(regel.contains("1 kruis(en) van trek-alleen staven; in 1 daarvan"), "{regel}");
    assert!(regel.contains(&format!("Grootste drukkracht in een actieve trek-alleen staaf: {:.3} kN (staaf 4)", -n4)), "{regel}");
    let json = serde_json::to_value(&met).unwrap();
    assert_eq!(json["crossRuleMembers"], serde_json::json!([4]));
}

/// Een kruis waar de regel niet nodig is (H overheerst): de uitkomst is gelijk
/// aan die zonder regel, bit voor bit, en de melding zegt dat de regel nergens
/// nodig was.
#[test]
fn kruisregel_verandert_niets_als_een_diagonaal_op_trek_staat() {
    let (p, h) = (20.0, 20.0);
    let zonder = solve(portaal(p, h)).unwrap();
    let mut req = portaal(p, h);
    req.tension_only_cross_rule = true;
    let met = solve(req).unwrap();
    assert_eq!(zonder.inactive_members, vec![5]);
    assert_eq!(met.inactive_members, zonder.inactive_members);
    assert!(met.cross_rule_members.is_empty());
    let (n4, ..) = een_diagonaal(p, h);
    assert!(n4 > 0.0);
    dichtbij(normaalkracht(&met, 4), n4, 1e-9, 1e-12, "N4");
    for (a, b) in met.member_forces.iter().zip(&zonder.member_forces) {
        assert_eq!((a.member_id, a.n_start_kn, a.my_start_knm, a.mz_end_knm), (b.member_id, b.n_start_kn, b.my_start_knm, b.mz_end_knm));
    }
    for (a, b) in met.displacements.iter().zip(&zonder.displacements) {
        assert_eq!((a.node_id, a.ux, a.uy, a.uz), (b.node_id, b.ux, b.uy, b.uz));
    }
    let regel = met.diagnostics.iter().find(|d| d.starts_with("Kruisregel")).unwrap();
    assert!(regel.contains("de regel was nergens nodig") && regel.contains("Geen actieve trek-alleen staaf staat op druk"), "{regel}");
}

/// Zonder kruis (beide strips eindigen in één knoop midden op de ligger: een
/// V) heeft de regel niets te doen en zegt dat.
#[test]
fn kruisregel_meldt_als_er_geen_kruis_is() {
    let mut req = portaal(20.0, 20.0);
    req.schema_version = 2;
    req.nodes.push(knoop(5, B / 2.0, 0.0, H));
    // De ligger loopt door knoop 5 (tussenknoop), de strips eindigen daar.
    req.members[2].intermediate_node_ids = vec![5];
    req.members[3] = trek_alleen(staaf(4, 1, 5, 2));
    req.members[4] = trek_alleen(staaf(5, 2, 5, 2));
    req.tension_only_cross_rule = true;
    let r = solve(req).unwrap();
    assert!(r.cross_rule_members.is_empty());
    assert!(r.diagnostics.iter().any(|d| d.starts_with("Kruisregel: geen kruis van twee trek-alleen staven")), "{:?}", r.diagnostics);
}
