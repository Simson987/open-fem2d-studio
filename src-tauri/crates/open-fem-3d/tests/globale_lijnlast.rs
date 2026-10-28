//! Lijnlasten in een globale richting (#80): analytische controles.
//!
//! Een globale lijnlast werkt in globaal X, Y of Z, per meter staaflengte of
//! (`perProjection`) per meter projectie op het vlak loodrecht op de
//! lastrichting. De adapter ontbindt haar in de lokale assen van de staaf: de
//! dwarscomponenten gaan als verdeelde last naar de kern, de axiale component
//! als gelijkwaardige knooplasten met een correctie van de normaalkrachtlijn
//! (module `globale_lasten`).
//!
//! Eenheden: m, kN, kNm; E = 210 000 MPa = 2,1·10⁸ kN/m². N is trek-positief.
//! De verwachte waarden volgen uit de statica van de staaf (een lineair
//! verlopende last over [a, b]); de gemeten afwijking staat per test in de
//! uitvoer (`cargo test -- --nocapture`).

use std::f64::consts::{FRAC_PI_2, FRAC_PI_6};

use open_fem_3d::{
    solve, AnalysisKind, Bedding3D, GlobalDirection3D, Material3D, Member3D, MemberDiagram3D, MemberLoad3D,
    NodalLoad3D, Node3D, Reaction3D, Section3D, SolveRequest3D, SolveResult3D, Support3D,
};

const E: f64 = 210_000.0 * 1000.0;
const A: f64 = 0.01;
const IY: f64 = 8e-6;
const IZ: f64 = 12e-6;

fn doorsnede() -> Section3D {
    Section3D { id: 1, name: "referentie".into(), area_m2: A, iy_m4: IY, iz_m4: IZ, torsion_j_m4: 5e-6,
        shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }
}

fn knoop(id: usize, x: f64, y: f64, z: f64) -> Node3D { Node3D { id, x, y, z } }

fn staaf(id: usize, begin: usize, eind: usize) -> Member3D {
    Member3D { id, start_node_id: begin, end_node_id: eind, material_id: 1, section_id: 1,
        releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: vec![], tension_only: false,
        bedding: None, part_section_ids: None }
}

/// Oplegging met per richting (ux, uy, uz, rx, ry, rz) vast of vrij.
fn steun(node_id: usize, vast: [bool; 6]) -> Support3D {
    Support3D { node_id, ux: vast[0], uy: vast[1], uz: vast[2], rx: vast[3], ry: vast[4], rz: vast[5],
        ..Default::default() }
}

const INKLEMMING: [bool; 6] = [true; 6];
/// Alle translaties vast, alleen draaien om globaal Y vrij (scharnier in het X-Z-vlak).
const SCHARNIER_Y: [bool; 6] = [true, true, true, true, false, true];

fn verzoek(nodes: Vec<Node3D>, members: Vec<Member3D>, supports: Vec<Support3D>) -> SolveRequest3D {
    SolveRequest3D {
        schema_version: 2, analysis: AnalysisKind::Linear, nodes,
        materials: vec![Material3D { id: 1, name: "staal".into(), e_mpa: 210_000.0, nu: 0.3, g_mpa: None, alpha_per_k: None }],
        sections: vec![doorsnede()], members, supports, nodal_loads: vec![], member_loads: vec![],
        member_point_loads: vec![], thermal_loads: vec![], plates: vec![], shell_elements: vec![],
        surface_loads: vec![], diaphragms: vec![], node_links: vec![], tension_only_fit: None, tension_only_cross_rule: false,
        max_iterations: 50, tolerance: 1e-10, buckling_modes: 0,
    }
}

fn lokaal(id: usize, member_id: usize, qy: [f64; 2], qz: [f64; 2], bereik: Option<(f64, f64)>) -> MemberLoad3D {
    MemberLoad3D {
        id, member_id,
        qy_start_kn_per_m: qy[0], qy_end_kn_per_m: qy[1], qz_start_kn_per_m: qz[0], qz_end_kn_per_m: qz[1],
        start_position_m: bereik.map(|b| b.0), end_position_m: bereik.map(|b| b.1),
        ..Default::default()
    }
}

fn globaal(
    id: usize, member_id: usize, richting: GlobalDirection3D, q: [f64; 2], bereik: Option<(f64, f64)>, per_projectie: bool,
) -> MemberLoad3D {
    MemberLoad3D {
        id, member_id,
        global_direction: Some(richting), q_start_kn_per_m: Some(q[0]), q_end_kn_per_m: Some(q[1]),
        per_projection: per_projectie,
        start_position_m: bereik.map(|b| b.0), end_position_m: bereik.map(|b| b.1),
        ..Default::default()
    }
}

fn lijn(lijnen: &[MemberDiagram3D], staaf: usize) -> &MemberDiagram3D {
    lijnen.iter().find(|lijn| lijn.member_id == staaf).expect("lijn van de staaf")
}

fn reactie(r: &SolveResult3D, knoop: usize) -> &Reaction3D {
    r.reactions.iter().find(|x| x.node_id == knoop).expect("reactie van de knoop")
}

fn evenwicht_ok(r: &SolveResult3D, wat: &str) {
    let evenwicht = r.equilibrium.as_ref().expect("evenwichtssamenvatting");
    assert!(evenwicht.equilibrium_ok && evenwicht.residual_ok, "{wat}: evenwicht {evenwicht:?}");
}

/// Grootste afwijking |werkelijk − verwacht| over alle punten van een lijn,
/// gedeeld door `schaal`.
fn lijnafwijking(lijn: &MemberDiagram3D, lengte: f64, schaal: f64, verwacht: impl Fn(f64) -> f64) -> f64 {
    lijn.points.iter().map(|p| (p.value - verwacht(p.t * lengte)).abs() / schaal).fold(0.0, f64::max)
}

fn relatief(werkelijk: f64, verwacht: f64, schaal: f64) -> f64 { (werkelijk - verwacht).abs() / schaal }

fn grens(afwijking: f64, maximum: f64, wat: &str) {
    assert!(afwijking <= maximum, "{wat}: afwijking {afwijking:.3e} boven {maximum:.0e}");
}

/// Lineair verlopende last q(s) van qa bij a naar qb bij b, nul erbuiten;
/// s langs de staaf vanaf de beginknoop.
struct Trapezium { a: f64, b: f64, qa: f64, qb: f64 }

impl Trapezium {
    fn helling(&self) -> f64 { (self.qb - self.qa) / (self.b - self.a) }
    /// S0(x) = ∫₀ˣ q ds.
    fn som(&self, x: f64) -> f64 {
        let x = x.clamp(self.a, self.b);
        let s = x - self.a;
        self.qa * s + self.helling() * s * s / 2.0
    }
    /// S1(x) = ∫₀ˣ q·s ds.
    fn moment(&self, x: f64) -> f64 {
        let (a, x) = (self.a, x.clamp(self.a, self.b));
        let k = self.helling();
        (self.qa - k * a) * (x * x - a * a) / 2.0 + k * (x * x * x - a * a * a) / 3.0
    }
    /// Eindreactie aan het begin van een staaf van lengte L (vrij opgelegd
    /// dwars, of aan beide einden vastgehouden axiaal): ∫q·(1 − s/L) ds.
    fn begin(&self, l: f64) -> f64 { self.som(l) - self.moment(l) / l }
    /// Normaalkracht van een aan beide einden axiaal vastgehouden staaf (trek positief).
    fn n_vast(&self, l: f64, x: f64) -> f64 { self.begin(l) - self.som(x) }
    /// Moment van een vrij opgelegde staaf (sagging positief bij q > 0).
    fn m_vrij(&self, l: f64, x: f64) -> f64 { self.begin(l) * x - (x * self.som(x) - self.moment(x)) }
}

