//! Conservative geometric restraint check for the opt-in J2 Tet4 PCG path.
//!
//! A shared vertex or edge can act as a hinge between tetrahedral groups. We
//! therefore test rigid-body restraints on each group joined by whole faces,
//! rather than assuming the mesh is stable because some DOFs are prescribed.
//! This is a necessary geometric check, not a numerical inertia certificate.

use crate::volume3d::Mesh;
use std::collections::HashMap;

/// Reject unused nodes and face-connected Tet4 groups with an unconstrained
/// rigid-body mode. `prescribed` is indexed by `3 * node + component`.
pub(crate) fn validate(mesh: &Mesh, prescribed: &[bool]) -> Result<(), String> {
    let dofs = mesh
        .nodes
        .len()
        .checked_mul(3)
        .ok_or("J2 PCG support check: DOF count overflow")?;
    if prescribed.len() != dofs {
        return Err(format!(
            "J2 PCG support check: expected {dofs} prescribed DOF flags, got {}",
            prescribed.len()
        ));
    }
    if mesh.tets.is_empty() {
        return Err("J2 PCG support check: mesh has no tetrahedra".into());
    }
    if mesh
        .nodes
        .iter()
        .flat_map(|node| node.iter())
        .any(|value| !value.is_finite())
    {
        return Err("J2 PCG support check: node coordinates must be finite".into());
    }

    let mut used = vec![false; mesh.nodes.len()];
    let mut parents: Vec<usize> = (0..mesh.tets.len()).collect();
    // A face may belong to at most two Tet4 elements in this conservative path.
    let mut faces: HashMap<[usize; 3], (usize, usize)> = HashMap::new();
    for (element, tet) in mesh.tets.iter().enumerate() {
        for (corner, &node) in tet.iter().enumerate() {
            if node >= mesh.nodes.len() {
                return Err(format!(
                    "J2 PCG support check: tetrahedron {element} corner {corner} refers to missing node {node}"
                ));
            }
            if tet[..corner].contains(&node) {
                return Err(format!(
                    "J2 PCG support check: tetrahedron {element} repeats node {node}"
                ));
            }
            used[node] = true;
        }
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
            match faces.get_mut(&face) {
                None => {
                    faces.insert(face, (element, 1));
                }
                Some((first, count)) if *count == 1 => {
                    union(&mut parents, *first, element);
                    *count = 2;
                }
                Some(_) => {
                    return Err(format!(
                        "J2 PCG support check: nonmanifold face {face:?} belongs to more than two tetrahedra"
                    ));
                }
            }
        }
    }
    if let Some(node) = used.iter().position(|&is_used| !is_used) {
        return Err(format!(
            "J2 PCG support check: node {node} is unused by all tetrahedra"
        ));
    }

    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for (element, tet) in mesh.tets.iter().enumerate() {
        let root = find(&mut parents, element);
        groups.entry(root).or_default().extend(tet);
    }
    for (root, nodes) in &mut groups {
        nodes.sort_unstable();
        nodes.dedup();
        validate_group_rank(mesh, prescribed, nodes).map_err(|detail| {
            format!("J2 PCG support check: face-connected group {root} {detail}")
        })?;
    }
    Ok(())
}

fn find(parents: &mut [usize], mut index: usize) -> usize {
    let mut root = index;
    while root != parents[root] {
        root = parents[root];
    }
    while index != root {
        let next = parents[index];
        parents[index] = root;
        index = next;
    }
    root
}

fn union(parents: &mut [usize], first: usize, second: usize) {
    let a = find(parents, first);
    let b = find(parents, second);
    if a != b {
        parents[b] = a;
    }
}

fn validate_group_rank(mesh: &Mesh, prescribed: &[bool], nodes: &[usize]) -> Result<(), String> {
    let mut center = [0.0; 3];
    for &node in nodes {
        for (axis, coordinate) in center.iter_mut().enumerate() {
            *coordinate += mesh.nodes[node][axis] / nodes.len() as f64;
        }
    }
    let mut length: f64 = 0.0;
    for &node in nodes {
        for (axis, &coordinate) in mesh.nodes[node].iter().enumerate() {
            length = length.max((coordinate - center[axis]).abs());
        }
    }
    if !length.is_finite() || length == 0.0 {
        return Err("has zero geometric extent".into());
    }

    // Six columns: three translations and three infinitesimal rotations.
    // Normalize coordinates before forming r x omega, then use pivoted,
    // twice-reorthogonalized Gram-Schmidt to reveal missing rigid modes.
    let constrained = nodes
        .iter()
        .flat_map(|&node| (0..3).map(move |axis| (node, axis)))
        .filter(|&(node, axis)| prescribed[3 * node + axis])
        .collect::<Vec<_>>();
    if constrained.len() < 6 {
        return Err(format!(
            "has rigid-body restraint rank at most {}/6: only that many prescribed components; six independent restraints are required",
            constrained.len()
        ));
    }
    let mut columns: [Vec<f64>; 6] = std::array::from_fn(|_| Vec::with_capacity(constrained.len()));
    for (node, axis) in constrained {
        let [x, y, z] = mesh.nodes[node];
        let r = [
            (x - center[0]) / length,
            (y - center[1]) / length,
            (z - center[2]) / length,
        ];
        let row = match axis {
            0 => [1.0, 0.0, 0.0, 0.0, r[2], -r[1]],
            1 => [0.0, 1.0, 0.0, -r[2], 0.0, r[0]],
            _ => [0.0, 0.0, 1.0, r[1], -r[0], 0.0],
        };
        for (column, &value) in columns.iter_mut().zip(row.iter()) {
            column.push(value);
        }
    }
    let original_max = columns
        .iter()
        .map(|column| norm(column))
        .fold(0.0_f64, f64::max);
    let threshold = 1e-10 * original_max;
    let mut basis: Vec<Vec<f64>> = Vec::with_capacity(6);
    for rank in 0..6 {
        let pivot = (rank..6)
            .max_by(|&a, &b| norm(&columns[a]).total_cmp(&norm(&columns[b])))
            .unwrap();
        columns.swap(rank, pivot);
        let pivot_norm = norm(&columns[rank]);
        if !pivot_norm.is_finite() || pivot_norm <= threshold {
            return Err(format!(
                "has rigid-body restraint rank {rank}/6 (free translation, rotation, or hinge)"
            ));
        }
        for value in &mut columns[rank] {
            *value /= pivot_norm;
        }
        basis.push(columns[rank].clone());
        for column in columns.iter_mut().skip(rank + 1) {
            for _ in 0..2 {
                let dot = column
                    .iter()
                    .zip(&basis[rank])
                    .map(|(a, b)| a * b)
                    .sum::<f64>();
                for (value, &direction) in column.iter_mut().zip(&basis[rank]) {
                    *value -= dot * direction;
                }
            }
        }
    }
    Ok(())
}

