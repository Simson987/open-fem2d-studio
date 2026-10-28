//! NAFEMS LE10 (dikke plaat onder druk) met het eigen Hex8-volume-element, issue #217.
//!
//! Bron: NAFEMS, *The Standard NAFEMS Benchmarks*, TNSB Rev. 3 (1990), test LE10, zoals
//! gereproduceerd in de ESRD *Benchmarks Guide — Standard NAFEMS Benchmarks: Linear Elastic
//! Tests* (2018), blz. 29, en in de validatiecases van COMSOL ("Thick Plate Stress Analysis") en
//! SimScale ("Thick plate under pressure"), die ook de coördinaten van D geven.
//!
//! Probleem: kwart elliptische ringplaat tussen (x/2)² + y² = 1 en (x/3,25)² + (y/2,75)² = 1,
//! dikte 0,6 m (z = 0 … 0,6), E = 210 GPa, ν = 0,3, druk 1 MPa op het bovenvlak (−z).
//! Randvoorwaarden: u_y = 0 op y = 0 (vlak DCD'C'), u_x = 0 op x = 0 (vlak ABA'B'),
//! u_x = u_y = 0 op het buitenvlak BCB'C', u_z = 0 op de lijn waar het buitenvlak het middenvlak
//! (z = 0,3) snijdt. Doel: σ_yy in D (2; 0; 0,6) = −5,38 MPa.
//!
//! Tolerantie (vooraf): 5 %. Het doel heeft drie cijfers; geconvergeerde volumemodellen landen
//! zelf 0,6–2,6 % onder het doel (ESRD −5,25; Code_Aster via SimScale −5,34/−5,35), en het
//! element is een volledig geïntegreerde trilineaire Hex8 zonder incompatibele modes, dus met
//! afschuifvergrendeling bij buiging op grove netten.
//!
//! Gemeten waarde: de Gauss-puntspanningen van het hoekelement bij D, trilineair geëxtrapoleerd
//! naar de hoekknoop D (D ligt op de rand van het domein en hoort bij één element). Ter
//! vergelijking wordt ook de waarde in het dichtstbijzijnde Gauss-punt afgedrukt.
//!
//! Netreeks: afgebeeld net (radiaal × hoek × dikte). De geëxtrapoleerde waarde hangt vooral af
//! van het aantal lagen over de dikte (bij 8 lagen +5,5 %, bij 32 lagen +2,6 %); de toets staat
//! op het fijnste net van de reeks. Het dichtstbijzijnde Gauss-punt (een halve elementhoogte onder
//! het oppervlak) ligt op dat net op −5,18 MPa.

use openaec_native_fem::volume_hex8::{
    solve_hex8_volume, Hex8LinearBackend, Hex8VolumeCell, Hex8VolumeLoad, Hex8VolumeMaterial,
    Hex8VolumeRequest, Hex8VolumeSupport,
};

const TARGET_MPA: f64 = -5.38;
const TOLERANCE: f64 = 0.05;

/// Knoop op (radiaal i, hoek j, hoogte k) van het afgebeelde net.
fn point(i: usize, j: usize, k: usize, n: [usize; 3]) -> [f64; 3] {
    let [nr, nt, nz] = n;
    let theta = std::f64::consts::FRAC_PI_2 * j as f64 / nt as f64;
    let s = i as f64 / nr as f64;
    let inner = [2.0 * theta.cos(), theta.sin()];
    let outer = [3.25 * theta.cos(), 2.75 * theta.sin()];
    [
        inner[0] + s * (outer[0] - inner[0]),
        inner[1] + s * (outer[1] - inner[1]),
        0.6 * k as f64 / nz as f64,
    ]
}

