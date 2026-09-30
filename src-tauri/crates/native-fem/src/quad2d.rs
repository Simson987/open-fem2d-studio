//! Four-node isoparametric plane-stress membrane with 2x2 Gauss integration.
//! Each integration point owns its own plastic/damage history.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::material2d::{self, State};
use crate::math::{constrained_solve, Matrix};
use crate::plate2d::{Load, Material, Node, NodeResult, Support};
use crate::{positive, Analysis, MaterialLaw};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Quad {
    pub id: usize,
    pub node_ids: [usize; 4],
    pub material_id: usize,
    pub thickness_m: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    #[serde(default)]
    pub analysis: Analysis,
    pub nodes: Vec<Node>,
    pub materials: Vec<Material>,
    #[serde(default)]
    pub modulus_curves: Vec<ModulusCurve>,
    pub quads: Vec<Quad>,
    #[serde(default)]
    pub supports: Vec<Support>,
    #[serde(default)]
    pub loads: Vec<Load>,
    #[serde(default)]
    pub load_path: Vec<f64>,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
    #[serde(default = "default_iterations")]
    pub max_iterations: usize,
}

/// Irreversible secant-modulus envelope, indexed by the largest absolute
/// in-plane principal strain reached at each Gauss point.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModulusCurve {
    pub material_id: usize,
    pub points: Vec<ModulusPoint>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModulusPoint {
    pub strain: f64,
    pub e_mpa: f64,
}

