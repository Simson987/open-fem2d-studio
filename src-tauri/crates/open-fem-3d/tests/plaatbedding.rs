//! Plaat op bedding (#107): analytische controles van een plaat op een
//! Winkler-grond (vloer op zand).
//!
//! Eenheden: m, kN, kNm. De grond is een beddingsconstante k (kN/m³)
//! loodrecht op het plaatvlak, aan de −z-zijde van de plaatassen; de adapter
//! zet in elke plaatknoop een veer k·A_trib met A_trib = Σ ∫N_i dA over de
//! aansluitende MITC4-elementen (zie de module `plaatbedding`). Elke foutgrens
//! staat bij de test verantwoord, met de gemeten afwijking erbij.

use open_fem_3d::{
    solve, AnalysisKind, Bedding3D, Diaphragm3D, EndReleases3D, GlobalDirection3D, Material3D, Member3D, MemberLoad3D,
    NodalLoad3D, Node3D, Plate3D, PlateBedding3D, PlateBeddingNode3D, PlateBeddingResult3D, Section3D,
    ShellElement3D, SolveRequest3D, SolveResult3D, Support3D, SurfaceLoad3D,
};

type V3 = [f64; 3];

const E_BETON: f64 = 30_000.0;
const NU_BETON: f64 = 0.2;

/// Knoopnummers van een rechthoekig net: `ids[j][i]` hoort bij (xs[i], ys[j])
/// in het vlak o + x·u + y·v.
struct Net {
    ids: Vec<Vec<usize>>,
    xs: Vec<f64>,
    ys: Vec<f64>,
}

impl Net {
    fn id(&self, i: usize, j: usize) -> usize { self.ids[j][i] }
    fn nx(&self) -> usize { self.xs.len() - 1 }
    fn ny(&self) -> usize { self.ys.len() - 1 }
}

fn net(xs: &[f64], ys: &[f64], o: V3, u: V3, v: V3, nodes: &mut Vec<Node3D>) -> Net {
    let mut volgende = nodes.iter().map(|n| n.id).max().unwrap_or(0) + 1;
    let mut ids = Vec::new();
    for y in ys {
        let mut rij = Vec::new();
        for x in xs {
            nodes.push(Node3D {
                id: volgende,
                x: o[0] + x * u[0] + y * v[0],
                y: o[1] + x * u[1] + y * v[1],
                z: o[2] + x * u[2] + y * v[2],
            });
            rij.push(volgende);
            volgende += 1;
        }
        ids.push(rij);
    }
    Net { ids, xs: xs.to_vec(), ys: ys.to_vec() }
}

fn gelijk(n: usize, lengte: f64) -> Vec<f64> { (0..=n).map(|i| lengte * i as f64 / n as f64).collect() }

/// Vierhoeken van plaat `plate_id`, behalve waar `open(i, j)` (een sparing).
fn vierhoeken(net: &Net, plate_id: usize, open: impl Fn(usize, usize) -> bool, elements: &mut Vec<ShellElement3D>) {
    for j in 0..net.ny() {
        for i in 0..net.nx() {
            if open(i, j) { continue; }
            let id = elements.len() + 1;
            elements.push(ShellElement3D {
                id, plate_id,
                node_ids: vec![net.id(i, j), net.id(i + 1, j), net.id(i + 1, j + 1), net.id(i, j + 1)],
            });
        }
    }
}

fn plaat(id: usize, dikte: f64, k: f64, alleen_druk: bool) -> Plate3D {
    Plate3D { id, material_id: 1, thickness_m: dikte, bedding: Some(PlateBedding3D { k_kn_per_m3: k, compression_only: alleen_druk }), orthotropy: None }
}

fn verzoek(nodes: Vec<Node3D>, e_mpa: f64, plates: Vec<Plate3D>, shell_elements: Vec<ShellElement3D>) -> SolveRequest3D {
    // Alleen de knopen van een element: een knoop in een sparing hoort niet in het model.
    let gebruikt: std::collections::BTreeSet<usize> = shell_elements.iter().flat_map(|e| e.node_ids.iter().copied()).collect();
    SolveRequest3D {
        schema_version: 2, analysis: AnalysisKind::Linear,
        nodes: nodes.into_iter().filter(|n| gebruikt.contains(&n.id)).collect(),
        materials: vec![
            Material3D { id: 1, name: "beton".into(), e_mpa, nu: NU_BETON, g_mpa: None, alpha_per_k: None },
            Material3D { id: 2, name: "staal".into(), e_mpa: 210_000.0, nu: 0.3, g_mpa: None, alpha_per_k: None },
        ],
        sections: vec![], members: vec![], supports: vec![], nodal_loads: vec![], member_loads: vec![],
        member_point_loads: vec![], thermal_loads: vec![], plates, shell_elements, surface_loads: vec![],
        diaphragms: vec![], node_links: vec![], tension_only_fit: None, tension_only_cross_rule: false,
        max_iterations: 50, tolerance: 1e-10, buckling_modes: 0,
    }
}

fn vlaklast(id: usize, plate_id: usize, q: V3) -> SurfaceLoad3D {
    SurfaceLoad3D { id, plate_id, qx_kn_per_m2: q[0], qy_kn_per_m2: q[1], qz_kn_per_m2: q[2] }
}

fn knooplast(id: usize, node_id: usize, f: V3) -> NodalLoad3D {
    NodalLoad3D { id, node_id, fx: f[0], fy: f[1], fz: f[2], mx: 0.0, my: 0.0, mz: 0.0 }
}

fn steun(node_id: usize, vast: [bool; 6]) -> Support3D {
    Support3D { node_id, ux: vast[0], uy: vast[1], uz: vast[2], rx: vast[3], ry: vast[4], rz: vast[5], ..Default::default() }
}

fn grond(r: &SolveResult3D, plate_id: usize) -> &PlateBeddingResult3D {
    r.plate_bedding.iter().find(|b| b.plate_id == plate_id).expect("de plaat staat in plateBedding")
}

fn in_knoop(b: &PlateBeddingResult3D, node_id: usize) -> &PlateBeddingNode3D {
    b.nodes.iter().find(|n| n.node_id == node_id).expect("plaatknoop in plateBedding")
}

fn u_van(r: &SolveResult3D, node_id: usize) -> [f64; 6] {
    let d = r.displacements.iter().find(|d| d.node_id == node_id).expect("verplaatsing van de knoop");
    [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz]
}

fn afwijking(werkelijk: f64, verwacht: f64) -> f64 { (werkelijk - verwacht).abs() / verwacht.abs() }

fn dichtbij(werkelijk: f64, verwacht: f64, relatief: f64, wat: &str) {
    let fout = afwijking(werkelijk, verwacht);
    assert!(fout <= relatief, "{wat}: berekend {werkelijk:.9e}, verwacht {verwacht:.9e}, afwijking {:.3e}", fout);
}

fn plaatstijfheid(e_mpa: f64, nu: f64, t: f64) -> f64 { e_mpa * 1000.0 * t.powi(3) / (12.0 * (1.0 - nu * nu)) }

/// Tributair oppervlak per knoop van een rechthoekig net: elk rechthoekig
/// element geeft een kwart van zijn oppervlak aan elke hoek (∫N_i dA = A/4).
fn tributair(r: &SolveRequest3D, plate_id: usize) -> std::collections::BTreeMap<usize, f64> {
    let punt: std::collections::BTreeMap<usize, V3> = r.nodes.iter().map(|n| (n.id, [n.x, n.y, n.z])).collect();
    let mut uit = std::collections::BTreeMap::new();
    for e in r.shell_elements.iter().filter(|e| e.plate_id == plate_id) {
        let p: Vec<V3> = e.node_ids.iter().map(|id| punt[id]).collect();
        let a = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
        let b = [p[3][0] - p[0][0], p[3][1] - p[0][1], p[3][2] - p[0][2]];
        let c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        let opp = (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]).sqrt();
        for id in &e.node_ids { *uit.entry(*id).or_insert(0.0) += opp / 4.0; }
    }
    uit
}

/// (a) Vierkante plaat 6 × 6 m op bedding, zonder opleggingen, onder een
/// gelijkmatige vlaklast q. Een consistente vlaklast geeft in elke knoop
/// F_i = q·A_trib en de veer is k·A_trib: elke knoop zakt exact q/k, de plaat
/// verschuift als star lichaam en buigt niet. Grenzen: afrondingsruis
/// (10⁻⁹ relatief voor de zakking en ΣR, momenten onder 10⁻⁹·q·a²).
/// Gemeten: zie de uitvoer van de test.
#[test]
fn gelijkmatige_last_geeft_gelijkmatige_zakking_zonder_momenten() {
    let (a, t, k, q) = (6.0, 0.25, 20_000.0, 10.0);
    for alleen_druk in [false, true] {
        let mut nodes = Vec::new();
        let g = net(&gelijk(12, a), &gelijk(12, a), [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], &mut nodes);
        let mut elements = Vec::new();
        vierhoeken(&g, 1, |_, _| false, &mut elements);
        let mut r = verzoek(nodes, E_BETON, vec![plaat(1, t, k, alleen_druk)], elements);
        r.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -q]));
        let uit = solve(r).unwrap_or_else(|fout| panic!("{fout}"));
        let b = grond(&uit, 1);
        assert_eq!(b.nodes.len(), 13 * 13, "elke plaatknoop heeft een grondveer");
        let mut grootste_fout: f64 = 0.0;
        for n in &b.nodes {
            grootste_fout = grootste_fout.max(afwijking(n.settlement_m, q / k));
            dichtbij(n.settlement_m, q / k, 1e-9, "zakking = q/k");
            dichtbij(n.pressure_kn_per_m2, q, 1e-9, "gronddruk = q");
            assert!(n.active, "overal contact");
            let u = u_van(&uit, n.node_id);
            dichtbij(-u[2], q / k, 1e-9, "u_z = −q/k");
            assert!(u[0].abs() < 1e-12 && u[1].abs() < 1e-12, "geen verschuiving in het vlak: {u:?}");
            assert!(u[3].abs() < 1e-12 && u[4].abs() < 1e-12, "geen draaiing: {u:?}");
        }
        let m_grens = 1e-9 * q * a * a;
        let grootste_m = uit.shell_nodes.iter()
            .map(|n| n.values.mxx_knm_per_m.abs().max(n.values.myy_knm_per_m.abs()).max(n.values.mxy_knm_per_m.abs()))
            .fold(0.0, f64::max);
        assert!(grootste_m < m_grens, "momenten ≈ 0: grootste {grootste_m:.3e} kNm/m");
        dichtbij(b.total_reaction_kn, q * a * a, 1e-9, "ΣR = q·A");
        dichtbij(b.max_pressure_kn_per_m2, q, 1e-9, "grootste gronddruk");
        dichtbij(b.min_pressure_kn_per_m2, q, 1e-9, "kleinste gronddruk");
        dichtbij(b.max_settlement_m, q / k, 1e-9, "grootste zakking");
        assert_eq!(b.lifted_fraction, 0.0);
        assert!(uit.reactions.is_empty(), "geen opleggingen, dus geen oplegreacties: {:?}", uit.reactions);
        let evenwicht = uit.equilibrium.as_ref().expect("evenwichtssamenvatting");
        assert!(evenwicht.equilibrium_ok && evenwicht.residual_ok, "{evenwicht:?}");
        assert!(uit.diagnostics.iter().any(|m| m.contains("Plaat op bedding") && m.contains("plaat 1")), "{:?}", uit.diagnostics);
        assert!(uit.diagnostics.iter().any(|m| m.contains("plaatvlak") && m.contains("vast")),
            "melding over de vastgehouden beweging in het vlak: {:?}", uit.diagnostics);
        if alleen_druk {
            assert!(uit.diagnostics.iter().any(|m| m.contains("alleen druk") && m.contains("overal contact")), "{:?}", uit.diagnostics);
        }
        println!("(a) alleen druk {alleen_druk}: grootste afwijking zakking {grootste_fout:.2e}, grootste moment {grootste_m:.2e} kNm/m, ΣR {:.9} kN",
            b.total_reaction_kn);
    }
}

