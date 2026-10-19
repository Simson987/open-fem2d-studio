//! Linear bending-frame and horizontal DKT coupling to the shared Tet4/Hex8/truss system.
//! Rotational DOFs exist only at nodes belonging to a frame or bending plate.

use crate::{
    csr, csr_ldlt, frame3d, frontal, hex8::Hex8Element, hex8_matrix_free, math, mixed3d,
    mixed3d_membrane::MembraneData, plate_bending, volume3d, volume_hex8,
};
use mixed3d::{
    Mixed3dBackend, Mixed3dRequest, Mixed3dResult, MAX_MIXED3D_SPARSE_DIRECT_DOFS,
    MAX_MIXED3D_SPARSE_DIRECT_FACTOR_ENTRIES, MAX_STORED_LOCAL_ENTRIES,
};
use std::collections::{HashMap, HashSet};

// The geometric support checks below certify rigid modes of whole components,
// frame clusters and plate clusters, but not every relative solid hinge. Keep
// an exact sparse LDLT preflight bounded so a zero right-hand side cannot let
// PCG accept a singular small mixed model without affecting large-model memory.
const MAX_SMALL_COUPLED_RANK_PREFLIGHT_DOFS: usize = 128;

struct FrameData {
    dofs: [usize; 12],
    global_stiffness: [[f64; 12]; 12],
    local_stiffness: [[f64; 12]; 12],
    rotation: [[f64; 3]; 3],
}

// Retaining only the nine active DOFs and the DKT's 9x9 matrix keeps the
// iterative route independent of a global sparse assembly.
struct PlateData {
    dofs: [usize; 9],
    stiffness: [f64; 81],
}

fn bending_plate_element(
    request: &Mixed3dRequest,
    index: usize,
    rotation_base: &[Option<usize>],
) -> Result<PlateData, String> {
    let plate = &request.bending_plates[index];
    let [a, b, c] = plate.nodes;
    if a == b || b == c || c == a {
        return Err(format!("bending plate {index}: repeated node"));
    }
    let coordinates = plate
        .nodes
        .map(|node| request.mesh.nodes.get(node).copied());
    let [Some(p), Some(q), Some(r)] = coordinates else {
        return Err(format!("bending plate {index}: node outside mesh"));
    };
    if [p, q, r].iter().flatten().any(|value| !value.is_finite()) {
        return Err(format!("bending plate {index}: non-finite coordinate"));
    }
    let span = [q[0] - p[0], q[1] - p[1], r[0] - p[0], r[1] - p[1]]
        .iter()
        .fold(1.0_f64, |scale, value| scale.max(value.abs()));
    if (q[2] - p[2]).abs() > 1e-10 * span || (r[2] - p[2]).abs() > 1e-10 * span {
        return Err(format!(
            "bending plate {index}: only horizontal XY triangles are supported"
        ));
    }
    let twice_area = (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]);
    if !twice_area.is_finite() || twice_area.abs() <= 1e-12 * span * span {
        return Err(format!("bending plate {index}: degenerate XY triangle"));
    }
    if !plate.e_mpa.is_finite()
        || plate.e_mpa <= 0.0
        || !plate.nu.is_finite()
        || plate.nu <= -1.0
        || plate.nu >= 0.5
        || !plate.thickness_m.is_finite()
        || plate.thickness_m <= 0.0
    {
        return Err(format!("bending plate {index}: invalid E, nu or thickness"));
    }
    let nodes = [p, q, r].map(|point| plate_bending::Node {
        id: 0,
        x: point[0],
        y: point[1],
    });
    let material = plate_bending::Material {
        id: 0,
        e_mpa: plate.e_mpa,
        nu: plate.nu,
    };
    let local = plate_bending::element_stiffness(
        [&nodes[0], &nodes[1], &nodes[2]],
        &material,
        plate.thickness_m,
    )
    .map_err(|error| format!("bending plate {index}: {error}"))?;
    // DKT rotations are [-rx, -ry] for the physical global rotation vector.
    let signs = [1.0, -1.0, -1.0];
    let mut dofs = [0; 9];
    for (vertex, &node) in plate.nodes.iter().enumerate() {
        let base = rotation_base[node].ok_or("bending plate rotation DOF missing")?;
        dofs[3 * vertex..3 * vertex + 3].copy_from_slice(&[3 * node + 2, base, base + 1]);
    }
    let stiffness = std::array::from_fn(|entry| {
        let (i, j) = (entry / 9, entry % 9);
        signs[i % 3] * local[i][j] * signs[j % 3]
    });
    if stiffness.iter().any(|value| !value.is_finite()) {
        return Err(format!("bending plate {index}: stiffness overflow"));
    }
    Ok(PlateData { dofs, stiffness })
}

/// Recover one XY centroid moment vector per requested DKT triangle, using
/// the standalone DKT constitutive/interpolation kernel. Physical global
/// rotations [Rx, Ry] enter the DKT kernel as [-Rx, -Ry].
fn recover_bending_plate_moments(
    request: &Mixed3dRequest,
    rotation_base: &[Option<usize>],
    u: &[f64],
) -> Result<Vec<[f64; 3]>, String> {
    request
        .bending_plates
        .iter()
        .enumerate()
        .map(|(index, plate)| {
            let [a, b, c] = plate.nodes;
            let [Some(p), Some(q), Some(r)] = plate
                .nodes
                .map(|node| request.mesh.nodes.get(node).copied())
            else {
                return Err(format!("bending plate {index}: node outside mesh"));
            };
            let points = [p, q, r].map(|point| plate_bending::Node {
                id: 0,
                x: point[0],
                y: point[1],
            });
            let material = plate_bending::Material {
                id: 0,
                e_mpa: plate.e_mpa,
                nu: plate.nu,
            };
            let nodes = [a, b, c];
            let mut local_u = [0.0; 9];
            for (corner, node) in nodes.into_iter().enumerate() {
                let base = rotation_base[node]
                    .ok_or_else(|| format!("bending plate {index}: rotation DOF missing"))?;
                local_u[3 * corner] = u[3 * node + 2];
                local_u[3 * corner + 1] = -u[base];
                local_u[3 * corner + 2] = -u[base + 1];
            }
            plate_bending::element_centroid_moment(
                [&points[0], &points[1], &points[2]],
                &material,
                plate.thickness_m,
                None,
                1.0,
                local_u,
            )
            .map_err(|error| format!("bending plate {index}: {error}"))
        })
        .collect()
}

fn local_frame_forces(frame: &FrameData, u: &[f64], equivalent: &[f64; 12]) -> [[f64; 6]; 2] {
    let mut local_u = [0.0; 12];
    for end in 0..2 {
        for block in 0..2 {
            for axis in 0..3 {
                local_u[6 * end + 3 * block + axis] = (0..3)
                    .map(|global| {
                        frame.rotation[axis][global] * u[frame.dofs[6 * end + 3 * block + global]]
                    })
                    .sum();
            }
        }
    }
    let forces = std::array::from_fn::<_, 12, _>(|i| {
        (0..12)
            .map(|j| frame.local_stiffness[i][j] * local_u[j])
            .sum::<f64>()
            - equivalent[i]
    });
    std::array::from_fn(|end| std::array::from_fn(|i| forces[6 * end + i]))
}

