//! Four-node isoparametric plane-stress membrane with 2x2 Gauss integration.
//! Each integration point owns its own plastic/damage history.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::material2d::{self, State};
use crate::math::{check_sparse_inertia_if_fits, constrained_solve, Matrix};
use crate::plate2d::{
    add_support_springs, support_spring_dofs, support_spring_reaction, Load, Material, Node,
    NodeResult, Support,
};
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
    pub orthotropic_materials: Vec<OrthotropicMaterial>,
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

/// Orthotropic plane-stress constants in the material 1-2 axes (MPa, rad).
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrthotropicMaterial {
    pub material_id: usize,
    pub e1_mpa: f64,
    pub e2_mpa: f64,
    pub nu12: f64,
    pub g12_mpa: f64,
    pub angle_rad: f64,
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

/// Structured Q4 grid for dimensions that need not be exact multiples of a
/// cell size. Each direction is divided independently; cell edges do not
/// exceed `max_cell_size_m` except for machine-scale coordinate roundoff,
/// and all quads remain conforming rectangles.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuadGrid {
    pub origin_x: f64,
    pub origin_y: f64,
    pub width_m: f64,
    pub height_m: f64,
    pub max_cell_size_m: f64,
    pub material_id: usize,
    pub thickness_m: f64,
    #[serde(default)]
    pub openings: Vec<RectOpening>,
}

/// Axis-aligned void in the grid's XY plane, in metres.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RectOpening {
    pub x_m: f64,
    pub y_m: f64,
    pub width_m: f64,
    pub height_m: f64,
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

pub type QuadMesh = SquareMesh;

fn structured_mesh(
    origin_x: f64,
    origin_y: f64,
    width_m: f64,
    height_m: f64,
    nx: usize,
    ny: usize,
    material_id: usize,
    thickness_m: f64,
) -> Result<QuadMesh, String> {
    if (nx as f64 + 1.0) * (ny as f64 + 1.0) > 10_000.0 {
        return Err("quad grid exceeds the 20,000-DOF solver limit".into());
    }
    let id = |i: usize, j: usize| 1 + j * (nx + 1) + i;
    let mut nodes = Vec::with_capacity((nx + 1) * (ny + 1));
    for j in 0..=ny {
        for i in 0..=nx {
            nodes.push(Node {
                id: id(i, j),
                x: origin_x + width_m * (i as f64 / nx as f64),
                y: origin_y + height_m * (j as f64 / ny as f64),
            });
        }
    }
    let mut quads = Vec::with_capacity(nx * ny);
    for j in 0..ny {
        for i in 0..nx {
            quads.push(Quad {
                id: 1 + quads.len(),
                node_ids: [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)],
                material_id,
                thickness_m,
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

pub fn mesh_quads(grid: &QuadGrid) -> Result<QuadMesh, String> {
    for (name, value) in [
        ("width", grid.width_m),
        ("height", grid.height_m),
        ("maximum cell size", grid.max_cell_size_m),
        ("thickness", grid.thickness_m),
    ] {
        positive(value, name)?;
    }
    if !grid.origin_x.is_finite()
        || !grid.origin_y.is_finite()
        || !(grid.origin_x + grid.width_m).is_finite()
        || !(grid.origin_y + grid.height_m).is_finite()
    {
        return Err("non-finite quad mesh coordinates".into());
    }
    if !grid.openings.is_empty() {
        return mesh_quads_with_openings(grid);
    }
    let count = |length: f64| {
        let ratio = length / grid.max_cell_size_m;
        let nearest = ratio.round();
        // A rigid rotation can turn an exact 4.0 ratio into 4.000000000000001.
        // Adding a whole mesh strip would change the numerical model.
        if ratio > nearest && ratio - nearest <= 1e-12 * ratio.max(1.0) {
            nearest.max(1.0)
        } else {
            ratio.ceil().max(1.0)
        }
    };
    let nx = count(grid.width_m);
    let ny = count(grid.height_m);
    if !nx.is_finite()
        || !ny.is_finite()
        || nx < 1.0
        || ny < 1.0
        || (nx + 1.0) * (ny + 1.0) > 10_000.0
    {
        return Err("quad grid exceeds the 20,000-DOF solver limit".into());
    }
    structured_mesh(
        grid.origin_x,
        grid.origin_y,
        grid.width_m,
        grid.height_m,
        nx as usize,
        ny as usize,
        grid.material_id,
        grid.thickness_m,
    )
}

fn mesh_quads_with_openings(grid: &QuadGrid) -> Result<QuadMesh, String> {
    const MIN_CLEARANCE_M: f64 = 0.010;
    let max_x = grid.origin_x + grid.width_m;
    let max_y = grid.origin_y + grid.height_m;
    for (index, opening) in grid.openings.iter().enumerate() {
        positive(opening.width_m, "opening width")?;
        positive(opening.height_m, "opening height")?;
        let x1 = opening.x_m + opening.width_m;
        let y1 = opening.y_m + opening.height_m;
        if !opening.x_m.is_finite()
            || !opening.y_m.is_finite()
            || !x1.is_finite()
            || !y1.is_finite()
            || opening.x_m <= grid.origin_x + MIN_CLEARANCE_M
            || opening.y_m <= grid.origin_y + MIN_CLEARANCE_M
            || x1 >= max_x - MIN_CLEARANCE_M
            || y1 >= max_y - MIN_CLEARANCE_M
        {
            return Err(format!(
                "opening {} must be fully inside the plate with at least 10 mm clearance",
                index + 1
            ));
        }
        for earlier in &grid.openings[..index] {
            let earlier_x1 = earlier.x_m + earlier.width_m;
            let earlier_y1 = earlier.y_m + earlier.height_m;
            if opening.x_m <= earlier_x1 + MIN_CLEARANCE_M
                && earlier.x_m <= x1 + MIN_CLEARANCE_M
                && opening.y_m <= earlier_y1 + MIN_CLEARANCE_M
                && earlier.y_m <= y1 + MIN_CLEARANCE_M
            {
                return Err("quad grid openings touch, overlap, or are closer than 10 mm".into());
            }
        }
    }
    let xs = grid_lines(
        grid.origin_x,
        max_x,
        grid.max_cell_size_m,
        grid.openings
            .iter()
            .flat_map(|opening| [opening.x_m, opening.x_m + opening.width_m]),
    )?;
    let ys = grid_lines(
        grid.origin_y,
        max_y,
        grid.max_cell_size_m,
        grid.openings
            .iter()
            .flat_map(|opening| [opening.y_m, opening.y_m + opening.height_m]),
    )?;
    let nx = xs.len() - 1;
    let ny = ys.len() - 1;
    if (nx + 1) * (ny + 1) > 10_000 {
        return Err("quad grid exceeds the 20,000-DOF solver limit".into());
    }
    let flat = |i: usize, j: usize| j * (nx + 1) + i;
    let mut used = vec![false; (nx + 1) * (ny + 1)];
    let mut active = vec![false; nx * ny];
    for j in 0..ny {
        for i in 0..nx {
            let x = 0.5 * (xs[i] + xs[i + 1]);
            let y = 0.5 * (ys[j] + ys[j + 1]);
            if grid.openings.iter().any(|opening| {
                x > opening.x_m
                    && x < opening.x_m + opening.width_m
                    && y > opening.y_m
                    && y < opening.y_m + opening.height_m
            }) {
                continue;
            }
            active[j * nx + i] = true;
            for (ii, jj) in [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)] {
                used[flat(ii, jj)] = true;
            }
        }
    }
    let mut ids = vec![0; used.len()];
    let mut nodes = Vec::new();
    for j in 0..=ny {
        for i in 0..=nx {
            if used[flat(i, j)] {
                let id = nodes.len() + 1;
                ids[flat(i, j)] = id;
                nodes.push(Node {
                    id,
                    x: xs[i],
                    y: ys[j],
                });
            }
        }
    }
    let mut quads = Vec::new();
    for j in 0..ny {
        for i in 0..nx {
            if active[j * nx + i] {
                quads.push(Quad {
                    id: quads.len() + 1,
                    node_ids: [
                        ids[flat(i, j)],
                        ids[flat(i + 1, j)],
                        ids[flat(i + 1, j + 1)],
                        ids[flat(i, j + 1)],
                    ],
                    material_id: grid.material_id,
                    thickness_m: grid.thickness_m,
                });
            }
        }
    }
    Ok(QuadMesh {
        nodes,
        quads,
        left_node_ids: (0..=ny).map(|j| ids[flat(0, j)]).collect(),
        right_node_ids: (0..=ny).map(|j| ids[flat(nx, j)]).collect(),
        bottom_node_ids: (0..=nx).map(|i| ids[flat(i, 0)]).collect(),
        top_node_ids: (0..=nx).map(|i| ids[flat(i, ny)]).collect(),
    })
}

fn grid_lines(
    min: f64,
    max: f64,
    max_cell_size: f64,
    mandatory: impl Iterator<Item = f64>,
) -> Result<Vec<f64>, String> {
    let mut stops = vec![min, max];
    stops.extend(mandatory);
    stops.sort_by(f64::total_cmp);
    let tolerance = 1e-12 * (max - min).max(1.0);
    stops.dedup_by(|a, b| (*a - *b).abs() <= tolerance);
    let mut lines = Vec::new();
    for pair in stops.windows(2) {
        let ratio = (pair[1] - pair[0]) / max_cell_size;
        let nearest = ratio.round();
        let count = if ratio > nearest && ratio - nearest <= 1e-12 * ratio.max(1.0) {
            nearest.max(1.0)
        } else {
            ratio.ceil().max(1.0)
        };
        if !count.is_finite() || count > 10_000.0 || lines.len() + count as usize > 10_000 {
            return Err("quad grid exceeds the 20,000-DOF solver limit".into());
        }
        let n = count as usize;
        for i in 0..n {
            lines.push(pair[0] + (pair[1] - pair[0]) * (i as f64 / n as f64));
        }
    }
    lines.push(max);
    Ok(lines)
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
    if !grid.origin_x.is_finite()
        || !grid.origin_y.is_finite()
        || !(grid.origin_x + grid.width_m).is_finite()
        || !(grid.origin_y + grid.height_m).is_finite()
    {
        return Err("non-finite square mesh coordinates".into());
    }
    structured_mesh(
        grid.origin_x,
        grid.origin_y,
        grid.width_m,
        grid.height_m,
        nx as usize,
        ny as usize,
        grid.material_id,
        grid.thickness_m,
    )
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
    orthotropic: Option<&'a OrthotropicMaterial>,
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
    let orthotropic: HashMap<usize, &OrthotropicMaterial> = request
        .orthotropic_materials
        .iter()
        .map(|material| (material.material_id, material))
        .collect();
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
                orthotropic: orthotropic.get(&quad.material_id).copied(),
                modulus_curve: curves.get(&quad.material_id).copied(),
            })
        })
        .collect()
}