/// Zonder bedding verandert er niets aan de keuring: een plaat zonder
/// opleggingen en zonder bedding blijft geweigerd.
#[test]
fn zonder_bedding_blijft_een_plaat_zonder_opleggingen_geweigerd() {
    let mut nodes = Vec::new();
    let g = net(&gelijk(2, 2.0), &gelijk(2, 2.0), [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], &mut nodes);
    let mut elements = Vec::new();
    vierhoeken(&g, 1, |_, _| false, &mut elements);
    let mut r = verzoek(nodes, E_BETON, vec![Plate3D { id: 1, material_id: 1, thickness_m: 0.2, bedding: None, orthotropy: None }], elements);
    r.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -1.0]));
    let fout = solve(r).unwrap_err();
    assert!(fout.contains("oplegging"), "{fout}");
}

/// Tweede orde met platen bestaat (nog) niet; dat blijft een duidelijke fout,
/// ook met bedding. De knikanalyse bij een lineaire berekening is voor platen
/// niet van toepassing en laat de berekening verder ongemoeid.
#[test]
fn tweede_orde_en_knik_met_een_plaat_op_bedding() {
    let mut nodes = Vec::new();
    let g = net(&gelijk(4, 4.0), &gelijk(4, 4.0), [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], &mut nodes);
    let mut elements = Vec::new();
    vierhoeken(&g, 1, |_, _| false, &mut elements);
    let mut r = verzoek(nodes, E_BETON, vec![plaat(1, 0.2, 10_000.0, false)], elements);
    r.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -5.0]));
    let mut pdelta = r.clone();
    pdelta.analysis = AnalysisKind::PDelta;
    let fout = solve(pdelta).unwrap_err();
    assert!(fout.contains("tweede-orde") && fout.contains("platen"), "{fout}");
    r.buckling_modes = 3;
    let uit = solve(r).unwrap_or_else(|fout| panic!("{fout}"));
    assert!(matches!(uit.buckling, open_fem_3d::BucklingSummary::NotApplicable { .. }), "{:?}", uit.buckling);
    dichtbij(grond(&uit, 1).total_reaction_kn, 5.0 * 16.0, 1e-9, "ΣR");
}

/// Graduele netverdeling op [−R, R]: x = R·(α·s + (1 − α)·s³), s ∈ [−1, 1];
/// fijn in het midden (h ≈ α·R·2/n), grof aan de rand.
fn gegradeerd(n: usize, r: f64, alfa: f64) -> Vec<f64> {
    (0..=n).map(|i| {
        let s = -1.0 + 2.0 * i as f64 / n as f64;
        r * (alfa * s + (1.0 - alfa) * s.powi(3))
    }).collect()
}

/// (b) Puntlast P midden op een grote plaat: de oneindige plaat op een
/// Winkler-grond (Hertz; Westergaard, binnenlast) zakt onder de last
/// w₀ = P/(8·√(k·D)), D = E·t³/(12·(1 − ν²)), ℓ = (D/k)^¼.
///
/// Plaat 10ℓ × 10ℓ (de rand op 5ℓ: de invloed van een vrije rand op het
/// midden is van de orde e^(−2·5/√2) ≈ 10⁻³), net gegradeerd naar het midden
/// (h/ℓ in het midden 0,25 → 0,125 → 0,063). Westergaard is Kirchhoff; MITC4
/// is een Mindlin-element, en onder een puntlast heeft een Mindlin-plaat een
/// extra afschuifzakking P/(2π·κ·G·t)·ln(ℓ/h) die bij verfijning onbegrensd
/// (logaritmisch) groeit. Daarom een dunne plaat, t/ℓ = 0,053: die term is
/// 0,088 % van w₀ per eenheid ln(ℓ/h), dus hooguit 0,25 % op deze netten. (Bij
/// t/ℓ = 0,087 is het 0,24 %/ln; gemeten −5,0 %, −0,31 % en +1,04 % op dezelfde
/// netten: de afschuifterm schiet dan op het fijnste net voorbij Westergaard.)
/// De rest is de discretisatie van de buiging en van de knoopveren k·A_trib,
/// beide O((h/ℓ)²). Grens 1 % op het fijnste net en een dalende fout bij
/// verfijning (gemeten: zie de uitvoer).
#[test]
fn puntlast_midden_op_een_grote_plaat_volgt_westergaard() {
    let (t, k, p) = (0.10, 200.0, 100.0);
    let d = plaatstijfheid(E_BETON, NU_BETON, t);
    let l = (d / k).powf(0.25);
    let w0 = p / (8.0 * (k * d).sqrt());
    let r = 5.0 * l;
    let mut fouten = Vec::new();
    for n in [12usize, 24, 48] {
        let coords = gegradeerd(n, r, 0.3);
        let mut nodes = Vec::new();
        let g = net(&coords, &coords, [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], &mut nodes);
        let mut elements = Vec::new();
        vierhoeken(&g, 1, |_, _| false, &mut elements);
        let midden = g.id(n / 2, n / 2);
        let mut verzoek = verzoek(nodes, E_BETON, vec![plaat(1, t, k, false)], elements);
        verzoek.nodal_loads.push(knooplast(1, midden, [0.0, 0.0, -p]));
        let uit = solve(verzoek).unwrap_or_else(|fout| panic!("{fout}"));
        let b = grond(&uit, 1);
        let w = in_knoop(b, midden).settlement_m;
        let fout = (w - w0) / w0;
        let h = coords[n / 2 + 1] - coords[n / 2];
        println!("(b) {n:>2}×{n:<2}: h/ℓ = {:.3}, w₀ = {:.5} mm (Westergaard {:.5} mm): {:+.3} %",
            h / l, w * 1000.0, w0 * 1000.0, 100.0 * fout);
        dichtbij(b.total_reaction_kn, p, 1e-9, "ΣR = P");
        assert!(b.max_settlement_m == w, "de grootste zakking ligt onder de last");
        fouten.push(fout.abs());
    }
    assert!(fouten[2] < 0.01, "fijnste net wijkt {:.3} % af", 100.0 * fouten[2]);
    assert!(fouten[1] < fouten[0] && fouten[2] < fouten[1], "de zakking convergeert niet: {fouten:?}");
}

/// De stijve plaat op een grond zonder trek (vlak drukvlak): de zakking is
/// w = c·(s₀ − s) met s = x' + y' (assen door het midden) waar w > 0, anders
/// los. Kracht en moment om de diagonaal bepalen s₀ en c; zie de test (c).
/// Integralen ∫ g(s)·(B − |s|) ds over het vierkant, exact met Simpson per
/// stuk (de integranden zijn hoogstens kubisch tussen −B, 0 en s₀).
fn starre_plaat_zonder_trek(b: f64, k: f64, v: f64, moment_s: f64) -> (f64, f64) {
    let simpson = |f: &dyn Fn(f64) -> f64, a: f64, c: f64| (c - a) / 6.0 * (f(a) + 4.0 * f(0.5 * (a + c)) + f(c));
    let integraal = |f: &dyn Fn(f64) -> f64, s0: f64| {
        let boven = s0.min(b);
        if boven <= 0.0 { simpson(f, -b, boven) } else { simpson(f, -b, 0.0) + simpson(f, 0.0, boven) }
    };
    let verhouding = |s0: f64| {
        let f0 = |s: f64| (s0 - s) * (b - s.abs());
        let f1 = |s: f64| (s0 - s) * s * (b - s.abs());
        integraal(&f1, s0) / integraal(&f0, s0)
    };
    // M/F daalt niet met s₀; bisectie op M/F = moment_s / V.
    let doel = moment_s / v;
    let (mut laag, mut hoog) = (-b + 1e-9, b);
    for _ in 0..200 {
        let midden = 0.5 * (laag + hoog);
        if verhouding(midden) < doel { laag = midden } else { hoog = midden }
    }
    let s0 = 0.5 * (laag + hoog);
    let c = v / (k * integraal(&|s: f64| (s0 - s) * (b - s.abs()), s0));
    // Los oppervlak: ∫_{s₀}^{B} (B − |s|) ds, exact.
    let los_deel = if s0 >= 0.0 { (b - s0).powi(2) / 2.0 } else { b * b - (b + s0).powi(2) / 2.0 };
    (k * c * (s0 + b), los_deel / (b * b))
}