/// Assemble physical frame loads into the same global force vector used by
/// every backend. Keep the local equivalent vectors for end-force recovery.
fn assemble_frame_member_loads(
    request: &Mixed3dRequest,
    frames: &[FrameData],
    loads: &mut [f64],
) -> Result<Vec<[f64; 12]>, String> {
    let mut equivalent = vec![[0.0; 12]; frames.len()];
    for (index, load) in request.frame_member_loads.iter().enumerate() {
        if frames.get(load.element).is_none() {
            return Err(format!(
                "mixed3d frame member load {index}: frame element outside model"
            ));
        }
        let [a, b] = request.frames[load.element].nodes;
        let start = request.mesh.nodes[a];
        let end = request.mesh.nodes[b];
        let length = (0..3).fold(0.0_f64, |norm, axis| norm.hypot(end[axis] - start[axis]));
        let values = [
            load.qy_start_kn_per_m,
            load.qy_end_kn_per_m,
            load.qz_start_kn_per_m,
            load.qz_end_kn_per_m,
            load.start_position_m,
            load.end_position_m,
        ];
        if !values.iter().all(|value| value.is_finite())
            || !length.is_finite()
            || length <= 0.0
            || load.start_position_m < 0.0
            || load.end_position_m <= load.start_position_m
            || load.end_position_m > length + 1e-9
        {
            return Err(format!(
                "mixed3d frame member load {index}: invalid intensity or span"
            ));
        }
        let a = load.start_position_m;
        let b = load.end_position_m.min(length);
        if b <= a {
            return Err(format!("mixed3d frame member load {index}: invalid span"));
        }
        let abscissae = [-(3.0_f64 / 5.0).sqrt(), 0.0, (3.0_f64 / 5.0).sqrt()];
        let weights = [5.0 / 9.0, 8.0 / 9.0, 5.0 / 9.0];
        for (abscissa, weight) in abscissae.into_iter().zip(weights) {
            let x = (a + b) / 2.0 + (b - a) * abscissa / 2.0;
            let fraction = (x - a) / (b - a);
            let scale = weight * (b - a) / 2.0;
            let py = ((1.0 - fraction) * load.qy_start_kn_per_m + fraction * load.qy_end_kn_per_m)
                * scale;
            let pz = ((1.0 - fraction) * load.qz_start_kn_per_m + fraction * load.qz_end_kn_per_m)
                * scale;
            frame3d::add_transverse_load(&mut equivalent[load.element], length, x, py, pz);
        }
    }
    for (index, load) in request.frame_member_point_loads.iter().enumerate() {
        if frames.get(load.element).is_none() {
            return Err(format!(
                "mixed3d frame member point load {index}: frame element outside model"
            ));
        }
        let [a, b] = request.frames[load.element].nodes;
        let start = request.mesh.nodes[a];
        let end = request.mesh.nodes[b];
        let length = (0..3).fold(0.0_f64, |norm, axis| norm.hypot(end[axis] - start[axis]));
        if ![load.py_kn, load.pz_kn, load.position_m]
            .iter()
            .all(|value| value.is_finite())
            || !length.is_finite()
            || length <= 0.0
            || load.position_m < 0.0
            || load.position_m > length + 1e-9
        {
            return Err(format!(
                "mixed3d frame member point load {index}: invalid force or position"
            ));
        }
        frame3d::add_transverse_load(
            &mut equivalent[load.element],
            length,
            load.position_m.min(length),
            load.py_kn,
            load.pz_kn,
        );
    }
    for (index, frame) in frames.iter().enumerate() {
        let local = &equivalent[index];
        if local.iter().any(|value| !value.is_finite()) {
            return Err(format!(
                "mixed3d frame {index}: equivalent member load overflow"
            ));
        }
        for end in 0..2 {
            for block in 0..2 {
                for global in 0..3 {
                    let force = (0..3)
                        .map(|axis| {
                            frame.rotation[axis][global] * local[6 * end + 3 * block + axis]
                        })
                        .sum::<f64>();
                    let dof = frame.dofs[6 * end + 3 * block + global];
                    loads[dof] += force;
                    if !loads[dof].is_finite() {
                        return Err(format!(
                            "mixed3d frame {index}: accumulated member load overflow"
                        ));
                    }
                }
            }
        }
    }
    Ok(equivalent)
}

