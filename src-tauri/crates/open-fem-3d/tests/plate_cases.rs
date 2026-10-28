//! Analytische verificatie van platen (schaalelementen) in de 3D-adapter.
//!
//! Referenties (Kirchhoff-plaattheorie, ν = 0,3 tenzij anders vermeld):
//! * vrij opgelegde vierkante plaat onder q: w_mid = 0,00406·q·a⁴/D,
//!   m_mid = 0,0479·q·a² (Timoshenko & Woinowsky-Krieger, tabel 8);
//! * rondom ingeklemde vierkante plaat: w_mid = 0,00126·q·a⁴/D,
//!   inklemmoment midden rand = −0,0513·q·a² (idem, tabel 35);
//! * uitkragende strook met ν = 0 is exact een balk: w = q·L⁴/(8EI);
//! * wandschijf in het vlak: Timoshenko-balk δ = P·L³/(3EI) + P·L/(κ·G·A).
//!
//! D = E·t³/(12(1−ν²)). De momenten volgen het contract: positief = trek aan
//! de onderzijde (−z-zijde van de plaatassen).

use open_fem_3d::{
    solve, AnalysisKind, Bedding3D, Material3D, Member3D, NodalLoad3D, Node3D, Plate3D, Section3D,
    ShellElement3D, ShellNodeResult3D, SolveRequest3D, SolveResult3D, Support3D, SurfaceLoad3D,
};

type V3 = [f64; 3];

struct Grid {
    nx: usize,
    ny: usize,
    first_id: usize,
}

impl Grid {
    fn id(&self, i: usize, j: usize) -> usize { self.first_id + j * (self.nx + 1) + i }
}

/// Rechthoekig net in een willekeurig vlak: knoop (i, j) = o + i/nx·a·u + j/ny·b·v.
fn grid(nx: usize, ny: usize, origin: V3, u: V3, v: V3, a: f64, b: f64, nodes: &mut Vec<Node3D>) -> Grid {
    let first_id = nodes.iter().map(|n| n.id).max().unwrap_or(0) + 1;
    let grid = Grid { nx, ny, first_id };
    for j in 0..=ny {
        for i in 0..=nx {
            let s = a * i as f64 / nx as f64;
            let r = b * j as f64 / ny as f64;
            nodes.push(Node3D {
                id: grid.id(i, j),
                x: origin[0] + s * u[0] + r * v[0],
                y: origin[1] + s * u[1] + r * v[1],
                z: origin[2] + s * u[2] + r * v[2],
            });
        }
    }
    grid
}

fn quads(grid: &Grid, plate_id: usize, first_element: usize) -> Vec<ShellElement3D> {
    let mut out = Vec::new();
    for j in 0..grid.ny {
        for i in 0..grid.nx {
            out.push(ShellElement3D {
                id: first_element + out.len(),
                plate_id,
                node_ids: vec![grid.id(i, j), grid.id(i + 1, j), grid.id(i + 1, j + 1), grid.id(i, j + 1)],
            });
        }
    }
    out
}

fn triangles(grid: &Grid, plate_id: usize) -> Vec<ShellElement3D> {
    let mut out = Vec::new();
    for j in 0..grid.ny {
        for i in 0..grid.nx {
            let (a, b, c, d) = (grid.id(i, j), grid.id(i + 1, j), grid.id(i + 1, j + 1), grid.id(i, j + 1));
            // Wisselende diagonaal: symmetrisch net.
            let pair = if (i + j) % 2 == 0 { [[a, b, c], [a, c, d]] } else { [[a, b, d], [b, c, d]] };
            for tri in pair {
                out.push(ShellElement3D { id: out.len() + 1, plate_id, node_ids: tri.to_vec() });
            }
        }
    }
    out
}

fn request(nodes: Vec<Node3D>, e_mpa: f64, nu: f64, thickness: f64, elements: Vec<ShellElement3D>) -> SolveRequest3D {
    SolveRequest3D {
        schema_version: 2,
        analysis: AnalysisKind::Linear,
        nodes,
        materials: vec![Material3D { id: 1, name: "plaat".into(), e_mpa, nu, g_mpa: None, alpha_per_k: None }],
        sections: vec![],
        members: vec![],
        supports: vec![],
        nodal_loads: vec![],
        member_loads: vec![],
        member_point_loads: vec![],
        thermal_loads: vec![],
        plates: vec![Plate3D { id: 1, material_id: 1, thickness_m: thickness, bedding: None, orthotropy: None }],
        shell_elements: elements,
        surface_loads: vec![],
        diaphragms: vec![], node_links: vec![],
        tension_only_fit: None, tension_only_cross_rule: false,
        max_iterations: 50,
        tolerance: 1e-10,
        buckling_modes: 0,
    }
}

fn support(node_id: usize, fixed: [bool; 6]) -> Support3D {
    Support3D {
        node_id, ux: fixed[0], uy: fixed[1], uz: fixed[2], rx: fixed[3], ry: fixed[4], rz: fixed[5],
        ..Default::default()
    }
}