/// ∫N_a dA van een vlakke bilineaire vierhoek in het xy-vlak (2×2 Gauss, exact).
fn top_face_weights(p: [[f64; 2]; 4]) -> [f64; 4] {
    let g = 1.0 / 3.0_f64.sqrt();
    let mut w = [0.0; 4];
    for (xi, eta) in [(-g, -g), (g, -g), (g, g), (-g, g)] {
        let n = [
            0.25 * (1.0 - xi) * (1.0 - eta), 0.25 * (1.0 + xi) * (1.0 - eta),
            0.25 * (1.0 + xi) * (1.0 + eta), 0.25 * (1.0 - xi) * (1.0 + eta),
        ];
        let dxi = [-0.25 * (1.0 - eta), 0.25 * (1.0 - eta), 0.25 * (1.0 + eta), -0.25 * (1.0 + eta)];
        let deta = [-0.25 * (1.0 - xi), -0.25 * (1.0 + xi), 0.25 * (1.0 + xi), 0.25 * (1.0 - xi)];
        let mut j = [[0.0; 2]; 2];
        for a in 0..4 {
            j[0][0] += dxi[a] * p[a][0];
            j[0][1] += dxi[a] * p[a][1];
            j[1][0] += deta[a] * p[a][0];
            j[1][1] += deta[a] * p[a][1];
        }
        let det = j[0][0] * j[1][1] - j[0][1] * j[1][0];
        for a in 0..4 { w[a] += n[a] * det; }
    }
    w
}

struct Outcome {
    sigma_yy_d: f64,
    sigma_yy_nearest_gauss: f64,
    sum_rz: f64,
    applied_kn: f64,
    elements: usize,
}

fn le10(n: [usize; 3]) -> Outcome {
    let [nr, nt, nz] = n;
    assert!(nz % 2 == 0, "het middenvlak z = 0,3 moet een knoopvlak zijn");
    let id = |i: usize, j: usize, k: usize| i + (nr + 1) * (j + (nt + 1) * k);
    let mut nodes = vec![[0.0; 3]; (nr + 1) * (nt + 1) * (nz + 1)];
    for k in 0..=nz {
        for j in 0..=nt {
            for i in 0..=nr {
                nodes[id(i, j, k)] = point(i, j, k, n);
            }
        }
    }
    let mut elements = Vec::new();
    for k in 0..nz {
        for j in 0..nt {
            for i in 0..nr {
                // Volgorde (000, 100, 110, 010, 001, 101, 111, 011) in (radiaal, hoek, hoogte):
                // rechtshandig, want bij θ = 0 wijzen die richtingen langs +x, +y en +z.
                elements.push(Hex8VolumeCell {
                    nodes: [
                        id(i, j, k), id(i + 1, j, k), id(i + 1, j + 1, k), id(i, j + 1, k),
                        id(i, j, k + 1), id(i + 1, j, k + 1), id(i + 1, j + 1, k + 1), id(i, j + 1, k + 1),
                    ],
                    material: 0,
                });
            }
        }
    }
    // Druk 1 MPa = 1000 kN/m² omlaag op het bovenvlak, consistent verdeeld.
    let mut force = vec![0.0; nodes.len()];
    for j in 0..nt {
        for i in 0..nr {
            let ids = [id(i, j, nz), id(i + 1, j, nz), id(i + 1, j + 1, nz), id(i, j + 1, nz)];
            let p = ids.map(|a| [nodes[a][0], nodes[a][1]]);
            for (a, w) in ids.iter().zip(top_face_weights(p)) { force[*a] -= 1000.0 * w; }
        }
    }
    let applied_kn: f64 = force.iter().sum();
    let loads = force.iter().enumerate()
        .filter(|(_, f)| **f != 0.0)
        .map(|(node, f)| Hex8VolumeLoad { node, force_kn: [0.0, 0.0, *f] })
        .collect();
    let mut fixed = vec![[None::<f64>; 3]; nodes.len()];
    for k in 0..=nz {
        for i in 0..=nr {
            fixed[id(i, 0, k)][1] = Some(0.0); // y = 0
            fixed[id(i, nt, k)][0] = Some(0.0); // x = 0
        }
        for j in 0..=nt {
            fixed[id(nr, j, k)][0] = Some(0.0); // buitenvlak
            fixed[id(nr, j, k)][1] = Some(0.0);
        }
    }
    for j in 0..=nt { fixed[id(nr, j, nz / 2)][2] = Some(0.0); } // lijn op het middenvlak
    let supports = fixed.iter().enumerate()
        .filter(|(_, d)| d.iter().any(Option::is_some))
        .map(|(node, d)| Hex8VolumeSupport { node, displacement_m: *d })
        .collect();
    let count = elements.len();
    let request = Hex8VolumeRequest {
        nodes,
        materials: vec![Hex8VolumeMaterial { e_mpa: 210_000.0, poisson: 0.3 }],
        elements,
        loads,
        body_forces: vec![],
        face_tractions: vec![],
        supports,
        tolerance: 1e-11,
        max_iterations: 20_000,
        structured_grid_cells: None,
        threads: 1,
        linear_backend: Hex8LinearBackend::Automatic,
    };
    let response = solve_hex8_volume(request).expect("LE10 rekent");
    // Hoekelement bij D: (i, j, k) = (0, 0, nz − 1); D is zijn lokale knoop (ξ, η, ζ) = (−1, −1, +1).
    let element = (nz - 1) * nt * nr;
    let gauss = response.element_gauss_stress_mpa[element];
    let r3 = 3.0_f64.sqrt();
    let target = [-r3, -r3, r3]; // D in de natuurlijke coördinaten van het Gauss-puntenrooster
    let mut sigma = 0.0;
    for (index, stress) in gauss.iter().enumerate() {
        let signs = [(index >> 2) & 1, (index >> 1) & 1, index & 1].map(|b| if b == 1 { 1.0 } else { -1.0 });
        let weight: f64 = (0..3).map(|a| 0.5 * (1.0 + signs[a] * target[a])).product();
        sigma += weight * stress[1];
    }
    // Gauss-punt (−, −, +) heeft index 4·0 + 2·0 + 1 = 1.
    let sum_rz = response.nodal_reactions_kn.iter().map(|r| r[2]).sum();
    Outcome { sigma_yy_d: sigma, sigma_yy_nearest_gauss: gauss[1][1], sum_rz, applied_kn, elements: count }
}

