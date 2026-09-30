//! Four-node 17-parameter hybrid Kirchhoff plate bending element.
//! The boundary has cubic Hermite deflection and linear normal slope;
//! an independent quadratic, self-equilibrated moment field is eliminated
//! through complementary energy. DOFs: [w, theta_x=-w,y, theta_y=w,x].

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::math::{constrained_solve, Matrix};
use crate::plate_bending::{Load, Material, Node, NodeResult, Support};
use crate::positive;
use crate::quad2d::{ModulusCurve, Quad};

const NGAUSS: usize = 4;
const ROOTS: [f64; NGAUSS] = [
    -0.861_136_311_594_052_6,
    -0.339_981_043_584_856_3,
    0.339_981_043_584_856_3,
    0.861_136_311_594_052_6,
];
const WEIGHTS: [f64; NGAUSS] = [
    0.347_854_845_137_453_85,
    0.652_145_154_862_546_1,
    0.652_145_154_862_546_1,
    0.347_854_845_137_453_85,
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub nodes: Vec<Node>,
    pub materials: Vec<Material>,
    pub quads: Vec<Quad>,
    #[serde(default)]
    pub supports: Vec<Support>,
    #[serde(default)]
    pub loads: Vec<Load>,
    #[serde(default)]
    pub pressure_kn_m2: f64,
    #[serde(default)]
    pub modulus_curves: Vec<ModulusCurve>,
    #[serde(default)]
    pub load_path: Vec<f64>,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
    #[serde(default = "default_iterations")]
    pub max_iterations: usize,
}