pub(crate) fn solve(request: &Mixed3dRequest) -> Result<Mixed3dResult, String> {
    if request.backend == Mixed3dBackend::MatrixFreePcg {
        return solve_matrix_free(request);
    }
    if request.backend != Mixed3dBackend::Automatic {
        return solve_backend(request, request.backend);
    }
    let rotational_nodes: HashSet<usize> = request
        .frames
        .iter()
        .flat_map(|frame| frame.nodes)
        .collect();
    let plate_only_nodes: HashSet<usize> = request
        .bending_plates
        .iter()
        .flat_map(|plate| plate.nodes)
        .filter(|node| !rotational_nodes.contains(node))
        .collect();
    let dofs = request
        .mesh
        .nodes
        .len()
        .saturating_mul(3)
        .saturating_add(rotational_nodes.len().saturating_mul(3))
        .saturating_add(plate_only_nodes.len().saturating_mul(2));
    match solve_matrix_free(request) {
        Ok(result) => Ok(result),
        Err(primary)
            if primary.contains("did not converge") || primary.contains("free residual") =>
        {
            if !mixed3d::automatic_frontal_fallback_fits(request, dofs) {
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

struct Prepared {
    translation_dofs: usize,
    rotation_base: Vec<Option<usize>>,
    plate_only_rotation: Vec<bool>,
    dofs: usize,
    loads: Vec<f64>,
    prescribed: Vec<Option<f64>>,
}

fn prepare(request: &Mixed3dRequest) -> Result<Prepared, String> {
    let nodes = request.mesh.nodes.len();
    if nodes == 0 || request.loads_kn.len() != nodes || request.prescribed_m.len() != nodes {
        return Err("mixed3d nodal load/support count must equal nonempty mesh node count".into());
    }
    if !request.moments_knm.is_empty() && request.moments_knm.len() != nodes {
        return Err("mixed3d moment count must equal mesh node count".into());
    }
    if !request.prescribed_rotations_rad.is_empty()
        && request.prescribed_rotations_rad.len() != nodes
    {
        return Err("mixed3d rotation support count must equal mesh node count".into());
    }
    if request.threads == 0 || request.threads > 32 {
        return Err("mixed3d threads must be between 1 and 32".into());
    }
    if request.max_pcg_iterations == 0 || request.max_pcg_iterations > 1_000_000 {
        return Err("mixed3d maxPcgIterations must be between 1 and 1,000,000".into());
    }
    if request.mesh.nodes.iter().flatten().any(|v| !v.is_finite())
        || request.loads_kn.iter().flatten().any(|v| !v.is_finite())
        || request
            .prescribed_m
            .iter()
            .flatten()
            .flatten()
            .any(|v| !v.is_finite())
        || request.moments_knm.iter().flatten().any(|v| !v.is_finite())
        || request
            .prescribed_rotations_rad
            .iter()
            .flatten()
            .flatten()
            .any(|v| !v.is_finite())
    {
        return Err("mixed3d frame model contains a non-finite coordinate, load or support".into());
    }

    let translation_dofs = nodes.checked_mul(3).ok_or("mixed3d DOF count overflow")?;
    let mut rotation_base = vec![None; nodes];
    let mut rotational_nodes = 0usize;
    for (index, frame) in request.frames.iter().enumerate() {
        let [a, b] = frame.nodes;
        if a == b || a >= nodes || b >= nodes {
            return Err(format!("frame {index}: repeated or invalid node"));
        }
        for node in [a, b] {
            if rotation_base[node].is_none() {
                let offset = rotational_nodes
                    .checked_mul(3)
                    .and_then(|count| translation_dofs.checked_add(count))
                    .ok_or("mixed3d frame DOF count overflow")?;
                rotation_base[node] = Some(offset);
                rotational_nodes += 1;
            }
        }
    }
    let frame_rotation_dofs = rotational_nodes
        .checked_mul(3)
        .ok_or("mixed3d frame DOF count overflow")?;
    let mut plate_only_rotation = vec![false; nodes];
    let mut plate_only_nodes = 0usize;
    for (index, plate) in request.bending_plates.iter().enumerate() {
        for &node in &plate.nodes {
            if node >= nodes {
                return Err(format!("bending plate {index}: node outside mesh"));
            }
            if rotation_base[node].is_none() {
                let offset = plate_only_nodes
                    .checked_mul(2)
                    .and_then(|count| {
                        translation_dofs
                            .checked_add(frame_rotation_dofs)?
                            .checked_add(count)
                    })
                    .ok_or("mixed3d bending plate DOF count overflow")?;
                rotation_base[node] = Some(offset);
                plate_only_rotation[node] = true;
                plate_only_nodes += 1;
            }
        }
    }
    let dofs = translation_dofs
        .checked_add(frame_rotation_dofs)
        .and_then(|count| count.checked_add(plate_only_nodes.checked_mul(2)?))
        .ok_or("mixed3d bending plate DOF count overflow")?;
    let mut loads: Vec<f64> = request.loads_kn.iter().flatten().copied().collect();
    mixed3d::assemble_distributed_loads(request, &mut loads)?;
    loads.resize(dofs, 0.0);
    let mut prescribed: Vec<Option<f64>> = request.prescribed_m.iter().flatten().copied().collect();
    prescribed.resize(dofs, None);
    for node in 0..nodes {
        let moments = request.moments_knm.get(node).copied().unwrap_or([0.0; 3]);
        let rotations = request
            .prescribed_rotations_rad
            .get(node)
            .copied()
            .unwrap_or([None; 3]);
        if let Some(base) = rotation_base[node] {
            if plate_only_rotation[node] && (moments[2] != 0.0 || rotations[2].is_some()) {
                return Err(format!(
                    "mixed3d node {node}: drilling rz moment/rotation requires an attached frame"
                ));
            }
            for axis in 0..if plate_only_rotation[node] { 2 } else { 3 } {
                loads[base + axis] = moments[axis];
                prescribed[base + axis] = rotations[axis];
            }
        } else if moments.iter().any(|value| *value != 0.0) || rotations.iter().any(Option::is_some)
        {
            return Err(format!(
                "mixed3d node {node}: moment/rotation requires an attached frame or bending plate"
            ));
        }
    }
    // A DKT-only node has uz/rx/ry, but the shared result protocol always
    // carries three translations. Eliminate its absent in-plane DOFs exactly.
    let mut in_plane_carried = vec![false; nodes];
    for tet in &request.mesh.tets {
        for &node in tet {
            if node < nodes {
                in_plane_carried[node] = true;
            }
        }
    }
    for hex in &request.hexes {
        for &node in &hex.nodes {
            if node < nodes {
                in_plane_carried[node] = true;
            }
        }
    }
    for truss in &request.trusses {
        for &node in &truss.nodes {
            if node < nodes {
                in_plane_carried[node] = true;
            }
        }
    }
    for membrane in &request.membranes {
        for &node in &membrane.nodes {
            if node < nodes {
                in_plane_carried[node] = true;
            }
        }
    }
    for frame in &request.frames {
        for &node in &frame.nodes {
            in_plane_carried[node] = true;
        }
    }
    for node in 0..nodes {
        if !plate_only_rotation[node] || in_plane_carried[node] {
            continue;
        }
        for axis in 0..2 {
            let dof = 3 * node + axis;
            if loads[dof] != 0.0 || prescribed[dof].is_some_and(|value| value != 0.0) {
                return Err(format!("mixed3d node {node}: in-plane load/displacement requires a membrane, solid, truss or frame"));
            }
            prescribed[dof] = Some(0.0);
        }
    }
    if prescribed.iter().all(Option::is_none) {
        return Err("mixed3d requires at least one prescribed DOF".into());
    }

    Ok(Prepared {
        translation_dofs,
        rotation_base,
        plate_only_rotation,
        dofs,
        loads,
        prescribed,
    })
}

fn component_root(parents: &mut [usize], node: usize) -> usize {
    let mut current = node;
    while parents[current] != current {
        current = parents[current];
    }
    let root = current;
    let mut current = node;
    while parents[current] != root {
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

fn has_six_independent_modes(rows: &[[f64; 6]]) -> bool {
    if rows.len() < 6 {
        return false;
    }
    let mut gram = [[0.0; 6]; 6];
    for row in rows {
        for i in 0..6 {
            for j in 0..6 {
                gram[i][j] += row[i] * row[j];
            }
        }
    }
    let scale = (0..6).map(|i| gram[i][i]).fold(0.0_f64, f64::max);
    if !scale.is_finite() || scale == 0.0 {
        return false;
    }
    for col in 0..6 {
        let pivot = (col..6)
            .max_by(|a, b| gram[*a][col].abs().total_cmp(&gram[*b][col].abs()))
            .unwrap();
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

fn has_three_independent_modes(rows: &[[f64; 3]]) -> bool {
    if rows.len() < 3 {
        return false;
    }
    let mut gram = [[0.0; 3]; 3];
    for row in rows {
        for i in 0..3 {
            for j in 0..3 {
                gram[i][j] += row[i] * row[j];
            }
        }
    }
    let scale = (0..3).map(|i| gram[i][i]).fold(0.0_f64, f64::max);
    if !scale.is_finite() || scale == 0.0 {
        return false;
    }
    for col in 0..3 {
        let pivot = (col..3)
            .max_by(|a, b| gram[*a][col].abs().total_cmp(&gram[*b][col].abs()))
            .unwrap();
        if gram[pivot][col].abs() <= 1e-12 * scale {
            return false;
        }
        gram.swap(col, pivot);
        let diagonal = gram[col][col];
        for row in col + 1..3 {
            let factor = gram[row][col] / diagonal;
            for j in col..3 {
                gram[row][j] -= factor * gram[col][j];
            }
        }
    }
    true
}

/// Necessary DKT rigid-mode check. A plate has the three affine modes
/// w=a+b*x+c*y; one solid-shared transverse displacement alone cannot stop
/// its two tipping modes. A solid attachment is counted only when that
/// solid-only component is independently supported. Frame attachments without
/// explicit restraints at their shared node remain conservatively uncertified.
fn validate_plate_cluster_modes(
    request: &Mixed3dRequest,
    rotation_base: &[Option<usize>],
    prescribed: &[Option<f64>],
) -> Result<(), String> {
    if request.bending_plates.is_empty() {
        return Ok(());
    }
    let nodes = request.mesh.nodes.len();
    let mut solid_parents: Vec<usize> = (0..nodes).collect();
    let mut solid_used = vec![false; nodes];
    for tet in &request.mesh.tets {
        for &node in tet {
            solid_used[node] = true;
            join_component(&mut solid_parents, tet[0], node);
        }
    }
    for hex in &request.hexes {
        for &node in &hex.nodes {
            solid_used[node] = true;
            join_component(&mut solid_parents, hex.nodes[0], node);
        }
    }
    let mut solid_components: HashMap<usize, Vec<usize>> = HashMap::new();
    for node in 0..nodes {
        if solid_used[node] {
            let root = component_root(&mut solid_parents, node);
            solid_components.entry(root).or_default().push(node);
        }
    }
    let mut solid_anchored = vec![false; nodes];
    for component in solid_components.into_values() {
        let origin = request.mesh.nodes[component[0]];
        let span = component
            .iter()
            .flat_map(|&node| {
                request.mesh.nodes[node]
                    .iter()
                    .enumerate()
                    .map(move |(axis, value)| (value - origin[axis]).abs())
            })
            .fold(1.0_f64, f64::max);
        let mut rows = Vec::new();
        for &node in &component {
            let [x, y, z] =
                std::array::from_fn(|axis| (request.mesh.nodes[node][axis] - origin[axis]) / span);
            for axis in 0..3 {
                if prescribed[3 * node + axis].is_some() {
                    rows.push(match axis {
                        0 => [1.0, 0.0, 0.0, 0.0, z, -y],
                        1 => [0.0, 1.0, 0.0, -z, 0.0, x],
                        _ => [0.0, 0.0, 1.0, y, -x, 0.0],
                    });
                }
            }
        }
        if has_six_independent_modes(&rows) {
            for node in component {
                solid_anchored[node] = true;
            }
        }
    }

    let mut parents: Vec<usize> = (0..nodes).collect();
    let mut plate_used = vec![false; nodes];
    for plate in &request.bending_plates {
        for &node in &plate.nodes {
            plate_used[node] = true;
            join_component(&mut parents, plate.nodes[0], node);
        }
    }
    let mut clusters: HashMap<usize, Vec<usize>> = HashMap::new();
    for node in 0..nodes {
        if plate_used[node] {
            let root = component_root(&mut parents, node);
            clusters.entry(root).or_default().push(node);
        }
    }
    for (root, cluster) in clusters {
        let origin = request.mesh.nodes[cluster[0]];
        let span = cluster
            .iter()
            .flat_map(|&node| {
                request.mesh.nodes[node][..2]
                    .iter()
                    .enumerate()
                    .map(move |(axis, value)| (value - origin[axis]).abs())
            })
            .fold(1.0_f64, f64::max);
        let mut rows = Vec::new();
        for node in cluster {
            let x = (request.mesh.nodes[node][0] - origin[0]) / span;
            let y = (request.mesh.nodes[node][1] - origin[1]) / span;
            // Artificially eliminated in-plane plate-only DOFs do not enter
            // this check. DKT has only w, rx and ry at such a node.
            if prescribed[3 * node + 2].is_some() || solid_anchored[node] {
                rows.push([1.0, x, y]);
            }
            if let Some(base) = rotation_base[node] {
                if prescribed[base].is_some() {
                    rows.push([0.0, 0.0, 1.0]);
                }
                if prescribed[base + 1].is_some() {
                    rows.push([0.0, -1.0, 0.0]);
                }
            }
        }
        if !has_three_independent_modes(&rows) {
            return Err(format!(
                "mixed3d bending plate cluster {root}: supports/solid attachment leave a rigid bending mode or an uncertified frame attachment"
            ));
        }
    }
    Ok(())
}

/// Necessary rigid-mode check for every connected solid/truss/frame component.
/// Rotational restraints contribute directly to the three angular rigid modes.
/// Local hinges within a connected component still need separate rank checks.
fn validate_matrix_free_supports(
    request: &Mixed3dRequest,
    rotation_base: &[Option<usize>],
    plate_only_rotation: &[bool],
    prescribed: &[Option<f64>],
) -> Result<(), String> {
    let nodes = request.mesh.nodes.len();
    let mut parents: Vec<usize> = (0..nodes).collect();
    let mut used = vec![false; nodes];
    let mut non_plate_used = vec![false; nodes];
    for tet in &request.mesh.tets {
        for &node in tet {
            if node >= nodes {
                return Err("mixed3d Tet4 node outside mesh".into());
            }
            used[node] = true;
            non_plate_used[node] = true;
            join_component(&mut parents, tet[0], node);
        }
    }
    for hex in &request.hexes {
        for &node in &hex.nodes {
            if node >= nodes {
                return Err("mixed3d Hex8 node outside mesh".into());
            }
            used[node] = true;
            non_plate_used[node] = true;
            join_component(&mut parents, hex.nodes[0], node);
        }
    }
    for truss in &request.trusses {
        for &node in &truss.nodes {
            if node >= nodes {
                return Err("mixed3d truss node outside mesh".into());
            }
            used[node] = true;
            non_plate_used[node] = true;
            join_component(&mut parents, truss.nodes[0], node);
        }
    }
    for membrane in &request.membranes {
        for &node in &membrane.nodes {
            if node >= nodes {
                return Err("mixed3d membrane node outside mesh".into());
            }
            used[node] = true;
            non_plate_used[node] = true;
            join_component(&mut parents, membrane.nodes[0], node);
        }
    }
    for frame in &request.frames {
        let [a, b] = frame.nodes;
        used[a] = true;
        used[b] = true;
        non_plate_used[a] = true;
        non_plate_used[b] = true;
        join_component(&mut parents, a, b);
    }
    for plate in &request.bending_plates {
        for &node in &plate.nodes {
            used[node] = true;
            join_component(&mut parents, plate.nodes[0], node);
        }
    }
    if let Some(node) = used.iter().position(|&value| !value) {
        return Err(format!("mixed3d node {node} is unused by every element"));
    }
    let mut components: HashMap<usize, Vec<usize>> = HashMap::new();
    for node in 0..nodes {
        let root = component_root(&mut parents, node);
        components.entry(root).or_default().push(node);
    }
    for (root, component) in components {
        if component.iter().all(|&node| !non_plate_used[node]) {
            continue; // The plate's three bending modes are checked below.
        }
        let origin = request.mesh.nodes[component[0]];
        let length_scale = component
            .iter()
            .flat_map(|&node| {
                request.mesh.nodes[node]
                    .iter()
                    .enumerate()
                    .map(move |(axis, v)| (v - origin[axis]).abs())
            })
            .fold(1.0_f64, f64::max);
        let mut rows = Vec::new();
        for node in component {
            let [x, y, z] = std::array::from_fn(|axis| {
                (request.mesh.nodes[node][axis] - origin[axis]) / length_scale
            });
            for axis in 0..3 {
                if (axis == 2 || non_plate_used[node]) && prescribed[3 * node + axis].is_some() {
                    rows.push(match axis {
                        0 => [1.0, 0.0, 0.0, 0.0, z, -y],
                        1 => [0.0, 1.0, 0.0, -z, 0.0, x],
                        _ => [0.0, 0.0, 1.0, y, -x, 0.0],
                    });
                }
                if let Some(base) = rotation_base[node] {
                    if (axis < 2 || !plate_only_rotation[node]) && prescribed[base + axis].is_some()
                    {
                        let mut row = [0.0; 6];
                        row[3 + axis] = 1.0;
                        rows.push(row);
                    }
                }
            }
        }
        if !has_six_independent_modes(&rows) {
            return Err(format!(
                "mixed3d component {root}: supports do not restrain all six rigid-body modes"
            ));
        }
    }
    validate_frame_attachment_modes(request, rotation_base, prescribed)?;
    validate_plate_cluster_modes(request, rotation_base, prescribed)?;
    mixed3d::validate_membrane_node_normal_modes(request, prescribed)?;
    Ok(())
}

/// A frame cluster can rotate about a point shared with a solid even when the
/// combined solid/frame component has all six *global* rigid modes restrained.
/// Solid-shared translations and trusses to solid nodes act as anchors for
/// the frame cluster's relative rigid modes. More complex truss-only networks
/// are rejected until their relative rank can be certified.
fn validate_frame_attachment_modes(
    request: &Mixed3dRequest,
    rotation_base: &[Option<usize>],
    prescribed: &[Option<f64>],
) -> Result<(), String> {
    let nodes = request.mesh.nodes.len();
    let mut parents: Vec<usize> = (0..nodes).collect();
    let mut frame_used = vec![false; nodes];
    let mut solid_used = vec![false; nodes];
    for tet in &request.mesh.tets {
        for &node in tet {
            solid_used[node] = true;
        }
    }
    for hex in &request.hexes {
        for &node in &hex.nodes {
            solid_used[node] = true;
        }
    }
    for frame in &request.frames {
        let [a, b] = frame.nodes;
        frame_used[a] = true;
        frame_used[b] = true;
        join_component(&mut parents, a, b);
    }
    let mut clusters: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut frame_root = vec![None; nodes];
    for node in 0..nodes {
        if frame_used[node] {
            let root = component_root(&mut parents, node);
            frame_root[node] = Some(root);
            clusters.entry(root).or_default().push(node);
        }
    }
    let mut uncertain_truss_clusters = HashSet::new();
    let mut solid_anchor_trusses: HashMap<usize, Vec<(usize, usize)>> = HashMap::new();
    for truss in &request.trusses {
        let [a, b] = truss.nodes;
        if frame_root[a] != frame_root[b] {
            for (frame_node, outside_node) in [(a, b), (b, a)] {
                if let Some(root) = frame_root[frame_node] {
                    if solid_used[outside_node]
                        || (0..3).all(|axis| prescribed[3 * outside_node + axis].is_some())
                    {
                        solid_anchor_trusses
                            .entry(root)
                            .or_default()
                            .push((frame_node, outside_node));
                    } else {
                        uncertain_truss_clusters.insert(root);
                    }
                }
            }
        }
    }
    for (root, cluster) in clusters {
        if uncertain_truss_clusters.contains(&root) {
            return Err(format!(
                "mixed3d frame cluster {root}: truss-only attachment needs a rank check"
            ));
        }
        let origin = request.mesh.nodes[cluster[0]];
        let length_scale = cluster
            .iter()
            .flat_map(|&node| {
                request.mesh.nodes[node]
                    .iter()
                    .enumerate()
                    .map(move |(axis, value)| (value - origin[axis]).abs())
            })
            .fold(1.0_f64, f64::max);
        let mut rows = Vec::new();
        for node in cluster {
            let [x, y, z] = std::array::from_fn(|axis| {
                (request.mesh.nodes[node][axis] - origin[axis]) / length_scale
            });
            for axis in 0..3 {
                if solid_used[node] || prescribed[3 * node + axis].is_some() {
                    rows.push(match axis {
                        0 => [1.0, 0.0, 0.0, 0.0, z, -y],
                        1 => [0.0, 1.0, 0.0, -z, 0.0, x],
                        _ => [0.0, 0.0, 1.0, y, -x, 0.0],
                    });
                }
                if let Some(base) = rotation_base[node] {
                    if prescribed[base + axis].is_some() {
                        let mut row = [0.0; 6];
                        row[3 + axis] = 1.0;
                        rows.push(row);
                    }
                }
            }
        }
        if let Some(anchors) = solid_anchor_trusses.get(&root) {
            for &(frame_node, outside_node) in anchors {
                let direction: [f64; 3] = std::array::from_fn(|axis| {
                    request.mesh.nodes[outside_node][axis] - request.mesh.nodes[frame_node][axis]
                });
                let length = direction.iter().fold(0.0_f64, |m, value| m.hypot(*value));
                if !length.is_finite() || length == 0.0 {
                    return Err("mixed3d external truss has degenerate length".into());
                }
                let [nx, ny, nz] = direction.map(|value| value / length);
                let [x, y, z] = std::array::from_fn(|axis| {
                    (request.mesh.nodes[frame_node][axis] - origin[axis]) / length_scale
                });
                rows.push([
                    nx,
                    ny,
                    nz,
                    nz * y - ny * z,
                    nx * z - nz * x,
                    ny * x - nx * y,
                ]);
            }
        }
        if !has_six_independent_modes(&rows) {
            return Err(format!(
                "mixed3d frame cluster {root}: attachment leaves a rigid rotation or translation mechanism"
            ));
        }
    }
    Ok(())
}

/// A necessary, linear-storage check for a rigid mode of one solid group
/// relative to the rest of the model. Solids are welded across paired manifold
/// faces (including a Tet4 triangle on a Hex8 face). Every other shared node
/// and every truss, membrane, frame or DKT contact is optimistically clamped
/// in all three translations. If a group's six rigid modes are still not
/// restrained, moving that group while all other DOFs remain zero is an exact
/// global zero-energy mechanism. A full-rank result does not certify stability.
fn validate_solid_group_modes(
    request: &Mixed3dRequest,
    prescribed: &[Option<f64>],
) -> Result<(), String> {
    const HEX_FACES: [[usize; 4]; 6] = [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
    ];
    let tets = request.mesh.tets.len();
    let solids = tets
        .checked_add(request.hexes.len())
        .ok_or("mixed3d solid group count overflow")?;
    if solids == 0 {
        return Ok(());
    }
    let mut parents: Vec<usize> = (0..solids).collect();
    let mut tet_faces: HashMap<[usize; 3], usize> = HashMap::new();
    for (element, tet) in request.mesh.tets.iter().enumerate() {
        for omitted in 0..4 {
            let mut face = [0; 3];
            let mut at = 0;
            for (corner, &node) in tet.iter().enumerate() {
                if corner != omitted {
                    face[at] = node;
                    at += 1;
                }
            }
            face.sort_unstable();
            if let Some(&previous) = tet_faces.get(&face) {
                join_component(&mut parents, previous, element);
            } else {
                tet_faces.insert(face, element);
            }
        }
    }
    // Paired Hex8 faces are removed, so a regular large grid retains mainly
    // boundary and current-front faces rather than six faces per element.
    // A nonmanifold third use of the same face may remain a separate group;
    // this check is necessary, not a complete topology or rank certificate.
    let mut unmatched_hex_faces: HashMap<[usize; 4], usize> = HashMap::new();
    for (hex_index, hex) in request.hexes.iter().enumerate() {
        let element = tets + hex_index;
        for corners in HEX_FACES {
            let mut face = corners.map(|corner| hex.nodes[corner]);
            face.sort_unstable();
            if let Some(previous) = unmatched_hex_faces.remove(&face) {
                join_component(&mut parents, previous, element);
            } else {
                unmatched_hex_faces.insert(face, element);
            }
            // A conforming Tet4/Hex8 interface may cover a triangular half
            // of a Hex8 face. Three shared noncollinear nodes weld rigid modes.
            for omitted in 0..4 {
                let mut triangle = [0; 3];
                let mut at = 0;
                for (corner, &node) in face.iter().enumerate() {
                    if corner != omitted {
                        triangle[at] = node;
                        at += 1;
                    }
                }
                if let Some(&tet_element) = tet_faces.get(&triangle) {
                    join_component(&mut parents, tet_element, element);
                }
            }
        }
    }

    let nodes = request.mesh.nodes.len();
    let mut group_nodes: HashMap<usize, Vec<usize>> = HashMap::new();
    for (element, tet) in request.mesh.tets.iter().enumerate() {
        let root = component_root(&mut parents, element);
        group_nodes.entry(root).or_default().extend(tet);
    }
    for (index, hex) in request.hexes.iter().enumerate() {
        let root = component_root(&mut parents, tets + index);
        group_nodes.entry(root).or_default().extend(hex.nodes);
    }
    let mut first_group = vec![None; nodes];
    let mut optimistic_contact = vec![false; nodes];
    for (&root, members) in &mut group_nodes {
        members.sort_unstable();
        members.dedup();
        for &node in members.iter() {
            if let Some(previous) = first_group[node] {
                if previous != root {
                    optimistic_contact[node] = true;
                }
            } else {
                first_group[node] = Some(root);
            }
        }
    }
    for node in request
        .trusses
        .iter()
        .flat_map(|element| element.nodes)
        .chain(request.membranes.iter().flat_map(|element| element.nodes))
        .chain(request.frames.iter().flat_map(|element| element.nodes))
        .chain(
            request
                .bending_plates
                .iter()
                .flat_map(|element| element.nodes),
        )
    {
        optimistic_contact[node] = true;
    }
    for (root, members) in group_nodes {
        let origin = request.mesh.nodes[members[0]];
        let span = members
            .iter()
            .flat_map(|&node| {
                request.mesh.nodes[node]
                    .iter()
                    .enumerate()
                    .map(move |(axis, value)| (value - origin[axis]).abs())
            })
            .fold(1.0_f64, f64::max);
        let mut rows = Vec::new();
        for node in members {
            let [x, y, z] =
                std::array::from_fn(|axis| (request.mesh.nodes[node][axis] - origin[axis]) / span);
            for axis in 0..3 {
                if optimistic_contact[node] || prescribed[3 * node + axis].is_some() {
                    rows.push(match axis {
                        0 => [1.0, 0.0, 0.0, 0.0, z, -y],
                        1 => [0.0, 1.0, 0.0, -z, 0.0, x],
                        _ => [0.0, 0.0, 1.0, y, -x, 0.0],
                    });
                }
            }
        }
        if !has_six_independent_modes(&rows) {
            return Err(format!(
                "mixed3d solid face-connected group {root}: supports and even fully fixed external contacts leave a rigid-body hinge"
            ));
        }
    }
    Ok(())
}

fn certify_iterative_rank(
    request: &Mixed3dRequest,
    dofs: usize,
    prescribed: &[Option<f64>],
) -> Result<(), String> {
    if dofs > MAX_SMALL_COUPLED_RANK_PREFLIGHT_DOFS {
        return validate_solid_group_modes(request, prescribed);
    }
    if prescribed.iter().all(Option::is_some) {
        return Ok(());
    }
    // SparseDirect does not enter this preflight, so there is no recursion.
    // Its pivot check sees relative Tet4/Hex8/plate/frame mechanisms that a
    // component-wise rigid-mode check cannot prove absent. The full solve is
    // intentionally limited to at most 128 total translational/rotational DOFs.
    solve_backend(request, Mixed3dBackend::SparseDirect)
        .map(|_| ())
        .map_err(|error| format!("mixed3d small coupled direct rank preflight: {error}"))
}

fn solve_backend(
    request: &Mixed3dRequest,
    backend: Mixed3dBackend,
) -> Result<Mixed3dResult, String> {
    let Prepared {
        translation_dofs,
        rotation_base,
        plate_only_rotation,
        dofs,
        mut loads,
        prescribed,
    } = prepare(request)?;
    let nodes = request.mesh.nodes.len();
    if backend == Mixed3dBackend::SparsePcg {
        validate_matrix_free_supports(request, &rotation_base, &plate_only_rotation, &prescribed)?;
        certify_iterative_rank(request, dofs, &prescribed)?;
    }
    if backend == Mixed3dBackend::SparseDirect && dofs > MAX_MIXED3D_SPARSE_DIRECT_DOFS {
        return Err(format!("mixed3d sparseDirect is limited to {MAX_MIXED3D_SPARSE_DIRECT_DOFS} DOFs because sparse LDLT fill may grow sharply"));
    }

    let local_entries = request
        .mesh
        .tets
        .len()
        .checked_mul(144)
        .and_then(|n| {
            request
                .hexes
                .len()
                .checked_mul(576)
                .and_then(|m| n.checked_add(m))
        })
        .and_then(|n| {
            request
                .trusses
                .len()
                .checked_mul(36)
                .and_then(|m| n.checked_add(m))
        })
        .and_then(|n| {
            request
                .frames
                .len()
                .checked_mul(144)
                .and_then(|m| n.checked_add(m))
        })
        .and_then(|n| {
            request
                .membranes
                .len()
                .checked_mul(81)
                .and_then(|m| n.checked_add(m))
        })
        .and_then(|n| request.bending_plates.len().checked_mul(81)?.checked_add(n))
        .ok_or("mixed3d local stiffness storage size overflow")?;
    if local_entries > MAX_STORED_LOCAL_ENTRIES {
        return Err("mixed3d frame coupling retained local stiffness exceeds 8M entries".into());
    }
    if request.mesh.tets.is_empty()
        && request
            .tet_materials
            .as_ref()
            .is_some_and(|v| !v.is_empty())
    {
        return Err("mixed3d tetMaterials count must equal Tet4 element count".into());
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
        let compact = volume3d::Mesh {
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
        if request.tet_materials.is_some() && materials.len() != compact.tets.len() {
            return Err("mixed3d tetMaterials count must equal Tet4 element count".into());
        }
        let ids = if request.tet_materials.is_some() {
            (0..compact.tets.len()).collect()
        } else {
            vec![0; compact.tets.len()]
        };
        Some(volume3d::Operator::new_with_materials(
            &compact, materials, &ids,
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
        let element = Hex8Element::new(coordinates.try_into().unwrap(), hex.e_mpa, hex.poisson)
            .map_err(|error| format!("Hex8 {index}: {error}"))?;
        let local_dofs = hex
            .nodes
            .iter()
            .flat_map(|&node| (0..3).map(move |a| 3 * node + a))
            .collect();
        let stiffness = element
            .stiffness
            .iter()
            .flat_map(|row| row.iter().copied())
            .collect();
        elements.push(frontal::FrontalElement {
            dofs: local_dofs,
            stiffness,
        });
        hex_data.push(element);
    }
    let mut truss_data = Vec::with_capacity(request.trusses.len());
    for (index, truss) in request.trusses.iter().enumerate() {
        let (element, direction, scale) = mixed3d::truss_element(&request.mesh, truss, index)?;
        elements.push(element);
        truss_data.push((direction, scale));
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
    let frame_elements_start = elements.len();
    let mut frame_data = Vec::with_capacity(request.frames.len());
    for (index, frame) in request.frames.iter().enumerate() {
        let [a, b] = frame.nodes;
        let matrix = frame3d::linear_member_matrices_with_shear(
            request.mesh.nodes[a],
            request.mesh.nodes[b],
            frame.e_mpa,
            frame.poisson,
            frame.g_mpa,
            frame.area_m2,
            frame.iy_m4,
            frame.iz_m4,
            frame.torsion_j_m4,
            frame.roll_angle_rad,
        )
        .map_err(|error| format!("frame {index}: {error}"))?;
        let mut local_dofs = [0; 12];
        for (end, node) in [a, b].into_iter().enumerate() {
            for axis in 0..3 {
                local_dofs[6 * end + axis] = 3 * node + axis;
                local_dofs[6 * end + 3 + axis] = rotation_base[node].unwrap() + axis;
            }
        }
        elements.push(frontal::FrontalElement {
            dofs: local_dofs.to_vec(),
            stiffness: matrix
                .global_stiffness
                .iter()
                .flat_map(|row| row.iter().copied())
                .collect(),
        });
        frame_data.push(FrameData {
            dofs: local_dofs,
            global_stiffness: matrix.global_stiffness,
            local_stiffness: matrix.local_stiffness,
            rotation: matrix.rotation,
        });
    }
    let frame_equivalent_loads = assemble_frame_member_loads(request, &frame_data, &mut loads)?;
    let bending_plate_elements_start = elements.len();
    for index in 0..request.bending_plates.len() {
        let plate = bending_plate_element(request, index, &rotation_base)?;
        elements.push(frontal::FrontalElement {
            dofs: plate.dofs.to_vec(),
            stiffness: plate.stiffness.to_vec(),
        });
    }

    let mut reduced_rhs = loads.clone();
    for element in &elements {
        let width = element.dofs.len();
        for (i, &row) in element.dofs.iter().enumerate() {
            if prescribed[row].is_none() {
                for (j, &col) in element.dofs.iter().enumerate() {
                    if let Some(value) = prescribed[col] {
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

    let (u, maximum_front, iterations) = match backend {
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
            let patterns: Vec<&[usize]> = elements
                .iter()
                .map(|element| element.dofs.as_slice())
                .collect();
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
        Mixed3dBackend::MatrixFreePcg | Mixed3dBackend::Automatic => unreachable!(),
    };
    if u.len() != dofs || u.iter().any(|v| !v.is_finite()) {
        return Err("mixed3d frame solve produced invalid displacements".into());
    }
    let mut internal = vec![0.0; dofs];
    let solid_element_stress_mpa = if let Some(operator) = &tet_operator {
        let compact_u: Vec<f64> = tet_to_global
            .iter()
            .flat_map(|&node| [u[3 * node], u[3 * node + 1], u[3 * node + 2]])
            .collect();
        let compact_force = operator.apply(&compact_u, 1)?;
        for (local, &global) in tet_to_global.iter().enumerate() {
            for axis in 0..3 {
                internal[3 * global + axis] += compact_force[3 * local + axis];
            }
        }
        operator.element_stress_mpa(&compact_u)?
    } else {
        Vec::new()
    };
    let mut hex_gauss_stress_mpa = Vec::with_capacity(hex_data.len());
    for (hex, element) in request.hexes.iter().zip(&hex_data) {
        let mut local_u = [0.0; 24];
        for (i, &node) in hex.nodes.iter().enumerate() {
            for axis in 0..3 {
                local_u[3 * i + axis] = u[3 * node + axis];
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
    for (truss, &(direction, scale)) in request.trusses.iter().zip(&truss_data) {
        let [a, b] = truss.nodes;
        let extension = (0..3)
            .map(|axis| direction[axis] * (u[3 * b + axis] - u[3 * a + axis]))
            .sum::<f64>();
        let force = scale * extension;
        for axis in 0..3 {
            internal[3 * a + axis] -= force * direction[axis];
            internal[3 * b + axis] += force * direction[axis];
        }
        truss_axial_force_kn.push(force);
    }
    for membrane in &membranes {
        membrane.apply_into(&u, &mut internal);
    }
    let membrane_stress_mpa: Vec<[f64; 3]> = membranes
        .iter()
        .map(|membrane| membrane.stress_mpa(&u))
        .collect();
    let membrane_resultants_kn_per_m = membranes
        .iter()
        .zip(&membrane_stress_mpa)
        .map(|(membrane, &stress)| membrane.resultants_kn_per_m(stress))
        .collect();
    let mut frame_end_forces_local = Vec::with_capacity(frame_data.len());
    for (index, frame) in frame_data.iter().enumerate() {
        frame_end_forces_local.push(local_frame_forces(
            frame,
            &u,
            &frame_equivalent_loads[index],
        ));
        let element = &elements[frame_elements_start + index];
        for (i, &row) in frame.dofs.iter().enumerate() {
            internal[row] += (0..12)
                .map(|j| element.stiffness[i * 12 + j] * u[element.dofs[j]])
                .sum::<f64>();
        }
    }
    for element in &elements[bending_plate_elements_start..] {
        let width = element.dofs.len();
        for (i, &row) in element.dofs.iter().enumerate() {
            internal[row] += (0..width)
                .map(|j| element.stiffness[i * width + j] * u[element.dofs[j]])
                .sum::<f64>();
        }
    }
    let reactions: Vec<f64> = internal.iter().zip(&loads).map(|(p, f)| p - f).collect();
    let free_residual = reactions
        .iter()
        .zip(&prescribed)
        .filter(|(_, p)| p.is_none())
        .fold(0.0_f64, |m, (r, _)| m.max(r.abs()));
    let relative_residual = free_residual / rhs_scale;
    if !relative_residual.is_finite() || relative_residual > 1e-8 {
        return Err(format!(
            "mixed3d frame free residual {relative_residual:.3e} exceeds 1e-8"
        ));
    }
    let mut rotations = vec![None; nodes];
    let mut moment_reactions = vec![None; nodes];
    for (node, base) in rotation_base.iter().enumerate() {
        if let Some(base) = base {
            rotations[node] = Some([
                u[*base],
                u[*base + 1],
                if plate_only_rotation[node] {
                    0.0
                } else {
                    u[*base + 2]
                },
            ]);
            moment_reactions[node] = Some([
                reactions[*base],
                reactions[*base + 1],
                if plate_only_rotation[node] {
                    0.0
                } else {
                    reactions[*base + 2]
                },
            ]);
        }
    }
    let bending_plate_moments_knm_per_m =
        recover_bending_plate_moments(request, &rotation_base, &u)?;
    let triples = |values: &[f64]| values.chunks_exact(3).map(|v| [v[0], v[1], v[2]]).collect();
    Ok(Mixed3dResult {
        nodal_displacements_m: triples(&u[..translation_dofs]),
        nodal_reactions_kn: triples(&reactions[..translation_dofs]),
        solid_element_stress_mpa,
        hex_gauss_stress_mpa,
        truss_axial_force_kn,
        membrane_stress_mpa,
        membrane_resultants_kn_per_m,
        bending_plate_moments_knm_per_m,
        nodal_rotations_rad: rotations,
        nodal_moment_reactions_knm: moment_reactions,
        frame_end_forces_local,
        relative_residual,
        backend_used: backend,
        frontal_maximum_front_dofs: maximum_front,
        linear_iterations: iterations,
    })
}

/// Matrix-free solids, trusses and membranes plus compact frame and DKT plate
/// products. Unlike the assembled path, no global CSR or per-solid frontal
/// element is retained.
fn solve_matrix_free(request: &Mixed3dRequest) -> Result<Mixed3dResult, String> {
    let Prepared {
        translation_dofs,
        rotation_base,
        plate_only_rotation,
        dofs,
        mut loads,
        prescribed,
    } = prepare(request)?;
    let nodes = request.mesh.nodes.len();
    if dofs > 1_200_000 {
        return Err("mixed3d frame matrix-free backend exceeds 1.2M global DOFs".into());
    }
    let plate_entries = request
        .bending_plates
        .len()
        .checked_mul(81)
        .ok_or("mixed3d matrix-free DKT storage count overflow")?;
    if plate_entries > MAX_STORED_LOCAL_ENTRIES {
        return Err("mixed3d matrix-free DKT storage exceeds 8M entries (98,765 plates)".into());
    }
    if request.mesh.tets.is_empty()
        && request
            .tet_materials
            .as_ref()
            .is_some_and(|m| !m.is_empty())
    {
        return Err("mixed3d tetMaterials count must equal Tet4 element count".into());
    }
    validate_matrix_free_supports(request, &rotation_base, &plate_only_rotation, &prescribed)?;
    certify_iterative_rank(request, dofs, &prescribed)?;

    let mut tet_map = vec![None; nodes];
    let mut tet_to_global = Vec::new();
    for tet in &request.mesh.tets {
        for &node in tet {
            if tet_map[node].is_none() {
                tet_map[node] = Some(tet_to_global.len());
                tet_to_global.push(node);
            }
        }
    }
    let tet_operator = if request.mesh.tets.is_empty() {
        None
    } else {
        let compact = volume3d::Mesh {
            nodes: tet_to_global
                .iter()
                .map(|&node| request.mesh.nodes[node])
                .collect(),
            tets: request
                .mesh
                .tets
                .iter()
                .map(|tet| tet.map(|node| tet_map[node].unwrap()))
                .collect(),
        };
        let materials = request
            .tet_materials
            .as_deref()
            .unwrap_or(std::slice::from_ref(&request.solid_material));
        if request.tet_materials.is_some() && materials.len() != compact.tets.len() {
            return Err("mixed3d tetMaterials count must equal Tet4 element count".into());
        }
        let material_ids = if request.tet_materials.is_some() {
            (0..compact.tets.len()).collect()
        } else {
            vec![0; compact.tets.len()]
        };
        Some(volume3d::Operator::new_with_materials(
            &compact,
            materials,
            &material_ids,
        )?)
    };

    let mut hex_map = vec![None; nodes];
    let mut hex_to_global = Vec::new();
    for hex in &request.hexes {
        for &node in &hex.nodes {
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
            .map(|hex| hex.nodes.map(|node| hex_map[node].unwrap()))
            .collect();
        let materials: Vec<(f64, f64)> = request
            .hexes
            .iter()
            .map(|hex| (hex.e_mpa, hex.poisson))
            .collect();
        let material_ids: Vec<usize> = (0..hexes.len()).collect();
        Some(hex8_matrix_free::GeneralOperator::new_large(
            hex_to_global
                .iter()
                .map(|&node| request.mesh.nodes[node])
                .collect(),
            hexes,
            &materials,
            &material_ids,
        )?)
    };

    let mut diagonal = vec![0.0; dofs];
    if let Some(operator) = &tet_operator {
        for (local, &node) in tet_to_global.iter().enumerate() {
            for axis in 0..3 {
                diagonal[3 * node + axis] += operator.diagonal()[3 * local + axis];
            }
        }
    }
    if let Some(operator) = &hex_operator {
        for (local, &node) in hex_to_global.iter().enumerate() {
            for axis in 0..3 {
                diagonal[3 * node + axis] += operator.diagonal()[3 * local + axis];
            }
        }
    }
    let mut trusses = Vec::with_capacity(request.trusses.len());
    for (index, truss) in request.trusses.iter().enumerate() {
        let (_, direction, scale) = mixed3d::truss_element(&request.mesh, truss, index)?;
        for &node in &truss.nodes {
            for axis in 0..3 {
                diagonal[3 * node + axis] += scale * direction[axis] * direction[axis];
            }
        }
        trusses.push((truss.nodes, direction, scale));
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
    let mut frames = Vec::with_capacity(request.frames.len());
    for (index, frame) in request.frames.iter().enumerate() {
        let [a, b] = frame.nodes;
        let matrix = frame3d::linear_member_matrices_with_shear(
            request.mesh.nodes[a],
            request.mesh.nodes[b],
            frame.e_mpa,
            frame.poisson,
            frame.g_mpa,
            frame.area_m2,
            frame.iy_m4,
            frame.iz_m4,
            frame.torsion_j_m4,
            frame.roll_angle_rad,
        )
        .map_err(|error| format!("frame {index}: {error}"))?;
        let mut local_dofs = [0; 12];
        for (end, node) in [a, b].into_iter().enumerate() {
            for axis in 0..3 {
                local_dofs[6 * end + axis] = 3 * node + axis;
                local_dofs[6 * end + 3 + axis] = rotation_base[node].unwrap() + axis;
            }
        }
        for (i, &dof) in local_dofs.iter().enumerate() {
            diagonal[dof] += matrix.global_stiffness[i][i];
        }
        frames.push(FrameData {
            dofs: local_dofs,
            global_stiffness: matrix.global_stiffness,
            local_stiffness: matrix.local_stiffness,
            rotation: matrix.rotation,
        });
    }
    let frame_equivalent_loads = assemble_frame_member_loads(request, &frames, &mut loads)?;
    let mut plates = Vec::with_capacity(request.bending_plates.len());
    for index in 0..request.bending_plates.len() {
        let plate = bending_plate_element(request, index, &rotation_base)?;
        for (local, &dof) in plate.dofs.iter().enumerate() {
            diagonal[dof] += plate.stiffness[9 * local + local];
        }
        plates.push(plate);
    }
    if diagonal.iter().any(|value| !value.is_finite()) {
        return Err("mixed3d frame matrix-free diagonal is non-finite".into());
    }
    if diagonal
        .iter()
        .zip(&prescribed)
        .any(|(&value, support)| support.is_none() && value <= 0.0)
    {
        return Err("mixed3d frame free DOF has zero matrix-free stiffness".into());
    }

    let apply = |x: &[f64]| -> Result<Vec<f64>, String> {
        let mut product = vec![0.0; dofs];
        if let Some(operator) = &tet_operator {
            let compact: Vec<f64> = tet_to_global
                .iter()
                .flat_map(|&node| [x[3 * node], x[3 * node + 1], x[3 * node + 2]])
                .collect();
            let local = operator.apply(&compact, request.threads)?;
            for (i, &node) in tet_to_global.iter().enumerate() {
                for axis in 0..3 {
                    product[3 * node + axis] += local[3 * i + axis];
                }
            }
        }
        if let Some(operator) = &hex_operator {
            let compact: Vec<f64> = hex_to_global
                .iter()
                .flat_map(|&node| [x[3 * node], x[3 * node + 1], x[3 * node + 2]])
                .collect();
            let local = operator.apply(&compact, request.threads)?;
            for (i, &node) in hex_to_global.iter().enumerate() {
                for axis in 0..3 {
                    product[3 * node + axis] += local[3 * i + axis];
                }
            }
        }
        for &([a, b], direction, scale) in &trusses {
            let extension: f64 = (0..3)
                .map(|axis| direction[axis] * (x[3 * b + axis] - x[3 * a + axis]))
                .sum();
            let force = scale * extension;
            for axis in 0..3 {
                product[3 * a + axis] -= force * direction[axis];
                product[3 * b + axis] += force * direction[axis];
            }
        }
        for membrane in &membranes {
            membrane.apply_into(x, &mut product);
        }
        for frame in &frames {
            for (i, &row) in frame.dofs.iter().enumerate() {
                product[row] += (0..12)
                    .map(|j| frame.global_stiffness[i][j] * x[frame.dofs[j]])
                    .sum::<f64>();
            }
        }
        for plate in &plates {
            for (i, &row) in plate.dofs.iter().enumerate() {
                product[row] += (0..9)
                    .map(|j| plate.stiffness[9 * i + j] * x[plate.dofs[j]])
                    .sum::<f64>();
            }
        }
        if product.iter().any(|value| !value.is_finite()) {
            return Err("mixed3d frame matrix-free product is non-finite".into());
        }
        Ok(product)
    };
    let fixed: Vec<(usize, f64)> = prescribed
        .iter()
        .enumerate()
        .filter_map(|(dof, value)| value.map(|v| (dof, v)))
        .collect();
    let solution = hex8_matrix_free::solve_pcg_with_prevalidated_support(
        &diagonal,
        request.mesh.tets.len()
            + request.hexes.len()
            + request.trusses.len()
            + frames.len()
            + membranes.len()
            + plates.len(),
        apply,
        &loads,
        &fixed,
        request.threads,
        1e-9,
        request.max_pcg_iterations,
    )?;
    let u = solution.displacements;
    let reactions = solution.reactions;

    let solid_element_stress_mpa = if let Some(operator) = &tet_operator {
        let compact: Vec<f64> = tet_to_global
            .iter()
            .flat_map(|&node| [u[3 * node], u[3 * node + 1], u[3 * node + 2]])
            .collect();
        operator.element_stress_mpa(&compact)?
    } else {
        Vec::new()
    };
    let mut hex_gauss_stress_mpa = Vec::with_capacity(request.hexes.len());
    if let Some(operator) = &hex_operator {
        for (index, hex) in request.hexes.iter().enumerate() {
            let element = operator
                .local_for_element(index)
                .ok_or("missing compact Hex8 element")?;
            let mut local_u = [0.0; 24];
            for (i, &node) in hex.nodes.iter().enumerate() {
                for axis in 0..3 {
                    local_u[3 * i + axis] = u[3 * node + axis];
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
    let truss_axial_force_kn = trusses
        .iter()
        .map(|&([a, b], direction, scale)| {
            scale
                * (0..3)
                    .map(|axis| direction[axis] * (u[3 * b + axis] - u[3 * a + axis]))
                    .sum::<f64>()
        })
        .collect();
    let membrane_stress_mpa: Vec<[f64; 3]> = membranes
        .iter()
        .map(|membrane| membrane.stress_mpa(&u))
        .collect();
    let membrane_resultants_kn_per_m = membranes
        .iter()
        .zip(&membrane_stress_mpa)
        .map(|(membrane, &stress)| membrane.resultants_kn_per_m(stress))
        .collect();
    let frame_end_forces_local = frames
        .iter()
        .zip(&frame_equivalent_loads)
        .map(|(frame, equivalent)| local_frame_forces(frame, &u, equivalent))
        .collect();
    let mut rotations = vec![None; nodes];
    let mut moment_reactions = vec![None; nodes];
    for (node, base) in rotation_base.iter().enumerate() {
        if let Some(base) = base {
            rotations[node] = Some([
                u[*base],
                u[*base + 1],
                if plate_only_rotation[node] {
                    0.0
                } else {
                    u[*base + 2]
                },
            ]);
            moment_reactions[node] = Some([
                reactions[*base],
                reactions[*base + 1],
                if plate_only_rotation[node] {
                    0.0
                } else {
                    reactions[*base + 2]
                },
            ]);
        }
    }
    let bending_plate_moments_knm_per_m =
        recover_bending_plate_moments(request, &rotation_base, &u)?;
    let triples = |values: &[f64]| values.chunks_exact(3).map(|v| [v[0], v[1], v[2]]).collect();
    Ok(Mixed3dResult {
        nodal_displacements_m: triples(&u[..translation_dofs]),
        nodal_reactions_kn: triples(&reactions[..translation_dofs]),
        solid_element_stress_mpa,
        hex_gauss_stress_mpa,
        truss_axial_force_kn,
        membrane_stress_mpa,
        membrane_resultants_kn_per_m,
        bending_plate_moments_knm_per_m,
        nodal_rotations_rad: rotations,
        nodal_moment_reactions_knm: moment_reactions,
        frame_end_forces_local,
        relative_residual: solution.relative_residual,
        backend_used: Mixed3dBackend::MatrixFreePcg,
        frontal_maximum_front_dofs: None,
        linear_iterations: solution.iterations,
    })
}
