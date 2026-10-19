//! Independent scalar equilibrium reference for a nonaffine Tet4 displacement.
//!
//! Only the interior node's x displacement is free. Its load therefore has a
//! one-dimensional equilibrium equation, even though 48 three-dimensional
//! tets with different moduli and nonlinear energy coefficients meet there.
//! We bracket that equation independently from element reference gradients and
//! compare every Green strain, first Piola stress, reaction and load reversal.
//! This probes a mixed force/displacement boundary without an affine patch.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_gnl::{
    solve, GnlTetLinearBackend, GnlTetMaterial, GnlTetOptions, GnlTetRequest, GnlTetTarget,
};

const LOADS_KN: [f64; 3] = [8_000.0, -4_000.0, 0.0];

fn close(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.3e}"
    );
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|i| a[i] - b[i])
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    (0..3).map(|i| a[i] * b[i]).sum()
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn geometry(mesh: &Mesh, tet: [usize; 4]) -> ([[f64; 3]; 4], f64) {
    let [a, b, c, d] = tet.map(|n| mesh.nodes[n]);
    let ab = sub(b, a);
    let ac = sub(c, a);
    let ad = sub(d, a);
    let det = dot(ab, cross(ac, ad));
    assert!(det > 0.0);
    let g1 = cross(ac, ad).map(|x| x / det);
    let g2 = cross(ad, ab).map(|x| x / det);
    let g3 = cross(ab, ac).map(|x| x / det);
    let g0 = std::array::from_fn(|i| -g1[i] - g2[i] - g3[i]);
    ([g0, g1, g2, g3], det / 6.0)
}

struct Reference {
    internal_kn: Vec<[f64; 3]>,
    green: Vec<[[f64; 3]; 3]>,
    piola: Vec<[[f64; 3]; 3]>,
    effective_e: Vec<f64>,
    energy_kn_m: f64,
}

fn reference(
    mesh: &Mesh,
    center: usize,
    displacement: f64,
    materials: &[GnlTetMaterial],
    betas: &[f64],
) -> Reference {
    let mut result = Reference {
        internal_kn: vec![[0.0; 3]; mesh.nodes.len()],
        green: Vec::with_capacity(mesh.tets.len()),
        piola: Vec::with_capacity(mesh.tets.len()),
        effective_e: Vec::with_capacity(mesh.tets.len()),
        energy_kn_m: 0.0,
    };
    for (element, &tet) in mesh.tets.iter().enumerate() {
        let (gradients, volume) = geometry(mesh, tet);
        let central_gradient = tet
            .iter()
            .position(|&node| node == center)
            .map(|local| gradients[local])
            .unwrap_or([0.0; 3]);
        let mut f = [[0.0; 3]; 3];
        for row in 0..3 {
            for col in 0..3 {
                f[row][col] = if row == col { 1.0 } else { 0.0 }
                    + if row == 0 {
                        displacement * central_gradient[col]
                    } else {
                        0.0
                    };
            }
        }
        assert!(dot(f[0], cross(f[1], f[2])) > 0.0);
        let green: [[f64; 3]; 3] = std::array::from_fn(|i| {
            std::array::from_fn(|j| {
                0.5 * ((0..3).map(|k| f[k][i] * f[k][j]).sum::<f64>()
                    - if i == j { 1.0 } else { 0.0 })
            })
        });
        let e = materials[element].e_mpa;
        let nu = materials[element].poisson;
        let lambda = e * nu / ((1.0 + nu) * (1.0 - 2.0 * nu));
        let mu = e / (2.0 * (1.0 + nu));
        let trace = (0..3).map(|i| green[i][i]).sum::<f64>();
        let s0: [[f64; 3]; 3] = std::array::from_fn(|i| {
            std::array::from_fn(|j| {
                2.0 * mu * green[i][j] + if i == j { lambda * trace } else { 0.0 }
            })
        });
        let w0 = 0.5
            * (0..3)
                .flat_map(|i| (0..3).map(move |j| green[i][j] * s0[i][j]))
                .sum::<f64>();
        let factor = 1.0 + betas[element] * w0 / e;
        let p: [[f64; 3]; 3] = std::array::from_fn(|i| {
            std::array::from_fn(|j| factor * (0..3).map(|k| f[i][k] * s0[k][j]).sum::<f64>())
        });
        for (local, &node) in tet.iter().enumerate() {
            for axis in 0..3 {
                result.internal_kn[node][axis] += 1_000.0
                    * volume
                    * (0..3)
                        .map(|j| p[axis][j] * gradients[local][j])
                        .sum::<f64>();
            }
        }
        result.green.push(green);
        result.piola.push(p);
        result.effective_e.push(e * factor);
        result.energy_kn_m += 1_000.0 * volume * (w0 + betas[element] * w0 * w0 / (2.0 * e));
    }
    result
}

