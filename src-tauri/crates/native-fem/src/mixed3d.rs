//! Linear Tet4/Hex8 solids, axial trusses, membranes, horizontal DKT plates and bending frames on shared DOFs.
//! Coordinates/displacements are metres, moduli/stresses MPa, forces kN.
//! Frame rotations are allocated only at nodes touched by bending members.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::{
    csr, csr_ldlt, frontal, hex8::Hex8Element, hex8_loads, hex8_matrix_free, j2_pcg_support, math,
    mixed3d_membrane::MembraneData, volume3d, volume_hex8,
};

// This first mixed route retains dense local matrices for every element.
// Reject oversized input before constructing them; large arbitrary meshes
// require a compact/matrix-free mixed operator instead.
pub(crate) const MAX_STORED_LOCAL_ENTRIES: usize = 8_000_000;
pub(crate) const MAX_MIXED3D_SPARSE_DIRECT_DOFS: usize = 10_000;
pub(crate) const MAX_MIXED3D_SPARSE_DIRECT_FACTOR_ENTRIES: usize = 2_000_000;
const MAX_AUTOMATIC_FRONTAL_ESTIMATED_BYTES: usize = 256 * 1024 * 1024;
const MAX_MIXED_SOLID_RANK_PROBE_DOFS: usize = 128;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hex8MixedElement {
    pub nodes: [usize; 8],
    pub e_mpa: f64,
    pub poisson: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Truss3dElement {
    pub nodes: [usize; 2],
    pub e_mpa: f64,
    pub area_m2: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Membrane3dElement {
    pub nodes: [usize; 3],
    pub e_mpa: f64,
    pub nu: f64,
    pub thickness_m: f64,
}

/// Horizontal XY Discrete Kirchhoff Triangle. Global physical DOFs are
/// [uz, rx, ry] at each node; the DKT interpolation uses opposite signs for
/// both rotations. No membrane or drilling stiffness is implied.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BendingPlate3dElement {
    pub nodes: [usize; 3],
    pub e_mpa: f64,
    pub nu: f64,
    pub thickness_m: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Membrane3dSurfaceTraction {
    pub element: usize,
    pub traction_kn_per_m2: [f64; 3],
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame3dMixedElement {
    pub nodes: [usize; 2],
    pub e_mpa: f64,
    pub poisson: f64,
    #[serde(default)]
    pub g_mpa: Option<f64>,
    pub area_m2: f64,
    pub iy_m4: f64,
    pub iz_m4: f64,
    pub torsion_j_m4: f64,
    #[serde(default)]
    pub roll_angle_rad: f64,
}

/// Linearly varying transverse load on a bending frame, in its local y/z axes.
/// `element` indexes `frames`; positions are measured from its first node.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Frame3dMemberLoad {
    pub element: usize,
    pub qy_start_kn_per_m: f64,
    pub qy_end_kn_per_m: f64,
    pub qz_start_kn_per_m: f64,
    pub qz_end_kn_per_m: f64,
    pub start_position_m: f64,
    pub end_position_m: f64,
}

/// Transverse point force on a bending frame in its local y/z axes.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Frame3dMemberPointLoad {
    pub element: usize,
    pub py_kn: f64,
    pub pz_kn: f64,
    pub position_m: f64,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Mixed3dBackend {
    #[default]
    Dense,
    SparseDirect,
    SparsePcg,
    MatrixFreePcg,
    FrontalWave,
    Automatic,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mixed3dRequest {
    pub mesh: volume3d::Mesh,
    pub solid_material: volume3d::Volume3dMaterial,
    /// Optional material for every Tet4 in `mesh.tets` order.
    #[serde(default)]
    pub tet_materials: Option<Vec<volume3d::Volume3dMaterial>>,
    #[serde(default)]
    pub hexes: Vec<Hex8MixedElement>,
    pub trusses: Vec<Truss3dElement>,
    #[serde(default)]
    pub membranes: Vec<Membrane3dElement>,
    #[serde(default)]
    pub bending_plates: Vec<BendingPlate3dElement>,
    #[serde(default)]
    pub membrane_tractions: Vec<Membrane3dSurfaceTraction>,
    #[serde(default)]
    pub frames: Vec<Frame3dMixedElement>,
    #[serde(default)]
    pub frame_member_loads: Vec<Frame3dMemberLoad>,
    #[serde(default)]
    pub frame_member_point_loads: Vec<Frame3dMemberPointLoad>,
    pub loads_kn: Vec<[f64; 3]>,
    #[serde(default)]
    pub moments_knm: Vec<[f64; 3]>,
    #[serde(default)]
    pub tet_body_forces: Vec<volume3d::Volume3dBodyForce>,
    #[serde(default)]
    pub tet_face_tractions: Vec<volume3d::Volume3dFaceTraction>,
    #[serde(default)]
    pub hex_body_forces: Vec<volume_hex8::Hex8VolumeBodyForce>,
    #[serde(default)]
    pub hex_face_tractions: Vec<volume_hex8::Hex8VolumeFaceTraction>,
    pub prescribed_m: Vec<[Option<f64>; 3]>,
    #[serde(default)]
    pub prescribed_rotations_rad: Vec<[Option<f64>; 3]>,
    #[serde(default)]
    pub backend: Mixed3dBackend,
    #[serde(default = "default_max_front_dofs")]
    pub max_front_dofs: usize,
    #[serde(default = "default_threads")]
    pub threads: usize,
    #[serde(default = "default_max_pcg_iterations")]
    pub max_pcg_iterations: usize,
}

fn default_max_front_dofs() -> usize {
    4096
}

fn default_threads() -> usize {
    1
}

fn default_max_pcg_iterations() -> usize {
    10_000
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mixed3dResult {
    pub nodal_displacements_m: Vec<[f64; 3]>,
    pub nodal_reactions_kn: Vec<[f64; 3]>,
    pub solid_element_stress_mpa: Vec<[f64; 6]>,
    pub hex_gauss_stress_mpa: Vec<[[f64; 6]; 8]>,
    pub truss_axial_force_kn: Vec<f64>,
    pub membrane_stress_mpa: Vec<[f64; 3]>,
    pub membrane_resultants_kn_per_m: Vec<[f64; 3]>,
    /// Elastic XY-DKT [Mx, My, Mxy] at each triangle centroid, in kN m/m,
    /// ordered exactly like the request's bendingPlates. Empty without plates.
    pub bending_plate_moments_knm_per_m: Vec<[f64; 3]>,
    pub nodal_rotations_rad: Vec<Option<[f64; 3]>>,
    pub nodal_moment_reactions_knm: Vec<Option<[f64; 3]>>,
    pub frame_end_forces_local: Vec<[[f64; 6]; 2]>,
    pub relative_residual: f64,
    pub backend_used: Mixed3dBackend,
    pub frontal_maximum_front_dofs: Option<usize>,
    pub linear_iterations: usize,
}

pub(crate) fn truss_element(
    mesh: &volume3d::Mesh,
    truss: &Truss3dElement,
    index: usize,
) -> Result<(frontal::FrontalElement, [f64; 3], f64), String> {
    let [a, b] = truss.nodes;
    if a == b {
        return Err(format!("truss {index}: repeated node"));
    }
    let (Some(&p), Some(&q)) = (mesh.nodes.get(a), mesh.nodes.get(b)) else {
        return Err(format!("truss {index}: node outside mesh"));
    };
    if !truss.e_mpa.is_finite()
        || truss.e_mpa <= 0.0
        || !truss.area_m2.is_finite()
        || truss.area_m2 <= 0.0
    {
        return Err(format!(
            "truss {index}: E and area must be positive and finite"
        ));
    }
    let difference = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    let length = difference.iter().fold(0.0_f64, |n, v| n.hypot(*v));
    let scale = p
        .iter()
        .chain(q.iter())
        .fold(1.0_f64, |m, v| m.max(v.abs()));
    if !length.is_finite() || length <= 1e-12 * scale {
        return Err(format!("truss {index}: zero or degenerate length"));
    }
    let direction = difference.map(|v| v / length);
    let stiffness_scale = 1000.0 * truss.e_mpa * truss.area_m2 / length;
    if !stiffness_scale.is_finite() {
        return Err(format!("truss {index}: stiffness overflow"));
    }
    let axial = [
        -direction[0],
        -direction[1],
        -direction[2],
        direction[0],
        direction[1],
        direction[2],
    ];
    let stiffness = (0..6)
        .flat_map(|i| (0..6).map(move |j| stiffness_scale * axial[i] * axial[j]))
        .collect();
    let dofs = [3 * a, 3 * a + 1, 3 * a + 2, 3 * b, 3 * b + 1, 3 * b + 2].to_vec();
    Ok((
        frontal::FrontalElement { dofs, stiffness },
        direction,
        stiffness_scale,
    ))
}

fn add_consistent_load(
    loads: &mut [f64],
    node: usize,
    force: [f64; 3],
    context: &str,
) -> Result<(), String> {
    for axis in 0..3 {
        let dof = 3 * node + axis;
        loads[dof] += force[axis];
        if !loads[dof].is_finite() {
            return Err(format!("{context}: accumulated nodal force overflow"));
        }
    }
    Ok(())
}

/// Consistent nodal loads are assembled once and passed unchanged to every
/// backend. Tet4 integrals use V/4 and A/3; Tri3 tractions use A/3;
/// Hex8 uses mapped Gauss quadrature.
pub(crate) fn assemble_distributed_loads(
    request: &Mixed3dRequest,
    loads: &mut [f64],
) -> Result<(), String> {
    let nodes = &request.mesh.nodes;
    for (index, body) in request.tet_body_forces.iter().enumerate() {
        let context = format!("mixed3d Tet4 body force {index}");
        let tet = request
            .mesh
            .tets
            .get(body.element)
            .ok_or_else(|| format!("{context}: element index outside mesh"))?;
        if body.force_kn_per_m3.iter().any(|v| !v.is_finite()) {
            return Err(format!("{context}: non-finite force density"));
        }
        let [a, b, c, d] = tet.map(|node| nodes.get(node).copied());
        let [Some(a), Some(b), Some(c), Some(d)] = [a, b, c, d] else {
            return Err(format!("{context}: node outside mesh"));
        };
        let ab = sub3(b, a);
        let ac = sub3(c, a);
        let ad = sub3(d, a);
        let volume = dot3(ab, cross3(ac, ad)).abs() / 6.0;
        if !volume.is_finite() || volume <= 0.0 {
            return Err(format!("{context}: degenerate or non-finite Tet4"));
        }
        for &node in tet {
            add_consistent_load(
                loads,
                node,
                body.force_kn_per_m3.map(|v| v * volume / 4.0),
                &context,
            )?;
        }
    }
    for (index, face) in request.tet_face_tractions.iter().enumerate() {
        let context = format!("mixed3d Tet4 face traction {index}");
        let tet = request
            .mesh
            .tets
            .get(face.element)
            .ok_or_else(|| format!("{context}: element index outside mesh"))?;
        if face.traction_kn_per_m2.iter().any(|v| !v.is_finite())
            || face
                .nodes
                .iter()
                .enumerate()
                .any(|(local, node)| !tet.contains(node) || face.nodes[..local].contains(node))
        {
            return Err(format!("{context}: invalid face or traction"));
        }
        let [a, b, c] = face.nodes.map(|node| nodes.get(node).copied());
        let [Some(a), Some(b), Some(c)] = [a, b, c] else {
            return Err(format!("{context}: node outside mesh"));
        };
        let area_vector = cross3(sub3(b, a), sub3(c, a));
        let area = dot3(area_vector, area_vector).sqrt() / 2.0;
        if !area.is_finite() || area <= 0.0 {
            return Err(format!("{context}: degenerate face"));
        }
        for &node in &face.nodes {
            add_consistent_load(
                loads,
                node,
                face.traction_kn_per_m2.map(|v| v * area / 3.0),
                &context,
            )?;
        }
    }
    for (index, body) in request.hex_body_forces.iter().enumerate() {
        let context = format!("mixed3d Hex8 body force {index}");
        let hex = request
            .hexes
            .get(body.element)
            .ok_or_else(|| format!("{context}: element index outside mesh"))?;
        let Some(coordinates) = hex
            .nodes
            .map(|node| nodes.get(node).copied())
            .into_iter()
            .collect::<Option<Vec<_>>>()
        else {
            return Err(format!("{context}: node outside mesh"));
        };
        let local = hex8_loads::consistent_uniform_body_force(
            coordinates.try_into().unwrap(),
            body.force_kn_per_m3,
        )
        .map_err(|error| format!("{context}: {error}"))?;
        for (local_node, &node) in hex.nodes.iter().enumerate() {
            add_consistent_load(loads, node, local[local_node], &context)?;
        }
    }
    for (index, face) in request.hex_face_tractions.iter().enumerate() {
        let context = format!("mixed3d Hex8 face traction {index}");
        let hex = request
            .hexes
            .get(face.element)
            .ok_or_else(|| format!("{context}: element index outside mesh"))?;
        let Some(coordinates) = hex
            .nodes
            .map(|node| nodes.get(node).copied())
            .into_iter()
            .collect::<Option<Vec<_>>>()
        else {
            return Err(format!("{context}: node outside mesh"));
        };
        let local = hex8_loads::consistent_uniform_face_traction(
            coordinates.try_into().unwrap(),
            face.face_nodes,
            face.traction_kn_per_m2,
        )
        .map_err(|error| format!("{context}: {error}"))?;
        for (local_node, &node) in hex.nodes.iter().enumerate() {
            add_consistent_load(loads, node, local[local_node], &context)?;
        }
    }
    for (index, surface) in request.membrane_tractions.iter().enumerate() {
        let context = format!("mixed3d membrane traction {index}");
        let membrane = request
            .membranes
            .get(surface.element)
            .ok_or_else(|| format!("{context}: element index outside mesh"))?;
        if surface.traction_kn_per_m2.iter().any(|v| !v.is_finite()) {
            return Err(format!("{context}: non-finite traction"));
        }
        let [a, b, c] = membrane.nodes.map(|node| nodes.get(node).copied());
        let [Some(a), Some(b), Some(c)] = [a, b, c] else {
            return Err(format!("{context}: node outside mesh"));
        };
        let area_vector = cross3(sub3(b, a), sub3(c, a));
        let area = dot3(area_vector, area_vector).sqrt() / 2.0;
        if !area.is_finite() || area <= 0.0 {
            return Err(format!("{context}: degenerate or non-finite membrane area"));
        }
        for &node in &membrane.nodes {
            add_consistent_load(
                loads,
                node,
                surface.traction_kn_per_m2.map(|v| v * area / 3.0),
                &context,
            )?;
        }
    }
    Ok(())
}

fn sub3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn dot3(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn component_root(parents: &mut [usize], node: usize) -> usize {
    let mut root = node;
    while root != parents[root] {
        root = parents[root];
    }
    let mut current = node;
    while current != root {
        let next = parents[current];
        parents[current] = root;
        current = next;
    }
    root
}

fn join_component(parents: &mut [usize], a: usize, b: usize) {
    let a = component_root(parents, a);
    let b = component_root(parents, b);
    if a != b {
        parents[b] = a;
    }
}

/// A necessary guard for iterative solves, including an unloaded solve where
/// PCG cannot discover a nullspace by following the right-hand side.
/// Components are joined by shared nodes; a vertex/edge hinge within one
/// component still needs a direct inertia or geometric interface check.
fn validate_iterative_supports(
    request: &Mixed3dRequest,
    prescribed: &[Option<f64>],
) -> Result<(), String> {
    // A pure Tet4 mesh can contain two bodies that meet only at a vertex or
    // edge. Node connectivity merges them, but that interface can rotate as
    // a hinge. Reuse the face-connected rigid-mode check before a zero RHS
    // lets PCG report a false converged solution. Other element families may
    // bridge such an interface and need a separate general rank check.
    if !request.mesh.tets.is_empty()
        && request.hexes.is_empty()
        && request.trusses.is_empty()
        && request.membranes.is_empty()
    {
        let flags = prescribed.iter().map(Option::is_some).collect::<Vec<_>>();
        j2_pcg_support::validate(&request.mesh, &flags)
            .map_err(|detail| format!("mixed3d {detail}"))?;
    }
    if request.mesh.tets.is_empty()
        && !request.hexes.is_empty()
        && request.trusses.is_empty()
        && request.membranes.is_empty()
    {
        validate_pure_hex_face_groups(request, prescribed)?;
    }
    let nodes = request.mesh.nodes.len();
    let mut parents: Vec<usize> = (0..nodes).collect();
    let mut used = vec![false; nodes];
    for tet in &request.mesh.tets {
        for &node in tet {
            if node >= nodes {
                return Err("mixed3d Tet4 node outside mesh".into());
            }
            used[node] = true;
            join_component(&mut parents, tet[0], node);
        }
    }
    for hex in &request.hexes {
        for &node in &hex.nodes {
            if node >= nodes {
                return Err("mixed3d Hex8 node outside mesh".into());
            }
            used[node] = true;
            join_component(&mut parents, hex.nodes[0], node);
        }
    }
    for truss in &request.trusses {
        for &node in &truss.nodes {
            if node >= nodes {
                return Err("mixed3d truss node outside mesh".into());
            }
            used[node] = true;
            join_component(&mut parents, truss.nodes[0], node);
        }
    }
    for membrane in &request.membranes {
        for &node in &membrane.nodes {
            if node >= nodes {
                return Err("mixed3d membrane node outside mesh".into());
            }
            used[node] = true;
            join_component(&mut parents, membrane.nodes[0], node);
        }
    }
    if let Some(node) = used.iter().position(|&value| !value) {
        return Err(format!("mixed3d node {node} is unused by every element"));
    }
    let pure_trusses = request.mesh.tets.is_empty()
        && request.hexes.is_empty()
        && request.membranes.is_empty()
        && !request.trusses.is_empty();
    // Each disconnected pure-truss component can have its own axial axis.
    // A global axis would reject a valid X chain beside a valid Y chain.
    let mut truss_axis_by_component: HashMap<usize, Option<usize>> = HashMap::new();
    if pure_trusses {
        for truss in &request.trusses {
            let root = component_root(&mut parents, truss.nodes[0]);
            let [a, b] = truss.nodes;
            let axis = (0..3).find(|&axis| {
                (0..3).all(|other| {
                    other == axis
                        || (request.mesh.nodes[a][other] - request.mesh.nodes[b][other]).abs()
                            < 1e-12
                })
            });
            truss_axis_by_component
                .entry(root)
                .and_modify(|known| {
                    if *known != axis {
                        *known = None;
                    }
                })
                .or_insert(axis);
        }
    }
    let mut component_supports: HashMap<usize, Vec<(usize, f64)>> = HashMap::new();
    let mut transverse_restrained: HashMap<usize, bool> = HashMap::new();
    for node in 0..nodes {
        let root = component_root(&mut parents, node);
        let supports = component_supports.entry(root).or_default();
        let restrained = truss_axis_by_component
            .get(&root)
            .copied()
            .flatten()
            .is_some_and(|axis| {
                (0..3).all(|other| other == axis || prescribed[3 * node + other].is_some())
            });
        transverse_restrained
            .entry(root)
            .and_modify(|all| *all &= restrained)
            .or_insert(restrained);
        for axis in 0..3 {
            if let Some(value) = prescribed[3 * node + axis] {
                supports.push((3 * node + axis, value));
            }
        }
    }
    for (root, supports) in component_supports {
        // An axis-aligned truss chain with both transverse translations fixed
        // has only one kinematic rigid mode per connected component. The
        // generic six-mode solid check would reject this valid reduced model.
        let restrained_axial_truss = truss_axis_by_component
            .get(&root)
            .copied()
            .flatten()
            .is_some_and(|axis| {
                transverse_restrained.get(&root).copied().unwrap_or(false)
                    && supports.iter().any(|(dof, _)| dof % 3 == axis)
            });
        if restrained_axial_truss {
            continue;
        }
        if !volume3d::supports_restrain_rigid_modes(&request.mesh.nodes, &supports) {
            return Err(format!(
                "mixed3d component {root}: supports do not restrain all six rigid-body modes"
            ));
        }
    }
    if request.mesh.tets.is_empty() && request.hexes.is_empty() && request.membranes.is_empty() {
        validate_pure_truss_rank(request, prescribed, &mut parents)?;
    }
    validate_membrane_node_normal_modes(request, prescribed)?;
    Ok(())
}

/// A truss can have an internal mechanism even when all six rigid-body modes
/// are restrained. Zero-load PCG would otherwise return before probing that
/// nullspace. Count constraints per component on large models and check the
/// exact free-DOF compatibility rank for bounded small models.
fn validate_pure_truss_rank(
    request: &Mixed3dRequest,
    prescribed: &[Option<f64>],
    parents: &mut [usize],
) -> Result<(), String> {
    let mut free_by_component: HashMap<usize, usize> = HashMap::new();
    let mut bars_by_component: HashMap<usize, usize> = HashMap::new();
    let mut free_index = vec![None; prescribed.len()];
    let mut free_count = 0;
    for (dof, value) in prescribed.iter().enumerate() {
        if value.is_none() {
            let root = component_root(parents, dof / 3);
            *free_by_component.entry(root).or_default() += 1;
            free_index[dof] = Some(free_count);
            free_count += 1;
        }
    }
    for truss in &request.trusses {
        let root = component_root(parents, truss.nodes[0]);
        *bars_by_component.entry(root).or_default() += 1;
    }
    for (root, free) in free_by_component {
        if free > bars_by_component.get(&root).copied().unwrap_or(0) {
            return Err(format!(
                "mixed3d truss component {root} has deficient rank: {free} free translations but only {} bars",
                bars_by_component.get(&root).copied().unwrap_or(0),
            ));
        }
    }
    if free_count == 0 || free_count > 128 || request.trusses.len() > 512 {
        return Ok(());
    }

    // The extension of a bar is n·(u_b-u_a). Two-pass modified Gram-Schmidt
    // determines whether these independent equations span every free DOF.
    // Geometry, not E·A, controls this kinematic rank.
    let mut basis: Vec<Vec<f64>> = Vec::with_capacity(free_count);
    for (index, truss) in request.trusses.iter().enumerate() {
        let (_, direction, _) = truss_element(&request.mesh, truss, index)?;
        let mut row = vec![0.0; free_count];
        for (node, sign) in [(truss.nodes[0], -1.0), (truss.nodes[1], 1.0)] {
            for axis in 0..3 {
                if let Some(column) = free_index[3 * node + axis] {
                    row[column] += sign * direction[axis];
                }
            }
        }
        for _ in 0..2 {
            for vector in &basis {
                let projection: f64 = row.iter().zip(vector).map(|(a, b)| a * b).sum();
                for (value, component) in row.iter_mut().zip(vector) {
                    *value -= projection * component;
                }
            }
        }
        let norm = row.iter().fold(0.0_f64, |sum, value| sum.hypot(*value));
        if norm > 1e-10 {
            row.iter_mut().for_each(|value| *value /= norm);
            basis.push(row);
            if basis.len() == free_count {
                return Ok(());
            }
        }
    }
    Err(format!(
        "mixed3d truss compatibility has deficient rank: {} independent bar extensions for {free_count} free translations",
        basis.len(),
    ))
}

/// A node carried only by coplanar Tri3 membranes has no stiffness along
/// their common normal. Its normal motion is a true mechanism when no
/// prescribed component blocks it. This local necessary check is linear in
/// element incidence; noncoplanar membranes and other element families may
/// brace the node, so they are left to the remaining solver checks.
pub(crate) fn validate_membrane_node_normal_modes(
    request: &Mixed3dRequest,
    prescribed: &[Option<f64>],
) -> Result<(), String> {
    if request.membranes.is_empty() {
        return Ok(());
    }
    let nodes = request.mesh.nodes.len();
    let mut braced_by_other_element = vec![false; nodes];
    for &node in request
        .mesh
        .tets
        .iter()
        .flatten()
        .chain(
            request
                .hexes
                .iter()
                .flat_map(|element| element.nodes.iter()),
        )
        .chain(
            request
                .trusses
                .iter()
                .flat_map(|element| element.nodes.iter()),
        )
        .chain(
            request
                .frames
                .iter()
                .flat_map(|element| element.nodes.iter()),
        )
    {
        if node < nodes {
            braced_by_other_element[node] = true;
        }
    }
    let mut membrane_normal: Vec<Option<(usize, [f64; 3])>> = vec![None; nodes];
    let mut nonparallel_membranes = vec![false; nodes];
    for (index, membrane) in request.membranes.iter().enumerate() {
        for &node in &membrane.nodes {
            if node >= nodes {
                return Err("mixed3d membrane node outside mesh".into());
            }
        }
        let [a, b, c] = membrane.nodes.map(|id| request.mesh.nodes[id]);
        let normal = cross3(sub3(b, a), sub3(c, a));
        let length = normal.iter().fold(0.0_f64, |sum, value| sum.hypot(*value));
        // The element constructor reports invalid geometry separately.
        if !length.is_finite() || length == 0.0 {
            continue;
        }
        let normal = normal.map(|value| value / length);
        for &node in &membrane.nodes {
            if let Some((_, reference)) = membrane_normal[node] {
                let mismatch = cross3(reference, normal)
                    .iter()
                    .fold(0.0_f64, |sum, value| sum.hypot(*value));
                if mismatch > 1e-12 {
                    nonparallel_membranes[node] = true;
                }
            } else {
                membrane_normal[node] = Some((index, normal));
            }
        }
    }
    for node in 0..nodes {
        if braced_by_other_element[node] || nonparallel_membranes[node] {
            continue;
        }
        let Some((index, normal)) = membrane_normal[node] else {
            continue;
        };
        if (0..3).all(|axis| prescribed[3 * node + axis].is_none() || normal[axis].abs() <= 1e-12) {
            return Err(format!(
                "mixed3d membrane {index} has an unbraced transverse mode at node {node}"
            ));
        }
    }
    Ok(())
}

/// A shared Hex8 vertex or edge has no bending stiffness across the interface.
/// Whole-face groups need their own six independent translational restraints
/// before zero-load PCG can be trusted. Trusses or membranes may stabilize an
/// interface, so this conservative check applies only to pure Hex8 solids.
fn validate_pure_hex_face_groups(
    request: &Mixed3dRequest,
    prescribed: &[Option<f64>],
) -> Result<(), String> {
    const FACES: [[usize; 4]; 6] = [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
    ];
    let mut parents: Vec<usize> = (0..request.hexes.len()).collect();
    let mut faces: HashMap<[usize; 4], (usize, usize)> = HashMap::new();
    for (element, hex) in request.hexes.iter().enumerate() {
        for (corner, &node) in hex.nodes.iter().enumerate() {
            if node >= request.mesh.nodes.len() {
                return Err(format!(
                    "mixed3d Hex8 {element} corner {corner} refers to missing node {node}"
                ));
            }
            if hex.nodes[..corner].contains(&node) {
                return Err(format!("mixed3d Hex8 {element} repeats node {node}"));
            }
        }
        for corners in FACES {
            let mut face = corners.map(|corner| hex.nodes[corner]);
            face.sort_unstable();
            match faces.get_mut(&face) {
                None => {
                    faces.insert(face, (element, 1));
                }
                Some((first, count)) if *count == 1 => {
                    join_component(&mut parents, *first, element);
                    *count = 2;
                }
                Some(_) => {
                    return Err(format!(
                        "mixed3d nonmanifold Hex8 face {face:?} belongs to more than two elements"
                    ));
                }
            }
        }
    }
    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for (element, hex) in request.hexes.iter().enumerate() {
        let root = component_root(&mut parents, element);
        groups.entry(root).or_default().extend(hex.nodes);
    }
    for (root, nodes) in &mut groups {
        nodes.sort_unstable();
        nodes.dedup();
        let local_nodes = nodes
            .iter()
            .map(|&node| request.mesh.nodes[node])
            .collect::<Vec<_>>();
        let supports = nodes
            .iter()
            .enumerate()
            .flat_map(|(local, &node)| {
                (0..3).filter_map(move |axis| {
                    prescribed[3 * node + axis].map(|value| (3 * local + axis, value))
                })
            })
            .collect::<Vec<_>>();
        if !volume3d::supports_restrain_rigid_modes(&local_nodes, &supports) {
            return Err(format!(
                "mixed3d face-connected Hex8 group {root}: supports do not restrain all six rigid-body modes"
            ));
        }
    }
    Ok(())
}

/// Solve one linear load case with solid and truss contributions in the same
/// global translational displacement vector.
pub fn solve(request: &Mixed3dRequest) -> Result<Mixed3dResult, String> {
    if !request.frames.is_empty() || !request.bending_plates.is_empty() {
        return crate::mixed3d_frame::solve(request);
    }
    if !request.frame_member_loads.is_empty() || !request.frame_member_point_loads.is_empty() {
        return Err("mixed3d frame member load requires an attached frame".into());
    }
    let nodes = request.mesh.nodes.len();
    if (!request.moments_knm.is_empty() && request.moments_knm.len() != nodes)
        || (!request.prescribed_rotations_rad.is_empty()
            && request.prescribed_rotations_rad.len() != nodes)
    {
        return Err("mixed3d moment/rotation count must equal mesh node count".into());
    }
    if request
        .moments_knm
        .iter()
        .flatten()
        .any(|value| !value.is_finite())
        || request
            .prescribed_rotations_rad
            .iter()
            .flatten()
            .flatten()
            .any(|value| !value.is_finite())
    {
        return Err("mixed3d has non-finite moment or rotation".into());
    }
    if request
        .moments_knm
        .iter()
        .flatten()
        .any(|value| *value != 0.0)
        || request
            .prescribed_rotations_rad
            .iter()
            .flatten()
            .any(Option::is_some)
    {
        return Err("mixed3d moments and prescribed rotations require a frame".into());
    }
    if request.backend != Mixed3dBackend::Automatic {
        return solve_backend(request, request.backend);
    }
    let dofs = request
        .mesh
        .nodes
        .len()
        .checked_mul(3)
        .ok_or("mixed3d DOF count overflow")?;
    match solve_backend(request, Mixed3dBackend::MatrixFreePcg) {
        Ok(result) => Ok(result),
        Err(primary)
            if primary.contains("did not converge")
                || primary.contains("mixed3d free residual") =>
        {
            if !automatic_frontal_fallback_fits(request, dofs) {
                return Err(format!(
                    "matrix-free PCG: {primary}; automatic frontal fallback skipped by the front-width or conservative 256 MiB storage guard"
                ));
            }
            solve_backend(request, Mixed3dBackend::FrontalWave).map_err(|fallback| {
                format!("matrix-free PCG: {primary}; frontal fallback: {fallback}")
            })
        }
        Err(error) => Err(error),
    }
}

pub(crate) fn automatic_frontal_fallback_fits(request: &Mixed3dRequest, dofs: usize) -> bool {
    // Preserve the existing small-model fallback. For larger models, account
    // for retained local matrices, worst-case eliminated rows and the active
    // front before attempting a second full assembly. The frontal solver
    // still enforces its actual front limit during elimination.
    if dofs <= 10_000 {
        return true;
    }
    let local_entries = request
        .mesh
        .tets
        .len()
        .checked_mul(12 * 12)
        .and_then(|n| request.hexes.len().checked_mul(24 * 24)?.checked_add(n))
        .and_then(|n| request.trusses.len().checked_mul(6 * 6)?.checked_add(n))
        .and_then(|n| request.frames.len().checked_mul(12 * 12)?.checked_add(n))
        .and_then(|n| request.membranes.len().checked_mul(9 * 9)?.checked_add(n))
        .and_then(|n| {
            request
                .bending_plates
                .len()
                .checked_mul(9 * 9)?
                .checked_add(n)
        });
    let Some(local_entries) = local_entries else {
        return false;
    };
    if local_entries > MAX_STORED_LOCAL_ENTRIES {
        return false;
    }
    let front = request.max_front_dofs;
    if front == 0 {
        return false;
    }
    let estimated_bytes = local_entries
        .checked_mul(16)
        .and_then(|n| dofs.checked_mul(front)?.checked_mul(16)?.checked_add(n))
        .and_then(|n| front.checked_mul(front)?.checked_mul(8)?.checked_add(n));
    estimated_bytes.is_some_and(|n| n <= MAX_AUTOMATIC_FRONTAL_ESTIMATED_BYTES)
}

fn certify_small_mixed_solid_rank(request: &Mixed3dRequest, dofs: usize) -> Result<(), String> {
    if dofs > MAX_MIXED_SOLID_RANK_PROBE_DOFS
        || request.mesh.tets.is_empty()
        || request.hexes.is_empty()
    {
        return Ok(());
    }
    // A Tet4/Hex8 interface may share only one vertex. The global rigid-mode
    // check then sees one connected component even though the solids can
    // rotate relative to each other. For a bounded small mixed model, reuse
    // the direct LDLT pivot checks before allowing a zero-load PCG success.
    // The direct route does not call this probe, so it cannot recurse.
    solve_backend(request, Mixed3dBackend::SparseDirect)
        .map(|_| ())
        .map_err(|error| format!("mixed3d small Tet4/Hex8 rank check: {error}"))
}

fn solve_backend(
    request: &Mixed3dRequest,
    backend: Mixed3dBackend,
) -> Result<Mixed3dResult, String> {
    let nodes = request.mesh.nodes.len();
    if request.loads_kn.len() != nodes || request.prescribed_m.len() != nodes {
        return Err("mixed3d nodal load/support count must equal mesh node count".into());
    }
    let dofs = nodes.checked_mul(3).ok_or("mixed3d DOF count overflow")?;
    if backend == Mixed3dBackend::SparseDirect && dofs > MAX_MIXED3D_SPARSE_DIRECT_DOFS {
        return Err(format!("mixed3d sparseDirect is limited to {MAX_MIXED3D_SPARSE_DIRECT_DOFS} DOFs because sparse LDLT fill may grow sharply"));
    }
    if request.loads_kn.iter().flatten().any(|v| !v.is_finite())
        || request
            .prescribed_m
            .iter()
            .flatten()
            .flatten()
            .any(|v| !v.is_finite())
    {
        return Err("mixed3d has non-finite load or displacement".into());
    }
    let mut loads: Vec<f64> = request.loads_kn.iter().flatten().copied().collect();
    assemble_distributed_loads(request, &mut loads)?;
    let prescribed: Vec<Option<f64>> = request.prescribed_m.iter().flatten().copied().collect();
    if prescribed.iter().all(Option::is_none) {
        return Err("mixed3d requires at least one prescribed DOF".into());
    }
    if request.threads == 0 || request.threads > 32 {
        return Err("mixed3d threads must be between 1 and 32".into());
    }
    if request.max_pcg_iterations == 0 || request.max_pcg_iterations > 1_000_000 {
        return Err("mixed3d maxPcgIterations must be between 1 and 1,000,000".into());
    }

    if request.mesh.tets.is_empty()
        && request.hexes.is_empty()
        && request.trusses.is_empty()
        && request.membranes.is_empty()
    {
        return Err("mixed3d requires at least one Tet4, Hex8, truss or membrane".into());
    }
    if backend == Mixed3dBackend::MatrixFreePcg {
        validate_iterative_supports(request, &prescribed)?;
        certify_small_mixed_solid_rank(request, dofs)?;
        return solve_matrix_free(request, &loads, &prescribed);
    }
    let local_entries = request
        .mesh
        .tets
        .len()
        .checked_mul(12 * 12)
        .and_then(|n| {
            request
                .hexes
                .len()
                .checked_mul(24 * 24)
                .and_then(|h| n.checked_add(h))
        })
        .and_then(|n| {
            request
                .trusses
                .len()
                .checked_mul(6 * 6)
                .and_then(|t| n.checked_add(t))
        })
        .and_then(|n| {
            request
                .membranes
                .len()
                .checked_mul(9 * 9)
                .and_then(|m| n.checked_add(m))
        })
        .ok_or("mixed3d local stiffness storage size overflow")?;
    if local_entries > MAX_STORED_LOCAL_ENTRIES {
        return Err("mixed3d retained local stiffness exceeds 8M entries; use a compact/matrix-free volume route".into());
    }
    if backend == Mixed3dBackend::SparsePcg {
        validate_iterative_supports(request, &prescribed)?;
        certify_small_mixed_solid_rank(request, dofs)?;
    }
    if request.mesh.tets.is_empty()
        && request
            .tet_materials
            .as_ref()
            .is_some_and(|v| !v.is_empty())
    {
        return Err("mixed3d tetMaterials count must equal Tet4 element count".into());
    }
    // The Tet4 operator validates each tetrahedron and its own active-node set.
    // Compact only that set so Hex8-only nodes can coexist in the global model.
    let mut global_to_tet = vec![None; nodes];
    let mut tet_to_global = Vec::new();
    for tet in &request.mesh.tets {
        for &node in tet {
            if node >= nodes {
                return Err("Tet4 node outside mixed3d mesh".into());
            }
            if global_to_tet[node].is_none() {
                global_to_tet[node] = Some(tet_to_global.len());
                tet_to_global.push(node);
            }
        }
    }
    let tet_operator = if request.mesh.tets.is_empty() {
        None
    } else {
        let compact_mesh = volume3d::Mesh {
            nodes: tet_to_global
                .iter()
                .map(|&id| request.mesh.nodes[id])
                .collect(),
            tets: request
                .mesh
                .tets
                .iter()
                .map(|tet| tet.map(|id| global_to_tet[id].unwrap()))
                .collect(),
        };
        let materials = request
            .tet_materials
            .as_deref()
            .unwrap_or(std::slice::from_ref(&request.solid_material));
        if request.tet_materials.is_some() && materials.len() != compact_mesh.tets.len() {
            return Err("mixed3d tetMaterials count must equal Tet4 element count".into());
        }
        let element_materials: Vec<usize> = if request.tet_materials.is_some() {
            (0..compact_mesh.tets.len()).collect()
        } else {
            vec![0; compact_mesh.tets.len()]
        };
        Some(volume3d::Operator::new_with_materials(
            &compact_mesh,
            materials,
            &element_materials,
        )?)
    };
    let mut elements: Vec<frontal::FrontalElement> = tet_operator
        .as_ref()
        .map(|operator| {
            operator
                .stiffness_elements()
                .into_iter()
                .map(|mut element| {
                    for dof in &mut element.dofs {
                        *dof = 3 * tet_to_global[*dof / 3] + *dof % 3;
                    }
                    element
                })
                .collect()
        })
        .unwrap_or_default();
    let mut hex_data = Vec::with_capacity(request.hexes.len());
    for (index, hex) in request.hexes.iter().enumerate() {
        if hex
            .nodes
            .iter()
            .enumerate()
            .any(|(i, node)| hex.nodes[..i].contains(node))
        {
            return Err(format!("Hex8 {index}: repeated node"));
        }
        let coordinates = hex.nodes.map(|id| request.mesh.nodes.get(id).copied());
        let Some(coordinates) = coordinates.into_iter().collect::<Option<Vec<_>>>() else {
            return Err(format!("Hex8 {index}: node outside mesh"));
        };
        let coordinates: [[f64; 3]; 8] = coordinates.try_into().unwrap();
        let element = Hex8Element::new(coordinates, hex.e_mpa, hex.poisson)
            .map_err(|error| format!("Hex8 {index}: {error}"))?;
        let dofs: Vec<usize> = hex
            .nodes
            .iter()
            .flat_map(|&node| (0..3).map(move |a| 3 * node + a))
            .collect();
        let stiffness = element
            .stiffness
            .iter()
            .flat_map(|row| row.iter().copied())
            .collect();
        elements.push(frontal::FrontalElement { dofs, stiffness });
        hex_data.push(element);
    }
    let mut truss_data = Vec::with_capacity(request.trusses.len());
    for (index, truss) in request.trusses.iter().enumerate() {
        let (element, direction, stiffness_scale) = truss_element(&request.mesh, truss, index)?;
        elements.push(element);
        truss_data.push((direction, stiffness_scale));
    }
    let membranes: Vec<MembraneData> = request
        .membranes
        .iter()
        .enumerate()
        .map(|(index, member)| MembraneData::new(&request.mesh, member, index))
        .collect::<Result<_, _>>()?;
    for membrane in &membranes {
        elements.push(membrane.frontal_element()?);
    }

    // Scale the final free residual by the actual reduced right-hand side.
    // Loads and reactions at prescribed DOFs cannot mask a free imbalance.
    let mut reduced_rhs = loads.clone();
    for element in &elements {
        let width = element.dofs.len();
        for (i, &row) in element.dofs.iter().enumerate() {
            if prescribed[row].is_none() {
                for (j, &column) in element.dofs.iter().enumerate() {
                    if let Some(value) = prescribed[column] {
                        reduced_rhs[row] -= element.stiffness[i * width + j] * value;
                    }
                }
            }
        }
    }
    let rhs_scale = reduced_rhs
        .iter()
        .zip(&prescribed)
        .filter(|(_, p)| p.is_none())
        .fold(1.0_f64, |m, (v, _)| m.max(v.abs()));
    if !rhs_scale.is_finite() {
        return Err("mixed3d reduced right-hand side is non-finite".into());
    }

    let (displacements, maximum_front, linear_iterations) = match backend {
        Mixed3dBackend::Dense => {
            if dofs > 600 {
                return Err("mixed3d dense backend is limited to 600 DOFs".into());
            }
            let mut matrix = math::Matrix::zeros(dofs)?;
            for element in &elements {
                let width = element.dofs.len();
                for (i, &row) in element.dofs.iter().enumerate() {
                    for (j, &col) in element.dofs.iter().enumerate() {
                        matrix.add(row, col, element.stiffness[i * width + j]);
                    }
                }
            }
            let u = math::constrained_solve(&matrix, &loads, &prescribed)?.0;
            (u, None, 0)
        }
        Mixed3dBackend::SparseDirect | Mixed3dBackend::SparsePcg => {
            // Bounded two-pass CSR assembly preserves the shared Tet/Hex/truss
            // entries without allocating a dense global matrix or triplets.
            let patterns: Vec<&[usize]> = elements.iter().map(|e| e.dofs.as_slice()).collect();
            let mut assembler =
                csr::CsrPatternAssembler::new(dofs, &patterns, 8_000_000, 4_000_000)?;
            for element in &elements {
                assembler.add_element(&element.dofs, &element.stiffness)?;
            }
            let matrix = assembler.build();
            if backend == Mixed3dBackend::SparseDirect {
                let result = csr_ldlt::solve_constrained_ldlt(
                    &matrix,
                    &loads,
                    &prescribed,
                    MAX_MIXED3D_SPARSE_DIRECT_FACTOR_ENTRIES,
                )?;
                (result.displacements, None, 0)
            } else {
                let result = matrix.solve_constrained(
                    &loads,
                    &prescribed,
                    csr::PcgOptions {
                        relative_tolerance: 1e-10,
                        absolute_tolerance: 0.0,
                        max_iterations: request.max_pcg_iterations,
                    },
                )?;
                (result.displacements, None, result.iterations)
            }
        }
        Mixed3dBackend::FrontalWave => {
            let result = frontal::solve(
                &elements,
                &loads,
                &prescribed,
                frontal::FrontalOptions {
                    max_front_dofs: request.max_front_dofs,
                    ..Default::default()
                },
            )?;
            (result.displacements, Some(result.maximum_front_dofs), 0)
        }
        Mixed3dBackend::MatrixFreePcg => {
            unreachable!("matrix-free backend returns before assembly")
        }
        Mixed3dBackend::Automatic => unreachable!("automatic backend returns before assembly"),
    };
    if displacements.len() != dofs || displacements.iter().any(|v| !v.is_finite()) {
        return Err("mixed3d solve produced invalid displacements".into());
    }

    // Recover global internal forces from each validated element implementation,
    // including both sides of a mixed Tet4/Hex8 interface.
    let mut internal = vec![0.0; dofs];
    let (solid_element_stress_mpa, mut hex_gauss_stress_mpa) = if let Some(operator) = &tet_operator
    {
        let compact_u: Vec<f64> = tet_to_global
            .iter()
            .flat_map(|&node| {
                [
                    displacements[3 * node],
                    displacements[3 * node + 1],
                    displacements[3 * node + 2],
                ]
            })
            .collect();
        let compact_force = operator.apply(&compact_u, 1)?;
        for (local, &global) in tet_to_global.iter().enumerate() {
            for axis in 0..3 {
                internal[3 * global + axis] += compact_force[3 * local + axis];
            }
        }
        (
            operator.element_stress_mpa(&compact_u)?,
            Vec::with_capacity(hex_data.len()),
        )
    } else {
        (Vec::new(), Vec::with_capacity(hex_data.len()))
    };
    for (hex, element) in request.hexes.iter().zip(&hex_data) {
        let mut local_u = [0.0; 24];
        for (i, &node) in hex.nodes.iter().enumerate() {
            for axis in 0..3 {
                local_u[3 * i + axis] = displacements[3 * node + axis];
            }
        }
        let local_force = element.apply(local_u);
        for (i, &node) in hex.nodes.iter().enumerate() {
            for axis in 0..3 {
                internal[3 * node + axis] += local_force[3 * i + axis];
            }
        }
        hex_gauss_stress_mpa.push(volume_hex8::stress_at_gauss(
            element,
            volume_hex8::Hex8VolumeMaterial {
                e_mpa: hex.e_mpa,
                poisson: hex.poisson,
            },
            local_u,
        )?);
    }
    let mut truss_axial_force_kn = Vec::with_capacity(request.trusses.len());
    for (truss, &(direction, stiffness_scale)) in request.trusses.iter().zip(&truss_data) {
        let [a, b] = truss.nodes;
        let extension = (0..3)
            .map(|axis| {
                direction[axis] * (displacements[3 * b + axis] - displacements[3 * a + axis])
            })
            .sum::<f64>();
        let force = stiffness_scale * extension;
        for axis in 0..3 {
            internal[3 * a + axis] -= force * direction[axis];
            internal[3 * b + axis] += force * direction[axis];
        }
        truss_axial_force_kn.push(force);
    }
    for membrane in &membranes {
        membrane.apply_into(&displacements, &mut internal);
    }
    let membrane_stress_mpa: Vec<[f64; 3]> = membranes
        .iter()
        .map(|membrane| membrane.stress_mpa(&displacements))
        .collect();
    let membrane_resultants_kn_per_m = membranes
        .iter()
        .zip(&membrane_stress_mpa)
        .map(|(membrane, &stress)| membrane.resultants_kn_per_m(stress))
        .collect();
    let reactions: Vec<f64> = internal.iter().zip(&loads).map(|(p, f)| p - f).collect();
    let free_residual = reactions
        .iter()
        .zip(&prescribed)
        .filter(|(_, p)| p.is_none())
        .fold(0.0_f64, |m, (r, _)| m.max(r.abs()));
    let relative_residual = free_residual / rhs_scale;
    if !relative_residual.is_finite() || relative_residual > 1e-8 {
        return Err(format!(
            "mixed3d free residual {relative_residual:.3e} exceeds 1e-8"
        ));
    }
    let as_nodes = |values: &[f64]| -> Vec<[f64; 3]> {
        values.chunks_exact(3).map(|v| [v[0], v[1], v[2]]).collect()
    };
    Ok(Mixed3dResult {
        nodal_displacements_m: as_nodes(&displacements),
        nodal_reactions_kn: as_nodes(&reactions),
        solid_element_stress_mpa,
        hex_gauss_stress_mpa,
        truss_axial_force_kn,
        membrane_stress_mpa,
        membrane_resultants_kn_per_m,
        bending_plate_moments_knm_per_m: Vec::new(),
        nodal_rotations_rad: Vec::new(),
        nodal_moment_reactions_knm: Vec::new(),
        frame_end_forces_local: Vec::new(),
        relative_residual,
        backend_used: backend,
        frontal_maximum_front_dofs: maximum_front,
        linear_iterations,
    })
}

/// Compact each element family to its own active nodes, then use the already
/// validated Tet4 and general-geometry Hex8 matrix-free operators in one
/// global Jacobi-PCG solve. No local stiffness matrices or global CSR are held.
fn solve_matrix_free(
    request: &Mixed3dRequest,
    loads: &[f64],
    prescribed: &[Option<f64>],
) -> Result<Mixed3dResult, String> {
    let nodes = request.mesh.nodes.len();
    let dofs = nodes.checked_mul(3).ok_or("mixed3d DOF count overflow")?;
    if dofs > 1_200_000 {
        return Err("mixed3d matrix-free backend exceeds 1.2M global DOFs".into());
    }
    if request.mesh.tets.is_empty()
        && request
            .tet_materials
            .as_ref()
            .is_some_and(|m| !m.is_empty())
    {
        return Err("mixed3d tetMaterials count must equal Tet4 element count".into());
    }
    if request.mesh.nodes.iter().flatten().any(|v| !v.is_finite()) {
        return Err("mixed3d mesh has a non-finite coordinate".into());
    }

    let mut tet_map = vec![None; nodes];
    let mut tet_to_global = Vec::new();
    for tet in &request.mesh.tets {
        for &node in tet {
            if node >= nodes {
                return Err("Tet4 node outside mixed3d mesh".into());
            }
            if tet_map[node].is_none() {
                tet_map[node] = Some(tet_to_global.len());
                tet_to_global.push(node);
            }
        }
    }
    let tet_operator = if request.mesh.tets.is_empty() {
        None
    } else {
        let mesh = volume3d::Mesh {
            nodes: tet_to_global
                .iter()
                .map(|&id| request.mesh.nodes[id])
                .collect(),
            tets: request
                .mesh
                .tets
                .iter()
                .map(|tet| tet.map(|id| tet_map[id].unwrap()))
                .collect(),
        };
        let materials = request
            .tet_materials
            .as_deref()
            .unwrap_or(std::slice::from_ref(&request.solid_material));
        if request.tet_materials.is_some() && materials.len() != mesh.tets.len() {
            return Err("mixed3d tetMaterials count must equal Tet4 element count".into());
        }
        let material_indices: Vec<usize> = if request.tet_materials.is_some() {
            (0..mesh.tets.len()).collect()
        } else {
            vec![0; mesh.tets.len()]
        };
        Some(volume3d::Operator::new_with_materials(
            &mesh,
            materials,
            &material_indices,
        )?)
    };

    let mut hex_map = vec![None; nodes];
    let mut hex_to_global = Vec::new();
    for hex in &request.hexes {
        for &node in &hex.nodes {
            if node >= nodes {
                return Err("Hex8 node outside mixed3d mesh".into());
            }
            if hex_map[node].is_none() {
                hex_map[node] = Some(hex_to_global.len());
                hex_to_global.push(node);
            }
        }
    }
    let hex_operator = if request.hexes.is_empty() {
        None
    } else {
        let hexes: Vec<[usize; 8]> = request
            .hexes
            .iter()
            .map(|hex| hex.nodes.map(|id| hex_map[id].unwrap()))
            .collect();
        let materials: Vec<(f64, f64)> = request
            .hexes
            .iter()
            .map(|hex| (hex.e_mpa, hex.poisson))
            .collect();
        let material_indices: Vec<usize> = (0..hexes.len()).collect();
        Some(hex8_matrix_free::GeneralOperator::new_large(
            hex_to_global
                .iter()
                .map(|&id| request.mesh.nodes[id])
                .collect(),
            hexes,
            &materials,
            &material_indices,
        )?)
    };

    let mut diagonal = vec![0.0; dofs];
    if let Some(operator) = &tet_operator {
        for (local, &global) in tet_to_global.iter().enumerate() {
            for axis in 0..3 {
                diagonal[3 * global + axis] += operator.diagonal()[3 * local + axis];
            }
        }
    }
    if let Some(operator) = &hex_operator {
        for (local, &global) in hex_to_global.iter().enumerate() {
            for axis in 0..3 {
                diagonal[3 * global + axis] += operator.diagonal()[3 * local + axis];
            }
        }
    }
    let mut trusses = Vec::with_capacity(request.trusses.len());
    for (index, truss) in request.trusses.iter().enumerate() {
        let (_, direction, stiffness) = truss_element(&request.mesh, truss, index)?;
        for &node in &truss.nodes {
            for axis in 0..3 {
                diagonal[3 * node + axis] += stiffness * direction[axis] * direction[axis];
            }
        }
        trusses.push((truss.nodes, direction, stiffness));
    }
    let membranes: Vec<MembraneData> = request
        .membranes
        .iter()
        .enumerate()
        .map(|(index, member)| MembraneData::new(&request.mesh, member, index))
        .collect::<Result<_, _>>()?;
    for membrane in &membranes {
        membrane.diagonal_into(&mut diagonal);
    }
    if diagonal.iter().any(|v| !v.is_finite()) {
        return Err("mixed3d matrix-free diagonal is non-finite".into());
    }
    if diagonal
        .iter()
        .zip(prescribed)
        .any(|(&d, p)| p.is_none() && d <= 0.0)
    {
        return Err("mixed3d free DOF has zero matrix-free stiffness".into());
    }

    let apply = |x: &[f64]| -> Result<Vec<f64>, String> {
        let mut global = vec![0.0; dofs];
        if let Some(operator) = &tet_operator {
            let compact: Vec<f64> = tet_to_global
                .iter()
                .flat_map(|&node| [x[3 * node], x[3 * node + 1], x[3 * node + 2]])
                .collect();
            let product = operator.apply(&compact, request.threads)?;
            for (local, &node) in tet_to_global.iter().enumerate() {
                for axis in 0..3 {
                    global[3 * node + axis] += product[3 * local + axis];
                }
            }
        }
        if let Some(operator) = &hex_operator {
            let compact: Vec<f64> = hex_to_global
                .iter()
                .flat_map(|&node| [x[3 * node], x[3 * node + 1], x[3 * node + 2]])
                .collect();
            let product = operator.apply(&compact, request.threads)?;
            for (local, &node) in hex_to_global.iter().enumerate() {
                for axis in 0..3 {
                    global[3 * node + axis] += product[3 * local + axis];
                }
            }
        }
        for &([a, b], direction, stiffness) in &trusses {
            let extension: f64 = (0..3)
                .map(|axis| direction[axis] * (x[3 * b + axis] - x[3 * a + axis]))
                .sum();
            let force = stiffness * extension;
            for axis in 0..3 {
                global[3 * a + axis] -= force * direction[axis];
                global[3 * b + axis] += force * direction[axis];
            }
        }
        for membrane in &membranes {
            membrane.apply_into(x, &mut global);
        }
        if global.iter().any(|v| !v.is_finite()) {
            return Err("mixed3d matrix-free product is non-finite".into());
        }
        Ok(global)
    };
    let fixed: Vec<(usize, f64)> = prescribed
        .iter()
        .enumerate()
        .filter_map(|(index, value)| value.map(|v| (index, v)))
        .collect();
    // solve_backend has already checked every connected mixed component.
    // Repeating the Hex8-only six-mode check would reject a valid restrained
    // collinear truss, whose rotation about its own axis moves no node.
    let solved = hex8_matrix_free::solve_pcg_with_prevalidated_support(
        &diagonal,
        request.mesh.tets.len() + request.hexes.len() + request.trusses.len() + membranes.len(),
        apply,
        loads,
        &fixed,
        request.threads,
        1e-9,
        request.max_pcg_iterations,
    )?;
    let displacements = solved.displacements;
    let mut truss_axial_force_kn = Vec::with_capacity(trusses.len());
    for &([a, b], direction, stiffness) in &trusses {
        let extension: f64 = (0..3)
            .map(|axis| {
                direction[axis] * (displacements[3 * b + axis] - displacements[3 * a + axis])
            })
            .sum();
        truss_axial_force_kn.push(stiffness * extension);
    }
    let solid_element_stress_mpa = if let Some(operator) = &tet_operator {
        let compact: Vec<f64> = tet_to_global
            .iter()
            .flat_map(|&node| {
                [
                    displacements[3 * node],
                    displacements[3 * node + 1],
                    displacements[3 * node + 2],
                ]
            })
            .collect();
        operator.element_stress_mpa(&compact)?
    } else {
        Vec::new()
    };
    let membrane_stress_mpa: Vec<[f64; 3]> = membranes
        .iter()
        .map(|membrane| membrane.stress_mpa(&displacements))
        .collect();
    let membrane_resultants_kn_per_m = membranes
        .iter()
        .zip(&membrane_stress_mpa)
        .map(|(membrane, &stress)| membrane.resultants_kn_per_m(stress))
        .collect();
    let mut hex_gauss_stress_mpa = Vec::with_capacity(request.hexes.len());
    if let Some(operator) = &hex_operator {
        for (index, hex) in request.hexes.iter().enumerate() {
            let element = operator
                .local_for_element(index)
                .ok_or("missing compact Hex8 element")?;
            let mut local_u = [0.0; 24];
            for (i, &node) in hex.nodes.iter().enumerate() {
                for axis in 0..3 {
                    local_u[3 * i + axis] = displacements[3 * node + axis];
                }
            }
            hex_gauss_stress_mpa.push(volume_hex8::stress_at_gauss(
                &element,
                volume_hex8::Hex8VolumeMaterial {
                    e_mpa: hex.e_mpa,
                    poisson: hex.poisson,
                },
                local_u,
            )?);
        }
    }
    let as_nodes = |values: &[f64]| -> Vec<[f64; 3]> {
        values.chunks_exact(3).map(|v| [v[0], v[1], v[2]]).collect()
    };
    Ok(Mixed3dResult {
        nodal_displacements_m: as_nodes(&displacements),
        nodal_reactions_kn: as_nodes(&solved.reactions),
        solid_element_stress_mpa,
        hex_gauss_stress_mpa,
        truss_axial_force_kn,
        membrane_stress_mpa,
        membrane_resultants_kn_per_m,
        bending_plate_moments_knm_per_m: Vec::new(),
        nodal_rotations_rad: Vec::new(),
        nodal_moment_reactions_knm: Vec::new(),
        frame_end_forces_local: Vec::new(),
        relative_residual: solved.relative_residual,
        backend_used: Mixed3dBackend::MatrixFreePcg,
        frontal_maximum_front_dofs: None,
        linear_iterations: solved.iterations,
    })
}