/// (c) Alleen druk: een stijve vierkante plaat (B = 4 m) onder een
/// gelijkmatige last q en een hoeklast P = q·B²/2. De resultante ligt op de
/// diagonaal op e = B/6 van het midden, buiten de kern (B/12 langs de
/// diagonaal): de overstaande hoek komt los.
///
/// Controles: geen trek in de grond, een los deel met de overstaande hoek
/// erin, liftedFraction exact als aandeel van het oppervlak (10⁻¹²),
/// evenwicht van kracht en moment (10⁻⁶ relatief), en de vergelijking
/// met de starre plaat op een grond zonder trek. De plaat is stijf maar niet
/// star (B/ℓ = 0,32) en de contactgrens loopt tussen de knopen door (h =
/// 0,25 m): grens 3 % voor de grootste druk en 0,03 absoluut voor het losse
/// deel (gemeten: zie de uitvoer).
#[test]
fn alleen_druk_hoeklast_tilt_de_overstaande_hoek() {
    let (b, t, k, q) = (4.0, 1.0, 10_000.0, 10.0);
    let p = q * b * b / 2.0;
    let e_stijf = 100.0 * E_BETON;
    let mut nodes = Vec::new();
    let g = net(&gelijk(16, b), &gelijk(16, b), [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], &mut nodes);
    let mut elements = Vec::new();
    vierhoeken(&g, 1, |_, _| false, &mut elements);
    let mut r = verzoek(nodes, e_stijf, vec![plaat(1, t, k, true)], elements);
    r.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -q]));
    let hoek = g.id(0, 0);
    r.nodal_loads.push(knooplast(1, hoek, [0.0, 0.0, -p]));
    let a_trib = tributair(&r, 1);
    let punt: std::collections::BTreeMap<usize, V3> = r.nodes.iter().map(|n| (n.id, [n.x, n.y, n.z])).collect();
    let uit = solve(r.clone()).unwrap_or_else(|fout| panic!("{fout}"));
    let bg = grond(&uit, 1);
    let schaal = bg.nodes.iter().map(|n| n.settlement_m.abs())
        .chain(uit.displacements.iter().flat_map(|d| [d.ux.abs(), d.uy.abs(), d.uz.abs()]))
        .fold(0.0, f64::max);
    let tol = 1e-6 * schaal;
    for n in &bg.nodes {
        assert!(n.pressure_kn_per_m2 >= 0.0, "knoop {}: trek in de grond ({})", n.node_id, n.pressure_kn_per_m2);
        if n.active {
            assert!(n.settlement_m >= -tol, "knoop {}: actief maar komt omhoog", n.node_id);
        } else {
            assert!(n.settlement_m <= tol, "knoop {}: los maar zakt de grond in", n.node_id);
            assert_eq!(n.pressure_kn_per_m2, 0.0);
        }
    }
    assert!(bg.lifted_fraction > 0.0, "de overstaande hoek komt los");
    // liftedFraction is het aandeel van het oppervlak zonder contact (Σ A_trib
    // zonder contact / Σ A_trib), niet het aandeel van de knopen: exact
    // (10⁻¹²). Hier verschillen die twee 0,014 (gemeten 0,1768 tegen 0,1903).
    let los_oppervlak: f64 = bg.nodes.iter().filter(|n| !n.active).map(|n| a_trib[&n.node_id]).sum();
    let totaal: f64 = a_trib.values().sum();
    let los_knopen = bg.nodes.iter().filter(|n| !n.active).count() as f64 / bg.nodes.len() as f64;
    assert!((bg.lifted_fraction - los_oppervlak / totaal).abs() < 1e-12,
        "liftedFraction {} tegen Σ A_trib zonder contact / Σ A_trib {}", bg.lifted_fraction, los_oppervlak / totaal);
    assert!((bg.lifted_fraction - los_knopen).abs() > 1e-3,
        "de proef onderscheidt oppervlak ({}) en knopentelling ({los_knopen})", bg.lifted_fraction);
    assert!(!in_knoop(bg, g.id(16, 16)).active, "de overstaande hoek is los");
    assert!(in_knoop(bg, hoek).active, "de belaste hoek heeft contact");
    assert!(bg.min_pressure_kn_per_m2 == 0.0);
    // Evenwicht: kracht en moment om de y- en x-as door de belaste hoek.
    let v = q * b * b + p;
    dichtbij(bg.total_reaction_kn, v, 1e-6, "ΣR = q·B² + P");
    let (mut som, mut mx, mut my) = (0.0, 0.0, 0.0);
    for n in &bg.nodes {
        let f = n.pressure_kn_per_m2 * a_trib[&n.node_id];
        som += f;
        mx += f * punt[&n.node_id][0];
        my += f * punt[&n.node_id][1];
    }
    dichtbij(som, v, 1e-6, "Σ p·A_trib");
    dichtbij(mx, q * b * b * b / 2.0, 1e-6, "Σ p·A·x = q·B²·B/2 (P grijpt aan in x = 0)");
    dichtbij(my, q * b * b * b / 2.0, 1e-6, "Σ p·A·y");
    assert!(uit.equilibrium.as_ref().is_some_and(|e| e.equilibrium_ok), "{:?}", uit.equilibrium);
    assert!(uit.diagnostics.iter().any(|m| m.contains("alleen druk") && m.contains("plaat 1") && m.contains("%")),
        "{:?}", uit.diagnostics);
    // Starre plaat: moment om de diagonaal (s = x' + y', midden als oorsprong) = P·(−B).
    let (p_max, los) = starre_plaat_zonder_trek(b, k, v, -p * b);
    println!("(c) grootste druk {:.3} kN/m² (star {p_max:.3}: {:+.2} %), los {:.4} (star {los:.4}); {}",
        bg.max_pressure_kn_per_m2, 100.0 * (bg.max_pressure_kn_per_m2 - p_max) / p_max, bg.lifted_fraction,
        uit.diagnostics.iter().find(|m| m.contains("statusronde")).cloned().unwrap_or_default());
    dichtbij(bg.max_pressure_kn_per_m2, p_max, 0.03, "grootste druk tegen de starre plaat");
    assert!((bg.lifted_fraction - los).abs() < 0.03, "los deel {} tegen star {los}", bg.lifted_fraction);
}

/// (d) Plaat met een sparing: 6 × 6 m met een gat van 2 × 2 m in het midden.
/// ΣA_trib = A − A_sparing = 32 m²: onder q zakt elke knoop exact q/k en is
/// ΣR = q·32 (afrondingsruis, 10⁻⁹).
#[test]
fn plaat_met_sparing_draagt_alleen_op_haar_eigen_oppervlak() {
    let (a, k, q) = (6.0, 20_000.0, 10.0);
    let mut nodes = Vec::new();
    let g = net(&gelijk(12, a), &gelijk(12, a), [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], &mut nodes);
    let mut elements = Vec::new();
    vierhoeken(&g, 1, |i, j| (4..8).contains(&i) && (4..8).contains(&j), &mut elements);
    let mut r = verzoek(nodes, E_BETON, vec![plaat(1, 0.2, k, false)], elements);
    r.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -q]));
    assert_eq!(r.nodes.len(), 13 * 13 - 9, "de knopen binnen de sparing vallen weg");
    let a_trib: f64 = tributair(&r, 1).values().sum();
    dichtbij(a_trib, a * a - 4.0, 1e-12, "ΣA_trib van de test zelf");
    let uit = solve(r).unwrap_or_else(|fout| panic!("{fout}"));
    let b = grond(&uit, 1);
    assert_eq!(b.nodes.len(), 160);
    for n in &b.nodes { dichtbij(n.settlement_m, q / k, 1e-9, "zakking = q/k"); }
    dichtbij(b.total_reaction_kn, q * (a * a - 4.0), 1e-9, "ΣR = q·(A − A_sparing)");
    dichtbij(uit.plates[0].area_m2, a * a - 4.0, 1e-12, "plaatoppervlak");
}

/// (e) Schuine plaat (30° om X): de veer werkt langs de plaatnormaal n =
/// (0; −sin 30°; cos 30°), niet verticaal.
/// 1. Een vlaklast q langs −n: de plaat verschuift star over −(q/k)·n
///    (afrondingsruis, 10⁻⁹).
/// 2. Zwaartekracht zonder iets dat de plaat in haar vlak houdt: de bedding
///    neemt de component langs het vlak niet op, dus een duidelijke fout.
/// 3. Zwaartekracht met opleggingen in Y langs de onderrand (en X in één
///    knoop): evenwicht langs n en langs het vlak geeft exact
///    ΣR_grond = q·A/cos 30° en ΣR_y = q·A·tan 30° (10⁻⁶). Met een verticale
///    veer zou ΣR_grond = q·A zijn.
#[test]
fn schuine_plaat_veert_langs_de_normaal() {
    let (a, k, q) = (4.0, 20_000.0, 10.0);
    let hoek = 30f64.to_radians();
    let (s, c) = (hoek.sin(), hoek.cos());
    let n = [0.0, -s, c];
    let bouw = |last: V3| {
        let mut nodes = Vec::new();
        let g = net(&gelijk(8, a), &gelijk(8, a), [0.0; 3], [1.0, 0.0, 0.0], [0.0, c, s], &mut nodes);
        let mut elements = Vec::new();
        vierhoeken(&g, 1, |_, _| false, &mut elements);
        let mut r = verzoek(nodes, E_BETON, vec![plaat(1, 0.2, k, false)], elements);
        r.surface_loads.push(vlaklast(1, 1, last));
        (r, g)
    };
    // 1. Last langs −n.
    let (r, _) = bouw([-q * n[0], -q * n[1], -q * n[2]]);
    let uit = solve(r).unwrap_or_else(|fout| panic!("{fout}"));
    let b = grond(&uit, 1);
    let assen = uit.plates[0].axes;
    assert!((assen.z[1] + s).abs() < 1e-12 && (assen.z[2] - c).abs() < 1e-12, "plaatnormaal {:?}", assen.z);
    for knoop in &b.nodes {
        dichtbij(knoop.settlement_m, q / k, 1e-9, "zakking langs −n");
        let u = u_van(&uit, knoop.node_id);
        for as_ in 0..3 {
            assert!((u[as_] + q / k * n[as_]).abs() <= 1e-9 * q / k, "u = −(q/k)·n: {u:?}");
        }
    }
    dichtbij(b.total_reaction_kn, q * a * a, 1e-9, "ΣR = q·A");
    // 2. Zwaartekracht zonder steun in het vlak.
    let (r, _) = bouw([0.0, 0.0, -q]);
    let fout = solve(r).unwrap_err();
    assert!(fout.contains("plaat 1") && fout.contains("plaatvlak") && fout.contains("oplegging"), "{fout}");
    // 3. Zwaartekracht met opleggingen in Y langs de onderrand.
    let (mut r, g) = bouw([0.0, 0.0, -q]);
    for i in 0..=8 { r.supports.push(steun(g.id(i, 0), [i == 0, true, false, false, false, false])); }
    let uit = solve(r).unwrap_or_else(|fout| panic!("{fout}"));
    let b = grond(&uit, 1);
    dichtbij(b.total_reaction_kn, q * a * a / c, 1e-6, "ΣR_grond = q·A/cos 30°");
    let ry: f64 = uit.reactions.iter().map(|x| x.fy).sum();
    dichtbij(ry, q * a * a * hoek.tan(), 1e-6, "ΣR_y = q·A·tan 30°");
    assert!(uit.reactions.iter().all(|x| x.fz == 0.0), "de oplegging houdt alleen X en Y");
    assert!(!uit.diagnostics.iter().any(|m| m.contains("plaatvlak") && m.contains("vast")),
        "de opleggingen houden het vlak al: geen kunstmatige steun ({:?})", uit.diagnostics);
}