/// Voeg vrijheidsgraden samen als een knoop meer dan één randvoorwaarde krijgt.
fn add_support(supports: &mut Vec<Support3D>, node_id: usize, fixed: [bool; 6]) {
    if let Some(existing) = supports.iter_mut().find(|s| s.node_id == node_id) {
        existing.ux |= fixed[0]; existing.uy |= fixed[1]; existing.uz |= fixed[2];
        existing.rx |= fixed[3]; existing.ry |= fixed[4]; existing.rz |= fixed[5];
    } else {
        supports.push(support(node_id, fixed));
    }
}

fn node_result<'a>(result: &'a SolveResult3D, node_id: usize) -> &'a ShellNodeResult3D {
    result.shell_nodes.iter().find(|r| r.node_id == node_id).expect("knoopresultaat")
}

fn uz(result: &SolveResult3D, node_id: usize) -> f64 {
    result.displacements.iter().find(|d| d.node_id == node_id).unwrap().uz
}

fn relative(actual: f64, expected: f64) -> f64 { (actual - expected).abs() / expected.abs() }

/// Vierkante horizontale plaat a×a op z = 0 met randvoorwaarde per rand.
fn square_plate(n: usize, a: f64, thickness: f64, q: f64, clamped: bool) -> (SolveResult3D, Grid) {
    let mut nodes = Vec::new();
    let g = grid(n, n, [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], a, a, &mut nodes);
    let mut input = request(nodes, 30_000.0, 0.3, thickness, quads(&g, 1, 1));
    let mut supports = Vec::new();
    for k in 0..=n {
        // Rand x = 0 en x = a (evenwijdig aan y): w = 0; "hard" vrij opgelegd
        // houdt ook de draaiing om de randnormaal (rx) vast, zoals bij Kirchhoff.
        for (i, j) in [(0, k), (n, k)] {
            add_support(&mut supports, g.id(i, j), [false, false, true, true, clamped, false]);
        }
        for (i, j) in [(k, 0), (k, n)] {
            add_support(&mut supports, g.id(i, j), [false, false, true, clamped, true, false]);
        }
    }
    // In het vlak: star-lichaamsvormen vastzetten zonder de buiging te raken.
    add_support(&mut supports, g.id(0, 0), [true, true, false, false, false, false]);
    add_support(&mut supports, g.id(n, 0), [false, true, false, false, false, false]);
    input.supports = supports;
    input.surface_loads.push(SurfaceLoad3D { id: 1, plate_id: 1, qx_kn_per_m2: 0.0, qy_kn_per_m2: 0.0, qz_kn_per_m2: -q });
    (solve(input).expect("plaat rekent"), g)
}

fn plate_rigidity(e_mpa: f64, nu: f64, t: f64) -> f64 { e_mpa * 1000.0 * t.powi(3) / (12.0 * (1.0 - nu * nu)) }

#[test]
fn simply_supported_square_plate_converges_to_kirchhoff() {
    let (a, t, q): (f64, f64, f64) = (6.0, 0.06, 10.0);
    let (e_mpa, nu) = (30_000.0, 0.3);
    let d = plate_rigidity(e_mpa, nu, t);
    let w_exact = 0.00406 * q * a.powi(4) / d;
    let m_exact = 0.0479 * q * a * a;
    // MITC4 is een Mindlin-element: bij een vrij opgelegde plaat komt daar de
    // afschuifvervorming M/(κGt) bij, met M = (mx+my)/(1+ν) het Marcus-moment
    // (Mindlin–Kirchhoff-relatie voor vrij opgelegde veelhoekige platen).
    let shear_rigidity = 5.0 / 6.0 * e_mpa * 1000.0 / (2.0 * (1.0 + nu)) * t;
    let w_mindlin = w_exact + 2.0 * m_exact / (1.0 + nu) / shear_rigidity;
    let mut previous_error = f64::INFINITY;
    for n in [4, 8, 16, 24] {
        let (result, g) = square_plate(n, a, t, q, false);
        let centre = g.id(n / 2, n / 2);
        let w = -uz(&result, centre);
        let m = node_result(&result, centre);
        let error_w = relative(w, w_exact);
        let error_m = relative(m.values.mxx_knm_per_m, m_exact);
        let error_mindlin = relative(w, w_mindlin);
        println!(
            "vrij opgelegd MITC4 {n:>2}×{n:<2}: w = {:.4} mm (Kirchhoff {:.4}: {:+.2} %; met afschuiving {:.4}: {:+.3} %), mxx = {:.3} kNm/m (exact {:.3}, {:+.2} %)",
            w * 1000.0, w_exact * 1000.0, 100.0 * (w - w_exact) / w_exact,
            w_mindlin * 1000.0, 100.0 * (w - w_mindlin) / w_mindlin,
            m.values.mxx_knm_per_m, m_exact, 100.0 * (m.values.mxx_knm_per_m - m_exact) / m_exact,
        );
        // Symmetrie: mxx = myy in het midden, mxy = 0.
        assert!((m.values.mxx_knm_per_m - m.values.myy_knm_per_m).abs() < 1e-6 * m_exact);
        assert!(m.values.mxy_knm_per_m.abs() < 1e-6 * m_exact);
        if n >= 16 {
            assert!(error_w < 0.02, "doorbuiging wijkt {:.2} % af bij {n}×{n}", 100.0 * error_w);
            assert!(error_m < 0.02, "veldmoment wijkt {:.2} % af bij {n}×{n}", 100.0 * error_m);
        }
        assert!(error_mindlin < previous_error, "de doorbuiging convergeert niet");
        previous_error = error_mindlin;
        // Evenwicht: Σ Rz = q·a².
        let reaction: f64 = result.reactions.iter().map(|r| r.fz).sum();
        assert!(relative(reaction, q * a * a) < 1e-9, "Σ Rz = {reaction}");
        let summary = &result.plates[0];
        assert!(relative(summary.area_m2, a * a) < 1e-12);
        assert!(relative(-summary.load_resultant_kn[2], q * a * a) < 1e-12);
    }
    assert!(previous_error < 0.002, "fijnste net wijkt {:.3} % af van de Mindlin-referentie", 100.0 * previous_error);
}

