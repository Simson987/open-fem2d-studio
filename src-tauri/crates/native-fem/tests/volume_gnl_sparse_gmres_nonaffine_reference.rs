//! Independent nonaffine Tet4 reference for the sparse GNL Newton backend.
//!
//! The large case exceeds both existing direct-solver limits (900 DOF and
//! 1200 tets), has 1008 free DOFs, perturbed interior geometry, heterogeneous
//! St Venant–Kirchhoff materials and nonuniform dead loads. The checks rebuild
//! reference gradients and external forces from the request, then derive the
//! Green strain, Piola stress, reactions and virtual work without invoking the
//! production element routine. A central energy difference checks that the
//! reconstructed first Piola stress is the derivative of the stated energy.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_gnl::{
    solve, GnlTetBodyForce, GnlTetFaceTraction, GnlTetLinearBackend, GnlTetMaterial, GnlTetOptions,
    GnlTetRequest, GnlTetResult, GnlTetTarget,
};

fn close(actual: f64, expected: f64, absolute: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= absolute,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, tolerance={absolute:.3e}"
    );
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn norm(values: impl IntoIterator<Item = f64>) -> f64 {
    values
        .into_iter()
        .map(|value| value * value)
        .sum::<f64>()
        .sqrt()
}

fn reference_geometry(mesh: &Mesh, tet: [usize; 4]) -> ([[f64; 3]; 4], f64) {
    let [a, b, c, d] = tet.map(|node| mesh.nodes[node]);
    let ab = sub(b, a);
    let ac = sub(c, a);
    let ad = sub(d, a);
    let det = dot(ab, cross(ac, ad));
    assert!(det > 1e-12, "inverted or degenerate reference Tet4");
    let g1 = cross(ac, ad).map(|value| value / det);
    let g2 = cross(ad, ab).map(|value| value / det);
    let g3 = cross(ab, ac).map(|value| value / det);
    let g0 = std::array::from_fn(|axis| -g1[axis] - g2[axis] - g3[axis]);
    ([g0, g1, g2, g3], det / 6.0)
}

fn perturbed_mesh(cells: [usize; 3]) -> Mesh {
    let mut mesh = Mesh::structured(cells).unwrap();
    for point in &mut mesh.nodes {
        let [x, y, z] = *point;
        if x > 0.0 && x < 1.0 && y > 0.0 && y < 1.0 && z > 0.0 && z < 1.0 {
            point[0] += 0.006 * (11.0 * x + 5.0 * y - 7.0 * z).sin();
            point[1] += 0.005 * (7.0 * x - 13.0 * y + 3.0 * z).cos();
            point[2] += 0.004 * (5.0 * x + 9.0 * y + 17.0 * z).sin();
        }
    }
    mesh
}

fn end_faces(mesh: &Mesh) -> Vec<(usize, [usize; 3])> {
    let mut faces = Vec::new();
    for (element, tet) in mesh.tets.iter().enumerate() {
        for face in [
            [tet[0], tet[1], tet[2]],
            [tet[0], tet[1], tet[3]],
            [tet[0], tet[2], tet[3]],
            [tet[1], tet[2], tet[3]],
        ] {
            if face.iter().all(|&node| mesh.nodes[node][0] == 1.0) {
                faces.push((element, face));
            }
        }
    }
    faces
}