/// Schuine staaf onder 30° in het X-Z-vlak, aan beide einden alle translaties
/// vast (scharnieren), eventueel met een tussenknoop op s = 2 m.
fn schuine_staaf(l: f64, tussenknoop: bool) -> SolveRequest3D {
    let (c, s) = (FRAC_PI_6.cos(), FRAC_PI_6.sin());
    let mut nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l * c, 0.0, l * s)];
    let mut ligger = staaf(1, 1, 2);
    if tussenknoop {
        nodes.push(knoop(3, 2.0 * c, 0.0, 2.0 * s));
        ligger.intermediate_node_ids = vec![3];
    }
    verzoek(nodes, vec![ligger], vec![steun(1, SCHARNIER_Y), steun(2, SCHARNIER_Y)])
}

/// (a) Schuine staaf (30°), scharnierend, onder een gelijkmatige globale Z-last
/// per staafmeter. De dwarscomponent q·cos30° geeft een vrij opgelegde ligger,
/// de axiale component q·sin30° een aan beide einden vastgehouden staaf. Elke
/// eindreactie is dan −q·L/2 in Z (de twee componenten samen), M_max =
/// q·cos30°·L²/8 en N(x) = q·sin30°·(L/2 − x): van +q·sin30°·L/2 naar
/// −q·sin30°·L/2 (bij q < 0 druk onderaan, trek bovenaan).
#[test]
fn schuine_staaf_onder_globale_z_per_staafmeter() {
    let (l, q) = (5.0, -5.0);
    let (c, s) = (FRAC_PI_6.cos(), FRAC_PI_6.sin());
    let mut request = schuine_staaf(l, false);
    request.member_loads.push(globaal(1, 1, GlobalDirection3D::Z, [q, q], None, false));
    let r = solve(request).unwrap();
    evenwicht_ok(&r, "schuin");
    let schaal_r = (q * l).abs();
    let fz: f64 = r.reactions.iter().map(|x| x.fz).sum();
    let mut afwijking = relatief(fz, -q * l, schaal_r);
    for knoop in [1, 2] {
        let x = reactie(&r, knoop);
        afwijking = afwijking.max(relatief(x.fz, -q * l / 2.0, schaal_r)).max(x.fx.abs() / schaal_r).max(x.fy.abs() / schaal_r);
    }
    let schaal_n = (q * s * l / 2.0).abs();
    let n_lijn = lijnafwijking(lijn(&r.diagrams.axial, 1), l, schaal_n, |x| q * s * (l / 2.0 - x));
    let krachten = &r.member_forces[0];
    let n_einden = relatief(krachten.n_start_kn, q * s * l / 2.0, schaal_n).max(relatief(krachten.n_end_kn, -q * s * l / 2.0, schaal_n));
    let m_max = (q * c * l * l / 8.0).abs();
    let momenten = lijn(&r.diagrams.moment_y, 1);
    // |M(x)| van de vrij opgelegde ligger onder q·cos30°: |q·cos30°·x·(L − x)/2|.
    let m_lijn = momenten.points.iter()
        .map(|p| (p.value.abs() - (q * c * p.t * l * (l - p.t * l) / 2.0).abs()).abs() / m_max)
        .fold(0.0, f64::max);
    let m_top = relatief(momenten.max_abs_value, m_max, m_max);
    let v = relatief(lijn(&r.diagrams.shear_z, 1).max_abs_value, (q * c * l / 2.0).abs(), (q * c * l / 2.0).abs());
    eprintln!("(a) schuin 30°, globaal Z per staafmeter: reacties {afwijking:.2e}, N-lijn {n_lijn:.2e}, N-einden {n_einden:.2e}, M-lijn {m_lijn:.2e}, M_max {m_top:.2e}, V {v:.2e}");
    grens(afwijking, 1e-12, "reacties");
    grens(n_lijn, 1e-12, "N-lijn");
    grens(n_einden, 1e-12, "N aan de einden");
    grens(m_lijn, 1e-10, "M-lijn");
    grens(m_top, 1e-10, "M_max");
    grens(v, 1e-10, "dwarskracht");
    assert!(lijn(&r.diagrams.moment_z, 1).max_abs_value <= 1e-10, "geen buiging uit het vlak");
}

/// (b) Idem per projectie (sneeuw): per staafmeter q·|e_x × Z| = q·cos30°, dus
/// totaal q·L·cos30°, M_max = q·cos²30°·L²/8 en N-amplitude q·sin30°·cos30°·L/2.
#[test]
fn schuine_staaf_onder_globale_z_per_projectie() {
    let (l, q) = (5.0, -5.0);
    let (c, s) = (FRAC_PI_6.cos(), FRAC_PI_6.sin());
    let mut request = schuine_staaf(l, false);
    request.member_loads.push(globaal(1, 1, GlobalDirection3D::Z, [q, q], None, true));
    let r = solve(request).unwrap();
    evenwicht_ok(&r, "per projectie");
    let totaal = q * l * c;
    let fz: f64 = r.reactions.iter().map(|x| x.fz).sum();
    let reacties = relatief(fz, -totaal, totaal.abs())
        .max(relatief(reactie(&r, 1).fz, -totaal / 2.0, totaal.abs()))
        .max(reactie(&r, 1).fx.abs() / totaal.abs());
    let schaal_n = (q * c * s * l / 2.0).abs();
    let n_lijn = lijnafwijking(lijn(&r.diagrams.axial, 1), l, schaal_n, |x| q * c * s * (l / 2.0 - x));
    let m_max = (q * c * c * l * l / 8.0).abs();
    let m_top = relatief(lijn(&r.diagrams.moment_y, 1).max_abs_value, m_max, m_max);
    eprintln!("(b) per projectie: reacties {reacties:.2e}, N-lijn {n_lijn:.2e}, M_max {m_top:.2e}");
    grens(reacties, 1e-12, "reacties per projectie");
    grens(n_lijn, 1e-12, "N-lijn per projectie");
    grens(m_top, 1e-10, "M_max per projectie");
}