#[test]
fn clamped_square_plate_matches_kirchhoff_deflection_and_clamping_moment() {
    let (a, t, q): (f64, f64, f64) = (6.0, 0.06, 10.0);
    let d = plate_rigidity(30_000.0, 0.3, t);
    let w_exact = 0.00126 * q * a.powi(4) / d;
    let m_edge_exact = -0.0513 * q * a * a;
    let m_centre_exact = 0.0231 * q * a * a;
    for n in [8, 16, 24, 32] {
        let (result, g) = square_plate(n, a, t, q, true);
        let centre = g.id(n / 2, n / 2);
        let edge = g.id(0, n / 2);
        let w = -uz(&result, centre);
        let m_edge = node_result(&result, edge).values.mxx_knm_per_m;
        let m_centre = node_result(&result, centre).values.mxx_knm_per_m;
        println!(
            "ingeklemd MITC4 {n:>2}×{n:<2}: w = {:.4} mm ({:+.2} %), m_rand = {:.3} ({:+.2} %), m_midden = {:.3} ({:+.2} %)",
            w * 1000.0, 100.0 * (w - w_exact) / w_exact,
            m_edge, 100.0 * (m_edge - m_edge_exact) / m_edge_exact,
            m_centre, 100.0 * (m_centre - m_centre_exact) / m_centre_exact,
        );
        if n >= 24 {
            assert!(relative(w, w_exact) < 0.02);
            assert!(relative(m_edge, m_edge_exact) < 0.03, "inklemmoment {m_edge} tegen {m_edge_exact}");
            assert!(relative(m_centre, m_centre_exact) < 0.03);
        }
    }
}

#[test]
fn triangles_are_refused_with_a_reason() {
    // Het DKT-driehoekelement van de externe kern gaf in deze proef 7 % van
    // de analytische doorbuiging (zijn eigen tests eisen alleen "binnen een
    // factor 5"). De adapter biedt het daarom niet aan.
    let n = 4;
    let mut nodes = Vec::new();
    let g = grid(n, n, [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], 4.0, 4.0, &mut nodes);
    let mut input = request(nodes, 30_000.0, 0.3, 0.1, triangles(&g, 1));
    input.supports.push(support(g.id(0, 0), [true; 6]));
    let error = solve(input).unwrap_err();
    assert!(error.contains("vier knopen") && error.contains("MITC4"), "{error}");
}

#[test]
fn stresses_follow_moment_sign_top_and_bottom() {
    let (a, t, q): (f64, f64, f64) = (6.0, 0.06, 10.0);
    let n = 8;
    let (result, g) = square_plate(n, a, t, q, false);
    let centre = node_result(&result, g.id(n / 2, n / 2));
    let m = centre.values.mxx_knm_per_m;
    // Zonder membraankracht: σ = ∓6m/t² (MPa = kN/m²/1000).
    assert!(centre.values.nxx_kn_per_m.abs() < 1e-6);
    assert!((centre.values.sigma_xx_bottom_mpa - 6.0 * m / (t * t) / 1000.0).abs() < 1e-9);
    assert!((centre.values.sigma_xx_top_mpa + 6.0 * m / (t * t) / 1000.0).abs() < 1e-9);
    assert!(centre.values.sigma_xx_bottom_mpa > 0.0, "trek aan de onderzijde van een doorbuigende vloer");
}

#[test]
fn shear_force_near_edge_of_simply_supported_plate() {
    // Kirchhoff: dwarskracht midden van de rand q_x = 0,338·q·a (ν = 0,3).
    let (a, t, q): (f64, f64, f64) = (6.0, 0.06, 10.0);
    let n = 24;
    let (result, g) = square_plate(n, a, t, q, false);
    let edge = node_result(&result, g.id(0, n / 2)).values.vx_kn_per_m.unwrap();
    let exact = 0.338 * q * a;
    println!("dwarskracht rand midden: {edge:.3} kN/m, Kirchhoff 0,338·q·a = {exact:.3} kN/m");
    // Bij de linkerrand werkt de oplegreactie omhoog; v = ∫τ_xz dz op een
    // snede met normaal +x is daar dus negatief.
    assert!(edge < 0.0);
    assert!(relative(-edge, exact) < 0.1, "randdwarskracht {edge} tegen {exact}");
    // Globaal verticaal evenwicht van de randstrook: ∮ v ds ≈ q·a² (grof).
}