fn request(mesh: Mesh, backend: GnlTetLinearBackend) -> GnlTetRequest {
    let element_materials = mesh
        .tets
        .iter()
        .map(|tet| {
            let center_y = tet.iter().map(|&node| mesh.nodes[node][1]).sum::<f64>() / 4.0;
            if center_y < 0.5 {
                GnlTetMaterial {
                    e_mpa: 120.0,
                    poisson: 0.18,
                }
            } else {
                GnlTetMaterial {
                    e_mpa: 170.0,
                    poisson: 0.23,
                }
            }
        })
        .collect();
    let element_energy_beta = Some(
        mesh.tets
            .iter()
            .map(|tet| {
                let center_z = tet.iter().map(|&node| mesh.nodes[node][2]).sum::<f64>() / 4.0;
                if center_z < 0.5 {
                    8.0
                } else {
                    24.0
                }
            })
            .collect(),
    );
    let body_forces = mesh
        .tets
        .iter()
        .enumerate()
        .map(|(element, tet)| {
            let center = std::array::from_fn::<_, 3, _>(|axis| {
                tet.iter().map(|&node| mesh.nodes[node][axis]).sum::<f64>() / 4.0
            });
            GnlTetBodyForce {
                element,
                force_kn_per_m3: [30.0 * center[0], -12.0 * center[1], 8.0 * center[2]],
            }
        })
        .collect();
    let face_tractions = end_faces(&mesh)
        .into_iter()
        .map(|(element, face_nodes)| {
            let center = std::array::from_fn::<_, 3, _>(|axis| {
                face_nodes
                    .iter()
                    .map(|&node| mesh.nodes[node][axis])
                    .sum::<f64>()
                    / 3.0
            });
            GnlTetFaceTraction {
                element,
                face_nodes,
                traction_kn_per_m2: [
                    1_400.0 * (1.0 + 0.2 * center[1]),
                    180.0 * center[2],
                    -130.0 * center[1],
                ],
            }
        })
        .collect();
    let target = GnlTetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        prescribed_m: mesh
            .nodes
            .iter()
            .map(|point| {
                if point[0] == 0.0 {
                    [Some(0.0); 3]
                } else {
                    [None; 3]
                }
            })
            .collect(),
        body_forces,
        face_tractions,
    };
    GnlTetRequest {
        mesh,
        e_mpa: 120.0,
        poisson: 0.2,
        element_materials: Some(element_materials),
        element_energy_beta,
        targets: vec![target],
        options: GnlTetOptions {
            linear_backend: backend,
            ..GnlTetOptions::default()
        },
    }
}

fn external_nodal_forces(request: &GnlTetRequest) -> Vec<[f64; 3]> {
    let target = request.targets.last().unwrap();
    let mut external = target.loads_kn.clone();
    for body in &target.body_forces {
        let tet = request.mesh.tets[body.element];
        let (_, volume) = reference_geometry(&request.mesh, tet);
        for node in tet {
            for axis in 0..3 {
                external[node][axis] += volume * body.force_kn_per_m3[axis] / 4.0;
            }
        }
    }
    for face in &target.face_tractions {
        let [a, b, c] = face.face_nodes.map(|node| request.mesh.nodes[node]);
        let area = norm(cross(sub(b, a), sub(c, a))) / 2.0;
        for node in face.face_nodes {
            for axis in 0..3 {
                external[node][axis] += area * face.traction_kn_per_m2[axis] / 3.0;
            }
        }
    }
    external
}

/// Return independently reconstructed P, E, effective E and energy density.
fn element_state(
    request: &GnlTetRequest,
    tet: [usize; 4],
    element: usize,
    displacements: &[[f64; 3]],
    gradients: [[f64; 3]; 4],
) -> ([[f64; 3]; 3], [[f64; 3]; 3], f64, f64) {
    let material = &request.element_materials.as_ref().unwrap()[element];
    let beta = request.element_energy_beta.as_ref().unwrap()[element];
    let young = material.e_mpa;
    let nu = material.poisson;
    let mu = young / (2.0 * (1.0 + nu));
    let lambda = young * nu / ((1.0 + nu) * (1.0 - 2.0 * nu));
    let mut f = [[0.0; 3]; 3];
    for spatial in 0..3 {
        for reference in 0..3 {
            f[spatial][reference] = if spatial == reference { 1.0 } else { 0.0 }
                + (0..4)
                    .map(|local| displacements[tet[local]][spatial] * gradients[local][reference])
                    .sum::<f64>();
        }
    }
    assert!(dot(f[0], cross(f[1], f[2])) > 0.0);
    let mut green = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            green[i][j] = 0.5
                * ((0..3).map(|a| f[a][i] * f[a][j]).sum::<f64>() - if i == j { 1.0 } else { 0.0 });
        }
    }
    let trace = (0..3).map(|i| green[i][i]).sum::<f64>();
    let mut s0 = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            s0[i][j] = 2.0 * mu * green[i][j] + if i == j { lambda * trace } else { 0.0 };
        }
    }
    let w0 = 0.5
        * (0..3)
            .flat_map(|i| (0..3).map(move |j| green[i][j] * s0[i][j]))
            .sum::<f64>();
    let factor = 1.0 + beta * w0 / young;
    let energy = w0 + beta * w0 * w0 / (2.0 * young);
    let p = std::array::from_fn(|a| {
        std::array::from_fn(|i| factor * (0..3).map(|j| f[a][j] * s0[j][i]).sum::<f64>())
    });
    (p, green, young * factor, energy)
}