fn scalar_root(
    mesh: &Mesh,
    center: usize,
    load_kn: f64,
    materials: &[GnlTetMaterial],
    betas: &[f64],
) -> f64 {
    let (mut low, mut high) = (-0.10, 0.10);
    let force = |q| reference(mesh, center, q, materials, betas).internal_kn[center][0];
    assert!(force(low) < load_kn && force(high) > load_kn);
    for _ in 0..80 {
        let middle = 0.5 * (low + high);
        if force(middle) < load_kn {
            low = middle;
        } else {
            high = middle;
        }
    }
    0.5 * (low + high)
}

fn target(mesh: &Mesh, center: usize, load_kn: f64) -> GnlTetTarget {
    let mut loads_kn = vec![[0.0; 3]; mesh.nodes.len()];
    loads_kn[center][0] = load_kn;
    let mut prescribed_m = vec![[Some(0.0); 3]; mesh.nodes.len()];
    prescribed_m[center][0] = None;
    GnlTetTarget {
        loads_kn,
        prescribed_m,
        body_forces: vec![],
        face_tractions: vec![],
    }
}

#[test]
fn nonaffine_mixed_boundary_matches_scalar_energy_equilibrium_on_reversal() {
    let mesh = Mesh::structured([2, 2, 2]).unwrap();
    assert_eq!(mesh.nodes.len(), 27);
    assert_eq!(mesh.tets.len(), 48);
    let center = mesh
        .nodes
        .iter()
        .position(|&point| point == [0.5, 0.5, 0.5])
        .unwrap();
    let materials: Vec<_> = mesh
        .tets
        .iter()
        .map(|tet| {
            let centroid = std::array::from_fn::<_, 3, _>(|axis| {
                tet.iter().map(|&node| mesh.nodes[node][axis]).sum::<f64>() / 4.0
            });
            GnlTetMaterial {
                e_mpa: if centroid[0] < 0.5 { 90.0 } else { 160.0 },
                poisson: if centroid[1] < 0.5 { 0.19 } else { 0.28 },
            }
        })
        .collect();
    let betas: Vec<_> = mesh
        .tets
        .iter()
        .enumerate()
        .map(|(element, _)| if element % 2 == 0 { 8.0 } else { 30.0 })
        .collect();

    for backend in [
        GnlTetLinearBackend::Dense,
        GnlTetLinearBackend::SparseDirect,
        GnlTetLinearBackend::SparseGmres,
        GnlTetLinearBackend::FrontalWave,
        GnlTetLinearBackend::Automatic,
    ] {
        for prefix in 1..=LOADS_KN.len() {
            let load = LOADS_KN[prefix - 1];
            let expected_q = scalar_root(&mesh, center, load, &materials, &betas);
            let independent = reference(&mesh, center, expected_q, &materials, &betas);
            let result = solve(&GnlTetRequest {
                mesh: mesh.clone(),
                e_mpa: 100.0,
                poisson: 0.2,
                element_materials: Some(materials.clone()),
                element_energy_beta: Some(betas.clone()),
                targets: LOADS_KN[..prefix]
                    .iter()
                    .map(|&value| target(&mesh, center, value))
                    .collect(),
                options: GnlTetOptions {
                    linear_backend: backend,
                    ..GnlTetOptions::default()
                },
            })
            .unwrap();
            assert_eq!(
                result.accepted_steps.last().unwrap().target_index,
                prefix - 1
            );
            assert!(result.true_free_residual_kn < 1e-5);
            close(
                result.nodal_displacements_m[center][0],
                expected_q,
                2e-9,
                &format!("{backend:?} target {prefix} center displacement"),
            );
            for node in 0..mesh.nodes.len() {
                for axis in 0..3 {
                    let expected_reaction = if node == center && axis == 0 {
                        0.0
                    } else {
                        independent.internal_kn[node][axis]
                    };
                    close(
                        result.nodal_reactions_kn[node][axis],
                        expected_reaction,
                        2e-4,
                        &format!("{backend:?} target {prefix} reaction {node}/{axis}"),
                    );
                }
            }
            for element in 0..mesh.tets.len() {
                close(
                    result.element_effective_e_mpa[element],
                    independent.effective_e[element],
                    2e-6,
                    &format!("{backend:?} target {prefix} effective E {element}"),
                );
                for i in 0..3 {
                    for j in 0..3 {
                        close(
                            result.element_green_strain[element][i][j],
                            independent.green[element][i][j],
                            2e-8,
                            &format!("{backend:?} target {prefix} Green {element}/{i}/{j}"),
                        );
                        close(
                            result.element_first_piola_mpa[element][i][j],
                            independent.piola[element][i][j],
                            2e-5,
                            &format!("{backend:?} target {prefix} Piola {element}/{i}/{j}"),
                        );
                    }
                }
            }

            // The independently integrated potential must differentiate to the
            // center force, including the nonlinear beta contribution.
            let step = 1e-6;
            let numerical_force = (reference(&mesh, center, expected_q + step, &materials, &betas)
                .energy_kn_m
                - reference(&mesh, center, expected_q - step, &materials, &betas).energy_kn_m)
                / (2.0 * step);
            close(
                numerical_force,
                load,
                1e-4,
                &format!("{backend:?} target {prefix} energy derivative"),
            );
        }
    }
}