#[test]
fn nafems_le10_thick_plate_hex8() {
    // Bovenvlak: oppervlakte van de kwart elliptische ring = π/4·(3,25·2,75 − 2·1).
    let area = std::f64::consts::FRAC_PI_4 * (3.25 * 2.75 - 2.0);
    println!("NAFEMS LE10 — σyy in D (doel {TARGET_MPA} MPa), Hex8");
    println!("  net (r×θ×z) | elementen | σyy D geëxtrapoleerd | afwijking | dichtstbijzijnd Gauss-punt");
    let mut last = 0.0;
    for n in [[3, 6, 2], [6, 12, 4], [12, 24, 6], [16, 32, 8], [16, 32, 16], [16, 32, 32]] {
        let out = le10(n);
        println!(
            "  {:>2}×{:>2}×{:<2}    | {:>6}    | {:>8.3}             | {:+6.2} %  | {:>8.3}",
            n[0], n[1], n[2], out.elements, out.sigma_yy_d, 100.0 * (out.sigma_yy_d / TARGET_MPA - 1.0),
            out.sigma_yy_nearest_gauss,
        );
        // Evenwicht: de verticale reacties dragen de hele druk op het (gefacetteerde) bovenvlak,
        // en die is bij verfijning de exacte oppervlakte maal 1 MPa.
        assert!((out.sum_rz + out.applied_kn).abs() < 1e-6 * out.applied_kn.abs(), "Σ Rz = {} kN", out.sum_rz);
        assert!((-out.applied_kn / (1000.0 * area) - 1.0).abs() < 0.02, "last {} kN", out.applied_kn);
        last = out.sigma_yy_d;
    }
    assert!((last / TARGET_MPA - 1.0).abs() < TOLERANCE, "LE10: σyy = {last:.3} MPa, doel {TARGET_MPA}");
}