type PointResponse = ([f64; 3], [f64; 3], State, f64);

fn orthotropic_constitutive(material: &OrthotropicMaterial, secant_scale: f64) -> [[f64; 3]; 3] {
    let e1 = material.e1_mpa * 1000.0 * secant_scale;
    let e2 = material.e2_mpa * 1000.0 * secant_scale;
    let g12 = material.g12_mpa * 1000.0 * secant_scale;
    let nu21 = material.nu12 * material.e2_mpa / material.e1_mpa;
    let inverse = 1.0 / (1.0 - material.nu12 * nu21);
    let local = [
        [e1 * inverse, material.nu12 * e2 * inverse, 0.0],
        [material.nu12 * e2 * inverse, e2 * inverse, 0.0],
        [0.0, 0.0, g12],
    ];
    let (s, c) = material.angle_rad.sin_cos();
    let transform = [
        [c * c, s * s, c * s],
        [s * s, c * c, -c * s],
        [-2.0 * c * s, 2.0 * c * s, c * c - s * s],
    ];
    std::array::from_fn(|i| {
        std::array::from_fn(|j| {
            (0..3)
                .flat_map(|a| (0..3).map(move |b| transform[a][i] * local[a][b] * transform[b][j]))
                .sum()
        })
    })
}

fn response(
    element: &Element<'_>,
    u: &[f64; 8],
    analysis: Analysis,
    states: &[State; 4],
    frozen_moduli: Option<[f64; 4]>,
) -> Result<([f64; 8], [PointResponse; 4]), String> {
    let mut force = [0.0; 8];
    let mut points = [([0.0; 3], [0.0; 3], State::default(), 0.0); 4];
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
        let effective_e = frozen_moduli.map_or_else(
            || {
                if analysis.material() {
                    element
                        .modulus_curve
                        .map_or(element.material.e_mpa, |curve| curve.e_at(maximum))
                } else {
                    element.material.e_mpa
                }
            },
            |moduli| moduli[p],
        );
        let mut updated = if let Some(orthotropic) = element.orthotropic {
            if !matches!(law, MaterialLaw::Elastic) {
                return Err(
                    "orthotropic quad material currently requires an elastic material law".into(),
                );
            }
            let d = orthotropic_constitutive(orthotropic, effective_e / element.material.e_mpa);
            material2d::Response {
                stress: std::array::from_fn(|i| (0..3).map(|j| d[i][j] * strain[j]).sum()),
                state: states[p],
            }
        } else {
            material2d::update(effective_e, element.material.nu, law, strain, states[p])?
        };
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
        points[p] = (strain, stress, updated.state, effective_e);
    }
    Ok((force, points))
}