fn default_tolerance() -> f64 {
    1e-7
}
fn default_iterations() -> usize {
    40
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementResult {
    pub quad_id: usize,
    /// [m_x, m_y, m_xy] in kN m per m at element centre.
    pub moment_knm_per_m: [f64; 3],
    /// [v_x, v_y] in kN per m at element centre from moment derivatives.
    pub shear_kn_per_m: [f64; 2],
    pub effective_e_mpa: f64,
    pub max_fibre_strain: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultBending {
    pub nodes: Vec<NodeResult>,
    pub elements: Vec<ElementResult>,
    pub iterations: usize,
    pub relative_residual: f64,
}

#[derive(Clone, Copy)]
struct Field {
    moment: [f64; 3],
    divergence: [f64; 2],
}

/// The 18 quadratic coefficients have one equilibrium constraint:
/// m_x,xx + 2 m_xy,xy + m_y,yy = 0. Eliminate the y² term in m_y.
fn fields(x: f64, y: f64, scale: f64) -> [Field; 17] {
    let p = [1.0, x, y, x * x, x * y, y * y];
    let px = [0.0, 1.0, 0.0, 2.0 * x, y, 0.0];
    let py = [0.0, 0.0, 1.0, 0.0, x, 2.0 * y];
    std::array::from_fn(|index| {
        let mut mx = [0.0; 3];
        let mut dx = [0.0; 2];
        if index < 6 {
            mx[0] = p[index];
            dx[0] = px[index];
            if index == 3 {
                mx[1] = -y * y;
                dx[1] = -2.0 * y;
            }
        } else if index < 11 {
            let j = index - 6;
            mx[1] = p[j];
            dx[1] = py[j];
        } else {
            let j = index - 11;
            mx[2] = p[j];
            dx[0] = py[j];
            dx[1] = px[j];
            if j == 4 {
                mx[1] = -y * y;
                dx[1] -= 2.0 * y;
            }
        }
        Field {
            moment: mx,
            divergence: dx.map(|v| v / scale),
        }
    })
}

fn shape(xi: f64, eta: f64) -> ([f64; 4], [f64; 4], [f64; 4]) {
    let n = [
        0.25 * (1.0 - xi) * (1.0 - eta),
        0.25 * (1.0 + xi) * (1.0 - eta),
        0.25 * (1.0 + xi) * (1.0 + eta),
        0.25 * (1.0 - xi) * (1.0 + eta),
    ];
    let nx = [
        -0.25 * (1.0 - eta),
        0.25 * (1.0 - eta),
        0.25 * (1.0 + eta),
        -0.25 * (1.0 + eta),
    ];
    let ny = [
        -0.25 * (1.0 - xi),
        -0.25 * (1.0 + xi),
        0.25 * (1.0 + xi),
        0.25 * (1.0 - xi),
    ];
    (n, nx, ny)
}

fn geometry(nodes: [&Node; 4], xi: f64, eta: f64) -> Result<(f64, f64, f64), String> {
    let (n, nx, ny) = shape(xi, eta);
    let x = (0..4).map(|i| n[i] * nodes[i].x).sum();
    let y = (0..4).map(|i| n[i] * nodes[i].y).sum();
    let xx: f64 = (0..4).map(|i| nx[i] * nodes[i].x).sum();
    let xy: f64 = (0..4).map(|i| nx[i] * nodes[i].y).sum();
    let yx: f64 = (0..4).map(|i| ny[i] * nodes[i].x).sum();
    let yy: f64 = (0..4).map(|i| ny[i] * nodes[i].y).sum();
    let det = xx * yy - xy * yx;
    if !det.is_finite() || det <= 1e-12 {
        return Err("hybrid quad has non-positive Jacobian".into());
    }
    Ok((x, y, det))
}

fn edge_kinematics(
    dof: usize,
    a: usize,
    b: usize,
    s: f64,
    length: f64,
    tangent: [f64; 2],
    normal: [f64; 2],
) -> (f64, [f64; 2]) {
    let h = [
        2.0 * s.powi(3) - 3.0 * s * s + 1.0,
        s.powi(3) - 2.0 * s * s + s,
        -2.0 * s.powi(3) + 3.0 * s * s,
        s.powi(3) - s * s,
    ];
    let dh = [
        6.0 * s * s - 6.0 * s,
        3.0 * s * s - 4.0 * s + 1.0,
        -6.0 * s * s + 6.0 * s,
        3.0 * s * s - 2.0 * s,
    ];
    let wa = f64::from(dof == 3 * a);
    let wb = f64::from(dof == 3 * b);
    let slope = |node: usize, vector: [f64; 2]| -> f64 {
        let theta_x = f64::from(dof == 3 * node + 1);
        let theta_y = f64::from(dof == 3 * node + 2);
        theta_y * vector[0] - theta_x * vector[1]
    };
    let ta = slope(a, tangent);
    let tb = slope(b, tangent);
    let na = slope(a, normal);
    let nb = slope(b, normal);
    let w = h[0] * wa + h[1] * length * ta + h[2] * wb + h[3] * length * tb;
    let dt = (dh[0] * wa + dh[2] * wb) / length + dh[1] * ta + dh[3] * tb;
    let dn = (1.0 - s) * na + s * nb;
    (
        w,
        [
            dt * tangent[0] + dn * normal[0],
            dt * tangent[1] + dn * normal[1],
        ],
    )
}

struct HybridElement {
    id: usize,
    dofs: [usize; 12],
    base_k: [[f64; 12]; 12],
    /// Moment coefficients for unit E (MPa) times the nodal displacement.
    beta: [[f64; 12]; 17],
    centre: [f64; 2],
    scale: f64,
    area: f64,
    sample_points: Vec<[f64; 2]>,
    thickness: f64,
    material_id: usize,
    base_e: f64,
    nu: f64,
}

fn element(
    quad: &Quad,
    nodes: [&Node; 4],
    dofs: [usize; 12],
    material: &Material,
) -> Result<HybridElement, String> {
    positive(quad.thickness_m, "hybrid plate thickness")?;
    positive(material.e_mpa, "hybrid plate E")?;
    if !material.nu.is_finite() || material.nu <= -1.0 || material.nu >= 0.5 {
        return Err("invalid hybrid plate Poisson ratio".into());
    }
    let centre = [
        nodes.iter().map(|n| n.x).sum::<f64>() / 4.0,
        nodes.iter().map(|n| n.y).sum::<f64>() / 4.0,
    ];
    let scale = nodes
        .iter()
        .map(|n| (n.x - centre[0]).abs().max((n.y - centre[1]).abs()))
        .fold(0.0_f64, f64::max)
        * 2.0;
    positive(scale, "hybrid plate size")?;
    let mut h = Matrix::zeros(17)?;
    let mut g = [[0.0; 12]; 17];
    let mut area = 0.0;
    let mut sample_points: Vec<[f64; 2]> = nodes.iter().map(|n| [n.x, n.y]).collect();
    let d = 1000.0 * quad.thickness_m.powi(3) / (12.0 * (1.0 - material.nu * material.nu)); // E=1 MPa
    for i in 0..NGAUSS {
        for j in 0..NGAUSS {
            let (x, y, jac) = geometry(nodes, ROOTS[i], ROOTS[j])?;
            sample_points.push([x, y]);
            let weight = WEIGHTS[i] * WEIGHTS[j] * jac;
            area += weight;
            let fs = fields((x - centre[0]) / scale, (y - centre[1]) / scale, scale);
            for a in 0..17 {
                for b in 0..17 {
                    let ma = fs[a].moment;
                    let mb = fs[b].moment;
                    let compliance = (ma[0] * (mb[0] - material.nu * mb[1])
                        + ma[1] * (mb[1] - material.nu * mb[0]))
                        / (d * (1.0 - material.nu * material.nu))
                        + ma[2] * mb[2] * 2.0 / (d * (1.0 - material.nu));
                    h.add(a, b, weight * compliance);
                }
            }
        }
    }
    for (a, b) in [(0, 1), (1, 2), (2, 3), (3, 0)] {
        let dx = nodes[b].x - nodes[a].x;
        let dy = nodes[b].y - nodes[a].y;
        let length = (dx * dx + dy * dy).sqrt();
        positive(length, "hybrid plate edge")?;
        let tangent = [dx / length, dy / length];
        let normal = [tangent[1], -tangent[0]];
        for q in 0..NGAUSS {
            let s = 0.5 * (ROOTS[q] + 1.0);
            let x = nodes[a].x + s * dx;
            let y = nodes[a].y + s * dy;
            let fs = fields((x - centre[0]) / scale, (y - centre[1]) / scale, scale);
            let weight = length * WEIGHTS[q] * 0.5;
            for dof in 0..12 {
                let (w, gradient) = edge_kinematics(dof, a, b, s, length, tangent, normal);
                for k in 0..17 {
                    let m = fs[k].moment;
                    let traction = [
                        m[0] * normal[0] + m[2] * normal[1],
                        m[2] * normal[0] + m[1] * normal[1],
                    ];
                    g[k][dof] += weight
                        * (traction[0] * gradient[0] + traction[1] * gradient[1]
                            - (fs[k].divergence[0] * normal[0] + fs[k].divergence[1] * normal[1])
                                * w);
                }
            }
        }
    }
    let mut beta = [[0.0; 12]; 17];
    let free = [None; 17];
    for dof in 0..12 {
        let rhs: [f64; 17] = std::array::from_fn(|i| g[i][dof]);
        let solution = constrained_solve(&h, &rhs, &free)?.0;
        for i in 0..17 {
            beta[i][dof] = solution[i];
        }
    }
    let base_k = std::array::from_fn(|i| {
        std::array::from_fn(|j| (0..17).map(|a| g[a][i] * beta[a][j]).sum())
    });
    Ok(HybridElement {
        id: quad.id,
        dofs,
        base_k,
        beta,
        centre,
        scale,
        area,
        sample_points,
        thickness: quad.thickness_m,
        material_id: quad.material_id,
        base_e: material.e_mpa,
        nu: material.nu,
    })
}

fn moment(
    element: &HybridElement,
    local: &[f64; 12],
    e_mpa: f64,
    x: f64,
    y: f64,
) -> ([f64; 3], [f64; 2]) {
    let fs = fields(
        (x - element.centre[0]) / element.scale,
        (y - element.centre[1]) / element.scale,
        element.scale,
    );
    let mut m = [0.0; 3];
    let mut v = [0.0; 2];
    for a in 0..17 {
        let coefficient = e_mpa * (0..12).map(|j| element.beta[a][j] * local[j]).sum::<f64>();
        for i in 0..3 {
            m[i] += coefficient * fs[a].moment[i];
        }
        for i in 0..2 {
            v[i] += coefficient * fs[a].divergence[i];
        }
    }
    (m, v)
}

fn max_fibre_strain(element: &HybridElement, local: &[f64; 12], e_mpa: f64) -> f64 {
    let mut maximum = 0.0_f64;
    let d = e_mpa * 1000.0 * element.thickness.powi(3) / (12.0 * (1.0 - element.nu * element.nu));
    for [x, y] in &element.sample_points {
        let (m, _) = moment(element, local, e_mpa, *x, *y);
        let kx = (m[0] - element.nu * m[1]) / (d * (1.0 - element.nu * element.nu));
        let ky = (m[1] - element.nu * m[0]) / (d * (1.0 - element.nu * element.nu));
        let kxy = m[2] / (d * (1.0 - element.nu));
        let centre = 0.5 * (kx + ky);
        let radius = ((0.5 * (kx - ky)).powi(2) + kxy * kxy).sqrt();
        maximum = maximum.max((centre.abs() + radius) * element.thickness * 0.5);
    }
    maximum
}

pub fn solve(request: &Request) -> Result<ResultBending, String> {
    if request.nodes.len() < 4 || request.quads.is_empty() {
        return Err("hybrid plate requires quads".into());
    }
    if !request.pressure_kn_m2.is_finite() {
        return Err("non-finite plate pressure".into());
    }
    positive(request.tolerance, "hybrid tolerance")?;
    if request.max_iterations == 0 || request.max_iterations > 200 {
        return Err("invalid hybrid iteration limit".into());
    }
    let node_index: HashMap<usize, usize> = request
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id, i))
        .collect();
    if node_index.len() != request.nodes.len() || request.nodes.len() * 3 > 600 {
        return Err("duplicate nodes or 600-DOF hybrid limit exceeded".into());
    }
    if request
        .nodes
        .iter()
        .any(|n| !n.x.is_finite() || !n.y.is_finite())
    {
        return Err("non-finite plate node".into());
    }
    let materials: HashMap<usize, &Material> =
        request.materials.iter().map(|m| (m.id, m)).collect();
    if materials.len() != request.materials.len() {
        return Err("duplicate plate material".into());
    }
    let mut curves = HashMap::new();
    for curve in &request.modulus_curves {
        let material = materials
            .get(&curve.material_id)
            .ok_or("unknown plate modulus material")?;
        if curves.insert(curve.material_id, curve).is_some() {
            return Err("duplicate plate modulus curve".into());
        }
        if curve.points.len() < 2
            || curve.points[0].strain != 0.0
            || (curve.points[0].e_mpa - material.e_mpa).abs() > material.e_mpa * 1e-10
        {
            return Err("plate modulus curve must start at zero strain and material E".into());
        }
        for point in &curve.points {
            positive(point.e_mpa, "plate modulus E")?;
            if !point.strain.is_finite() || point.strain < 0.0 {
                return Err("invalid plate modulus strain".into());
            }
        }
        if curve
            .points
            .windows(2)
            .any(|p| p[1].strain <= p[0].strain || p[1].e_mpa > p[0].e_mpa)
        {
            return Err("plate modulus strain must increase and E must not increase".into());
        }
    }
    let mut ids = HashSet::new();
    let mut elements = Vec::with_capacity(request.quads.len());
    for quad in &request.quads {
        if !ids.insert(quad.id) {
            return Err("duplicate hybrid quad id".into());
        }
        let indices = quad.node_ids.map(|id| {
            node_index
                .get(&id)
                .copied()
                .ok_or("unknown hybrid quad node")
        });
        let indices = [indices[0]?, indices[1]?, indices[2]?, indices[3]?];
        if indices.iter().copied().collect::<HashSet<_>>().len() != 4 {
            return Err("hybrid quad repeats node".into());
        }
        let material = materials
            .get(&quad.material_id)
            .ok_or("unknown hybrid quad material")?;
        elements.push(element(
            quad,
            indices.map(|i| &request.nodes[i]),
            std::array::from_fn(|j| 3 * indices[j / 3] + j % 3),
            material,
        )?);
    }
    let dofs = 3 * request.nodes.len();
    let mut prescribed = vec![None; dofs];
    for support in &request.supports {
        let i = *node_index
            .get(&support.node_id)
            .ok_or("unknown hybrid support node")?;
        for (offset, active) in [support.w, support.theta_x, support.theta_y]
            .into_iter()
            .enumerate()
        {
            if active {
                prescribed[3 * i + offset] = Some(0.0);
            }
        }
    }
    let mut load = vec![0.0; dofs];
    for node_load in &request.loads {
        let i = *node_index
            .get(&node_load.node_id)
            .ok_or("unknown hybrid load node")?;
        load[3 * i] += node_load.fz;
        load[3 * i + 1] += node_load.mx;
        load[3 * i + 2] += node_load.my;
    }
    for element in &elements {
        for j in 0..4 {
            load[element.dofs[3 * j]] += request.pressure_kn_m2 * element.area / 4.0;
        }
    }
    let scale = load.iter().map(|f| f * f).sum::<f64>().sqrt().max(1.0);
    let path = if request.load_path.is_empty() {
        vec![1.0]
    } else {
        request.load_path.clone()
    };
    if path.iter().any(|x| !x.is_finite()) {
        return Err("non-finite hybrid load path".into());
    }
    let mut u = vec![0.0; dofs];
    let mut peak = vec![0.0_f64; elements.len()];
    let mut e_current: Vec<f64> = elements.iter().map(|e| e.base_e).collect();
    let mut iterations = 0;
    let mut start = 0.0;
    let steps = if curves.is_empty() { 1 } else { 10 };
    for &end in &path {
        for step in 1..=steps {
            let factor = start + (end - start) * step as f64 / steps as f64;
            let mut converged = false;
            for _ in 0..request.max_iterations {
                iterations += 1;
                let mut k = Matrix::zeros(dofs)?;
                for (index, element) in elements.iter().enumerate() {
                    for i in 0..12 {
                        for j in 0..12 {
                            k.add(
                                element.dofs[i],
                                element.dofs[j],
                                e_current[index] * element.base_k[i][j],
                            );
                        }
                    }
                }
                let target: Vec<f64> = load.iter().map(|f| factor * f).collect();
                let (candidate, _) = constrained_solve(&k, &target, &prescribed)?;
                let mut next_e = e_current.clone();
                for (index, element) in elements.iter().enumerate() {
                    if let Some(curve) = curves.get(&element.material_id) {
                        let local = element.dofs.map(|j| candidate[j]);
                        let strain = max_fibre_strain(element, &local, e_current[index]);
                        next_e[index] = curve.e_at(peak[index].max(strain));
                    }
                }
                let change = next_e
                    .iter()
                    .zip(&e_current)
                    .map(|(a, b)| (a - b).abs() / b)
                    .fold(0.0_f64, f64::max);
                u = candidate;
                e_current = next_e;
                if change < request.tolerance {
                    converged = true;
                    break;
                }
            }
            if !converged {
                return Err("hybrid material iteration did not converge".into());
            }
            for (index, element) in elements.iter().enumerate() {
                if curves.contains_key(&element.material_id) {
                    let local = element.dofs.map(|j| u[j]);
                    peak[index] =
                        peak[index].max(max_fibre_strain(element, &local, e_current[index]));
                }
            }
        }
        start = end;
    }
    let mut internal = vec![0.0; dofs];
    for (index, element) in elements.iter().enumerate() {
        for i in 0..12 {
            internal[element.dofs[i]] += e_current[index]
                * (0..12)
                    .map(|j| element.base_k[i][j] * u[element.dofs[j]])
                    .sum::<f64>();
        }
    }
    let residual: Vec<f64> = internal
        .iter()
        .zip(&load)
        .map(|(a, b)| a - end_factor(&path) * b)
        .collect();
    let relative_residual = residual
        .iter()
        .enumerate()
        .filter(|(i, _)| prescribed[*i].is_none())
        .map(|(_, v)| v * v)
        .sum::<f64>()
        .sqrt()
        / scale;
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
                residual[3 * i]
            } else {
                0.0
            },
            reaction_mx_knm: if prescribed[3 * i + 1].is_some() {
                residual[3 * i + 1]
            } else {
                0.0
            },
            reaction_my_knm: if prescribed[3 * i + 2].is_some() {
                residual[3 * i + 2]
            } else {
                0.0
            },
        })
        .collect();
    let elements = elements
        .iter()
        .enumerate()
        .map(|(i, element)| {
            let local = element.dofs.map(|j| u[j]);
            let (moment, shear) = moment(
                element,
                &local,
                e_current[i],
                element.centre[0],
                element.centre[1],
            );
            ElementResult {
                quad_id: element.id,
                moment_knm_per_m: moment,
                shear_kn_per_m: shear,
                effective_e_mpa: e_current[i],
                max_fibre_strain: peak[i],
            }
        })
        .collect();
    Ok(ResultBending {
        nodes,
        elements,
        iterations,
        relative_residual,
    })
}