fn staaf(id: usize, begin: usize, eind: usize, sectie: usize) -> Member3D {
    Member3D { id, start_node_id: begin, end_node_id: eind, material_id: 2, section_id: sectie,
        releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: vec![], tension_only: false,
        bedding: None, part_section_ids: None }
}

fn doorsnede(id: usize, area: f64, iy: f64, iz: f64, j: f64) -> Section3D {
    Section3D { id, name: format!("doorsnede {id}"), area_m2: area, iy_m4: iy, iz_m4: iz,
        torsion_j_m4: j, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }
}

/// (f1) Plaat op bedding samen met een randbalk op bedding (#106) langs de
/// rand y = 0, met de plaatknopen als tussenknopen. q/k van de plaat is gelijk
/// aan q_b/(k·b) van de balk: in de theorie zakt alles even ver en buigt
/// niets. De plaat alleen doet dat exact (test a). De balk niet helemaal: de
/// kern zet de balklast per deel als consistente knooplast met
/// vaste-eindmomenten q_b·h²/12, de bedding van de balk zit in losse veren.
/// Tussen even lange delen heffen die momenten elkaar op; aan de twee
/// balkeinden niet. Daarom knipt de bedding de balk hier in 24 gelijke delen
/// van 0,25 m (I = 10⁻⁴ m⁴: λ = 0,587/m, n = ⌈6·λ/0,15⌉ = 24), die op de
/// plaatknopen (elke 0,5 m) aansluiten; over blijven de eindmomenten
/// ±q_b·h²/12 = 0,026 kNm op de plaathoeken. Die buigen plaat en balk samen
/// tot een flauwe parabool (gemeten: rand midden +3·10⁻⁴, hoeken −8,6·10⁻⁴
/// van q/k). Dat is de discretisatie van de staaf op bedding (#106), niet van
/// de plaat. Grens 2·10⁻³ op de zakking en de reactie per deel; symmetrie
/// (10⁻⁹) en krachtevenwicht ΣR_plaat + ΣR_balk = q·A + q_b·L exact (10⁻⁹).
#[test]
fn plaat_en_balk_op_bedding_samen() {
    let (a, k, q) = (6.0, 20_000.0, 10.0);
    let (k_balk, breedte) = (20_000.0, 0.5);
    let q_balk = q / k * k_balk * breedte;
    let mut nodes = Vec::new();
    let g = net(&gelijk(12, a), &gelijk(12, a), [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], &mut nodes);
    let mut elements = Vec::new();
    vierhoeken(&g, 1, |_, _| false, &mut elements);
    let mut r = verzoek(nodes, E_BETON, vec![plaat(1, 0.25, k, false)], elements);
    r.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -q]));
    r.sections.push(doorsnede(1, 0.01, 1e-4, 1e-4, 1e-6));
    let mut balk = staaf(1, g.id(0, 0), g.id(12, 0), 1);
    balk.intermediate_node_ids = (1..12).map(|i| g.id(i, 0)).collect();
    balk.bedding = Some(Bedding3D { k_kn_per_m3: Some(k_balk), width_m: breedte, k_lateral_kn_per_m3: None, compression_only: false });
    r.members.push(balk);
    r.member_loads.push(MemberLoad3D {
        id: 1, member_id: 1, global_direction: Some(GlobalDirection3D::Z),
        q_start_kn_per_m: Some(-q_balk), q_end_kn_per_m: Some(-q_balk), ..Default::default()
    });
    let uit = solve(r).unwrap_or_else(|fout| panic!("{fout}"));
    let plaatgrond = grond(&uit, 1);
    let balkgrond = uit.bedding.iter().find(|b| b.member_id == 1).expect("balk op bedding");
    let fout = plaatgrond.nodes.iter().map(|n| afwijking(n.settlement_m, q / k))
        .chain(balkgrond.points.iter().map(|p| afwijking(p.settlement_m, q / k)))
        .fold(0.0, f64::max);
    let midden = in_knoop(plaatgrond, g.id(6, 0)).settlement_m;
    let hoek = in_knoop(plaatgrond, g.id(0, 0)).settlement_m;
    println!("(f1) {} rekenknopen langs de balk, grootste afwijking van de gelijkmatige zakking {fout:.2e} (midden rand {:+.2e}, hoek {:+.2e})",
        balkgrond.points.len(), midden / (q / k) - 1.0, hoek / (q / k) - 1.0);
    assert_eq!(balkgrond.points.len(), 25, "24 gelijke delen van 0,25 m");
    assert!(fout < 2e-3, "gelijkmatige zakking: afwijking {fout:.3e}");
    // Symmetrisch om x = 3 m: de knopen in de rand y = 0 links en rechts.
    for i in 0..=6 {
        let (l, r) = (in_knoop(plaatgrond, g.id(i, 0)).settlement_m, in_knoop(plaatgrond, g.id(12 - i, 0)).settlement_m);
        assert!((l - r).abs() <= 1e-9 * q / k, "symmetrie in rand y = 0, i = {i}: {l} tegen {r}");
    }
    dichtbij(plaatgrond.total_reaction_kn, q * a * a, 2e-3, "ΣR plaat ≈ q·A");
    dichtbij(balkgrond.total_reaction_kn, q_balk * a, 2e-3, "ΣR balk ≈ q_b·L");
    dichtbij(plaatgrond.total_reaction_kn + balkgrond.total_reaction_kn, q * a * a + q_balk * a, 1e-9,
        "ΣR plaat + balk = q·A + q_b·L");
    assert!(uit.reactions.is_empty(), "{:?}", uit.reactions);
    assert!(uit.equilibrium.as_ref().is_some_and(|e| e.equilibrium_ok), "{:?}", uit.equilibrium);
}

/// (f2) Een kolom op de plaat met een scharnier aan de top (#96: de
/// topdraaiing om X en Y houdt geen element tegen), een verticale knooplast P
/// op de top en een globale lijnlast q_c langs Z op de kolom (#80). In een
/// lineaire berekening gaat alles axiaal naar de plaat: de plaat zakt precies
/// als onder een puntlast P + q_c·L in de kolomvoet (10⁻⁹ maal de grootste
/// zakking). Een horizontale last op de kolomtop heeft niets dat haar
/// opneemt: een duidelijke fout.
#[test]
fn kolom_met_topscharnier_en_globale_last_op_een_plaat_op_bedding() {
    let (a, k, p, q_c, hoogte) = (6.0, 20_000.0, 120.0, 4.0, 3.0);
    let basis = || {
        let mut nodes = Vec::new();
        let g = net(&gelijk(12, a), &gelijk(12, a), [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], &mut nodes);
        let mut elements = Vec::new();
        vierhoeken(&g, 1, |_, _| false, &mut elements);
        (verzoek(nodes, E_BETON, vec![plaat(1, 0.25, k, false)], elements), g)
    };
    let (mut referentie, g) = basis();
    let voet = g.id(6, 6);
    referentie.nodal_loads.push(knooplast(1, voet, [0.0, 0.0, -(p + q_c * hoogte)]));
    let referentie = solve(referentie).unwrap_or_else(|fout| panic!("{fout}"));

    let met_kolom = |horizontaal: f64| {
        let (mut r, _) = basis();
        let top = r.nodes.iter().map(|n| n.id).max().unwrap() + 1;
        r.nodes.push(Node3D { id: top, x: 3.0, y: 3.0, z: hoogte });
        r.sections.push(doorsnede(1, 0.01, 8e-5, 8e-5, 1e-6));
        let mut kolom = staaf(1, voet, top, 1);
        kolom.releases = EndReleases3D { my_end: true, mz_end: true, ..Default::default() };
        r.members.push(kolom);
        r.nodal_loads.push(knooplast(1, top, [horizontaal, 0.0, -p]));
        r.member_loads.push(MemberLoad3D {
            id: 1, member_id: 1, global_direction: Some(GlobalDirection3D::Z),
            q_start_kn_per_m: Some(-q_c), q_end_kn_per_m: Some(-q_c), ..Default::default()
        });
        (solve(r), top)
    };
    let (uit, top) = met_kolom(0.0);
    let uit = uit.unwrap_or_else(|fout| panic!("{fout}"));
    let schaal = grond(&referentie, 1).max_settlement_m;
    for n in &grond(&referentie, 1).nodes {
        let m = in_knoop(grond(&uit, 1), n.node_id);
        assert!((m.settlement_m - n.settlement_m).abs() <= 1e-9 * schaal,
            "knoop {}: {} tegen {}", n.node_id, m.settlement_m, n.settlement_m);
    }
    dichtbij(grond(&uit, 1).total_reaction_kn, p + q_c * hoogte, 1e-9, "ΣR = P + q_c·L");
    assert!(uit.diagnostics.iter().any(|m| m.contains("Vrije knoopdraaiing") && m.contains(&format!("knoop {top}"))),
        "{:?}", uit.diagnostics);
    let n_kolom = uit.member_forces.iter().find(|f| f.member_id == 1).unwrap();
    dichtbij(-n_kolom.n_start_kn, p + q_c * hoogte, 1e-9, "N in de kolomvoet (druk)");
    // Horizontaal op de top: niets houdt de plaat in haar vlak.
    let (fout, _) = met_kolom(5.0);
    let fout = fout.unwrap_err();
    assert!(fout.contains("plaat 1") && fout.contains("plaatvlak"), "{fout}");
}