#[test]
fn vertical_plate_gives_the_same_results_in_plate_axes() {
    // Dezelfde vrij opgelegde plaat, nu in het XZ-vlak met de last in +Y
    // (tegengesteld aan de plaatnormaal z = −Y): identieke w en momenten.
    let (a, t, q, n) = (6.0, 0.06, 10.0, 8);
    let (flat, g_flat) = square_plate(n, a, t, q, false);
    let mut nodes = Vec::new();
    let g = grid(n, n, [0.0; 3], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0], a, a, &mut nodes);
    let mut input = request(nodes, 30_000.0, 0.3, t, quads(&g, 1, 1));
    let mut supports = Vec::new();
    for k in 0..=n {
        // Randen x = 0 en x = a: uy = 0 en draaiing om X (in-vlaks loodrecht op de rand).
        for (i, j) in [(0, k), (n, k)] {
            add_support(&mut supports, g.id(i, j), [false, true, false, true, false, false]);
        }
        // Randen z = 0 en z = a: uy = 0 en draaiing om Z.
        for (i, j) in [(k, 0), (k, n)] {
            add_support(&mut supports, g.id(i, j), [false, true, false, false, false, true]);
        }
    }
    add_support(&mut supports, g.id(0, 0), [true, false, true, false, false, false]);
    add_support(&mut supports, g.id(n, 0), [false, false, true, false, false, false]);
    input.supports = supports;
    input.surface_loads.push(SurfaceLoad3D { id: 1, plate_id: 1, qx_kn_per_m2: 0.0, qy_kn_per_m2: q, qz_kn_per_m2: 0.0 });
    let wall = solve(input).unwrap();
    let axes = &wall.plates[0].axes;
    assert!((axes.z[1] + 1.0).abs() < 1e-12 && (axes.y[2] - 1.0).abs() < 1e-12, "plaatassen {axes:?}");
    let centre_flat = node_result(&flat, g_flat.id(n / 2, n / 2));
    let centre_wall = node_result(&wall, g.id(n / 2, n / 2));
    assert!(relative(centre_wall.w_m, centre_flat.w_m) < 1e-9, "{} tegen {}", centre_wall.w_m, centre_flat.w_m);
    assert!(relative(centre_wall.values.mxx_knm_per_m, centre_flat.values.mxx_knm_per_m) < 1e-9);
    assert!(relative(centre_wall.values.myy_knm_per_m, centre_flat.values.myy_knm_per_m) < 1e-9);
}

#[test]
fn cantilever_strip_matches_beam_theory() {
    // ν = 0: geen anticlastische kromming, dus exact een balk (per breedte).
    let (length, width, t, q) = (4.0, 0.5, 0.1, 5.0);
    let e_mpa = 30_000.0;
    let (nx, ny) = (20, 2);
    let mut nodes = Vec::new();
    let g = grid(nx, ny, [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], length, width, &mut nodes);
    let mut input = request(nodes, e_mpa, 0.0, t, quads(&g, 1, 1));
    input.supports = (0..=ny).map(|j| support(g.id(0, j), [true; 6])).collect();
    input.surface_loads.push(SurfaceLoad3D { id: 1, plate_id: 1, qx_kn_per_m2: 0.0, qy_kn_per_m2: 0.0, qz_kn_per_m2: -q });
    let result = solve(input.clone()).unwrap();
    let inertia = width * t.powi(3) / 12.0;
    let e = e_mpa * 1000.0;
    let w_exact = q * width * length.powi(4) / (8.0 * e * inertia);
    let w_tip = -uz(&result, g.id(nx, 1));
    println!("uitkragende strook (q): w = {:.4} mm, balk {:.4} mm ({:+.2} %)",
        w_tip * 1000.0, w_exact * 1000.0, 100.0 * (w_tip - w_exact) / w_exact);
    assert!(relative(w_tip, w_exact) < 0.01);
    // Inklemmoment −q·L²/2 per breedte (trek boven → negatief). Het
    // elementmidden van de eerste elementrij ligt op h/2 van de inklemming.
    let h = length / nx as f64;
    let root = result.shell_elements.iter()
        .filter(|element| element.centroid_m[0] < h)
        .map(|element| element.values.mxx_knm_per_m)
        .sum::<f64>() / ny as f64;
    let m_exact = -q * (length - h / 2.0).powi(2) / 2.0;
    println!("  moment eerste elementrij {root:.4} kNm/m, exact {m_exact:.4}");
    assert!(relative(root, m_exact) < 0.01);

    // Puntlast op de vrije rand: w = P·L³/(3EI).
    let p = 2.0;
    let mut point = input;
    point.surface_loads.clear();
    point.nodal_loads = (0..=ny).map(|j| NodalLoad3D {
        id: j + 1, node_id: g.id(nx, j), fx: 0.0, fy: 0.0,
        fz: -p * if j == 0 || j == ny { 0.25 } else { 0.5 }, mx: 0.0, my: 0.0, mz: 0.0,
    }).collect();
    let point_result = solve(point).unwrap();
    let w_point = -uz(&point_result, g.id(nx, 1));
    let w_point_exact = p * length.powi(3) / (3.0 * e * inertia);
    println!("uitkragende strook (P): w = {:.4} mm, balk {:.4} mm ({:+.2} %)",
        w_point * 1000.0, w_point_exact * 1000.0, 100.0 * (w_point - w_point_exact) / w_point_exact);
    assert!(relative(w_point, w_point_exact) < 0.01);
}