fn end_factor(path: &[f64]) -> f64 {
    *path.last().unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn square_element() -> HybridElement {
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
                x: 1.0,
                y: 1.0,
            },
            Node {
                id: 4,
                x: 0.0,
                y: 1.0,
            },
        ];
        element(
            &Quad {
                id: 1,
                node_ids: [1, 2, 3, 4],
                material_id: 1,
                thickness_m: 0.1,
            },
            [&nodes[0], &nodes[1], &nodes[2], &nodes[3]],
            std::array::from_fn(|i| i),
            &Material {
                id: 1,
                e_mpa: 30_000.0,
                nu: 0.2,
            },
        )
        .unwrap()
    }
    #[test]
    fn rigid_body_modes_have_zero_energy() {
        let e = square_element();
        for u in [
            [1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0],
            [
                0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 1.0, -1.0, 0.0, 1.0, -1.0, 0.0,
            ],
        ] {
            let force: Vec<f64> = (0..12)
                .map(|i| (0..12).map(|j| e.base_k[i][j] * u[j]).sum::<f64>())
                .collect();
            assert!(force.iter().all(|v| v.abs() < 1e-7), "{force:?}");
        }
    }
    #[test]
    fn constant_curvature_recovers_plate_constitutive_moments() {
        let e = square_element();
        let kappa = 0.001;
        let u = [
            0.0,
            0.0,
            0.0,
            0.5 * kappa,
            0.0,
            kappa,
            0.5 * kappa,
            0.0,
            kappa,
            0.0,
            0.0,
            0.0,
        ];
        let (moment, shear) = moment(&e, &u, 30_000.0, 0.5, 0.5);
        let d = 30_000.0 * 1000.0 * 0.1_f64.powi(3) / (12.0 * (1.0 - 0.2_f64.powi(2)));
        assert!(
            (moment[0] - d * kappa).abs() < d * kappa * 1e-8,
            "{moment:?}"
        );
        assert!((moment[1] - d * 0.2 * kappa).abs() < d * kappa * 1e-8);
        assert!(moment[2].abs() < 1e-8);
        assert!(shear.iter().all(|v| v.abs() < 1e-8), "{shear:?}");
    }

    fn cantilever_request(curve: bool) -> Request {
        let mesh = crate::quad2d::mesh_squares(&crate::quad2d::SquareGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.0,
            height_m: 1.0,
            cell_size_m: 1.0,
            material_id: 1,
            thickness_m: 0.2,
        })
        .unwrap();
        Request {
            nodes: mesh
                .nodes
                .into_iter()
                .map(|n| Node {
                    id: n.id,
                    x: n.x,
                    y: n.y,
                })
                .collect(),
            quads: mesh.quads,
            materials: vec![Material {
                id: 1,
                e_mpa: 30_000.0,
                nu: 0.0,
            }],
            supports: mesh
                .left_node_ids
                .into_iter()
                .map(|node_id| Support {
                    node_id,
                    w: true,
                    theta_x: true,
                    theta_y: true,
                })
                .collect(),
            loads: vec![],
            pressure_kn_m2: -1.0,
            modulus_curves: if curve {
                vec![ModulusCurve {
                    material_id: 1,
                    points: vec![
                        crate::quad2d::ModulusPoint {
                            strain: 0.0,
                            e_mpa: 30_000.0,
                        },
                        crate::quad2d::ModulusPoint {
                            strain: 0.00001,
                            e_mpa: 25_000.0,
                        },
                    ],
                }]
            } else {
                vec![]
            },
            load_path: vec![],
            tolerance: 1e-8,
            max_iterations: 40,
        }
    }
    #[test]
    fn cantilever_pressure_balances_reactions() {
        let result = solve(&cantilever_request(false)).unwrap();
        assert!(result.nodes[2].w_m < 0.0);
        let reactions: f64 = result.nodes.iter().map(|n| n.reaction_fz_kn).sum();
        assert!((reactions - 2.0).abs() < 1e-8);
        assert!(result.relative_residual < 1e-8);
    }
    #[test]
    fn bending_secant_modulus_softens_and_persists_on_unload() {
        let linear = solve(&cantilever_request(false)).unwrap();
        let mut request = cantilever_request(true);
        let nonlinear = solve(&request).unwrap();
        assert!(nonlinear.nodes[2].w_m < linear.nodes[2].w_m);
        assert!(nonlinear
            .elements
            .iter()
            .all(|e| e.effective_e_mpa < 30_000.0));
        request.load_path = vec![1.0, 0.0];
        let unloaded = solve(&request).unwrap();
        assert!(unloaded.nodes[2].w_m.abs() < 1e-9);
        assert!(unloaded
            .elements
            .iter()
            .all(|e| e.effective_e_mpa < 30_000.0));
        assert!(unloaded.relative_residual < 1e-8);
    }

    #[test]
    fn simply_supported_square_approaches_navier_deflection() {
        let n = 6;
        let mesh = crate::quad2d::mesh_squares(&crate::quad2d::SquareGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.0,
            height_m: 2.0,
            cell_size_m: 2.0 / n as f64,
            material_id: 1,
            thickness_m: 0.1,
        })
        .unwrap();
        let request = Request {
            nodes: mesh
                .nodes
                .into_iter()
                .map(|v| Node {
                    id: v.id,
                    x: v.x,
                    y: v.y,
                })
                .collect(),
            quads: mesh.quads,
            materials: vec![Material {
                id: 1,
                e_mpa: 30_000.0,
                nu: 0.2,
            }],
            supports: vec![],
            loads: vec![],
            pressure_kn_m2: -1.0,
            modulus_curves: vec![],
            load_path: vec![],
            tolerance: 1e-8,
            max_iterations: 40,
        };
        let mut request = request;
        request.supports = request
            .nodes
            .iter()
            .filter(|node| {
                node.x == 0.0
                    || node.y == 0.0
                    || (node.x - 2.0).abs() < 1e-12
                    || (node.y - 2.0).abs() < 1e-12
            })
            .map(|node| Support {
                node_id: node.id,
                w: true,
                theta_x: false,
                theta_y: false,
            })
            .collect();
        let result = solve(&request).unwrap();
        let centre_id = 1 + (n / 2) * (n + 1) + n / 2;
        let centre_w = result.nodes[centre_id - 1].w_m;
        let rigidity = 30_000.0 * 1000.0 * 0.1_f64.powi(3) / (12.0 * (1.0 - 0.2_f64.powi(2)));
        let navier = -0.00406 * 2.0_f64.powi(4) / rigidity;
        assert!(
            ((centre_w - navier) / navier).abs() < 0.05,
            "{centre_w} vs {navier}"
        );
        assert!(result.relative_residual < 1e-8);
    }
}
