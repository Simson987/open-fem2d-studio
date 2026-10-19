//! Linear isotropic 3D Tet4 elasticity with matrix-free and assembled solvers.
//! Coordinates are metres; E and stress are MPa; nodal forces are kN.
//! The weak form is ∫ (λ div u div v + 2µ ε(u):ε(v)) dV.

use crate::{csr, csr_ldlt, frontal};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Mesh {
    pub nodes: Vec<[f64; 3]>,
    pub tets: Vec<[usize; 4]>,
}

#[derive(Clone, Copy, Debug)]
struct Element {
    nodes: [usize; 4],
    gradients: [[f64; 3]; 4],
    volume: f64,
    lambda: f64,
    mu: f64,
}

#[derive(Debug)]
pub struct Operator {
    elements: Vec<Element>,
    diagonal: Vec<f64>,
    dofs: usize,
}

/// A linear isotropic solid material. Geometry and displacement are in metres,
/// modulus and stress in MPa, and loads/reactions in kN.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume3dMaterial {
    pub e_mpa: f64,
    pub poisson: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume3dElement {
    pub nodes: [usize; 4],
    pub material: usize,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume3dLoad {
    pub node: usize,
    pub force_kn: [f64; 3],
}

/// Uniform force per volume on one tetrahedron, in kN/m³.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume3dBodyForce {
    pub element: usize,
    pub force_kn_per_m3: [f64; 3],
}

