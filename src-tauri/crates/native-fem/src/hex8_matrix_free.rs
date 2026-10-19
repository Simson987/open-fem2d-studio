//! Matrix-free, parallel Jacobi-PCG for Hex8 meshes.
//!
//! This route stores connectivity, one material index per cell, and one reusable
//! 24×24 local stiffness per isotropic material, not a global sparse matrix.
//! The structured path requires a regular box. `GeneralOperator` stores one
//! packed symmetric element stiffness per cell for arbitrary valid
//! coordinates/connectivity.
//! Units are m, MPa and kN.

use crate::hex8::Hex8Element;
use serde::{Deserialize, Serialize};

const MAX_NODES: usize = 2_000_000;
const MAX_ELEMENTS: usize = 2_000_000;
const MAX_MATERIALS: usize = 4_096;
const MAX_PARALLEL_SCRATCH: usize = 512 * 1024 * 1024;
// A general cell retains 300 symmetric stiffness entries, 192 Gauss-gradient
// entries and its volume: 3,944 bytes. Limit both this cache and PCG vectors.
const MAX_GENERAL_LOCAL_STORAGE: usize = 256 * 1024 * 1024;
pub const MAX_GENERAL_ELEMENTS: usize =
    MAX_GENERAL_LOCAL_STORAGE / std::mem::size_of::<CompactHex8Element>();
pub const MAX_GENERAL_DOFS: usize = 480_000;
const MAX_GENERAL_LARGE_LOCAL_STORAGE: usize = 1024 * 1024 * 1024;
pub const MAX_GENERAL_LARGE_ELEMENTS: usize =
    MAX_GENERAL_LARGE_LOCAL_STORAGE / std::mem::size_of::<CompactHex8Element>();
pub const MAX_GENERAL_LARGE_DOFS: usize = 1_000_000;

const LOCAL_DOFS: usize = 24;
const UPPER_ENTRIES: usize = LOCAL_DOFS * (LOCAL_DOFS + 1) / 2;

#[derive(Debug)]
struct CompactHex8Element {
    stiffness_upper: [f64; UPPER_ENTRIES],
    volume_m3: f64,
    gauss_gradients: [[[f64; 3]; 8]; 8],
}

impl CompactHex8Element {
    fn upper_index(row: usize, column: usize) -> usize {
        let (row, column) = if row <= column {
            (row, column)
        } else {
            (column, row)
        };
        row * (2 * LOCAL_DOFS - row + 1) / 2 + column - row
    }

    fn from_full(element: Hex8Element) -> Self {
        let mut stiffness_upper = [0.0; UPPER_ENTRIES];
        for row in 0..LOCAL_DOFS {
            for column in row..LOCAL_DOFS {
                stiffness_upper[Self::upper_index(row, column)] = element.stiffness[row][column];
            }
        }
        Self {
            stiffness_upper,
            volume_m3: element.volume_m3,
            gauss_gradients: element.gauss_gradients,
        }
    }

    fn stiffness(&self, row: usize, column: usize) -> f64 {
        self.stiffness_upper[Self::upper_index(row, column)]
    }

    fn apply(&self, displacement: [f64; LOCAL_DOFS]) -> [f64; LOCAL_DOFS] {
        let mut force = [0.0; LOCAL_DOFS];
        for (row, output) in force.iter_mut().enumerate() {
            // Preserve the full-element row summation order.
            *output = (0..LOCAL_DOFS)
                .map(|column| self.stiffness(row, column) * displacement[column])
                .sum();
        }
        force
    }