/// Een horizontale knooplast op een plaat op bedding zonder opleggingen:
/// een duidelijke fout die de plaat, de kracht en een oplossing noemt. Met
/// een horizontale oplegging in twee knopen rekent hetzelfde model wel, en
/// neemt die oplegging de last op.
#[test]
fn horizontale_last_zonder_horizontale_oplegging_is_een_duidelijke_fout() {
    let mut nodes = Vec::new();
    let g = net(&gelijk(4, 4.0), &gelijk(4, 4.0), [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], &mut nodes);
    let mut elements = Vec::new();
    vierhoeken(&g, 1, |_, _| false, &mut elements);
    let mut r = verzoek(nodes, E_BETON, vec![plaat(1, 0.2, 10_000.0, false)], elements);
    r.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -5.0]));
    r.nodal_loads.push(knooplast(1, g.id(4, 2), [3.0, 0.0, 0.0]));
    let fout = solve(r.clone()).unwrap_err();
    assert!(fout.contains("plaat 1") && fout.contains("plaatvlak") && fout.contains("oplegging") && fout.contains("kN"), "{fout}");
    r.supports.push(steun(g.id(0, 0), [true, true, false, false, false, false]));
    r.supports.push(steun(g.id(0, 4), [true, false, false, false, false, false]));
    let uit = solve(r).unwrap_or_else(|fout| panic!("{fout}"));
    let rx: f64 = uit.reactions.iter().map(|x| x.fx).sum();
    dichtbij(rx, -3.0, 1e-9, "ΣR_x = −3 kN");
    dichtbij(grond(&uit, 1).total_reaction_kn, 80.0, 1e-9, "ΣR_grond");
}

/// Keuring van het veld en de JSON-namen van het contract.
#[test]
fn keuring_en_json_namen() {
    let mut nodes = Vec::new();
    let g = net(&gelijk(2, 2.0), &gelijk(2, 2.0), [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], &mut nodes);
    let mut elements = Vec::new();
    vierhoeken(&g, 1, |_, _| false, &mut elements);
    let r = verzoek(nodes, E_BETON, vec![plaat(1, 0.2, 10_000.0, true)], elements);
    for (k, deel) in [(0.0, "groter zijn dan nul"), (-5.0, "groter zijn dan nul"), (f64::NAN, "niet eindig"), (f64::INFINITY, "niet eindig")] {
        let mut fout = r.clone();
        fout.plates[0].bedding = Some(PlateBedding3D { k_kn_per_m3: k, compression_only: false });
        let melding = solve(fout).unwrap_err();
        assert!(melding.contains("kKnPerM3") && melding.contains("plaat 1") && melding.contains(deel), "{melding}");
    }
    let json = serde_json::to_value(&r).unwrap();
    assert_eq!(json["plates"][0]["bedding"], serde_json::json!({ "kKnPerM3": 10000.0, "compressionOnly": true }));
    // Zonder bedding blijft het veld weg.
    let zonder = Plate3D { id: 1, material_id: 1, thickness_m: 0.2, bedding: None, orthotropy: None };
    assert!(serde_json::to_value(&zonder).unwrap().get("bedding").is_none());
    // compressionOnly is optioneel; een onbekend veld wordt geweigerd.
    let gelezen: Plate3D = serde_json::from_value(serde_json::json!({
        "id": 1, "materialId": 1, "thicknessM": 0.2, "bedding": { "kKnPerM3": 5000 } })).unwrap();
    assert_eq!(gelezen.bedding.as_ref().map(|b| (b.k_kn_per_m3, b.compression_only)), Some((5000.0, false)));
    assert!(serde_json::from_value::<Plate3D>(serde_json::json!({
        "id": 1, "materialId": 1, "thicknessM": 0.2, "bedding": { "kKnPerM3": 5000, "widthM": 1 } })).is_err());
    // Resultaat: plateBedding met de contractnamen; weggelaten zonder plaatbedding.
    let mut met_last = r.clone();
    met_last.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -4.0]));
    let uit = serde_json::to_value(solve(met_last).unwrap()).unwrap();
    let grond = &uit["plateBedding"][0];
    for veld in ["plateId", "nodes", "maxPressureKnPerM2", "minPressureKnPerM2", "maxSettlementM", "totalReactionKn", "liftedFraction"] {
        assert!(grond.get(veld).is_some(), "{veld} ontbreekt: {grond}");
    }
    for veld in ["nodeId", "settlementM", "pressureKnPerM2", "active"] {
        assert!(grond["nodes"][0].get(veld).is_some(), "{veld} ontbreekt: {}", grond["nodes"][0]);
    }
    let mut zonder_bedding = r.clone();
    zonder_bedding.plates[0].bedding = None;
    for (i, j) in [(0, 0), (2, 0), (0, 2), (2, 2)] {
        zonder_bedding.supports.push(steun(g.id(i, j), [i == 0 && j == 0, i == 0 && j == 0 || j == 0, true, false, false, false]));
    }
    zonder_bedding.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -4.0]));
    let uit = serde_json::to_value(solve(zonder_bedding).unwrap()).unwrap();
    assert!(uit.get("plateBedding").is_none(), "zonder plaatbedding geen plateBedding");
}

/// Alleen druk en een opwaartse last zonder opleggingen: na de eerste ronde
/// komt de hele plaat los en houdt niets haar meer vast. Een duidelijke fout
/// vóór de volgende ronde, die de plaat noemt; zonder alleen druk rekent
/// hetzelfde model (de grond trekt de plaat terug: zakking −q/k).
#[test]
fn opwaartse_last_bij_alleen_druk_tilt_de_plaat_van_de_grond() {
    let (k, q) = (10_000.0, 5.0);
    let maak = |alleen_druk: bool| {
        let mut nodes = Vec::new();
        let g = net(&gelijk(4, 4.0), &gelijk(4, 4.0), [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], &mut nodes);
        let mut elements = Vec::new();
        vierhoeken(&g, 1, |_, _| false, &mut elements);
        let mut r = verzoek(nodes, E_BETON, vec![plaat(1, 0.2, k, alleen_druk)], elements);
        r.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, q]));
        r
    };
    let fout = solve(maak(true)).unwrap_err();
    assert!(fout.contains("bedding (alleen druk)") && fout.contains("plaat 1") && fout.contains("komt los van de grond"), "{fout}");
    assert!(fout.contains("hangen nergens aan"), "zonder veren hangt de plaat nergens aan: {fout}");
    let uit = solve(maak(false)).unwrap_or_else(|fout| panic!("{fout}"));
    for n in &grond(&uit, 1).nodes { dichtbij(n.settlement_m, -q / k, 1e-9, "trek in de grond zonder alleen druk"); }
}

/// Een verticale wand in het XZ-vlak op bedding: de plaatnormaal z = −Y
/// (plaatassen: x = X, y omhoog), de grond aan de −z-zijde, dus aan de +Y-kant.
/// Een vlaklast in +Y duwt de wand de grond in: de veer ligt langs globaal Y
/// (een oplegveer ky) en de wand verschuift exact q/k in +Y (10⁻⁹). De
/// beweging in het wandvlak (X, Z, draaien om Y) houdt de berekening vast.
#[test]
fn verticale_wand_veert_langs_globaal_y() {
    let (k, q) = (20_000.0, 8.0);
    let mut nodes = Vec::new();
    let g = net(&gelijk(6, 3.0), &gelijk(4, 2.0), [0.0; 3], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0], &mut nodes);
    let mut elements = Vec::new();
    vierhoeken(&g, 1, |_, _| false, &mut elements);
    let mut r = verzoek(nodes, E_BETON, vec![plaat(1, 0.25, k, true)], elements);
    r.surface_loads.push(vlaklast(1, 1, [0.0, q, 0.0]));
    let uit = solve(r).unwrap_or_else(|fout| panic!("{fout}"));
    assert!((uit.plates[0].axes.z[1] + 1.0).abs() < 1e-12, "plaatnormaal −Y: {:?}", uit.plates[0].axes);
    let b = grond(&uit, 1);
    for n in &b.nodes {
        dichtbij(n.settlement_m, q / k, 1e-9, "zakking de grond in");
        let u = u_van(&uit, n.node_id);
        dichtbij(u[1], q / k, 1e-9, "u_y = q/k");
        assert!(u[0].abs() < 1e-12 && u[2].abs() < 1e-12, "{u:?}");
    }
    dichtbij(b.total_reaction_kn, q * 6.0, 1e-9, "ΣR = q·A");
    assert_eq!(b.lifted_fraction, 0.0);
    assert!(uit.reactions.is_empty(), "{:?}", uit.reactions);
    // De grondzijde volgt uit de assenafspraak: de melding noemt haar, en bij
    // alleen druk wat er misgaat als de grond aan de andere kant ligt.
    assert!(uit.diagnostics.iter().any(|m| m.contains("Plaat op bedding 1 staat verticaal") && m.contains("+Y-zijde")
        && m.contains("niet te kiezen") && m.contains("zonder alleen druk")), "{:?}", uit.diagnostics);
}

/// Twee vloeren naast elkaar met een gedeelde rand, elk op bedding met
/// dezelfde k: in de gedeelde knopen tellen de veren k·A_trib van beide platen
/// op, net als hun vlaklasten, dus zakt alles exact q/k (10⁻⁹), net als één
/// plaat. Elke plaat meldt haar eigen grond; samen q·(A₁ + A₂).
#[test]
fn twee_platen_op_bedding_met_een_gedeelde_rand() {
    let (k, q) = (15_000.0, 6.0);
    let mut nodes = Vec::new();
    let g = net(&gelijk(8, 8.0), &gelijk(4, 4.0), [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], &mut nodes);
    let mut elements = Vec::new();
    vierhoeken(&g, 1, |i, _| i >= 4, &mut elements);
    vierhoeken(&g, 2, |i, _| i < 4, &mut elements);
    let mut r = verzoek(nodes, E_BETON, vec![plaat(1, 0.2, k, false), plaat(2, 0.3, k, false)], elements);
    r.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -q]));
    r.surface_loads.push(vlaklast(2, 2, [0.0, 0.0, -q]));
    let uit = solve(r).unwrap_or_else(|fout| panic!("{fout}"));
    for plate_id in [1, 2] {
        let b = grond(&uit, plate_id);
        assert_eq!(b.nodes.len(), 25);
        for n in &b.nodes { dichtbij(n.settlement_m, q / k, 1e-9, "zakking = q/k"); }
        dichtbij(b.total_reaction_kn, q * 16.0, 1e-9, "ΣR per plaat");
    }
    assert!(in_knoop(grond(&uit, 1), g.id(4, 2)).active && in_knoop(grond(&uit, 2), g.id(4, 2)).active);
    assert_eq!(uit.plate_bedding.iter().map(|b| b.plate_id).collect::<Vec<_>>(), vec![1, 2]);
}