/// Consistent Q4 tangent for elastic plane stress, including Green–Lagrange
/// initial-stress stiffness. Secant-E curves are frozen at the current Gauss
/// point while differentiating, then reevaluated by the next Newton iteration.
fn elastic_tangent(
    element: &Element<'_>,
    u: &[f64; 8],
    analysis: Analysis,
    points: &[PointResponse; 4],
) -> [[f64; 8]; 8] {
    let geometric = analysis.geometric();
    let mut tangent = [[0.0; 8]; 8];
    for p in 0..4 {
        let gp = &element.points[p];
        let mut grad = [[0.0; 2]; 2];
        for i in 0..4 {
            grad[0][0] += u[2 * i] * gp.gradients[i][0];
            grad[0][1] += u[2 * i] * gp.gradients[i][1];
            grad[1][0] += u[2 * i + 1] * gp.gradients[i][0];
            grad[1][1] += u[2 * i + 1] * gp.gradients[i][1];
        }
        let [ux, uy] = grad[0];
        let [vx, vy] = grad[1];
        let d = if let Some(orthotropic) = element.orthotropic {
            orthotropic_constitutive(orthotropic, points[p].3 / element.material.e_mpa)
        } else {
            let e = points[p].3 * 1000.0;
            let nu = element.material.nu;
            let plane = e / (1.0 - nu * nu);
            [
                [plane, nu * plane, 0.0],
                [nu * plane, plane, 0.0],
                [0.0, 0.0, e / (2.0 * (1.0 + nu))],
            ]
        };
        let mut b = [[0.0; 3]; 8];
        for i in 0..4 {
            let [nx, ny] = gp.gradients[i];
            if geometric {
                b[2 * i] = [nx * (1.0 + ux), ny * uy, ny * (1.0 + ux) + nx * uy];
                b[2 * i + 1] = [nx * vx, ny * (1.0 + vy), nx * (1.0 + vy) + ny * vx];
            } else {
                b[2 * i] = [nx, 0.0, ny];
                b[2 * i + 1] = [0.0, ny, nx];
            }
        }
        for i in 0..8 {
            for j in 0..8 {
                let material = (0..3)
                    .flat_map(|a| (0..3).map(move |c| b[i][a] * d[a][c] * b[j][c]))
                    .sum::<f64>();
                tangent[i][j] += gp.weighted_area * material;
            }
        }
        if geometric {
            let [sx, sy, tau] = points[p].1;
            for i in 0..4 {
                let [nix, niy] = gp.gradients[i];
                for j in 0..4 {
                    let [njx, njy] = gp.gradients[j];
                    let normal = sx * nix * njx + sy * niy * njy;
                    let shear = tau * (niy * njx + nix * njy);
                    let factor = gp.weighted_area;
                    tangent[2 * i][2 * j] += factor * (normal + shear);
                    tangent[2 * i + 1][2 * j + 1] += factor * (normal + shear);
                }
            }
        }
    }
    tangent
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
        let (force, current_points) = response(element, &local, analysis, &states[index], None)?;
        for i in 0..8 {
            internal[element.dofs[i]] += force[i];
        }
        if tangent {
            if !analysis.material() || matches!(element.material.law, MaterialLaw::Elastic) {
                let local_tangent = elastic_tangent(element, &local, analysis, &current_points);
                for i in 0..8 {
                    for j in 0..8 {
                        k.add(element.dofs[i], element.dofs[j], local_tangent[i][j]);
                    }
                }
                continue;
            }
            // Secant-E curves update between equilibrium iterations. Freeze
            // each Gauss-point modulus while differentiating the current
            // constitutive response so the tangent stays symmetric for the
            // sparse SPD solver; the next iteration reevaluates the curve.
            let frozen_moduli = current_points.map(|point| point.3);
            for j in 0..8 {
                let step = 1e-7_f64.max(local[j].abs() * 1e-5);
                let mut plus = local;
                plus[j] += step;
                let mut minus = local;
                minus[j] -= step;
                let (fp, _) = response(
                    element,
                    &plus,
                    analysis,
                    &states[index],
                    Some(frozen_moduli),
                )?;
                let (fm, _) = response(
                    element,
                    &minus,
                    analysis,
                    &states[index],
                    Some(frozen_moduli),
                )?;
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

/// Linear Q4 contribution for a coupled mixed triangle/Q4 global system.
pub(crate) fn assemble_mixed(
    request: &Request,
    displacement: &[f64],
    analysis: Analysis,
    states: &[[State; 4]],
    tangent: bool,
) -> Result<(Vec<f64>, Matrix), String> {
    if displacement.len() != 2 * request.nodes.len() {
        return Err("mixed quad displacement size mismatch".into());
    }
    let node_index: HashMap<usize, usize> = request
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id, index))
        .collect();
    let elements = build_elements(request, &node_index)?;
    if states.len() != elements.len() {
        return Err("mixed Q4 state count mismatch".into());
    }
    assemble(&elements, displacement, analysis, states, tangent)
}

pub(crate) fn commit_mixed_states(
    request: &Request,
    displacement: &[f64],
    analysis: Analysis,
    states: &mut [[State; 4]],
) -> Result<(), String> {
    let node_index: HashMap<usize, usize> = request
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id, index))
        .collect();
    let elements = build_elements(request, &node_index)?;
    if states.len() != elements.len() {
        return Err("mixed Q4 state count mismatch".into());
    }
    for (index, element) in elements.iter().enumerate() {
        let local = element.dofs.map(|dof| displacement[dof]);
        let (_, points) = response(element, &local, analysis, &states[index], None)?;
        for point in 0..4 {
            states[index][point] = points[point].2;
        }
    }
    Ok(())
}