    fn to_full(&self) -> Hex8Element {
        let mut stiffness = [[0.0; LOCAL_DOFS]; LOCAL_DOFS];
        for (row, values) in stiffness.iter_mut().enumerate() {
            for (column, value) in values.iter_mut().enumerate() {
                *value = self.stiffness(row, column);
            }
        }
        Hex8Element {
            stiffness,
            volume_m3: self.volume_m3,
            gauss_gradients: self.gauss_gradients,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Mesh {
    pub cells: [usize; 3],
    pub nodes: Vec<[f64; 3]>,
    pub hexes: Vec<[usize; 8]>,
}

#[derive(Debug)]
pub struct Operator {
    pub mesh: Mesh,
    locals: Vec<Hex8Element>,
    material_indices: Vec<usize>,
    diagonal: Vec<f64>,
}

#[derive(Debug)]
pub struct GeneralOperator {
    pub nodes: Vec<[f64; 3]>,
    pub hexes: Vec<[usize; 8]>,
    locals: Vec<CompactHex8Element>,
    diagonal: Vec<f64>,
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
    pub threads: usize,
    pub tolerance: f64,
    pub max_iterations: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkResult {
    pub nodes: usize,
    pub elements: usize,
    pub dofs: usize,
    pub threads: usize,
    pub iterations: usize,
    pub relative_residual: f64,
    pub max_displacement_error_m: f64,
    pub right_face_force_kn: f64,
    pub left_face_reaction_kn: f64,
    pub expected_force_kn: f64,
}

fn node_index(i: usize, j: usize, k: usize, nx: usize, ny: usize) -> usize {
    (k * (ny + 1) + j) * (nx + 1) + i
}

impl Mesh {
    /// Unit cube subdivided into regular Cartesian Hex8 cells.
    pub fn structured(cells: [usize; 3]) -> Result<Self, String> {
        Self::structured_box(cells, [1.0; 3])
    }

    /// Positive rectangular box from the origin to `lengths`, divided into
    /// regular Cartesian Hex8 cells in standard structured ordering.
    pub fn structured_box(cells: [usize; 3], lengths: [f64; 3]) -> Result<Self, String> {
        let [nx, ny, nz] = cells;
        if cells.contains(&0) {
            return Err("each Hex8 grid dimension must be positive".into());
        }
        if lengths
            .iter()
            .any(|length| !length.is_finite() || *length <= 0.0)
        {
            return Err("Hex8 box lengths must be finite and positive".into());
        }
        let widths = [
            lengths[0] / nx as f64,
            lengths[1] / ny as f64,
            lengths[2] / nz as f64,
        ];
        if widths
            .iter()
            .any(|width| !width.is_finite() || *width <= 0.0)
        {
            return Err("Hex8 cell widths must be finite and positive".into());
        }
        let [px, py, pz] = cells
            .map(|n| n.checked_add(1))
            .map(|v| v.ok_or("Hex8 dimension overflow"));
        let (px, py, pz) = (px?, py?, pz?);
        let nodes_count = px
            .checked_mul(py)
            .and_then(|n| n.checked_mul(pz))
            .ok_or("Hex8 node count overflow")?;
        let elements_count = nx
            .checked_mul(ny)
            .and_then(|n| n.checked_mul(nz))
            .ok_or("Hex8 element count overflow")?;
        if nodes_count > MAX_NODES || elements_count > MAX_ELEMENTS {
            return Err("Hex8 grid exceeds the current node/element safety budget".into());
        }
        let mut nodes = Vec::with_capacity(nodes_count);
        for k in 0..=nz {
            for j in 0..=ny {
                for i in 0..=nx {
                    nodes.push([
                        i as f64 / nx as f64 * lengths[0],
                        j as f64 / ny as f64 * lengths[1],
                        k as f64 / nz as f64 * lengths[2],
                    ]);
                }
            }
        }
        let mut hexes = Vec::with_capacity(elements_count);
        for k in 0..nz {
            for j in 0..ny {
                for i in 0..nx {
                    hexes.push([
                        node_index(i, j, k, nx, ny),
                        node_index(i + 1, j, k, nx, ny),
                        node_index(i + 1, j + 1, k, nx, ny),
                        node_index(i, j + 1, k, nx, ny),
                        node_index(i, j, k + 1, nx, ny),
                        node_index(i + 1, j, k + 1, nx, ny),
                        node_index(i + 1, j + 1, k + 1, nx, ny),
                        node_index(i, j + 1, k + 1, nx, ny),
                    ]);
                }
            }
        }
        Ok(Self {
            cells,
            nodes,
            hexes,
        })
    }
}

fn dot(left: &[f64], right: &[f64]) -> f64 {
    left.iter().zip(right).map(|(a, b)| a * b).sum()
}

fn free_norm(vector: &[f64], fixed: &[bool]) -> f64 {
    // Scale before squaring to keep large but finite PCG loads representable.
    // Two simple reductions are cheaper than a per-DOF hypot in large meshes.
    let mut scale = 0.0_f64;
    for (&value, &is_fixed) in vector.iter().zip(fixed) {
        if !is_fixed {
            if !value.is_finite() {
                return f64::NAN;
            }
            scale = scale.max(value.abs());
        }
    }
    if scale == 0.0 {
        return 0.0;
    }
    scale
        * vector
            .iter()
            .zip(fixed)
            .filter(|(_, is_fixed)| !**is_fixed)
            .map(|(value, _)| (value / scale).powi(2))
            .sum::<f64>()
            .sqrt()
}

/// A structured mesh is connected. Check that the prescribed directions
/// remove all six continuum rigid-body modes, including for zero load where
/// an iterative solver otherwise has no chance to reveal a nullspace.
fn rigid_body_modes_restrained(nodes: &[[f64; 3]], prescribed: &[(usize, f64)]) -> bool {
    if prescribed.len() < 6 {
        return false;
    }
    let mut gram = [[0.0; 6]; 6];
    for &(dof, _) in prescribed {
        let [x, y, z] = nodes[dof / 3];
        let row = match dof % 3 {
            0 => [1.0, 0.0, 0.0, 0.0, z, -y],
            1 => [0.0, 1.0, 0.0, -z, 0.0, x],
            _ => [0.0, 0.0, 1.0, y, -x, 0.0],
        };
        for i in 0..6 {
            for j in 0..6 {
                gram[i][j] += row[i] * row[j];
            }
        }
    }
    let scale = (0..6).map(|i| gram[i][i]).fold(0.0, f64::max);
    for col in 0..6 {
        let pivot = (col..6)
            .max_by(|a, b| gram[*a][col].abs().total_cmp(&gram[*b][col].abs()))
            .expect("nonempty pivot range");
        if gram[pivot][col].abs() <= 1e-12 * scale {
            return false;
        }
        gram.swap(col, pivot);
        let diagonal = gram[col][col];
        for row in col + 1..6 {
            let factor = gram[row][col] / diagonal;
            for j in col..6 {
                gram[row][j] -= factor * gram[col][j];
            }
        }
    }
    true
}

fn apply_elements(
    hexes: &[[usize; 8]],
    material_indices: &[usize],
    locals: &[Hex8Element],
    x: &[f64],
    sum: &mut [f64],
) {
    for (hex, &material) in hexes.iter().zip(material_indices) {
        let stiffness = &locals[material].stiffness;
        let mut local_x = [0.0; 24];
        for (i, &node) in hex.iter().enumerate() {
            local_x[3 * i..3 * i + 3].copy_from_slice(&x[3 * node..3 * node + 3]);
        }
        for i in 0..8 {
            for component in 0..3 {
                let local_dof = 3 * i + component;
                let mut value = 0.0;
                for (k, u) in stiffness[local_dof].iter().zip(local_x) {
                    value += k * u;
                }
                sum[3 * hex[i] + component] += value;
            }
        }
    }
}

impl Operator {
    pub fn new(mesh: Mesh, e_mpa: f64, poisson: f64) -> Result<Self, String> {
        let material_indices = vec![0; mesh.hexes.len()];
        Self::new_with_materials(mesh, &[(e_mpa, poisson)], material_indices)
    }

    pub fn new_with_materials(
        mesh: Mesh,
        materials: &[(f64, f64)],
        material_indices: Vec<usize>,
    ) -> Result<Self, String> {
        if mesh.hexes.is_empty() || mesh.nodes.is_empty() {
            return Err("Hex8 mesh is empty".into());
        }
        if materials.is_empty() {
            return Err("Hex8 materials must be nonempty".into());
        }
        if materials.len() > MAX_MATERIALS {
            return Err(format!(
                "Hex8 matrix-free material count exceeds {MAX_MATERIALS}"
            ));
        }
        if material_indices.len() != mesh.hexes.len() {
            return Err("Hex8 element material count differs from element count".into());
        }
        for (cell, &material) in material_indices.iter().enumerate() {
            if material >= materials.len() {
                return Err(format!("Hex8 cell {cell} has an invalid material index"));
            }
        }
        let [nx, ny, nz] = mesh.cells;
        if mesh.cells.contains(&0)
            || nx
                .checked_add(1)
                .and_then(|px| ny.checked_add(1).and_then(|py| px.checked_mul(py)))
                .and_then(|plane| nz.checked_add(1).and_then(|pz| plane.checked_mul(pz)))
                != Some(mesh.nodes.len())
            || nx.checked_mul(ny).and_then(|n| n.checked_mul(nz)) != Some(mesh.hexes.len())
        {
            return Err("Hex8 operator requires an intact structured mesh".into());
        }
        for k in 0..nz {
            for j in 0..ny {
                for i in 0..nx {
                    let expected = [
                        node_index(i, j, k, nx, ny),
                        node_index(i + 1, j, k, nx, ny),
                        node_index(i + 1, j + 1, k, nx, ny),
                        node_index(i, j + 1, k, nx, ny),
                        node_index(i, j, k + 1, nx, ny),
                        node_index(i + 1, j, k + 1, nx, ny),
                        node_index(i + 1, j + 1, k + 1, nx, ny),
                        node_index(i, j + 1, k + 1, nx, ny),
                    ];
                    let cell = (k * ny + j) * nx + i;
                    if mesh.hexes[cell] != expected {
                        return Err(format!(
                            "Hex8 structured connectivity changed at cell {cell}"
                        ));
                    }
                }
            }
        }
        let lengths = mesh.nodes[node_index(nx, ny, nz, nx, ny)];
        if lengths
            .iter()
            .any(|length| !length.is_finite() || *length <= 0.0)
        {
            return Err("Hex8 structured box lengths must be finite and positive".into());
        }
        for k in 0..=nz {
            for j in 0..=ny {
                for i in 0..=nx {
                    let expected = [
                        i as f64 / nx as f64 * lengths[0],
                        j as f64 / ny as f64 * lengths[1],
                        k as f64 / nz as f64 * lengths[2],
                    ];
                    if mesh.nodes[node_index(i, j, k, nx, ny)] != expected {
                        return Err("Hex8 structured node coordinates changed".into());
                    }
                }
            }
        }
        let coordinates = [
            [0.0, 0.0, 0.0],
            [lengths[0] / nx as f64, 0.0, 0.0],
            [lengths[0] / nx as f64, lengths[1] / ny as f64, 0.0],
            [0.0, lengths[1] / ny as f64, 0.0],
            [0.0, 0.0, lengths[2] / nz as f64],
            [lengths[0] / nx as f64, 0.0, lengths[2] / nz as f64],
            [
                lengths[0] / nx as f64,
                lengths[1] / ny as f64,
                lengths[2] / nz as f64,
            ],
            [0.0, lengths[1] / ny as f64, lengths[2] / nz as f64],
        ];
        let mut locals = Vec::with_capacity(materials.len());
        for (index, &(e_mpa, poisson)) in materials.iter().enumerate() {
            if !e_mpa.is_finite()
                || e_mpa <= 0.0
                || !poisson.is_finite()
                || !(0.0..0.5).contains(&poisson)
            {
                return Err(format!("Hex8 material {index} is invalid"));
            }
            locals.push(Hex8Element::new(coordinates, e_mpa, poisson)?);
        }
        let dofs = mesh.nodes.len().checked_mul(3).ok_or("Hex8 DOF overflow")?;
        let mut diagonal = vec![0.0; dofs];
        for (hex, &material) in mesh.hexes.iter().zip(&material_indices) {
            let local = &locals[material];
            for (local_node, &global_node) in hex.iter().enumerate() {
                for component in 0..3 {
                    diagonal[3 * global_node + component] +=
                        local.stiffness[3 * local_node + component][3 * local_node + component];
                }
            }
        }
        if diagonal.iter().any(|d| !d.is_finite() || *d <= 0.0) {
            return Err("Hex8 diagonal is nonpositive or non-finite".into());
        }
        Ok(Self {
            mesh,
            locals,
            material_indices,
            diagonal,
        })
    }

    pub fn local_for_material(&self, index: usize) -> Option<&Hex8Element> {
        self.locals.get(index)
    }

    pub fn dofs(&self) -> usize {
        self.diagonal.len()
    }

    /// Computes K*x by parallel element action and deterministic worker reduction.
    pub fn apply(&self, x: &[f64], threads: usize) -> Result<Vec<f64>, String> {
        if x.len() != self.dofs() || x.iter().any(|value| !value.is_finite()) {
            return Err("Hex8 displacement vector is invalid".into());
        }
        if threads == 0 || threads > 32 {
            return Err("Hex8 thread count must be between 1 and 32".into());
        }
        let workers = threads.min(self.mesh.hexes.len());
        let scratch = workers
            .checked_mul(self.dofs())
            .and_then(|n| n.checked_mul(8))
            .ok_or("Hex8 parallel scratch memory overflow")?;
        if scratch > MAX_PARALLEL_SCRATCH {
            return Err("Hex8 parallel scratch exceeds 512 MiB; reduce threads".into());
        }
        let mut result = vec![0.0; self.dofs()];
        if workers == 1 {
            apply_elements(
                &self.mesh.hexes,
                &self.material_indices,
                &self.locals,
                x,
                &mut result,
            );
        } else {
            let chunk = self.mesh.hexes.len().div_ceil(workers);
            std::thread::scope(|scope| {
                let mut handles = Vec::with_capacity(workers);
                for (hexes, material_indices) in self
                    .mesh
                    .hexes
                    .chunks(chunk)
                    .zip(self.material_indices.chunks(chunk))
                {
                    handles.push(scope.spawn(move || {
                        let mut local = vec![0.0; x.len()];
                        apply_elements(hexes, material_indices, &self.locals, x, &mut local);
                        local
                    }));
                }
                for handle in handles {
                    let local = handle.join().expect("Hex8 worker panicked");
                    for (sum, value) in result.iter_mut().zip(local) {
                        *sum += value;
                    }
                }
            });
        }
        if result.iter().any(|value| !value.is_finite()) {
            return Err("Hex8 matrix-free product is non-finite".into());
        }
        Ok(result)
    }

    pub fn solve(
        &self,
        loads_kn: &[f64],
        prescribed: &[(usize, f64)],
        threads: usize,
        tolerance: f64,
        max_iterations: usize,
    ) -> Result<Solution, String> {
        solve_pcg(
            &self.mesh.nodes,
            &self.diagonal,
            self.mesh.hexes.len(),
            |x| self.apply(x, threads),
            loads_kn,
            prescribed,
            threads,
            tolerance,
            max_iterations,
        )
    }
}

fn apply_general_elements(
    hexes: &[[usize; 8]],
    locals: &[CompactHex8Element],
    x: &[f64],
    sum: &mut [f64],
) {
    for (hex, element) in hexes.iter().zip(locals) {
        let mut local_x = [0.0; 24];
        for (i, &node) in hex.iter().enumerate() {
            local_x[3 * i..3 * i + 3].copy_from_slice(&x[3 * node..3 * node + 3]);
        }
        let local_f = element.apply(local_x);
        for (i, &node) in hex.iter().enumerate() {
            for component in 0..3 {
                sum[3 * node + component] += local_f[3 * i + component];
            }
        }
    }
}

pub(crate) fn check_general_budget(
    elements: usize,
    dofs: usize,
    large: bool,
) -> Result<(), String> {
    let (max_elements, max_dofs, max_cache, cache_name) = if large {
        (
            MAX_GENERAL_LARGE_ELEMENTS,
            MAX_GENERAL_LARGE_DOFS,
            MAX_GENERAL_LARGE_LOCAL_STORAGE,
            "1 GiB",
        )
    } else {
        (
            MAX_GENERAL_ELEMENTS,
            MAX_GENERAL_DOFS,
            MAX_GENERAL_LOCAL_STORAGE,
            "256 MiB",
        )
    };
    if elements > max_elements || dofs > max_dofs {
        return Err(format!(
            "Hex8 general matrix-free is limited to {max_elements} elements and {max_dofs} DOFs"
        ));
    }
    let cache_bytes = elements
        .checked_mul(std::mem::size_of::<CompactHex8Element>())
        .ok_or("Hex8 general element cache byte count overflow")?;
    if cache_bytes > max_cache {
        return Err(format!("Hex8 general element cache exceeds {cache_name}"));
    }
    dofs.checked_mul(std::mem::size_of::<f64>())
        .ok_or("Hex8 diagonal byte count overflow")?;
    Ok(())
}

impl GeneralOperator {
    pub(crate) fn diagonal(&self) -> &[f64] {
        &self.diagonal
    }
    pub fn new(
        nodes: Vec<[f64; 3]>,
        hexes: Vec<[usize; 8]>,
        materials: &[(f64, f64)],
        material_indices: &[usize],
    ) -> Result<Self, String> {
        Self::new_with_budget(nodes, hexes, materials, material_indices, false)
    }

    /// Explicit larger cache for general geometry; the default constructor
    /// retains its original limits.
    pub fn new_large(
        nodes: Vec<[f64; 3]>,
        hexes: Vec<[usize; 8]>,
        materials: &[(f64, f64)],
        material_indices: &[usize],
    ) -> Result<Self, String> {
        Self::new_with_budget(nodes, hexes, materials, material_indices, true)
    }

    fn new_with_budget(
        nodes: Vec<[f64; 3]>,
        hexes: Vec<[usize; 8]>,
        materials: &[(f64, f64)],
        material_indices: &[usize],
        large: bool,
    ) -> Result<Self, String> {
        let dofs = nodes.len().checked_mul(3).ok_or("Hex8 DOF overflow")?;
        if hexes.is_empty() || nodes.is_empty() {
            return Err("Hex8 mesh is empty".into());
        }
        check_general_budget(hexes.len(), dofs, large)?;
        if nodes.iter().flatten().any(|value| !value.is_finite()) {
            return Err("Hex8 mesh contains a non-finite coordinate".into());
        }
        if materials.is_empty() || material_indices.len() != hexes.len() {
            return Err("Hex8 general matrix-free material data is incomplete".into());
        }
        let mut locals = Vec::with_capacity(hexes.len());
        let mut diagonal = vec![0.0; dofs];
        let mut used = vec![false; nodes.len()];
        for (index, (hex, &material_index)) in hexes.iter().zip(material_indices).enumerate() {
            let &(e, nu) = materials
                .get(material_index)
                .ok_or_else(|| format!("Hex8 element {index} has an invalid material index"))?;
            for (i, &node) in hex.iter().enumerate() {
                if node >= nodes.len() || hex[..i].contains(&node) {
                    return Err(format!(
                        "Hex8 element {index} has duplicate or invalid nodes"
                    ));
                }
                used[node] = true;
            }
            let local = CompactHex8Element::from_full(
                Hex8Element::new(hex.map(|node| nodes[node]), e, nu)
                    .map_err(|error| format!("Hex8 element {index}: {error}"))?,
            );
            for (local_node, &global_node) in hex.iter().enumerate() {
                for component in 0..3 {
                    diagonal[3 * global_node + component] +=
                        local.stiffness(3 * local_node + component, 3 * local_node + component);
                }
            }
            locals.push(local);
        }
        if used.contains(&false) {
            return Err("Hex8 mesh has a node unused by any element".into());
        }
        if diagonal
            .iter()
            .any(|value| !value.is_finite() || *value <= 0.0)
        {
            return Err("Hex8 diagonal is nonpositive or non-finite".into());
        }
        Ok(Self {
            nodes,
            hexes,
            locals,
            diagonal,
        })
    }

    /// Reconstructs one full element for postprocessing without retaining a
    /// full 24×24 matrix for every cell in the operator.
    pub fn local_for_element(&self, index: usize) -> Option<Hex8Element> {
        self.locals.get(index).map(CompactHex8Element::to_full)
    }

    pub fn apply(&self, x: &[f64], threads: usize) -> Result<Vec<f64>, String> {
        if x.len() != self.diagonal.len() || x.iter().any(|value| !value.is_finite()) {
            return Err("Hex8 displacement vector is invalid".into());
        }
        if threads == 0 || threads > 32 {
            return Err("Hex8 thread count must be between 1 and 32".into());
        }
        let workers = threads.min(self.hexes.len());
        let scratch = workers
            .checked_mul(self.diagonal.len())
            .and_then(|n| n.checked_mul(8))
            .ok_or("Hex8 parallel scratch memory overflow")?;
        if scratch > MAX_PARALLEL_SCRATCH {
            return Err("Hex8 parallel scratch exceeds 512 MiB; reduce threads".into());
        }
        let mut result = vec![0.0; self.diagonal.len()];
        if workers == 1 {
            apply_general_elements(&self.hexes, &self.locals, x, &mut result);
        } else {
            let chunk = self.hexes.len().div_ceil(workers);
            std::thread::scope(|scope| {
                let mut handles = Vec::with_capacity(workers);
                for (hexes, locals) in self.hexes.chunks(chunk).zip(self.locals.chunks(chunk)) {
                    handles.push(scope.spawn(move || {
                        let mut local = vec![0.0; x.len()];
                        apply_general_elements(hexes, locals, x, &mut local);
                        local
                    }));
                }
                for handle in handles {
                    let local = handle.join().expect("Hex8 worker panicked");
                    for (sum, value) in result.iter_mut().zip(local) {
                        *sum += value;
                    }
                }
            });
        }
        if result.iter().any(|value| !value.is_finite()) {
            return Err("Hex8 matrix-free product is non-finite".into());
        }
        Ok(result)
    }

    pub fn solve(
        &self,
        loads_kn: &[f64],
        prescribed: &[(usize, f64)],
        threads: usize,
        tolerance: f64,
        max_iterations: usize,
    ) -> Result<Solution, String> {
        solve_pcg(
            &self.nodes,
            &self.diagonal,
            self.hexes.len(),
            |x| self.apply(x, threads),
            loads_kn,
            prescribed,
            threads,
            tolerance,
            max_iterations,
        )
    }
}

pub(crate) fn solve_pcg(
    nodes: &[[f64; 3]],
    diagonal: &[f64],
    element_count: usize,
    apply: impl Fn(&[f64]) -> Result<Vec<f64>, String>,
    loads_kn: &[f64],
    prescribed: &[(usize, f64)],
    threads: usize,
    tolerance: f64,
    max_iterations: usize,
) -> Result<Solution, String> {
    solve_pcg_internal(
        Some(nodes),
        diagonal,
        element_count,
        apply,
        loads_kn,
        prescribed,
        threads,
        tolerance,
        max_iterations,
    )
}

/// Solve a coupled system whose supports have already been checked against
/// its complete rigid-body modes. The Hex8-only rank check cannot be used for
/// mixed translation/rotation DOF layouts; the caller must perform that check.
pub(crate) fn solve_pcg_with_prevalidated_support(
    diagonal: &[f64],
    element_count: usize,
    apply: impl Fn(&[f64]) -> Result<Vec<f64>, String>,
    loads_kn: &[f64],
    prescribed: &[(usize, f64)],
    threads: usize,
    tolerance: f64,
    max_iterations: usize,
) -> Result<Solution, String> {
    solve_pcg_internal(
        None,
        diagonal,
        element_count,
        apply,
        loads_kn,
        prescribed,
        threads,
        tolerance,
        max_iterations,
    )
}

fn solve_pcg_internal(
    nodes_for_rank_check: Option<&[[f64; 3]]>,
    diagonal: &[f64],
    element_count: usize,
    apply: impl Fn(&[f64]) -> Result<Vec<f64>, String>,
    loads_kn: &[f64],
    prescribed: &[(usize, f64)],
    threads: usize,
    tolerance: f64,
    max_iterations: usize,
) -> Result<Solution, String> {
    let dofs = diagonal.len();
    if loads_kn.len() != dofs || loads_kn.iter().any(|v| !v.is_finite()) {
        return Err("Hex8 load vector is invalid".into());
    }
    if !tolerance.is_finite() || !(0.0..1.0).contains(&tolerance) || max_iterations == 0 {
        return Err("Hex8 PCG tolerance or iteration limit is invalid".into());
    }
    let mut fixed = vec![false; dofs];
    let mut u_fixed = vec![0.0; dofs];
    for &(dof, value) in prescribed {
        if dof >= dofs || !value.is_finite() || fixed[dof] {
            return Err("Hex8 prescribed DOF is invalid or duplicated".into());
        }
        fixed[dof] = true;
        u_fixed[dof] = value;
    }
    if !fixed.contains(&true) {
        return Err("Hex8 volume has no prescribed displacement".into());
    }
    if let Some(nodes) = nodes_for_rank_check {
        if !rigid_body_modes_restrained(nodes, prescribed) {
            return Err("Hex8 supports do not restrain all six rigid-body modes".into());
        }
    }
    let ku_fixed = apply(&u_fixed)?;
    let mut rhs = vec![0.0; dofs];
    for i in 0..dofs {
        if !fixed[i] {
            rhs[i] = loads_kn[i] - ku_fixed[i];
        }
    }
    let rhs_norm = free_norm(&rhs, &fixed);
    if !rhs_norm.is_finite() {
        return Err("Hex8 PCG right-hand-side norm became non-finite".into());
    }
    let target = tolerance * rhs_norm.max(1.0);
    let mut correction = vec![0.0; dofs];
    let mut residual = rhs.clone();
    let mut preconditioned = vec![0.0; dofs];
    for i in 0..dofs {
        if !fixed[i] {
            preconditioned[i] = residual[i] / diagonal[i];
        }
    }
    let mut direction = preconditioned.clone();
    let mut rz = dot(&residual, &preconditioned);
    if rhs_norm > target && (!rz.is_finite() || rz <= 0.0) {
        return Err("Hex8 PCG initial preconditioned residual failed".into());
    }
    let mut iterations = 0;
    if rhs_norm > target {
        for iteration in 1..=max_iterations {
            let mut kd = apply(&direction)?;
            for i in 0..dofs {
                if fixed[i] {
                    kd[i] = 0.0;
                }
            }
            let curvature = dot(&direction, &kd);
            if !curvature.is_finite() || curvature <= 0.0 {
                return Err(format!(
                    "Hex8 PCG lost positive curvature at iteration {iteration}"
                ));
            }
            let alpha = rz / curvature;
            if !alpha.is_finite() {
                return Err("Hex8 PCG step became non-finite".into());
            }
            for i in 0..dofs {
                correction[i] += alpha * direction[i];
                residual[i] -= alpha * kd[i];
            }
            iterations = iteration;
            let recursive_norm = free_norm(&residual, &fixed);
            if !recursive_norm.is_finite() {
                return Err("Hex8 PCG residual became non-finite".into());
            }
            if recursive_norm <= target || iteration % 50 == 0 {
                let kx = apply(&correction)?;
                let true_residual: Vec<f64> = rhs
                    .iter()
                    .zip(kx)
                    .enumerate()
                    .map(|(i, (b, ax))| if fixed[i] { 0.0 } else { b - ax })
                    .collect();
                let true_norm = free_norm(&true_residual, &fixed);
                if !true_norm.is_finite() {
                    return Err("Hex8 true PCG residual became non-finite".into());
                }
                if true_norm <= target {
                    break;
                }
                if recursive_norm <= target || true_norm > 10.0 * recursive_norm {
                    residual = true_residual;
                    for i in 0..dofs {
                        preconditioned[i] = if fixed[i] {
                            0.0
                        } else {
                            residual[i] / diagonal[i]
                        };
                    }
                    rz = dot(&residual, &preconditioned);
                    if !rz.is_finite() || rz <= 0.0 {
                        return Err("Hex8 PCG restart failed".into());
                    }
                    direction.clone_from(&preconditioned);
                    continue;
                }
            }
            for i in 0..dofs {
                preconditioned[i] = if fixed[i] {
                    0.0
                } else {
                    residual[i] / diagonal[i]
                };
            }
            let next_rz = dot(&residual, &preconditioned);
            if !next_rz.is_finite() || next_rz <= 0.0 {
                return Err("Hex8 PCG preconditioned residual failed".into());
            }
            let beta = next_rz / rz;
            for i in 0..dofs {
                direction[i] = preconditioned[i] + beta * direction[i];
            }
            rz = next_rz;
        }
    }
    if correction.iter().any(|value| !value.is_finite()) {
        return Err("Hex8 PCG correction became non-finite".into());
    }
    for i in 0..dofs {
        u_fixed[i] += correction[i];
    }
    let mut reactions = apply(&u_fixed)?;
    for (reaction, load) in reactions.iter_mut().zip(loads_kn) {
        *reaction -= load;
    }
    let relative_residual = free_norm(&reactions, &fixed) / rhs_norm.max(1.0);
    if !relative_residual.is_finite() || relative_residual > 5.0 * tolerance {
        return Err(format!(
                "Hex8 PCG did not converge in {iterations} iterations (true relative residual {relative_residual:.3e})"
            ));
    }
    Ok(Solution {
        displacements: u_fixed,
        reactions,
        iterations,
        relative_residual,
        threads: threads.min(element_count),
    })
}

/// Analytic uniaxial traction test: σxx=E*ε and u=(εx,-νεy,-νεz).
/// Consistent Q4 face loads are assembled on x=1; x=0 fixes ux and three
/// additional DOFs remove rigid translations/rotation without blocking Poisson.
pub fn run_grid_benchmark(request: GridBenchmark) -> Result<BenchmarkResult, String> {
    let mesh = Mesh::structured(request.cells)?;
    let [nx, ny, nz] = request.cells;
    let mut loads = vec![0.0; mesh.nodes.len() * 3];
    let epsilon = 0.001;
    let sigma_kn_m2 = request.e_mpa * epsilon * 1_000.0;
    let face_node_force = sigma_kn_m2 / (4.0 * ny as f64 * nz as f64);
    for k in 0..nz {
        for j in 0..ny {
            for (jj, kk) in [(j, k), (j + 1, k), (j + 1, k + 1), (j, k + 1)] {
                let node = node_index(nx, jj, kk, nx, ny);
                loads[3 * node] += face_node_force;
            }
        }
    }
    let mut prescribed = Vec::with_capacity((ny + 1) * (nz + 1) + 3);
    for k in 0..=nz {
        for j in 0..=ny {
            prescribed.push((3 * node_index(0, j, k, nx, ny), 0.0));
        }
    }
    let origin = node_index(0, 0, 0, nx, ny);
    prescribed.push((3 * origin + 1, 0.0));
    prescribed.push((3 * origin + 2, 0.0));
    prescribed.push((3 * node_index(0, ny, 0, nx, ny) + 2, 0.0));
    let operator = Operator::new(mesh, request.e_mpa, request.poisson)?;
    let solution = operator.solve(
        &loads,
        &prescribed,
        request.threads,
        request.tolerance,
        request.max_iterations,
    )?;
    let max_displacement_error_m = operator
        .mesh
        .nodes
        .iter()
        .enumerate()
        .flat_map(|(node, [x, y, z])| {
            [
                (solution.displacements[3 * node] - epsilon * x).abs(),
                (solution.displacements[3 * node + 1] + request.poisson * epsilon * y).abs(),
                (solution.displacements[3 * node + 2] + request.poisson * epsilon * z).abs(),
            ]
        })
        .fold(0.0, f64::max);
    let mut right_face_force_kn = 0.0;
    let mut left_face_reaction_kn = 0.0;
    for k in 0..=nz {
        for j in 0..=ny {
            right_face_force_kn += loads[3 * node_index(nx, j, k, nx, ny)];
            left_face_reaction_kn += solution.reactions[3 * node_index(0, j, k, nx, ny)];
        }
    }
    Ok(BenchmarkResult {
        nodes: operator.mesh.nodes.len(),
        elements: operator.mesh.hexes.len(),
        dofs: operator.dofs(),
        threads: solution.threads,
        iterations: solution.iterations,
        relative_residual: solution.relative_residual,
        max_displacement_error_m,
        right_face_force_kn,
        left_face_reaction_kn,
        expected_force_kn: sigma_kn_m2,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prevalidated_support_preserves_pcg_and_hex8_rank_check() {
        let apply = |x: &[f64]| Ok(vec![2.0 * x[0], 2.0 * x[1]]);
        let solution = solve_pcg_with_prevalidated_support(
            &[2.0, 2.0],
            1,
            apply,
            &[0.0, 1.0],
            &[(0, 0.0)],
            1,
            1e-12,
            10,
        )
        .unwrap();
        assert!((solution.displacements[1] - 0.5).abs() < 1e-12);
        assert!(solution.relative_residual < 1e-12);
        let checked = solve_pcg(
            &[[0.0, 0.0, 0.0]],
            &[2.0, 2.0],
            1,
            apply,
            &[0.0, 1.0],
            &[(0, 0.0)],
            1,
            1e-12,
            10,
        );
        assert!(checked.unwrap_err().contains("rigid-body"));
    }

    fn benchmark(cells: [usize; 3], threads: usize) -> BenchmarkResult {
        run_grid_benchmark(GridBenchmark {
            cells,
            e_mpa: 30_000.0,
            poisson: 0.25,
            threads,
            tolerance: 1e-9,
            max_iterations: 2_000,
        })
        .unwrap()
    }

    #[test]
    fn structured_mesh_has_8_node_cells_and_shared_interfaces() {
        let mesh = Mesh::structured([2, 1, 1]).unwrap();
        assert_eq!(mesh.hexes.len(), 2);
        assert_eq!(mesh.nodes.len(), 12);
        let left: Vec<_> = mesh.hexes[0]
            .iter()
            .copied()
            .filter(|&n| mesh.nodes[n][0] == 0.5)
            .collect();
        let right: Vec<_> = mesh.hexes[1]
            .iter()
            .copied()
            .filter(|&n| mesh.nodes[n][0] == 0.5)
            .collect();
        assert_eq!(left.len(), 4);
        assert_eq!(
            left.into_iter().collect::<std::collections::BTreeSet<_>>(),
            right.into_iter().collect()
        );
    }

    #[test]
    fn affine_patch_balances_tractions_and_matches_parallel_solution() {
        let serial = benchmark([4, 3, 2], 1);
        let parallel = benchmark([4, 3, 2], 4);
        assert_eq!(serial.elements, 24);
        for result in [serial, parallel] {
            assert!(result.max_displacement_error_m < 1e-10, "{result:?}");
            assert!(result.relative_residual < 1e-9, "{result:?}");
            assert!((result.right_face_force_kn - result.expected_force_kn).abs() < 1e-8);
            assert!(
                (result.left_face_reaction_kn + result.expected_force_kn).abs() < 1e-4,
                "{result:?}"
            );
        }
    }

    #[test]
    fn matrix_free_pcg_preserves_large_finite_residual_scale() {
        // The free 2×2 block is 1e308 [1 1/2; 1/2 1]. For f=(1e155, 0),
        // the independent inverse gives u=1e-153 (4/3, -2/3).
        let mesh = Mesh::structured([1, 1, 1]).unwrap();
        let dofs = mesh.nodes.len() * 3;
        let diagonal = vec![1e308; dofs];
        let mut loads = vec![0.0; dofs];
        loads[6] = 1e155;
        let prescribed: Vec<_> = (0..dofs)
            .filter(|dof| *dof != 6 && *dof != 7)
            .map(|dof| (dof, 0.0))
            .collect();
        let result = solve_pcg(
            &mesh.nodes,
            &diagonal,
            1,
            |u| {
                let mut force: Vec<f64> = u.iter().map(|value| 1e308 * value).collect();
                force[6] += 5e307 * u[7];
                force[7] += 5e307 * u[6];
                Ok(force)
            },
            &loads,
            &prescribed,
            1,
            1e-12,
            10,
        )
        .unwrap();
        assert!((result.displacements[6] / 1e-153 - 4.0 / 3.0).abs() < 1e-12);
        assert!((result.displacements[7] / 1e-153 + 2.0 / 3.0).abs() < 1e-12);
        assert!(result.relative_residual < 1e-12);
    }

    #[test]
    fn rectangular_box_affine_traction_patch_balances_resultant() {
        let cells = [2, 2, 2];
        let lengths = [2.0, 3.0, 4.0];
        let youngs = 30_000.0;
        let poisson = 0.25;
        let strain = 0.001;
        let mesh = Mesh::structured_box(cells, lengths).unwrap();
        let operator = Operator::new(mesh, youngs, poisson).unwrap();
        let mut loads = vec![0.0; operator.dofs()];
        let traction_kn_m2 = youngs * strain * 1_000.0;
        let face_node_force =
            traction_kn_m2 * lengths[1] * lengths[2] / (4.0 * cells[1] as f64 * cells[2] as f64);
        for k in 0..cells[2] {
            for j in 0..cells[1] {
                for (jj, kk) in [(j, k), (j + 1, k), (j + 1, k + 1), (j, k + 1)] {
                    loads[3 * node_index(cells[0], jj, kk, cells[0], cells[1])] += face_node_force;
                }
            }
        }
        let mut prescribed = Vec::new();
        for k in 0..=cells[2] {
            for j in 0..=cells[1] {
                prescribed.push((3 * node_index(0, j, k, cells[0], cells[1]), 0.0));
            }
        }
        prescribed.extend([
            (3 * node_index(0, 0, 0, cells[0], cells[1]) + 1, 0.0),
            (3 * node_index(0, 0, 0, cells[0], cells[1]) + 2, 0.0),
            (3 * node_index(0, cells[1], 0, cells[0], cells[1]) + 2, 0.0),
        ]);
        let solved = operator
            .solve(&loads, &prescribed, 4, 1e-10, 2_000)
            .unwrap();
        let max_error = operator
            .mesh
            .nodes
            .iter()
            .enumerate()
            .flat_map(|(node, &[x, y, z])| {
                [
                    (solved.displacements[3 * node] - strain * x).abs(),
                    (solved.displacements[3 * node + 1] + poisson * strain * y).abs(),
                    (solved.displacements[3 * node + 2] + poisson * strain * z).abs(),
                ]
            })
            .fold(0.0, f64::max);
        let applied = loads.iter().step_by(3).sum::<f64>();
        let reaction = solved.reactions.iter().step_by(3).sum::<f64>();
        let expected = traction_kn_m2 * lengths[1] * lengths[2];
        assert!(max_error < 1e-10, "max displacement error {max_error}");
        assert!(solved.relative_residual < 1e-10);
        assert!((applied - expected).abs() < 1e-8);
        assert!((reaction + expected).abs() < 1e-6);
    }

    #[test]
    fn parallel_matvec_matches_serial_for_non_affine_field() {
        let operator = Operator::new(Mesh::structured([3, 3, 2]).unwrap(), 30_000.0, 0.25).unwrap();
        let displacement: Vec<f64> = (0..operator.dofs())
            .map(|dof| (dof as f64 * 0.173).sin() * 0.001)
            .collect();
        let serial = operator.apply(&displacement, 1).unwrap();
        let parallel = operator.apply(&displacement, 4).unwrap();
        for (a, b) in serial.iter().zip(parallel) {
            assert!((a - b).abs() <= 1e-11 * a.abs().max(1.0));
        }
    }

    #[test]
    fn heterogeneous_operator_validates_materials_and_matches_parallel_action() {
        let mesh = Mesh::structured([2, 1, 1]).unwrap();
        let invalid_count =
            Operator::new_with_materials(mesh.clone(), &[(30_000.0, 0.25)], vec![0]);
        assert!(invalid_count.unwrap_err().contains("material count"));
        let invalid_index =
            Operator::new_with_materials(mesh.clone(), &[(30_000.0, 0.25)], vec![0, 1]);
        assert!(invalid_index
            .unwrap_err()
            .contains("invalid material index"));
        for material in [(0.0, 0.25), (f64::NAN, 0.25), (30_000.0, 0.5)] {
            assert!(
                Operator::new_with_materials(mesh.clone(), &[material], vec![0, 0])
                    .unwrap_err()
                    .contains("invalid")
            );
        }
        let operator =
            Operator::new_with_materials(mesh, &[(30_000.0, 0.25), (12_000.0, 0.31)], vec![0, 1])
                .unwrap();
        let u: Vec<f64> = (0..operator.dofs())
            .map(|dof| (dof as f64 * 0.173).sin() * 0.001)
            .collect();
        let serial = operator.apply(&u, 1).unwrap();
        let parallel = operator.apply(&u, 2).unwrap();
        for (left, right) in serial.iter().zip(parallel) {
            assert!((left - right).abs() <= 1e-11 * left.abs().max(1.0));
        }
    }

    #[test]
    fn compact_general_elements_preserve_warped_stiffness_and_parallel_action() {
        assert_eq!(std::mem::size_of::<CompactHex8Element>(), 3_944);
        assert!(
            MAX_GENERAL_ELEMENTS * std::mem::size_of::<CompactHex8Element>()
                <= MAX_GENERAL_LOCAL_STORAGE
        );
        assert!(
            (MAX_GENERAL_ELEMENTS + 1) * std::mem::size_of::<CompactHex8Element>()
                > MAX_GENERAL_LOCAL_STORAGE
        );
        let mut mesh = Mesh::structured([2, 1, 1]).unwrap();
        mesh.nodes[1][1] += 0.07;
        mesh.nodes[1][2] += 0.03;
        let materials = [(30_000.0, 0.25), (17_000.0, 0.31)];
        let general =
            GeneralOperator::new(mesh.nodes.clone(), mesh.hexes.clone(), &materials, &[0, 1])
                .unwrap();
        let displacement: Vec<f64> = (0..mesh.nodes.len() * 3)
            .map(|dof| (dof as f64 * 0.37).sin() * 0.001)
            .collect();
        let mut expected = vec![0.0; displacement.len()];
        for (index, hex) in mesh.hexes.iter().enumerate() {
            let (e, nu) = materials[index];
            let full = Hex8Element::new(hex.map(|node| mesh.nodes[node]), e, nu).unwrap();
            let restored = general.local_for_element(index).unwrap();
            assert_eq!(restored.stiffness, full.stiffness);
            assert_eq!(restored.gauss_gradients, full.gauss_gradients);
            assert_eq!(restored.volume_m3, full.volume_m3);
            let mut local_u = [0.0; 24];
            for (local, &node) in hex.iter().enumerate() {
                local_u[3 * local..3 * local + 3]
                    .copy_from_slice(&displacement[3 * node..3 * node + 3]);
            }
            let local_f = full.apply(local_u);
            for (local, &node) in hex.iter().enumerate() {
                for component in 0..3 {
                    expected[3 * node + component] += local_f[3 * local + component];
                }
            }
        }
        let serial = general.apply(&displacement, 1).unwrap();
        assert_eq!(serial, expected);
        let parallel = general.apply(&displacement, 2).unwrap();
        assert_eq!(parallel, general.apply(&displacement, 2).unwrap());
        for (actual, expected) in parallel.iter().zip(serial) {
            assert!((actual - expected).abs() <= 1e-12 * expected.abs().max(1.0));
        }
    }

    #[test]
    fn general_element_and_dof_budgets_reject_oversized_input_before_assembly() {
        let cube = Mesh::structured([1, 1, 1]).unwrap();
        let excess_hexes = vec![cube.hexes[0]; MAX_GENERAL_ELEMENTS + 1];
        let material_indices = vec![0; excess_hexes.len()];
        assert!(GeneralOperator::new(
            cube.nodes.clone(),
            excess_hexes,
            &[(30_000.0, 0.25)],
            &material_indices,
        )
        .unwrap_err()
        .contains("limited"));
        let excess_nodes = vec![[0.0; 3]; MAX_GENERAL_DOFS / 3 + 1];
        assert!(
            GeneralOperator::new(excess_nodes, cube.hexes, &[(30_000.0, 0.25)], &[0],)
                .unwrap_err()
                .contains("limited")
        );
    }

    #[test]
    fn explicit_large_general_budget_extends_cache_without_changing_default() {
        assert_eq!(std::mem::size_of::<CompactHex8Element>(), 3_944);
        assert!(MAX_GENERAL_ELEMENTS < 250_000);
        assert!(MAX_GENERAL_LARGE_ELEMENTS >= 250_000);
        assert!(check_general_budget(250_000, 786_432, false).is_err());
        assert!(check_general_budget(250_000, 786_432, true).is_ok());
        assert!(check_general_budget(MAX_GENERAL_LARGE_ELEMENTS + 1, 24, true).is_err());
        assert!(check_general_budget(1, MAX_GENERAL_LARGE_DOFS + 1, true).is_err());
        assert!(check_general_budget(usize::MAX, 24, true).is_err());
    }

    #[test]
    fn invalid_mesh_threads_and_supports_are_rejected() {
        assert!(Mesh::structured([0, 1, 1]).is_err());
        assert!(Mesh::structured_box([1, 1, 1], [1.0, 0.0, 1.0]).is_err());
        assert!(Mesh::structured_box([1, 1, 1], [1.0, f64::INFINITY, 1.0]).is_err());
        let mut shifted = Mesh::structured_box([2, 1, 1], [2.0, 3.0, 4.0]).unwrap();
        shifted.nodes[0][0] = 0.1;
        assert!(Operator::new(shifted, 30_000.0, 0.2)
            .unwrap_err()
            .contains("coordinates"));
        let mut malformed = Mesh::structured([1, 1, 1]).unwrap();
        malformed.hexes[0][0] = malformed.nodes.len();
        assert!(Operator::new(malformed, 30_000.0, 0.2).is_err());
        let operator = Operator::new(Mesh::structured([1, 1, 1]).unwrap(), 30_000.0, 0.2).unwrap();
        assert!(operator.apply(&vec![0.0; operator.dofs()], 0).is_err());
        assert!(operator
            .solve(&vec![0.0; operator.dofs()], &[], 1, 1e-9, 20)
            .is_err());
        // Before the rank check, zero RHS made PCG return a false success for
        // this underconstrained model because no iteration was needed.
        let zero_load = vec![0.0; operator.dofs()];
        let three_translations = [(0, 0.0), (1, 0.0), (2, 0.0)];
        assert!(operator
            .solve(&zero_load, &three_translations, 1, 1e-9, 20)
            .unwrap_err()
            .contains("rigid-body"));
        let collinear_supports = [(0, 0.0), (1, 0.0), (2, 0.0), (3, 0.0), (4, 0.0), (5, 0.0)];
        assert!(operator
            .solve(&zero_load, &collinear_supports, 1, 1e-9, 20)
            .unwrap_err()
            .contains("rigid-body"));
    }

    #[test]
    #[ignore = "250,047 Hex8 release benchmark; run explicitly with --ignored --nocapture"]
    fn benchmark_250k_hex8_four_threads() {
        let started = std::time::Instant::now();
        let result = benchmark([63, 63, 63], 4);
        assert_eq!(result.elements, 250_047);
        assert!(result.max_displacement_error_m < 1e-7, "{result:?}");
        assert!((result.left_face_reaction_kn + result.expected_force_kn).abs() < 1e-4);
        println!(
            "Hex8 250k benchmark: {result:?}, elapsed={:?}",
            started.elapsed()
        );
    }
}