#[test]
fn in_plane_wall_matches_timoshenko_beam() {
    // Uitkragende wandschijf in het XZ-vlak: lengte L, hoogte h, dikte t.
    // Einde vrij, belast met een verticale kracht P gelijkmatig over de knopen
    // van de vrije rand. Referentie: Timoshenko-balk met κ = 5/6.
    let (length, height, t, e_mpa, nu) = (6.0, 1.5, 0.2, 30_000.0, 0.2);
    let p = 100.0;
    let mut results = Vec::new();
    for (nx, ny) in [(16, 4), (32, 8), (64, 16)] {
        let mut nodes = Vec::new();
        let g = grid(nx, ny, [0.0; 3], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0], length, height, &mut nodes);
        let mut input = request(nodes, e_mpa, nu, t, quads(&g, 1, 1));
        let mut supports: Vec<Support3D> = (0..=ny).map(|j| support(g.id(0, j), [true; 6])).collect();
        // Buiging uit het vlak en draaiing om de plaatnormaal zijn hier niet
        // aan de orde; houd uy overal vast zodat de schijf in haar vlak blijft.
        for j in 0..=ny { for i in 1..=nx { add_support(&mut supports, g.id(i, j), [false, true, false, true, false, true]); } }
        input.supports = supports;
        input.nodal_loads = (0..=ny).map(|j| NodalLoad3D {
            id: j + 1, node_id: g.id(nx, j), fx: 0.0, fy: 0.0,
            fz: -p / ny as f64 * if j == 0 || j == ny { 0.5 } else { 1.0 },
            mx: 0.0, my: 0.0, mz: 0.0,
        }).collect();
        let result = solve(input).unwrap();
        let tip = -uz(&result, g.id(nx, ny / 2));
        results.push((nx, ny, tip));
    }
    let e = e_mpa * 1000.0;
    let g_mod = e / (2.0 * (1.0 + nu));
    let inertia = t * height.powi(3) / 12.0;
    let bending = p * length.powi(3) / (3.0 * e * inertia);
    let shear = p * length / (5.0 / 6.0 * g_mod * t * height);
    let exact = bending + shear;
    for (nx, ny, tip) in &results {
        println!(
            "wandschijf {nx}×{ny}: δ = {:.4} mm; Timoshenko {:.4} mm (buiging {:.4} + afschuiving {:.4}), {:+.2} %",
            tip * 1000.0, exact * 1000.0, bending * 1000.0, shear * 1000.0, 100.0 * (tip - exact) / exact,
        );
    }
    let finest = results.last().unwrap().2;
    // De volledig ingeklemde rand houdt ook de dwarscontractie tegen; dat
    // verstijft iets ten opzichte van de balktheorie.
    assert!(relative(finest, exact) < 0.02, "wandschijf {finest} tegen {exact}");
    assert!(finest > bending, "de afschuiving moet meetellen");
}

#[test]
fn plate_on_edge_beams_is_in_equilibrium_and_shares_nodes() {
    // Vloer 6×6 m op vier randliggers, liggers op vier hoekkolommen
    // (scharnierend opgelegd). De liggers lopen langs de plaatrand en worden
    // via tussenknopen aan de randknopen van het plaatnet gekoppeld.
    let (a, t, q, n) = (6.0, 0.2, 5.0, 12);
    let mut nodes = Vec::new();
    let g = grid(n, n, [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], a, a, &mut nodes);
    let mut input = request(nodes, 30_000.0, 0.2, t, quads(&g, 1, 1));
    input.sections.push(Section3D {
        id: 1, name: "300x600".into(), area_m2: 0.18, iy_m4: 0.3 * 0.6_f64.powi(3) / 12.0,
        iz_m4: 0.6 * 0.3_f64.powi(3) / 12.0, torsion_j_m4: 0.0037, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None,
    });
    let edges = [
        ((0, 0), (n, 0)), ((n, 0), (n, n)), ((n, n), (0, n)), ((0, n), (0, 0)),
    ];
    for (index, (start, end)) in edges.iter().enumerate() {
        let steps: Vec<(usize, usize)> = (1..n).map(|k| {
            let s = k as f64 / n as f64;
            let lerp = |p: usize, q: usize| (p as f64 + (q as f64 - p as f64) * s).round() as usize;
            (lerp(start.0, end.0), lerp(start.1, end.1))
        }).collect();
        input.members.push(Member3D {
            id: index + 1, start_node_id: g.id(start.0, start.1), end_node_id: g.id(end.0, end.1),
            material_id: 1, section_id: 1, releases: Default::default(), roll_angle_rad: None,
            intermediate_node_ids: steps.iter().map(|&(i, j)| g.id(i, j)).collect(), tension_only: false,
            bedding: None, part_section_ids: None,
        });
    }
    for (i, j) in [(0, 0), (n, 0), (n, n), (0, n)] {
        input.supports.push(support(g.id(i, j), [true, true, true, false, false, false]));
    }
    input.surface_loads.push(SurfaceLoad3D { id: 1, plate_id: 1, qx_kn_per_m2: 0.0, qy_kn_per_m2: 0.0, qz_kn_per_m2: -q });
    let result = solve(input).unwrap();
    let total = q * a * a;
    let reaction: f64 = result.reactions.iter().map(|r| r.fz).sum();
    println!("vloer op randliggers: Σ Rz = {reaction:.6} kN, q·A = {total:.6} kN");
    assert!(relative(reaction, total) < 1e-9);
    for r in &result.reactions {
        assert!(relative(r.fz, total / 4.0) < 1e-6, "hoekreactie {} tegen {}", r.fz, total / 4.0);
        // Momentevenwicht om de oorsprong van alle reacties + last volgt uit symmetrie.
    }
    let equilibrium = result.equilibrium.as_ref().unwrap();
    assert!(equilibrium.equilibrium_ok && equilibrium.residual_ok);
    // Elke ligger is één staaf in het resultaat, met een lijn over de hele lengte.
    assert_eq!(result.member_forces.len(), 4);
    for diagram in &result.diagrams.moment_y {
        assert!(diagram.points.first().unwrap().t.abs() < 1e-12);
        assert!((diagram.points.last().unwrap().t - 1.0).abs() < 1e-12);
    }
    // Plaat en ligger delen de randknopen: de ligger buigt mee met de plaat.
    let mid_edge = g.id(n / 2, 0);
    let middle = g.id(n / 2, n / 2);
    assert!(uz(&result, mid_edge) < 0.0 && uz(&result, middle) < uz(&result, mid_edge));
    // Globaal momentevenwicht om de oorsprong (alleen verticale krachten).
    let moment_x: f64 = result.reactions.iter().map(|r| {
        let node = g_node(&g, a, n, r.node_id);
        node[1] * r.fz
    }).sum::<f64>() - total * a / 2.0;
    assert!(moment_x.abs() < 1e-6 * total * a);
}