fn norm(vector: &[f64]) -> f64 {
    vector.iter().map(|value| value * value).sum::<f64>().sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tet() -> Mesh {
        Mesh {
            nodes: vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
            ],
            tets: vec![[0, 1, 2, 3]],
        }
    }

    fn restrain_tet(prescribed: &mut [bool], nodes: [usize; 3]) {
        for axis in 0..3 {
            prescribed[3 * nodes[0] + axis] = true;
        }
        for axis in 1..3 {
            prescribed[3 * nodes[1] + axis] = true;
        }
        prescribed[3 * nodes[2] + 2] = true;
    }

    #[test]
    fn one_tetrahedron_with_six_independent_restraints_passes() {
        let mesh = tet();
        let mut prescribed = vec![false; 12];
        restrain_tet(&mut prescribed, [0, 1, 2]);
        validate(&mesh, &prescribed).unwrap();
    }

    #[test]
    fn missing_rotational_restraint_is_rejected() {
        let mesh = tet();
        let mut prescribed = vec![false; 12];
        restrain_tet(&mut prescribed, [0, 1, 2]);
        prescribed[3 * 2 + 2] = false;
        let error = validate(&mesh, &prescribed).unwrap_err();
        assert!(error.contains("six independent"), "{error}");
    }

    #[test]
    fn six_components_on_two_nodes_still_leave_rotation_about_their_edge() {
        let mesh = tet();
        let mut prescribed = vec![false; 12];
        prescribed[..6].fill(true);
        let error = validate(&mesh, &prescribed).unwrap_err();
        assert!(error.contains("rank 5/6"), "{error}");
    }

    #[test]
    fn tetrahedra_sharing_a_full_face_are_one_supported_group() {
        let mut mesh = tet();
        mesh.nodes.push([0.0, 0.0, -1.0]);
        mesh.tets.push([0, 1, 2, 4]);
        let mut prescribed = vec![false; 15];
        restrain_tet(&mut prescribed, [0, 1, 2]);
        validate(&mesh, &prescribed).unwrap();
    }

    #[test]
    fn disconnected_groups_each_need_their_own_restraints() {
        let mut mesh = tet();
        mesh.nodes.extend([
            [3.0, 0.0, 0.0],
            [4.0, 0.0, 0.0],
            [3.0, 1.0, 0.0],
            [3.0, 0.0, 1.0],
        ]);
        mesh.tets.push([4, 5, 6, 7]);
        let mut prescribed = vec![false; 24];
        restrain_tet(&mut prescribed, [0, 1, 2]);
        assert!(validate(&mesh, &prescribed).is_err());
        restrain_tet(&mut prescribed, [4, 5, 6]);
        validate(&mesh, &prescribed).unwrap();
    }

    #[test]
    fn shared_vertex_does_not_hide_second_group_hinge() {
        let mut mesh = tet();
        mesh.nodes
            .extend([[0.0, -1.0, 0.0], [0.0, 0.0, -1.0], [-1.0, 0.0, 0.0]]);
        mesh.tets.push([0, 4, 5, 6]);
        let mut prescribed = vec![false; 21];
        restrain_tet(&mut prescribed, [0, 1, 2]);
        assert!(validate(&mesh, &prescribed).unwrap_err().contains("rank"));
    }

    #[test]
    fn shared_edge_does_not_hide_second_group_hinge() {
        let mut mesh = tet();
        mesh.nodes.extend([[0.0, -1.0, 0.0], [0.0, 0.0, -1.0]]);
        mesh.tets.push([0, 1, 4, 5]);
        let mut prescribed = vec![false; 18];
        restrain_tet(&mut prescribed, [0, 1, 2]);
        assert!(validate(&mesh, &prescribed).unwrap_err().contains("rank"));
    }

    #[test]
    fn unused_node_and_nonmanifold_face_are_rejected() {
        let mut mesh = tet();
        mesh.nodes.push([3.0, 3.0, 3.0]);
        let prescribed = vec![false; 15];
        assert!(validate(&mesh, &prescribed).unwrap_err().contains("unused"));
        mesh.nodes.pop();
        mesh.nodes.extend([[0.0, 0.0, -1.0], [1.0, 1.0, 1.0]]);
        mesh.tets.extend([[0, 1, 2, 4], [0, 1, 2, 5]]);
        assert!(validate(&mesh, &vec![false; 18])
            .unwrap_err()
            .contains("nonmanifold"));
    }
}