impl ModulusCurve {
    pub(crate) fn e_at(&self, strain: f64) -> f64 {
        for pair in self.points.windows(2) {
            if strain <= pair[1].strain {
                let t = (strain - pair[0].strain) / (pair[1].strain - pair[0].strain);
                return pair[0].e_mpa + t.clamp(0.0, 1.0) * (pair[1].e_mpa - pair[0].e_mpa);
            }
        }
        self.points.last().unwrap().e_mpa
    }
}
fn default_tolerance() -> f64 {
    1e-8
}
fn default_iterations() -> usize {
    40
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GaussResult {
    pub stress_mpa: [f64; 3],
    pub effective_e_mpa: f64,
    pub max_equivalent_strain: f64,
    pub equivalent_plastic_strain: f64,
    pub tensile_damage: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuadResult {
    pub quad_id: usize,
    pub average_strain: [f64; 3],
    pub average_stress_mpa: [f64; 3],
    pub gauss_points: [GaussResult; 4],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Result2D {
    pub nodes: Vec<NodeResult>,
    pub quads: Vec<QuadResult>,
    pub iterations: usize,
    pub relative_residual: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SquareGrid {
    pub origin_x: f64,
    pub origin_y: f64,
    pub width_m: f64,
    pub height_m: f64,
    pub cell_size_m: f64,
    pub material_id: usize,
    pub thickness_m: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SquareMesh {
    pub nodes: Vec<Node>,
    pub quads: Vec<Quad>,
    pub left_node_ids: Vec<usize>,
    pub right_node_ids: Vec<usize>,
    pub bottom_node_ids: Vec<usize>,
    pub top_node_ids: Vec<usize>,
}

/// Exact square cells; non-divisible dimensions are rejected rather than
/// silently producing rectangular cells.
pub fn mesh_squares(grid: &SquareGrid) -> Result<SquareMesh, String> {
    for (name, value) in [
        ("width", grid.width_m),
        ("height", grid.height_m),
        ("cell size", grid.cell_size_m),
        ("thickness", grid.thickness_m),
    ] {
        positive(value, name)?;
    }
    if !grid.origin_x.is_finite() || !grid.origin_y.is_finite() {
        return Err("non-finite square mesh origin".into());
    }
    let nx = (grid.width_m / grid.cell_size_m).round();
    let ny = (grid.height_m / grid.cell_size_m).round();
    if nx < 1.0
        || ny < 1.0
        || !nx.is_finite()
        || !ny.is_finite()
        || (nx * grid.cell_size_m - grid.width_m).abs() > grid.width_m * 1e-10
        || (ny * grid.cell_size_m - grid.height_m).abs() > grid.height_m * 1e-10
    {
        return Err("square grid dimensions must be exact multiples of cellSizeM".into());
    }
    if (nx + 1.0) * (ny + 1.0) > 10_000.0 {
        return Err("square grid exceeds the 20,000-DOF solver limit".into());
    }
    let (nx, ny) = (nx as usize, ny as usize);
    let id = |i: usize, j: usize| 1 + j * (nx + 1) + i;
    let mut nodes = Vec::with_capacity((nx + 1) * (ny + 1));
    for j in 0..=ny {
        for i in 0..=nx {
            nodes.push(Node {
                id: id(i, j),
                x: grid.origin_x + i as f64 * grid.cell_size_m,
                y: grid.origin_y + j as f64 * grid.cell_size_m,
            });
        }
    }
    let mut quads = Vec::with_capacity(nx * ny);
    for j in 0..ny {
        for i in 0..nx {
            quads.push(Quad {
                id: 1 + quads.len(),
                node_ids: [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)],
                material_id: grid.material_id,
                thickness_m: grid.thickness_m,
            });
        }
    }
    Ok(SquareMesh {
        nodes,
        quads,
        left_node_ids: (0..=ny).map(|j| id(0, j)).collect(),
        right_node_ids: (0..=ny).map(|j| id(nx, j)).collect(),
        bottom_node_ids: (0..=nx).map(|i| id(i, 0)).collect(),
        top_node_ids: (0..=nx).map(|i| id(i, ny)).collect(),
    })
}

#[derive(Clone, Copy)]
struct Point {
    gradients: [[f64; 2]; 4],
    weighted_area: f64,
}
struct Element<'a> {
    id: usize,
    dofs: [usize; 8],
    points: [Point; 4],
    material: &'a Material,
    modulus_curve: Option<&'a ModulusCurve>,
}

fn point(nodes: [&Node; 4], xi: f64, eta: f64, thickness: f64) -> Result<Point, String> {
    let dxi = [
        -0.25 * (1.0 - eta),
        0.25 * (1.0 - eta),
        0.25 * (1.0 + eta),
        -0.25 * (1.0 + eta),
    ];
    let deta = [
        -0.25 * (1.0 - xi),
        -0.25 * (1.0 + xi),
        0.25 * (1.0 + xi),
        0.25 * (1.0 - xi),
    ];
    let xx: f64 = (0..4).map(|i| dxi[i] * nodes[i].x).sum();
    let yx: f64 = (0..4).map(|i| dxi[i] * nodes[i].y).sum();
    let xe: f64 = (0..4).map(|i| deta[i] * nodes[i].x).sum();
    let ye: f64 = (0..4).map(|i| deta[i] * nodes[i].y).sum();
    let det = xx * ye - xe * yx;
    if !det.is_finite() || det <= 1e-12 {
        return Err("quad has non-positive Jacobian".into());
    }
    let gradients = std::array::from_fn(|i| {
        [
            (ye * dxi[i] - yx * deta[i]) / det,
            (-xe * dxi[i] + xx * deta[i]) / det,
        ]
    });
    Ok(Point {
        gradients,
        weighted_area: det * thickness,
    })
}

fn build_elements<'a>(
    request: &'a Request,
    node_index: &HashMap<usize, usize>,
) -> Result<Vec<Element<'a>>, String> {
    let materials: HashMap<usize, &Material> =
        request.materials.iter().map(|m| (m.id, m)).collect();
    let curves: HashMap<usize, &ModulusCurve> = request
        .modulus_curves
        .iter()
        .map(|curve| (curve.material_id, curve))
        .collect();
    let mut ids_used = HashSet::new();
    request
        .quads
        .iter()
        .map(|quad| {
            if !ids_used.insert(quad.id) {
                return Err("duplicate quad id".into());
            }
            positive(quad.thickness_m, "quad thickness")?;
            let ids = quad
                .node_ids
                .map(|id| node_index.get(&id).copied().ok_or("unknown quad node"));
            let ids = [ids[0]?, ids[1]?, ids[2]?, ids[3]?];
            if ids.iter().copied().collect::<HashSet<_>>().len() != 4 {
                return Err("quad repeats a node".into());
            }
            let nodes = ids.map(|i| &request.nodes[i]);
            let g = 1.0 / 3.0_f64.sqrt();
            let points = [
                point(nodes, -g, -g, quad.thickness_m)?,
                point(nodes, g, -g, quad.thickness_m)?,
                point(nodes, g, g, quad.thickness_m)?,
                point(nodes, -g, g, quad.thickness_m)?,
            ];
            let material = *materials
                .get(&quad.material_id)
                .ok_or("unknown quad material")?;
            Ok(Element {
                id: quad.id,
                dofs: std::array::from_fn(|dof| 2 * ids[dof / 2] + dof % 2),
                points,
                material,
                modulus_curve: curves.get(&quad.material_id).copied(),
            })
        })
        .collect()
}

type PointResponse = ([f64; 3], [f64; 3], State);
fn response(
    element: &Element<'_>,
    u: &[f64; 8],
    analysis: Analysis,
    states: &[State; 4],
) -> Result<([f64; 8], [PointResponse; 4]), String> {
    let mut force = [0.0; 8];
    let mut points = [([0.0; 3], [0.0; 3], State::default()); 4];
    for p in 0..4 {
        let gp = &element.points[p];
        let mut grad = [[0.0; 2]; 2];
        for i in 0..4 {
            for d in 0..2 {
                grad[0][d] += u[2 * i] * gp.gradients[i][d];
                grad[1][d] += u[2 * i + 1] * gp.gradients[i][d];
            }
        }
        let [ux, uy] = grad[0];
        let [vx, vy] = grad[1];
        let strain = if analysis.geometric() {
            [
                ux + 0.5 * (ux * ux + vx * vx),
                vy + 0.5 * (uy * uy + vy * vy),
                uy + vx + ux * uy + vx * vy,
            ]
        } else {
            [ux, vy, uy + vx]
        };
        let law = if analysis.material() {
            element.material.law
        } else {
            MaterialLaw::Elastic
        };
        let centre = 0.5 * (strain[0] + strain[1]);
        let radius = ((0.5 * (strain[0] - strain[1])).powi(2) + (0.5 * strain[2]).powi(2)).sqrt();
        let equivalent = (centre + radius).abs().max((centre - radius).abs());
        let maximum = states[p].max_equivalent_strain.max(equivalent);
        let effective_e = if analysis.material() {
            element
                .modulus_curve
                .map_or(element.material.e_mpa, |curve| curve.e_at(maximum))
        } else {
            element.material.e_mpa
        };
        let mut updated =
            material2d::update(effective_e, element.material.nu, law, strain, states[p])?;
        if analysis.material() && element.modulus_curve.is_some() {
            updated.state.max_equivalent_strain = maximum;
        }
        let stress = updated.stress;
        for i in 0..4 {
            let [nx, ny] = gp.gradients[i];
            let (bx, by) = if analysis.geometric() {
                (
                    [nx * (1.0 + ux), ny * uy, ny * (1.0 + ux) + nx * uy],
                    [nx * vx, ny * (1.0 + vy), ny * vx + nx * (1.0 + vy)],
                )
            } else {
                ([nx, 0.0, ny], [0.0, ny, nx])
            };
            force[2 * i] += gp.weighted_area * (0..3).map(|a| bx[a] * stress[a]).sum::<f64>();
            force[2 * i + 1] += gp.weighted_area * (0..3).map(|a| by[a] * stress[a]).sum::<f64>();
        }
        points[p] = (strain, stress, updated.state);
    }
    Ok((force, points))
}

fn assemble(
    elements: &[Element<'_>],
    u: &[f64],
    analysis: Analysis,
    states: &[[State; 4]],
    tangent: bool,
) -> Result<(Vec<f64>, Matrix), String> {
    let mut internal = vec![0.0; u.len()];
    let mut k = Matrix::zeros(u.len())?;
    for (index, element) in elements.iter().enumerate() {
        let local = element.dofs.map(|dof| u[dof]);
        let (force, _) = response(element, &local, analysis, &states[index])?;
        for i in 0..8 {
            internal[element.dofs[i]] += force[i];
        }
        if tangent {
            for j in 0..8 {
                let step = 1e-7_f64.max(local[j].abs() * 1e-5);
                let mut plus = local;
                plus[j] += step;
                let mut minus = local;
                minus[j] -= step;
                let (fp, _) = response(element, &plus, analysis, &states[index])?;
                let (fm, _) = response(element, &minus, analysis, &states[index])?;
                for i in 0..8 {
                    k.add(
                        element.dofs[i],
                        element.dofs[j],
                        (fp[i] - fm[i]) / (2.0 * step),
                    );
                }
            }
        }
    }
    Ok((internal, k))
}

pub fn solve(request: &Request) -> Result<Result2D, String> {
    if request.nodes.len() < 4 || request.quads.is_empty() {
        return Err("quad model requires nodes and quads".into());
    }
    positive(request.tolerance, "tolerance")?;
    if request.max_iterations == 0 || request.max_iterations > 200 {
        return Err("invalid quad iteration limit".into());
    }
    let node_index: HashMap<usize, usize> = request
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id, i))
        .collect();
    if node_index.len() != request.nodes.len() {
        return Err("duplicate quad node id".into());
    }
    if request
        .nodes
        .iter()
        .any(|n| !n.x.is_finite() || !n.y.is_finite())
    {
        return Err("non-finite quad coordinate".into());
    }
    let material_ids: HashSet<usize> = request.materials.iter().map(|m| m.id).collect();
    if material_ids.len() != request.materials.len() {
        return Err("duplicate quad material id".into());
    }
    for material in &request.materials {
        positive(material.e_mpa, "E")?;
        if !material.nu.is_finite() || material.nu <= -1.0 || material.nu >= 0.5 {
            return Err("invalid quad Poisson ratio".into());
        }
        match material.law {
            MaterialLaw::Elastic => {}
            MaterialLaw::SteelBilinear {
                yield_mpa,
                hardening_ratio,
            } => {
                positive(yield_mpa, "steel yield")?;
                if !(0.0..=1.0).contains(&hardening_ratio) {
                    return Err("invalid hardening ratio".into());
                }
            }
            MaterialLaw::ConcreteCracking {
                tensile_mpa,
                residual_ratio,
            } => {
                positive(tensile_mpa, "concrete tensile strength")?;
                if !(0.0..=1.0).contains(&residual_ratio) {
                    return Err("invalid residual ratio".into());
                }
            }
        }
    }
    let mut curve_ids = HashSet::new();
    for curve in &request.modulus_curves {
        if !curve_ids.insert(curve.material_id) {
            return Err("duplicate modulus curve material id".into());
        }
        let material = request
            .materials
            .iter()
            .find(|m| m.id == curve.material_id)
            .ok_or("unknown modulus curve material")?;
        if !matches!(material.law, MaterialLaw::Elastic) {
            return Err("modulus curve requires elastic material law".into());
        }
        if curve.points.len() < 2
            || curve.points[0].strain != 0.0
            || (curve.points[0].e_mpa - material.e_mpa).abs() > material.e_mpa * 1e-10
        {
            return Err("modulus curve must start at strain zero with material E".into());
        }
        for point in &curve.points {
            positive(point.e_mpa, "modulus curve E")?;
            if !point.strain.is_finite() || point.strain < 0.0 {
                return Err("invalid modulus curve strain".into());
            }
        }
        if curve
            .points
            .windows(2)
            .any(|pair| pair[1].strain <= pair[0].strain || pair[1].e_mpa > pair[0].e_mpa)
        {
            return Err("modulus curve strains must increase and E must not increase".into());
        }
    }
    let elements = build_elements(request, &node_index)?;
    let dofs = 2 * request.nodes.len();
    let mut prescribed = vec![None; dofs];
    for support in &request.supports {
        let index = *node_index
            .get(&support.node_id)
            .ok_or("unknown quad support node")?;
        if support.ux {
            prescribed[2 * index] = Some(0.0);
        }
        if support.uy {
            prescribed[2 * index + 1] = Some(0.0);
        }
    }
    let mut load = vec![0.0; dofs];
    for force in &request.loads {
        let index = *node_index
            .get(&force.node_id)
            .ok_or("unknown quad load node")?;
        load[2 * index] += force.fx;
        load[2 * index + 1] += force.fy;
    }
    let scale = load.iter().map(|x| x * x).sum::<f64>().sqrt().max(1.0);
    let path = if request.load_path.is_empty() {
        vec![1.0]
    } else {
        request.load_path.clone()
    };
    if path.iter().any(|x| !x.is_finite()) {
        return Err("non-finite quad load path".into());
    }
    let substeps = if request.analysis == Analysis::Linear {
        1
    } else {
        10
    };
    let mut u = vec![0.0; dofs];
    let mut states = vec![[State::default(); 4]; elements.len()];
    let mut iterations = 0;
    let mut segment_start = 0.0;
    for (segment, &segment_end) in path.iter().enumerate() {
        for step in 1..=substeps {
            let target =
                segment_start + (segment_end - segment_start) * step as f64 / substeps as f64;
            let mut converged = false;
            for _ in 0..request.max_iterations {
                iterations += 1;
                let (internal, k) = assemble(&elements, &u, request.analysis, &states, true)?;
                let residual: Vec<f64> = load
                    .iter()
                    .zip(internal)
                    .map(|(f, p)| target * f - p)
                    .collect();
                let free_norm = residual
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| prescribed[*i].is_none())
                    .map(|(_, r)| r * r)
                    .sum::<f64>()
                    .sqrt();
                if free_norm / scale <= request.tolerance {
                    converged = true;
                    break;
                }
                let (increment, _) = constrained_solve(&k, &residual, &prescribed)?;
                for i in 0..dofs {
                    u[i] += increment[i];
                }
                if !u.iter().all(|x| x.is_finite()) {
                    return Err("non-finite quad displacement".into());
                }
            }
            if !converged {
                return Err(format!(
                    "quad analysis did not converge at segment {} step {step}",
                    segment + 1
                ));
            }
            if request.analysis.material() {
                for (index, element) in elements.iter().enumerate() {
                    let local = element.dofs.map(|dof| u[dof]);
                    let (_, point_results) =
                        response(element, &local, request.analysis, &states[index])?;
                    for p in 0..4 {
                        states[index][p] = point_results[p].2;
                    }
                }
            }
        }
        segment_start = segment_end;
    }
    let (internal, _) = assemble(&elements, &u, request.analysis, &states, false)?;
    let final_factor = *path.last().unwrap();
    let residual: Vec<f64> = internal
        .iter()
        .zip(&load)
        .map(|(a, b)| a - final_factor * b)
        .collect();
    let relative_residual = residual
        .iter()
        .enumerate()
        .filter(|(i, _)| prescribed[*i].is_none())
        .map(|(_, r)| r * r)
        .sum::<f64>()
        .sqrt()
        / scale;
    let nodes = request
        .nodes
        .iter()
        .enumerate()
        .map(|(i, node)| NodeResult {
            node_id: node.id,
            ux_m: u[2 * i],
            uy_m: u[2 * i + 1],
            rx_kn: if prescribed[2 * i].is_some() {
                residual[2 * i]
            } else {
                0.0
            },
            ry_kn: if prescribed[2 * i + 1].is_some() {
                residual[2 * i + 1]
            } else {
                0.0
            },
        })
        .collect();
    let quads = elements
        .iter()
        .enumerate()
        .map(|(index, element)| {
            let local = element.dofs.map(|dof| u[dof]);
            let (_, points) = response(element, &local, request.analysis, &states[index])?;
            let area: f64 = element.points.iter().map(|p| p.weighted_area).sum();
            let average_strain = std::array::from_fn(|a| {
                (0..4)
                    .map(|p| points[p].0[a] * element.points[p].weighted_area)
                    .sum::<f64>()
                    / area
            });
            let average_stress_mpa = std::array::from_fn(|a| {
                (0..4)
                    .map(|p| points[p].1[a] * element.points[p].weighted_area)
                    .sum::<f64>()
                    / area
                    / 1000.0
            });
            let gauss_points = std::array::from_fn(|p| GaussResult {
                stress_mpa: points[p].1.map(|x| x / 1000.0),
                effective_e_mpa: if request.analysis.material() {
                    element
                        .modulus_curve
                        .map_or(element.material.e_mpa, |curve| {
                            curve.e_at(states[index][p].max_equivalent_strain)
                        })
                } else {
                    element.material.e_mpa
                },
                max_equivalent_strain: states[index][p].max_equivalent_strain,
                equivalent_plastic_strain: states[index][p].equivalent_plastic_strain,
                tensile_damage: states[index][p].tensile_damage,
            });
            Ok(QuadResult {
                quad_id: element.id,
                average_strain,
                average_stress_mpa,
                gauss_points,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Result2D {
        nodes,
        quads,
        iterations,
        relative_residual,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn square_mesh_has_exact_cells_and_edges() {
        let mesh = mesh_squares(&SquareGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.0,
            height_m: 2.0,
            cell_size_m: 1.0,
            material_id: 1,
            thickness_m: 0.1,
        })
        .unwrap();
        assert_eq!(mesh.nodes.len(), 9);
        assert_eq!(mesh.quads.len(), 4);
        assert_eq!(mesh.quads[0].node_ids, [1, 2, 5, 4]);
        assert_eq!(mesh.right_node_ids, vec![3, 6, 9]);
        assert!(mesh_squares(&SquareGrid {
            width_m: 2.1,
            ..SquareGrid {
                origin_x: 0.0,
                origin_y: 0.0,
                width_m: 2.0,
                height_m: 2.0,
                cell_size_m: 1.0,
                material_id: 1,
                thickness_m: 0.1
            }
        })
        .is_err());
    }
    #[test]
    fn square_patch_matches_constant_strain() {
        let mesh = mesh_squares(&SquareGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.0,
            height_m: 2.0,
            cell_size_m: 1.0,
            material_id: 1,
            thickness_m: 0.1,
        })
        .unwrap();
        let supports = mesh
            .nodes
            .iter()
            .filter(|n| n.x == 0.0 || n.y == 0.0)
            .map(|n| Support {
                node_id: n.id,
                ux: n.x == 0.0,
                uy: n.y == 0.0,
            })
            .collect();
        let loads = mesh
            .right_node_ids
            .iter()
            .enumerate()
            .map(|(i, &id)| Load {
                node_id: id,
                fx: if i == 1 { 100.0 } else { 50.0 },
                fy: 0.0,
            })
            .collect();
        let result = solve(&Request {
            analysis: Analysis::Linear,
            nodes: mesh.nodes,
            quads: mesh.quads,
            materials: vec![Material {
                id: 1,
                e_mpa: 1000.0,
                nu: 0.0,
                law: MaterialLaw::Elastic,
            }],
            modulus_curves: vec![],
            supports,
            loads,
            load_path: vec![],
            tolerance: 1e-8,
            max_iterations: 40,
        })
        .unwrap();
        for node in &result.nodes {
            let x = if node.node_id % 3 == 0 {
                2.0
            } else if node.node_id % 3 == 2 {
                1.0
            } else {
                0.0
            };
            assert!((node.ux_m - x * 0.001).abs() < 1e-10);
            assert!(node.uy_m.abs() < 1e-10);
        }
        assert!(result.relative_residual < 1e-8);
    }
    #[test]
    fn square_patch_above_600_dof_matches_uniform_extension() {
        let mesh = mesh_squares(&SquareGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.0,
            height_m: 2.0,
            cell_size_m: 0.1,
            material_id: 1,
            thickness_m: 0.1,
        })
        .unwrap();
        assert!(2 * mesh.nodes.len() > 600);
        let supports = mesh
            .nodes
            .iter()
            .filter(|node| node.x == 0.0 || node.y == 0.0)
            .map(|node| Support {
                node_id: node.id,
                ux: node.x == 0.0,
                uy: node.y == 0.0,
            })
            .collect();
        let loads = mesh
            .right_node_ids
            .iter()
            .enumerate()
            .map(|(i, &node_id)| Load {
                node_id,
                fx: if i == 0 || i == 20 { 5.0 } else { 10.0 },
                fy: 0.0,
            })
            .collect();
        let result = solve(&Request {
            analysis: Analysis::Linear,
            nodes: mesh.nodes,
            quads: mesh.quads,
            materials: vec![Material {
                id: 1,
                e_mpa: 1000.0,
                nu: 0.0,
                law: MaterialLaw::Elastic,
            }],
            modulus_curves: vec![],
            supports,
            loads,
            load_path: vec![],
            tolerance: 1e-8,
            max_iterations: 40,
        })
        .unwrap();
        let tip = result.nodes.iter().find(|node| node.node_id == 21).unwrap();
        assert!((tip.ux_m - 0.002).abs() < 1e-7, "{}", tip.ux_m);
        assert!(
            result.relative_residual < 1e-8,
            "{}",
            result.relative_residual
        );
        let reaction: f64 = result.nodes.iter().map(|node| node.rx_kn).sum();
        assert!((reaction + 200.0).abs() < 1e-5, "{reaction}");
    }
    #[test]
    fn quad_gauss_points_retain_steel_plasticity_on_unloading() {
        let mesh = mesh_squares(&SquareGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 1.0,
            height_m: 1.0,
            cell_size_m: 1.0,
            material_id: 1,
            thickness_m: 0.1,
        })
        .unwrap();
        let request = Request {
            analysis: Analysis::Material,
            nodes: mesh.nodes,
            quads: mesh.quads,
            materials: vec![Material {
                id: 1,
                e_mpa: 210_000.0,
                nu: 0.0,
                law: MaterialLaw::SteelBilinear {
                    yield_mpa: 235.0,
                    hardening_ratio: 0.02,
                },
            }],
            modulus_curves: vec![],
            supports: vec![
                Support {
                    node_id: 1,
                    ux: true,
                    uy: true,
                },
                Support {
                    node_id: 3,
                    ux: true,
                    uy: false,
                },
            ],
            loads: vec![
                Load {
                    node_id: 2,
                    fx: 20_000.0,
                    fy: 0.0,
                },
                Load {
                    node_id: 4,
                    fx: 20_000.0,
                    fy: 0.0,
                },
            ],
            load_path: vec![1.0, 0.0],
            tolerance: 1e-8,
            max_iterations: 50,
        };
        let result = solve(&request).unwrap();
        assert!(result.quads[0]
            .gauss_points
            .iter()
            .all(|p| p.equivalent_plastic_strain > 0.0));
        assert!(result.nodes[1].ux_m > 0.0);
        assert!(result.relative_residual < 1e-8);
    }

    #[test]
    fn secant_modulus_curve_softens_and_retains_peak_strain() {
        let mesh = mesh_squares(&SquareGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 1.0,
            height_m: 1.0,
            cell_size_m: 1.0,
            material_id: 1,
            thickness_m: 0.1,
        })
        .unwrap();
        let mut request = Request {
            analysis: Analysis::Material,
            nodes: mesh.nodes,
            quads: mesh.quads,
            materials: vec![Material {
                id: 1,
                e_mpa: 1000.0,
                nu: 0.0,
                law: MaterialLaw::Elastic,
            }],
            modulus_curves: vec![ModulusCurve {
                material_id: 1,
                points: vec![
                    ModulusPoint {
                        strain: 0.0,
                        e_mpa: 1000.0,
                    },
                    ModulusPoint {
                        strain: 0.002,
                        e_mpa: 800.0,
                    },
                ],
            }],
            supports: vec![
                Support {
                    node_id: 1,
                    ux: true,
                    uy: true,
                },
                Support {
                    node_id: 3,
                    ux: true,
                    uy: false,
                },
            ],
            loads: vec![
                Load {
                    node_id: 2,
                    fx: 50.0,
                    fy: 0.0,
                },
                Load {
                    node_id: 4,
                    fx: 50.0,
                    fy: 0.0,
                },
            ],
            load_path: vec![1.0],
            tolerance: 1e-8,
            max_iterations: 40,
        };
        let loaded = solve(&request).unwrap();
        assert!(loaded.nodes[1].ux_m > 0.001);
        assert!(loaded.quads[0]
            .gauss_points
            .iter()
            .all(|gp| gp.effective_e_mpa < 1000.0 && gp.max_equivalent_strain > 0.001));
        request.load_path = vec![1.0, 0.0];
        let unloaded = solve(&request).unwrap();
        assert!(unloaded.quads[0]
            .gauss_points
            .iter()
            .all(|gp| gp.effective_e_mpa < 1000.0 && gp.max_equivalent_strain >= 0.001));
        assert!(unloaded.nodes[1].ux_m.abs() < 1e-9);
        assert!(unloaded.relative_residual < 1e-8);
    }
}