#[test]
fn plate_on_bedded_edge_beams_carries_the_load_into_the_ground() {
    // Vloer 6×6 m op vier funderingsbalken op bedding (#106), zonder
    // verticale opleggingen: de grond draagt alles. De balken hangen via
    // tussenknopen aan de plaatrand; die blijven rekenknopen van de bedding.
    // Horizontaal en om Z houden twee hoekknopen het geheel vast.
    let (a, t, q, n) = (6.0, 0.2, 5.0, 12);
    let mut nodes = Vec::new();
    let g = grid(n, n, [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], a, a, &mut nodes);
    let mut input = request(nodes, 30_000.0, 0.2, t, quads(&g, 1, 1));
    input.sections.push(Section3D {
        id: 1, name: "300x600".into(), area_m2: 0.18, iy_m4: 0.3 * 0.6_f64.powi(3) / 12.0,
        iz_m4: 0.6 * 0.3_f64.powi(3) / 12.0, torsion_j_m4: 0.0037, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None,
    });
    let edges = [((0, 0), (n, 0)), ((n, 0), (n, n)), ((n, n), (0, n)), ((0, n), (0, 0))];
    for (index, (start, end)) in edges.iter().enumerate() {
        let steps: Vec<(usize, usize)> = (1..n).map(|k| {
            let s = k as f64 / n as f64;
            let lerp = |p: usize, q: usize| (p as f64 + (q as f64 - p as f64) * s).round() as usize;
            (lerp(start.0, end.0), lerp(start.1, end.1))
        }).collect();
        input.members.push(Member3D {
            id: index + 1, start_node_id: g.id(start.0, start.1), end_node_id: g.id(end.0, end.1),
            material_id: 1, section_id: 1, releases: Default::default(), roll_angle_rad: None,
            intermediate_node_ids: steps.iter().map(|&(i, j)| g.id(i, j)).collect(), tension_only: false,
            bedding: Some(Bedding3D { k_kn_per_m3: Some(20_000.0), width_m: 0.6, k_lateral_kn_per_m3: None, compression_only: false }), part_section_ids: None,
        });
    }
    input.supports.push(support(g.id(0, 0), [true, true, false, false, false, false]));
    input.supports.push(support(g.id(n, 0), [false, true, false, false, false, false]));
    input.surface_loads.push(SurfaceLoad3D { id: 1, plate_id: 1, qx_kn_per_m2: 0.0, qy_kn_per_m2: 0.0, qz_kn_per_m2: -q });
    let result = solve(input).unwrap();
    let total = q * a * a;
    let grond: f64 = result.bedding.iter().map(|b| b.total_reaction_kn).sum();
    assert!(relative(grond, total) < 1e-9, "grond {grond} tegen q·A {total}");
    // Symmetrie: elke balk draagt een kwart.
    for b in &result.bedding {
        assert!(relative(b.total_reaction_kn, total / 4.0) < 1e-6, "balk {}: {}", b.member_id, b.total_reaction_kn);
    }
    let equilibrium = result.equilibrium.as_ref().unwrap();
    assert!(equilibrium.equilibrium_ok && equilibrium.residual_ok);
    // Alleen de modelknopen in de uitvoer; elke plaatrandknoop is een rekenknoop
    // van de bedding met zijn eigen zakking.
    assert_eq!(result.displacements.len(), (n + 1) * (n + 1));
    let balk = result.bedding.iter().find(|b| b.member_id == 1).unwrap();
    let midden = balk.points.iter().find(|p| (p.t - 0.5).abs() < 1e-12).expect("plaatknoop midden rand");
    assert!((midden.settlement_m + uz(&result, g.id(n / 2, 0))).abs() < 1e-15);
    // De vloer zakt in het midden meer dan de rand.
    assert!(uz(&result, g.id(n / 2, n / 2)) < uz(&result, g.id(n / 2, 0)));
}

