//! Typed linear-elastic Hex8 volume routes: assembled CSR PCG/LDLT, frontal and matrix-free PCG.
//! Coordinates/displacements: m; E/stress: MPa; loads/reactions: kN.
//! Node order within each cell: 000, 100, 110, 010, 001, 101, 111, 011.

use serde::{Deserialize, Serialize};

use crate::csr::{CsrAssembler, PcgOptions};
use crate::csr_ldlt;
use crate::frontal::{self, FrontalElement, FrontalOptions};
use crate::hex8::Hex8Element;
use crate::hex8_loads::{consistent_uniform_body_force, consistent_uniform_face_traction};
use crate::hex8_matrix_free::{
    GeneralOperator, Mesh as StructuredHex8Mesh, Operator as StructuredHex8Operator,
};

const MAX_TRIPLET_ENTRIES: usize = 4_000_000;
// Natural-order LDLT can fill heavily on 3D meshes. Bound both the global
// dimension and the number of active/stored factor entries.
const MAX_SPARSE_DIRECT_DOFS: usize = 6_000;
const MAX_SPARSE_DIRECT_FACTOR_ENTRIES: usize = 1_000_000;
// The frontal implementation retains elimination rows and has a dense active
// front. Keep this path bounded; large structured grids use matrix-free PCG.
const MAX_FRONTAL_ELEMENTS: usize = 2_500;
const MAX_FRONTAL_DOFS: usize = 6_000;
const MAX_FRONTAL_FRONT_DOFS: usize = 256;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Hex8LinearBackend {
    #[default]
    Sparse,
    SparseDirect,
    FrontalWave,
    MatrixFreeGeneral,
    MatrixFreeGeneralLarge,
    /// Select assembled CSR while it fits the triplet budget, otherwise the
    /// bounded general matrix-free operator. A converged solve is never retried.
    Automatic,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hex8VolumeMaterial {
    pub e_mpa: f64,
    pub poisson: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hex8VolumeCell {
    pub nodes: [usize; 8],
    pub material: usize,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hex8VolumeLoad {
    pub node: usize,
    pub force_kn: [f64; 3],
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hex8VolumeBodyForce {
    pub element: usize,
    pub force_kn_per_m3: [f64; 3],
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hex8VolumeFaceTraction {
    pub element: usize,
    /// Outward cyclic local indices, such as [1,2,6,5] for the +x face.
    pub face_nodes: [usize; 4],
    pub traction_kn_per_m2: [f64; 3],
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hex8VolumeSupport {
    pub node: usize,
    /// `None` leaves the direction free; `Some(value)` prescribes metres.
    pub displacement_m: [Option<f64>; 3],
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hex8VolumeRequest {
    pub nodes: Vec<[f64; 3]>,
    pub materials: Vec<Hex8VolumeMaterial>,
    pub elements: Vec<Hex8VolumeCell>,
    #[serde(default)]
    pub loads: Vec<Hex8VolumeLoad>,
    #[serde(default)]
    pub body_forces: Vec<Hex8VolumeBodyForce>,
    #[serde(default)]
    pub face_tractions: Vec<Hex8VolumeFaceTraction>,
    #[serde(default)]
    pub supports: Vec<Hex8VolumeSupport>,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
    #[serde(default = "default_max_iterations")]
    pub max_iterations: usize,
    /// Select the reusable-stiffness structured fast path for an exact regular
    /// positive rectangular box from the origin in standard ordering. Requires
    /// the default `sparse` backend; general geometry uses `matrixFreeGeneral`
    /// or the explicitly larger `matrixFreeGeneralLarge` budget.
    #[serde(default)]
    pub structured_grid_cells: Option<[usize; 3]>,
    #[serde(default = "default_threads")]
    pub threads: usize,
    /// Optional bounded sparse LDLT, frontal direct solve, general-geometry
    /// matrix-free PCG (including an explicit larger cache), or automatic
    /// CSR/matrix-free selection with recovery.
    #[serde(default)]
    pub linear_backend: Hex8LinearBackend,
}

fn default_tolerance() -> f64 {
    1e-9
}

fn default_max_iterations() -> usize {
    2_000
}

fn default_threads() -> usize {
    1
}

fn automatic_backend(elements: usize, dofs: usize) -> Result<Hex8LinearBackend, String> {
    let triplets = elements
        .checked_mul(24 * 24)
        .ok_or("Hex8 triplet count overflow")?;
    if triplets <= MAX_TRIPLET_ENTRIES {
        Ok(Hex8LinearBackend::Sparse)
    } else if elements <= crate::hex8_matrix_free::MAX_GENERAL_ELEMENTS
        && dofs <= crate::hex8_matrix_free::MAX_GENERAL_DOFS
    {
        Ok(Hex8LinearBackend::MatrixFreeGeneral)
    } else {
        Err(format!(
            "Hex8 automatic backend exceeds the CSR {MAX_TRIPLET_ENTRIES}-triplet and general matrix-free {}/{} element/DOF limits",
            crate::hex8_matrix_free::MAX_GENERAL_ELEMENTS,
            crate::hex8_matrix_free::MAX_GENERAL_DOFS
        ))
    }
}

fn retryable_pcg_failure(error: &str) -> bool {
    error.starts_with("CSR PCG did not converge in ")
        || error.starts_with("Hex8 PCG did not converge in ")
        || error.starts_with("Hex8 true free residual ")
}

/// Exact free-DOF front width for the input element order. This uses only
/// connectivity and supports, so recovery never assembles a frontal matrix
/// when the 256-DOF wavefront bound cannot hold.
fn fits_frontal_recovery_front(request: &Hex8VolumeRequest, dofs: usize) -> bool {
    let mut fixed = vec![false; dofs];
    for support in &request.supports {
        for component in 0..3 {
            if support.displacement_m[component].is_some() {
                fixed[3 * support.node + component] = true;
            }
        }
    }
    let mut last = vec![None; dofs];
    for (element_index, element) in request.elements.iter().enumerate() {
        for &node in &element.nodes {
            for component in 0..3 {
                let dof = 3 * node + component;
                if !fixed[dof] {
                    last[dof] = Some(element_index);
                }
            }
        }
    }
    let mut active = vec![false; dofs];
    let mut front = 0;
    for (element_index, element) in request.elements.iter().enumerate() {
        for &node in &element.nodes {
            for component in 0..3 {
                let dof = 3 * node + component;
                if !fixed[dof] && !active[dof] {
                    active[dof] = true;
                    front += 1;
                }
            }
        }
        if front > MAX_FRONTAL_FRONT_DOFS {
            return false;
        }
        for &node in &element.nodes {
            for component in 0..3 {
                let dof = 3 * node + component;
                if active[dof] && last[dof] == Some(element_index) {
                    active[dof] = false;
                    front -= 1;
                }
            }
        }
    }
    true
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hex8VolumeResponse {
    pub nodal_displacements_m: Vec<[f64; 3]>,
    pub nodal_reactions_kn: Vec<[f64; 3]>,
    /// Per element, at each Gauss point: [xx, yy, zz, xy, yz, zx] in MPa.
    /// Gauss order has ξ outermost, η middle, ζ innermost; negative first.
    pub element_gauss_stress_mpa: Vec<[[f64; 6]; 8]>,
    pub iterations: usize,
    pub relative_residual: f64,
    pub csr_nonzeros: usize,
    pub solver_used: &'static str,
    pub threads: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frontal_maximum_front_dofs: Option<usize>,
}

pub(crate) fn stress_at_gauss(
    element: &Hex8Element,
    material: Hex8VolumeMaterial,
    u: [f64; 24],
) -> Result<[[f64; 6]; 8], String> {
    let e = material.e_mpa;
    let nu = material.poisson;
    let lambda = e * nu / ((1.0 + nu) * (1.0 - 2.0 * nu));
    let mu = e / (2.0 * (1.0 + nu));
    let mut stresses = [[0.0; 6]; 8];
    for (point, gradients) in element.gauss_gradients.iter().enumerate() {
        let mut du = [[0.0; 3]; 3];
        for node in 0..8 {
            for component in 0..3 {
                for axis in 0..3 {
                    du[component][axis] += u[3 * node + component] * gradients[node][axis];
                }
            }
        }
        let trace = du[0][0] + du[1][1] + du[2][2];
        stresses[point] = [
            lambda * trace + 2.0 * mu * du[0][0],
            lambda * trace + 2.0 * mu * du[1][1],
            lambda * trace + 2.0 * mu * du[2][2],
            mu * (du[0][1] + du[1][0]),
            mu * (du[1][2] + du[2][1]),
            mu * (du[2][0] + du[0][2]),
        ];
        if stresses[point].iter().any(|value| !value.is_finite()) {
            return Err("non-finite Hex8 Gauss-point stress".into());
        }
    }
    Ok(stresses)
}

fn solve_structured_hex8(
    request: &Hex8VolumeRequest,
    cells: [usize; 3],
) -> Result<Hex8VolumeResponse, String> {
    // In standard structured ordering, the last node is the opposite box
    // corner. Rebuild and compare every coordinate and cell exactly; malformed
    // or distorted meshes never enter the reusable-local-stiffness backend.
    let lengths = *request
        .nodes
        .last()
        .expect("nonempty mesh checked by caller");
    let mesh = StructuredHex8Mesh::structured_box(cells, lengths)?;
    if request.nodes != mesh.nodes
        || request.elements.len() != mesh.hexes.len()
        || request
            .elements
            .iter()
            .zip(&mesh.hexes)
            .any(|(cell, expected)| cell.nodes != *expected)
    {
        return Err(
            "matrix-free Hex8 requires exact rectangular structured coordinates and element order"
                .into(),
        );
    }
    let dofs = request.nodes.len() * 3;
    let mut loads = vec![0.0; dofs];
    for (index, load) in request.loads.iter().enumerate() {
        if load.node >= request.nodes.len() || load.force_kn.iter().any(|v| !v.is_finite()) {
            return Err(format!("Hex8 load {index} is invalid"));
        }
        for component in 0..3 {
            let dof = 3 * load.node + component;
            loads[dof] += load.force_kn[component];
            if !loads[dof].is_finite() {
                return Err(format!("Hex8 load {index}: nodal force overflow"));
            }
        }
    }
    for (index, body) in request.body_forces.iter().enumerate() {
        let cell = request
            .elements
            .get(body.element)
            .ok_or_else(|| format!("Hex8 body force {index}: element index outside mesh"))?;
        let coordinates = cell.nodes.map(|node| request.nodes[node]);
        let local = consistent_uniform_body_force(coordinates, body.force_kn_per_m3)
            .map_err(|error| format!("Hex8 body force {index}: {error}"))?;
        for (local_node, &global_node) in cell.nodes.iter().enumerate() {
            for component in 0..3 {
                let dof = 3 * global_node + component;
                loads[dof] += local[local_node][component];
                if !loads[dof].is_finite() {
                    return Err(format!("Hex8 body force {index}: nodal force overflow"));
                }
            }
        }
    }
    for (index, face) in request.face_tractions.iter().enumerate() {
        let cell = request
            .elements
            .get(face.element)
            .ok_or_else(|| format!("Hex8 face traction {index}: element index outside mesh"))?;
        let coordinates = cell.nodes.map(|node| request.nodes[node]);
        let local =
            consistent_uniform_face_traction(coordinates, face.face_nodes, face.traction_kn_per_m2)
                .map_err(|error| format!("Hex8 face traction {index}: {error}"))?;
        for (local_node, &global_node) in cell.nodes.iter().enumerate() {
            for component in 0..3 {
                let dof = 3 * global_node + component;
                loads[dof] += local[local_node][component];
                if !loads[dof].is_finite() {
                    return Err(format!("Hex8 face traction {index}: nodal force overflow"));
                }
            }
        }
    }
    let mut prescribed = Vec::new();
    let mut fixed = vec![false; dofs];
    for (index, support) in request.supports.iter().enumerate() {
        if support.node >= request.nodes.len()
            || support
                .displacement_m
                .iter()
                .flatten()
                .any(|v| !v.is_finite())
        {
            return Err(format!("Hex8 support {index} is invalid"));
        }
        for component in 0..3 {
            if let Some(value) = support.displacement_m[component] {
                let dof = 3 * support.node + component;
                if fixed[dof] {
                    return Err(format!(
                        "Hex8 support {index} duplicates a prescribed displacement"
                    ));
                }
                fixed[dof] = true;
                prescribed.push((dof, value));
            }
        }
    }
    if prescribed.is_empty() {
        return Err("Hex8 model has no prescribed displacement".into());
    }
    let materials: Vec<(f64, f64)> = request
        .materials
        .iter()
        .map(|material| (material.e_mpa, material.poisson))
        .collect();
    let material_indices: Vec<usize> = request.elements.iter().map(|cell| cell.material).collect();
    let operator = StructuredHex8Operator::new_with_materials(mesh, &materials, material_indices)?;
    let solved = operator.solve(
        &loads,
        &prescribed,
        request.threads,
        request.tolerance,
        request.max_iterations,
    )?;
    let element_gauss_stress_mpa = request
        .elements
        .iter()
        .map(|cell| {
            let mut u = [0.0; 24];
            for (local, &node) in cell.nodes.iter().enumerate() {
                u[3 * local..3 * local + 3]
                    .copy_from_slice(&solved.displacements[3 * node..3 * node + 3]);
            }
            stress_at_gauss(
                operator
                    .local_for_material(cell.material)
                    .expect("material index checked by operator constructor"),
                request.materials[cell.material],
                u,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Hex8VolumeResponse {
        nodal_displacements_m: solved
            .displacements
            .chunks_exact(3)
            .map(|u| [u[0], u[1], u[2]])
            .collect(),
        nodal_reactions_kn: solved
            .reactions
            .chunks_exact(3)
            .map(|f| [f[0], f[1], f[2]])
            .collect(),
        element_gauss_stress_mpa,
        iterations: solved.iterations,
        relative_residual: solved.relative_residual,
        csr_nonzeros: 0,
        solver_used: "matrixFree",
        threads: request.threads,
        frontal_maximum_front_dofs: None,
    })
}

fn solve_general_matrix_free_hex8(
    request: &Hex8VolumeRequest,
) -> Result<Hex8VolumeResponse, String> {
    let large = request.linear_backend == Hex8LinearBackend::MatrixFreeGeneralLarge;
    let dofs = request
        .nodes
        .len()
        .checked_mul(3)
        .ok_or("Hex8 DOF count overflow")?;
    crate::hex8_matrix_free::check_general_budget(request.elements.len(), dofs, large)?;
    let connectivity: Vec<[usize; 8]> = request.elements.iter().map(|cell| cell.nodes).collect();
    let materials: Vec<(f64, f64)> = request
        .materials
        .iter()
        .map(|material| (material.e_mpa, material.poisson))
        .collect();
    let material_indices: Vec<usize> = request.elements.iter().map(|cell| cell.material).collect();
    let operator = if large {
        GeneralOperator::new_large(
            request.nodes.clone(),
            connectivity,
            &materials,
            &material_indices,
        )?
    } else {
        GeneralOperator::new(
            request.nodes.clone(),
            connectivity,
            &materials,
            &material_indices,
        )?
    };
    let mut loads = vec![0.0; dofs];
    for (index, load) in request.loads.iter().enumerate() {
        if load.node >= request.nodes.len() || load.force_kn.iter().any(|v| !v.is_finite()) {
            return Err(format!("Hex8 load {index} is invalid"));
        }
        for component in 0..3 {
            let dof = 3 * load.node + component;
            loads[dof] += load.force_kn[component];
            if !loads[dof].is_finite() {
                return Err(format!("Hex8 load {index}: nodal force overflow"));
            }
        }
    }
    for (index, body) in request.body_forces.iter().enumerate() {
        let cell = request
            .elements
            .get(body.element)
            .ok_or_else(|| format!("Hex8 body force {index}: element index outside mesh"))?;
        let coordinates = cell.nodes.map(|node| request.nodes[node]);
        let local = consistent_uniform_body_force(coordinates, body.force_kn_per_m3)
            .map_err(|error| format!("Hex8 body force {index}: {error}"))?;
        for (local_node, &global_node) in cell.nodes.iter().enumerate() {
            for component in 0..3 {
                let dof = 3 * global_node + component;
                loads[dof] += local[local_node][component];
                if !loads[dof].is_finite() {
                    return Err(format!("Hex8 body force {index}: nodal force overflow"));
                }
            }
        }
    }
    for (index, face) in request.face_tractions.iter().enumerate() {
        let cell = request
            .elements
            .get(face.element)
            .ok_or_else(|| format!("Hex8 face traction {index}: element index outside mesh"))?;
        let coordinates = cell.nodes.map(|node| request.nodes[node]);
        let local =
            consistent_uniform_face_traction(coordinates, face.face_nodes, face.traction_kn_per_m2)
                .map_err(|error| format!("Hex8 face traction {index}: {error}"))?;
        for (local_node, &global_node) in cell.nodes.iter().enumerate() {
            for component in 0..3 {
                let dof = 3 * global_node + component;
                loads[dof] += local[local_node][component];
                if !loads[dof].is_finite() {
                    return Err(format!("Hex8 face traction {index}: nodal force overflow"));
                }
            }
        }
    }
    let mut prescribed = Vec::new();
    let mut fixed = vec![false; dofs];
    for (index, support) in request.supports.iter().enumerate() {
        if support.node >= request.nodes.len()
            || support
                .displacement_m
                .iter()
                .flatten()
                .any(|v| !v.is_finite())
        {
            return Err(format!("Hex8 support {index} is invalid"));
        }
        for component in 0..3 {
            if let Some(value) = support.displacement_m[component] {
                let dof = 3 * support.node + component;
                if fixed[dof] {
                    return Err(format!(
                        "Hex8 support {index} duplicates a prescribed displacement"
                    ));
                }
                fixed[dof] = true;
                prescribed.push((dof, value));
            }
        }
    }
    if prescribed.is_empty() {
        return Err("Hex8 model has no prescribed displacement".into());
    }
    crate::volume3d::supports_restrain_each_component(
        &request.nodes,
        &operator.hexes,
        &prescribed,
    )?;
    let solved = operator.solve(
        &loads,
        &prescribed,
        request.threads,
        request.tolerance,
        request.max_iterations,
    )?;
    let element_gauss_stress_mpa = request
        .elements
        .iter()
        .enumerate()
        .map(|(index, cell)| {
            let mut u = [0.0; 24];
            for (local, &node) in cell.nodes.iter().enumerate() {
                u[3 * local..3 * local + 3]
                    .copy_from_slice(&solved.displacements[3 * node..3 * node + 3]);
            }
            stress_at_gauss(
                &operator
                    .local_for_element(index)
                    .expect("element validated by operator"),
                request.materials[cell.material],
                u,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Hex8VolumeResponse {
        nodal_displacements_m: solved
            .displacements
            .chunks_exact(3)
            .map(|u| [u[0], u[1], u[2]])
            .collect(),
        nodal_reactions_kn: solved
            .reactions
            .chunks_exact(3)
            .map(|f| [f[0], f[1], f[2]])
            .collect(),
        element_gauss_stress_mpa,
        iterations: solved.iterations,
        relative_residual: solved.relative_residual,
        csr_nonzeros: 0,
        solver_used: if large {
            "matrixFreeGeneralLarge"
        } else {
            "matrixFreeGeneral"
        },
        threads: solved.threads,
        frontal_maximum_front_dofs: None,
    })
}

/// Assembles a global Hex8 stiffness, solves prescribed displacements and
/// nodal forces, and recovers all eight Gauss-point stresses for each cell.
pub fn solve_hex8_volume(request: Hex8VolumeRequest) -> Result<Hex8VolumeResponse, String> {
    if request.nodes.is_empty() || request.materials.is_empty() || request.elements.is_empty() {
        return Err("Hex8 mesh, materials and elements must be nonempty".into());
    }
    if request.nodes.iter().flatten().any(|v| !v.is_finite()) {
        return Err("Hex8 mesh contains a non-finite coordinate".into());
    }
    if !request.tolerance.is_finite()
        || !(0.0..1.0).contains(&request.tolerance)
        || request.max_iterations == 0
    {
        return Err("Hex8 tolerance must be in (0,1) and maxIterations positive".into());
    }
    for (index, material) in request.materials.iter().enumerate() {
        if !material.e_mpa.is_finite()
            || material.e_mpa <= 0.0
            || !material.poisson.is_finite()
            || !(0.0..0.5).contains(&material.poisson)
        {
            return Err(format!("Hex8 material {index} is invalid"));
        }
    }
    if let Some(cells) = request.structured_grid_cells {
        if request.linear_backend != Hex8LinearBackend::Sparse {
            return Err("Hex8 linearBackend cannot be combined with structuredGridCells".into());
        }
        return solve_structured_hex8(&request, cells);
    }
    if request.linear_backend == Hex8LinearBackend::Automatic {
        let dofs = request
            .nodes
            .len()
            .checked_mul(3)
            .ok_or("Hex8 DOF count overflow")?;
        let selected = automatic_backend(request.elements.len(), dofs)?;
        let can_retry = request.elements.len() <= MAX_FRONTAL_ELEMENTS && dofs <= MAX_FRONTAL_DOFS;
        let mut selected_request = request;
        selected_request.linear_backend = selected;
        let mut fallback_request = can_retry.then(|| selected_request.clone());
        match solve_hex8_volume(selected_request) {
            Ok(response) => return Ok(response),
            Err(error) if retryable_pcg_failure(&error) => {
                if let Some(mut fallback) = fallback_request.take() {
                    if fits_frontal_recovery_front(&fallback, dofs) {
                        fallback.linear_backend = Hex8LinearBackend::FrontalWave;
                        return solve_hex8_volume(fallback).map_err(|recovery_error| {
                            format!(
                                "Hex8 automatic {selected:?} failed: {error}; frontal recovery failed: {recovery_error}"
                            )
                        });
                    }
                }
                return Err(error);
            }
            Err(error) => return Err(error),
        }
    }
    if matches!(
        request.linear_backend,
        Hex8LinearBackend::MatrixFreeGeneral | Hex8LinearBackend::MatrixFreeGeneralLarge
    ) {
        return solve_general_matrix_free_hex8(&request);
    }
    let dofs = request
        .nodes
        .len()
        .checked_mul(3)
        .ok_or("Hex8 DOF count overflow")?;
    let triplet_entries = request
        .elements
        .len()
        .checked_mul(24 * 24)
        .ok_or("Hex8 triplet count overflow")?;
    let frontal = request.linear_backend == Hex8LinearBackend::FrontalWave;
    let sparse_direct = request.linear_backend == Hex8LinearBackend::SparseDirect;
    if sparse_direct && dofs > MAX_SPARSE_DIRECT_DOFS {
        return Err(format!(
            "Hex8 sparseDirect is limited to {MAX_SPARSE_DIRECT_DOFS} DOFs because sparse LDLT fill may grow sharply"
        ));
    }
    if frontal && (request.elements.len() > MAX_FRONTAL_ELEMENTS || dofs > MAX_FRONTAL_DOFS) {
        return Err(format!(
            "Hex8 frontalWave is limited to {MAX_FRONTAL_ELEMENTS} elements and {MAX_FRONTAL_DOFS} DOFs"
        ));
    }
    if !frontal && triplet_entries > MAX_TRIPLET_ENTRIES {
        return Err(format!(
            "Hex8 CSR assembly exceeds {MAX_TRIPLET_ENTRIES} triplet entries; use the matrix-free route for larger models"
        ));
    }
    let mut used = vec![false; request.nodes.len()];
    let mut assembler = if frontal {
        None
    } else {
        Some(CsrAssembler::new(dofs)?)
    };
    let mut frontal_elements = if frontal {
        Vec::with_capacity(request.elements.len())
    } else {
        Vec::new()
    };
    let mut local_elements = Vec::with_capacity(request.elements.len());
    for (index, cell) in request.elements.iter().enumerate() {
        let material = request
            .materials
            .get(cell.material)
            .ok_or_else(|| format!("Hex8 element {index} has an invalid material index"))?;
        if cell
            .nodes
            .iter()
            .enumerate()
            .any(|(i, node)| *node >= request.nodes.len() || cell.nodes[..i].contains(node))
        {
            return Err(format!(
                "Hex8 element {index} has duplicate or invalid nodes"
            ));
        }
        let coordinates = cell.nodes.map(|node| request.nodes[node]);
        let element = Hex8Element::new(coordinates, material.e_mpa, material.poisson)
            .map_err(|error| format!("Hex8 element {index}: {error}"))?;
        let global_dofs: Vec<usize> = cell
            .nodes
            .iter()
            .flat_map(|&node| (0..3).map(move |component| 3 * node + component))
            .collect();
        let values: Vec<f64> = element.stiffness.iter().flatten().copied().collect();
        if let Some(assembler) = &mut assembler {
            assembler.add_element(&global_dofs, &values)?;
        } else {
            frontal_elements.push(FrontalElement {
                dofs: global_dofs,
                stiffness: values,
            });
        }
        for &node in &cell.nodes {
            used[node] = true;
        }
        local_elements.push(element);
    }
    if used.contains(&false) {
        return Err("Hex8 mesh has a node unused by any element".into());
    }
    let matrix = assembler.map(CsrAssembler::build).transpose()?;
    let mut loads = vec![0.0; dofs];
    for (index, load) in request.loads.iter().enumerate() {
        if load.node >= request.nodes.len() || load.force_kn.iter().any(|v| !v.is_finite()) {
            return Err(format!("Hex8 load {index} is invalid"));
        }
        for component in 0..3 {
            loads[3 * load.node + component] += load.force_kn[component];
            if !loads[3 * load.node + component].is_finite() {
                return Err(format!(
                    "Hex8 load accumulation overflows at node {}",
                    load.node
                ));
            }
        }
    }
    for (index, body) in request.body_forces.iter().enumerate() {
        let cell = request
            .elements
            .get(body.element)
            .ok_or_else(|| format!("Hex8 body force {index}: element index outside mesh"))?;
        let coordinates = cell.nodes.map(|node| request.nodes[node]);
        let local = consistent_uniform_body_force(coordinates, body.force_kn_per_m3)
            .map_err(|error| format!("Hex8 body force {index}: {error}"))?;
        for (local_node, &global_node) in cell.nodes.iter().enumerate() {
            for component in 0..3 {
                let dof = 3 * global_node + component;
                loads[dof] += local[local_node][component];
                if !loads[dof].is_finite() {
                    return Err(format!("Hex8 body force {index}: nodal force overflow"));
                }
            }
        }
    }
    for (index, face) in request.face_tractions.iter().enumerate() {
        let cell = request
            .elements
            .get(face.element)
            .ok_or_else(|| format!("Hex8 face traction {index}: element index outside mesh"))?;
        let coordinates = cell.nodes.map(|node| request.nodes[node]);
        let local =
            consistent_uniform_face_traction(coordinates, face.face_nodes, face.traction_kn_per_m2)
                .map_err(|error| format!("Hex8 face traction {index}: {error}"))?;
        for (local_node, &global_node) in cell.nodes.iter().enumerate() {
            for component in 0..3 {
                let dof = 3 * global_node + component;
                loads[dof] += local[local_node][component];
                if !loads[dof].is_finite() {
                    return Err(format!("Hex8 face traction {index}: nodal force overflow"));
                }
            }
        }
    }
    let mut prescribed = vec![None; dofs];
    for (index, support) in request.supports.iter().enumerate() {
        if support.node >= request.nodes.len()
            || support
                .displacement_m
                .iter()
                .flatten()
                .any(|v| !v.is_finite())
        {
            return Err(format!("Hex8 support {index} is invalid"));
        }
        for component in 0..3 {
            if let Some(value) = support.displacement_m[component] {
                let slot = &mut prescribed[3 * support.node + component];
                if slot.replace(value).is_some() {
                    return Err(format!(
                        "Hex8 support {index} duplicates a prescribed displacement"
                    ));
                }
            }
        }
    }
    if prescribed.iter().all(Option::is_none) {
        return Err("Hex8 model has no prescribed displacement".into());
    }
    let constrained: Vec<(usize, f64)> = prescribed
        .iter()
        .enumerate()
        .filter_map(|(dof, value)| value.map(|value| (dof, value)))
        .collect();
    let connectivity: Vec<[usize; 8]> = request
        .elements
        .iter()
        .map(|element| element.nodes)
        .collect();
    crate::volume3d::supports_restrain_each_component(&request.nodes, &connectivity, &constrained)?;
    let fixed_u: Vec<f64> = prescribed.iter().map(|v| v.unwrap_or(0.0)).collect();
    let fixed_ku = if let Some(matrix) = &matrix {
        matrix.mul(&fixed_u)?
    } else {
        let mut ku = vec![0.0; dofs];
        for element in &frontal_elements {
            let width = element.dofs.len();
            for (row, &global_row) in element.dofs.iter().enumerate() {
                for (column, &global_column) in element.dofs.iter().enumerate() {
                    ku[global_row] +=
                        element.stiffness[row * width + column] * fixed_u[global_column];
                }
            }
        }
        ku
    };
    if fixed_ku.iter().any(|value| !value.is_finite()) {
        return Err("Hex8 prescribed-displacement internal force is non-finite".into());
    }
    let rhs_norm = (0..dofs)
        .filter(|&i| prescribed[i].is_none())
        .map(|i| loads[i] - fixed_ku[i])
        .fold(0.0_f64, f64::hypot);
    if !rhs_norm.is_finite() {
        return Err("Hex8 reduced right-hand-side norm is non-finite".into());
    }
    let (displacements, reactions, iterations, csr_nonzeros, solver_used, maximum_front) =
        if let Some(matrix) = matrix {
            if sparse_direct {
                let solved = csr_ldlt::solve_constrained_ldlt(
                    &matrix,
                    &loads,
                    &prescribed,
                    MAX_SPARSE_DIRECT_FACTOR_ENTRIES,
                )?;
                (
                    solved.displacements,
                    solved.reactions,
                    0,
                    matrix.nnz(),
                    "sparseDirect",
                    None,
                )
            } else {
                let solved = matrix.solve_constrained(
                    &loads,
                    &prescribed,
                    PcgOptions {
                        relative_tolerance: request.tolerance,
                        absolute_tolerance: 0.0,
                        max_iterations: request.max_iterations,
                    },
                )?;
                (
                    solved.displacements,
                    solved.reactions,
                    solved.iterations,
                    matrix.nnz(),
                    "sparse",
                    None,
                )
            }
        } else {
            let solved = frontal::solve(
                &frontal_elements,
                &loads,
                &prescribed,
                FrontalOptions {
                    max_front_dofs: MAX_FRONTAL_FRONT_DOFS,
                    ..FrontalOptions::default()
                },
            )?;
            (
                solved.displacements,
                solved.reactions,
                0,
                0,
                "frontalWave",
                Some(solved.maximum_front_dofs),
            )
        };
    let actual_norm = reactions
        .iter()
        .enumerate()
        .filter(|(i, _)| prescribed[*i].is_none())
        .map(|(_, reaction)| *reaction)
        .fold(0.0_f64, f64::hypot);
    let relative_residual = actual_norm / if rhs_norm > 0.0 { rhs_norm } else { 1.0 };
    if !relative_residual.is_finite() || relative_residual > 5.0 * request.tolerance {
        return Err(format!(
            "Hex8 true free residual {relative_residual:.3e} exceeds tolerance"
        ));
    }
    let element_gauss_stress_mpa = request
        .elements
        .iter()
        .zip(&local_elements)
        .map(|(cell, element)| {
            let mut u = [0.0; 24];
            for (local, &node) in cell.nodes.iter().enumerate() {
                u[3 * local..3 * local + 3].copy_from_slice(&displacements[3 * node..3 * node + 3]);
            }
            stress_at_gauss(element, request.materials[cell.material], u)
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Hex8VolumeResponse {
        nodal_displacements_m: displacements
            .chunks_exact(3)
            .map(|v| [v[0], v[1], v[2]])
            .collect(),
        nodal_reactions_kn: reactions
            .chunks_exact(3)
            .map(|v| [v[0], v[1], v[2]])
            .collect(),
        element_gauss_stress_mpa,
        iterations,
        relative_residual,
        csr_nonzeros,
        solver_used,
        threads: 1,
        frontal_maximum_front_dofs: maximum_front,
    })
}

/// Unit cube under σxx = 210 MPa, with traction on x=1 and minimal rigid-body
/// restraints on x=0. Its exact displacement is u=(0.001x,-0.0003y,-0.0003z).
pub fn uniaxial_cube_example() -> Hex8VolumeRequest {
    let nodes = vec![
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 1.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
        [1.0, 0.0, 1.0],
        [1.0, 1.0, 1.0],
        [0.0, 1.0, 1.0],
    ];
    let loads = [1, 2, 5, 6]
        .into_iter()
        .map(|node| Hex8VolumeLoad {
            node,
            force_kn: [52_500.0, 0.0, 0.0],
        })
        .collect();
    let mut supports: Vec<Hex8VolumeSupport> = [0, 3, 4, 7]
        .into_iter()
        .map(|node| Hex8VolumeSupport {
            node,
            displacement_m: [Some(0.0), None, None],
        })
        .collect();
    supports[0].displacement_m[1] = Some(0.0);
    supports[0].displacement_m[2] = Some(0.0);
    supports[1].displacement_m[2] = Some(0.0);
    Hex8VolumeRequest {
        nodes,
        materials: vec![Hex8VolumeMaterial {
            e_mpa: 210_000.0,
            poisson: 0.3,
        }],
        elements: vec![Hex8VolumeCell {
            nodes: [0, 1, 2, 3, 4, 5, 6, 7],
            material: 0,
        }],
        loads,
        body_forces: vec![],
        face_tractions: vec![],
        supports,
        tolerance: default_tolerance(),
        max_iterations: default_max_iterations(),
        structured_grid_cells: None,
        threads: default_threads(),
        linear_backend: Hex8LinearBackend::Sparse,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn automatic_backend_honors_both_assembly_budgets() {
        assert_eq!(
            automatic_backend(6_944, 60_000).unwrap(),
            Hex8LinearBackend::Sparse
        );
        assert_eq!(
            automatic_backend(6_945, 60_000).unwrap(),
            Hex8LinearBackend::MatrixFreeGeneral
        );
        assert!(
            automatic_backend(crate::hex8_matrix_free::MAX_GENERAL_ELEMENTS + 1, 60_000)
                .unwrap_err()
                .contains("limits")
        );
        assert!(
            automatic_backend(6_945, crate::hex8_matrix_free::MAX_GENERAL_DOFS + 1)
                .unwrap_err()
                .contains("limits")
        );
    }

    #[test]
    fn automatic_recovery_classifies_only_convergence_errors() {
        assert!(retryable_pcg_failure(
            "CSR PCG did not converge in 1 iterations"
        ));
        assert!(retryable_pcg_failure(
            "Hex8 PCG did not converge in 1 iterations"
        ));
        assert!(retryable_pcg_failure(
            "Hex8 true free residual 1e-2 exceeds tolerance"
        ));
        for failure in [
            "Hex8 element 0: inverted Jacobian",
            "Hex8 model has an unrestrained rigid-body mode",
            "non-positive or singular frontal pivot at DOF 2",
            "non-positive PCG curvature at iteration 1; singular or indefinite system",
        ] {
            assert!(!retryable_pcg_failure(failure), "{failure}");
        }
    }

    fn close(actual: f64, expected: f64, tolerance: f64) {
        assert!(
            (actual - expected).abs() <= tolerance,
            "actual {actual:e}, expected {expected:e}, tolerance {tolerance:e}"
        );
    }

    #[test]
    fn unloaded_disconnected_hex8_component_is_rejected() {
        let mut model = uniaxial_cube_example();
        let second: Vec<[f64; 3]> = model
            .nodes
            .iter()
            .map(|p| [p[0] + 3.0, p[1], p[2]])
            .collect();
        model.nodes.extend(second);
        model.elements.push(Hex8VolumeCell {
            nodes: [8, 9, 10, 11, 12, 13, 14, 15],
            material: 0,
        });
        model.loads.clear();
        let error = solve_hex8_volume(model).unwrap_err();
        assert!(
            error.contains("component") && error.contains("rigid-body"),
            "{error}"
        );
    }

    #[test]
    fn loaded_cube_matches_analytical_displacements_stress_and_reactions() {
        let model = uniaxial_cube_example();
        let nodes = model.nodes.clone();
        let solution = solve_hex8_volume(model).unwrap();
        assert!(solution.csr_nonzeros > 24);
        assert!(solution.relative_residual < 1e-9);
        for (i, point) in nodes.iter().enumerate() {
            let [x, y, z] = *point;
            let u = solution.nodal_displacements_m[i];
            close(u[0], 0.001 * x, 1e-11);
            close(u[1], -0.0003 * y, 1e-11);
            close(u[2], -0.0003 * z, 1e-11);
            for component in 0..3 {
                if x == 1.0 {
                    close(solution.nodal_reactions_kn[i][component], 0.0, 1e-5);
                }
            }
        }
        let left_reaction: f64 = [0, 3, 4, 7]
            .into_iter()
            .map(|node| solution.nodal_reactions_kn[node][0])
            .sum();
        close(left_reaction, -210_000.0, 1e-5);
        for stress in solution.element_gauss_stress_mpa[0] {
            close(stress[0], 210.0, 1e-6);
            for component in &stress[1..] {
                close(*component, 0.0, 1e-6);
            }
        }
    }

    #[test]
    fn distributed_cube_loads_produce_exact_reactions() {
        let mut model = uniaxial_cube_example();
        model.loads.clear();
        model.supports = (0..8)
            .map(|node| Hex8VolumeSupport {
                node,
                displacement_m: [Some(0.0); 3],
            })
            .collect();
        model.body_forces = vec![Hex8VolumeBodyForce {
            element: 0,
            force_kn_per_m3: [8.0, 0.0, 0.0],
        }];
        model.face_tractions = vec![Hex8VolumeFaceTraction {
            element: 0,
            face_nodes: [1, 2, 6, 5],
            traction_kn_per_m2: [4.0, 0.0, 0.0],
        }];
        let result = solve_hex8_volume(model).unwrap();
        for node in 0..8 {
            let expected = if [1, 2, 5, 6].contains(&node) {
                -2.0
            } else {
                -1.0
            };
            close(result.nodal_reactions_kn[node][0], expected, 1e-12);
        }
        close(
            result.nodal_reactions_kn.iter().map(|force| force[0]).sum(),
            -12.0,
            1e-12,
        );
    }

    #[test]
    fn inward_hex8_face_traction_is_rejected() {
        let mut model = uniaxial_cube_example();
        model.face_tractions = vec![Hex8VolumeFaceTraction {
            element: 0,
            face_nodes: [1, 5, 6, 2],
            traction_kn_per_m2: [1.0, 0.0, 0.0],
        }];
        assert!(solve_hex8_volume(model).unwrap_err().contains("face"));
    }

    #[test]
    fn two_cells_share_interface_and_carry_the_same_axial_stress() {
        let mut model = uniaxial_cube_example();
        model.nodes.extend_from_slice(&[
            [2.0, 0.0, 0.0],
            [2.0, 1.0, 0.0],
            [2.0, 0.0, 1.0],
            [2.0, 1.0, 1.0],
        ]);
        model.elements.push(Hex8VolumeCell {
            nodes: [1, 8, 9, 2, 5, 10, 11, 6],
            material: 0,
        });
        model.loads = [8, 9, 10, 11]
            .into_iter()
            .map(|node| Hex8VolumeLoad {
                node,
                force_kn: [52_500.0, 0.0, 0.0],
            })
            .collect();
        let nodes = model.nodes.clone();
        let solution = solve_hex8_volume(model).unwrap();
        assert_eq!(solution.element_gauss_stress_mpa.len(), 2);
        for (node, point) in nodes.iter().enumerate() {
            close(
                solution.nodal_displacements_m[node][0],
                0.001 * point[0],
                1e-11,
            );
            close(
                solution.nodal_displacements_m[node][1],
                -0.0003 * point[1],
                1e-11,
            );
            close(
                solution.nodal_displacements_m[node][2],
                -0.0003 * point[2],
                1e-11,
            );
        }
        for stress in solution.element_gauss_stress_mpa.iter().flatten() {
            close(stress[0], 210.0, 1e-6);
        }
        close(
            [0, 3, 4, 7]
                .into_iter()
                .map(|node| solution.nodal_reactions_kn[node][0])
                .sum(),
            -210_000.0,
            1e-5,
        );
    }

    #[test]
    fn duplicate_support_and_inverted_cell_are_rejected() {
        let mut model = uniaxial_cube_example();
        model.supports.push(Hex8VolumeSupport {
            node: 0,
            displacement_m: [Some(0.0), None, None],
        });
        assert!(solve_hex8_volume(model).unwrap_err().contains("duplicates"));
        let mut model = uniaxial_cube_example();
        for point in &mut model.nodes {
            point[0] = 1.0 - point[0];
        }
        assert!(solve_hex8_volume(model).unwrap_err().contains("inverted"));
    }

    #[test]
    fn no_support_and_unconnected_node_are_rejected() {
        let mut model = uniaxial_cube_example();
        model.supports.clear();
        assert!(solve_hex8_volume(model)
            .unwrap_err()
            .contains("no prescribed"));
        let mut model = uniaxial_cube_example();
        model.nodes.push([3.0, 3.0, 3.0]);
        assert!(solve_hex8_volume(model).unwrap_err().contains("unused"));
    }

    fn structured_parity_model() -> Hex8VolumeRequest {
        let mesh = StructuredHex8Mesh::structured([2, 2, 1]).unwrap();
        let supports = mesh
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, point)| point[0] == 0.0)
            .map(|(node, _)| Hex8VolumeSupport {
                node,
                displacement_m: [Some(1e-5), Some(0.0), Some(0.0)],
            })
            .collect();
        Hex8VolumeRequest {
            nodes: mesh.nodes.clone(),
            materials: vec![Hex8VolumeMaterial {
                e_mpa: 30_000.0,
                poisson: 0.25,
            }],
            elements: mesh
                .hexes
                .iter()
                .copied()
                .map(|nodes| Hex8VolumeCell { nodes, material: 0 })
                .collect(),
            loads: vec![Hex8VolumeLoad {
                node: mesh.hexes[3][6],
                force_kn: [3.0, -2.0, 1.0],
            }],
            body_forces: vec![Hex8VolumeBodyForce {
                element: 0,
                force_kn_per_m3: [5.0, -3.0, 2.0],
            }],
            face_tractions: vec![Hex8VolumeFaceTraction {
                element: 1,
                face_nodes: [1, 2, 6, 5],
                traction_kn_per_m2: [10.0, 1.0, -4.0],
            }],
            supports,
            tolerance: 1e-10,
            max_iterations: 2_000,
            structured_grid_cells: None,
            threads: 1,
            linear_backend: Hex8LinearBackend::Sparse,
        }
    }

    #[test]
    fn explicit_matrix_free_matches_csr_for_mixed_loads_and_nonzero_supports() {
        let model = structured_parity_model();
        let csr = solve_hex8_volume(model.clone()).unwrap();
        assert!(csr.csr_nonzeros > 0);
        assert_eq!(csr.solver_used, "sparse");
        assert_eq!(csr.threads, 1);
        let matrix_free = solve_hex8_volume(Hex8VolumeRequest {
            structured_grid_cells: Some([2, 2, 1]),
            threads: 4,
            ..model
        })
        .unwrap();
        assert_eq!(matrix_free.csr_nonzeros, 0);
        assert_eq!(matrix_free.solver_used, "matrixFree");
        assert_eq!(matrix_free.threads, 4);
        assert!(matrix_free.relative_residual < 1e-10);
        for (left, right) in csr
            .nodal_displacements_m
            .iter()
            .flatten()
            .zip(matrix_free.nodal_displacements_m.iter().flatten())
        {
            close(*left, *right, 1e-11);
        }
        for (left, right) in csr
            .nodal_reactions_kn
            .iter()
            .flatten()
            .zip(matrix_free.nodal_reactions_kn.iter().flatten())
        {
            close(*left, *right, 1e-6);
        }
        for (left, right) in csr.element_gauss_stress_mpa.iter().flatten().flatten().zip(
            matrix_free
                .element_gauss_stress_mpa
                .iter()
                .flatten()
                .flatten(),
        ) {
            close(*left, *right, 1e-7);
        }
    }

    #[test]
    fn rectangular_matrix_free_matches_csr_for_mixed_loads_and_stresses() {
        let mut model = structured_parity_model();
        let lengths = [2.0, 3.0, 4.0];
        for point in &mut model.nodes {
            for axis in 0..3 {
                point[axis] *= lengths[axis];
            }
        }
        let csr = solve_hex8_volume(model.clone()).unwrap();
        let matrix_free = solve_hex8_volume(Hex8VolumeRequest {
            structured_grid_cells: Some([2, 2, 1]),
            threads: 4,
            ..model
        })
        .unwrap();
        assert_eq!(matrix_free.csr_nonzeros, 0);
        assert!(matrix_free.relative_residual < 1e-10);
        for (left, right) in csr
            .nodal_displacements_m
            .iter()
            .flatten()
            .zip(matrix_free.nodal_displacements_m.iter().flatten())
        {
            close(*left, *right, 1e-10);
        }
        for (left, right) in csr
            .nodal_reactions_kn
            .iter()
            .flatten()
            .zip(matrix_free.nodal_reactions_kn.iter().flatten())
        {
            close(*left, *right, 1e-6);
        }
        for (left, right) in csr.element_gauss_stress_mpa.iter().flatten().flatten().zip(
            matrix_free
                .element_gauss_stress_mpa
                .iter()
                .flatten()
                .flatten(),
        ) {
            close(*left, *right, 1e-7);
        }
    }

    #[test]
    fn two_material_structured_matrix_free_matches_csr_and_is_parallel_deterministic() {
        let mut model = structured_parity_model();
        model.materials.push(Hex8VolumeMaterial {
            e_mpa: 12_000.0,
            poisson: 0.31,
        });
        model.elements[1].material = 1;
        model.elements[2].material = 1;
        let csr = solve_hex8_volume(model.clone()).unwrap();
        let matrix_free = solve_hex8_volume(Hex8VolumeRequest {
            structured_grid_cells: Some([2, 2, 1]),
            threads: 4,
            ..model.clone()
        })
        .unwrap();
        let repeated = solve_hex8_volume(Hex8VolumeRequest {
            structured_grid_cells: Some([2, 2, 1]),
            threads: 4,
            ..model
        })
        .unwrap();
        assert_eq!(matrix_free.csr_nonzeros, 0);
        assert_eq!(matrix_free.solver_used, "matrixFree");
        assert_eq!(matrix_free.threads, 4);
        assert!(matrix_free.relative_residual < 1e-10);
        assert_eq!(
            matrix_free.nodal_displacements_m,
            repeated.nodal_displacements_m
        );
        assert_eq!(matrix_free.nodal_reactions_kn, repeated.nodal_reactions_kn);
        assert_eq!(
            matrix_free.element_gauss_stress_mpa,
            repeated.element_gauss_stress_mpa
        );
        for (left, right) in csr
            .nodal_displacements_m
            .iter()
            .flatten()
            .zip(matrix_free.nodal_displacements_m.iter().flatten())
        {
            close(*left, *right, 1e-10);
        }
        for (left, right) in csr
            .nodal_reactions_kn
            .iter()
            .flatten()
            .zip(matrix_free.nodal_reactions_kn.iter().flatten())
        {
            close(*left, *right, 1e-6);
        }
        for (left, right) in csr.element_gauss_stress_mpa.iter().flatten().flatten().zip(
            matrix_free
                .element_gauss_stress_mpa
                .iter()
                .flatten()
                .flatten(),
        ) {
            close(*left, *right, 1e-7);
        }
    }

    #[test]
    fn general_matrix_free_matches_csr_on_warped_heterogeneous_mesh() {
        let mut model = structured_parity_model();
        for point in &mut model.nodes {
            let [x, y, z] = *point;
            *point = [
                0.4 + 1.1 * x + 0.08 * y,
                -0.2 + 0.12 * x + 0.9 * y,
                0.1 + 0.09 * x + 0.04 * y + 1.2 * z,
            ];
        }
        let warped = model.elements[0].nodes[6];
        for axis in 0..3 {
            model.nodes[warped][axis] += [0.03, -0.02, 0.04][axis];
        }
        model.materials.push(Hex8VolumeMaterial {
            e_mpa: 12_000.0,
            poisson: 0.31,
        });
        model.elements[1].material = 1;
        model.elements[2].material = 1;
        // Relabel nodes and reverse cell order: no Cartesian indexing or
        // particular traversal order may leak into the general operator.
        let node_count = model.nodes.len();
        model.nodes.reverse();
        for cell in &mut model.elements {
            cell.nodes = cell.nodes.map(|node| node_count - 1 - node);
        }
        for support in &mut model.supports {
            support.node = node_count - 1 - support.node;
        }
        for load in &mut model.loads {
            load.node = node_count - 1 - load.node;
        }
        let cell_count = model.elements.len();
        model.elements.reverse();
        for body in &mut model.body_forces {
            body.element = cell_count - 1 - body.element;
        }
        for face in &mut model.face_tractions {
            face.element = cell_count - 1 - face.element;
        }
        let csr = solve_hex8_volume(model.clone()).unwrap();
        model.threads = 4;
        model.linear_backend = Hex8LinearBackend::MatrixFreeGeneral;
        let matrix_free = solve_hex8_volume(model.clone()).unwrap();
        let repeated = solve_hex8_volume(model).unwrap();
        assert_eq!(matrix_free.solver_used, "matrixFreeGeneral");
        assert_eq!(matrix_free.csr_nonzeros, 0);
        assert_eq!(matrix_free.threads, 4);
        assert!(matrix_free.relative_residual < 1e-10);
        assert_eq!(
            matrix_free.nodal_displacements_m,
            repeated.nodal_displacements_m
        );
        assert_eq!(matrix_free.nodal_reactions_kn, repeated.nodal_reactions_kn);
        for (left, right) in csr
            .nodal_displacements_m
            .iter()
            .flatten()
            .zip(matrix_free.nodal_displacements_m.iter().flatten())
        {
            close(*left, *right, 1e-10);
        }
        for (left, right) in csr
            .nodal_reactions_kn
            .iter()
            .flatten()
            .zip(matrix_free.nodal_reactions_kn.iter().flatten())
        {
            close(*left, *right, 1e-5);
        }
        for (left, right) in csr.element_gauss_stress_mpa.iter().flatten().flatten().zip(
            matrix_free
                .element_gauss_stress_mpa
                .iter()
                .flatten()
                .flatten(),
        ) {
            close(*left, *right, 1e-6);
        }
    }

    #[test]
    fn general_matrix_free_rejects_disconnected_unrestrained_component_at_zero_load() {
        let mut model = uniaxial_cube_example();
        let offset = model.nodes.len();
        let second_nodes = model
            .nodes
            .iter()
            .map(|point| [point[0] + 2.0, point[1], point[2]])
            .collect::<Vec<_>>();
        model.nodes.extend(second_nodes);
        model.elements.push(Hex8VolumeCell {
            nodes: [0, 1, 2, 3, 4, 5, 6, 7].map(|node| node + offset),
            material: 0,
        });
        model.loads.clear();
        model.linear_backend = Hex8LinearBackend::MatrixFreeGeneral;
        let error = solve_hex8_volume(model).unwrap_err();
        assert!(
            error.contains("rigid") || error.contains("restrain"),
            "{error}"
        );
    }

    #[test]
    fn general_matrix_free_rejects_invalid_geometry_and_explicit_size_limit() {
        let mut model = uniaxial_cube_example();
        model.linear_backend = Hex8LinearBackend::MatrixFreeGeneral;
        model.nodes[6] = model.nodes[0];
        assert!(solve_hex8_volume(model).unwrap_err().contains("Jacobian"));
        let mut model = uniaxial_cube_example();
        model.linear_backend = Hex8LinearBackend::MatrixFreeGeneral;
        model.elements.resize(
            crate::hex8_matrix_free::MAX_GENERAL_ELEMENTS + 1,
            model.elements[0],
        );
        assert!(solve_hex8_volume(model).unwrap_err().contains("limited to"));
    }

    #[test]
    fn general_large_opt_in_uses_same_solution_and_reports_selected_backend() {
        let mut model = structured_parity_model();
        model.linear_backend = Hex8LinearBackend::MatrixFreeGeneral;
        let standard = solve_hex8_volume(model.clone()).unwrap();
        model.linear_backend = Hex8LinearBackend::MatrixFreeGeneralLarge;
        let encoded = serde_json::to_value(&model).unwrap();
        assert_eq!(encoded["linearBackend"], "matrixFreeGeneralLarge");
        let decoded: Hex8VolumeRequest = serde_json::from_value(encoded).unwrap();
        let large = solve_hex8_volume(decoded).unwrap();
        assert_eq!(standard.solver_used, "matrixFreeGeneral");
        assert_eq!(large.solver_used, "matrixFreeGeneralLarge");
        assert_eq!(large.nodal_displacements_m, standard.nodal_displacements_m);
        assert_eq!(large.nodal_reactions_kn, standard.nodal_reactions_kn);
        assert_eq!(
            large.element_gauss_stress_mpa,
            standard.element_gauss_stress_mpa
        );
    }

    #[test]
    #[ignore = "1,000 distorted Hex8 general-geometry throughput probe; run explicitly"]
    fn benchmark_general_matrix_free_one_thousand_hexes_four_threads() {
        let mesh = StructuredHex8Mesh::structured([10, 10, 10]).unwrap();
        let mut model = Hex8VolumeRequest {
            nodes: mesh
                .nodes
                .iter()
                .map(|&[x, y, z]| [x + 0.12 * y + 0.03 * z, y + 0.07 * z, z + 0.05 * x])
                .collect(),
            materials: vec![
                Hex8VolumeMaterial {
                    e_mpa: 30_000.0,
                    poisson: 0.25,
                },
                Hex8VolumeMaterial {
                    e_mpa: 15_000.0,
                    poisson: 0.28,
                },
            ],
            elements: mesh
                .hexes
                .iter()
                .enumerate()
                .map(|(i, &nodes)| Hex8VolumeCell {
                    nodes,
                    material: i % 2,
                })
                .collect(),
            loads: Vec::new(),
            body_forces: Vec::new(),
            face_tractions: Vec::new(),
            supports: Vec::new(),
            tolerance: 1e-8,
            max_iterations: 2_000,
            structured_grid_cells: None,
            threads: 4,
            linear_backend: Hex8LinearBackend::MatrixFreeGeneral,
        };
        for (node, &[x, _, _]) in mesh.nodes.iter().enumerate() {
            if x == 0.0 {
                model.supports.push(Hex8VolumeSupport {
                    node,
                    displacement_m: [Some(0.0); 3],
                });
            }
            if x == 1.0 {
                model.loads.push(Hex8VolumeLoad {
                    node,
                    force_kn: [1.0, 0.0, 0.0],
                });
            }
        }
        let start = std::time::Instant::now();
        let result = solve_hex8_volume(model).unwrap();
        eprintln!("general Hex8 1,000 elements / 3,993 DOF / 4 threads: {:?}, {} iterations, residual {:.3e}",
            start.elapsed(), result.iterations, result.relative_residual);
        assert!(result.relative_residual < 1e-8);
        let reaction_x = result
            .nodal_reactions_kn
            .iter()
            .map(|reaction| reaction[0])
            .sum::<f64>();
        close(reaction_x, -121.0, 1e-5);
    }

    #[test]
    fn explicit_matrix_free_rejects_malformed_grid_and_invalid_material_index() {
        let mut model = structured_parity_model();
        model.structured_grid_cells = Some([2, 2, 1]);
        model.nodes[1][0] += 1e-6;
        assert!(solve_hex8_volume(model)
            .unwrap_err()
            .contains("exact rectangular"));
        let mut model = structured_parity_model();
        model.structured_grid_cells = Some([2, 2, 1]);
        model.elements[2].material = 1;
        assert!(solve_hex8_volume(model)
            .unwrap_err()
            .contains("invalid material index"));
    }

    #[test]
    fn structured_opt_in_survives_the_shared_dispatch_wire_contract() {
        let mut model = structured_parity_model();
        model.structured_grid_cells = Some([2, 2, 1]);
        model.threads = 4;
        let wire = serde_json::json!({"kind": "volumeHex8", "input": model});
        let request: crate::dispatch::NativeFemRequest = serde_json::from_value(wire).unwrap();
        let response = crate::dispatch::solve_native_fem(request).unwrap();
        let output = serde_json::to_value(response).unwrap();
        assert_eq!(output["kind"], "volumeHex8");
        assert_eq!(output["result"]["csrNonzeros"], 0);
        assert!(output["result"]["relativeResidual"].as_f64().unwrap() < 1e-10);
    }
}
