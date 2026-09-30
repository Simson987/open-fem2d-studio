//! Three-node Discrete Kirchhoff Triangle (DKT) for linear plate bending.
//! Nodal DOFs are [w, theta_x, theta_y], with theta_x=-dw/dy and theta_y=dw/dx.
//! Geometry is in m, E in MPa, forces in kN and moments in kN m.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::math::{constrained_solve, Matrix};
use crate::positive;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Node {
    pub id: usize,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Material {
    pub id: usize,
    pub e_mpa: f64,
    pub nu: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Triangle {
    pub id: usize,
    pub node_ids: [usize; 3],
    pub material_id: usize,
    pub thickness_m: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Support {
    pub node_id: usize,
    pub w: bool,
    pub theta_x: bool,
    pub theta_y: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Load {
    pub node_id: usize,
    pub fz: f64,
    pub mx: f64,
    pub my: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub nodes: Vec<Node>,
    pub materials: Vec<Material>,
    pub triangles: Vec<Triangle>,
    #[serde(default)]
    pub supports: Vec<Support>,
    #[serde(default)]
    pub loads: Vec<Load>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeResult {
    pub node_id: usize,
    pub w_m: f64,
    pub theta_x_rad: f64,
    pub theta_y_rad: f64,
    pub reaction_fz_kn: f64,
    pub reaction_mx_knm: f64,
    pub reaction_my_knm: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementResult {
    pub triangle_id: usize,
    /// [m_x, m_y, m_xy] at the centroid, in kN m / m.
    pub moment_knm_per_m: [f64; 3],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultBending {
    pub nodes: Vec<NodeResult>,
    pub elements: Vec<ElementResult>,
    pub relative_residual: f64,
}

#[derive(Clone, Copy)]
struct Side {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    e: f64,
}

fn side(i: &Node, j: &Node) -> Side {
    let dx = i.x - j.x;
    let dy = i.y - j.y;
    let l2 = dx * dx + dy * dy;
    Side {
        a: -dx / l2,
        b: 0.75 * dx * dy / l2,
        c: (0.25 * dx * dx - 0.5 * dy * dy) / l2,
        d: -dy / l2,
        e: (0.25 * dy * dy - 0.5 * dx * dx) / l2,
    }
}

fn twice_area(nodes: [&Node; 3]) -> f64 {
    (nodes[1].x - nodes[0].x) * (nodes[2].y - nodes[0].y)
        - (nodes[2].x - nodes[0].x) * (nodes[1].y - nodes[0].y)
}

/// Curvature-displacement matrix evaluated at barycentric coordinates.
pub fn b_matrix(nodes: [&Node; 3], l: [f64; 3]) -> Result<[[f64; 9]; 3], String> {
    let area2 = twice_area(nodes);
    if !area2.is_finite() || area2.abs() < 1e-12 {
        return Err("DKT triangle has zero area".into());
    }
    let mut hx = [[0.0; 9]; 3];
    let mut hy = [[0.0; 9]; 3];
    for i in 0..3 {
        hx[i][3 * i + 2] += 4.0 * l[i] - 1.0;
        hy[i][3 * i + 1] -= 4.0 * l[i] - 1.0;
    }
    for (i, j) in [(0, 1), (1, 2), (2, 0)] {
        let s = side(nodes[i], nodes[j]);
        for (direction, derivative) in [(i, 4.0 * l[j]), (j, 4.0 * l[i])] {
            hx[direction][3 * i] -= 1.5 * s.a * derivative;
            hx[direction][3 * j] += 1.5 * s.a * derivative;
            hx[direction][3 * i + 1] += s.b * derivative;
            hx[direction][3 * j + 1] += s.b * derivative;
            hx[direction][3 * i + 2] -= s.c * derivative;
            hx[direction][3 * j + 2] -= s.c * derivative;
            hy[direction][3 * i] -= 1.5 * s.d * derivative;
            hy[direction][3 * j] += 1.5 * s.d * derivative;
            hy[direction][3 * i + 1] += s.e * derivative;
            hy[direction][3 * j + 1] += s.e * derivative;
            hy[direction][3 * i + 2] -= s.b * derivative;
            hy[direction][3 * j + 2] -= s.b * derivative;
        }
    }
    let dx = [
        (nodes[1].y - nodes[2].y) / area2,
        (nodes[2].y - nodes[0].y) / area2,
        (nodes[0].y - nodes[1].y) / area2,
    ];
    let dy = [
        (nodes[2].x - nodes[1].x) / area2,
        (nodes[0].x - nodes[2].x) / area2,
        (nodes[1].x - nodes[0].x) / area2,
    ];
    Ok(std::array::from_fn(|row| {
        std::array::from_fn(|dof| match row {
            0 => (0..3).map(|i| dx[i] * hx[i][dof]).sum(),
            1 => (0..3).map(|i| dy[i] * hy[i][dof]).sum(),
            _ => (0..3)
                .map(|i| dy[i] * hx[i][dof] + dx[i] * hy[i][dof])
                .sum(),
        })
    }))
}

fn rigidity(material: &Material, thickness: f64) -> [[f64; 3]; 3] {
    let factor =
        material.e_mpa * 1000.0 * thickness.powi(3) / (12.0 * (1.0 - material.nu * material.nu));
    [
        [factor, factor * material.nu, 0.0],
        [factor * material.nu, factor, 0.0],
        [0.0, 0.0, factor * (1.0 - material.nu) / 2.0],
    ]
}

pub fn element_stiffness(
    nodes: [&Node; 3],
    material: &Material,
    thickness: f64,
) -> Result<[[f64; 9]; 9], String> {
    positive(thickness, "DKT plate thickness")?;
    let area = twice_area(nodes).abs() / 2.0;
    if !area.is_finite() || area < 1e-12 {
        return Err("DKT triangle has zero area".into());
    }
    let d = rigidity(material, thickness);
    let mut k = [[0.0; 9]; 9];
    for gp in [
        [2.0 / 3.0, 1.0 / 6.0, 1.0 / 6.0],
        [1.0 / 6.0, 2.0 / 3.0, 1.0 / 6.0],
        [1.0 / 6.0, 1.0 / 6.0, 2.0 / 3.0],
    ] {
        let b = b_matrix(nodes, gp)?;
        for i in 0..9 {
            for j in 0..9 {
                k[i][j] += area / 3.0
                    * (0..3)
                        .flat_map(|a| (0..3).map(move |c| b[a][i] * d[a][c] * b[c][j]))
                        .sum::<f64>();
            }
        }
    }
    Ok(k)
}

pub fn solve(request: &Request) -> Result<ResultBending, String> {
    if request.nodes.len() < 3 || request.triangles.is_empty() {
        return Err("DKT plate requires nodes and triangles".into());
    }
    let node_index: HashMap<usize, usize> = request
        .nodes
        .iter()
        .enumerate()
        .map(|(i, node)| (node.id, i))
        .collect();
    if node_index.len() != request.nodes.len() {
        return Err("duplicate DKT node id".into());
    }
    if request
        .nodes
        .iter()
        .any(|node| !node.x.is_finite() || !node.y.is_finite())
    {
        return Err("non-finite DKT coordinate".into());
    }
    let materials: HashMap<usize, &Material> =
        request.materials.iter().map(|m| (m.id, m)).collect();
    if materials.len() != request.materials.len() {
        return Err("duplicate DKT material id".into());
    }
    for material in &request.materials {
        positive(material.e_mpa, "DKT E")?;
        if !material.nu.is_finite() || material.nu <= -1.0 || material.nu >= 0.5 {
            return Err("invalid DKT Poisson ratio".into());
        }
    }
    let mut element_ids = HashSet::new();
    let mut k = Matrix::zeros(3 * request.nodes.len())?;
    for triangle in &request.triangles {
        if !element_ids.insert(triangle.id) {
            return Err("duplicate DKT triangle id".into());
        }
        let ids = triangle.node_ids.map(|id| {
            node_index
                .get(&id)
                .copied()
                .ok_or("unknown DKT triangle node")
        });
        let ids = [ids[0]?, ids[1]?, ids[2]?];
        if ids[0] == ids[1] || ids[1] == ids[2] || ids[2] == ids[0] {
            return Err("DKT triangle repeats a node".into());
        }
        let material = materials
            .get(&triangle.material_id)
            .ok_or("unknown DKT material")?;
        let ke = element_stiffness(
            ids.map(|i| &request.nodes[i]),
            material,
            triangle.thickness_m,
        )?;
        for i in 0..9 {
            for j in 0..9 {
                k.add(3 * ids[i / 3] + i % 3, 3 * ids[j / 3] + j % 3, ke[i][j]);
            }
        }
    }
    let mut prescribed = vec![None; k.n];
    for support in &request.supports {
        let index = *node_index
            .get(&support.node_id)
            .ok_or("unknown DKT support node")?;
        for (axis, fixed) in [support.w, support.theta_x, support.theta_y]
            .iter()
            .enumerate()
        {
            if *fixed {
                prescribed[3 * index + axis] = Some(0.0);
            }
        }
    }
    let mut f = vec![0.0; k.n];
    for load in &request.loads {
        let index = *node_index
            .get(&load.node_id)
            .ok_or("unknown DKT load node")?;
        for (axis, value) in [load.fz, load.mx, load.my].iter().enumerate() {
            f[3 * index + axis] += value;
        }
    }
    let (u, reaction) = constrained_solve(&k, &f, &prescribed)?;
    let relative_residual = reaction
        .iter()
        .enumerate()
        .filter(|(i, _)| prescribed[*i].is_none())
        .map(|(_, value)| value * value)
        .sum::<f64>()
        .sqrt()
        / f.iter()
            .map(|value| value * value)
            .sum::<f64>()
            .sqrt()
            .max(1.0);
    let nodes = request
        .nodes
        .iter()
        .enumerate()
        .map(|(i, node)| NodeResult {
            node_id: node.id,
            w_m: u[3 * i],
            theta_x_rad: u[3 * i + 1],
            theta_y_rad: u[3 * i + 2],
            reaction_fz_kn: if prescribed[3 * i].is_some() {
                reaction[3 * i]
            } else {
                0.0
            },
            reaction_mx_knm: if prescribed[3 * i + 1].is_some() {
                reaction[3 * i + 1]
            } else {
                0.0
            },
            reaction_my_knm: if prescribed[3 * i + 2].is_some() {
                reaction[3 * i + 2]
            } else {
                0.0
            },
        })
        .collect();
    let mut elements = Vec::with_capacity(request.triangles.len());
    for triangle in &request.triangles {
        let indices = triangle.node_ids.map(|id| node_index[&id]);
        let local_u: [f64; 9] = std::array::from_fn(|dof| u[3 * indices[dof / 3] + dof % 3]);
        let b = b_matrix(indices.map(|i| &request.nodes[i]), [1.0 / 3.0; 3])?;
        let curvature: [f64; 3] =
            std::array::from_fn(|a| (0..9).map(|j| b[a][j] * local_u[j]).sum());
        let material = materials[&triangle.material_id];
        let d = rigidity(material, triangle.thickness_m);
        let moment_knm_per_m =
            std::array::from_fn(|a| (0..3).map(|c| d[a][c] * curvature[c]).sum());
        elements.push(ElementResult {
            triangle_id: triangle.id,
            moment_knm_per_m,
        });
    }
    Ok(ResultBending {
        nodes,
        elements,
        relative_residual,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rigid_body_modes_have_zero_element_force() {
        let nodes = [
            Node {
                id: 1,
                x: 0.1,
                y: 0.2,
            },
            Node {
                id: 2,
                x: 1.3,
                y: 0.4,
            },
            Node {
                id: 3,
                x: 0.5,
                y: 1.1,
            },
        ];
        let material = Material {
            id: 1,
            e_mpa: 210_000.0,
            nu: 0.3,
        };
        let k = element_stiffness([&nodes[0], &nodes[1], &nodes[2]], &material, 0.02).unwrap();
        for mode in 0..3 {
            let u: [f64; 9] = std::array::from_fn(|dof| {
                let node = &nodes[dof / 3];
                match (mode, dof % 3) {
                    (0, 0) => 1.0,
                    (1, 0) => node.y,
                    (1, 1) => -1.0,
                    (2, 0) => node.x,
                    (2, 2) => 1.0,
                    _ => 0.0,
                }
            });
            let force: [f64; 9] = std::array::from_fn(|i| (0..9).map(|j| k[i][j] * u[j]).sum());
            assert!(force.iter().all(|value| value.abs() < 1e-8));
        }
    }

    #[test]
    fn bending_patch_has_correct_moment_ratio() {
        let nodes = [
            Node {
                id: 1,
                x: 0.0,
                y: 0.0,
            },
            Node {
                id: 2,
                x: 1.0,
                y: 0.0,
            },
            Node {
                id: 3,
                x: 0.0,
                y: 1.0,
            },
        ];
        let material = Material {
            id: 1,
            e_mpa: 210_000.0,
            nu: 0.3,
        };
        let b = b_matrix([&nodes[0], &nodes[1], &nodes[2]], [1.0 / 3.0; 3]).unwrap();
        let u: [f64; 9] = std::array::from_fn(|dof| {
            let x = nodes[dof / 3].x;
            match dof % 3 {
                0 => 0.5e-3 * x * x,
                1 => 0.0,
                _ => 1e-3 * x,
            }
        });
        let curvature: [f64; 3] = std::array::from_fn(|a| (0..9).map(|i| b[a][i] * u[i]).sum());
        let d = rigidity(&material, 0.02);
        let moment: [f64; 3] =
            std::array::from_fn(|a| (0..3).map(|i| d[a][i] * curvature[i]).sum());
        assert!((moment[1] / moment[0] - 0.3).abs() < 1e-3);
        assert!(moment[0] > 0.0);
    }

    #[test]
    fn reversed_triangle_order_keeps_stiffness() {
        let nodes = [
            Node {
                id: 1,
                x: 0.0,
                y: 0.0,
            },
            Node {
                id: 2,
                x: 1.2,
                y: 0.1,
            },
            Node {
                id: 3,
                x: 0.2,
                y: 0.9,
            },
        ];
        let material = Material {
            id: 1,
            e_mpa: 210_000.0,
            nu: 0.3,
        };
        let original =
            element_stiffness([&nodes[0], &nodes[1], &nodes[2]], &material, 0.02).unwrap();
        let reversed =
            element_stiffness([&nodes[0], &nodes[2], &nodes[1]], &material, 0.02).unwrap();
        let mapping = [0, 1, 2, 6, 7, 8, 3, 4, 5];
        for i in 0..9 {
            for j in 0..9 {
                let tolerance = original[i][j].abs().max(1.0) * 1e-10;
                assert!((original[i][j] - reversed[mapping[i]][mapping[j]]).abs() < tolerance);
            }
        }
    }
}