fn g_node(g: &Grid, a: f64, n: usize, id: usize) -> V3 {
    let index = id - g.first_id;
    let (i, j) = (index % (n + 1), index / (n + 1));
    [a * i as f64 / n as f64, a * j as f64 / n as f64, 0.0]
}

#[test]
fn split_member_equals_unsplit_member() {
    // Een ligger met tussenknopen moet exact dezelfde uitkomst geven als de
    // ongeknipte ligger: dezelfde reacties, krachten en het veldmoment.
    let nodes = vec![
        Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 5.0, y: 0.0, z: 0.0 },
        Node3D { id: 3, x: 1.25, y: 0.0, z: 0.0 }, Node3D { id: 4, x: 2.5, y: 0.0, z: 0.0 },
        Node3D { id: 5, x: 4.0, y: 0.0, z: 0.0 },
    ];
    let mut base = SolveRequest3D {
        schema_version: 2, analysis: AnalysisKind::Linear, nodes,
        materials: vec![Material3D { id: 1, name: "staal".into(), e_mpa: 210_000.0, nu: 0.3, g_mpa: None, alpha_per_k: None }],
        sections: vec![Section3D { id: 1, name: "ref".into(), area_m2: 0.01, iy_m4: 8e-5, iz_m4: 1e-5,
            torsion_j_m4: 1e-6, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }],
        members: vec![Member3D { id: 7, start_node_id: 1, end_node_id: 2, material_id: 1, section_id: 1,
            releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: vec![], tension_only: false, bedding: None, part_section_ids: None }],
        supports: vec![
            support(1, [true, true, true, true, false, false]),
            support(2, [false, true, true, false, false, false]),
        ],
        nodal_loads: vec![], member_loads: vec![open_fem_3d::MemberLoad3D {
            id: 1, member_id: 7, qy_start_kn_per_m: 0.0, qy_end_kn_per_m: 0.0,
            qz_start_kn_per_m: -4.0, qz_end_kn_per_m: -10.0, start_position_m: Some(0.5), end_position_m: Some(4.5),
            ..Default::default()
        }],
        member_point_loads: vec![open_fem_3d::MemberPointLoad3D { id: 1, member_id: 7, py_kn: 0.0, pz_kn: -12.0, position_m: 2.5 }],
        thermal_loads: vec![], plates: vec![], shell_elements: vec![], surface_loads: vec![], diaphragms: vec![], node_links: vec![], tension_only_fit: None, tension_only_cross_rule: false,
        max_iterations: 50, tolerance: 1e-10, buckling_modes: 0,
    };
    // De tussenknopen hangen in het ongeknipte geval nergens aan; geef ze een
    // volledige oplegging zodat de kern ze kan dragen zonder de ligger te raken.
    for id in [3, 4, 5] { base.supports.push(support(id, [true; 6])); }
    let whole = solve(base.clone()).unwrap();
    let mut split = base;
    split.supports.retain(|s| ![3, 4, 5].contains(&s.node_id));
    split.members[0].intermediate_node_ids = vec![5, 3, 4];
    let parts_request = split.clone();
    let parts = solve(split).unwrap();
    let reaction = |r: &SolveResult3D, id: usize| r.reactions.iter().find(|x| x.node_id == id).unwrap().fz;
    assert!(relative(reaction(&parts, 1), reaction(&whole, 1)) < 1e-9);
    assert!(relative(reaction(&parts, 2), reaction(&whole, 2)) < 1e-9);
    assert_eq!(parts.member_forces.len(), 1);
    assert_eq!(parts.member_forces[0].member_id, 7);
    let max_moment = |r: &SolveResult3D| r.diagrams.moment_y.iter().find(|d| d.member_id == 7).unwrap().max_abs_value;
    assert!(relative(max_moment(&parts), max_moment(&whole)) < 1e-6, "{} tegen {}", max_moment(&parts), max_moment(&whole));
    assert!((parts.member_forces[0].my_end_knm - whole.member_forces[0].my_end_knm).abs() < 1e-9);

    // Doorbuiging in tussenknoop 4 (midden) onder gelijkmatige last q over de
    // hele ligger plus een puntlast P in het midden, tegen de gesloten vorm
    // w = 5qL^4/(384EI) + PL^3/(48EI).
    let mut simple = parts_request.clone();
    simple.member_loads[0] = open_fem_3d::MemberLoad3D {
        id: 1, member_id: 7, qy_start_kn_per_m: 0.0, qy_end_kn_per_m: 0.0,
        qz_start_kn_per_m: -6.0, qz_end_kn_per_m: -6.0, start_position_m: None, end_position_m: None,
        ..Default::default()
    };
    let simple = solve(simple).unwrap();
    let ei = 210_000.0 * 1000.0 * 8e-5;
    let exact = 5.0 * 6.0 * 5.0_f64.powi(4) / (384.0 * ei) + 12.0 * 5.0_f64.powi(3) / (48.0 * ei);
    let w4 = simple.displacements.iter().find(|d| d.node_id == 4).unwrap().uz;
    println!("tussenknoop 4: uz = {:.6} mm, gesloten vorm {:.6} mm", w4 * 1000.0, -exact * 1000.0);
    assert!(relative(-w4, exact) < 1e-9);

    // Tweede orde en knik met een geknipte staaf: één staaf in de uitvoer.
    let mut second = parts_request;
    second.analysis = AnalysisKind::PDelta;
    second.buckling_modes = 1;
    second.nodal_loads.push(NodalLoad3D { id: 1, node_id: 2, fx: -50.0, fy: 0.0, fz: 0.0, mx: 0.0, my: 0.0, mz: 0.0 });
    let second = solve(second).unwrap();
    assert_eq!(second.member_forces.len(), 1);
    match &second.buckling {
        open_fem_3d::BucklingSummary::Available { members, .. } => {
            assert_eq!(members.len(), 1);
            assert_eq!(members[0].member_id, 7);
            assert!((members[0].length_m - 5.0).abs() < 1e-12);
        }
        other => panic!("knikanalyse gaf {other:?}"),
    }
}