/// Grootste verschil tussen twee uitkomsten: verplaatsingen, reacties,
/// eindkrachten en alle lijnpunten, elk gedeeld door de grootste waarde van
/// die soort.
fn verschil_uitkomsten(p: &SolveResult3D, q: &SolveResult3D) -> f64 {
    let mut uit: f64 = 0.0;
    let mut vergelijk = |a: Vec<f64>, b: Vec<f64>| {
        assert_eq!(a.len(), b.len(), "zelfde aantal waarden");
        let schaal = a.iter().chain(&b).map(|v| v.abs()).fold(1e-30, f64::max);
        for (x, y) in a.iter().zip(&b) { uit = uit.max((x - y).abs() / schaal); }
    };
    let verplaatsing = |r: &SolveResult3D| r.displacements.iter().flat_map(|d| [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz]).collect::<Vec<_>>();
    vergelijk(verplaatsing(p), verplaatsing(q));
    let reacties = |r: &SolveResult3D| r.reactions.iter().flat_map(|d| [d.fx, d.fy, d.fz, d.mx, d.my, d.mz]).collect::<Vec<_>>();
    vergelijk(reacties(p), reacties(q));
    let krachten = |r: &SolveResult3D| r.member_forces.iter().flat_map(|f| [f.n_start_kn, f.n_end_kn, f.vy_start_kn,
        f.vy_end_kn, f.vz_start_kn, f.vz_end_kn, f.torsion_start_knm, f.torsion_end_knm, f.my_start_knm, f.my_end_knm,
        f.mz_start_knm, f.mz_end_knm]).collect::<Vec<_>>();
    vergelijk(krachten(p), krachten(q));
    let lijnen = |r: &SolveResult3D| [&r.diagrams.moment_y, &r.diagrams.moment_z, &r.diagrams.shear_y,
        &r.diagrams.shear_z, &r.diagrams.axial, &r.diagrams.torsion]
        .into_iter().flat_map(|lijst| lijst.iter().flat_map(|l| l.points.iter().flat_map(|p| [p.t, p.value])))
        .collect::<Vec<_>>();
    vergelijk(lijnen(p), lijnen(q));
    uit
}

/// (c) Liggende staaf langs X (uitkraging, 4 m): globaal Z is lokaal z; met een
/// rolhoek van 90° wijst lokaal y omhoog en is globaal Z lokaal y. Elke
/// uitkomst gelijk aan die van de lokale last, en de doorbuiging q·L⁴/(8·E·I)
/// met I_y, resp. I_z bij de rol.
#[test]
fn liggende_staaf_globaal_z_is_de_lokale_last() {
    let (l, q) = (4.0, -4.0);
    for (naam, rol, i, lokale_last) in [
        ("rol 0", None, IY, lokaal(1, 1, [0.0, 0.0], [q, q], None)),
        ("rol 90°", Some(FRAC_PI_2), IZ, lokaal(1, 1, [q, q], [0.0, 0.0], None)),
    ] {
        let mut ligger = staaf(1, 1, 2);
        ligger.roll_angle_rad = rol;
        let basis = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)], vec![ligger], vec![steun(1, INKLEMMING)]);
        let mut met_lokaal = basis.clone();
        met_lokaal.member_loads.push(lokale_last);
        let mut met_globaal = basis;
        met_globaal.member_loads.push(globaal(1, 1, GlobalDirection3D::Z, [q, q], None, false));
        let (p, g) = (solve(met_lokaal).unwrap(), solve(met_globaal).unwrap());
        evenwicht_ok(&g, naam);
        let verschil = verschil_uitkomsten(&p, &g);
        let verwacht = q * l.powi(4) / (8.0 * E * i);
        let tip = g.displacements.iter().find(|d| d.node_id == 2).unwrap().uz;
        let doorbuiging = relatief(tip, verwacht, verwacht.abs());
        eprintln!("(c) liggend langs X, {naam}: verschil met de lokale last {verschil:.2e}, doorbuiging {doorbuiging:.2e}");
        grens(verschil, 1e-12, naam);
        grens(doorbuiging, 1e-9, naam);
    }
}

/// (d) Staaf langs Y (uitkraging, 4 m) onder globaal X: lokaal z is Z, lokaal
/// y = Z × Y = −X, dus q in X is lokaal qy = −q. De tip schuift q·L⁴/(8·E·I_z)
/// in X op en de reactie is −q·L.
#[test]
fn staaf_langs_y_onder_globaal_x() {
    let (l, q) = (4.0, 3.0);
    let basis = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 0.0, l, 0.0)], vec![staaf(1, 1, 2)], vec![steun(1, INKLEMMING)]);
    let mut met_lokaal = basis.clone();
    met_lokaal.member_loads.push(lokaal(1, 1, [-q, -q], [0.0, 0.0], None));
    let mut met_globaal = basis;
    met_globaal.member_loads.push(globaal(1, 1, GlobalDirection3D::X, [q, q], None, false));
    let (p, g) = (solve(met_lokaal).unwrap(), solve(met_globaal).unwrap());
    evenwicht_ok(&g, "langs Y");
    let verschil = verschil_uitkomsten(&p, &g);
    let verwacht = q * l.powi(4) / (8.0 * E * IZ);
    let tip = g.displacements.iter().find(|d| d.node_id == 2).unwrap();
    let doorbuiging = relatief(tip.ux, verwacht, verwacht);
    let fx = relatief(reactie(&g, 1).fx, -q * l, q * l);
    eprintln!("(d) langs Y onder globaal X: verschil met lokaal qy = −q {verschil:.2e}, doorbuiging {doorbuiging:.2e}, reactie {fx:.2e}");
    grens(verschil, 1e-12, "langs Y");
    grens(doorbuiging, 1e-9, "doorbuiging langs Y");
    grens(fx, 1e-12, "reactie langs Y");
    assert!(tip.uz.abs() < 1e-15 && tip.uy.abs() < 1e-15, "alleen verplaatsing in X");
}

/// (e) Kolom (6 m, onderaan ingeklemd, boven vrij) onder globaal Z per
/// staafmeter (eigen gewicht): puur axiaal. N(x) = q·(L − x) (bij q < 0 druk,
/// −q·L aan de voet en 0 aan de top), de top zakt q·L²/(2·E·A), geen buiging.
/// Idem een liggende staaf langs X onder globaal X: N(x) = q·(L − x).
#[test]
fn kolom_en_trekstaaf_puur_axiaal() {
    let l = 6.0;
    for (naam, eind, richting, q) in [
        ("kolom, globaal Z", [0.0, 0.0, l], GlobalDirection3D::Z, -2.5),
        ("liggend langs X, globaal X", [l, 0.0, 0.0], GlobalDirection3D::X, 4.0),
        ("hangend (eind onder), globaal Z", [0.0, 0.0, -l], GlobalDirection3D::Z, -2.5),
    ] {
        let mut request = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, eind[0], eind[1], eind[2])],
            vec![staaf(1, 1, 2)], vec![steun(1, INKLEMMING)]);
        request.member_loads.push(globaal(1, 1, richting, [q, q], None, false));
        let r = solve(request).unwrap();
        evenwicht_ok(&r, naam);
        // Component langs de staafas e_x (van knoop 1 naar 2).
        let langs = if eind.iter().sum::<f64>() < 0.0 { -q } else { q };
        let schaal = (q * l).abs();
        let n_lijn = lijnafwijking(lijn(&r.diagrams.axial, 1), l, schaal, |x| langs * (l - x));
        let krachten = &r.member_forces[0];
        let n_einden = relatief(krachten.n_start_kn, langs * l, schaal).max(krachten.n_end_kn.abs() / schaal);
        let tip = r.displacements.iter().find(|d| d.node_id == 2).unwrap();
        let verplaatsing = [tip.ux, tip.uy, tip.uz];
        let as_ = match richting { GlobalDirection3D::X => 0, GlobalDirection3D::Y => 1, GlobalDirection3D::Z => 2 };
        let verwacht = q * l * l / (2.0 * E * A);
        let eind_u = relatief(verplaatsing[as_], verwacht, verwacht.abs());
        let reactie_ = [reactie(&r, 1).fx, reactie(&r, 1).fy, reactie(&r, 1).fz][as_];
        let reactie_af = relatief(reactie_, -q * l, schaal);
        let buiging = [&r.diagrams.moment_y, &r.diagrams.moment_z, &r.diagrams.shear_y, &r.diagrams.shear_z]
            .iter().map(|lijst| lijn(lijst, 1).max_abs_value).fold(0.0, f64::max);
        eprintln!("(e) {naam}: N-lijn {n_lijn:.2e}, N-einden {n_einden:.2e}, eindverplaatsing {eind_u:.2e}, reactie {reactie_af:.2e}, buiging {buiging:.2e}");
        grens(n_lijn, 1e-12, naam);
        grens(n_einden, 1e-12, naam);
        grens(eind_u, 1e-10, naam);
        grens(reactie_af, 1e-12, naam);
        assert!(buiging <= 1e-10, "{naam}: geen buiging ({buiging:.3e})");
    }
}