fn total_energy(request: &GnlTetRequest, u: &[[f64; 3]]) -> f64 {
    request
        .mesh
        .tets
        .iter()
        .enumerate()
        .map(|(element, &tet)| {
            let (gradients, volume) = reference_geometry(&request.mesh, tet);
            let (_, _, _, energy) = element_state(request, tet, element, u, gradients);
            1_000.0 * volume * energy
        })
        .sum()
}

fn check_independent_reference(request: &GnlTetRequest, result: &GnlTetResult) {
    let mesh = &request.mesh;
    let external = external_nodal_forces(request);
    let mut internal = vec![[0.0; 3]; mesh.nodes.len()];
    let mut local_work = 0.0;
    let mut internal_energy = 0.0;
    for (element, &tet) in mesh.tets.iter().enumerate() {
        let (gradients, volume) = reference_geometry(mesh, tet);
        let (p, green, effective_e, energy_density) = element_state(
            request,
            tet,
            element,
            &result.nodal_displacements_m,
            gradients,
        );
        internal_energy += 1_000.0 * volume * energy_density;
        close(
            result.element_effective_e_mpa[element],
            effective_e,
            2e-8,
            "independent effective modulus",
        );
        for a in 0..3 {
            for i in 0..3 {
                close(
                    result.element_green_strain[element][a][i],
                    green[a][i],
                    2e-12,
                    "independent Green strain",
                );
                close(
                    result.element_first_piola_mpa[element][a][i],
                    p[a][i],
                    2e-8,
                    "independent first Piola stress",
                );
            }
        }
        for (local, &node) in tet.iter().enumerate() {
            for axis in 0..3 {
                let force = 1_000.0 * volume * dot(p[axis], gradients[local]);
                internal[node][axis] += force;
                local_work += force * result.nodal_displacements_m[node][axis];
            }
        }
    }
    close(
        total_energy(request, &result.nodal_displacements_m),
        internal_energy,
        1e-7,
        "independent total strain energy",
    );

    let mut free_residual_sq = 0.0;
    let mut total_external = [0.0; 3];
    let mut total_reaction = [0.0; 3];
    let mut moment = [0.0; 3];
    let mut nodal_work = 0.0;
    let mut external_work = 0.0;
    for node in 0..mesh.nodes.len() {
        let current = std::array::from_fn::<_, 3, _>(|axis| {
            mesh.nodes[node][axis] + result.nodal_displacements_m[node][axis]
        });
        let moment_force = cross(current, internal[node]);
        for axis in 0..3 {
            let reaction = internal[node][axis] - external[node][axis];
            close(
                result.nodal_reactions_kn[node][axis],
                reaction,
                3e-7,
                "independent nodal reaction",
            );
            if request.targets[0].prescribed_m[node][axis].is_none() {
                free_residual_sq += reaction * reaction;
            }
            total_external[axis] += external[node][axis];
            total_reaction[axis] += reaction;
            moment[axis] += moment_force[axis];
            nodal_work += result.nodal_displacements_m[node][axis] * internal[node][axis];
            external_work += result.nodal_displacements_m[node][axis] * external[node][axis];
        }
    }
    let free_residual = free_residual_sq.sqrt();
    close(
        free_residual,
        result.true_free_residual_kn,
        2e-7,
        "true free residual",
    );
    assert!(
        free_residual < 1e-5,
        "free force imbalance: {free_residual} kN"
    );
    close(
        nodal_work,
        local_work,
        2e-8,
        "local/global virtual work identity",
    );
    close(
        nodal_work,
        external_work,
        2e-7,
        "external/internal equilibrium work",
    );
    for axis in 0..3 {
        close(
            total_external[axis] + total_reaction[axis],
            0.0,
            1e-7,
            "global force balance",
        );
        close(moment[axis], 0.0, 2e-7, "current-geometry moment balance");
    }

    // Directional derivative of W against P:Grad(v), with a smooth virtual
    // displacement field that vanishes on the clamped plane.
    let virtual_u: Vec<[f64; 3]> = mesh
        .nodes
        .iter()
        .map(|&[x, y, z]| {
            [
                0.003 * x * (1.0 + 0.2 * y),
                0.002 * x * (z - 0.4),
                -0.0015 * x * (y + z),
            ]
        })
        .collect();
    let direction_work: f64 = internal
        .iter()
        .zip(&virtual_u)
        .map(|(force, direction)| dot(*force, *direction))
        .sum();
    let h = 1e-4;
    let plus: Vec<[f64; 3]> = result
        .nodal_displacements_m
        .iter()
        .zip(&virtual_u)
        .map(|(u, v)| std::array::from_fn(|axis| u[axis] + h * v[axis]))
        .collect();
    let minus: Vec<[f64; 3]> = result
        .nodal_displacements_m
        .iter()
        .zip(&virtual_u)
        .map(|(u, v)| std::array::from_fn(|axis| u[axis] - h * v[axis]))
        .collect();
    let energy_difference =
        (total_energy(request, &plus) - total_energy(request, &minus)) / (2.0 * h);
    close(
        energy_difference,
        direction_work,
        3e-5,
        "energy derivative vs Piola work",
    );
}