/// Een begane-grondvloer van 8 × 6 m op bedding met een wand van 3 m hoog op
/// de rand y = 6 m (de wand zonder bedding), zonder opleggingen, onder een
/// vloerlast q en een kolomlast P buiten het midden. Alle lasten staan
/// loodrecht op de vloer, dus de berekening houdt de vloer in haar vlak vast
/// en rekent; de vasthouding mag geen fout geven, ook al neemt zij de kleine
/// kracht op uit de kunstmatige draaistijfheid van de plaatelementen van de
/// externe kern (die hangt aan de absolute draaiing om de elementnormaal en
/// is dus niet starrelichaamsvrij: een buigende wand draait de vloerrand om
/// haar normaal). Vergeleken met hetzelfde model met een statisch bepaalde
/// oplegging in het vlak (X en Y in de ene hoek, Y in de andere): dezelfde
/// zakkingen op 10⁻⁶ van de grootste zakking (gemeten: zie de uitvoer), en in
/// beide ΣR_grond = q·A + P (10⁻⁹). Een horizontale last op de wandtop geeft
/// wel de fout.
#[test]
fn vloer_met_wand_zonder_opleggingen_onder_een_kolomlast() {
    let (k, q, p) = (20_000.0, 2.0, 200.0);
    let bouw = |horizontaal: f64, opgelegd: bool| {
        let mut nodes = Vec::new();
        let g = net(&gelijk(16, 8.0), &gelijk(12, 6.0), [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], &mut nodes);
        let mut elements = Vec::new();
        vierhoeken(&g, 1, |_, _| false, &mut elements);
        // De wand: rij 0 zijn de vloerknopen op y = 6, daarboven zes rijen van 0,5 m.
        let mut volgende = nodes.iter().map(|n| n.id).max().unwrap() + 1;
        let mut wand: Vec<Vec<usize>> = vec![(0..=16).map(|i| g.id(i, 12)).collect()];
        for j in 1..=6 {
            let mut rij = Vec::new();
            for i in 0..=16 {
                nodes.push(Node3D { id: volgende, x: 0.5 * i as f64, y: 6.0, z: 0.5 * j as f64 });
                rij.push(volgende);
                volgende += 1;
            }
            wand.push(rij);
        }
        for j in 0..6 {
            for i in 0..16 {
                let id = elements.len() + 1;
                elements.push(ShellElement3D {
                    id, plate_id: 2, node_ids: vec![wand[j][i], wand[j][i + 1], wand[j + 1][i + 1], wand[j + 1][i]],
                });
            }
        }
        let wandplaat = Plate3D { id: 2, material_id: 1, thickness_m: 0.2, bedding: None, orthotropy: None };
        let mut r = verzoek(nodes, E_BETON, vec![plaat(1, 0.25, k, false), wandplaat], elements);
        r.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -q]));
        r.nodal_loads.push(knooplast(1, g.id(13, 3), [0.0, 0.0, -p]));
        if horizontaal != 0.0 { r.nodal_loads.push(knooplast(2, wand[6][8], [horizontaal, 0.0, 0.0])); }
        if opgelegd {
            r.supports.push(steun(g.id(0, 0), [true, true, false, false, false, false]));
            r.supports.push(steun(g.id(16, 0), [false, true, false, false, false, false]));
        }
        r
    };
    let vrij = solve(bouw(0.0, false)).unwrap_or_else(|fout| panic!("{fout}"));
    assert!(vrij.diagnostics.iter().any(|m| m.contains("plaatvlak") && m.contains("vast")), "{:?}", vrij.diagnostics);
    assert!(vrij.reactions.is_empty(), "geen opleggingen: {:?}", vrij.reactions);
    let opgelegd = solve(bouw(0.0, true)).unwrap_or_else(|fout| panic!("{fout}"));
    assert!(!opgelegd.diagnostics.iter().any(|m| m.contains("plaatvlak") && m.contains("vast")), "{:?}", opgelegd.diagnostics);
    let (a, b) = (grond(&vrij, 1), grond(&opgelegd, 1));
    let schaal = b.max_settlement_m;
    let verschil = a.nodes.iter().map(|n| (n.settlement_m - in_knoop(b, n.node_id).settlement_m).abs()).fold(0.0, f64::max);
    println!("vloer met wand: grootste zakking {:.6e} m, verschil vrij tegen opgelegd {:.3e} m ({:.3e} relatief)",
        schaal, verschil, verschil / schaal);
    assert!(verschil <= 1e-6 * schaal, "vrij tegen opgelegd: {verschil:.3e} m bij {schaal:.3e} m");
    dichtbij(a.total_reaction_kn, q * 48.0 + p, 1e-9, "ΣR_grond vrij");
    dichtbij(b.total_reaction_kn, q * 48.0 + p, 1e-9, "ΣR_grond opgelegd");
    let rij: f64 = opgelegd.reactions.iter().map(|x| x.fx.abs() + x.fy.abs()).sum();
    println!("vloer met wand: oplegreacties in het vlak bij het opgelegde model Σ|R| = {rij:.3e} kN");
    // Een horizontale last op de wandtop: niets neemt haar op.
    let fout = solve(bouw(5.0, false)).unwrap_err();
    assert!(fout.contains("plaat 1") && fout.contains("plaatvlak") && fout.contains("oplegging") && fout.contains("kN"), "{fout}");
}

const X: V3 = [1.0, 0.0, 0.0];
const Y: V3 = [0.0, 1.0, 0.0];

fn melding_vlak(uit: &SolveResult3D) -> Option<&String> {
    uit.diagnostics.iter().find(|m| m.contains("plaatvlak") && m.contains("vast"))
}

/// ∫N_i dA van een vlakke vierhoek met 2 × 2 Gauss, onafhankelijk van de
/// adapter: det J = |∂x/∂ξ × ∂x/∂η|.
fn integraal_n(p: &[V3]) -> [f64; 4] {
    let g = 1.0 / 3f64.sqrt();
    let hoeken = [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)];
    let mut uit = [0.0; 4];
    for xi in [-g, g] {
        for eta in [-g, g] {
            let (mut a, mut b) = ([0.0; 3], [0.0; 3]);
            for (k, (s, t)) in hoeken.iter().enumerate() {
                for as_ in 0..3 {
                    a[as_] += s * (1.0 + t * eta) / 4.0 * p[k][as_];
                    b[as_] += t * (1.0 + s * xi) / 4.0 * p[k][as_];
                }
            }
            let c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
            let det = (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]).sqrt();
            for (k, (s, t)) in hoeken.iter().enumerate() { uit[k] += (1.0 + s * xi) * (1.0 + t * eta) / 4.0 * det; }
        }
    }
    uit
}

type PerKnoop = std::collections::BTreeMap<usize, f64>;

/// Per knoop Σ ∫N_i dA (consistent) en Σ A/4 (de vereenvoudiging die bij een
/// scheve vierhoek fout is), over de elementen van plaat `plate_id`.
fn oppervlakken(r: &SolveRequest3D, plate_id: usize) -> (PerKnoop, PerKnoop) {
    let punt: std::collections::BTreeMap<usize, V3> = r.nodes.iter().map(|n| (n.id, [n.x, n.y, n.z])).collect();
    let (mut consistent, mut kwart) = (PerKnoop::new(), PerKnoop::new());
    for e in r.shell_elements.iter().filter(|e| e.plate_id == plate_id) {
        let p: Vec<V3> = e.node_ids.iter().map(|id| punt[id]).collect();
        let w = integraal_n(&p);
        let a: f64 = w.iter().sum();
        for (id, wi) in e.node_ids.iter().zip(w) {
            *consistent.entry(*id).or_insert(0.0) += wi;
            *kwart.entry(*id).or_insert(0.0) += a / 4.0;
        }
    }
    (consistent, kwart)
}