/// (f) Gedeeltelijke trapeziumlast: op de schuine staaf van (a) van q = −2 bij
/// a = 0,8 m naar −7 bij b = 3,5 m (L = 5 m). Dwars vrij opgelegd en axiaal aan
/// beide einden vast met dezelfde hefboomregel, dus elke eindreactie is
/// verticaal: −∫q(1 − s/L)ds en −∫q·s/L ds. N(x) = sin30°·(F_begin − ∫₀ˣq) met
/// knikken in a en b (daar staan lijnpunten); |M(x)| van de vrij opgelegde
/// ligger onder q·cos30°. Daarna een trekstaaf langs X (ingeklemd, eind vrij)
/// met dezelfde axiale last: de eindverplaatsing is ∫q·s ds/(E·A) en N(x) =
/// ∫ₓᴸ q ds.
#[test]
fn gedeeltelijke_trapeziumlast() {
    let l = 5.0;
    let (c, s) = (FRAC_PI_6.cos(), FRAC_PI_6.sin());
    let last = Trapezium { a: 0.8, b: 3.5, qa: -2.0, qb: -7.0 };
    let mut request = schuine_staaf(l, false);
    request.member_loads.push(globaal(1, 1, GlobalDirection3D::Z, [last.qa, last.qb], Some((last.a, last.b)), false));
    let r = solve(request).unwrap();
    evenwicht_ok(&r, "trapezium");
    let totaal = last.som(l);
    let schaal = totaal.abs();
    let reacties = relatief(reactie(&r, 1).fz, -last.begin(l), schaal)
        .max(relatief(reactie(&r, 2).fz, -last.moment(l) / l, schaal))
        .max(reactie(&r, 1).fx.abs() / schaal).max(reactie(&r, 2).fx.abs() / schaal);
    let axiaal = lijn(&r.diagrams.axial, 1);
    let n_lijn = lijnafwijking(axiaal, l, schaal * s, |x| s * last.n_vast(l, x));
    for t in [last.a / l, last.b / l] {
        assert!(axiaal.points.iter().any(|p| (p.t - t).abs() < 1e-12), "lijnpunt op de knik t = {t}");
    }
    let m_schaal = c * (0..=1000).map(|i| last.m_vrij(l, l * i as f64 / 1000.0).abs()).fold(0.0, f64::max);
    let m_lijn = lijn(&r.diagrams.moment_y, 1).points.iter()
        .map(|p| (p.value.abs() - (c * last.m_vrij(l, p.t * l)).abs()).abs() / m_schaal).fold(0.0, f64::max);
    eprintln!("(f) trapezium schuin: reacties {reacties:.2e}, N-lijn {n_lijn:.2e}, M-lijn {m_lijn:.2e} (M_max {m_schaal:.4} kNm)");
    grens(reacties, 1e-12, "reacties trapezium");
    grens(n_lijn, 1e-12, "N-lijn trapezium");
    grens(m_lijn, 1e-10, "M-lijn trapezium");

    // Trekstaaf langs X onder dezelfde last in globaal X, ongeknipt en met een
    // tussenknoop op 2 m (in het lastbereik): u(x) = (R·x − x·S0(x) + S1(x))/(E·A).
    for tussen in [false, true] {
        let mut nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)];
        let mut trek = staaf(1, 1, 2);
        if tussen {
            nodes.push(knoop(3, 2.0, 0.0, 0.0));
            trek.intermediate_node_ids = vec![3];
        }
        let mut request = verzoek(nodes, vec![trek], vec![steun(1, INKLEMMING)]);
        request.member_loads.push(globaal(1, 1, GlobalDirection3D::X, [last.qa, last.qb], Some((last.a, last.b)), false));
        let r = solve(request).unwrap();
        evenwicht_ok(&r, "trekstaaf");
        let u = |x: f64| (totaal * x - x * last.som(x) + last.moment(x)) / (E * A);
        let mut verplaatsing = relatief(r.displacements.iter().find(|d| d.node_id == 2).unwrap().ux, u(l), u(l).abs());
        if tussen {
            verplaatsing = verplaatsing.max(relatief(r.displacements.iter().find(|d| d.node_id == 3).unwrap().ux, u(2.0), u(l).abs()));
        }
        let n_lijn = lijnafwijking(lijn(&r.diagrams.axial, 1), l, schaal, |x| totaal - last.som(x));
        let krachten = &r.member_forces[0];
        let n_einden = relatief(krachten.n_start_kn, totaal, schaal).max(krachten.n_end_kn.abs() / schaal);
        eprintln!("(f) trekstaaf langs X{}: verplaatsingen {verplaatsing:.2e}, N-lijn {n_lijn:.2e}, N-einden {n_einden:.2e}",
            if tussen { " met tussenknoop" } else { "" });
        grens(verplaatsing, 1e-10, "verplaatsing trekstaaf");
        grens(n_lijn, 1e-12, "N-lijn trekstaaf");
        grens(n_einden, 1e-12, "N-einden trekstaaf");
    }
}