/// Recover Q4 integration-point and average resultants after a mixed solve.
pub(crate) fn recover_mixed(
    request: &Request,
    displacement: &[f64],
    analysis: Analysis,
    states: &[[State; 4]],
) -> Result<Vec<QuadResult>, String> {
    let node_index: HashMap<usize, usize> = request
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id, index))
        .collect();
    let elements = build_elements(request, &node_index)?;
    if states.len() != elements.len() {
        return Err("mixed Q4 state count mismatch".into());
    }
    elements
        .iter()
        .enumerate()
        .map(|(index, element)| {
            let local = element.dofs.map(|dof| displacement[dof]);
            let (_, points) = response(element, &local, analysis, &states[index], None)?;
            let area: f64 = element.points.iter().map(|point| point.weighted_area).sum();
            let average_strain = std::array::from_fn(|component| {
                (0..4)
                    .map(|point| points[point].0[component] * element.points[point].weighted_area)
                    .sum::<f64>()
                    / area
            });
            let average_stress_mpa = std::array::from_fn(|component| {
                (0..4)
                    .map(|point| points[point].1[component] * element.points[point].weighted_area)
                    .sum::<f64>()
                    / area
                    / 1000.0
            });
            let gauss_points = std::array::from_fn(|point| GaussResult {
                stress_mpa: points[point].1.map(|value| value / 1000.0),
                effective_e_mpa: if analysis.material() {
                    element
                        .modulus_curve
                        .map_or(element.material.e_mpa, |curve| {
                            curve.e_at(states[index][point].max_equivalent_strain)
                        })
                } else {
                    element.material.e_mpa
                },
                max_equivalent_strain: states[index][point].max_equivalent_strain,
                equivalent_plastic_strain: states[index][point].equivalent_plastic_strain,
                tensile_damage: states[index][point].tensile_damage,
            });
            Ok(QuadResult {
                quad_id: element.id,
                average_strain,
                average_stress_mpa,
                gauss_points,
            })
        })
        .collect()
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
    let mut orthotropic_ids = HashSet::new();
    for orthotropic in &request.orthotropic_materials {
        if !orthotropic_ids.insert(orthotropic.material_id) {
            return Err("duplicate orthotropic material id".into());
        }
        let material = request
            .materials
            .iter()
            .find(|material| material.id == orthotropic.material_id)
            .ok_or("unknown orthotropic material")?;
        positive(orthotropic.e1_mpa, "orthotropic E1")?;
        positive(orthotropic.e2_mpa, "orthotropic E2")?;
        positive(orthotropic.g12_mpa, "orthotropic G12")?;
        if !orthotropic.nu12.is_finite() || !orthotropic.angle_rad.is_finite() {
            return Err("non-finite orthotropic material parameter".into());
        }
        let nu21 = orthotropic.nu12 * orthotropic.e2_mpa / orthotropic.e1_mpa;
        if !(1.0 - orthotropic.nu12 * nu21 > 0.0) {
            return Err("orthotropic plane-stress stiffness is not positive definite".into());
        }
        if (material.e_mpa - orthotropic.e1_mpa).abs() > orthotropic.e1_mpa * 1e-10 {
            return Err("isotropic E must equal orthotropic E1 for secant scaling".into());
        }
        if !matches!(material.law, MaterialLaw::Elastic) {
            return Err(
                "orthotropic quad material currently requires an elastic material law".into(),
            );
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
    let springs = support_spring_dofs(&request.supports, &node_index)?;
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
    let mut inertia_factor_available = None;
    let check_each_tangent = request.analysis != Analysis::Linear;
    let mut segment_start = 0.0;
    for (segment, &segment_end) in path.iter().enumerate() {
        for step in 1..=substeps {
            let mut accepted_factor =
                segment_start + (segment_end - segment_start) * (step - 1) as f64 / substeps as f64;
            let planned_factor =
                segment_start + (segment_end - segment_start) * step as f64 / substeps as f64;
            let mut target_factor = planned_factor;
            let mut cutbacks = 0;
            loop {
                let mut trial_u = u.clone();
                let mut converged = false;
                for _ in 0..request.max_iterations {
                    iterations += 1;
                    let (mut internal, mut k) =
                        assemble(&elements, &trial_u, request.analysis, &states, true)?;
                    add_support_springs(&springs, &trial_u, &mut internal, &mut k);
                    if inertia_factor_available.is_none()
                        || (check_each_tangent && inertia_factor_available == Some(true))
                    {
                        inertia_factor_available =
                            Some(check_sparse_inertia_if_fits(&k, &prescribed)?);
                    }
                    let residual: Vec<f64> = load
                        .iter()
                        .zip(internal)
                        .map(|(f, p)| target_factor * f - p)
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
                        trial_u[i] += increment[i];
                    }
                    if !trial_u.iter().all(|x| x.is_finite()) {
                        return Err("non-finite quad displacement".into());
                    }
                }
                if converged {
                    u = trial_u;
                    if request.analysis.material() {
                        for (index, element) in elements.iter().enumerate() {
                            let local = element.dofs.map(|dof| u[dof]);
                            let (_, point_results) =
                                response(element, &local, request.analysis, &states[index], None)?;
                            for p in 0..4 {
                                states[index][p] = point_results[p].2;
                            }
                        }
                    }
                    accepted_factor = target_factor;
                    if target_factor == planned_factor {
                        break;
                    }
                    target_factor = planned_factor;
                } else {
                    cutbacks += 1;
                    if cutbacks > 32 {
                        return Err(format!(
                            "quad analysis did not converge after load-step cutbacks near factor {target_factor} (last converged {accepted_factor}) at segment {} step {step}",
                            segment + 1
                        ));
                    }
                    target_factor = accepted_factor + 0.5 * (target_factor - accepted_factor);
                }
            }
        }
        segment_start = segment_end;
    }
    let (mut internal, mut tangent) = assemble(&elements, &u, request.analysis, &states, false)?;
    add_support_springs(&springs, &u, &mut internal, &mut tangent);
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
                support_spring_reaction(&springs, &u, 2 * i)
            },
            ry_kn: if prescribed[2 * i + 1].is_some() {
                residual[2 * i + 1]
            } else {
                support_spring_reaction(&springs, &u, 2 * i + 1)
            },
        })
        .collect();
    let quads = elements
        .iter()
        .enumerate()
        .map(|(index, element)| {
            let local = element.dofs.map(|dof| u[dof]);
            let (_, points) = response(element, &local, request.analysis, &states[index], None)?;
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
    fn quad_mesh_ignores_roundoff_at_an_integer_subdivision_boundary() {
        let mesh = mesh_quads(&QuadGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.0 + 4.0 * f64::EPSILON,
            height_m: 2.0,
            max_cell_size_m: 0.5,
            material_id: 1,
            thickness_m: 0.2,
            openings: vec![],
        })
        .unwrap();
        assert_eq!(mesh.nodes.len(), 25);
        assert_eq!(mesh.quads.len(), 16);
        assert_eq!(mesh.nodes.last().unwrap().x, 2.0 + 4.0 * f64::EPSILON);

        let larger = mesh_quads(&QuadGrid {
            width_m: 2.0 + 1e-8,
            ..QuadGrid {
                origin_x: 0.0,
                origin_y: 0.0,
                width_m: 2.0,
                height_m: 2.0,
                max_cell_size_m: 0.5,
                material_id: 1,
                thickness_m: 0.2,
                openings: vec![],
            }
        })
        .unwrap();
        assert_eq!(larger.nodes.len(), 30);
        assert_eq!(larger.quads.len(), 20);
    }
    #[test]
    fn quad_mesh_fills_non_divisible_rectangle_with_conforming_cells() {
        let grid = QuadGrid {
            origin_x: -1.25,
            origin_y: 0.5,
            width_m: 2.1,
            height_m: 1.5,
            max_cell_size_m: 1.0,
            material_id: 7,
            thickness_m: 0.2,
            openings: vec![],
        };
        let mesh = mesh_quads(&grid).unwrap();
        assert_eq!(mesh.nodes.len(), 12);
        assert_eq!(mesh.quads.len(), 6);
        assert_eq!(mesh.quads[0].node_ids, [1, 2, 6, 5]);
        assert_eq!(mesh.left_node_ids, vec![1, 5, 9]);
        assert_eq!(mesh.right_node_ids, vec![4, 8, 12]);
        assert_eq!(mesh.nodes.last().unwrap().x, grid.origin_x + grid.width_m);
        assert_eq!(mesh.nodes.last().unwrap().y, grid.origin_y + grid.height_m);
        let index: HashMap<usize, &Node> = mesh.nodes.iter().map(|node| (node.id, node)).collect();
        let mut area = 0.0;
        for quad in &mesh.quads {
            let a = index[&quad.node_ids[0]];
            let b = index[&quad.node_ids[1]];
            let d = index[&quad.node_ids[3]];
            let dx = b.x - a.x;
            let dy = d.y - a.y;
            assert!(dx > 0.0 && dx <= grid.max_cell_size_m);
            assert!(dy > 0.0 && dy <= grid.max_cell_size_m);
            assert!((dx / dy - 0.7 / 0.75).abs() < 1e-12);
            area += dx * dy;
        }
        assert!((area - grid.width_m * grid.height_m).abs() < 1e-12);
        assert!(mesh_quads(&QuadGrid {
            max_cell_size_m: 0.001,
            ..grid
        })
        .is_err());
    }
    #[test]
    fn rectangular_opening_has_conforming_quads_and_exact_resultants() {
        let grid = QuadGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.0,
            height_m: 2.0,
            max_cell_size_m: 0.25,
            material_id: 1,
            thickness_m: 0.2,
            openings: vec![RectOpening {
                x_m: 0.75,
                y_m: 0.75,
                width_m: 0.5,
                height_m: 0.5,
            }],
        };
        let mesh = mesh_quads(&grid).unwrap();
        assert_eq!(mesh.nodes.len(), 80);
        assert_eq!(mesh.quads.len(), 60);
        assert_eq!(mesh.bottom_node_ids.len(), 9);
        assert_eq!(mesh.right_node_ids.len(), 9);
        let mut area = 0.0;
        for quad in &mesh.quads {
            let a = &mesh.nodes[quad.node_ids[0] - 1];
            let b = &mesh.nodes[quad.node_ids[1] - 1];
            let d = &mesh.nodes[quad.node_ids[3] - 1];
            let dx = b.x - a.x;
            let dy = d.y - a.y;
            assert!(dx > 0.0 && dx <= grid.max_cell_size_m + 1e-12);
            assert!(dy > 0.0 && dy <= grid.max_cell_size_m + 1e-12);
            let cx = a.x + dx / 2.0;
            let cy = a.y + dy / 2.0;
            assert!(!(cx > 0.75 && cx < 1.25 && cy > 0.75 && cy < 1.25));
            area += dx * dy;
        }
        assert!((area - 3.75).abs() < 1e-12);
        let rotated_roundoff = QuadGrid {
            openings: vec![RectOpening {
                x_m: 0.75 + 2.0 * f64::EPSILON,
                y_m: 0.75 + 2.0 * f64::EPSILON,
                width_m: 0.5,
                height_m: 0.5,
            }],
            ..grid.clone()
        };
        assert_eq!(mesh_quads(&rotated_roundoff).unwrap().quads.len(), 60);
        let offset = QuadGrid {
            openings: vec![RectOpening {
                x_m: 0.5,
                ..grid.openings[0].clone()
            }],
            ..grid.clone()
        };
        let offset_mesh = mesh_quads(&offset).unwrap();
        let (area, first_x) = offset_mesh
            .quads
            .iter()
            .fold((0.0, 0.0), |(area, first_x), quad| {
                let a = &offset_mesh.nodes[quad.node_ids[0] - 1];
                let b = &offset_mesh.nodes[quad.node_ids[1] - 1];
                let d = &offset_mesh.nodes[quad.node_ids[3] - 1];
                let cell_area = (b.x - a.x) * (d.y - a.y);
                (area + cell_area, first_x + cell_area * (a.x + b.x) / 2.0)
            });
        assert!((area - 3.75).abs() < 1e-12);
        assert!((first_x - (4.0 - 0.25 * 0.75)).abs() < 1e-12);
    }

    #[test]
    fn quad_openings_reject_thin_strips_overlap_and_excessive_mesh() {
        let grid = QuadGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.0,
            height_m: 2.0,
            max_cell_size_m: 0.25,
            material_id: 1,
            thickness_m: 0.2,
            openings: vec![RectOpening {
                x_m: 0.75,
                y_m: 0.75,
                width_m: 0.5,
                height_m: 0.5,
            }],
        };
        assert!(mesh_quads(&QuadGrid {
            openings: vec![RectOpening {
                x_m: 0.005,
                ..grid.openings[0].clone()
            }],
            ..grid.clone()
        })
        .unwrap_err()
        .contains("10 mm clearance"));
        assert!(mesh_quads(&QuadGrid {
            openings: vec![
                grid.openings[0].clone(),
                RectOpening {
                    x_m: 1.255,
                    y_m: 0.75,
                    width_m: 0.2,
                    height_m: 0.2
                }
            ],
            ..grid.clone()
        })
        .unwrap_err()
        .contains("touch"));
        assert!(mesh_quads(&QuadGrid {
            max_cell_size_m: 0.001,
            ..grid
        })
        .unwrap_err()
        .contains("limit"));
    }
    #[test]
    fn rectangular_quad_mesh_matches_uniform_tension_solution() {
        let mesh = mesh_quads(&QuadGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.1,
            height_m: 1.5,
            max_cell_size_m: 1.0,
            material_id: 1,
            thickness_m: 0.1,
            openings: vec![],
        })
        .unwrap();
        let supports = mesh
            .nodes
            .iter()
            .filter(|node| node.x == 0.0 || node.y == 0.0)
            .map(|node| Support {
                node_id: node.id,
                ux: node.x == 0.0,
                uy: node.y == 0.0,
                kx_kn_per_m: None,
                ky_kn_per_m: None,
            })
            .collect();
        let loads = mesh
            .right_node_ids
            .iter()
            .enumerate()
            .map(|(i, &node_id)| Load {
                node_id,
                fx: if i == 1 { 75.0 } else { 37.5 },
                fy: 0.0,
            })
            .collect();
        let result = solve(&Request {
            analysis: Analysis::Linear,
            nodes: mesh.nodes,
            materials: vec![Material {
                id: 1,
                e_mpa: 1000.0,
                nu: 0.0,
                law: MaterialLaw::Elastic,
            }],
            orthotropic_materials: vec![],
            modulus_curves: vec![],
            quads: mesh.quads,
            supports,
            loads,
            load_path: vec![],
            tolerance: 1e-9,
            max_iterations: 40,
        })
        .unwrap();
        for node in &result.nodes {
            let x = 0.7 * ((node.node_id - 1) % 4) as f64;
            assert!((node.ux_m - x * 0.001).abs() < 1e-10);
        }
        assert!(result
            .quads
            .iter()
            .all(|quad| (quad.average_stress_mpa[0] - 1.0).abs() < 1e-9));
        assert!(result.relative_residual < 1e-9);
    }

    #[test]
    fn linear_quad_translational_springs_match_axial_series_solution() {
        let request = Request {
            analysis: Analysis::Linear,
            nodes: vec![
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
            ],
            materials: vec![Material {
                id: 1,
                e_mpa: 1000.0,
                nu: 0.0,
                law: MaterialLaw::Elastic,
            }],
            orthotropic_materials: vec![],
            modulus_curves: vec![],
            quads: vec![Quad {
                id: 1,
                node_ids: [1, 2, 3, 4],
                material_id: 1,
                thickness_m: 0.001,
            }],
            supports: vec![
                Support {
                    node_id: 1,
                    ux: true,
                    uy: true,
                    kx_kn_per_m: None,
                    ky_kn_per_m: None,
                },
                Support {
                    node_id: 4,
                    ux: true,
                    uy: true,
                    kx_kn_per_m: None,
                    ky_kn_per_m: None,
                },
                Support {
                    node_id: 2,
                    ux: false,
                    uy: false,
                    kx_kn_per_m: Some(1000.0),
                    ky_kn_per_m: None,
                },
                Support {
                    node_id: 3,
                    ux: false,
                    uy: false,
                    kx_kn_per_m: Some(1000.0),
                    ky_kn_per_m: None,
                },
            ],
            loads: vec![
                Load {
                    node_id: 2,
                    fx: 50.0,
                    fy: 0.0,
                },
                Load {
                    node_id: 3,
                    fx: 50.0,
                    fy: 0.0,
                },
            ],
            load_path: vec![],
            tolerance: 1e-10,
            max_iterations: 40,
        };
        let result = solve(&request).unwrap();

        let expected_displacement = 100.0 / (1000.0 + 2.0 * 1000.0);
        for id in [2, 3] {
            let node = result.nodes.iter().find(|node| node.node_id == id).unwrap();
            assert!((node.ux_m - expected_displacement).abs() < 1e-12);
            assert!((node.rx_kn + 1000.0 * expected_displacement).abs() < 1e-10);
        }
        assert!(
            (result.quads[0].average_stress_mpa[0] - 1000.0 * expected_displacement).abs() < 1e-9
        );
        let total_support_reaction = result.nodes.iter().map(|node| node.rx_kn).sum::<f64>();
        assert!((total_support_reaction + 100.0).abs() < 1e-9);
        assert!(result.relative_residual < 1e-10);

        let geometric = solve(&Request {
            analysis: Analysis::Geometric,
            ..request
        })
        .unwrap();
        for id in [2, 3] {
            let node = geometric
                .nodes
                .iter()
                .find(|node| node.node_id == id)
                .unwrap();
            assert!((node.rx_kn + 1000.0 * node.ux_m).abs() < 1e-7);
        }
        let total_support_reaction = geometric.nodes.iter().map(|node| node.rx_kn).sum::<f64>();
        assert!((total_support_reaction + 100.0).abs() < 1e-7);
        assert!(geometric.relative_residual < 1e-8);
    }

    #[test]
    fn orthotropic_quad_matches_closed_form_axial_coupon() {
        let request = Request {
            analysis: Analysis::Linear,
            nodes: vec![
                Node {
                    id: 1,
                    x: 0.0,
                    y: 0.0,
                },
                Node {
                    id: 2,
                    x: 2.0,
                    y: 0.0,
                },
                Node {
                    id: 3,
                    x: 2.0,
                    y: 1.0,
                },
                Node {
                    id: 4,
                    x: 0.0,
                    y: 1.0,
                },
            ],
            materials: vec![Material {
                id: 1,
                e_mpa: 1000.0,
                nu: 0.0,
                law: MaterialLaw::Elastic,
            }],
            orthotropic_materials: vec![OrthotropicMaterial {
                material_id: 1,
                e1_mpa: 1000.0,
                e2_mpa: 100.0,
                nu12: 0.0,
                g12_mpa: 40.0,
                angle_rad: 0.0,
            }],
            modulus_curves: vec![],
            quads: vec![Quad {
                id: 1,
                node_ids: [1, 2, 3, 4],
                material_id: 1,
                thickness_m: 0.01,
            }],
            supports: vec![
                Support {
                    node_id: 1,
                    ux: true,
                    uy: true,
                    kx_kn_per_m: None,
                    ky_kn_per_m: None,
                },
                Support {
                    node_id: 4,
                    ux: true,
                    uy: false,
                    kx_kn_per_m: None,
                    ky_kn_per_m: None,
                },
            ],
            loads: vec![
                Load {
                    node_id: 2,
                    fx: 5.0,
                    fy: 0.0,
                },
                Load {
                    node_id: 3,
                    fx: 5.0,
                    fy: 0.0,
                },
            ],
            load_path: vec![],
            tolerance: 1e-10,
            max_iterations: 40,
        };
        let result = solve(&request).unwrap();
        let expected_extension_m = 10.0 * 2.0 / (1_000_000.0 * 0.01);
        for node in result
            .nodes
            .iter()
            .filter(|node| node.node_id == 2 || node.node_id == 3)
        {
            assert!((node.ux_m - expected_extension_m).abs() < 1e-12);
        }
        assert!(result
            .quads
            .iter()
            .all(|quad| (quad.average_stress_mpa[0] - 1.0).abs() < 1e-10));
        assert!(result.relative_residual < 1e-10);

        let mut fnl_request = request;
        fnl_request.analysis = Analysis::Material;
        fnl_request.modulus_curves = vec![ModulusCurve {
            material_id: 1,
            points: vec![
                ModulusPoint {
                    strain: 0.0,
                    e_mpa: 1000.0,
                },
                ModulusPoint {
                    strain: 0.0001,
                    e_mpa: 500.0,
                },
            ],
        }];
        fnl_request.load_path = vec![1.0];
        let softened = solve(&fnl_request).unwrap();
        let expected_softened_extension_m = 10.0 * 2.0 / (500_000.0 * 0.01);
        for node in softened
            .nodes
            .iter()
            .filter(|node| node.node_id == 2 || node.node_id == 3)
        {
            assert!((node.ux_m - expected_softened_extension_m).abs() < 1e-8);
        }
        assert!(softened.quads[0]
            .gauss_points
            .iter()
            .all(|point| (point.effective_e_mpa - 500.0).abs() < 1e-8));
    }

    #[test]
    fn geometric_quad_matches_finite_strain_uniaxial_solution() {
        let mesh = mesh_quads(&QuadGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.0,
            height_m: 1.0,
            max_cell_size_m: 2.0,
            material_id: 1,
            thickness_m: 0.1,
            openings: vec![],
        })
        .unwrap();
        let supports = mesh
            .nodes
            .iter()
            .filter(|node| node.x == 0.0 || node.y == 0.0)
            .map(|node| Support {
                node_id: node.id,
                ux: node.x == 0.0,
                uy: node.y == 0.0,
                kx_kn_per_m: None,
                ky_kn_per_m: None,
            })
            .collect();
        let loads = mesh
            .right_node_ids
            .iter()
            .map(|&node_id| Load {
                node_id,
                fx: 500.0,
                fy: 0.0,
            })
            .collect();
        let result = solve(&Request {
            analysis: Analysis::Geometric,
            nodes: mesh.nodes,
            materials: vec![Material {
                id: 1,
                e_mpa: 1000.0,
                nu: 0.0,
                law: MaterialLaw::Elastic,
            }],
            orthotropic_materials: vec![],
            modulus_curves: vec![],
            quads: mesh.quads,
            supports,
            loads,
            load_path: vec![],
            tolerance: 1e-10,
            max_iterations: 40,
        })
        .unwrap();
        let right = result
            .nodes
            .iter()
            .filter(|node| node.node_id == 2 || node.node_id == 4)
            .map(|node| node.ux_m)
            .sum::<f64>()
            / 2.0;
        // The material stress is second Piola–Kirchhoff: nominal force gives
        // P/(A E)=F·0.5(F²−1)=0.01 for the axial stretch F.
        let mut stretch = 1.01_f64;
        for _ in 0..8 {
            stretch -= (stretch * 0.5 * (stretch * stretch - 1.0) - 0.01)
                / (0.5 * (3.0 * stretch * stretch - 1.0));
        }
        let expected_extension = 2.0 * (stretch - 1.0);
        assert!(
            (right - expected_extension).abs() < 1e-9,
            "{right} != {expected_extension}"
        );
        let expected_pk2 = 1000.0 * 0.5 * (stretch * stretch - 1.0);
        assert!((result.quads[0].average_stress_mpa[0] - expected_pk2).abs() < 1e-8);
        assert!(result.relative_residual < 1e-10);
    }

    #[test]
    fn combined_gnl_fnl_quad_matches_plastic_finite_strain_coupon() {
        let mesh = mesh_quads(&QuadGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.0,
            height_m: 1.0,
            max_cell_size_m: 2.0,
            material_id: 1,
            thickness_m: 0.1,
            openings: vec![],
        })
        .unwrap();
        let supports = mesh
            .nodes
            .iter()
            .filter(|node| node.x == 0.0 || node.y == 0.0)
            .map(|node| Support {
                node_id: node.id,
                ux: node.x == 0.0,
                uy: node.y == 0.0,
                kx_kn_per_m: None,
                ky_kn_per_m: None,
            })
            .collect();
        let nominal_stress_mpa = 150.0;
        let load_per_edge_node_kn = nominal_stress_mpa * 1000.0 * 0.1 / 2.0;
        let loads = mesh
            .right_node_ids
            .iter()
            .map(|&node_id| Load {
                node_id,
                fx: load_per_edge_node_kn,
                fy: 0.0,
            })
            .collect();
        let e_mpa = 210_000.0;
        let yield_mpa = 100.0;
        let hardening_ratio = 0.05;
        let tangent_mpa = e_mpa * hardening_ratio;

        // Independently solve nominal stress = stretch × second Piola stress.
        // The bilinear law gives Green–Lagrange strain from the second Piola
        // stress after yield; stretch follows from E_GL = (lambda² - 1)/2.
        let strain_for_stress =
            |stress_mpa: f64| yield_mpa / e_mpa + (stress_mpa - yield_mpa) / tangent_mpa;
        let nominal_residual = |stress_mpa: f64| {
            stress_mpa * (1.0 + 2.0 * strain_for_stress(stress_mpa)).sqrt() - nominal_stress_mpa
        };
        let (mut lower, mut upper) = (yield_mpa, nominal_stress_mpa);
        for _ in 0..80 {
            let middle = 0.5 * (lower + upper);
            if nominal_residual(middle) > 0.0 {
                upper = middle;
            } else {
                lower = middle;
            }
        }
        let expected_pk2_mpa = 0.5 * (lower + upper);
        let expected_stretch = (1.0 + 2.0 * strain_for_stress(expected_pk2_mpa)).sqrt();

        let steel_request = Request {
            analysis: Analysis::Combined,
            nodes: mesh.nodes,
            materials: vec![Material {
                id: 1,
                e_mpa,
                nu: 0.0,
                law: MaterialLaw::SteelBilinear {
                    yield_mpa,
                    hardening_ratio,
                },
            }],
            orthotropic_materials: vec![],
            modulus_curves: vec![],
            quads: mesh.quads,
            supports,
            loads,
            load_path: vec![],
            tolerance: 1e-9,
            max_iterations: 60,
        };
        let result = solve(&steel_request).unwrap();

        let right_extension = result
            .nodes
            .iter()
            .filter(|node| node.node_id == 2 || node.node_id == 4)
            .map(|node| node.ux_m)
            .sum::<f64>()
            / 2.0;
        let expected_extension = 2.0 * (expected_stretch - 1.0);
        assert!(
            (right_extension - expected_extension).abs() < 2e-7,
            "combined GNL/FNL extension {right_extension} m != analytical {expected_extension} m"
        );
        assert!(
            (result.quads[0].average_stress_mpa[0] - expected_pk2_mpa).abs() < 2e-3,
            "PK2 stress {} MPa != analytical {expected_pk2_mpa} MPa",
            result.quads[0].average_stress_mpa[0]
        );
        assert!(result.quads[0]
            .gauss_points
            .iter()
            .all(|point| point.equivalent_plastic_strain > 0.0));
        assert!(result.relative_residual < 1e-8);

        let concrete_e_mpa = 30_000.0;
        let tensile_mpa = 3.0;
        let residual_ratio = 0.05;
        let concrete_nominal_stress_mpa = 20.0;
        let concrete_tangent_mpa = concrete_e_mpa * residual_ratio;
        let concrete_strain_for_stress = |stress_mpa: f64| {
            tensile_mpa / concrete_e_mpa + (stress_mpa - tensile_mpa) / concrete_tangent_mpa
        };
        let concrete_residual = |stress_mpa: f64| {
            stress_mpa * (1.0 + 2.0 * concrete_strain_for_stress(stress_mpa)).sqrt()
                - concrete_nominal_stress_mpa
        };
        let (mut concrete_lower, mut concrete_upper) = (tensile_mpa, concrete_nominal_stress_mpa);
        for _ in 0..80 {
            let middle = 0.5 * (concrete_lower + concrete_upper);
            if concrete_residual(middle) > 0.0 {
                concrete_upper = middle;
            } else {
                concrete_lower = middle;
            }
        }
        let expected_concrete_stress_mpa = 0.5 * (concrete_lower + concrete_upper);
        let expected_concrete_strain = concrete_strain_for_stress(expected_concrete_stress_mpa);
        let expected_concrete_stretch = (1.0 + 2.0 * expected_concrete_strain).sqrt();
        let concrete_request = Request {
            materials: vec![Material {
                id: 1,
                e_mpa: concrete_e_mpa,
                nu: 0.0,
                law: MaterialLaw::ConcreteCracking {
                    tensile_mpa,
                    residual_ratio,
                },
            }],
            loads: vec![
                Load {
                    node_id: 2,
                    fx: concrete_nominal_stress_mpa * 1000.0 * 0.1 / 2.0,
                    fy: 0.0,
                },
                Load {
                    node_id: 4,
                    fx: concrete_nominal_stress_mpa * 1000.0 * 0.1 / 2.0,
                    fy: 0.0,
                },
            ],
            ..steel_request
        };
        let concrete_result = solve(&concrete_request).unwrap();
        let concrete_extension = concrete_result
            .nodes
            .iter()
            .filter(|node| node.node_id == 2 || node.node_id == 4)
            .map(|node| node.ux_m)
            .sum::<f64>()
            / 2.0;
        let expected_concrete_extension = 2.0 * (expected_concrete_stretch - 1.0);
        assert!(
            (concrete_extension - expected_concrete_extension).abs() < 2e-6,
            "combined GNL/FNL concrete extension {concrete_extension} m != analytical {expected_concrete_extension} m"
        );
        assert!(
            (concrete_result.quads[0].average_stress_mpa[0] - expected_concrete_stress_mpa).abs()
                < 2e-3,
            "concrete PK2 stress {} MPa != analytical {expected_concrete_stress_mpa} MPa",
            concrete_result.quads[0].average_stress_mpa[0]
        );
        let expected_damage =
            1.0 - expected_concrete_stress_mpa / (concrete_e_mpa * expected_concrete_strain);
        assert!(concrete_result.quads[0]
            .gauss_points
            .iter()
            .all(|point| (point.tensile_damage - expected_damage).abs() < 1e-7));
        assert!(concrete_result.relative_residual < 1e-8);
    }

    #[test]
    fn analytic_geometric_elastic_tangent_matches_finite_difference() {
        let mesh = mesh_quads(&QuadGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.0,
            height_m: 1.0,
            max_cell_size_m: 2.0,
            material_id: 1,
            thickness_m: 0.1,
            openings: vec![],
        })
        .unwrap();
        let request = Request {
            analysis: Analysis::Combined,
            nodes: mesh.nodes,
            materials: vec![Material {
                id: 1,
                e_mpa: 30_000.0,
                nu: 0.2,
                law: MaterialLaw::Elastic,
            }],
            orthotropic_materials: vec![],
            modulus_curves: vec![],
            quads: mesh.quads,
            supports: vec![],
            loads: vec![],
            load_path: vec![],
            tolerance: 1e-9,
            max_iterations: 40,
        };
        let node_index = request
            .nodes
            .iter()
            .enumerate()
            .map(|(i, node)| (node.id, i))
            .collect::<HashMap<_, _>>();
        let element = build_elements(&request, &node_index).unwrap().remove(0);
        let local = [0.0, 0.0, 0.012, -0.003, 0.002, 0.004, 0.016, 0.006];
        let states = [State::default(); 4];
        let (_, points) = response(&element, &local, Analysis::Combined, &states, None).unwrap();
        let tangent = elastic_tangent(&element, &local, Analysis::Combined, &points);
        let mut failures = Vec::new();
        for j in 0..8 {
            let step = 1e-7_f64.max(local[j].abs() * 1e-5);
            let mut plus = local;
            plus[j] += step;
            let mut minus = local;
            minus[j] -= step;
            let fp = response(&element, &plus, Analysis::Combined, &states, None)
                .unwrap()
                .0;
            let fm = response(&element, &minus, Analysis::Combined, &states, None)
                .unwrap()
                .0;
            for i in 0..8 {
                let numerical = (fp[i] - fm[i]) / (2.0 * step);
                let error = (tangent[i][j] - numerical).abs();
                if error > 2e-6 * (1.0 + numerical.abs()) {
                    failures.push((i, j, tangent[i][j], numerical, error));
                }
            }
        }
        assert!(failures.is_empty(), "tangent mismatches: {failures:?}");
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
                kx_kn_per_m: None,
                ky_kn_per_m: None,
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
            orthotropic_materials: vec![],
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
                kx_kn_per_m: None,
                ky_kn_per_m: None,
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
            orthotropic_materials: vec![],
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
    fn sparse_geometric_quad_mesh_matches_finite_strain_tension() {
        let mesh = mesh_quads(&QuadGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.0,
            height_m: 2.0,
            max_cell_size_m: 0.1,
            material_id: 1,
            thickness_m: 0.1,
            openings: vec![],
        })
        .unwrap();
        assert!(mesh.nodes.len() * 2 > 600);
        let supports = mesh
            .nodes
            .iter()
            .filter(|node| node.x == 0.0 || node.y == 0.0)
            .map(|node| Support {
                node_id: node.id,
                ux: node.x == 0.0,
                uy: node.y == 0.0,
                kx_kn_per_m: None,
                ky_kn_per_m: None,
            })
            .collect();
        let stretch = 1.002_f64.sqrt();
        let total_force_kn = stretch * 1000.0 * 0.2;
        let loads = mesh
            .right_node_ids
            .iter()
            .enumerate()
            .map(|(i, &node_id)| Load {
                node_id,
                fx: if i == 0 || i + 1 == mesh.right_node_ids.len() {
                    total_force_kn / (2.0 * (mesh.right_node_ids.len() - 1) as f64)
                } else {
                    total_force_kn / (mesh.right_node_ids.len() - 1) as f64
                },
                fy: 0.0,
            })
            .collect();
        let result = solve(&Request {
            analysis: Analysis::Geometric,
            nodes: mesh.nodes,
            materials: vec![Material {
                id: 1,
                e_mpa: 1000.0,
                nu: 0.0,
                law: MaterialLaw::Elastic,
            }],
            orthotropic_materials: vec![],
            modulus_curves: vec![],
            quads: mesh.quads,
            supports,
            loads,
            load_path: vec![],
            tolerance: 1e-8,
            max_iterations: 40,
        })
        .unwrap();
        let tip = result.nodes.iter().find(|node| node.node_id == 21).unwrap();
        assert!(
            (tip.ux_m - 2.0 * (stretch - 1.0)).abs() < 2e-6,
            "{}",
            tip.ux_m
        );
        assert!(result
            .quads
            .iter()
            .all(|quad| (quad.average_stress_mpa[0] - 1.0).abs() < 2e-6));
        assert!(result.relative_residual < 1e-8);
    }

    #[test]
    fn sparse_quad_material_path_rechecks_the_evolving_tangent() {
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
                kx_kn_per_m: None,
                ky_kn_per_m: None,
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
            analysis: Analysis::Material,
            nodes: mesh.nodes,
            quads: mesh.quads,
            materials: vec![Material {
                id: 1,
                e_mpa: 1000.0,
                nu: 0.0,
                law: MaterialLaw::Elastic,
            }],
            orthotropic_materials: vec![],
            modulus_curves: vec![ModulusCurve {
                material_id: 1,
                points: vec![
                    ModulusPoint {
                        strain: 0.0,
                        e_mpa: 1000.0,
                    },
                    ModulusPoint {
                        strain: 1e-9,
                        e_mpa: 500.0,
                    },
                ],
            }],
            supports,
            loads,
            load_path: vec![1.0, 0.0],
            tolerance: 1e-8,
            max_iterations: 40,
        })
        .unwrap();
        let tip = result.nodes.iter().find(|node| node.node_id == 21).unwrap();
        assert!(tip.ux_m.abs() < 1e-9);
        assert!(result
            .quads
            .iter()
            .flat_map(|quad| &quad.gauss_points)
            .all(|point| (point.effective_e_mpa - 500.0).abs() < 1e-8));
        assert!(result
            .quads
            .iter()
            .flat_map(|quad| &quad.gauss_points)
            .all(|point| point.max_equivalent_strain >= 1e-9));
        assert!(result.relative_residual < 1e-8);
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
            orthotropic_materials: vec![],
            modulus_curves: vec![],
            supports: vec![
                Support {
                    node_id: 1,
                    ux: true,
                    uy: true,
                    kx_kn_per_m: None,
                    ky_kn_per_m: None,
                },
                Support {
                    node_id: 3,
                    ux: true,
                    uy: false,
                    kx_kn_per_m: None,
                    ky_kn_per_m: None,
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

        let mut reloading_request = request;
        reloading_request.load_path = vec![1.0, 0.0, 0.5];
        let reloaded = solve(&reloading_request).unwrap();
        assert!(reloaded.nodes[1].ux_m > 0.0);
        assert!(reloaded.quads[0]
            .gauss_points
            .iter()
            .all(|point| point.equivalent_plastic_strain > 0.0));
        assert!(reloaded.relative_residual < 1e-8);
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
            orthotropic_materials: vec![],
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
                    kx_kn_per_m: None,
                    ky_kn_per_m: None,
                },
                Support {
                    node_id: 3,
                    ux: true,
                    uy: false,
                    kx_kn_per_m: None,
                    ky_kn_per_m: None,
                },
            ],
            loads: vec![
                Load {
                    node_id: 2,
                    fx: 80.0,
                    fy: 0.0,
                },
                Load {
                    node_id: 4,
                    fx: 80.0,
                    fy: 0.0,
                },
            ],
            load_path: vec![1.0],
            tolerance: 1e-8,
            max_iterations: 40,
        };
        let loaded = solve(&request).unwrap();
        // Independent uniaxial secant law: total F = 160 kN over
        // A = 0.1 m² gives sigma = 1.6 MPa. At epsilon = 0.002 the
        // prescribed secant modulus is 800 MPa, hence delta = 0.002 m.
        assert!((loaded.nodes[1].ux_m - 0.002).abs() < 1e-9);
        assert!(loaded.quads[0]
            .gauss_points
            .iter()
            .all(|gp| (gp.effective_e_mpa - 800.0).abs() < 2e-6
                && (gp.max_equivalent_strain - 0.002).abs() < 1e-9));
        assert!(loaded.quads[0]
            .gauss_points
            .iter()
            .all(|gp| (gp.stress_mpa[0] - 1.6).abs() < 1e-8));
        assert!((loaded.nodes.iter().map(|node| node.rx_kn).sum::<f64>() + 160.0).abs() < 2e-6);
        assert!(loaded.relative_residual < 1e-8);
        request.load_path = vec![1.0, 0.0];
        let unloaded = solve(&request).unwrap();
        assert!(unloaded.quads[0]
            .gauss_points
            .iter()
            .all(|gp| gp.effective_e_mpa < 1000.0 && gp.max_equivalent_strain >= 0.001));
        assert!(unloaded.nodes[1].ux_m.abs() < 1e-9);
        assert!(unloaded.relative_residual < 1e-8);

        // After complete unloading, the retained peak keeps E_sec = 800 MPa.
        // At half load, the independent elastic reload is therefore 1 mm;
        // a curve evaluated from the current strain would incorrectly recover
        // a stiffer modulus and a smaller displacement.
        request.load_path = vec![1.0, 0.0, 0.5];
        let reloaded = solve(&request).unwrap();
        assert!((reloaded.nodes[1].ux_m - 0.001).abs() < 1e-9);
        assert!(reloaded.quads[0]
            .gauss_points
            .iter()
            .all(|gp| (gp.effective_e_mpa - 800.0).abs() < 2e-6
                && (gp.max_equivalent_strain - 0.002).abs() < 1e-9
                && (gp.stress_mpa[0] - 0.8).abs() < 1e-8));
        assert!((reloaded.nodes.iter().map(|node| node.rx_kn).sum::<f64>() + 80.0).abs() < 2e-6);
        assert!(reloaded.relative_residual < 1e-8);
    }
}