/// (a') Niet-parallellogrammen: de app meshet elke niet-rechthoekige plaat in
/// scheve vierhoeken, waar ∫N_i dA niet A/4 is. Twee netten zonder één
/// parallellogram, zonder opleggingen, onder q:
/// 1. een trapeziumvormige plaat (onder 8 m, boven 4 m breed, 4 m hoog) met
///    trapeziumvormige elementen, A = 24 m²;
/// 2. een vierkant van 2 × 2 m in vier elementen met de middenknoop verschoven
///    naar (1,1; 0,93), A = 4 m².
/// De veren k·∫N_i dA en de consistente vlaklast q·∫N_i dA gebruiken dezelfde
/// gewichten, dus zakt elke knoop exact q/k, buigt niets en verschuift niets
/// in het vlak (10⁻⁹); ΣR = q·A. De proef onderscheidt: met A/4 voor de veren
/// zou de zakking per knoop afwijken zoals Σ A/4 van Σ∫N_i dA (geëist:
/// minstens 1 %; gemeten: zie de uitvoer).
#[test]
fn scheve_vierhoeken_zakken_gelijkmatig_onder_een_gelijkmatige_last() {
    let (k, q, t) = (20_000.0, 10.0, 0.25);
    // 1. Trapezium: rij j op y = j, van x = j/2 tot 8 − j/2; elk element een trapezium.
    let (nx, ny) = (8usize, 4usize);
    let id = |i: usize, j: usize| 1 + j * (nx + 1) + i;
    let mut trapezium = Vec::new();
    for j in 0..=ny {
        let (links, rechts) = (0.5 * j as f64, 8.0 - 0.5 * j as f64);
        for i in 0..=nx {
            trapezium.push(Node3D { id: id(i, j), x: links + (rechts - links) * i as f64 / nx as f64, y: j as f64, z: 0.0 });
        }
    }
    let mut elementen_t = Vec::new();
    for j in 0..ny {
        for i in 0..nx {
            elementen_t.push(ShellElement3D { id: elementen_t.len() + 1, plate_id: 1,
                node_ids: vec![id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)] });
        }
    }
    // 2. Vier elementen rond een verschoven middenknoop 5.
    let vierkant: Vec<Node3D> = [(0.0, 0.0), (1.0, 0.0), (2.0, 0.0), (0.0, 1.0), (1.1, 0.93), (2.0, 1.0), (0.0, 2.0), (1.0, 2.0), (2.0, 2.0)]
        .iter().enumerate().map(|(i, (x, y))| Node3D { id: i + 1, x: *x, y: *y, z: 0.0 }).collect();
    let elementen_v: Vec<ShellElement3D> = [[1, 2, 5, 4], [2, 3, 6, 5], [4, 5, 8, 7], [5, 6, 9, 8]].iter().enumerate()
        .map(|(i, ids)| ShellElement3D { id: i + 1, plate_id: 1, node_ids: ids.to_vec() }).collect();
    for (naam, nodes, elements, a) in [("trapezium", trapezium, elementen_t, 24.0), ("verschoven middenknoop", vierkant, elementen_v, 4.0)] {
        let mut r = verzoek(nodes, E_BETON, vec![plaat(1, t, k, false)], elements);
        r.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -q]));
        let punt: std::collections::BTreeMap<usize, V3> = r.nodes.iter().map(|n| (n.id, [n.x, n.y, n.z])).collect();
        for e in &r.shell_elements {
            let p: Vec<V3> = e.node_ids.iter().map(|id| punt[id]).collect();
            let d: f64 = (0..3).map(|as_| (p[0][as_] + p[2][as_] - p[1][as_] - p[3][as_]).powi(2)).sum::<f64>().sqrt();
            assert!(d > 1e-3, "{naam}: element {} is een parallellogram", e.id);
        }
        let (consistent, kwart) = oppervlakken(&r, 1);
        dichtbij(consistent.values().sum(), a, 1e-12, "Σ∫N_i dA = A");
        let verschil = consistent.iter().map(|(id, w)| afwijking(kwart[id], *w)).fold(0.0, f64::max);
        assert!(verschil > 0.01, "{naam}: Σ A/4 wijkt hooguit {verschil:.3e} af van Σ∫N_i dA, de proef onderscheidt niets");
        let uit = solve(r).unwrap_or_else(|fout| panic!("{naam}: {fout}"));
        let b = grond(&uit, 1);
        let mut grootste: f64 = 0.0;
        for n in &b.nodes {
            grootste = grootste.max(afwijking(n.settlement_m, q / k));
            dichtbij(n.settlement_m, q / k, 1e-9, "zakking = q/k");
            let u = u_van(&uit, n.node_id);
            assert!(u[0].abs() < 1e-12 && u[1].abs() < 1e-12, "{naam}: geen verschuiving in het vlak: {u:?}");
        }
        let grootste_m = uit.shell_nodes.iter()
            .map(|n| n.values.mxx_knm_per_m.abs().max(n.values.myy_knm_per_m.abs()).max(n.values.mxy_knm_per_m.abs()))
            .fold(0.0, f64::max);
        assert!(grootste_m < 1e-9 * q * a, "{naam}: momenten ≈ 0, grootste {grootste_m:.3e} kNm/m");
        dichtbij(b.total_reaction_kn, q * a, 1e-9, "ΣR = q·A");
        println!("(a') {naam}: Σ A/4 wijkt tot {:.1} % af van Σ∫N_i dA; zakking op {grootste:.1e} van q/k, grootste moment {grootste_m:.1e} kNm/m, ΣR {:.9} kN",
            100.0 * verschil, b.total_reaction_kn);
    }
}

/// Grondzijde van een wand: de assenafspraak legt haar vast, los van de
/// knoopvolgorde. Een wand in het XZ-vlak heeft de grond aan +Y, een wand in
/// het YZ-vlak aan −X; de melding noemt die zijde (zonder de waarschuwing voor
/// alleen druk als die uit staat). Een vlaklast de grond in geeft in beide
/// knoopvolgordes exact q/k (10⁻⁹). Een vloer krijgt geen wandmelding.
#[test]
fn wand_op_bedding_noemt_de_grondzijde() {
    let (k, q) = (20_000.0, 6.0);
    for (vlak, o, u, zijde, as_, teken) in [("XZ", [0.0, 4.0, 0.0], X, "+Y", 1usize, 1.0), ("YZ", [5.0, 0.0, 0.0], Y, "−X", 0usize, -1.0)] {
        for omgekeerd in [false, true] {
            let mut nodes = Vec::new();
            let g = net(&gelijk(6, 3.0), &gelijk(4, 2.0), o, u, [0.0, 0.0, 1.0], &mut nodes);
            let mut elements = Vec::new();
            vierhoeken(&g, 1, |_, _| false, &mut elements);
            if omgekeerd { for e in &mut elements { e.node_ids.reverse(); } }
            let mut r = verzoek(nodes, E_BETON, vec![plaat(1, 0.25, k, false)], elements);
            let mut last = [0.0; 3];
            last[as_] = teken * q;
            r.surface_loads.push(vlaklast(1, 1, last));
            let uit = solve(r).unwrap_or_else(|fout| panic!("{vlak}: {fout}"));
            for n in &grond(&uit, 1).nodes { dichtbij(n.settlement_m, q / k, 1e-9, "zakking de grond in"); }
            let melding = uit.diagnostics.iter().find(|m| m.contains("staat verticaal"))
                .unwrap_or_else(|| panic!("{vlak}: geen wandmelding in {:?}", uit.diagnostics));
            assert!(melding.contains(&format!("aan de {zijde}-zijde")) && melding.contains("niet te kiezen")
                && melding.contains("van teken omgekeerd") && !melding.contains("zonder alleen druk"),
                "{vlak}, omgekeerd {omgekeerd}: {melding}");
        }
    }
    let mut nodes = Vec::new();
    let g = net(&gelijk(2, 2.0), &gelijk(2, 2.0), [0.0; 3], X, Y, &mut nodes);
    let mut elements = Vec::new();
    vierhoeken(&g, 1, |_, _| false, &mut elements);
    let mut r = verzoek(nodes, E_BETON, vec![plaat(1, 0.2, k, false)], elements);
    r.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -q]));
    let uit = solve(r).unwrap_or_else(|fout| panic!("{fout}"));
    assert!(!uit.diagnostics.iter().any(|m| m.contains("staat verticaal")), "{:?}", uit.diagnostics);
}

/// Eén vloer van 6 × 4 m (net 0,5 m) op bedding met vier kolommen van 3 m en
/// dakliggers (alles één star deel), zonder opleggingen, onder q en een
/// verticale last P op elke kolomtop. Hulp voor de proeven met een starre
/// schijf; geeft het verzoek, de vier dakknopen en het net.
fn vloer_met_kolommen(k: f64, q: f64, p: f64) -> (SolveRequest3D, Vec<usize>, Net) {
    let mut nodes = Vec::new();
    let g = net(&gelijk(12, 6.0), &gelijk(8, 4.0), [0.0; 3], X, Y, &mut nodes);
    let mut elements = Vec::new();
    vierhoeken(&g, 1, |_, _| false, &mut elements);
    let mut r = verzoek(nodes, E_BETON, vec![plaat(1, 0.2, k, false)], elements);
    r.sections.push(doorsnede(1, 0.01, 1e-4, 1e-4, 1e-6));
    r.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -q]));
    let mut volgende = r.nodes.iter().map(|n| n.id).max().unwrap() + 1;
    let mut top = Vec::new();
    for (i, j) in [(0, 0), (12, 0), (12, 8), (0, 8)] {
        r.nodes.push(Node3D { id: volgende, x: 0.5 * i as f64, y: 0.5 * j as f64, z: 3.0 });
        r.members.push(staaf(r.members.len() + 1, g.id(i, j), volgende, 1));
        r.nodal_loads.push(knooplast(r.nodal_loads.len() + 1, volgende, [0.0, 0.0, -p]));
        top.push(volgende);
        volgende += 1;
    }
    for i in 0..4 { r.members.push(staaf(r.members.len() + 1, top[i], top[(i + 1) % 4], 1)); }
    (r, top, g)
}

/// Een starre schijf op de dakknopen van een vloer op bedding met kolommen en
/// dakliggers, zonder opleggingen. Een schijf koppelt alleen knopen onderling:
/// bij een starre beweging van het geheel houdt zij niets tegen, dus
/// verschuift de vloer in haar vlak net zo vrij als zonder schijf. De
/// berekening houdt haar vast met drie veren (statisch bepaald, niet meer) en
/// rekent onder verticale lasten: ΣR_grond = q·A + 4·P (10⁻⁹), evenwicht. Een
/// horizontale last op het dak neemt niets op: een duidelijke fout. Met een
/// oplegging in het vlak geen vasthouding, en de oplegging neemt de last.
#[test]
fn vloer_op_bedding_met_een_schijf_op_het_dak() {
    let (k, q, p) = (30_000.0, 5.0, 20.0);
    let met_schijf = |horizontaal: f64, opgelegd: bool| {
        let (mut r, top, g) = vloer_met_kolommen(k, q, p);
        r.diaphragms.push(Diaphragm3D { id: 1, node_ids: top.clone() });
        if horizontaal != 0.0 { r.nodal_loads.push(knooplast(9, top[0], [horizontaal, 0.0, 0.0])); }
        if opgelegd {
            r.supports.push(steun(g.id(0, 0), [true, true, false, false, false, false]));
            r.supports.push(steun(g.id(12, 0), [false, true, false, false, false, false]));
        }
        solve(r)
    };
    let uit = met_schijf(0.0, false).unwrap_or_else(|fout| panic!("{fout}"));
    dichtbij(grond(&uit, 1).total_reaction_kn, q * 24.0 + 4.0 * p, 1e-9, "ΣR_grond = q·A + 4·P");
    assert!(uit.reactions.is_empty(), "{:?}", uit.reactions);
    assert!(uit.equilibrium.as_ref().is_some_and(|e| e.equilibrium_ok && e.residual_ok), "{:?}", uit.equilibrium);
    let melding = melding_vlak(&uit).unwrap_or_else(|| panic!("melding over de vasthouding: {:?}", uit.diagnostics));
    assert!(melding.contains("plaat 1") && melding.contains("3 richting(en)"), "drie veren, statisch bepaald: {melding}");
    // Dezelfde vloer zonder schijf rekent ook (zo was het al).
    let (zonder, _, _) = vloer_met_kolommen(k, q, p);
    let zonder = solve(zonder).unwrap_or_else(|fout| panic!("{fout}"));
    dichtbij(grond(&zonder, 1).total_reaction_kn, q * 24.0 + 4.0 * p, 1e-9, "ΣR_grond zonder schijf");
    // Horizontaal op het dak: niets neemt het op.
    let fout = met_schijf(5.0, false).unwrap_err();
    assert!(fout.contains("plaat 1") && fout.contains("plaatvlak") && fout.contains("oplegging"), "{fout}");
    // Met een oplegging in het vlak: geen vasthouding, en de last gaat naar de opleggingen.
    let uit = met_schijf(5.0, true).unwrap_or_else(|fout| panic!("{fout}"));
    assert!(melding_vlak(&uit).is_none(), "{:?}", uit.diagnostics);
    dichtbij(uit.reactions.iter().map(|x| x.fx).sum::<f64>(), -5.0, 1e-9, "ΣR_x = −5 kN");
    dichtbij(grond(&uit, 1).total_reaction_kn, q * 24.0 + 4.0 * p, 1e-9, "ΣR_grond met opleggingen");
}