/// Uniform traction on a triangular face of one tetrahedron, in kN/m².
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume3dFaceTraction {
    pub element: usize,
    pub nodes: [usize; 3],
    pub traction_kn_per_m2: [f64; 3],
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume3dSupport {
    pub node: usize,
    /// None is free; Some(value) prescribes this component in metres.
    pub displacement_m: [Option<f64>; 3],
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Volume3dStrategy {
    #[default]
    Automatic,
    MatrixFree,
    Sparse,
    SparseDirect,
    Frontal,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume3dRequest {
    pub nodes: Vec<[f64; 3]>,
    pub materials: Vec<Volume3dMaterial>,
    pub elements: Vec<Volume3dElement>,
    #[serde(default)]
    pub loads: Vec<Volume3dLoad>,
    #[serde(default)]
    pub body_forces: Vec<Volume3dBodyForce>,
    #[serde(default)]
    pub face_tractions: Vec<Volume3dFaceTraction>,
    #[serde(default)]
    pub supports: Vec<Volume3dSupport>,
    #[serde(default = "default_threads")]
    pub threads: usize,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
    #[serde(default = "default_iterations")]
    pub max_iterations: usize,
    #[serde(default)]
    pub solver_strategy: Volume3dStrategy,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume3dResponse {
    pub nodal_displacements_m: Vec<[f64; 3]>,
    pub nodal_reactions_kn: Vec<[f64; 3]>,
    /// Engineering stress components [xx, yy, zz, xy, yz, zx], in MPa.
    pub element_stress_mpa: Vec<[f64; 6]>,
    pub iterations: usize,
    pub relative_residual: f64,
    pub threads: usize,
    pub solver_used: Volume3dStrategy,
}

#[derive(Clone, Debug)]
pub struct Solution {
    pub displacements: Vec<f64>,
    pub reactions: Vec<f64>,
    pub iterations: usize,
    pub relative_residual: f64,
    pub threads: usize,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GridBenchmark {
    pub cells: [usize; 3],
    pub e_mpa: f64,
    pub poisson: f64,
    #[serde(default = "default_threads")]
    pub threads: usize,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
    #[serde(default = "default_iterations")]
    pub max_iterations: usize,
}

fn default_threads() -> usize {
    1
}
fn default_tolerance() -> f64 {
    1e-9
}
fn default_iterations() -> usize {
    1000
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkResult {
    pub nodes: usize,
    pub elements: usize,
    pub dofs: usize,
    pub free_dofs: usize,
    pub threads: usize,
    pub iterations: usize,
    pub relative_residual: f64,
    pub max_displacement_error: f64,
    pub max_free_force_residual_kn: f64,
    pub right_face_force_kn: f64,
    pub expected_right_face_force_kn: f64,
}

fn node_index(i: usize, j: usize, k: usize, nx: usize, ny: usize) -> usize {
    (k * (ny + 1) + j) * (nx + 1) + i
}

impl Mesh {
    /// Six conforming Tet4 elements per Cartesian cell, across the 000–111 diagonal.
    pub fn structured(cells: [usize; 3]) -> Result<Self, String> {
        let [nx, ny, nz] = cells;
        if cells.contains(&0) {
            return Err("each grid dimension must be positive".into());
        }
        let dimensions = cells.map(|n| n.checked_add(1).ok_or("grid dimension overflow"));
        let [px, py, pz] = [dimensions[0]?, dimensions[1]?, dimensions[2]?];
        let nodes = px
            .checked_mul(py)
            .and_then(|n| n.checked_mul(pz))
            .ok_or("grid node count overflow")?;
        let elements = nx
            .checked_mul(ny)
            .and_then(|n| n.checked_mul(nz))
            .and_then(|n| n.checked_mul(6))
            .ok_or("grid element count overflow")?;
        if nodes > 2_000_000 || elements > 12_000_000 {
            return Err("grid exceeds the current 2M-node / 12M-element safety budget".into());
        }
        let mut points = Vec::with_capacity(nodes);
        for k in 0..=nz {
            for j in 0..=ny {
                for i in 0..=nx {
                    points.push([
                        i as f64 / nx as f64,
                        j as f64 / ny as f64,
                        k as f64 / nz as f64,
                    ]);
                }
            }
        }
        let mut tets = Vec::with_capacity(elements);
        for k in 0..nz {
            for j in 0..ny {
                for i in 0..nx {
                    let a = node_index(i, j, k, nx, ny);
                    let b = node_index(i + 1, j, k, nx, ny);
                    let c = node_index(i, j + 1, k, nx, ny);
                    let d = node_index(i + 1, j + 1, k, nx, ny);
                    let e = node_index(i, j, k + 1, nx, ny);
                    let f = node_index(i + 1, j, k + 1, nx, ny);
                    let g = node_index(i, j + 1, k + 1, nx, ny);
                    let h = node_index(i + 1, j + 1, k + 1, nx, ny);
                    tets.extend_from_slice(&[
                        [a, b, d, h],
                        [a, d, c, h],
                        [a, c, g, h],
                        [a, g, e, h],
                        [a, e, f, h],
                        [a, f, b, h],
                    ]);
                }
            }
        }
        Ok(Self {
            nodes: points,
            tets,
        })
    }
}

impl Operator {
    pub(crate) fn diagonal(&self) -> &[f64] {
        &self.diagonal
    }
    /// Reuse the validated Tet4 element matrices in a shared-DOF assembly.
    pub(crate) fn stiffness_elements(&self) -> Vec<frontal::FrontalElement> {
        self.elements
            .iter()
            .map(|element| {
                let (dofs, stiffness) = tet_stiffness(element);
                frontal::FrontalElement { dofs, stiffness }
            })
            .collect()
    }

    pub fn new(mesh: &Mesh, e_mpa: f64, poisson: f64) -> Result<Self, String> {
        Self::new_with_materials(
            mesh,
            &[Volume3dMaterial { e_mpa, poisson }],
            &vec![0; mesh.tets.len()],
        )
    }

    pub fn new_with_materials(
        mesh: &Mesh,
        materials: &[Volume3dMaterial],
        element_materials: &[usize],
    ) -> Result<Self, String> {
        if mesh.nodes.is_empty() || mesh.tets.is_empty() {
            return Err("volume mesh is empty".into());
        }
        if mesh.nodes.len() > 2_000_000 || mesh.tets.len() > 12_000_000 {
            return Err(
                "volume mesh exceeds the current 2M-node / 12M-element safety budget".into(),
            );
        }
        if mesh.nodes.iter().flatten().any(|value| !value.is_finite()) {
            return Err("mesh contains a non-finite coordinate".into());
        }
        if materials.is_empty() || element_materials.len() != mesh.tets.len() {
            return Err("materials are empty or element material count is wrong".into());
        }
        let lame: Vec<(f64, f64)> = materials.iter().enumerate().map(|(i, material)| {
            let e_mpa = material.e_mpa;
            let poisson = material.poisson;
            if !e_mpa.is_finite() || e_mpa <= 0.0 || !poisson.is_finite() || !(0.0..0.5).contains(&poisson) {
                return Err(format!("material {i}: E must be positive and finite; Poisson ratio must be in [0, 0.5)"));
            }
            let mu = e_mpa / (2.0 * (1.0 + poisson)) * 1_000.0;
            let lambda = e_mpa * poisson / ((1.0 + poisson) * (1.0 - 2.0 * poisson)) * 1_000.0;
            if !mu.is_finite() || !lambda.is_finite() {
                return Err(format!("material {i}: Lamé coefficients overflow"));
            }
            Ok((lambda, mu))
        }).collect::<Result<_, _>>()?;
        let dofs = mesh
            .nodes
            .len()
            .checked_mul(3)
            .ok_or("DOF count overflow")?;
        let mut elements = Vec::with_capacity(mesh.tets.len());
        let mut diagonal = vec![0.0; dofs];
        for (element_index, &ids) in mesh.tets.iter().enumerate() {
            let material_index = element_materials[element_index];
            let &(lambda, mu) = lame.get(material_index).ok_or_else(|| {
                format!("element {element_index}: material index outside material list")
            })?;
            if ids.iter().enumerate().any(|(i, id)| ids[..i].contains(id)) {
                return Err(format!("element {element_index}: duplicate node index"));
            }
            let p = ids.map(|id| mesh.nodes.get(id).copied());
            let [Some(p0), Some(p1), Some(p2), Some(p3)] = p else {
                return Err(format!(
                    "element {element_index}: tet node index outside mesh"
                ));
            };
            if [p0, p1, p2, p3].iter().flatten().any(|v| !v.is_finite()) {
                return Err("tet contains a non-finite coordinate".into());
            }
            let a = sub(p1, p0);
            let b = sub(p2, p0);
            let c = sub(p3, p0);
            let det = dot(a, cross(b, c));
            let scale = norm(a).max(norm(b)).max(norm(c));
            if !det.is_finite()
                || !scale.is_finite()
                || scale == 0.0
                || det.abs() <= 1e-12 * scale.powi(3)
            {
                return Err(format!("element {element_index}: degenerate Tet4 element"));
            }
            // Rows of the inverse of the edge matrix are ∇N1, ∇N2, ∇N3.
            let g1 = mul(cross(b, c), 1.0 / det);
            let g2 = mul(cross(c, a), 1.0 / det);
            let g3 = mul(cross(a, b), 1.0 / det);
            let g0 = mul(add(add(g1, g2), g3), -1.0);
            let gradients = [g0, g1, g2, g3];
            let volume = det.abs() / 6.0;
            for (node, gradient) in ids.into_iter().zip(gradients) {
                for component in 0..3 {
                    diagonal[3 * node + component] += volume
                        * (mu * dot(gradient, gradient)
                            + (lambda + mu) * gradient[component].powi(2));
                }
            }
            elements.push(Element {
                nodes: ids,
                gradients,
                volume,
                lambda,
                mu,
            });
        }
        if diagonal
            .iter()
            .any(|value| !value.is_finite() || *value <= 0.0)
        {
            return Err("volume mesh contains an unused node or non-finite stiffness".into());
        }
        Ok(Self {
            elements,
            diagonal,
            dofs,
        })
    }

    /// Parallel element action with private accumulation buffers and deterministic reduction.
    pub fn apply(&self, x: &[f64], threads: usize) -> Result<Vec<f64>, String> {
        if x.len() != self.dofs {
            return Err("displacement vector has wrong length".into());
        }
        if threads == 0 || threads > 32 {
            return Err("thread count must be between 1 and 32".into());
        }
        let nworkers = threads.min(self.elements.len());
        let scratch_bytes = self
            .dofs
            .checked_mul(nworkers)
            .and_then(|n| n.checked_mul(8))
            .ok_or("parallel Tet4 scratch memory overflow")?;
        if scratch_bytes > 512 * 1024 * 1024 {
            return Err(
                "parallel Tet4 scratch memory exceeds 512 MiB budget; reduce threads".into(),
            );
        }
        let chunk = self.elements.len().div_ceil(nworkers);
        let mut result = vec![0.0; self.dofs];
        if nworkers == 1 {
            apply_elements(&self.elements, x, &mut result);
        } else {
            std::thread::scope(|scope| {
                let mut handles = Vec::with_capacity(nworkers);
                for elements in self.elements.chunks(chunk) {
                    handles.push(scope.spawn(move || {
                        let mut local = vec![0.0; x.len()];
                        apply_elements(elements, x, &mut local);
                        local
                    }));
                }
                for handle in handles {
                    let local = handle.join().expect("Tet4 worker panicked");
                    for (sum, value) in result.iter_mut().zip(local) {
                        *sum += value;
                    }
                }
            });
        }
        Ok(result)
    }

    /// Prescribed DOFs are (zero-based DOF index, displacement in metres).
    pub fn solve(
        &self,
        loads_kn: &[f64],
        prescribed: &[(usize, f64)],
        threads: usize,
        tolerance: f64,
        max_iterations: usize,
    ) -> Result<Solution, String> {
        if loads_kn.len() != self.dofs || loads_kn.iter().any(|v| !v.is_finite()) {
            return Err("load vector has wrong length or non-finite value".into());
        }
        if !(0.0..1.0).contains(&tolerance) || max_iterations == 0 {
            return Err("tolerance must be in (0,1) and maxIterations positive".into());
        }
        let mut fixed = vec![false; self.dofs];
        let mut u_fixed = vec![0.0; self.dofs];
        for &(dof, value) in prescribed {
            if dof >= self.dofs || !value.is_finite() || fixed[dof] {
                return Err("invalid or duplicate prescribed DOF".into());
            }
            fixed[dof] = true;
            u_fixed[dof] = value;
        }
        if !fixed.iter().any(|&v| v) {
            return Err("unrestrained volume model".into());
        }
        let ku_fixed = self.apply(&u_fixed, threads)?;
        let mut residual: Vec<f64> = loads_kn
            .iter()
            .zip(&ku_fixed)
            .enumerate()
            .map(|(i, (f, k))| if fixed[i] { 0.0 } else { f - k })
            .collect();
        let rhs_norm = euclidean_norm(&residual);
        if !rhs_norm.is_finite() {
            return Err("non-finite Tet4 right-hand side norm".into());
        }
        let mut correction = vec![0.0; self.dofs];
        let mut z = vec![0.0; self.dofs];
        for i in 0..self.dofs {
            if !fixed[i] {
                if !self.diagonal[i].is_finite() || self.diagonal[i] <= 0.0 {
                    return Err("free DOF has zero stiffness".into());
                }
                z[i] = residual[i] / self.diagonal[i];
            }
        }
        let mut direction = z.clone();
        let mut rz = dot_vec(&residual, &z);
        if !rz.is_finite() {
            return Err("non-finite Tet4 preconditioned residual".into());
        }
        let mut iterations = 0;
        let mut relative_residual = if rhs_norm == 0.0 { 0.0 } else { 1.0 };
        while relative_residual > tolerance && iterations < max_iterations {
            let mut kd = self.apply(&direction, threads)?;
            for i in 0..self.dofs {
                if fixed[i] {
                    kd[i] = 0.0;
                }
            }
            let curvature = dot_vec(&direction, &kd);
            if !curvature.is_finite() || curvature <= 0.0 {
                return Err("PCG lost positive definiteness".into());
            }
            let alpha = rz / curvature;
            if !alpha.is_finite() {
                return Err("non-finite Tet4 PCG step".into());
            }
            for i in 0..self.dofs {
                correction[i] += alpha * direction[i];
                residual[i] -= alpha * kd[i];
            }
            iterations += 1;
            relative_residual = euclidean_norm(&residual) / rhs_norm;
            if !relative_residual.is_finite() {
                return Err("non-finite Tet4 PCG residual".into());
            }
            if relative_residual <= tolerance {
                break;
            }
            for i in 0..self.dofs {
                if !fixed[i] {
                    z[i] = residual[i] / self.diagonal[i];
                }
            }
            let next_rz = dot_vec(&residual, &z);
            if !next_rz.is_finite() || next_rz <= 0.0 {
                return Err("PCG preconditioned residual failed".into());
            }
            let beta = next_rz / rz;
            for i in 0..self.dofs {
                direction[i] = z[i] + beta * direction[i];
            }
            rz = next_rz;
        }
        if relative_residual > tolerance {
            return Err(format!("Tet4 PCG did not converge in {max_iterations} iterations (residual {relative_residual:.3e})"));
        }
        for i in 0..self.dofs {
            u_fixed[i] += correction[i];
        }
        let mut reactions = self.apply(&u_fixed, threads)?;
        for (reaction, load) in reactions.iter_mut().zip(loads_kn) {
            *reaction -= load;
        }
        // Verify the actual residual, not just the recursively updated PCG residual.
        let actual = reactions
            .iter()
            .enumerate()
            .filter(|(i, _)| !fixed[*i])
            .fold(0.0_f64, |norm, (_, value)| norm.hypot(*value));
        let scale = if rhs_norm > 0.0 { rhs_norm } else { 1.0 };
        let relative = actual / scale;
        if !relative.is_finite() || relative > tolerance * 5.0 {
            return Err(format!(
                "Tet4 actual residual {:.3e} exceeds tolerance",
                relative
            ));
        }
        Ok(Solution {
            displacements: u_fixed,
            reactions,
            iterations,
            relative_residual: relative,
            threads: threads.min(self.elements.len()),
        })
    }

    pub(crate) fn element_stress_mpa(
        &self,
        displacements: &[f64],
    ) -> Result<Vec<[f64; 6]>, String> {
        if displacements.len() != self.dofs || displacements.iter().any(|value| !value.is_finite())
        {
            return Err("invalid displacement vector for stress recovery".into());
        }
        let mut recovered = Vec::with_capacity(self.elements.len());
        for element in &self.elements {
            let mut du = [[0.0; 3]; 3];
            for i in 0..4 {
                for a in 0..3 {
                    for b in 0..3 {
                        du[a][b] +=
                            displacements[3 * element.nodes[i] + a] * element.gradients[i][b];
                    }
                }
            }
            let trace = du[0][0] + du[1][1] + du[2][2];
            let normal =
                |a: usize| (element.lambda * trace + 2.0 * element.mu * du[a][a]) / 1_000.0;
            let shear = |a: usize, b: usize| element.mu * (du[a][b] + du[b][a]) / 1_000.0;
            let stress = [
                normal(0),
                normal(1),
                normal(2),
                shear(0, 1),
                shear(1, 2),
                shear(2, 0),
            ];
            if stress.iter().any(|value| !value.is_finite()) {
                return Err("non-finite element stress".into());
            }
            recovered.push(stress);
        }
        Ok(recovered)
    }
}

fn tet_stiffness(element: &Element) -> (Vec<usize>, Vec<f64>) {
    let dofs: Vec<usize> = element
        .nodes
        .iter()
        .flat_map(|&node| (0..3).map(move |a| 3 * node + a))
        .collect();
    let mut stiffness = vec![0.0; 12 * 12];
    for i in 0..4 {
        for a in 0..3 {
            for j in 0..4 {
                for c in 0..3 {
                    let gi = element.gradients[i];
                    let gj = element.gradients[j];
                    stiffness[(3 * i + a) * 12 + 3 * j + c] = element.volume
                        * (element.lambda * gi[a] * gj[c]
                            + if a == c {
                                element.mu * dot(gi, gj)
                            } else {
                                0.0
                            }
                            + element.mu * gi[c] * gj[a]);
                }
            }
        }
    }
    (dofs, stiffness)
}

fn checked_relative_residual(
    operator: &Operator,
    loads: &[f64],
    prescribed: &[Option<f64>],
    reactions: &[f64],
    tolerance: f64,
) -> Result<f64, String> {
    let fixed: Vec<f64> = prescribed.iter().map(|v| v.unwrap_or(0.0)).collect();
    let k_fixed = operator.apply(&fixed, 1)?;
    let mut rhs_norm = 0.0_f64;
    let mut actual_norm = 0.0_f64;
    for dof in 0..operator.dofs {
        if prescribed[dof].is_none() {
            rhs_norm = rhs_norm.hypot(loads[dof] - k_fixed[dof]);
            actual_norm = actual_norm.hypot(reactions[dof]);
        }
    }
    if !rhs_norm.is_finite() || !actual_norm.is_finite() {
        return Err("non-finite volume solver free residual norm".into());
    }
    let relative = actual_norm / if rhs_norm > 0.0 { rhs_norm } else { 1.0 };
    if !relative.is_finite() || relative > tolerance * 5.0 {
        return Err(format!(
            "volume solver actual free residual {relative:.3e} exceeds tolerance"
        ));
    }
    Ok(relative)
}

fn solve_assembled(
    operator: &Operator,
    loads: &[f64],
    prescribed: &[Option<f64>],
    strategy: Volume3dStrategy,
    tolerance: f64,
    max_iterations: usize,
    threads: usize,
) -> Result<Solution, String> {
    match strategy {
        Volume3dStrategy::Sparse | Volume3dStrategy::SparseDirect => {
            if strategy == Volume3dStrategy::SparseDirect && operator.dofs > 10_000 {
                return Err(
                    "directe sparse Tet4-route begrensd tot 10.000 DOF wegens factorfill".into(),
                );
            }
            let element_nodes: Vec<[usize; 4]> = operator
                .elements
                .iter()
                .map(|element| element.nodes)
                .collect();
            // Discover 3×3 node blocks once, then assemble directly into the
            // scalar CSR pattern. This avoids both stiffness triplets and the
            // much larger list of repeated scalar column indices.
            let mut assembler = csr::CsrPatternAssembler::from_node_blocks3(
                operator.dofs / 3,
                &element_nodes,
                40_000_000,
                30_000_000,
            )?;
            drop(element_nodes);
            for element in &operator.elements {
                let (dofs, stiffness) = tet_stiffness(element);
                assembler.add_element(&dofs, &stiffness)?;
            }
            let matrix = assembler.build();
            if strategy == Volume3dStrategy::SparseDirect {
                let result =
                    csr_ldlt::solve_constrained_ldlt(&matrix, loads, prescribed, 1_000_000)?;
                let relative_residual = checked_relative_residual(
                    operator,
                    loads,
                    prescribed,
                    &result.reactions,
                    tolerance,
                )?;
                Ok(Solution {
                    displacements: result.displacements,
                    reactions: result.reactions,
                    iterations: 0,
                    relative_residual,
                    threads: 1,
                })
            } else {
                let effective_threads =
                    if prescribed.iter().filter(|value| value.is_none()).count() >= 256 {
                        threads
                    } else {
                        1
                    };
                let result = matrix.solve_constrained_with_threads(
                    loads,
                    prescribed,
                    csr::PcgOptions {
                        relative_tolerance: tolerance,
                        absolute_tolerance: 0.0,
                        max_iterations,
                    },
                    effective_threads,
                )?;
                let relative_residual = checked_relative_residual(
                    operator,
                    loads,
                    prescribed,
                    &result.reactions,
                    tolerance,
                )?;
                Ok(Solution {
                    displacements: result.displacements,
                    reactions: result.reactions,
                    iterations: result.iterations,
                    relative_residual,
                    threads: effective_threads,
                })
            }
        }
        Volume3dStrategy::Frontal => {
            if operator.dofs > 10_000 {
                return Err(
                    "frontale Tet4-route begrensd tot 10.000 DOF wegens wavefront-geheugen".into(),
                );
            }
            let elements: Vec<frontal::FrontalElement> = operator
                .elements
                .iter()
                .map(|element| {
                    let (dofs, stiffness) = tet_stiffness(element);
                    frontal::FrontalElement { dofs, stiffness }
                })
                .collect();
            let result = frontal::solve(
                &elements,
                loads,
                prescribed,
                frontal::FrontalOptions {
                    max_front_dofs: 512,
                    relative_pivot_tolerance: 1e-12,
                },
            )?;
            let relative_residual = checked_relative_residual(
                operator,
                loads,
                prescribed,
                &result.reactions,
                tolerance,
            )?;
            Ok(Solution {
                displacements: result.displacements,
                reactions: result.reactions,
                iterations: 0,
                relative_residual,
                threads: 1,
            })
        }
        _ => Err("assembled strategy must be sparse, sparseDirect or frontal".into()),
    }
}

/// Solve an explicit Tet4 model with nodal loads and prescribed displacements.
/// Material indices and node indices are zero-based. Reactions are `K u - F`;
/// free-node entries should therefore be near zero after convergence.
pub fn solve_volume3d(request: Volume3dRequest) -> Result<Volume3dResponse, String> {
    if request.threads == 0
        || request.threads > 32
        || !request.tolerance.is_finite()
        || !(0.0..1.0).contains(&request.tolerance)
        || request.max_iterations == 0
    {
        return Err("invalid volume thread count, tolerance or iteration limit".into());
    }
    let mesh = Mesh {
        nodes: request.nodes,
        tets: request
            .elements
            .iter()
            .map(|element| element.nodes)
            .collect(),
    };
    let element_materials: Vec<usize> = request
        .elements
        .iter()
        .map(|element| element.material)
        .collect();
    let operator = Operator::new_with_materials(&mesh, &request.materials, &element_materials)?;
    let mut loads = vec![0.0; operator.dofs];
    for (index, load) in request.loads.iter().enumerate() {
        if load.node >= mesh.nodes.len() || load.force_kn.iter().any(|value| !value.is_finite()) {
            return Err(format!("load {index}: invalid node or non-finite force"));
        }
        for (component, force) in load.force_kn.iter().enumerate() {
            loads[3 * load.node + component] += force;
            if !loads[3 * load.node + component].is_finite() {
                return Err(format!("load {index}: accumulated nodal force overflow"));
            }
        }
    }
    // Tet4 shape functions integrate to V/4 over a cell. Linear face
    // restrictions integrate to A/3 over a triangular face.
    for (index, body) in request.body_forces.iter().enumerate() {
        let element = operator
            .elements
            .get(body.element)
            .ok_or_else(|| format!("body force {index}: element index outside mesh"))?;
        if body.force_kn_per_m3.iter().any(|value| !value.is_finite()) {
            return Err(format!("body force {index}: non-finite force density"));
        }
        for &node in &element.nodes {
            for component in 0..3 {
                let dof = 3 * node + component;
                loads[dof] += element.volume * body.force_kn_per_m3[component] / 4.0;
                if !loads[dof].is_finite() {
                    return Err(format!("body force {index}: nodal force overflow"));
                }
            }
        }
    }
    for (index, face) in request.face_tractions.iter().enumerate() {
        let element = operator
            .elements
            .get(face.element)
            .ok_or_else(|| format!("face traction {index}: element index outside mesh"))?;
        if face
            .traction_kn_per_m2
            .iter()
            .any(|value| !value.is_finite())
            || face.nodes.iter().enumerate().any(|(local, node)| {
                !element.nodes.contains(node) || face.nodes[..local].contains(node)
            })
        {
            return Err(format!("face traction {index}: invalid face or traction"));
        }
        let [a, b, c] = face.nodes.map(|node| mesh.nodes[node]);
        let area = norm(cross(sub(b, a), sub(c, a))) / 2.0;
        if !area.is_finite() || area <= 0.0 {
            return Err(format!("face traction {index}: degenerate face"));
        }
        for &node in &face.nodes {
            for component in 0..3 {
                let dof = 3 * node + component;
                loads[dof] += area * face.traction_kn_per_m2[component] / 3.0;
                if !loads[dof].is_finite() {
                    return Err(format!("face traction {index}: nodal force overflow"));
                }
            }
        }
    }
    let mut prescribed = Vec::new();
    let mut prescribed_options = vec![None; operator.dofs];
    for (index, support) in request.supports.iter().enumerate() {
        if support.node >= mesh.nodes.len() {
            return Err(format!("support {index}: node index outside mesh"));
        }
        if support.displacement_m.iter().all(Option::is_none) {
            return Err(format!("support {index}: no constrained components"));
        }
        for (component, value) in support.displacement_m.iter().enumerate() {
            if let Some(value) = value {
                if !value.is_finite() {
                    return Err(format!(
                        "support {index}: non-finite prescribed displacement"
                    ));
                }
                let dof = 3 * support.node + component;
                if prescribed_options[dof].is_some() {
                    return Err(format!("support {index}: duplicate prescribed DOF {dof}"));
                }
                prescribed_options[dof] = Some(*value);
                prescribed.push((dof, *value));
            }
        }
    }
    supports_restrain_each_component(&mesh.nodes, &mesh.tets, &prescribed)?;
    let (solution, solver_used) = match request.solver_strategy {
        Volume3dStrategy::MatrixFree => (
            operator.solve(
                &loads,
                &prescribed,
                request.threads,
                request.tolerance,
                request.max_iterations,
            )?,
            Volume3dStrategy::MatrixFree,
        ),
        Volume3dStrategy::Sparse | Volume3dStrategy::SparseDirect | Volume3dStrategy::Frontal => (
            solve_assembled(
                &operator,
                &loads,
                &prescribed_options,
                request.solver_strategy,
                request.tolerance,
                request.max_iterations,
                request.threads,
            )?,
            request.solver_strategy,
        ),
        Volume3dStrategy::Automatic => {
            match operator.solve(
                &loads,
                &prescribed,
                request.threads,
                request.tolerance,
                request.max_iterations,
            ) {
                Ok(solution) => (solution, Volume3dStrategy::MatrixFree),
                Err(primary)
                    if operator.dofs <= 10_000
                        && (primary.contains("did not converge")
                            || primary.contains("actual residual")) =>
                {
                    let direct = solve_assembled(
                        &operator,
                        &loads,
                        &prescribed_options,
                        Volume3dStrategy::Frontal,
                        request.tolerance,
                        request.max_iterations,
                        request.threads,
                    )
                    .map_err(|fallback| {
                        format!("matrixvrije PCG: {primary}; frontale fallback: {fallback}")
                    })?;
                    (direct, Volume3dStrategy::Frontal)
                }
                Err(error) => return Err(error),
            }
        }
    };
    let element_stress_mpa = operator.element_stress_mpa(&solution.displacements)?;
    let nodal_displacements_m = solution
        .displacements
        .chunks_exact(3)
        .map(|value| [value[0], value[1], value[2]])
        .collect();
    let nodal_reactions_kn = solution
        .reactions
        .chunks_exact(3)
        .map(|value| [value[0], value[1], value[2]])
        .collect();
    Ok(Volume3dResponse {
        nodal_displacements_m,
        nodal_reactions_kn,
        element_stress_mpa,
        iterations: solution.iterations,
        relative_residual: solution.relative_residual,
        threads: solution.threads,
        solver_used,
    })
}

pub(crate) fn supports_restrain_rigid_modes(
    nodes: &[[f64; 3]],
    prescribed: &[(usize, f64)],
) -> bool {
    if prescribed.len() < 6 {
        return false;
    }
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    for p in nodes {
        for a in 0..3 {
            min[a] = min[a].min(p[a]);
            max[a] = max[a].max(p[a]);
        }
    }
    let size = (0..3).map(|a| max[a] - min[a]).fold(0.0, f64::max);
    if !size.is_finite() || size <= 0.0 {
        return false;
    }
    let mut gram = [[0.0; 6]; 6];
    for &(dof, _) in prescribed {
        // Centering all axes on the same origin only changes the translation basis.
        let q = [
            (nodes[dof / 3][0] - min[0]) / size,
            (nodes[dof / 3][1] - min[1]) / size,
            (nodes[dof / 3][2] - min[2]) / size,
        ];
        let row = match dof % 3 {
            0 => [1.0, 0.0, 0.0, 0.0, q[2], -q[1]],
            1 => [0.0, 1.0, 0.0, -q[2], 0.0, q[0]],
            _ => [0.0, 0.0, 1.0, q[1], -q[0], 0.0],
        };
        for i in 0..6 {
            for j in 0..6 {
                gram[i][j] += row[i] * row[j];
            }
        }
    }
    let largest = (0..6).map(|i| gram[i][i]).fold(0.0, f64::max);
    for col in 0..6 {
        let pivot = (col..6)
            .max_by(|a, b| gram[*a][col].abs().total_cmp(&gram[*b][col].abs()))
            .unwrap();
        if gram[pivot][col].abs() <= 1e-12 * largest {
            return false;
        }
        gram.swap(col, pivot);
        let scale = gram[col][col];
        for row in (col + 1)..6 {
            let factor = gram[row][col] / scale;
            for j in col..6 {
                gram[row][j] -= factor * gram[col][j];
            }
        }
    }
    true
}

pub(crate) fn supports_restrain_each_component<const N: usize>(
    coordinates: &[[f64; 3]],
    elements: &[[usize; N]],
    prescribed: &[(usize, f64)],
) -> Result<(), String> {
    let mut parent: Vec<usize> = (0..coordinates.len()).collect();
    fn root(parent: &mut [usize], mut node: usize) -> usize {
        while parent[node] != node {
            parent[node] = parent[parent[node]];
            node = parent[node];
        }
        node
    }
    for element in elements {
        let a = root(&mut parent, element[0]);
        for &node in &element[1..] {
            let b = root(&mut parent, node);
            if a != b {
                parent[b] = a;
            }
        }
    }
    let mut groups = std::collections::BTreeMap::<usize, Vec<usize>>::new();
    for node in 0..coordinates.len() {
        let component = root(&mut parent, node);
        groups.entry(component).or_default().push(node);
    }
    let mut local_position = vec![0; coordinates.len()];
    for (component, nodes) in groups {
        for (position, &node) in nodes.iter().enumerate() {
            local_position[node] = position;
        }
        let local_nodes: Vec<_> = nodes.iter().map(|&node| coordinates[node]).collect();
        let local_prescribed: Vec<_> = prescribed
            .iter()
            .filter(|(dof, _)| root(&mut parent, dof / 3) == component)
            .map(|&(dof, value)| (3 * local_position[dof / 3] + dof % 3, value))
            .collect();
        if !supports_restrain_rigid_modes(&local_nodes, &local_prescribed) {
            return Err(format!(
                "component {component}: supports do not restrain all six rigid-body modes"
            ));
        }
    }
    Ok(())
}

fn apply_elements(elements: &[Element], x: &[f64], result: &mut [f64]) {
    for element in elements {
        let mut du = [[0.0; 3]; 3];
        for i in 0..4 {
            for a in 0..3 {
                for b in 0..3 {
                    du[a][b] += x[3 * element.nodes[i] + a] * element.gradients[i][b];
                }
            }
        }
        let trace = du[0][0] + du[1][1] + du[2][2];
        for i in 0..4 {
            for a in 0..3 {
                let mut force = 0.0;
                for b in 0..3 {
                    let stress = element.mu * (du[a][b] + du[b][a])
                        + if a == b { element.lambda * trace } else { 0.0 };
                    force += stress * element.gradients[i][b];
                }
                result[3 * element.nodes[i] + a] += element.volume * force;
            }
        }
    }
}

pub fn run_grid_benchmark(request: GridBenchmark) -> Result<BenchmarkResult, String> {
    run_grid_benchmark_with_strategy(request, Volume3dStrategy::MatrixFree)
}

/// Run the same independent affine patch through a selected linear backend.
/// Large sparse benchmarks use this to exercise assembled CSR as well as the
/// existing multithreaded matrix-free acceptance path.
pub fn run_grid_benchmark_with_strategy(
    request: GridBenchmark,
    strategy: Volume3dStrategy,
) -> Result<BenchmarkResult, String> {
    let mesh = Mesh::structured(request.cells)?;
    let operator = Operator::new(&mesh, request.e_mpa, request.poisson)?;
    // Exact affine 3D patch: uniform uniaxial stress, zero interior force.
    let exact: Vec<f64> = mesh
        .nodes
        .iter()
        .flat_map(|p| {
            [
                1e-4 * p[0],
                -request.poisson * 1e-4 * p[1],
                -request.poisson * 1e-4 * p[2],
            ]
        })
        .collect();
    let [nx, ny, nz] = request.cells;
    let mut prescribed = Vec::new();
    for k in 0..=nz {
        for j in 0..=ny {
            for i in 0..=nx {
                if i == 0 || i == nx || j == 0 || j == ny || k == 0 || k == nz {
                    let node = node_index(i, j, k, nx, ny);
                    for a in 0..3 {
                        prescribed.push((3 * node + a, exact[3 * node + a]));
                    }
                }
            }
        }
    }
    let loads = vec![0.0; operator.dofs];
    let solution = if strategy == Volume3dStrategy::MatrixFree {
        operator.solve(
            &loads,
            &prescribed,
            request.threads,
            request.tolerance,
            request.max_iterations,
        )?
    } else {
        let mut prescribed_dofs = vec![None; operator.dofs];
        for &(dof, value) in &prescribed {
            prescribed_dofs[dof] = Some(value);
        }
        solve_assembled(
            &operator,
            &loads,
            &prescribed_dofs,
            strategy,
            request.tolerance,
            request.max_iterations,
            request.threads,
        )?
    };
    let max_displacement_error = solution
        .displacements
        .iter()
        .zip(&exact)
        .map(|(got, want)| (got - want).abs())
        .fold(0.0, f64::max);
    let mut constrained = vec![false; operator.dofs];
    for &(dof, _) in &prescribed {
        constrained[dof] = true;
    }
    let max_free_force_residual_kn = solution
        .reactions
        .iter()
        .enumerate()
        .filter(|(i, _)| !constrained[*i])
        .map(|(_, v)| v.abs())
        .fold(0.0, f64::max);
    let mut right_face_force_kn = 0.0;
    for k in 0..=nz {
        for j in 0..=ny {
            let node = node_index(nx, j, k, nx, ny);
            right_face_force_kn += solution.reactions[3 * node];
        }
    }
    let expected_right_face_force_kn = request.e_mpa * 1e-4 * 1_000.0;
    Ok(BenchmarkResult {
        nodes: mesh.nodes.len(),
        elements: mesh.tets.len(),
        dofs: operator.dofs,
        free_dofs: operator.dofs - prescribed.len(),
        threads: solution.threads,
        iterations: solution.iterations,
        relative_residual: solution.relative_residual,
        max_displacement_error,
        max_free_force_residual_kn,
        right_face_force_kn,
        expected_right_face_force_kn,
    })
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn mul(a: [f64; 3], s: f64) -> [f64; 3] {
    [a[0] * s, a[1] * s, a[2] * s]
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn norm(a: [f64; 3]) -> f64 {
    dot(a, a).sqrt()
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn dot_vec(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn euclidean_norm(values: &[f64]) -> f64 {
    // Scale before squaring. Unlike per-entry hypot this keeps the large
    // matrix-free PCG reduction to simple arithmetic on every iteration.
    let mut scale = 0.0_f64;
    for value in values {
        if !value.is_finite() {
            return f64::NAN;
        }
        scale = scale.max(value.abs());
    }
    if scale == 0.0 {
        return 0.0;
    }
    scale
        * values
            .iter()
            .map(|value| (value / scale).powi(2))
            .sum::<f64>()
            .sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn loaded_one_tet() -> Volume3dRequest {
        Volume3dRequest {
            nodes: vec![[0., 0., 0.], [1., 0., 0.], [0., 1., 0.], [0., 0., 1.]],
            materials: vec![Volume3dMaterial {
                e_mpa: 200_000.,
                poisson: 0.0,
            }],
            elements: vec![Volume3dElement {
                nodes: [0, 1, 2, 3],
                material: 0,
            }],
            loads: vec![Volume3dLoad {
                node: 1,
                force_kn: [1., 0., 0.],
            }],
            body_forces: vec![],
            face_tractions: vec![],
            supports: vec![
                Volume3dSupport {
                    node: 0,
                    displacement_m: [Some(0.), Some(0.), Some(0.)],
                },
                Volume3dSupport {
                    node: 1,
                    displacement_m: [None, Some(0.), Some(0.)],
                },
                Volume3dSupport {
                    node: 2,
                    displacement_m: [None, None, Some(0.)],
                },
            ],
            threads: 2,
            tolerance: 1e-12,
            max_iterations: 100,
            solver_strategy: Volume3dStrategy::Automatic,
        }
    }

    #[test]
    fn typed_loaded_tet_matches_analytical_stress_displacement_and_reaction() {
        let result = solve_volume3d(loaded_one_tet()).unwrap();
        // F = sigma * A, A = 1/6 m², so sigma = 0.006 MPa.
        // epsilon = sigma/E and L = 1 m, giving u_x = 3e-8 m.
        assert!((result.nodal_displacements_m[1][0] - 3e-8).abs() < 1e-18);
        assert!((result.element_stress_mpa[0][0] - 0.006).abs() < 1e-12);
        assert!(result.element_stress_mpa[0][1..]
            .iter()
            .all(|s| s.abs() < 1e-12));
        assert!((result.nodal_reactions_kn[0][0] + 1.0).abs() < 1e-10);
        assert!(result.nodal_reactions_kn[1][0].abs() < 1e-10);
        assert!(result.relative_residual < 1e-12);
    }

    #[test]
    fn uniform_body_force_and_face_traction_have_exact_consistent_nodal_forces() {
        let mut request = loaded_one_tet();
        request.loads.clear();
        request.supports = (0..4)
            .map(|node| Volume3dSupport {
                node,
                displacement_m: [Some(0.); 3],
            })
            .collect();
        request.body_forces = vec![Volume3dBodyForce {
            element: 0,
            force_kn_per_m3: [24., 0., 0.],
        }];
        request.face_tractions = vec![Volume3dFaceTraction {
            element: 0,
            nodes: [1, 2, 3],
            traction_kn_per_m2: [2. * 3_f64.sqrt(), 0., 0.],
        }];
        // V=1/6 m³ gives 4 kN in total, one at every Tet4 node.
        // Face area=sqrt(3)/2 m² gives 3 kN, one at each face node.
        let nodes = request.nodes.clone();
        let result = solve_volume3d(request).unwrap();
        assert_eq!(result.iterations, 0);
        for node in 0..4 {
            let expected_x = if node == 0 { -1. } else { -2. };
            assert!((result.nodal_reactions_kn[node][0] - expected_x).abs() < 1e-12);
            assert!(result.nodal_reactions_kn[node][1].abs() < 1e-12);
            assert!(result.nodal_reactions_kn[node][2].abs() < 1e-12);
        }
        assert!((result.nodal_reactions_kn.iter().map(|r| r[0]).sum::<f64>() + 7.).abs() < 1e-12);
        let moment_y: f64 = result
            .nodal_reactions_kn
            .iter()
            .enumerate()
            .map(|(node, reaction)| nodes[node][2] * reaction[0])
            .sum();
        let moment_z: f64 = result
            .nodal_reactions_kn
            .iter()
            .enumerate()
            .map(|(node, reaction)| -nodes[node][1] * reaction[0])
            .sum();
        assert!((moment_y + 2.).abs() < 1e-12);
        assert!((moment_z - 2.).abs() < 1e-12);
    }

    #[test]
    fn face_traction_rejects_nodes_outside_its_element() {
        let mut request = loaded_one_tet();
        request.face_tractions = vec![Volume3dFaceTraction {
            element: 0,
            nodes: [1, 1, 3],
            traction_kn_per_m2: [1., 0., 0.],
        }];
        assert!(solve_volume3d(request)
            .unwrap_err()
            .contains("invalid face"));
    }

    #[test]
    fn loaded_tet_agrees_across_matrix_free_csr_and_frontal_solvers() {
        let reference = solve_volume3d(loaded_one_tet()).unwrap();
        for strategy in [
            Volume3dStrategy::MatrixFree,
            Volume3dStrategy::Sparse,
            Volume3dStrategy::SparseDirect,
            Volume3dStrategy::Frontal,
        ] {
            let mut request = loaded_one_tet();
            request.solver_strategy = strategy;
            let result = solve_volume3d(request).unwrap();
            assert_eq!(result.solver_used, strategy);
            for (node, expected) in result
                .nodal_displacements_m
                .iter()
                .zip(&reference.nodal_displacements_m)
            {
                for a in 0..3 {
                    assert!((node[a] - expected[a]).abs() < 1e-15);
                }
            }
            assert!((result.nodal_reactions_kn[0][0] + 1.0).abs() < 1e-10);
            assert!((result.element_stress_mpa[0][0] - 0.006).abs() < 1e-12);
        }
    }

    #[test]
    fn automatic_falls_back_to_front_on_diagnosed_pcg_nonconvergence() {
        let mesh = Mesh::structured([2, 1, 1]).unwrap();
        let loaded_node = mesh
            .nodes
            .iter()
            .position(|p| *p == [1.0, 1.0, 1.0])
            .unwrap();
        let supports: Vec<_> = mesh
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, p)| p[0] == 0.0)
            .map(|(node, _)| Volume3dSupport {
                node,
                displacement_m: [Some(0.0); 3],
            })
            .collect();
        let request = Volume3dRequest {
            elements: mesh
                .tets
                .iter()
                .map(|&nodes| Volume3dElement { nodes, material: 0 })
                .collect(),
            nodes: mesh.nodes,
            materials: vec![Volume3dMaterial {
                e_mpa: 200_000.0,
                poisson: 0.3,
            }],
            loads: vec![Volume3dLoad {
                node: loaded_node,
                force_kn: [0.7, 0.3, -1.0],
            }],
            body_forces: vec![],
            face_tractions: vec![],
            supports,
            threads: 2,
            tolerance: 1e-10,
            max_iterations: 1,
            solver_strategy: Volume3dStrategy::Automatic,
        };
        let mut direct = request.clone();
        direct.solver_strategy = Volume3dStrategy::Frontal;
        let expected = solve_volume3d(direct).unwrap();
        let mut iterative = request.clone();
        iterative.solver_strategy = Volume3dStrategy::MatrixFree;
        assert!(solve_volume3d(iterative)
            .unwrap_err()
            .contains("did not converge"));
        let result = solve_volume3d(request).unwrap();
        assert_eq!(result.solver_used, Volume3dStrategy::Frontal);
        for (node, want) in result
            .nodal_displacements_m
            .iter()
            .zip(expected.nodal_displacements_m)
        {
            for a in 0..3 {
                assert!((node[a] - want[a]).abs() < 1e-15);
            }
        }
    }

    #[test]
    fn typed_heterogeneous_materials_recover_distinct_element_stresses() {
        let nodes = vec![
            [0., 0., 0.],
            [1., 0., 0.],
            [0., 1., 0.],
            [0., 0., 1.],
            [1., 1., 1.],
        ];
        let supports = nodes
            .iter()
            .enumerate()
            .map(|(node, p)| Volume3dSupport {
                node,
                displacement_m: [Some(1e-4 * p[0]), Some(0.), Some(0.)],
            })
            .collect();
        let request = Volume3dRequest {
            nodes,
            materials: vec![
                Volume3dMaterial {
                    e_mpa: 100_000.,
                    poisson: 0.0,
                },
                Volume3dMaterial {
                    e_mpa: 200_000.,
                    poisson: 0.0,
                },
            ],
            elements: vec![
                Volume3dElement {
                    nodes: [0, 1, 2, 3],
                    material: 0,
                },
                Volume3dElement {
                    nodes: [1, 2, 3, 4],
                    material: 1,
                },
            ],
            loads: vec![],
            body_forces: vec![],
            face_tractions: vec![],
            supports,
            threads: 2,
            tolerance: 1e-12,
            max_iterations: 10,
            solver_strategy: Volume3dStrategy::Automatic,
        };
        for strategy in [Volume3dStrategy::Automatic, Volume3dStrategy::Sparse] {
            let result = solve_volume3d(Volume3dRequest {
                solver_strategy: strategy,
                ..request.clone()
            })
            .unwrap();
            assert!((result.element_stress_mpa[0][0] - 10.).abs() < 1e-10);
            assert!((result.element_stress_mpa[1][0] - 20.).abs() < 1e-10);
            assert_eq!(result.iterations, 0);
        }
    }

    #[test]
    fn typed_model_rejects_unstable_and_invalid_input() {
        let mut request = loaded_one_tet();
        request.supports.pop();
        assert!(solve_volume3d(request).unwrap_err().contains("rigid-body"));
        let mut request = loaded_one_tet();
        request.supports.push(request.supports[0]);
        assert!(solve_volume3d(request).unwrap_err().contains("duplicate"));
        let mut request = loaded_one_tet();
        request.elements[0].material = 1;
        assert!(solve_volume3d(request)
            .unwrap_err()
            .contains("material index"));
        let mut request = loaded_one_tet();
        request.loads[0].node = 4;
        assert!(solve_volume3d(request)
            .unwrap_err()
            .contains("invalid node"));
        let mut request = loaded_one_tet();
        request.nodes.push([2., 2., 2.]);
        assert!(solve_volume3d(request).unwrap_err().contains("unused node"));
    }

    #[test]
    fn unloaded_disconnected_solid_is_not_reported_as_solved() {
        let mut request = loaded_one_tet();
        request.nodes.extend_from_slice(&[
            [10., 0., 0.],
            [11., 0., 0.],
            [10., 1., 0.],
            [10., 0., 1.],
        ]);
        request.elements.push(Volume3dElement {
            nodes: [4, 5, 6, 7],
            material: 0,
        });
        let error = solve_volume3d(request).unwrap_err();
        assert!(
            error.contains("component") && error.contains("rigid-body"),
            "{error}"
        );
    }

    #[test]
    fn tet4_uniaxial_patch_has_independent_stress_and_balanced_forces() {
        let mesh = Mesh {
            nodes: vec![[0., 0., 0.], [1., 0., 0.], [0., 1., 0.], [0., 0., 1.]],
            tets: vec![[0, 1, 2, 3]],
        };
        let op = Operator::new(&mesh, 200_000., 0.25).unwrap();
        let u: Vec<f64> = mesh
            .nodes
            .iter()
            .flat_map(|p| [1e-4 * p[0], -2.5e-5 * p[1], -2.5e-5 * p[2]])
            .collect();
        let f = op.apply(&u, 1).unwrap();
        // σxx=Eεxx=20 MPa; nodal force is σ A / 3 in this one-tet patch.
        let expected = 20_000.0 / 6.0;
        assert!((f[3] - expected).abs() < 1e-9);
        assert!((f[0] + expected).abs() < 1e-9);
        for node in 0..4 {
            assert!(f[3 * node + 1].abs() < 1e-9 && f[3 * node + 2].abs() < 1e-9);
        }
        let parallel = op.apply(&u, 2).unwrap();
        assert_eq!(parallel, f);
    }

    #[test]
    fn assembled_residual_check_preserves_extreme_finite_load_scale() {
        let mesh = Mesh {
            nodes: vec![[0., 0., 0.], [1., 0., 0.], [0., 1., 0.], [0., 0., 1.]],
            tets: vec![[0, 1, 2, 3]],
        };
        let operator = Operator::new(&mesh, 200_000., 0.25).unwrap();
        let mut loads = vec![0.0; operator.dofs];
        let mut reactions = vec![0.0; operator.dofs];
        let prescribed = vec![None; operator.dofs];
        loads[3] = 1e200;
        reactions[3] = 1e190;
        let relative =
            checked_relative_residual(&operator, &loads, &prescribed, &reactions, 1e-9).unwrap();
        assert!((relative - 1e-10).abs() < 1e-24);

        reactions[3] = 1e153;
        let error = checked_relative_residual(&operator, &loads, &prescribed, &reactions, 1e-100)
            .unwrap_err();
        assert!(error.contains("exceeds tolerance"), "{error}");

        loads[4] = 1.5e308;
        loads[3] = 1.5e308;
        let error = checked_relative_residual(&operator, &loads, &prescribed, &reactions, 1e-9)
            .unwrap_err();
        assert!(error.contains("non-finite"), "{error}");
    }

    #[test]
    fn matrix_free_pcg_rejects_non_finite_curvature_at_extreme_load() {
        let mesh = Mesh {
            nodes: vec![[0., 0., 0.], [1., 0., 0.], [0., 1., 0.], [0., 0., 1.]],
            tets: vec![[0, 1, 2, 3]],
        };
        let operator = Operator::new(&mesh, 200_000., 0.25).unwrap();
        let mut loads = vec![0.0; operator.dofs];
        loads[3] = 1e200;
        let error = operator
            .solve(&loads, &[(0, 0.0)], 1, 1e-12, 10)
            .unwrap_err();
        assert!(error.contains("non-finite"), "{error}");
    }

    #[test]
    fn structured_patch_converges_and_parallel_matches_serial() {
        let req = GridBenchmark {
            cells: [3, 3, 3],
            e_mpa: 210_000.,
            poisson: 0.3,
            threads: 1,
            tolerance: 1e-10,
            max_iterations: 200,
        };
        let serial = run_grid_benchmark(req).unwrap();
        let parallel = run_grid_benchmark(GridBenchmark { threads: 4, ..req }).unwrap();
        assert_eq!(serial.elements, 162);
        assert!(serial.max_displacement_error < 1e-12);
        assert!(parallel.max_displacement_error < 1e-12);
        assert!((serial.max_displacement_error - parallel.max_displacement_error).abs() < 1e-11);
        assert!(
            (parallel.right_face_force_kn - parallel.expected_right_face_force_kn).abs() < 1e-7
        );
    }

    #[test]
    fn sparse_pattern_patch_matches_independent_affine_solution() {
        let result = run_grid_benchmark_with_strategy(
            GridBenchmark {
                cells: [4, 3, 2],
                e_mpa: 210_000.0,
                poisson: 0.27,
                threads: 1,
                tolerance: 1e-10,
                max_iterations: 500,
            },
            Volume3dStrategy::Sparse,
        )
        .unwrap();
        assert_eq!(result.elements, 144);
        assert!(result.max_displacement_error < 1e-12);
        assert!(result.max_free_force_residual_kn < 1e-6, "{result:?}");
        assert!((result.right_face_force_kn - result.expected_right_face_force_kn).abs() < 1e-7);
    }

    #[test]
    #[ignore = "run explicitly in release mode: 257,250 Tet4 assembled CSR acceptance"]
    fn sparse_257250_tet_affine_release_acceptance() {
        let result = run_grid_benchmark_with_strategy(
            GridBenchmark {
                cells: [35, 35, 35],
                e_mpa: 210_000.0,
                poisson: 0.3,
                threads: 4,
                tolerance: 1e-9,
                max_iterations: 2_000,
            },
            Volume3dStrategy::Sparse,
        )
        .unwrap();
        assert_eq!(result.elements, 257_250);
        assert_eq!(result.dofs, 139_968);
        assert_eq!(result.threads, 4);
        assert!(result.relative_residual < 1e-9);
        assert!(result.max_displacement_error < 1e-8);
        assert!(result.max_free_force_residual_kn < 1e-4);
        assert!((result.right_face_force_kn - result.expected_right_face_force_kn).abs() < 1e-3);
        eprintln!("large sparse Tet4 result: {result:?}");
    }

    #[test]
    fn pure_shear_rigid_rotation_and_reversed_tet_are_consistent() {
        let nodes = vec![[0., 0., 0.], [1., 0., 0.], [0., 1., 0.], [0., 0., 1.]];
        let forward = Operator::new(
            &Mesh {
                nodes: nodes.clone(),
                tets: vec![[0, 1, 2, 3]],
            },
            80_000.,
            0.25,
        )
        .unwrap();
        let reversed = Operator::new(
            &Mesh {
                nodes: nodes.clone(),
                tets: vec![[0, 2, 1, 3]],
            },
            80_000.,
            0.25,
        )
        .unwrap();
        let shear: Vec<f64> = nodes.iter().flat_map(|p| [1e-4 * p[1], 0., 0.]).collect();
        let f = forward.apply(&shear, 1).unwrap();
        let f_reversed = reversed.apply(&shear, 1).unwrap();
        for (a, b) in f.iter().zip(f_reversed) {
            assert!((a - b).abs() < 1e-9);
        }
        let expected = 80_000.0 / (2.0 * 1.25) * 1_000.0 * 1e-4 / 6.0;
        assert!((f[4] - expected).abs() < 1e-9);
        assert!((f[6] - expected).abs() < 1e-9);
        let rotation: Vec<f64> = nodes
            .iter()
            .flat_map(|p| [-1e-4 * p[1], 1e-4 * p[0], 0.])
            .collect();
        assert!(forward
            .apply(&rotation, 1)
            .unwrap()
            .iter()
            .all(|v| v.abs() < 1e-9));
    }

    #[test]
    fn large_model_count_and_bad_element_validation() {
        let mesh = Mesh::structured([35, 35, 35]).unwrap();
        assert_eq!(mesh.tets.len(), 257_250);
        assert_eq!(mesh.nodes.len(), 46_656);
        let bad = Mesh {
            nodes: vec![[0.; 3]; 4],
            tets: vec![[0, 1, 2, 3]],
        };
        assert!(Operator::new(&bad, 1., 0.3).is_err());
    }
}