#[test]
fn shells_reject_p_delta_and_mechanisms_with_clear_messages() {
    let (a, t) = (4.0, 0.2);
    let n = 4;
    let mut nodes = Vec::new();
    let g = grid(n, n, [0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], a, a, &mut nodes);
    let mut input = request(nodes, 30_000.0, 0.2, t, quads(&g, 1, 1));
    // Alleen verticaal opgelegd: in het vlak vrij → mechanisme.
    for k in 0..=n {
        for id in [g.id(0, k), g.id(n, k), g.id(k, 0), g.id(k, n)] {
            if !input.supports.iter().any(|s| s.node_id == id) {
                input.supports.push(support(id, [false, false, true, false, false, false]));
            }
        }
    }
    input.surface_loads.push(SurfaceLoad3D { id: 1, plate_id: 1, qx_kn_per_m2: 0.0, qy_kn_per_m2: 0.0, qz_kn_per_m2: -5.0 });
    let error = solve(input.clone()).unwrap_err();
    assert!(error.contains("mechanisme") && error.contains("verschuiven in X"), "{error}");

    let mut p_delta = input.clone();
    p_delta.analysis = AnalysisKind::PDelta;
    assert!(solve(p_delta).unwrap_err().contains("P-Delta"));

    let mut crooked = input.clone();
    crooked.nodes.iter_mut().find(|node| node.id == g.id(2, 2)).unwrap().z = 0.01;
    assert!(solve(crooked).unwrap_err().contains("niet vlak"));

    let mut version_one = input;
    version_one.schema_version = 1;
    assert!(solve(version_one).unwrap_err().contains("contractversie 2"));
}

/// Issue #244, punt 069: een wandschijf 4 × 4 m in het XZ-vlak, 4 × 4 MITC4,
/// t = 0,2 m, E = 30 000 N/mm², ν = 0,2, voet ingeklemd. Koplasten in x op de
/// vijf bovenknopen 12,5/25/25/25/12,5 kN, samen 100 kN. Verwacht:
/// `loadResultantKn` = [100, 0, 0] (was [0, 0, 0]); ΣR_x = −100 kN en het
/// voetmoment ΣM = 100·4 = 400 kNm (evenwicht, ongewijzigd).
#[test]
fn knooplasten_op_een_wandschijf_tellen_in_de_lastresultante() {
    let mut nodes = Vec::new();
    let g = grid(4, 4, [0.0; 3], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0], 4.0, 4.0, &mut nodes);
    let mut input = request(nodes, 30_000.0, 0.2, 0.2, quads(&g, 1, 1));
    let mut supports: Vec<Support3D> = (0..=4).map(|i| support(g.id(i, 0), [true; 6])).collect();
    for j in 1..=4 { for i in 0..=4 { add_support(&mut supports, g.id(i, j), [false, true, false, true, false, true]); } }
    input.supports = supports;
    input.nodal_loads = (0..=4).map(|i| NodalLoad3D {
        id: i + 1, node_id: g.id(i, 4), fx: if i == 0 || i == 4 { 12.5 } else { 25.0 }, fy: 0.0, fz: 0.0,
        mx: 0.0, my: 0.0, mz: 0.0,
    }).collect();
    let result = solve(input).unwrap();
    let plaat = result.plates.iter().find(|p| p.plate_id == 1).expect("plaat 1");
    for (gemeten, verwacht) in plaat.load_resultant_kn.iter().zip([100.0, 0.0, 0.0]) {
        assert!((gemeten - verwacht).abs() < 1e-9, "loadResultantKn {:?}", plaat.load_resultant_kn);
    }
    let rx: f64 = result.reactions.iter().map(|r| r.fx).sum();
    assert!((rx + 100.0).abs() < 1e-6, "ΣR_x = {rx}");
    // Voetmoment om de y-as door (0,0,0): M_y = z·F_x − x·F_z. De last geeft
    // 4 m · 100 kN = +400 kNm; de reacties (alle op z = 0, knoop (i,0) op
    // x = i m) houden dat met −400 kNm in evenwicht.
    let m: f64 = result.reactions.iter().map(|r| {
        let x = ((r.node_id - g.first_id) % 5) as f64;
        r.my - x * r.fz
    }).sum();
    assert!((m + 400.0).abs() < 1e-6, "voetmoment {m}");
}