/// (g) Geknipte staven en tweede orde.
/// 1. De schuine staaf van (f) met een tussenknoop op 2 m (in het lastbereik):
///    lineair dezelfde gesloten vorm (de knooplasten en de correctie per deel).
/// 2. De gelijkmatige last van (a) met tweede orde: N_gem per deel is nul bij
///    een ongeknipte staaf, dus gelijk aan de eerste orde; met de tussenknoop
///    en de trapeziumlast zonder fout, met evenwicht en de totale last in de
///    reacties.
#[test]
fn geknipte_staaf_en_tweede_orde() {
    let l = 5.0;
    let s = FRAC_PI_6.sin();
    let last = Trapezium { a: 0.8, b: 3.5, qa: -2.0, qb: -7.0 };
    let schaal = last.som(l).abs();
    let mut geknipt = schuine_staaf(l, true);
    geknipt.member_loads.push(globaal(1, 1, GlobalDirection3D::Z, [last.qa, last.qb], Some((last.a, last.b)), false));
    let r = solve(geknipt.clone()).unwrap();
    evenwicht_ok(&r, "geknipt");
    let n_lijn = lijnafwijking(lijn(&r.diagrams.axial, 1), l, schaal * s, |x| s * last.n_vast(l, x));
    let krachten = &r.member_forces[0];
    let n_einden = relatief(krachten.n_start_kn, s * last.n_vast(l, 0.0), schaal * s)
        .max(relatief(krachten.n_end_kn, s * last.n_vast(l, l), schaal * s));
    let reacties = relatief(reactie(&r, 1).fz, -last.begin(l), schaal).max(relatief(reactie(&r, 2).fz, -last.moment(l) / l, schaal));
    eprintln!("(g1) geknipt, lineair: N-lijn {n_lijn:.2e}, N-einden {n_einden:.2e}, reacties {reacties:.2e}");
    grens(n_lijn, 1e-12, "N-lijn geknipt");
    grens(n_einden, 1e-12, "N-einden geknipt");
    grens(reacties, 1e-12, "reacties geknipt");

    // Tweede orde, ongeknipt en gelijkmatig: N_kern = 0, dus de eerste orde.
    let mut eerste = schuine_staaf(l, false);
    eerste.member_loads.push(globaal(1, 1, GlobalDirection3D::Z, [-5.0, -5.0], None, false));
    eerste.buckling_modes = 1;
    let mut tweede = eerste.clone();
    tweede.analysis = AnalysisKind::PDelta;
    let (p, q) = (solve(eerste).unwrap(), solve(tweede).unwrap());
    evenwicht_ok(&q, "tweede orde");
    let verschil = verschil_uitkomsten(&p, &q);
    eprintln!("(g2) tweede orde, N_gem = 0: verschil met de eerste orde {verschil:.2e}");
    grens(verschil, 1e-9, "tweede orde zonder N_gem");

    // Tweede orde met de tussenknoop en de trapeziumlast.
    geknipt.analysis = AnalysisKind::PDelta;
    geknipt.buckling_modes = 1;
    let t = solve(geknipt).unwrap();
    evenwicht_ok(&t, "tweede orde geknipt");
    assert!(t.second_order.as_ref().is_some_and(|s| s.converged), "tweede orde convergeert");
    let fz: f64 = t.reactions.iter().map(|x| x.fz).sum();
    let fx: f64 = t.reactions.iter().map(|x| x.fx).sum();
    let som = relatief(fz, -last.som(l), schaal).max(fx.abs() / schaal);
    let n_verschil = lijnafwijking(lijn(&t.diagrams.axial, 1), l, schaal * s, |x| s * last.n_vast(l, x));
    eprintln!("(g2) tweede orde geknipt: reactiesom {som:.2e}, N-lijn t.o.v. de eerste orde {n_verschil:.2e}");
    grens(som, 1e-10, "reactiesom tweede orde");
    assert_eq!(t.member_forces.len(), 1, "één staaf in de uitvoer");
}

/// (g3) Staaf op bedding (in delen gerekend): een globale X-last langs de as is
/// puur axiaal; de verticale grondveren raken die niet. Vanaf het vaste begin
/// N(x) = q·(L − x) over alle delen en u(L) = q·L²/(2·E·A). Een globale Z-last
/// op dezelfde staaf geeft precies de uitkomst van de lokale last qz. Een
/// schuine staaf op bedding onder globaal Z: verticaal evenwicht met de grond.
#[test]
fn staaf_op_bedding_met_globale_last() {
    let (l, q) = (10.0, 4.0);
    let bedding = Some(Bedding3D { k_kn_per_m3: Some(50_000.0), width_m: 0.8, k_lateral_kn_per_m3: None, compression_only: false });
    let mut ligger = staaf(1, 1, 2);
    ligger.bedding = bedding.clone();
    let basis = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)], vec![ligger],
        vec![steun(1, [true, true, false, true, false, true])]);
    let mut axiaal = basis.clone();
    axiaal.member_loads.push(globaal(1, 1, GlobalDirection3D::X, [q, q], None, false));
    let r = solve(axiaal).unwrap();
    evenwicht_ok(&r, "bedding axiaal");
    let delen = r.bedding[0].points.len() - 1;
    let n_lijn = lijnafwijking(lijn(&r.diagrams.axial, 1), l, q * l, |x| q * (l - x));
    let verwacht = q * l * l / (2.0 * E * A);
    let u = relatief(r.displacements.iter().find(|d| d.node_id == 2).unwrap().ux, verwacht, verwacht);
    let krachten = &r.member_forces[0];
    let n_einden = relatief(krachten.n_start_kn, q * l, q * l).max(krachten.n_end_kn.abs() / (q * l));
    eprintln!("(g3) bedding ({delen} delen), globaal X: N-lijn {n_lijn:.2e}, N-einden {n_einden:.2e}, u(L) {u:.2e}");
    grens(n_lijn, 1e-10, "N-lijn op bedding");
    grens(n_einden, 1e-10, "N-einden op bedding");
    grens(u, 1e-9, "u(L) op bedding");

    let mut met_lokaal = basis.clone();
    met_lokaal.member_loads.push(lokaal(1, 1, [0.0, 0.0], [-20.0, -5.0], Some((1.0, 9.0))));
    let mut met_globaal = basis;
    met_globaal.member_loads.push(globaal(1, 1, GlobalDirection3D::Z, [-20.0, -5.0], Some((1.0, 9.0)), false));
    let verschil = verschil_uitkomsten(&solve(met_lokaal).unwrap(), &solve(met_globaal).unwrap());
    eprintln!("(g3) bedding, globaal Z tegen lokaal qz: verschil {verschil:.2e}");
    grens(verschil, 1e-9, "bedding globaal Z = lokaal qz");

    // Schuin (10°) op bedding onder globaal Z per staafmeter, tweede orde.
    let hoek = 10f64.to_radians();
    let mut schuin = staaf(1, 1, 2);
    schuin.bedding = bedding;
    let mut request = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l * hoek.cos(), 0.0, l * hoek.sin())], vec![schuin],
        vec![steun(1, [true, true, false, true, false, true])]);
    request.member_loads.push(globaal(1, 1, GlobalDirection3D::Z, [-12.0, -12.0], None, false));
    request.analysis = AnalysisKind::PDelta;
    request.buckling_modes = 1;
    let r = solve(request).unwrap();
    evenwicht_ok(&r, "schuin op bedding");
    let fz: f64 = r.reactions.iter().map(|x| x.fz).sum();
    let grond: f64 = r.bedding.iter().map(|b| b.total_reaction_kn).sum();
    let rest = relatief(fz + grond, 12.0 * l, 12.0 * l);
    eprintln!("(g3) schuin op bedding, tweede orde: verticaal evenwicht {rest:.2e}");
    grens(rest, 1e-6, "verticaal evenwicht schuin op bedding");
}