/// Twee losse vloeren op bedding (geen gedeelde knoop, 1 m uit elkaar), alleen
/// via een starre schijf in hun vlak gekoppeld, zonder opleggingen. Samen
/// hebben ze drie vrije bewegingen in het vlak, dus drie vasthoudingen, niet
/// zes: met zes zou de vasthouding overbodig zijn en een vervorming in het
/// vlak tegenhouden. Onder q zakt alles q/k en draagt elke vloer q·A_i (10⁻⁹).
#[test]
fn twee_vloeren_via_een_schijf_krijgen_samen_drie_vasthoudingen() {
    let (k, q) = (20_000.0, 8.0);
    let mut nodes = Vec::new();
    let a = net(&gelijk(4, 2.0), &gelijk(4, 2.0), [0.0; 3], X, Y, &mut nodes);
    let b = net(&gelijk(4, 2.0), &gelijk(4, 2.0), [3.0, 0.0, 0.0], X, Y, &mut nodes);
    let mut elements = Vec::new();
    vierhoeken(&a, 1, |_, _| false, &mut elements);
    vierhoeken(&b, 2, |_, _| false, &mut elements);
    let mut r = verzoek(nodes, E_BETON, vec![plaat(1, 0.2, k, false), plaat(2, 0.2, k, false)], elements);
    r.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -q]));
    r.surface_loads.push(vlaklast(2, 2, [0.0, 0.0, -q]));
    r.diaphragms.push(Diaphragm3D { id: 1, node_ids: vec![a.id(4, 0), a.id(4, 4), b.id(0, 0), b.id(0, 4)] });
    let uit = solve(r).unwrap_or_else(|fout| panic!("{fout}"));
    for plate_id in [1, 2] {
        let g = grond(&uit, plate_id);
        for n in &g.nodes { dichtbij(n.settlement_m, q / k, 1e-9, "zakking = q/k"); }
        dichtbij(g.total_reaction_kn, q * 4.0, 1e-9, "ΣR per vloer");
    }
    let melding = melding_vlak(&uit).unwrap_or_else(|| panic!("{:?}", uit.diagnostics));
    assert!(melding.contains("3 richting(en)"), "drie veren voor twee gekoppelde vloeren: {melding}");
}

/// Een vloer op bedding en een losse slingerkolom (voet scharnierend
/// opgelegd) waarvan de top alleen via een starre schijf aan de vloer hangt,
/// zonder opleggingen in het vlak. Geen starre beweging van het geheel is vrij
/// (de kolomvoet staat vast), maar wel de schijfbeweging waarbij de vloer in
/// haar vlak verschuift en draait en de kolom meezwaait; die houdt de
/// berekening vast (drie veren). Verticaal rekent het: de vloer draagt q·A en
/// de kolomvoet P (10⁻⁹). Een horizontale last op de kolomtop neemt niets op:
/// een duidelijke fout.
#[test]
fn slingerkolom_via_een_schijf_aan_een_vloer_op_bedding() {
    let (k, q, p) = (20_000.0, 5.0, 40.0);
    let maak = |horizontaal: f64| {
        let mut nodes = Vec::new();
        let g = net(&gelijk(8, 4.0), &gelijk(8, 4.0), [0.0; 3], X, Y, &mut nodes);
        let mut elements = Vec::new();
        vierhoeken(&g, 1, |_, _| false, &mut elements);
        let mut r = verzoek(nodes, E_BETON, vec![plaat(1, 0.2, k, false)], elements);
        r.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -q]));
        r.sections.push(doorsnede(1, 0.01, 1e-4, 1e-4, 1e-6));
        let voet = r.nodes.iter().map(|n| n.id).max().unwrap() + 1;
        let top = voet + 1;
        r.nodes.push(Node3D { id: voet, x: 6.0, y: 2.0, z: -3.0 });
        r.nodes.push(Node3D { id: top, x: 6.0, y: 2.0, z: 0.0 });
        r.members.push(staaf(1, voet, top, 1));
        r.supports.push(steun(voet, [true, true, true, false, false, false]));
        r.nodal_loads.push(knooplast(1, top, [horizontaal, 0.0, -p]));
        r.diaphragms.push(Diaphragm3D { id: 1, node_ids: vec![g.id(8, 4), g.id(0, 0), g.id(0, 8), top] });
        (r, voet)
    };
    let (r, voet) = maak(0.0);
    let uit = solve(r).unwrap_or_else(|fout| panic!("{fout}"));
    dichtbij(grond(&uit, 1).total_reaction_kn, q * 16.0, 1e-9, "ΣR_grond = q·A");
    let rz: f64 = uit.reactions.iter().filter(|x| x.node_id == voet).map(|x| x.fz).sum();
    dichtbij(rz, p, 1e-9, "de kolomvoet draagt P");
    let melding = melding_vlak(&uit).unwrap_or_else(|| panic!("{:?}", uit.diagnostics));
    assert!(melding.contains("3 richting(en)"), "{melding}");
    let (r, _) = maak(3.0);
    let fout = solve(r).unwrap_err();
    assert!(fout.contains("plaat 1") && fout.contains("plaatvlak"), "{fout}");
}

/// Wat de vasthouding niet ziet, blijft een mechanisme: een liggende staaf die
/// met één eind in de schijf van een vloer op bedding hangt en verder nergens
/// aan, kan bij stilstaande schijf vallen en kantelen. De vloer telt als
/// vastgehouden; de melding noemt de staaf en niet de plaat.
#[test]
fn een_deel_dat_aan_de_schijf_zwaait_blijft_een_mechanisme() {
    let mut nodes = Vec::new();
    let g = net(&gelijk(4, 2.0), &gelijk(4, 2.0), [0.0; 3], X, Y, &mut nodes);
    let mut elements = Vec::new();
    vierhoeken(&g, 1, |_, _| false, &mut elements);
    let mut r = verzoek(nodes, E_BETON, vec![plaat(1, 0.2, 20_000.0, false)], elements);
    r.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -5.0]));
    r.sections.push(doorsnede(1, 0.01, 1e-4, 1e-4, 1e-6));
    let begin = r.nodes.iter().map(|n| n.id).max().unwrap() + 1;
    r.nodes.push(Node3D { id: begin, x: 3.0, y: 1.0, z: 0.0 });
    r.nodes.push(Node3D { id: begin + 1, x: 5.0, y: 1.0, z: 0.0 });
    r.members.push(staaf(1, begin, begin + 1, 1));
    r.nodal_loads.push(knooplast(1, begin + 1, [0.0, 0.0, -1.0]));
    r.diaphragms.push(Diaphragm3D { id: 1, node_ids: vec![g.id(4, 2), g.id(0, 0), g.id(0, 4), begin] });
    let fout = solve(r).unwrap_err();
    assert!(fout.contains("mechanisme") && fout.contains("staaf 1") && fout.contains("schijf 1"), "{fout}");
    assert!(!fout.contains("plaat 1"), "de vloer zelf is vastgehouden: {fout}");
}

/// Eén plaat-id met twee losse stroken (mogelijk via vrije shellElements; de
/// app meshet een plaat altijd samenhangend). Elk eiland is een eigen star
/// deel met eigen steunpunten en een eigen vasthouding in het vlak (drie veren
/// per eiland). Onder q zakt alles q/k en ΣR = q·(A₁ + A₂) (10⁻⁹), net als
/// met dezelfde stroken als twee platen.
#[test]
fn een_plaat_met_losse_eilanden_op_bedding() {
    let (k, q) = (30_000.0, 10.0);
    for apart in [false, true] {
        let mut nodes = Vec::new();
        let g = net(&gelijk(8, 4.0), &gelijk(2, 1.0), [0.0; 3], X, Y, &mut nodes);
        let mut elements = Vec::new();
        vierhoeken(&g, 1, |i, _| i >= 3, &mut elements);
        vierhoeken(&g, if apart { 2 } else { 1 }, |i, _| i < 5, &mut elements);
        let mut plates = vec![plaat(1, 0.2, k, false)];
        if apart { plates.push(plaat(2, 0.2, k, false)); }
        let mut r = verzoek(nodes, E_BETON, plates, elements);
        r.surface_loads.push(vlaklast(1, 1, [0.0, 0.0, -q]));
        if apart { r.surface_loads.push(vlaklast(2, 2, [0.0, 0.0, -q])); }
        let uit = solve(r).unwrap_or_else(|fout| panic!("apart {apart}: {fout}"));
        let totaal: f64 = uit.plate_bedding.iter().map(|b| b.total_reaction_kn).sum();
        dichtbij(totaal, q * 3.0, 1e-9, "ΣR = q·(A₁ + A₂)");
        for b in &uit.plate_bedding { for n in &b.nodes { dichtbij(n.settlement_m, q / k, 1e-9, "zakking = q/k"); } }
        let melding = melding_vlak(&uit).unwrap_or_else(|| panic!("{:?}", uit.diagnostics));
        assert!(melding.contains("6 richting(en)"), "drie veren per eiland: {melding}");
    }
}