#[test]
fn gmres_matches_dense_on_small_nonaffine_heterogeneous_tet4() {
    let mesh = perturbed_mesh([2, 2, 2]);
    let dense = solve(&request(mesh.clone(), GnlTetLinearBackend::Dense)).unwrap();
    let gmres_request = request(mesh, GnlTetLinearBackend::SparseGmres);
    let gmres = solve(&gmres_request).unwrap();
    assert_eq!(gmres.linear_backend_used, GnlTetLinearBackend::SparseGmres);
    check_independent_reference(&gmres_request, &gmres);
    for (a, b) in gmres
        .nodal_displacements_m
        .iter()
        .zip(&dense.nodal_displacements_m)
    {
        for axis in 0..3 {
            close(a[axis], b[axis], 2e-9, "dense/GMRES displacement parity");
        }
    }
}

#[test]
fn gmres_nonaffine_1008_free_dof_tet4_balances_independently() {
    let mesh = perturbed_mesh([8, 6, 5]);
    assert_eq!(mesh.nodes.len() * 3, 1_134);
    assert_eq!(mesh.tets.len(), 1_440);
    let request = request(mesh, GnlTetLinearBackend::SparseGmres);
    let free_dofs = request.targets[0]
        .prescribed_m
        .iter()
        .flatten()
        .filter(|fixed| fixed.is_none())
        .count();
    assert_eq!(free_dofs, 1_008);
    let result = solve(&request).unwrap();
    assert_eq!(result.linear_backend_used, GnlTetLinearBackend::SparseGmres);
    assert_eq!(result.accepted_steps.last().unwrap().target_index, 0);
    assert!(
        result.accepted_steps.last().unwrap().newton_iterations >= 2,
        "the large reference must exercise nonlinear Newton corrections"
    );
    let axial_strains: Vec<f64> = result
        .element_green_strain
        .iter()
        .map(|strain| strain[0][0])
        .collect();
    let strain_spread = axial_strains
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max)
        - axial_strains.iter().copied().fold(f64::INFINITY, f64::min);
    assert!(strain_spread > 1e-4, "expected nonaffine strain field");
    let nonlinear_modulus_shift = result
        .element_effective_e_mpa
        .iter()
        .zip(request.element_materials.as_ref().unwrap())
        .map(|(&effective, material)| (effective - material.e_mpa).abs())
        .fold(0.0_f64, f64::max);
    assert!(
        nonlinear_modulus_shift > 1e-4,
        "the beta-dependent material path was not exercised"
    );
    close(
        result.accepted_steps.last().unwrap().target_fraction,
        1.0,
        1e-12,
        "full target",
    );
    check_independent_reference(&request, &result);
}