/// Trek-alleen: een globale last op een staaf die op druk wegvalt, gaat als
/// knooplasten naar haar eindknopen (ook de axiale component); de reacties
/// dragen de hele last.
#[test]
fn globale_last_op_een_inactieve_trek_alleen_staaf() {
    let ligger = |id: usize, a: usize, b: usize| { let mut s = staaf(id, a, b); s.releases.my_end = id != 2; s };
    let verband = |id: usize, a: usize, b: usize| {
        let mut s = staaf(id, a, b);
        s.tension_only = true;
        s.releases.my_start = true; s.releases.my_end = true; s.releases.mz_start = true; s.releases.mz_end = true;
        s
    };
    let members = vec![ligger(1, 1, 2), ligger(2, 2, 3), ligger(3, 4, 3), verband(4, 1, 3), verband(5, 4, 2)];
    let mut request = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 0.0, 0.0, 4.0), knoop(3, 5.0, 0.0, 4.0), knoop(4, 5.0, 0.0, 0.0)],
        members, vec![steun(1, [true, true, true, true, false, true]), steun(4, [true, true, true, true, false, true])],
    );
    request.nodal_loads.push(NodalLoad3D { id: 1, node_id: 2, fx: 10.0, fy: 0.0, fz: 0.0, mx: 0.0, my: 0.0, mz: 0.0 });
    let q = -0.2;
    request.member_loads.push(globaal(1, 5, GlobalDirection3D::Z, [q, q], None, false));
    let r = solve(request).unwrap();
    assert_eq!(r.inactive_members, vec![5], "het verband 4–2 staat op druk");
    evenwicht_ok(&r, "trek-alleen");
    let lengte = 41f64.sqrt();
    let fz: f64 = r.reactions.iter().map(|x| x.fz).sum();
    let fx: f64 = r.reactions.iter().map(|x| x.fx).sum();
    let som = relatief(fz, -q * lengte, (q * lengte).abs()).max(relatief(fx, -10.0, 10.0));
    eprintln!("trek-alleen, globale last op het inactieve verband: reactiesom {som:.2e}");
    grens(som, 1e-12, "reactiesom trek-alleen");
    assert!(r.diagnostics.iter().any(|d| d.contains("staaflasten op inactieve staven")));
}

/// Portaal b × h in het X-Z-vlak (knopen 1 (0,0,0), 2 (0,0,h), 3 (b,0,h),
/// 4 (b,0,0)), H in X op knoop 2, en een trek-alleen diagonaal 4 van 1 naar
/// 3, aan beide einden scharnierend. Met `x_verband` ook de trek-alleen
/// diagonaal 5 van 4 naar 2. `stijf`: voeten ingeklemd en stijve hoeken;
/// anders voeten scharnierend om Y en de liggerhoeken bij 2 en 3 scharnierend.
fn portaal_met_trekdiagonaal(b: f64, h: f64, h_kracht: f64, stijf: bool, x_verband: bool) -> SolveRequest3D {
    let ligger = |id: usize, a: usize, e: usize| {
        let mut s = staaf(id, a, e);
        s.releases.my_end = !stijf && id != 2;
        s
    };
    let verband = |id: usize, a: usize, e: usize| {
        let mut s = staaf(id, a, e);
        s.tension_only = true;
        s.releases.my_start = true; s.releases.my_end = true; s.releases.mz_start = true; s.releases.mz_end = true;
        s
    };
    let mut members = vec![ligger(1, 1, 2), ligger(2, 2, 3), ligger(3, 4, 3), verband(4, 1, 3)];
    if x_verband { members.push(verband(5, 4, 2)); }
    let voet = if stijf { INKLEMMING } else { [true, true, true, true, false, true] };
    let mut request = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 0.0, 0.0, h), knoop(3, b, 0.0, h), knoop(4, b, 0.0, 0.0)],
        members, vec![steun(1, voet), steun(4, voet)],
    );
    request.nodal_loads.push(NodalLoad3D { id: 1, node_id: 2, fx: h_kracht, fy: 0.0, fz: 0.0, mx: 0.0, my: 0.0, mz: 0.0 });
    request
}

/// Dezelfde globale Z-last q op diagonaal 4 (1 → 3) zoals de kern haar krijgt:
/// lokaal qz = q·(Z·e_z) als verdeelde last en het axiale deel q·(Z·e_x)·L/2
/// als knooplast langs e_x op beide einden. In het X-Z-vlak zonder rol is
/// e_x = (b, 0, h)/L en e_z = (−h, 0, b)/L. Geeft (verzoek, q_x, L).
fn met_gelijkwaardige_last(basis: &SolveRequest3D, b: f64, h: f64, q: f64) -> (SolveRequest3D, f64, f64) {
    let l = (b * b + h * h).sqrt();
    let (qx, qz) = (q * h / l, q * b / l);
    let f = qx * l / 2.0;
    let mut request = basis.clone();
    request.member_loads.push(lokaal(1, 4, [0.0, 0.0], [qz, qz], None));
    for (id, node_id) in [(2, 1), (3, 3)] {
        request.nodal_loads.push(NodalLoad3D { id, node_id, fx: f * b / l, fy: 0.0, fz: f * h / l, mx: 0.0, my: 0.0, mz: 0.0 });
    }
    (request, qx, l)
}

fn krachten(r: &SolveResult3D, staaf: usize) -> &open_fem_3d::MemberForces3D {
    r.member_forces.iter().find(|f| f.member_id == staaf).expect("eindkrachten van de staaf")
}

/// Grootste verschil in verplaatsingen en reacties, gedeeld door de grootste waarde van die soort.
fn verschil_knopen(p: &SolveResult3D, q: &SolveResult3D) -> f64 {
    let mut uit: f64 = 0.0;
    let mut vergelijk = |a: Vec<f64>, b: Vec<f64>| {
        assert_eq!(a.len(), b.len(), "zelfde aantal waarden");
        let schaal = a.iter().chain(&b).map(|v| v.abs()).fold(1e-30, f64::max);
        for (x, y) in a.iter().zip(&b) { uit = uit.max((x - y).abs() / schaal); }
    };
    let verplaatsing = |r: &SolveResult3D| r.displacements.iter().flat_map(|d| [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz]).collect::<Vec<_>>();
    vergelijk(verplaatsing(p), verplaatsing(q));
    let reacties = |r: &SolveResult3D| r.reactions.iter().flat_map(|d| [d.fx, d.fy, d.fz, d.mx, d.my, d.mz]).collect::<Vec<_>>();
    vergelijk(reacties(p), reacties(q));
    uit
}

/// Trek-alleen met een eigen axiale lijnlast: de status kijkt bij uit- én
/// weer inschakelen naar de normaalkracht van de kern zonder N_vast. Een
/// globale Z-last op een schuine trekdiagonaal zet het onderste einde
/// plaatselijk op druk (N_vast = q_x·(L/2 − x)), maar de diagonaal als geheel
/// staat op trek en blijft actief. De uitkomst is die van de gelijkwaardige
/// last (lokaal qz plus het axiale deel als knooplasten), die de kern met een
/// constante N rekent: dezelfde verplaatsingen, reacties en set actieve
/// staven, en N = N_gelijkwaardig + q_x·(L/2 − x).
///
/// Portaal trek4 (5 × 4 m, stijf, H = 10 kN, q = −7 kN/m): gemiddelde N ≈
/// 12,759 kN trek, N van −1,24 tot 26,76 kN. Portaal p6 (4 × 3 m, stijf,
/// H = 2 kN, q = −2 kN/m) en trek4 met q = −10 en in tweede orde idem. Vóór
/// deze regel bleef de diagonaal tussen trek en druk wisselen.
#[test]
fn trek_alleen_status_zonder_eigen_axiale_last() {
    for (naam, b, h, h_kracht, q, analyse) in [
        ("trek4 q = −7", 5.0, 4.0, 10.0, -7.0, AnalysisKind::Linear),
        ("trek4 q = −10", 5.0, 4.0, 10.0, -10.0, AnalysisKind::Linear),
        ("trek4 q = −7, tweede orde", 5.0, 4.0, 10.0, -7.0, AnalysisKind::PDelta),
        ("p6", 4.0, 3.0, 2.0, -2.0, AnalysisKind::Linear),
    ] {
        let mut basis = portaal_met_trekdiagonaal(b, h, h_kracht, true, false);
        basis.analysis = analyse;
        let (gelijk, qx, l) = met_gelijkwaardige_last(&basis, b, h, q);
        let mut request = basis;
        request.member_loads.push(globaal(1, 4, GlobalDirection3D::Z, [q, q], None, false));
        let r = solve(request).unwrap_or_else(|fout| panic!("{naam}: {fout}"));
        let v = solve(gelijk).unwrap_or_else(|fout| panic!("{naam}, gelijkwaardig: {fout}"));
        assert!(r.inactive_members.is_empty() && v.inactive_members.is_empty(), "{naam}: de diagonaal doet mee");
        evenwicht_ok(&r, naam);
        let n_kern = krachten(&v, 4).n_start_kn;
        assert!(n_kern > 0.0, "{naam}: de diagonaal staat op trek ({n_kern})");
        let f = krachten(&r, 4);
        let schaal = n_kern.abs().max((qx * l / 2.0).abs());
        let n_einden = relatief(f.n_start_kn, n_kern + qx * l / 2.0, schaal)
            .max(relatief(f.n_end_kn, n_kern - qx * l / 2.0, schaal));
        let n_lijn = lijnafwijking(lijn(&r.diagrams.axial, 4), l, schaal, |x| n_kern + qx * (l / 2.0 - x));
        let knopen = verschil_knopen(&r, &v);
        eprintln!(
            "trek-alleen {naam}: N {:.3} → {:.3} kN (gemiddeld {:.3}), N-einden {n_einden:.2e}, N-lijn {n_lijn:.2e}, knopen {knopen:.2e}",
            f.n_start_kn, f.n_end_kn, (f.n_start_kn + f.n_end_kn) / 2.0,
        );
        grens(n_einden, 1e-9, "N aan de einden");
        grens(n_lijn, 1e-9, "N-lijn");
        grens(knopen, 1e-9, "verplaatsingen en reacties");
        assert!(f.n_start_kn < 0.0, "{naam}: het onderste einde staat plaatselijk op druk");
        assert!(
            r.diagnostics.iter().any(|d| d.contains("plaatselijk op druk") && d.contains("staaf 4")),
            "{naam}: melding over de plaatselijke druk: {:?}", r.diagnostics,
        );
        if naam == "trek4 q = −7" {
            assert!((n_kern - 12.759).abs() < 5e-4, "gemiddelde N {n_kern}");
        }
    }
}

/// Idem met een geknipte diagonaal (tussenknoop halverwege, verder nergens
/// aan vast): de kern rekent twee delen met elk een eigen N, die bij q = −14
/// in het onderste deel al op druk staat (12,76 − 14 kN). De status kijkt
/// naar de normaalkracht zonder N_vast van de hele staaf, hier het gemiddelde
/// 12,76 kN trek, net als het weer inschakelen; de diagonaal blijft actief.
#[test]
fn trek_alleen_status_bij_een_geknipte_diagonaal() {
    let (b, h, q) = (5.0, 4.0, -14.0);
    let mut basis = portaal_met_trekdiagonaal(b, h, 10.0, true, false);
    basis.nodes.push(knoop(5, b / 2.0, 0.0, h / 2.0));
    basis.members[3].intermediate_node_ids = vec![5];
    let (gelijk, qx, l) = met_gelijkwaardige_last(&basis, b, h, q);
    let mut request = basis;
    request.member_loads.push(globaal(1, 4, GlobalDirection3D::Z, [q, q], None, false));
    let mut r = solve(request).unwrap();
    let mut v = solve(gelijk).unwrap();
    assert!(r.inactive_members.is_empty() && v.inactive_members.is_empty(), "de diagonaal doet mee");
    evenwicht_ok(&r, "geknipte diagonaal");
    // De tussenknoop schuift anders langs de staaf (de gelijkwaardige last zet
    // het axiale deel alleen op de einden); de knopen 1–4 zijn exact.
    for uitkomst in [&mut r, &mut v] { uitkomst.displacements.retain(|d| d.node_id != 5); }
    let n_kern = krachten(&v, 4).n_start_kn;
    let f = krachten(&r, 4);
    let schaal = n_kern.abs().max((qx * l / 2.0).abs());
    let n_lijn = lijnafwijking(lijn(&r.diagrams.axial, 4), l, schaal, |x| n_kern + qx * (l / 2.0 - x));
    let knopen = verschil_knopen(&r, &v);
    eprintln!("trek-alleen geknipt q = {q}: N {:.3} → {:.3} kN, N-lijn {n_lijn:.2e}, knopen {knopen:.2e}", f.n_start_kn, f.n_end_kn);
    grens(n_lijn, 1e-9, "N-lijn geknipt");
    grens(knopen, 1e-9, "verplaatsingen en reacties geknipt");
    assert!((n_kern - 12.75).abs() < 0.05 && n_kern + qx * l / 4.0 < 0.0, "N {n_kern}: het onderste deel staat in de kern op druk");
    assert!(r.diagnostics.iter().any(|d| d.contains("plaatselijk op druk")), "melding: {:?}", r.diagnostics);
}

/// X-verband (portaal 5 × 4 m, scharnierende voeten en liggerhoeken, H =
/// 10 kN) met een globale Z-last op de trekdiagonaal 4: met alle staven actief
/// staat het onderste einde van 4 plaatselijk op druk (q = −3: N_begin ≈ −1,89
/// bij gemiddeld +4,11). Vroeger gingen dan beide diagonalen uit en werd het
/// model een mechanisme. Nu: diagonaal 5 inactief, 4 actief, stabiel en gelijk
/// aan de gelijkwaardige last.
#[test]
fn x_verband_met_globale_last_op_de_trekdiagonaal() {
    for q in [-3.0, -4.0] {
        let basis = portaal_met_trekdiagonaal(5.0, 4.0, 10.0, false, true);
        let (gelijk, qx, l) = met_gelijkwaardige_last(&basis, 5.0, 4.0, q);
        let mut request = basis;
        request.member_loads.push(globaal(1, 4, GlobalDirection3D::Z, [q, q], None, false));
        let r = solve(request).unwrap_or_else(|fout| panic!("X-verband q = {q}: {fout}"));
        let v = solve(gelijk).unwrap();
        assert_eq!(r.inactive_members, vec![5], "q = {q}: diagonaal 5 staat op druk");
        assert_eq!(v.inactive_members, vec![5], "q = {q}: gelijkwaardig");
        evenwicht_ok(&r, "X-verband");
        let n_kern = krachten(&v, 4).n_start_kn;
        let f = krachten(&r, 4);
        let schaal = n_kern.abs().max((qx * l / 2.0).abs());
        let n_einden = relatief(f.n_start_kn, n_kern + qx * l / 2.0, schaal)
            .max(relatief(f.n_end_kn, n_kern - qx * l / 2.0, schaal));
        let knopen = verschil_knopen(&r, &v);
        eprintln!("X-verband q = {q}: N4 {:.3} → {:.3} kN, N-einden {n_einden:.2e}, knopen {knopen:.2e}", f.n_start_kn, f.n_end_kn);
        grens(n_einden, 1e-9, "N aan de einden X-verband");
        grens(knopen, 1e-9, "verplaatsingen en reacties X-verband");
        assert!(n_kern > 0.0 && r.tension_only_rounds >= 2, "q = {q}: N {n_kern}, rondes {}", r.tension_only_rounds);
    }
}

/// (h) Oude verzoeken: een staafbelasting zonder de nieuwe velden leest en
/// schrijft byte-gelijk (geen nieuwe sleutels), en rekent als een lokale last.
#[test]
fn oude_verzoeken_blijven_gelijk() {
    let oud = r#"{"id":1,"memberId":1,"qyStartKnPerM":0.0,"qyEndKnPerM":0.0,"qzStartKnPerM":-4.0,"qzEndKnPerM":-4.0,"startPositionM":null,"endPositionM":null}"#;
    let last: MemberLoad3D = serde_json::from_str(oud).unwrap();
    assert_eq!(serde_json::to_string(&last).unwrap(), oud, "zelfde JSON terug");
    assert!(last.global_direction.is_none() && last.q_start_kn_per_m.is_none() && !last.per_projection);
    let verzoek_json = format!(r#"{{"schemaVersion":1,"analysis":"linear",
        "nodes":[{{"id":1,"x":0,"y":0,"z":0}},{{"id":2,"x":2,"y":0,"z":0}}],
        "materials":[{{"id":1,"name":"staal","eMpa":210000,"nu":0.3125}}],
        "sections":[{{"id":1,"name":"referentie","areaM2":0.01,"iyM4":8e-6,"izM4":12e-6,"torsionJM4":5e-6}}],
        "members":[{{"id":1,"startNodeId":1,"endNodeId":2,"materialId":1,"sectionId":1}}],
        "supports":[{{"nodeId":1,"ux":true,"uy":true,"uz":true,"rx":true,"ry":true,"rz":true}}],
        "memberLoads":[{oud}], "bucklingModes":0}}"#);
    let request: SolveRequest3D = serde_json::from_str(&verzoek_json).unwrap();
    let r = solve(request).unwrap();
    // wL⁴/(8·E·I_y), dezelfde waarde als in reference_cases.rs.
    let tip = r.displacements.iter().find(|d| d.node_id == 2).unwrap().uz;
    let afwijking = relatief(tip, -0.004761904761904762, 0.004761904761904762);
    eprintln!("(h) oud verzoek: doorbuiging {afwijking:.2e}");
    grens(afwijking, 1e-8, "oud verzoek");
}

/// Keuring: onbekende richting, niet-eindige waarden, lokale waarden bij een
/// globale last, ontbrekende intensiteit en globale velden zonder richting.
#[test]
fn keuring_van_globale_lasten() {
    let basis = || {
        verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 4.0, 0.0, 0.0)], vec![staaf(1, 1, 2)], vec![steun(1, INKLEMMING)])
    };
    let fout = |last: MemberLoad3D| {
        let mut request = basis();
        request.member_loads.push(last);
        solve(request).unwrap_err()
    };
    let json = r#"{"id":1,"memberId":1,"globalDirection":"w","qStartKnPerM":-1,"qEndKnPerM":-1}"#;
    let tekst = serde_json::from_str::<MemberLoad3D>(json).unwrap_err().to_string();
    assert!(tekst.contains("globalDirection") && tekst.contains("\"x\", \"y\" of \"z\""), "{tekst}");
    let hoofdletter = r#"{"id":1,"memberId":1,"globalDirection":"Z","qStartKnPerM":-1,"qEndKnPerM":-1}"#;
    assert!(serde_json::from_str::<MemberLoad3D>(hoofdletter).is_err(), "alleen x, y of z");
    let goed = r#"{"id":1,"memberId":1,"globalDirection":"z","qStartKnPerM":-1,"qEndKnPerM":-2,"perProjection":true}"#;
    let last: MemberLoad3D = serde_json::from_str(goed).unwrap();
    assert_eq!(last.global_direction, Some(GlobalDirection3D::Z));
    assert!(serde_json::to_string(&last).unwrap().contains(r#""globalDirection":"z""#));

    let tekst = fout(globaal(1, 1, GlobalDirection3D::Z, [f64::NAN, -1.0], None, false));
    assert!(tekst.contains("geen eindige waarde"), "{tekst}");
    let tekst = fout(globaal(1, 1, GlobalDirection3D::Z, [0.0, 0.0], None, false));
    assert!(tekst.contains("alleen nulwaarden"), "{tekst}");
    let mut gemengd = globaal(1, 1, GlobalDirection3D::Z, [-1.0, -1.0], None, false);
    gemengd.qz_start_kn_per_m = -1.0;
    let tekst = fout(gemengd);
    assert!(tekst.contains("globale last") && tekst.contains("lokale"), "{tekst}");
    let mut zonder = globaal(1, 1, GlobalDirection3D::Y, [-1.0, -1.0], None, false);
    zonder.q_end_kn_per_m = None;
    let tekst = fout(zonder);
    assert!(tekst.contains("qEndKnPerM"), "{tekst}");
    let mut los = lokaal(1, 1, [0.0, 0.0], [-1.0, -1.0], None);
    los.q_start_kn_per_m = Some(-1.0);
    let tekst = fout(los);
    assert!(tekst.contains("globalDirection"), "{tekst}");
    let mut projectie = lokaal(1, 1, [0.0, 0.0], [-1.0, -1.0], None);
    projectie.per_projection = true;
    let tekst = fout(projectie);
    assert!(tekst.contains("perProjection"), "{tekst}");
    let tekst = fout(globaal(1, 1, GlobalDirection3D::Z, [-1.0, -1.0], Some((1.0, 5.0)), false));
    assert!(tekst.contains("ongeldig bereik"), "{tekst}");
}
