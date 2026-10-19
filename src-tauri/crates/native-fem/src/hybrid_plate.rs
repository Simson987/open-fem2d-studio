//! Four-node 17-parameter hybrid Kirchhoff plate bending element.
//! The boundary has cubic Hermite deflection and linear normal slope;
//! an independent quadratic, self-equilibrated moment field is eliminated
//! through complementary energy. DOFs: [w, theta_x=-w,y, theta_y=w,x].

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::frontal::{self, FrontalElement, FrontalOptions};
use crate::material2d::{self, State as MaterialState};
use crate::math::{check_sparse_inertia_if_fits, constrained_solve, Matrix};
use crate::plate_bending::{
    add_support_spring_stiffness, collect_support_springs, support_spring_reaction, LinearBackend,
    Load, Material, Node, NodeResult, Support,
};
use crate::plate_fiber_section::{Layer as PlateFiberLayer, PlateFiberSection};
use crate::quad2d::{ModulusCurve, OrthotropicMaterial, Quad};
use crate::reinforced_plate::{self, ReinforcementEnvelope, ReinforcementSpec};
use crate::{positive, Analysis, MaterialLaw};

mod fiber;
pub use fiber::{
    solve_with_fiber_sections, FiberElementResult, FiberMaterialPointResult, FiberPlateResult,
    FiberQuad,
};

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
    #[serde(default)]
    pub orthotropic_materials: Vec<OrthotropicMaterial>,
    pub quads: Vec<Quad>,
    #[serde(default)]
    pub supports: Vec<Support>,
    #[serde(default)]
    pub loads: Vec<Load>,
    /// Line loads on a quad edge, following the element's node order.
    #[serde(default)]
    pub edge_loads: Vec<EdgeLoad>,
    #[serde(default)]
    pub pressure_kn_m2: f64,
    #[serde(default)]
    pub quad_pressures: Vec<QuadPressure>,
    #[serde(default)]
    pub modulus_curves: Vec<ModulusCurve>,
    #[serde(default)]
    pub reinforcement: Option<ReinforcementSpec>,
    #[serde(default)]
    pub load_path: Vec<f64>,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
    #[serde(default = "default_iterations")]
    pub max_iterations: usize,
    #[serde(default)]
    pub linear_backend: LinearBackend,
    /// Maximum free DOFs in the active frontal wave; defaults to 4096.
    #[serde(default)]
    pub frontal_max_front_dofs: Option<usize>,
}

/// Extra pressure at the four quad corners, in the order of `Quad::node_ids`.
/// The bilinear pressure field is added to the uniform `pressure_kn_m2`.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuadPressure {
    pub quad_id: usize,
    pub nodal_pressure_kn_m2: [f64; 4],
}

/// Line load normal to the plate, varying linearly from the first to the
/// second endpoint of one element edge. Units are kN/m.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EdgeLoad {
    pub quad_id: usize,
    /// Edge 0–3 connects local quad nodes `edge_index` and `(edge_index + 1) % 4`.
    pub edge_index: usize,
    pub start_kn_per_m: f64,
    pub end_kn_per_m: f64,
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
    /// Resultants at the 4x4 Gauss points and the element centre/corners.
    /// Shear includes the same neighbour patch recovery used by reinforcement checks.
    pub resultant_samples: Vec<ResultantSample>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reinforcement: Option<ReinforcementEnvelope>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultantSample {
    pub position_m: [f64; 2],
    pub moment_knm_per_m: [f64; 3],
    pub shear_kn_per_m: [f64; 2],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultBending {
    pub nodes: Vec<NodeResult>,
    pub elements: Vec<ElementResult>,
    pub iterations: usize,
    pub relative_residual: f64,
    pub linear_backend_used: LinearBackend,
    pub frontal_maximum_front_dofs: Option<usize>,
}

/// Geometrically nonlinear shallow-shell analysis. Bending keeps the
/// four-node hybrid Kirchhoff element; membrane and von Kármán coupling use
/// the same four-node mesh. The shell has [u, v, w, theta_x, theta_y] DOFs.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GeometricShellRequest {
    pub bending: Request,
    #[serde(default)]
    pub analysis: Analysis,
    /// Optional material laws keyed by material ID. Omitted IDs remain elastic.
    #[serde(default)]
    pub material_laws: HashMap<usize, MaterialLaw>,
    #[serde(default)]
    pub membrane_supports: Vec<MembraneSupport>,
    #[serde(default)]
    pub membrane_loads: Vec<MembraneLoad>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MembraneSupport {
    pub node_id: usize,
    #[serde(default)]
    pub u: bool,
    #[serde(default)]
    pub v: bool,
    #[serde(default)]
    pub ku_kn_per_m: Option<f64>,
    #[serde(default)]
    pub kv_kn_per_m: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MembraneLoad {
    pub node_id: usize,
    pub fx_kn: f64,
    pub fy_kn: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometricShellNodeResult {
    pub node_id: usize,
    pub u_m: f64,
    pub v_m: f64,
    pub w_m: f64,
    pub theta_x_rad: f64,
    pub theta_y_rad: f64,
    pub reaction_fx_kn: f64,
    pub reaction_fy_kn: f64,
    pub reaction_fz_kn: f64,
    pub reaction_mx_knm: f64,
    pub reaction_my_knm: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometricShellElementResult {
    pub quad_id: usize,
    /// Material-coordinate second-Piola [nx, ny, nxy] in kN/m at the centre.
    pub membrane_kn_per_m: [f64; 3],
    pub moment_knm_per_m: [f64; 3],
    pub effective_e_mpa: f64,
    pub max_fibre_strain: f64,
    pub max_combined_strain: f64,
    /// Maximum irreversible plane-stress plastic strain in the shell membrane.
    pub max_equivalent_plastic_strain: f64,
    /// Maximum tensile damage in the shell membrane, between 0 (intact) and 1.
    pub max_tensile_damage: f64,
    /// Persistent constitutive state at every 4x4 membrane integration point.
    pub material_points: Vec<GeometricShellMaterialPointResult>,
    pub resultant_samples: Vec<GeometricShellResultantSample>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reinforcement: Option<ReinforcementEnvelope>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometricShellMaterialPointResult {
    /// [i, j] index into the 4x4 Gauss rule.
    pub gauss_index: [usize; 2],
    pub position_m: [f64; 2],
    /// Green-Lagrange [epsilon_x, epsilon_y, gamma_xy] at this point.
    pub membrane_strain: [f64; 3],
    pub equivalent_plastic_strain: f64,
    pub tensile_damage: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometricShellResultantSample {
    pub position_m: [f64; 2],
    pub membrane_kn_per_m: [f64; 3],
    pub moment_knm_per_m: [f64; 3],
    pub shear_kn_per_m: [f64; 2],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometricShellResult {
    pub nodes: Vec<GeometricShellNodeResult>,
    pub elements: Vec<GeometricShellElementResult>,
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

#[derive(Clone)]
struct HybridElement {
    id: usize,
    dofs: [usize; 12],
    base_k: [[f64; 12]; 12],
    /// Moment coefficients for unit E (MPa) times the nodal displacement.
    beta: [[f64; 12]; 17],
    /// Boundary compatibility matrix before constitutive condensation.
    g: [[f64; 12]; 17],
    centre: [f64; 2],
    scale: f64,
    /// P_ab = integral N_a N_b dA for a bilinear pressure and displacement surrogate.
    pressure_matrix: [[f64; 4]; 4],
    /// Per edge: length, tangent x/y, outward normal x/y.
    edges: [[f64; 5]; 4],
    sample_points: Vec<[f64; 2]>,
    sample_natural_coordinates: Vec<[f64; 2]>,
    thickness: f64,
    material_id: usize,
    base_e: f64,
    /// Inverse bending stiffness for unit base E, in curvature/resultant units.
    compliance: [[f64; 3]; 3],
    /// ε0 = neutral_strain_per_curvature · κ when membrane force is zero.
    neutral_strain_per_curvature: Option<[[f64; 3]; 3]>,
    orthotropic: Option<OrthotropicMaterial>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ElasticLayeredQuad {
    pub quad_id: usize,
    /// Layers are ordered from the negative-z to the positive-z face.
    pub layers: Vec<PlateFiberLayer>,
}

#[derive(Clone, Copy)]
struct LayeredElasticResponse {
    /// E_ref D_eff^-1; the existing hybrid assembly subsequently multiplies
    /// its condensed stiffness and recovered moment by E_ref.
    compliance: [[f64; 3]; 3],
    neutral_strain_per_curvature: [[f64; 3]; 3],
}

fn layered_elastic_response(
    reference_e: f64,
    section: &PlateFiberSection,
) -> Result<LayeredElasticResponse, String> {
    let trial = section.trial([0.0; 6], &section.initial_state())?;
    let effective_d = section.effective_bending_tangent(&trial)?;
    let tangent = trial.tangent;
    let a = std::array::from_fn(|i| std::array::from_fn(|j| 0.5 * (tangent[i][j] + tangent[j][i])));
    let inverse_a = invert_symmetric_3(a)?;
    let b: [[f64; 3]; 3] = std::array::from_fn(|i| {
        std::array::from_fn(|j| 0.5 * (tangent[i][j + 3] + tangent[j + 3][i]))
    });
    let neutral_strain_per_curvature: [[f64; 3]; 3] = std::array::from_fn(|i| {
        std::array::from_fn(|j| -(0..3).map(|k| inverse_a[i][k] * b[k][j]).sum::<f64>())
    });
    let inverse_d = invert_symmetric_3(effective_d)?;
    Ok(LayeredElasticResponse {
        compliance: inverse_d.map(|row| row.map(|value| reference_e * value)),
        neutral_strain_per_curvature,
    })
}

/// Elastic, plane-stress layered bending with free membrane extension N=0.
/// This uses the same 17-parameter hybrid moment field as `solve`. The plate
/// section provides the A/B/D tangent; each quad has its own layer stack.
pub fn solve_with_elastic_layered_sections(
    request: &Request,
    sections: &[ElasticLayeredQuad],
) -> Result<ResultBending, String> {
    if !request.modulus_curves.is_empty()
        || !request.orthotropic_materials.is_empty()
        || request.reinforcement.is_some()
    {
        return Err("layered elastic hybrid plate does not support modulus curves, orthotropy, or reinforcement".into());
    }
    let mut section_by_quad = HashMap::new();
    let quad_ids: HashSet<_> = request.quads.iter().map(|quad| quad.id).collect();
    for item in sections {
        if !quad_ids.contains(&item.quad_id) {
            return Err("unknown layered hybrid quad".into());
        }
        if item
            .layers
            .iter()
            .any(|layer| !matches!(layer.law, MaterialLaw::Elastic))
        {
            return Err("layered hybrid plate currently supports elastic fibers only".into());
        }
        let quad = request
            .quads
            .iter()
            .find(|quad| quad.id == item.quad_id)
            .unwrap();
        let reference_e = request
            .materials
            .iter()
            .find(|material| material.id == quad.material_id)
            .ok_or("unknown hybrid quad material")?
            .e_mpa;
        positive(reference_e, "layered hybrid reference E")?;
        let section = PlateFiberSection::new(&item.layers)?;
        if (section.thickness_m() - quad.thickness_m).abs()
            > 1e-10 * quad.thickness_m.abs().max(section.thickness_m())
        {
            return Err("layered hybrid section thickness differs from quad thickness".into());
        }
        let response = layered_elastic_response(reference_e, &section)?;
        if section_by_quad.insert(item.quad_id, response).is_some() {
            return Err("duplicate layered hybrid quad".into());
        }
    }
    if section_by_quad.len() != request.quads.len() {
        return Err("layered hybrid plate requires a section for every quad".into());
    }
    solve_internal(request, Some(&section_by_quad))
}

#[cfg(test)]
fn element(
    quad: &Quad,
    nodes: [&Node; 4],
    dofs: [usize; 12],
    material: &Material,
) -> Result<HybridElement, String> {
    element_with_orthotropic(quad, nodes, dofs, material, None)
}

fn invert_symmetric_3(matrix: [[f64; 3]; 3]) -> Result<[[f64; 3]; 3], String> {
    let maximum = matrix.iter().flatten().map(|v| v.abs()).fold(0.0, f64::max);
    if !maximum.is_finite() || maximum == 0.0 {
        return Err("plate bending constitutive matrix is not positive definite".into());
    }
    let mut lower = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..=i {
            if (matrix[i][j] - matrix[j][i]).abs() > 1e-10 * maximum {
                return Err("plate bending constitutive matrix is not symmetric".into());
            }
            let mut value = 0.5 * (matrix[i][j] + matrix[j][i]);
            for k in 0..j {
                value -= lower[i][k] * lower[j][k];
            }
            if i == j {
                if !value.is_finite() || value <= 1e-12 * maximum {
                    return Err("plate bending constitutive matrix is not positive definite".into());
                }
                lower[i][j] = value.sqrt();
            } else {
                lower[i][j] = value / lower[j][j];
            }
        }
    }
    let mut inverse = [[0.0; 3]; 3];
    for column in 0..3 {
        let mut intermediate = [0.0; 3];
        for i in 0..3 {
            let mut value = if i == column { 1.0 } else { 0.0 };
            for j in 0..i {
                value -= lower[i][j] * intermediate[j];
            }
            intermediate[i] = value / lower[i][i];
        }
        for i in (0..3).rev() {
            let mut value = intermediate[i];
            for j in (i + 1)..3 {
                value -= lower[j][i] * inverse[j][column];
            }
            inverse[i][column] = value / lower[i][i];
        }
    }
    if !inverse.iter().flatten().all(|value| value.is_finite()) {
        return Err("plate bending constitutive inverse is not finite".into());
    }
    Ok(inverse)
}

fn bending_compliance(
    nu: f64,
    orthotropic: Option<&OrthotropicMaterial>,
    thickness: f64,
) -> Result<[[f64; 3]; 3], String> {
    let scale = 1000.0 * thickness.powi(3) / 12.0;
    let stiffness = if let Some(material) = orthotropic {
        let nu21 = material.nu12 * material.e2_mpa / material.e1_mpa;
        let denominator = 1.0 - material.nu12 * nu21;
        let local = [
            [
                1.0 / denominator,
                material.nu12 * material.e2_mpa / material.e1_mpa / denominator,
                0.0,
            ],
            [
                material.nu12 * material.e2_mpa / material.e1_mpa / denominator,
                material.e2_mpa / material.e1_mpa / denominator,
                0.0,
            ],
            [0.0, 0.0, material.g12_mpa / material.e1_mpa],
        ];
        let (s, c) = material.angle_rad.sin_cos();
        let transform = [
            [c * c, s * s, c * s],
            [s * s, c * c, -c * s],
            [-2.0 * c * s, 2.0 * c * s, c * c - s * s],
        ];
        std::array::from_fn(|i| {
            std::array::from_fn(|j| {
                scale
                    * (0..3)
                        .flat_map(|a| {
                            (0..3).map(move |b| transform[a][i] * local[a][b] * transform[b][j])
                        })
                        .sum::<f64>()
            })
        })
    } else {
        let factor = scale / (1.0 - nu * nu);
        [
            [factor, factor * nu, 0.0],
            [factor * nu, factor, 0.0],
            [0.0, 0.0, factor * (1.0 - nu) / 2.0],
        ]
    };
    invert_symmetric_3(stiffness)
}

fn element_with_orthotropic(
    quad: &Quad,
    nodes: [&Node; 4],
    dofs: [usize; 12],
    material: &Material,
    orthotropic: Option<&OrthotropicMaterial>,
) -> Result<HybridElement, String> {
    element_with_constitutive(quad, nodes, dofs, material, orthotropic, None)
}

fn element_with_constitutive(
    quad: &Quad,
    nodes: [&Node; 4],
    dofs: [usize; 12],
    material: &Material,
    orthotropic: Option<&OrthotropicMaterial>,
    layered: Option<LayeredElasticResponse>,
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
    let mut pressure_matrix = [[0.0; 4]; 4];
    let mut sample_points: Vec<[f64; 2]> = nodes.iter().map(|n| [n.x, n.y]).collect();
    let mut sample_natural_coordinates = vec![[-1.0, -1.0], [1.0, -1.0], [1.0, 1.0], [-1.0, 1.0]];
    sample_points.push(centre);
    sample_natural_coordinates.push([0.0, 0.0]);
    let compliance = if let Some(layered) = layered {
        layered.compliance
    } else {
        bending_compliance(material.nu, orthotropic, quad.thickness_m)?
    };
    for i in 0..NGAUSS {
        for j in 0..NGAUSS {
            let (x, y, jac) = geometry(nodes, ROOTS[i], ROOTS[j])?;
            sample_points.push([x, y]);
            sample_natural_coordinates.push([ROOTS[i], ROOTS[j]]);
            let weight = WEIGHTS[i] * WEIGHTS[j] * jac;
            let (shape_values, _, _) = shape(ROOTS[i], ROOTS[j]);
            for a in 0..4 {
                for b in 0..4 {
                    pressure_matrix[a][b] += weight * shape_values[a] * shape_values[b];
                }
            }
            let fs = fields((x - centre[0]) / scale, (y - centre[1]) / scale, scale);
            for a in 0..17 {
                for b in 0..17 {
                    let ma = fs[a].moment;
                    let mb = fs[b].moment;
                    let complementary_energy = (0..3)
                        .map(|i| {
                            (0..3)
                                .map(|j| ma[i] * compliance[i][j] * mb[j])
                                .sum::<f64>()
                        })
                        .sum::<f64>();
                    h.add(a, b, weight * complementary_energy);
                }
            }
        }
    }
    let mut edges = [[0.0; 5]; 4];
    for (edge, (a, b)) in [(0, 1), (1, 2), (2, 3), (3, 0)].into_iter().enumerate() {
        let dx = nodes[b].x - nodes[a].x;
        let dy = nodes[b].y - nodes[a].y;
        let length = (dx * dx + dy * dy).sqrt();
        positive(length, "hybrid plate edge")?;
        let tangent = [dx / length, dy / length];
        let normal = [tangent[1], -tangent[0]];
        edges[edge] = [length, tangent[0], tangent[1], normal[0], normal[1]];
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
        g,
        centre,
        scale,
        pressure_matrix,
        edges,
        sample_points,
        sample_natural_coordinates,
        thickness: quad.thickness_m,
        material_id: quad.material_id,
        base_e: material.e_mpa,
        compliance,
        neutral_strain_per_curvature: layered.map(|value| value.neutral_strain_per_curvature),
        orthotropic: orthotropic.copied(),
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

/// Patch recovery of a linear shear field from neighbouring element centres.
/// Pressure is applied as nodal loads, so the homogeneous hybrid moment
/// field lacks the pressure-induced shear gradient within an element.
fn recovered_shear_gradient(
    index: usize,
    elements: &[HybridElement],
    results: &[ElementResult],
) -> [[f64; 2]; 2] {
    let centre = elements[index].centre;
    let base = results[index].shear_kn_per_m;
    let radius2 = (1.6 * elements[index].scale).powi(2);
    let (mut sxx, mut sxy, mut syy) = (0.0, 0.0, 0.0);
    let mut rhs = [[0.0; 2]; 2];
    for (j, other) in elements.iter().enumerate() {
        if j == index {
            continue;
        }
        let dx = other.centre[0] - centre[0];
        let dy = other.centre[1] - centre[1];
        let d2 = dx * dx + dy * dy;
        if d2 < 1e-16 || d2 > radius2 {
            continue;
        }
        let w = 1.0 / d2;
        sxx += w * dx * dx;
        sxy += w * dx * dy;
        syy += w * dy * dy;
        for component in 0..2 {
            let delta = results[j].shear_kn_per_m[component] - base[component];
            rhs[component][0] += w * dx * delta;
            rhs[component][1] += w * dy * delta;
        }
    }
    let determinant = sxx * syy - sxy * sxy;
    if determinant > (sxx + syy).powi(2) * 1e-10 {
        return std::array::from_fn(|component| {
            [
                (syy * rhs[component][0] - sxy * rhs[component][1]) / determinant,
                (sxx * rhs[component][1] - sxy * rhs[component][0]) / determinant,
            ]
        });
    }
    let trace = sxx + syy;
    if trace <= 1e-12 {
        return [[0.0; 2]; 2];
    }
    let lambda = 0.5 * (trace + ((sxx - syy).powi(2) + 4.0 * sxy * sxy).sqrt());
    let mut axis = if sxy.abs() > 1e-12 {
        [lambda - syy, sxy]
    } else if sxx >= syy {
        [1.0, 0.0]
    } else {
        [0.0, 1.0]
    };
    let norm = axis[0].hypot(axis[1]);
    axis = [axis[0] / norm, axis[1] / norm];
    std::array::from_fn(|component| {
        let projection = (rhs[component][0] * axis[0] + rhs[component][1] * axis[1]) / lambda;
        [projection * axis[0], projection * axis[1]]
    })
}

fn max_fibre_strain(element: &HybridElement, local: &[f64; 12], e_mpa: f64) -> f64 {
    let mut maximum = 0.0_f64;
    for [x, y] in &element.sample_points {
        let (m, _) = moment(element, local, e_mpa, *x, *y);
        let curvature: [f64; 3] = std::array::from_fn(|i| {
            (0..3)
                .map(|j| element.compliance[i][j] * m[j] / e_mpa)
                .sum()
        });
        let neutral = element
            .neutral_strain_per_curvature
            .map_or([0.0; 3], |coupling| {
                std::array::from_fn(|i| (0..3).map(|j| coupling[i][j] * curvature[j]).sum::<f64>())
            });
        for z in [-0.5 * element.thickness, 0.5 * element.thickness] {
            let [ex, ey, gamma] = std::array::from_fn(|i| neutral[i] + z * curvature[i]);
            let centre = 0.5 * (ex + ey);
            // γxy is engineering shear, so tensor εxy=γxy/2.
            let radius = ((0.5 * (ex - ey)).powi(2) + (0.5 * gamma).powi(2)).sqrt();
            maximum = maximum.max(centre.abs() + radius);
        }
    }
    maximum
}

fn frontal_linear_elements(
    elements: &[HybridElement],
    springs: &[(usize, f64)],
) -> Vec<FrontalElement> {
    let mut frontal_elements: Vec<FrontalElement> = elements
        .iter()
        .map(|element| FrontalElement {
            dofs: element.dofs.to_vec(),
            stiffness: element
                .base_k
                .iter()
                .flat_map(|row| row.iter().map(|value| element.base_e * value))
                .collect(),
        })
        .collect();
    // Insert a spring no later than the final plate element touching its DOF.
    // Otherwise the frontal solver may have already eliminated that DOF.
    for &(dof, stiffness) in springs {
        if let Some(element) = frontal_elements
            .iter_mut()
            .rev()
            .find(|element| element.dofs.contains(&dof))
        {
            let local = element.dofs.iter().position(|&item| item == dof).unwrap();
            let width = element.dofs.len();
            element.stiffness[local * width + local] += stiffness;
        } else {
            frontal_elements.push(FrontalElement {
                dofs: vec![dof],
                stiffness: vec![stiffness],
            });
        }
    }
    frontal_elements
}

pub fn solve(request: &Request) -> Result<ResultBending, String> {
    solve_internal(request, None)
}

fn solve_internal(
    request: &Request,
    layered_sections: Option<&HashMap<usize, LayeredElasticResponse>>,
) -> Result<ResultBending, String> {
    if request.nodes.len() < 4 || request.quads.is_empty() {
        return Err("hybrid plate requires quads".into());
    }
    if !request.pressure_kn_m2.is_finite() {
        return Err("non-finite plate pressure".into());
    }
    let mut quad_pressures = HashMap::new();
    for pressure in &request.quad_pressures {
        if !pressure
            .nodal_pressure_kn_m2
            .iter()
            .all(|value| value.is_finite())
        {
            return Err("non-finite hybrid quad pressure".into());
        }
        if quad_pressures.insert(pressure.quad_id, pressure).is_some() {
            return Err("duplicate hybrid quad pressure".into());
        }
    }
    positive(request.tolerance, "hybrid tolerance")?;
    if request.max_iterations == 0 || request.max_iterations > 200 {
        return Err("invalid hybrid iteration limit".into());
    }
    if request.linear_backend == LinearBackend::FrontalWave && !request.modulus_curves.is_empty() {
        return Err(
            "frontalWave hybrid plate requires elastic material without modulus curves".into(),
        );
    }
    let node_index: HashMap<usize, usize> = request
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id, i))
        .collect();
    if node_index.len() != request.nodes.len() {
        return Err("duplicate hybrid node id".into());
    }
    if request.nodes.len() > 20_000 / 3 {
        return Err("hybrid plate exceeds the 20,000-DOF solver limit".into());
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
    let mut orthotropic_materials = HashMap::new();
    for orthotropic in &request.orthotropic_materials {
        if orthotropic_materials
            .insert(orthotropic.material_id, orthotropic)
            .is_some()
        {
            return Err("duplicate orthotropic hybrid material id".into());
        }
        let material = materials
            .get(&orthotropic.material_id)
            .ok_or("unknown orthotropic hybrid material")?;
        positive(orthotropic.e1_mpa, "orthotropic hybrid E1")?;
        positive(orthotropic.e2_mpa, "orthotropic hybrid E2")?;
        positive(orthotropic.g12_mpa, "orthotropic hybrid G12")?;
        if !orthotropic.nu12.is_finite() || !orthotropic.angle_rad.is_finite() {
            return Err("non-finite orthotropic hybrid parameter".into());
        }
        let nu21 = orthotropic.nu12 * orthotropic.e2_mpa / orthotropic.e1_mpa;
        if !(1.0 - orthotropic.nu12 * nu21 > 0.0) {
            return Err("orthotropic hybrid bending stiffness is not positive definite".into());
        }
        if (material.e_mpa - orthotropic.e1_mpa).abs() > orthotropic.e1_mpa * 1e-10 {
            return Err("hybrid material E must equal orthotropic E1 for secant scaling".into());
        }
    }
    if request.reinforcement.is_some() && !orthotropic_materials.is_empty() {
        return Err(
            "hybrid reinforcement postprocessing currently requires isotropic bending material"
                .into(),
        );
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
        if let Some(spec) = &request.reinforcement {
            spec.validate(quad.thickness_m)?;
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
        elements.push(element_with_constitutive(
            quad,
            indices.map(|i| &request.nodes[i]),
            std::array::from_fn(|j| 3 * indices[j / 3] + j % 3),
            material,
            orthotropic_materials.get(&quad.material_id).copied(),
            layered_sections.and_then(|sections| sections.get(&quad.id).copied()),
        )?);
    }
    if quad_pressures.keys().any(|id| !ids.contains(id)) {
        return Err("unknown hybrid pressure quad".into());
    }
    let mut edge_loads: HashMap<usize, Vec<&EdgeLoad>> = HashMap::new();
    for edge_load in &request.edge_loads {
        if !ids.contains(&edge_load.quad_id) {
            return Err("unknown hybrid edge-load quad".into());
        }
        if edge_load.edge_index > 3 {
            return Err("hybrid edge-load index must be between 0 and 3".into());
        }
        if !edge_load.start_kn_per_m.is_finite() || !edge_load.end_kn_per_m.is_finite() {
            return Err("non-finite hybrid edge load".into());
        }
        edge_loads
            .entry(edge_load.quad_id)
            .or_default()
            .push(edge_load);
    }
    let dofs = 3 * request.nodes.len();
    let springs = collect_support_springs(&request.supports, &node_index, 3, [0, 1, 2])?;
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
        let extra = quad_pressures
            .get(&element.id)
            .map_or([0.0; 4], |pressure| pressure.nodal_pressure_kn_m2);
        for j in 0..4 {
            load[element.dofs[3 * j]] += (0..4)
                .map(|a| element.pressure_matrix[j][a] * (request.pressure_kn_m2 + extra[a]))
                .sum::<f64>();
        }
        if let Some(element_edge_loads) = edge_loads.get(&element.id) {
            for edge_load in element_edge_loads {
                let edge = edge_load.edge_index;
                let next_node = (edge + 1) % 4;
                let [length, tx, ty, nx, ny] = element.edges[edge];
                for q in 0..NGAUSS {
                    let s = 0.5 * (ROOTS[q] + 1.0);
                    let line_load =
                        edge_load.start_kn_per_m * (1.0 - s) + edge_load.end_kn_per_m * s;
                    let weighted_load = length * WEIGHTS[q] * 0.5 * line_load;
                    for local_dof in 0..12 {
                        let (w, _) = edge_kinematics(
                            local_dof,
                            edge,
                            next_node,
                            s,
                            length,
                            [tx, ty],
                            [nx, ny],
                        );
                        load[element.dofs[local_dof]] += weighted_load * w;
                    }
                }
            }
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
    let mut frontal_maximum_front_dofs = None;
    if request.linear_backend == LinearBackend::FrontalWave {
        let frontal_elements = frontal_linear_elements(&elements, &springs);
        let final_load: Vec<f64> = load.iter().map(|value| end_factor(&path) * value).collect();
        let solved = frontal::solve(
            &frontal_elements,
            &final_load,
            &prescribed,
            FrontalOptions {
                max_front_dofs: request
                    .frontal_max_front_dofs
                    .unwrap_or(FrontalOptions::default().max_front_dofs),
                ..FrontalOptions::default()
            },
        )?;
        u = solved.displacements;
        frontal_maximum_front_dofs = Some(solved.maximum_front_dofs);
        iterations = 1;
        for (index, element) in elements.iter().enumerate() {
            let local = element.dofs.map(|dof| u[dof]);
            peak[index] = max_fibre_strain(element, &local, e_current[index]);
        }
    } else {
        let mut inertia_factor_available = None;
        let check_each_tangent = !curves.is_empty();
        let mut start = 0.0;
        let steps = if curves.is_empty() { 1 } else { 10 };
        for &end in &path {
            for step in 1..=steps {
                let mut accepted_factor = start + (end - start) * (step - 1) as f64 / steps as f64;
                let planned_factor = start + (end - start) * step as f64 / steps as f64;
                let mut target_factor = planned_factor;
                let mut cutbacks = 0;
                loop {
                    let mut trial_e = e_current.clone();
                    let mut trial_u = u.clone();
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
                                        trial_e[index] * element.base_k[i][j],
                                    );
                                }
                            }
                        }
                        add_support_spring_stiffness(&springs, &mut k);
                        if inertia_factor_available.is_none()
                            || (check_each_tangent && inertia_factor_available == Some(true))
                        {
                            inertia_factor_available =
                                Some(check_sparse_inertia_if_fits(&k, &prescribed)?);
                        }
                        let target: Vec<f64> = load.iter().map(|f| target_factor * f).collect();
                        let (candidate, _) = constrained_solve(&k, &target, &prescribed)?;
                        let mut next_e = trial_e.clone();
                        for (index, element) in elements.iter().enumerate() {
                            if let Some(curve) = curves.get(&element.material_id) {
                                let local = element.dofs.map(|j| candidate[j]);
                                let strain = max_fibre_strain(element, &local, trial_e[index]);
                                next_e[index] = curve.e_at(peak[index].max(strain));
                            }
                        }
                        let change = next_e
                            .iter()
                            .zip(&trial_e)
                            .map(|(a, b)| (a - b).abs() / b)
                            .fold(0.0_f64, f64::max);
                        trial_u = candidate;
                        trial_e = next_e;
                        if change < request.tolerance {
                            converged = true;
                            break;
                        }
                    }
                    if converged {
                        u = trial_u;
                        e_current = trial_e;
                        for (index, element) in elements.iter().enumerate() {
                            let local = element.dofs.map(|j| u[j]);
                            peak[index] = peak[index].max(max_fibre_strain(
                                element,
                                &local,
                                e_current[index],
                            ));
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
                            "hybrid material iteration did not converge after cutbacks near load factor {target_factor} (last converged {accepted_factor})"
                        ));
                        }
                        target_factor = accepted_factor + 0.5 * (target_factor - accepted_factor);
                    }
                }
            }
            start = end;
        }
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
    for &(dof, stiffness) in &springs {
        internal[dof] += stiffness * u[dof];
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
                support_spring_reaction(&springs, &u, 3 * i)
            },
            reaction_mx_knm: if prescribed[3 * i + 1].is_some() {
                residual[3 * i + 1]
            } else {
                support_spring_reaction(&springs, &u, 3 * i + 1)
            },
            reaction_my_knm: if prescribed[3 * i + 2].is_some() {
                residual[3 * i + 2]
            } else {
                support_spring_reaction(&springs, &u, 3 * i + 2)
            },
        })
        .collect();
    let mut element_results = elements
        .iter()
        .enumerate()
        .map(|(i, element)| {
            let local = element.dofs.map(|j| u[j]);
            let (centre_moment, centre_shear) = moment(
                element,
                &local,
                e_current[i],
                element.centre[0],
                element.centre[1],
            );
            ElementResult {
                quad_id: element.id,
                moment_knm_per_m: centre_moment,
                shear_kn_per_m: centre_shear,
                effective_e_mpa: e_current[i],
                max_fibre_strain: peak[i],
                resultant_samples: Vec::new(),
                reinforcement: None,
            }
        })
        .collect::<Vec<_>>();
    for (i, element) in elements.iter().enumerate() {
        let local = element.dofs.map(|j| u[j]);
        let gradient = recovered_shear_gradient(i, &elements, &element_results);
        let centre_shear = element_results[i].shear_kn_per_m;
        let samples: Vec<_> = element
            .sample_points
            .iter()
            .map(|point| {
                let (m, _) = moment(element, &local, e_current[i], point[0], point[1]);
                let offset = [point[0] - element.centre[0], point[1] - element.centre[1]];
                let v = std::array::from_fn(|component| {
                    centre_shear[component]
                        + gradient[component][0] * offset[0]
                        + gradient[component][1] * offset[1]
                });
                (*point, m, v)
            })
            .collect();
        element_results[i].resultant_samples = samples
            .iter()
            .map(
                |(position_m, moment_knm_per_m, shear_kn_per_m)| ResultantSample {
                    position_m: *position_m,
                    moment_knm_per_m: *moment_knm_per_m,
                    shear_kn_per_m: *shear_kn_per_m,
                },
            )
            .collect();
        if let Some(spec) = &request.reinforcement {
            element_results[i].reinforcement = Some(reinforced_plate::envelope(
                spec,
                element.thickness,
                element.base_e,
                &samples,
            )?);
        }
    }
    Ok(ResultBending {
        nodes,
        elements: element_results,
        iterations,
        relative_residual,
        linear_backend_used: request.linear_backend,
        frontal_maximum_front_dofs,
    })
}

/// Solve a shallow shell with von Kármán membrane strains, hybrid plate
/// bending, and optional elementwise irreversible secant-E histories.
pub fn solve_geometric_shell(
    request: &GeometricShellRequest,
) -> Result<GeometricShellResult, String> {
    let plate = &request.bending;
    if plate.linear_backend == LinearBackend::FrontalWave {
        return Err(
            "frontalWave hybrid plate is unavailable for shell analysis, including GNL/FNL".into(),
        );
    }
    if plate.nodes.len() < 4 || plate.quads.is_empty() {
        return Err("geometric shell requires four-node plate quads".into());
    }
    positive(plate.tolerance, "geometric shell tolerance")?;
    if plate.max_iterations == 0 || plate.max_iterations > 200 {
        return Err("invalid geometric shell iteration limit".into());
    }
    if !plate.pressure_kn_m2.is_finite() {
        return Err("non-finite geometric shell pressure".into());
    }
    let mut quad_pressures = HashMap::new();
    for pressure in &plate.quad_pressures {
        if !pressure
            .nodal_pressure_kn_m2
            .iter()
            .all(|value| value.is_finite())
        {
            return Err("non-finite geometric shell quad pressure".into());
        }
        if quad_pressures.insert(pressure.quad_id, pressure).is_some() {
            return Err("duplicate geometric shell quad pressure".into());
        }
    }
    let node_index: HashMap<usize, usize> = plate
        .nodes
        .iter()
        .enumerate()
        .map(|(i, node)| (node.id, i))
        .collect();
    if node_index.len() != plate.nodes.len() {
        return Err("duplicate geometric shell node id".into());
    }
    if 5 * plate.nodes.len() > 20_000 {
        return Err("geometric shell exceeds the 20,000-DOF solver limit".into());
    }
    let materials: HashMap<usize, &Material> = plate.materials.iter().map(|m| (m.id, m)).collect();
    if materials.len() != plate.materials.len() {
        return Err("duplicate geometric shell material".into());
    }
    let mut orthotropic_materials = HashMap::new();
    for orthotropic in &plate.orthotropic_materials {
        if orthotropic_materials
            .insert(orthotropic.material_id, orthotropic)
            .is_some()
        {
            return Err("duplicate orthotropic geometric shell material id".into());
        }
        let material = materials
            .get(&orthotropic.material_id)
            .ok_or("unknown orthotropic geometric shell material")?;
        positive(orthotropic.e1_mpa, "orthotropic geometric shell E1")?;
        positive(orthotropic.e2_mpa, "orthotropic geometric shell E2")?;
        positive(orthotropic.g12_mpa, "orthotropic geometric shell G12")?;
        if !orthotropic.nu12.is_finite() || !orthotropic.angle_rad.is_finite() {
            return Err("non-finite orthotropic geometric shell parameter".into());
        }
        let nu21 = orthotropic.nu12 * orthotropic.e2_mpa / orthotropic.e1_mpa;
        if !(1.0 - orthotropic.nu12 * nu21 > 0.0) {
            return Err("orthotropic geometric shell stiffness is not positive definite".into());
        }
        if (material.e_mpa - orthotropic.e1_mpa).abs() > orthotropic.e1_mpa * 1e-10 {
            return Err("geometric shell material E must equal orthotropic E1".into());
        }
        if request
            .material_laws
            .get(&orthotropic.material_id)
            .is_some_and(|law| !matches!(law, MaterialLaw::Elastic))
        {
            return Err(
                "orthotropic geometric shell currently requires elastic material law".into(),
            );
        }
    }
    if plate.reinforcement.is_some() && !orthotropic_materials.is_empty() {
        return Err("geometric shell reinforcement postprocessing currently requires isotropic bending material".into());
    }
    for (&material_id, law) in &request.material_laws {
        if !materials.contains_key(&material_id) {
            return Err("unknown geometric shell material law ID".into());
        }
        match *law {
            MaterialLaw::Elastic => {}
            MaterialLaw::SteelBilinear {
                yield_mpa,
                hardening_ratio,
            } => {
                positive(yield_mpa, "geometric shell steel yield")?;
                if !(0.0..=1.0).contains(&hardening_ratio) {
                    return Err("invalid geometric shell steel hardening ratio".into());
                }
            }
            MaterialLaw::ConcreteCracking {
                tensile_mpa,
                residual_ratio,
            } => {
                positive(tensile_mpa, "geometric shell concrete tensile strength")?;
                if !(0.0..=1.0).contains(&residual_ratio) {
                    return Err("invalid geometric shell concrete residual ratio".into());
                }
            }
        }
    }
    let mut curves = HashMap::new();
    for curve in &plate.modulus_curves {
        let material = materials
            .get(&curve.material_id)
            .ok_or("unknown geometric shell modulus material")?;
        if curves.insert(curve.material_id, curve).is_some() {
            return Err("duplicate geometric shell modulus curve".into());
        }
        if curve.points.len() < 2
            || curve.points[0].strain != 0.0
            || (curve.points[0].e_mpa - material.e_mpa).abs() > material.e_mpa * 1e-10
        {
            return Err(
                "geometric shell E(strain) curve must start at zero strain and material E".into(),
            );
        }
        for point in &curve.points {
            positive(point.e_mpa, "geometric shell modulus E")?;
            if !point.strain.is_finite() || point.strain < 0.0 {
                return Err("invalid geometric shell modulus strain".into());
            }
        }
        if curve
            .points
            .windows(2)
            .any(|pair| pair[1].strain <= pair[0].strain || pair[1].e_mpa > pair[0].e_mpa)
        {
            return Err(
                "geometric shell modulus strain must increase and E must not increase".into(),
            );
        }
    }
    let mut elements = Vec::with_capacity(plate.quads.len());
    let mut quad_ids = HashSet::new();
    for quad in &plate.quads {
        if !quad_ids.insert(quad.id) {
            return Err("duplicate geometric shell quad id".into());
        }
        let indices = quad.node_ids.map(|id| {
            node_index
                .get(&id)
                .copied()
                .ok_or("unknown geometric shell quad node")
        });
        let indices = [indices[0]?, indices[1]?, indices[2]?, indices[3]?];
        if indices.iter().copied().collect::<HashSet<_>>().len() != 4 {
            return Err("geometric shell quad repeats node".into());
        }
        let material = materials
            .get(&quad.material_id)
            .ok_or("unknown geometric shell material")?;
        if let Some(spec) = &plate.reinforcement {
            spec.validate(quad.thickness_m)?;
        }
        let bending = element_with_orthotropic(
            quad,
            indices.map(|i| &plate.nodes[i]),
            std::array::from_fn(|j| 3 * indices[j / 3] + j % 3),
            material,
            orthotropic_materials.get(&quad.material_id).copied(),
        )?;
        let dofs = std::array::from_fn(|j| 5 * indices[j / 5] + j % 5);
        elements.push((bending, dofs, indices, *material));
    }
    if quad_pressures.keys().any(|id| !quad_ids.contains(id)) {
        return Err("unknown geometric shell pressure quad".into());
    }
    let mut edge_loads: HashMap<usize, Vec<&EdgeLoad>> = HashMap::new();
    for edge_load in &plate.edge_loads {
        if !quad_ids.contains(&edge_load.quad_id) {
            return Err("unknown geometric shell edge-load quad".into());
        }
        if edge_load.edge_index > 3 {
            return Err("geometric shell edge-load index must be 0..=3".into());
        }
        if !edge_load.start_kn_per_m.is_finite() || !edge_load.end_kn_per_m.is_finite() {
            return Err("non-finite geometric shell edge load".into());
        }
        edge_loads
            .entry(edge_load.quad_id)
            .or_default()
            .push(edge_load);
    }

    let dof_count = 5 * plate.nodes.len();
    let mut springs = collect_support_springs(&plate.supports, &node_index, 5, [2, 3, 4])?;
    let mut prescribed = vec![None::<f64>; dof_count];
    for support in &plate.supports {
        let index = *node_index
            .get(&support.node_id)
            .ok_or("unknown geometric shell bending support node")?;
        for (offset, active) in [support.w, support.theta_x, support.theta_y]
            .into_iter()
            .enumerate()
        {
            if active {
                prescribed[5 * index + 2 + offset] = Some(0.0);
            }
        }
    }
    for support in &request.membrane_supports {
        let index = *node_index
            .get(&support.node_id)
            .ok_or("unknown geometric shell membrane support node")?;
        if support.u {
            prescribed[5 * index] = Some(0.0);
        }
        if support.v {
            prescribed[5 * index + 1] = Some(0.0);
        }
        for (fixed, stiffness, offset, label) in [
            (support.u, support.ku_kn_per_m, 0, "u"),
            (support.v, support.kv_kn_per_m, 1, "v"),
        ] {
            if let Some(stiffness) = stiffness {
                positive(stiffness, "shell membrane support spring stiffness")?;
                if fixed {
                    return Err(format!(
                        "geometric shell membrane support node {} is both fixed and spring-supported in {label}",
                        support.node_id
                    ));
                }
                springs.push((5 * index + offset, stiffness));
            }
        }
    }
    if springs.iter().any(|(dof, _)| prescribed[*dof].is_some()) {
        return Err("geometric shell support DOF cannot be both fixed and spring-supported".into());
    }
    let mut load = vec![0.0; dof_count];
    for nodal in &plate.loads {
        let i = *node_index
            .get(&nodal.node_id)
            .ok_or("unknown geometric shell bending load node")?;
        load[5 * i + 2] += nodal.fz;
        load[5 * i + 3] += nodal.mx;
        load[5 * i + 4] += nodal.my;
    }
    for nodal in &request.membrane_loads {
        if !nodal.fx_kn.is_finite() || !nodal.fy_kn.is_finite() {
            return Err("non-finite geometric shell membrane load".into());
        }
        let i = *node_index
            .get(&nodal.node_id)
            .ok_or("unknown geometric shell membrane load node")?;
        load[5 * i] += nodal.fx_kn;
        load[5 * i + 1] += nodal.fy_kn;
    }
    for (bending, shelldofs, _, _) in &elements {
        let extra = quad_pressures
            .get(&bending.id)
            .map_or([0.0; 4], |pressure| pressure.nodal_pressure_kn_m2);
        for node in 0..4 {
            load[shelldofs[5 * node + 2]] += (0..4)
                .map(|corner| {
                    bending.pressure_matrix[node][corner] * (plate.pressure_kn_m2 + extra[corner])
                })
                .sum::<f64>();
        }
        if let Some(element_edge_loads) = edge_loads.get(&bending.id) {
            for edge_load in element_edge_loads {
                let edge = edge_load.edge_index;
                let next_node = (edge + 1) % 4;
                let [length, tx, ty, nx, ny] = bending.edges[edge];
                for q in 0..NGAUSS {
                    let s = 0.5 * (ROOTS[q] + 1.0);
                    let line_load =
                        edge_load.start_kn_per_m * (1.0 - s) + edge_load.end_kn_per_m * s;
                    let weighted_load = length * WEIGHTS[q] * 0.5 * line_load;
                    for local_dof in 0..12 {
                        let (w, _) = edge_kinematics(
                            local_dof,
                            edge,
                            next_node,
                            s,
                            length,
                            [tx, ty],
                            [nx, ny],
                        );
                        let shell_dof = shelldofs[5 * (local_dof / 3) + 2 + local_dof % 3];
                        load[shell_dof] += weighted_load * w;
                    }
                }
            }
        }
    }
    let force_scale = load.iter().map(|v| v * v).sum::<f64>().sqrt().max(1.0);
    let path = if plate.load_path.is_empty() {
        vec![1.0]
    } else {
        plate.load_path.clone()
    };
    if path.iter().any(|factor| !factor.is_finite()) {
        return Err("non-finite geometric shell load path".into());
    }
    let mut displacement = vec![0.0; dof_count];
    let mut peak_strain = vec![0.0_f64; elements.len()];
    let mut effective_e: Vec<f64> = elements.iter().map(|entry| entry.0.base_e).collect();
    let mut material_states = vec![[MaterialState::default(); NGAUSS * NGAUSS]; elements.len()];
    let mut total_iterations = 0;
    let mut last_residual = f64::INFINITY;
    let mut start_factor = 0.0;
    for &end_factor in &path {
        let mut accepted_factor = start_factor;
        let mut target_factor = end_factor;
        let mut cutbacks = 0;
        loop {
            let accepted_displacement = displacement.clone();
            let accepted_e = effective_e.clone();
            let target: Vec<f64> = load.iter().map(|value| target_factor * value).collect();
            let mut converged = false;
            let mut step_material_states = material_states.clone();
            for _ in 0..plate.max_iterations {
                total_iterations += 1;
                let mut tangent = Matrix::zeros(dof_count)?;
                let mut internal = vec![0.0; dof_count];
                let mut next_e = effective_e.clone();
                for (index, (bending, shelldofs, indices, material)) in elements.iter().enumerate()
                {
                    for i in 0..12 {
                        let row = shelldofs[5 * (i / 3) + 2 + i % 3];
                        for j in 0..12 {
                            let col = shelldofs[5 * (j / 3) + 2 + j % 3];
                            let value = effective_e[index] * bending.base_k[i][j];
                            tangent.add(row, col, value);
                            internal[row] += value * displacement[col];
                        }
                    }
                    let coords = indices.map(|i| &plate.nodes[i]);
                    let membrane = shell_membrane_response_with_orthotropy(
                        coords,
                        *shelldofs,
                        &displacement,
                        effective_e[index],
                        material.nu,
                        bending.thickness,
                        if request.analysis.material() {
                            request
                                .material_laws
                                .get(&bending.material_id)
                                .copied()
                                .unwrap_or_default()
                        } else {
                            MaterialLaw::Elastic
                        },
                        &material_states[index],
                        bending.orthotropic.as_ref(),
                    )?;
                    step_material_states[index] = membrane.states;
                    for i in 0..20 {
                        let row = shelldofs[i];
                        internal[row] += membrane.force[i];
                        for j in 0..20 {
                            tangent.add(row, shelldofs[j], membrane.tangent[i][j]);
                        }
                    }
                    if let Some(curve) = curves.get(&bending.material_id) {
                        let bending_local = std::array::from_fn(|j| {
                            displacement[shelldofs[5 * (j / 3) + 2 + j % 3]]
                        });
                        let combined = shell_max_combined_fibre_strain(
                            bending,
                            coords,
                            &bending_local,
                            effective_e[index],
                            &membrane.gauss_strains,
                        )?;
                        next_e[index] = curve.e_at(peak_strain[index].max(combined));
                    }
                }
                for &(dof, stiffness) in &springs {
                    tangent.add(dof, dof, stiffness);
                    internal[dof] += stiffness * displacement[dof];
                }
                let modulus_change = next_e
                    .iter()
                    .zip(&effective_e)
                    .map(|(new, old)| (new - old).abs() / old)
                    .fold(0.0_f64, f64::max);
                if modulus_change > plate.tolerance {
                    effective_e = next_e;
                    continue;
                }
                check_sparse_inertia_if_fits(&tangent, &prescribed)?;
                let residual: Vec<f64> = target.iter().zip(&internal).map(|(f, r)| f - r).collect();
                last_residual = residual
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| prescribed[*i].is_none())
                    .map(|(_, value)| value * value)
                    .sum::<f64>()
                    .sqrt()
                    / force_scale;
                if last_residual <= plate.tolerance {
                    converged = true;
                    break;
                }
                let correction = constrained_solve(&tangent, &residual, &prescribed)?.0;
                for i in 0..dof_count {
                    displacement[i] += correction[i];
                }
            }
            if converged {
                material_states.clone_from(&step_material_states);
                for (index, (bending, shelldofs, indices, material)) in elements.iter().enumerate()
                {
                    let coords = indices.map(|i| &plate.nodes[i]);
                    let membrane = shell_membrane_response_with_orthotropy(
                        coords,
                        *shelldofs,
                        &displacement,
                        effective_e[index],
                        material.nu,
                        bending.thickness,
                        if request.analysis.material() {
                            request
                                .material_laws
                                .get(&bending.material_id)
                                .copied()
                                .unwrap_or_default()
                        } else {
                            MaterialLaw::Elastic
                        },
                        &material_states[index],
                        bending.orthotropic.as_ref(),
                    )?;
                    let bending_local =
                        std::array::from_fn(|j| displacement[shelldofs[5 * (j / 3) + 2 + j % 3]]);
                    peak_strain[index] = peak_strain[index].max(shell_max_combined_fibre_strain(
                        bending,
                        coords,
                        &bending_local,
                        effective_e[index],
                        &membrane.gauss_strains,
                    )?);
                }
                accepted_factor = target_factor;
                if target_factor == end_factor {
                    break;
                }
                target_factor = end_factor;
            } else {
                displacement = accepted_displacement;
                effective_e = accepted_e;
                cutbacks += 1;
                if cutbacks > 32 {
                    return Err(format!("geometric shell Newton iteration did not converge near load factor {target_factor} (last converged {accepted_factor})"));
                }
                target_factor = accepted_factor + 0.5 * (target_factor - accepted_factor);
            }
        }
        start_factor = end_factor;
    }

    // Recover support reactions from the final internal force minus applied load.
    let mut final_internal = vec![0.0; dof_count];
    let mut shell_elements = Vec::with_capacity(elements.len());
    for (index, (bending, shelldofs, indices, material)) in elements.iter().enumerate() {
        let coords = indices.map(|i| &plate.nodes[i]);
        let response = shell_membrane_response_with_orthotropy(
            coords,
            *shelldofs,
            &displacement,
            effective_e[index],
            material.nu,
            bending.thickness,
            if request.analysis.material() {
                request
                    .material_laws
                    .get(&bending.material_id)
                    .copied()
                    .unwrap_or_default()
            } else {
                MaterialLaw::Elastic
            },
            &material_states[index],
            bending.orthotropic.as_ref(),
        )?;
        let bending_local =
            std::array::from_fn(|j| displacement[shelldofs[5 * (j / 3) + 2 + j % 3]]);
        for i in 0..12 {
            let row = shelldofs[5 * (i / 3) + 2 + i % 3];
            final_internal[row] += effective_e[index]
                * (0..12)
                    .map(|j| bending.base_k[i][j] * bending_local[j])
                    .sum::<f64>();
        }
        for i in 0..20 {
            final_internal[shelldofs[i]] += response.force[i];
        }
        let (moments, _) = moment(
            bending,
            &bending_local,
            effective_e[index],
            bending.centre[0],
            bending.centre[1],
        );
        let result_law = if request.analysis.material() {
            request
                .material_laws
                .get(&bending.material_id)
                .copied()
                .unwrap_or_default()
        } else {
            MaterialLaw::Elastic
        };
        let resultant_samples = bending
            .sample_points
            .iter()
            .zip(&bending.sample_natural_coordinates)
            .map(|(position_m, [xi, eta])| {
                let strain =
                    shell_membrane_strain_at(coords, *shelldofs, &displacement, *xi, *eta)?;
                let nearest_state = (0..NGAUSS * NGAUSS)
                    .min_by(|&a, &b| {
                        let distance = |index: usize| {
                            let dx = ROOTS[index / NGAUSS] - xi;
                            let dy = ROOTS[index % NGAUSS] - eta;
                            dx * dx + dy * dy
                        };
                        distance(a).total_cmp(&distance(b))
                    })
                    .unwrap_or(0);
                let membrane_kn_per_m = membrane_material_response(
                    effective_e[index],
                    material.nu,
                    result_law,
                    strain,
                    material_states[index][nearest_state],
                    bending.orthotropic.as_ref(),
                )?
                .stress
                .map(|stress| stress * bending.thickness);
                let (moment_knm_per_m, shear_kn_per_m) = moment(
                    bending,
                    &bending_local,
                    effective_e[index],
                    position_m[0],
                    position_m[1],
                );
                Ok(GeometricShellResultantSample {
                    position_m: *position_m,
                    membrane_kn_per_m,
                    moment_knm_per_m,
                    shear_kn_per_m,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let material_points = (0..NGAUSS)
            .flat_map(|gauss_i| (0..NGAUSS).map(move |gauss_j| (gauss_i, gauss_j)))
            .map(|(gauss_i, gauss_j)| {
                let point_index = gauss_i * NGAUSS + gauss_j;
                let (x, y, _) = geometry(coords, ROOTS[gauss_i], ROOTS[gauss_j])?;
                let state = material_states[index][point_index];
                Ok(GeometricShellMaterialPointResult {
                    gauss_index: [gauss_i, gauss_j],
                    position_m: [x, y],
                    membrane_strain: response.gauss_strains[point_index],
                    equivalent_plastic_strain: state.equivalent_plastic_strain,
                    tensile_damage: state.tensile_damage,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        shell_elements.push(GeometricShellElementResult {
            quad_id: bending.id,
            membrane_kn_per_m: response.centre_resultant,
            moment_knm_per_m: moments,
            effective_e_mpa: effective_e[index],
            max_fibre_strain: max_fibre_strain(bending, &bending_local, effective_e[index]),
            max_combined_strain: peak_strain[index],
            max_equivalent_plastic_strain: material_states[index]
                .iter()
                .map(|state| state.equivalent_plastic_strain)
                .fold(0.0_f64, f64::max),
            max_tensile_damage: material_states[index]
                .iter()
                .map(|state| state.tensile_damage)
                .fold(0.0_f64, f64::max),
            material_points,
            resultant_samples,
            reinforcement: None,
        });
    }
    let patch_elements: Vec<HybridElement> = elements
        .iter()
        .map(|(bending, _, _, _)| bending.clone())
        .collect();
    let patch_results: Vec<ElementResult> = shell_elements
        .iter()
        .map(|element| ElementResult {
            quad_id: element.quad_id,
            moment_knm_per_m: element.moment_knm_per_m,
            shear_kn_per_m: element.resultant_samples[4].shear_kn_per_m,
            effective_e_mpa: element.effective_e_mpa,
            max_fibre_strain: element.max_fibre_strain,
            resultant_samples: Vec::new(),
            reinforcement: None,
        })
        .collect();
    for (index, element) in shell_elements.iter_mut().enumerate() {
        let gradient = recovered_shear_gradient(index, &patch_elements, &patch_results);
        let centre_shear = patch_results[index].shear_kn_per_m;
        let centre = patch_elements[index].centre;
        for sample in &mut element.resultant_samples {
            let offset = [
                sample.position_m[0] - centre[0],
                sample.position_m[1] - centre[1],
            ];
            sample.shear_kn_per_m = std::array::from_fn(|component| {
                centre_shear[component]
                    + gradient[component][0] * offset[0]
                    + gradient[component][1] * offset[1]
            });
        }
        if let Some(spec) = &plate.reinforcement {
            let points: Vec<_> = element
                .resultant_samples
                .iter()
                .map(|sample| {
                    (
                        sample.position_m,
                        sample.membrane_kn_per_m,
                        sample.moment_knm_per_m,
                        sample.shear_kn_per_m,
                    )
                })
                .collect();
            element.reinforcement = Some(reinforced_plate::shell_envelope(
                spec,
                patch_elements[index].thickness,
                element.effective_e_mpa,
                &points,
            )?);
        }
    }
    for &(dof, stiffness) in &springs {
        final_internal[dof] += stiffness * displacement[dof];
    }
    let final_factor = *path.last().unwrap_or(&1.0);
    let nodes = plate
        .nodes
        .iter()
        .enumerate()
        .map(|(i, node)| {
            let at = 5 * i;
            let reaction = |offset: usize| {
                if prescribed[at + offset].is_some() {
                    final_internal[at + offset] - final_factor * load[at + offset]
                } else {
                    support_spring_reaction(&springs, &displacement, at + offset)
                }
            };
            GeometricShellNodeResult {
                node_id: node.id,
                u_m: displacement[at],
                v_m: displacement[at + 1],
                w_m: displacement[at + 2],
                theta_x_rad: displacement[at + 3],
                theta_y_rad: displacement[at + 4],
                reaction_fx_kn: reaction(0),
                reaction_fy_kn: reaction(1),
                reaction_fz_kn: reaction(2),
                reaction_mx_knm: reaction(3),
                reaction_my_knm: reaction(4),
            }
        })
        .collect();
    Ok(GeometricShellResult {
        nodes,
        elements: shell_elements,
        iterations: total_iterations,
        relative_residual: last_residual,
    })
}

struct ShellMembraneResponse {
    force: [f64; 20],
    tangent: [[f64; 20]; 20],
    centre_resultant: [f64; 3],
    gauss_strains: [[f64; 3]; NGAUSS * NGAUSS],
    states: [MaterialState; NGAUSS * NGAUSS],
}

fn shell_membrane_strain_at(
    nodes: [&Node; 4],
    dofs: [usize; 20],
    displacement: &[f64],
    xi: f64,
    eta: f64,
) -> Result<[f64; 3], String> {
    let (_, dxi, deta) = shape(xi, eta);
    let j11: f64 = (0..4).map(|a| dxi[a] * nodes[a].x).sum();
    let j12: f64 = (0..4).map(|a| dxi[a] * nodes[a].y).sum();
    let j21: f64 = (0..4).map(|a| deta[a] * nodes[a].x).sum();
    let j22: f64 = (0..4).map(|a| deta[a] * nodes[a].y).sum();
    let det = j11 * j22 - j12 * j21;
    if !det.is_finite() || det <= 1e-12 {
        return Err("geometric shell quad has non-positive Jacobian".into());
    }
    let dx: [f64; 4] = std::array::from_fn(|a| (dxi[a] * j22 - deta[a] * j12) / det);
    let dy: [f64; 4] = std::array::from_fn(|a| (-dxi[a] * j21 + deta[a] * j11) / det);
    let (mut ux, mut uy, mut vx, mut vy, mut wx, mut wy) = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    for a in 0..4 {
        let at = 5 * a;
        ux += dx[a] * displacement[dofs[at]];
        uy += dy[a] * displacement[dofs[at]];
        vx += dx[a] * displacement[dofs[at + 1]];
        vy += dy[a] * displacement[dofs[at + 1]];
        wx += dx[a] * displacement[dofs[at + 2]];
        wy += dy[a] * displacement[dofs[at + 2]];
    }
    Ok([
        ux + 0.5 * (ux * ux + vx * vx + wx * wx),
        vy + 0.5 * (uy * uy + vy * vy + wy * wy),
        uy + vx + ux * uy + vx * vy + wx * wy,
    ])
}

#[cfg(test)]
fn shell_membrane_response(
    nodes: [&Node; 4],
    dofs: [usize; 20],
    displacement: &[f64],
    e_mpa: f64,
    nu: f64,
    thickness: f64,
) -> Result<ShellMembraneResponse, String> {
    shell_membrane_response_with_law(
        nodes,
        dofs,
        displacement,
        e_mpa,
        nu,
        thickness,
        MaterialLaw::Elastic,
        &[MaterialState::default(); NGAUSS * NGAUSS],
    )
}

#[cfg(test)]
fn shell_membrane_response_with_law(
    nodes: [&Node; 4],
    dofs: [usize; 20],
    displacement: &[f64],
    e_mpa: f64,
    nu: f64,
    thickness: f64,
    law: MaterialLaw,
    previous_states: &[MaterialState; NGAUSS * NGAUSS],
) -> Result<ShellMembraneResponse, String> {
    shell_membrane_response_with_orthotropy(
        nodes,
        dofs,
        displacement,
        e_mpa,
        nu,
        thickness,
        law,
        previous_states,
        None,
    )
}

fn membrane_material_response(
    e_mpa: f64,
    nu: f64,
    law: MaterialLaw,
    strain: [f64; 3],
    previous: MaterialState,
    orthotropic: Option<&OrthotropicMaterial>,
) -> Result<material2d::Response, String> {
    let Some(material) = orthotropic else {
        return material2d::update(e_mpa, nu, law, strain, previous);
    };
    if !matches!(law, MaterialLaw::Elastic) {
        return Err("orthotropic geometric shell currently requires elastic material law".into());
    }
    let e1 = e_mpa * 1000.0;
    let e2 = material.e2_mpa / material.e1_mpa * e1;
    let g12 = material.g12_mpa / material.e1_mpa * e1;
    let nu21 = material.nu12 * material.e2_mpa / material.e1_mpa;
    let denominator = 1.0 - material.nu12 * nu21;
    let local = [
        [e1 / denominator, material.nu12 * e2 / denominator, 0.0],
        [material.nu12 * e2 / denominator, e2 / denominator, 0.0],
        [0.0, 0.0, g12],
    ];
    let (s, c) = material.angle_rad.sin_cos();
    let transform = [
        [c * c, s * s, c * s],
        [s * s, c * c, -c * s],
        [-2.0 * c * s, 2.0 * c * s, c * c - s * s],
    ];
    let d: [[f64; 3]; 3] = std::array::from_fn(|i| {
        std::array::from_fn(|j| {
            (0..3)
                .flat_map(|a| (0..3).map(move |b| transform[a][i] * local[a][b] * transform[b][j]))
                .sum()
        })
    });
    let stress = std::array::from_fn(|i| (0..3).map(|j| d[i][j] * strain[j]).sum());
    let centre = 0.5 * (strain[0] + strain[1]);
    let radius = ((0.5 * (strain[0] - strain[1])).powi(2) + (0.5 * strain[2]).powi(2)).sqrt();
    let equivalent = (centre + radius).abs().max((centre - radius).abs());
    let mut state = previous;
    state.max_equivalent_strain = state.max_equivalent_strain.max(equivalent);
    Ok(material2d::Response { stress, state })
}

fn shell_membrane_response_with_orthotropy(
    nodes: [&Node; 4],
    dofs: [usize; 20],
    displacement: &[f64],
    e_mpa: f64,
    nu: f64,
    thickness: f64,
    law: MaterialLaw,
    previous_states: &[MaterialState; NGAUSS * NGAUSS],
    orthotropic: Option<&OrthotropicMaterial>,
) -> Result<ShellMembraneResponse, String> {
    if !e_mpa.is_finite() || e_mpa <= 0.0 || !nu.is_finite() || !(-1.0..0.5).contains(&nu) {
        return Err("invalid geometric shell material".into());
    }
    let mut force = [0.0; 20];
    let mut tangent = [[0.0; 20]; 20];
    let mut gauss_strains = [[0.0; 3]; NGAUSS * NGAUSS];
    let mut states = [MaterialState::default(); NGAUSS * NGAUSS];
    for (gauss_i, xi) in ROOTS.iter().copied().enumerate() {
        for (gauss_j, eta) in ROOTS.iter().copied().enumerate() {
            let (_, dxi, deta) = shape(xi, eta);
            let j11: f64 = (0..4).map(|a| dxi[a] * nodes[a].x).sum();
            let j12: f64 = (0..4).map(|a| dxi[a] * nodes[a].y).sum();
            let j21: f64 = (0..4).map(|a| deta[a] * nodes[a].x).sum();
            let j22: f64 = (0..4).map(|a| deta[a] * nodes[a].y).sum();
            let det = j11 * j22 - j12 * j21;
            if !det.is_finite() || det <= 1e-12 {
                return Err("geometric shell quad has non-positive Jacobian".into());
            }
            let dx: [f64; 4] = std::array::from_fn(|a| (dxi[a] * j22 - deta[a] * j12) / det);
            let dy: [f64; 4] = std::array::from_fn(|a| (-dxi[a] * j21 + deta[a] * j11) / det);
            let mut ux = 0.0;
            let mut uy = 0.0;
            let mut vx = 0.0;
            let mut vy = 0.0;
            let mut wx = 0.0;
            let mut wy = 0.0;
            for a in 0..4 {
                let at = 5 * a;
                ux += dx[a] * displacement[dofs[at]];
                uy += dy[a] * displacement[dofs[at]];
                vx += dx[a] * displacement[dofs[at + 1]];
                vy += dy[a] * displacement[dofs[at + 1]];
                wx += dx[a] * displacement[dofs[at + 2]];
                wy += dy[a] * displacement[dofs[at + 2]];
            }
            let strain = [
                ux + 0.5 * (ux * ux + vx * vx + wx * wx),
                vy + 0.5 * (uy * uy + vy * vy + wy * wy),
                uy + vx + ux * uy + vx * vy + wx * wy,
            ];
            gauss_strains[gauss_i * NGAUSS + gauss_j] = strain;
            let gauss_index = gauss_i * NGAUSS + gauss_j;
            let point_response = membrane_material_response(
                e_mpa,
                nu,
                law,
                strain,
                previous_states[gauss_index],
                orthotropic,
            )?;
            states[gauss_index] = point_response.state;
            let resultant = point_response.stress.map(|stress| stress * thickness);
            let mut constitutive = [[0.0; 3]; 3];
            for column in 0..3 {
                let step = 1e-9_f64.max(strain[column].abs() * 1e-5);
                let mut plus = strain;
                plus[column] += step;
                let mut minus = strain;
                minus[column] -= step;
                let stress_plus = membrane_material_response(
                    e_mpa,
                    nu,
                    law,
                    plus,
                    previous_states[gauss_index],
                    orthotropic,
                )?
                .stress;
                let stress_minus = membrane_material_response(
                    e_mpa,
                    nu,
                    law,
                    minus,
                    previous_states[gauss_index],
                    orthotropic,
                )?
                .stress;
                for row in 0..3 {
                    constitutive[row][column] =
                        (stress_plus[row] - stress_minus[row]) / (2.0 * step) * thickness;
                }
            }
            // The sparse tangent/factorization expects the material tangent
            // to retain major symmetry; average the numerical cross terms.
            for row in 0..3 {
                for column in 0..row {
                    let value = 0.5 * (constitutive[row][column] + constitutive[column][row]);
                    constitutive[row][column] = value;
                    constitutive[column][row] = value;
                }
            }
            let mut b = [[0.0; 20]; 3];
            for a in 0..4 {
                let at = 5 * a;
                b[0][at] = (1.0 + ux) * dx[a];
                b[0][at + 1] = vx * dx[a];
                b[0][at + 2] = wx * dx[a];
                b[1][at] = uy * dy[a];
                b[1][at + 1] = (1.0 + vy) * dy[a];
                b[1][at + 2] = wy * dy[a];
                b[2][at] = uy * dx[a] + (1.0 + ux) * dy[a];
                b[2][at + 1] = (1.0 + vy) * dx[a] + vx * dy[a];
                b[2][at + 2] = wy * dx[a] + wx * dy[a];
            }
            let weight = WEIGHTS[gauss_i] * WEIGHTS[gauss_j] * det;
            for i in 0..20 {
                force[i] += weight * (0..3).map(|a| b[a][i] * resultant[a]).sum::<f64>();
                for j in 0..20 {
                    let material = (0..3)
                        .flat_map(|a| {
                            (0..3).map(move |bb| b[a][i] * constitutive[a][bb] * b[bb][j])
                        })
                        .sum::<f64>();
                    let component_i = i % 5;
                    let component_j = j % 5;
                    let node_i = i / 5;
                    let node_j = j / 5;
                    let geometric = if component_i == component_j && component_i < 3 {
                        resultant[0] * dx[node_i] * dx[node_j]
                            + resultant[1] * dy[node_i] * dy[node_j]
                            + resultant[2] * (dx[node_i] * dy[node_j] + dy[node_i] * dx[node_j])
                    } else {
                        0.0
                    };
                    tangent[i][j] += weight * (material + geometric);
                }
            }
        }
    }
    // Centre resultants are not a Gauss point; evaluate them directly for a
    // stable result field independent of the integration rule.
    let (_, dxi, deta) = shape(0.0, 0.0);
    let j11: f64 = (0..4).map(|a| dxi[a] * nodes[a].x).sum();
    let j12: f64 = (0..4).map(|a| dxi[a] * nodes[a].y).sum();
    let j21: f64 = (0..4).map(|a| deta[a] * nodes[a].x).sum();
    let j22: f64 = (0..4).map(|a| deta[a] * nodes[a].y).sum();
    let det = j11 * j22 - j12 * j21;
    if det <= 1e-12 {
        return Err("geometric shell quad has non-positive centre Jacobian".into());
    }
    let dx: [f64; 4] = std::array::from_fn(|a| (dxi[a] * j22 - deta[a] * j12) / det);
    let dy: [f64; 4] = std::array::from_fn(|a| (-dxi[a] * j21 + deta[a] * j11) / det);
    let mut ux = 0.0;
    let mut uy = 0.0;
    let mut vx = 0.0;
    let mut vy = 0.0;
    let mut wx = 0.0;
    let mut wy = 0.0;
    for a in 0..4 {
        let at = 5 * a;
        ux += dx[a] * displacement[dofs[at]];
        uy += dy[a] * displacement[dofs[at]];
        vx += dx[a] * displacement[dofs[at + 1]];
        vy += dy[a] * displacement[dofs[at + 1]];
        wx += dx[a] * displacement[dofs[at + 2]];
        wy += dy[a] * displacement[dofs[at + 2]];
    }
    let strain = [
        ux + 0.5 * (ux * ux + vx * vx + wx * wx),
        vy + 0.5 * (uy * uy + vy * vy + wy * wy),
        uy + vx + ux * uy + vx * vy + wx * wy,
    ];
    let centre_resultant =
        membrane_material_response(e_mpa, nu, law, strain, previous_states[0], orthotropic)?
            .stress
            .map(|stress| stress * thickness);
    Ok(ShellMembraneResponse {
        force,
        tangent,
        centre_resultant,
        gauss_strains,
        states,
    })
}

fn shell_max_combined_fibre_strain(
    bending: &HybridElement,
    nodes: [&Node; 4],
    bending_local: &[f64; 12],
    e_mpa: f64,
    membrane_gauss_strains: &[[f64; 3]; NGAUSS * NGAUSS],
) -> Result<f64, String> {
    let mut maximum = 0.0_f64;
    for i in 0..NGAUSS {
        for j in 0..NGAUSS {
            let (x, y, _) = geometry(nodes, ROOTS[i], ROOTS[j])?;
            let (m, _) = moment(bending, bending_local, e_mpa, x, y);
            let curvature: [f64; 3] = std::array::from_fn(|a| {
                (0..3)
                    .map(|b| bending.compliance[a][b] * m[b] / e_mpa)
                    .sum()
            });
            let [kx, ky, kxy] = curvature;
            let membrane = membrane_gauss_strains[i * NGAUSS + j];
            for z in [-0.5 * bending.thickness, 0.5 * bending.thickness] {
                let ex = membrane[0] + z * kx;
                let ey = membrane[1] + z * ky;
                let gamma_xy = membrane[2] + 2.0 * z * kxy;
                let mean = 0.5 * (ex + ey);
                let radius = (0.25 * (ex - ey).powi(2) + 0.25 * gamma_xy.powi(2)).sqrt();
                maximum = maximum
                    .max((mean + radius).abs())
                    .max((mean - radius).abs());
            }
        }
    }
    Ok(maximum)
}

fn end_factor(path: &[f64]) -> f64 {
    *path.last().unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bending_compliance_rejects_positive_determinant_indefinite_matrix() {
        // det(-1, -1, 1) = +1, so determinant sign alone cannot prove
        // positive bending energy.
        let indefinite = [[-1.0, 0.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, 1.0]];
        assert!(invert_symmetric_3(indefinite)
            .unwrap_err()
            .contains("positive definite"));
        let stable = [[4.0, 1.0, 0.0], [1.0, 3.0, 0.5], [0.0, 0.5, 2.0]];
        let inverse = invert_symmetric_3(stable).unwrap();
        for i in 0..3 {
            for j in 0..3 {
                let product = (0..3).map(|k| stable[i][k] * inverse[k][j]).sum::<f64>();
                assert!((product - if i == j { 1.0 } else { 0.0 }).abs() < 1e-12);
            }
        }
    }

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
    fn pure_twist_reports_principal_fiber_strain_with_engineering_shear_halved() {
        let element = square_element();
        let amplitude = 0.001;
        // w=a*x*y, θx=-∂w/∂y=-a*x, θy=∂w/∂x=a*y.
        let u = [
            0.0, 0.0, 0.0, 0.0, -amplitude, 0.0, amplitude, -amplitude, amplitude, 0.0, 0.0,
            amplitude,
        ];
        let (centre_moment, _) = moment(&element, &u, element.base_e, 0.5, 0.5);
        let curvature: [f64; 3] = std::array::from_fn(|i| {
            (0..3)
                .map(|j| element.compliance[i][j] * centre_moment[j] / element.base_e)
                .sum()
        });
        assert!(curvature[0].abs() < 1e-10);
        assert!(curvature[1].abs() < 1e-10);
        assert!((curvature[2] - 2.0 * amplitude).abs() < 1e-10);
        // Principal surface strains of pure engineering shear γ=2az are ±az.
        let expected = 0.5 * element.thickness * amplitude;
        assert!((max_fibre_strain(&element, &u, element.base_e) - expected).abs() < 1e-10);
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
    fn pressure_weights_preserve_resultant_and_centroid_on_tapered_quad() {
        let nodes = [
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
                x: 1.5,
                y: 1.0,
            },
            Node {
                id: 4,
                x: 0.0,
                y: 1.0,
            },
        ];
        let quad = Quad {
            id: 1,
            node_ids: [1, 2, 3, 4],
            material_id: 1,
            thickness_m: 0.1,
        };
        let material = Material {
            id: 1,
            e_mpa: 30_000.0,
            nu: 0.2,
        };
        let element = element(
            &quad,
            [&nodes[0], &nodes[1], &nodes[2], &nodes[3]],
            std::array::from_fn(|i| i),
            &material,
        )
        .unwrap();
        let mut area_twice = 0.0;
        let mut cx_numerator = 0.0;
        let mut cy_numerator = 0.0;
        for i in 0..4 {
            let a = &nodes[i];
            let b = &nodes[(i + 1) % 4];
            let cross = a.x * b.y - b.x * a.y;
            area_twice += cross;
            cx_numerator += (a.x + b.x) * cross;
            cy_numerator += (a.y + b.y) * cross;
        }
        let area = area_twice / 2.0;
        let centroid = [
            cx_numerator / (3.0 * area_twice),
            cy_numerator / (3.0 * area_twice),
        ];
        let weights: [f64; 4] = std::array::from_fn(|a| element.pressure_matrix[a].iter().sum());
        let force: f64 = weights.iter().sum();
        let first_x: f64 = (0..4).map(|i| weights[i] * nodes[i].x).sum();
        let first_y: f64 = (0..4).map(|i| weights[i] * nodes[i].y).sum();
        assert!((force - area).abs() < 1e-12);
        assert!((first_x / force - centroid[0]).abs() < 1e-12);
        assert!((first_y / force - centroid[1]).abs() < 1e-12);
        assert!((weights[0] - weights[2]).abs() > 1e-3);
        // On this trapezoid x runs from 0 to 2-y/2. For q=x the three
        // integrals are ∫q dA=37/24, ∫xq dA=175/96 and ∫yq dA=67/96.
        let graded: [f64; 4] = std::array::from_fn(|a| {
            (0..4)
                .map(|b| element.pressure_matrix[a][b] * nodes[b].x)
                .sum()
        });
        assert!((graded.iter().sum::<f64>() - 37.0 / 24.0).abs() < 1e-12);
        assert!(((0..4).map(|i| graded[i] * nodes[i].x).sum::<f64>() - 175.0 / 96.0).abs() < 1e-12);
        assert!(((0..4).map(|i| graded[i] * nodes[i].y).sum::<f64>() - 67.0 / 96.0).abs() < 1e-12);
    }
    #[test]
    fn linear_pressure_on_rectangle_has_exact_force_and_first_moments() {
        let nodes = [
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
        ];
        let quad = Quad {
            id: 1,
            node_ids: [1, 2, 3, 4],
            material_id: 1,
            thickness_m: 0.1,
        };
        let material = Material {
            id: 1,
            e_mpa: 30_000.0,
            nu: 0.2,
        };
        let element = element(
            &quad,
            [&nodes[0], &nodes[1], &nodes[2], &nodes[3]],
            std::array::from_fn(|i| i),
            &material,
        )
        .unwrap();
        // q(x,y)=x kN/m²; exact equivalent nodal forces are [1/3, 2/3, 2/3, 1/3] kN.
        let pressure = [0.0, 2.0, 2.0, 0.0];
        let nodal: [f64; 4] = std::array::from_fn(|a| {
            (0..4)
                .map(|b| element.pressure_matrix[a][b] * pressure[b])
                .sum()
        });
        for (actual, expected) in
            nodal
                .into_iter()
                .zip([1.0 / 3.0, 2.0 / 3.0, 2.0 / 3.0, 1.0 / 3.0])
        {
            assert!((actual - expected).abs() < 1e-12);
        }
        assert!((nodal.iter().sum::<f64>() - 2.0).abs() < 1e-12);
        assert!(((0..4).map(|i| nodal[i] * nodes[i].x).sum::<f64>() - 8.0 / 3.0).abs() < 1e-12);
        assert!(((0..4).map(|i| nodal[i] * nodes[i].y).sum::<f64>() - 1.0).abs() < 1e-12);
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
        assert!((max_fibre_strain(&e, &u, 30_000.0) - kappa * 0.1 / 2.0).abs() < 1e-12);
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
            orthotropic_materials: vec![],
            supports: mesh
                .left_node_ids
                .into_iter()
                .map(|node_id| Support {
                    node_id,
                    w: true,
                    theta_x: true,
                    theta_y: true,
                    kw_kn_per_m: None,
                    ktheta_x_knm_per_rad: None,
                    ktheta_y_knm_per_rad: None,
                })
                .collect(),
            loads: vec![],
            pressure_kn_m2: -1.0,
            quad_pressures: vec![],
            edge_loads: vec![],
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
            reinforcement: None,
            load_path: vec![],
            tolerance: 1e-8,
            max_iterations: 40,
            linear_backend: LinearBackend::Existing,
            frontal_max_front_dofs: None,
        }
    }

    fn relative_close(actual: f64, expected: f64, tolerance: f64) {
        assert!(
            (actual - expected).abs() <= tolerance * expected.abs().max(1.0),
            "actual={actual}, expected={expected}"
        );
    }

    #[test]
    fn homogeneous_elastic_layered_plate_matches_existing_hybrid_in_both_backends() {
        for backend in [LinearBackend::Existing, LinearBackend::FrontalWave] {
            let mut request = cantilever_request(false);
            request.linear_backend = backend;
            let layers: Vec<_> = request
                .quads
                .iter()
                .map(|quad| ElasticLayeredQuad {
                    quad_id: quad.id,
                    layers: vec![PlateFiberLayer {
                        thickness_m: quad.thickness_m,
                        e_mpa: 30_000.0,
                        nu: 0.0,
                        law: MaterialLaw::Elastic,
                    }],
                })
                .collect();
            let original = solve(&request).unwrap();
            let layered = solve_with_elastic_layered_sections(&request, &layers).unwrap();
            relative_close(layered.relative_residual, original.relative_residual, 1e-9);
            for (actual, expected) in layered.nodes.iter().zip(&original.nodes) {
                for (a, b) in [
                    (actual.w_m, expected.w_m),
                    (actual.theta_x_rad, expected.theta_x_rad),
                    (actual.theta_y_rad, expected.theta_y_rad),
                    (actual.reaction_fz_kn, expected.reaction_fz_kn),
                    (actual.reaction_mx_knm, expected.reaction_mx_knm),
                    (actual.reaction_my_knm, expected.reaction_my_knm),
                ] {
                    relative_close(a, b, 1e-9);
                }
            }
            for (actual, expected) in layered.elements.iter().zip(&original.elements) {
                for (a, b) in actual
                    .moment_knm_per_m
                    .iter()
                    .zip(&expected.moment_knm_per_m)
                {
                    relative_close(*a, *b, 1e-9);
                }
                relative_close(actual.max_fibre_strain, expected.max_fibre_strain, 1e-9);
            }
        }
    }

    #[test]
    fn asymmetric_layered_plate_matches_analytic_schur_bending_and_reactions() {
        // E_bottom=10 GPa, E_top=30 GPa, each 0.1 m, both nu=0.
        // Axx=4e6, Bxx=1e5, Dxx=40000/3 kN m/m; D_eff=32500/3.
        let layers = vec![
            PlateFiberLayer {
                thickness_m: 0.1,
                e_mpa: 10_000.0,
                nu: 0.0,
                law: MaterialLaw::Elastic,
            },
            PlateFiberLayer {
                thickness_m: 0.1,
                e_mpa: 30_000.0,
                nu: 0.0,
                law: MaterialLaw::Elastic,
            },
        ];
        let section = PlateFiberSection::new(&layers).unwrap();
        let response = layered_elastic_response(30_000.0, &section).unwrap();
        let effective_d = 32_500.0 / 3.0;
        relative_close(response.compliance[0][0], 30_000.0 / effective_d, 1e-11);
        relative_close(response.compliance[1][1], 30_000.0 / effective_d, 1e-11);
        relative_close(response.compliance[2][2], 60_000.0 / effective_d, 1e-11);
        relative_close(response.neutral_strain_per_curvature[0][0], -0.025, 1e-11);

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
        let quad = Quad {
            id: 1,
            node_ids: [1, 2, 3, 4],
            material_id: 1,
            thickness_m: 0.2,
        };
        let material = Material {
            id: 1,
            e_mpa: 30_000.0,
            nu: 0.0,
        };
        let element = element_with_constitutive(
            &quad,
            [&nodes[0], &nodes[1], &nodes[2], &nodes[3]],
            std::array::from_fn(|i| i),
            &material,
            None,
            Some(response),
        )
        .unwrap();
        let curvature = 0.001;
        let prescribed = [
            0.0,
            0.0,
            0.0,
            0.5 * curvature,
            0.0,
            curvature,
            0.5 * curvature,
            0.0,
            curvature,
            0.0,
            0.0,
            0.0,
        ];
        let (moment, shear) = moment(&element, &prescribed, 30_000.0, 0.5, 0.5);
        relative_close(moment[0], effective_d * curvature, 1e-10);
        relative_close(moment[1], 0.0, 1e-10);
        relative_close(moment[2], 0.0, 1e-10);
        assert!(shear.iter().all(|component| component.abs() < 1e-9));
        // epsilon_0=-B/A*kappa=-0.025*kappa m. The negative face is farther
        // from the neutral axis: |-0.1-0.025|*kappa=0.125*kappa.
        relative_close(
            max_fibre_strain(&element, &prescribed, 30_000.0),
            0.125 * curvature,
            1e-10,
        );

        // With common nu=0 the Schur-complement plate behaves exactly like a
        // homogeneous E_eff=16.25 GPa plate in bending, but has a different
        // neutral axis and therefore different face strain.
        for backend in [LinearBackend::Existing, LinearBackend::FrontalWave] {
            let mut request = cantilever_request(false);
            request.linear_backend = backend;
            let per_quad: Vec<_> = request
                .quads
                .iter()
                .map(|quad| ElasticLayeredQuad {
                    quad_id: quad.id,
                    layers: layers.clone(),
                })
                .collect();
            let layered = solve_with_elastic_layered_sections(&request, &per_quad).unwrap();
            request.materials[0].e_mpa = 16_250.0;
            let effective = solve(&request).unwrap();
            for (actual, expected) in layered.nodes.iter().zip(&effective.nodes) {
                relative_close(actual.w_m, expected.w_m, 1e-9);
                relative_close(actual.reaction_fz_kn, expected.reaction_fz_kn, 1e-9);
                relative_close(actual.reaction_mx_knm, expected.reaction_mx_knm, 1e-9);
                relative_close(actual.reaction_my_knm, expected.reaction_my_knm, 1e-9);
            }
            for (actual, expected) in layered.elements.iter().zip(&effective.elements) {
                for (a, b) in actual
                    .moment_knm_per_m
                    .iter()
                    .zip(&expected.moment_knm_per_m)
                {
                    relative_close(*a, *b, 1e-9);
                }
                assert!(actual.max_fibre_strain > expected.max_fibre_strain);
            }
            relative_close(
                layered.nodes.iter().map(|node| node.reaction_fz_kn).sum(),
                2.0,
                1e-9,
            );
            assert!(layered.relative_residual < 1e-8);
        }
    }

    #[test]
    fn layered_plate_rejects_incompatible_and_incomplete_sections() {
        let request = cantilever_request(false);
        let section = ElasticLayeredQuad {
            quad_id: request.quads[0].id,
            layers: vec![PlateFiberLayer {
                thickness_m: request.quads[0].thickness_m,
                e_mpa: 30_000.0,
                nu: 0.0,
                law: MaterialLaw::Elastic,
            }],
        };
        assert!(
            solve_with_elastic_layered_sections(&request, &[section.clone()])
                .unwrap_err()
                .contains("every quad")
        );
        let mut bad = section.clone();
        bad.layers[0].thickness_m *= 0.5;
        assert!(solve_with_elastic_layered_sections(&request, &[bad])
            .unwrap_err()
            .contains("thickness"));
        bad = section;
        bad.layers[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 500.0,
            hardening_ratio: 0.01,
        };
        assert!(solve_with_elastic_layered_sections(&request, &[bad])
            .unwrap_err()
            .contains("elastic fibers only"));
    }
    #[test]
    fn cantilever_pressure_balances_reactions() {
        let result = solve(&cantilever_request(false)).unwrap();
        assert!(result.nodes[2].w_m < 0.0);
        assert!(result.elements.iter().all(|e| e.max_fibre_strain > 0.0));
        let reactions: f64 = result.nodes.iter().map(|n| n.reaction_fz_kn).sum();
        assert!((reactions - 2.0).abs() < 1e-8);
        assert!(result.relative_residual < 1e-8);
    }

    #[test]
    fn hybrid_plate_support_springs_contribute_stiffness_and_reactions() {
        let mut request = cantilever_request(false);
        request.supports.extend([
            Support {
                node_id: 2,
                w: false,
                theta_x: false,
                theta_y: false,
                kw_kn_per_m: Some(25.0),
                ktheta_x_knm_per_rad: Some(10.0),
                ktheta_y_knm_per_rad: None,
            },
            Support {
                node_id: 3,
                w: false,
                theta_x: false,
                theta_y: false,
                kw_kn_per_m: Some(25.0),
                ktheta_x_knm_per_rad: None,
                ktheta_y_knm_per_rad: Some(10.0),
            },
        ]);
        let result = solve(&request).unwrap();
        for node_id in [2, 3] {
            let result_node = result
                .nodes
                .iter()
                .find(|node| node.node_id == node_id)
                .unwrap();
            let support = request
                .supports
                .iter()
                .find(|support| support.node_id == node_id)
                .unwrap();
            assert!((result_node.reaction_fz_kn + 25.0 * result_node.w_m).abs() < 1e-8);
            if let Some(stiffness) = support.ktheta_x_knm_per_rad {
                assert!(
                    (result_node.reaction_mx_knm + stiffness * result_node.theta_x_rad).abs()
                        < 1e-8
                );
            }
            if let Some(stiffness) = support.ktheta_y_knm_per_rad {
                assert!(
                    (result_node.reaction_my_knm + stiffness * result_node.theta_y_rad).abs()
                        < 1e-8
                );
            }
        }
        assert!(
            (result
                .nodes
                .iter()
                .map(|node| node.reaction_fz_kn)
                .sum::<f64>()
                - 2.0)
                .abs()
                < 1e-8
        );
        assert!(result.relative_residual < 1e-8);
    }

    #[test]
    fn cantilever_strip_with_tip_springs_matches_beam_compliance() {
        let length = 4.0;
        let width = 1.0;
        let divisions_y = 4usize;
        let spring_stiffness = 100.0;
        let mesh = crate::quad2d::mesh_squares(&crate::quad2d::SquareGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: length,
            height_m: width,
            cell_size_m: 0.25,
            material_id: 1,
            thickness_m: 0.1,
        })
        .unwrap();
        let nodes: Vec<Node> = mesh
            .nodes
            .iter()
            .map(|node| Node {
                id: node.id,
                x: node.x,
                y: node.y,
            })
            .collect();
        let mut supports: Vec<Support> = mesh
            .left_node_ids
            .iter()
            .map(|node_id| Support {
                node_id: *node_id,
                w: true,
                theta_x: true,
                theta_y: true,
                kw_kn_per_m: None,
                ktheta_x_knm_per_rad: None,
                ktheta_y_knm_per_rad: None,
            })
            .collect();
        for (index, node_id) in mesh.right_node_ids.iter().enumerate() {
            let tributary_width = width / divisions_y as f64
                * if index == 0 || index == divisions_y {
                    0.5
                } else {
                    1.0
                };
            supports.push(Support {
                node_id: *node_id,
                w: false,
                theta_x: false,
                theta_y: false,
                kw_kn_per_m: Some(spring_stiffness * tributary_width / width),
                ktheta_x_knm_per_rad: None,
                ktheta_y_knm_per_rad: None,
            });
        }
        let right_edge_loads = mesh
            .quads
            .iter()
            .filter(|quad| {
                let node_x = |id: usize| nodes[id - 1].x;
                (node_x(quad.node_ids[1]) - length).abs() < 1e-12
                    && (node_x(quad.node_ids[2]) - length).abs() < 1e-12
            })
            .map(|quad| EdgeLoad {
                quad_id: quad.id,
                edge_index: 1,
                start_kn_per_m: -1.0,
                end_kn_per_m: -1.0,
            })
            .collect();
        let result = solve(&Request {
            nodes,
            materials: vec![Material {
                id: 1,
                e_mpa: 30_000.0,
                nu: 0.0,
            }],
            orthotropic_materials: vec![],
            quads: mesh.quads,
            supports,
            loads: vec![],
            edge_loads: right_edge_loads,
            pressure_kn_m2: 0.0,
            quad_pressures: vec![],
            modulus_curves: vec![],
            reinforcement: None,
            load_path: vec![],
            tolerance: 1e-9,
            max_iterations: 40,
            linear_backend: LinearBackend::Existing,
            frontal_max_front_dofs: None,
        })
        .unwrap();
        let tip_nodes: Vec<_> = result
            .nodes
            .iter()
            .filter(|node| mesh.right_node_ids.contains(&node.node_id))
            .collect();
        let tip_deflection =
            tip_nodes.iter().map(|node| node.w_m).sum::<f64>() / tip_nodes.len() as f64;
        let elastic_modulus_kn_per_m2 = 30_000.0 * 1000.0;
        let flexural_rigidity_knm2 = elastic_modulus_kn_per_m2 * 0.1_f64.powi(3) * width / 12.0;
        let beam_tip_stiffness = 3.0 * flexural_rigidity_knm2 / length.powi(3);
        let exact_deflection = -1.0 / (beam_tip_stiffness + spring_stiffness);
        assert!(
            (tip_deflection - exact_deflection).abs() < exact_deflection.abs() * 0.015,
            "Q4 strip tip {tip_deflection} m versus beam/spring solution {exact_deflection} m"
        );
        assert!(
            (result
                .nodes
                .iter()
                .map(|node| node.reaction_fz_kn)
                .sum::<f64>()
                - 1.0)
                .abs()
                < 1e-8
        );
        assert!(result.relative_residual < 1e-8);
    }
    #[test]
    fn tapered_edge_line_load_has_exact_resultant_and_first_moment() {
        let request: Request =
            serde_json::from_str(include_str!("../examples/hybrid-plate-edge-line-load.json"))
                .unwrap();
        let result = solve(&request).unwrap();
        let vertical_reaction: f64 = result.nodes.iter().map(|node| node.reaction_fz_kn).sum();
        let support_my: f64 = result.nodes.iter().map(|node| node.reaction_my_knm).sum();
        assert!((vertical_reaction - 2.0).abs() < 1e-8);
        assert!((support_my - 4.0).abs() < 1e-8);
        assert!(result.nodes[2].w_m < 0.0);
        assert!(result.relative_residual < 1e-8);

        let mut invalid = request.clone();
        invalid.edge_loads[0].edge_index = 4;
        assert!(solve(&invalid)
            .unwrap_err()
            .contains("edge-load index must be between 0 and 3"));
        invalid.edge_loads[0].edge_index = 1;
        invalid.edge_loads[0].quad_id = 99;
        assert!(solve(&invalid)
            .unwrap_err()
            .contains("unknown hybrid edge-load quad"));
    }
    #[test]
    fn rectangular_quad_mesh_feeds_hybrid_plate_and_balances_pressure() {
        let mesh = crate::quad2d::mesh_quads(&crate::quad2d::QuadGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.1,
            height_m: 1.5,
            max_cell_size_m: 1.0,
            material_id: 1,
            thickness_m: 0.2,
            openings: vec![],
        })
        .unwrap();
        let request = Request {
            nodes: mesh
                .nodes
                .into_iter()
                .map(|node| Node {
                    id: node.id,
                    x: node.x,
                    y: node.y,
                })
                .collect(),
            materials: vec![Material {
                id: 1,
                e_mpa: 30_000.0,
                nu: 0.2,
            }],
            orthotropic_materials: vec![],
            quads: mesh.quads,
            supports: mesh
                .left_node_ids
                .into_iter()
                .map(|node_id| Support {
                    node_id,
                    w: true,
                    theta_x: true,
                    theta_y: true,
                    kw_kn_per_m: None,
                    ktheta_x_knm_per_rad: None,
                    ktheta_y_knm_per_rad: None,
                })
                .collect(),
            loads: vec![],
            pressure_kn_m2: -1.0,
            quad_pressures: vec![],
            edge_loads: vec![],
            modulus_curves: vec![],
            reinforcement: None,
            load_path: vec![],
            tolerance: 1e-8,
            max_iterations: 40,
            linear_backend: LinearBackend::Existing,
            frontal_max_front_dofs: None,
        };
        let result = solve(&request).unwrap();
        let reaction: f64 = result.nodes.iter().map(|node| node.reaction_fz_kn).sum();
        assert!((reaction - 2.1 * 1.5).abs() < 1e-8);
        assert!(result.nodes.iter().any(|node| node.w_m < 0.0));
        assert!(result
            .elements
            .iter()
            .all(|element| element.max_fibre_strain > 0.0));
        assert!(result.relative_residual < 1e-8);
    }
    #[test]
    fn perforated_rust_mesh_feeds_hybrid_plate_and_balances_net_pressure() {
        let mesh = crate::quad2d::mesh_quads(&crate::quad2d::QuadGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.0,
            height_m: 2.0,
            max_cell_size_m: 0.25,
            material_id: 1,
            thickness_m: 0.2,
            openings: vec![crate::quad2d::RectOpening {
                x_m: 0.75,
                y_m: 0.75,
                width_m: 0.5,
                height_m: 0.5,
            }],
        })
        .unwrap();
        let mut edge_ids = HashSet::new();
        for id in mesh
            .bottom_node_ids
            .iter()
            .chain(&mesh.right_node_ids)
            .chain(&mesh.top_node_ids)
            .chain(&mesh.left_node_ids)
        {
            edge_ids.insert(*id);
        }
        let request = Request {
            nodes: mesh
                .nodes
                .into_iter()
                .map(|node| Node {
                    id: node.id,
                    x: node.x,
                    y: node.y,
                })
                .collect(),
            quads: mesh.quads,
            materials: vec![Material {
                id: 1,
                e_mpa: 30_000.0,
                nu: 0.2,
            }],
            orthotropic_materials: vec![],
            supports: edge_ids
                .into_iter()
                .map(|node_id| Support {
                    node_id,
                    w: true,
                    theta_x: false,
                    theta_y: false,
                    kw_kn_per_m: None,
                    ktheta_x_knm_per_rad: None,
                    ktheta_y_knm_per_rad: None,
                })
                .collect(),
            loads: vec![],
            pressure_kn_m2: -1.0,
            quad_pressures: vec![],
            edge_loads: vec![],
            modulus_curves: vec![],
            reinforcement: None,
            load_path: vec![],
            tolerance: 1e-8,
            max_iterations: 40,
            linear_backend: LinearBackend::Existing,
            frontal_max_front_dofs: None,
        };
        let result = solve(&request).unwrap();
        assert_eq!(result.elements.len(), 60);
        assert!(result.nodes.iter().any(|node| node.w_m < -1e-6));
        let reaction: f64 = result.nodes.iter().map(|node| node.reaction_fz_kn).sum();
        assert!((reaction - 3.75).abs() < 1e-8);
        assert!(result.relative_residual < 1e-8);
    }
    #[test]
    fn graded_quad_pressure_reaches_solver_and_rejects_unknown_quad() {
        let mut request = cantilever_request(false);
        request.pressure_kn_m2 = 0.0;
        request.quad_pressures = vec![
            QuadPressure {
                quad_id: 1,
                nodal_pressure_kn_m2: [0.0, -1.0, -1.0, 0.0],
            },
            QuadPressure {
                quad_id: 2,
                nodal_pressure_kn_m2: [-1.0, -2.0, -2.0, -1.0],
            },
        ];
        let result = solve(&request).unwrap();
        let reactions: f64 = result.nodes.iter().map(|node| node.reaction_fz_kn).sum();
        assert!((reactions - 2.0).abs() < 1e-8);
        assert!(result.nodes[2].w_m < 0.0);
        request.pressure_kn_m2 = -1.0;
        let combined = solve(&request).unwrap();
        let combined_reactions: f64 = combined.nodes.iter().map(|node| node.reaction_fz_kn).sum();
        assert!((combined_reactions - 4.0).abs() < 1e-8);
        request.quad_pressures[1].quad_id = 999;
        assert!(solve(&request)
            .unwrap_err()
            .contains("unknown hybrid pressure quad"));
    }
    #[test]
    fn cement_cantilever_recovers_section_shear_and_total_reaction() {
        let mesh = crate::quad2d::mesh_squares(&crate::quad2d::SquareGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 10.0,
            height_m: 8.0,
            cell_size_m: 2.0,
            material_id: 1,
            thickness_m: 0.6,
        })
        .unwrap();
        let nodes: Vec<Node> = mesh
            .nodes
            .into_iter()
            .map(|node| Node {
                id: node.id,
                x: node.x,
                y: node.y,
            })
            .collect();
        let supports = nodes
            .iter()
            .filter(|node| node.y == 0.0 || node.x == 0.0 || node.x == 10.0)
            .map(|node| Support {
                node_id: node.id,
                w: node.y == 0.0,
                theta_x: node.y == 0.0,
                theta_y: node.y == 0.0 || node.x == 0.0 || node.x == 10.0,
                kw_kn_per_m: None,
                ktheta_x_knm_per_rad: None,
                ktheta_y_knm_per_rad: None,
            })
            .collect();
        let result = solve(&Request {
            nodes,
            quads: mesh.quads,
            materials: vec![Material {
                id: 1,
                e_mpa: 30_000.0,
                nu: 0.2,
            }],
            orthotropic_materials: vec![],
            supports,
            loads: vec![],
            pressure_kn_m2: -30.0,
            quad_pressures: vec![],
            edge_loads: vec![],
            modulus_curves: vec![],
            reinforcement: None,
            load_path: vec![],
            tolerance: 1e-8,
            max_iterations: 40,
            linear_backend: LinearBackend::Existing,
            frontal_max_front_dofs: None,
        })
        .unwrap();
        // The first cell centre is one metre from the support: q(L-y)=30(8-1).
        assert!((result.elements[0].shear_kn_per_m[1] - 210.0).abs() < 1e-7);
        let samples = &result.elements[0].resultant_samples;
        assert_eq!(
            samples.len(),
            21,
            "four corners, centre and sixteen 4x4 Gauss points"
        );
        let gauss = samples
            .iter()
            .filter(|sample| {
                sample.position_m[0] > 0.0
                    && sample.position_m[0] < 2.0
                    && sample.position_m[1] > 0.0
                    && sample.position_m[1] < 2.0
                    && (sample.position_m[0] - 1.0).abs() > 1e-8
                    && (sample.position_m[1] - 1.0).abs() > 1e-8
            })
            .collect::<Vec<_>>();
        assert_eq!(gauss.len(), 16);
        for sample in gauss {
            let expected = 30.0 * (8.0 - sample.position_m[1]);
            assert!((sample.shear_kn_per_m[1] - expected).abs() < 1e-7);
        }
        let total_reaction: f64 = result.nodes.iter().map(|node| node.reaction_fz_kn).sum();
        assert!((total_reaction - 30.0 * 10.0 * 8.0).abs() < 1e-7);
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
    fn bending_variable_modulus_matches_independent_secant_solution() {
        let mesh = crate::quad2d::mesh_quads(&crate::quad2d::QuadGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.0,
            height_m: 1.0,
            max_cell_size_m: 2.0,
            material_id: 1,
            thickness_m: 0.2,
            openings: vec![],
        })
        .unwrap();
        let mut request = cantilever_request(false);
        request.nodes = mesh
            .nodes
            .iter()
            .map(|node| Node {
                id: node.id,
                x: node.x,
                y: node.y,
            })
            .collect();
        request.quads = mesh.quads;
        request.supports = mesh
            .left_node_ids
            .iter()
            .map(|&node_id| Support {
                node_id,
                w: true,
                theta_x: true,
                theta_y: true,
                kw_kn_per_m: None,
                ktheta_x_knm_per_rad: None,
                ktheta_y_knm_per_rad: None,
            })
            .collect();
        let linear = solve(&request).unwrap();
        let initial_e_mpa = 30_000.0;
        let final_e_mpa = 15_000.0;
        let curve_limit = 1e-3;
        let baseline_peak_strain = linear.elements[0].max_fibre_strain;
        let strain_modulus_product = initial_e_mpa * baseline_peak_strain;
        let modulus_for_strain = |strain: f64| {
            if strain >= curve_limit {
                final_e_mpa
            } else {
                initial_e_mpa + (final_e_mpa - initial_e_mpa) * strain / curve_limit
            }
        };
        // For one element the strain shape is unchanged by scalar E changes:
        // epsilon_peak * E is constant. Solve E = curve(epsilon_peak(E)).
        let residual = |e_mpa: f64| e_mpa - modulus_for_strain(strain_modulus_product / e_mpa);
        let (mut lower, mut upper) = (final_e_mpa, initial_e_mpa);
        for _ in 0..80 {
            let middle = 0.5 * (lower + upper);
            if residual(middle) > 0.0 {
                upper = middle;
            } else {
                lower = middle;
            }
        }
        let expected_e_mpa = 0.5 * (lower + upper);
        let expected_peak_strain = strain_modulus_product / expected_e_mpa;
        let expected_tip_w = linear.nodes[2].w_m * initial_e_mpa / expected_e_mpa;

        request.modulus_curves = vec![ModulusCurve {
            material_id: 1,
            points: vec![
                crate::quad2d::ModulusPoint {
                    strain: 0.0,
                    e_mpa: initial_e_mpa,
                },
                crate::quad2d::ModulusPoint {
                    strain: curve_limit,
                    e_mpa: final_e_mpa,
                },
            ],
        }];
        let nonlinear = solve(&request).unwrap();
        assert!(
            (nonlinear.elements[0].effective_e_mpa - expected_e_mpa).abs() < 1e-5,
            "effective E {} MPa != independent secant solution {expected_e_mpa} MPa",
            nonlinear.elements[0].effective_e_mpa
        );
        assert!((nonlinear.elements[0].max_fibre_strain - expected_peak_strain).abs() < 1e-10);
        assert!((nonlinear.nodes[2].w_m - expected_tip_w).abs() < 1e-10);
        assert!(nonlinear.relative_residual < 1e-8);

        request.load_path = vec![1.0, 0.0];
        let unloaded = solve(&request).unwrap();
        assert!(unloaded.nodes[2].w_m.abs() < 1e-9);
        assert!((unloaded.elements[0].effective_e_mpa - expected_e_mpa).abs() < 1e-5);
        assert!((unloaded.elements[0].max_fibre_strain - expected_peak_strain).abs() < 1e-10);
        assert!(unloaded.relative_residual < 1e-8);
    }

    #[test]
    fn saturated_secant_modulus_scales_plate_deflection_and_preserves_peak_strain() {
        let linear = solve(&cantilever_request(false)).unwrap();
        let mut request = cantilever_request(false);
        request.modulus_curves = vec![ModulusCurve {
            material_id: 1,
            points: vec![
                crate::quad2d::ModulusPoint {
                    strain: 0.0,
                    e_mpa: 30_000.0,
                },
                crate::quad2d::ModulusPoint {
                    strain: 1e-10,
                    e_mpa: 15_000.0,
                },
            ],
        }];
        let softened = solve(&request).unwrap();
        assert!((softened.nodes[2].w_m / linear.nodes[2].w_m - 2.0).abs() < 1e-8);
        assert!(softened.elements.iter().all(|e| {
            (e.effective_e_mpa - 15_000.0).abs() < 1e-8 && e.max_fibre_strain > 1e-10
        }));
        request.load_path = vec![1.0, 0.0];
        let unloaded = solve(&request).unwrap();
        assert!(unloaded.nodes[2].w_m.abs() < 1e-9);
        for (peak, now) in softened.elements.iter().zip(&unloaded.elements) {
            assert!((peak.max_fibre_strain - now.max_fibre_strain).abs() < 1e-12);
            assert!((now.effective_e_mpa - 15_000.0).abs() < 1e-8);
        }
    }

    #[test]
    fn orthotropic_hybrid_bending_uses_rotated_compliance_and_secant_modulus() {
        let material = OrthotropicMaterial {
            material_id: 1,
            e1_mpa: 1_000.0,
            e2_mpa: 500.0,
            nu12: 0.0,
            g12_mpa: 200.0,
            angle_rad: 0.0,
        };
        let compliance = bending_compliance(0.0, Some(&material), 0.1).unwrap();
        assert!((compliance[0][0] - 12.0).abs() < 1e-10);
        assert!((compliance[1][1] - 24.0).abs() < 1e-10);
        assert!((compliance[2][2] - 60.0).abs() < 1e-10);
        let rotated = bending_compliance(
            0.0,
            Some(&OrthotropicMaterial {
                angle_rad: std::f64::consts::FRAC_PI_2,
                ..material
            }),
            0.1,
        )
        .unwrap();
        assert!((rotated[0][0] - compliance[1][1]).abs() < 1e-10);
        assert!((rotated[1][1] - compliance[0][0]).abs() < 1e-10);

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
        let plate_material = Material {
            id: 1,
            e_mpa: 1_000.0,
            nu: 0.0,
        };
        let quad = Quad {
            id: 1,
            node_ids: [1, 2, 3, 4],
            material_id: 1,
            thickness_m: 0.1,
        };
        let element = element_with_orthotropic(
            &quad,
            [&nodes[0], &nodes[1], &nodes[2], &nodes[3]],
            std::array::from_fn(|i| i),
            &plate_material,
            Some(&material),
        )
        .unwrap();
        let curvature = 0.01;
        let bending_local = std::array::from_fn(|i| {
            let node = &nodes[i / 3];
            match i % 3 {
                0 => 0.5 * curvature * node.x * node.x,
                1 => 0.0,
                _ => curvature * node.x,
            }
        });
        let fibre_strain = max_fibre_strain(&element, &bending_local, material.e1_mpa);
        let combined_strain = shell_max_combined_fibre_strain(
            &element,
            [&nodes[0], &nodes[1], &nodes[2], &nodes[3]],
            &bending_local,
            material.e1_mpa,
            &[[0.0; 3]; NGAUSS * NGAUSS],
        )
        .unwrap();
        assert!((combined_strain - fibre_strain).abs() < 1e-12);

        let mut base = cantilever_request(false);
        base.materials[0].e_mpa = 1_000.0;
        base.materials[0].nu = 0.0;
        base.orthotropic_materials = vec![material];
        let mut curved = base.clone();
        curved.modulus_curves = vec![ModulusCurve {
            material_id: 1,
            points: vec![
                crate::quad2d::ModulusPoint {
                    strain: 0.0,
                    e_mpa: 1_000.0,
                },
                crate::quad2d::ModulusPoint {
                    strain: 1e-16,
                    e_mpa: 500.0,
                },
            ],
        }];
        let curved_result = solve(&curved).unwrap();
        let mut fixed_soft = base;
        fixed_soft.materials[0].e_mpa = 500.0;
        fixed_soft.orthotropic_materials[0].e1_mpa = 500.0;
        fixed_soft.orthotropic_materials[0].e2_mpa = 250.0;
        fixed_soft.orthotropic_materials[0].g12_mpa = 100.0;
        let fixed_result = solve(&fixed_soft).unwrap();
        assert!(curved_result.elements.iter().all(|element| {
            (element.effective_e_mpa - 500.0).abs() < 1e-8 && element.max_fibre_strain > 1e-16
        }));
        for (curved, fixed) in curved_result.nodes.iter().zip(&fixed_result.nodes) {
            assert!((curved.w_m - fixed.w_m).abs() < 1e-10);
            assert!((curved.theta_x_rad - fixed.theta_x_rad).abs() < 1e-10);
            assert!((curved.theta_y_rad - fixed.theta_y_rad).abs() < 1e-10);
        }

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
        let mut displacement = [0.0; 20];
        for (i, node) in nodes.iter().enumerate() {
            displacement[5 * i] = 1e-7 * node.x;
            displacement[5 * i + 1] = 2e-7 * node.y;
        }
        let membrane = shell_membrane_response_with_orthotropy(
            [&nodes[0], &nodes[1], &nodes[2], &nodes[3]],
            std::array::from_fn(|i| i),
            &displacement,
            1_000.0,
            0.0,
            0.1,
            MaterialLaw::Elastic,
            &[MaterialState::default(); NGAUSS * NGAUSS],
            Some(&material),
        )
        .unwrap();
        let right_force = membrane.force[5] + membrane.force[10];
        let top_force = membrane.force[11] + membrane.force[16];
        assert!(
            (right_force - 0.01).abs() < 1e-8,
            "right force {right_force}"
        );
        assert!((top_force - 0.01).abs() < 1e-8, "top force {top_force}");
    }

    #[test]
    fn fnl_keeps_independent_modulus_histories_for_multiple_plate_materials() {
        let mut request = cantilever_request(false);
        let node_offset = request.nodes.len();
        let quad_offset = request.quads.len();
        let duplicate_nodes: Vec<_> = request
            .nodes
            .iter()
            .map(|node| Node {
                id: node.id + node_offset,
                x: node.x,
                y: node.y + 2.0,
            })
            .collect();
        let duplicate_quads: Vec<_> = request
            .quads
            .iter()
            .map(|quad| Quad {
                id: quad.id + quad_offset,
                node_ids: quad.node_ids.map(|id| id + node_offset),
                material_id: 2,
                thickness_m: quad.thickness_m,
            })
            .collect();
        let duplicate_supports: Vec<_> = request
            .supports
            .iter()
            .map(|support| Support {
                node_id: support.node_id + node_offset,
                ..support.clone()
            })
            .collect();
        request.nodes.extend(duplicate_nodes);
        request.quads.extend(duplicate_quads);
        request.supports.extend(duplicate_supports);
        request.materials.push(Material {
            id: 2,
            e_mpa: 30_000.0,
            nu: 0.0,
        });
        request.modulus_curves = vec![
            ModulusCurve {
                material_id: 1,
                points: vec![
                    crate::quad2d::ModulusPoint {
                        strain: 0.0,
                        e_mpa: 30_000.0,
                    },
                    crate::quad2d::ModulusPoint {
                        strain: 1e-8,
                        e_mpa: 24_000.0,
                    },
                ],
            },
            ModulusCurve {
                material_id: 2,
                points: vec![
                    crate::quad2d::ModulusPoint {
                        strain: 0.0,
                        e_mpa: 30_000.0,
                    },
                    crate::quad2d::ModulusPoint {
                        strain: 1e-8,
                        e_mpa: 12_000.0,
                    },
                ],
            },
        ];
        request.load_path = vec![1.0];

        let nonlinear = solve(&request).unwrap();
        assert!(nonlinear.relative_residual < 1e-8);
        for element in &nonlinear.elements {
            let expected_e = if element.quad_id <= quad_offset {
                24_000.0
            } else {
                12_000.0
            };
            assert!(
                (element.effective_e_mpa - expected_e).abs() < 1e-6,
                "quad {} used E={} MPa; expected its material-specific E={expected_e} MPa",
                element.quad_id,
                element.effective_e_mpa
            );
        }

        // Freeze each converged material modulus and solve again. This
        // independent linear reference must reproduce the nonlinear
        // displacements when the two disconnected plates have different E.
        let mut reference = request.clone();
        reference.modulus_curves.clear();
        reference.load_path.clear();
        reference.materials[0].e_mpa = 24_000.0;
        reference.materials[1].e_mpa = 12_000.0;
        let elastic_reference = solve(&reference).unwrap();
        for (actual, expected) in nonlinear.nodes.iter().zip(&elastic_reference.nodes) {
            assert_eq!(actual.node_id, expected.node_id);
            assert!((actual.w_m - expected.w_m).abs() < 1e-10);
            assert!((actual.theta_x_rad - expected.theta_x_rad).abs() < 1e-10);
            assert!((actual.theta_y_rad - expected.theta_y_rad).abs() < 1e-10);
        }

        request.load_path = vec![1.0, 0.0];
        let unloaded = solve(&request).unwrap();
        assert!(unloaded.nodes.iter().all(|node| {
            node.w_m.abs() < 1e-9 && node.theta_x_rad.abs() < 1e-9 && node.theta_y_rad.abs() < 1e-9
        }));
        for element in unloaded.elements {
            let expected_e = if element.quad_id <= quad_offset {
                24_000.0
            } else {
                12_000.0
            };
            assert!((element.effective_e_mpa - expected_e).abs() < 1e-6);
            assert!(element.max_fibre_strain > 1e-8);
        }
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
            orthotropic_materials: vec![],
            supports: vec![],
            loads: vec![],
            pressure_kn_m2: -1.0,
            quad_pressures: vec![],
            edge_loads: vec![],
            modulus_curves: vec![],
            reinforcement: None,
            load_path: vec![],
            tolerance: 1e-8,
            max_iterations: 40,
            linear_backend: LinearBackend::Existing,
            frontal_max_front_dofs: None,
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
                kw_kn_per_m: None,
                ktheta_x_knm_per_rad: None,
                ktheta_y_knm_per_rad: None,
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
    #[test]
    fn recovered_shear_approximates_cantilever_support_value() {
        let mut request = cantilever_request(false);
        request.reinforcement = Some(
            serde_json::from_value(serde_json::json!({
                "limitState":"ultimate", "fckMpa":20.0, "fctmMpa":2.2,
                "gammaC":1.5, "fydMpa":435.0, "fywdMpa":435.0,
                "esMpa":200000.0, "coverMm":20.0, "barDiameterMm":12.0,
                "topXMm2PerM":1000.0, "topYMm2PerM":1000.0,
                "bottomXMm2PerM":1000.0, "bottomYMm2PerM":1000.0
            }))
            .unwrap(),
        );
        let result = solve(&request).unwrap();
        let governing = result.elements[0]
            .reinforcement
            .as_ref()
            .unwrap()
            .shear
            .as_ref()
            .unwrap();
        assert!((governing.position_m[0]).abs() < 1e-12);
        // The lumped pressure and patch recovery are approximate on two cells.
        // The continuum shear is qL = 2 kN/m at the fixed edge.
        assert!((governing.check.demand_kn_per_m - 2.0).abs() / 2.0 < 0.1);
        assert!(governing.check.demand_kn_per_m > result.elements[0].shear_kn_per_m[0]);
    }
    #[test]
    fn sparse_hybrid_plate_above_600_dof_matches_navier_deflection() {
        let n = 14;
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
        assert!(3 * mesh.nodes.len() > 600);
        let nodes: Vec<Node> = mesh
            .nodes
            .into_iter()
            .map(|node| Node {
                id: node.id,
                x: node.x,
                y: node.y,
            })
            .collect();
        let supports = nodes
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
                kw_kn_per_m: None,
                ktheta_x_knm_per_rad: None,
                ktheta_y_knm_per_rad: None,
            })
            .collect();
        let result = solve(&Request {
            nodes,
            quads: mesh.quads,
            materials: vec![Material {
                id: 1,
                e_mpa: 30_000.0,
                nu: 0.2,
            }],
            orthotropic_materials: vec![],
            supports,
            loads: vec![],
            pressure_kn_m2: -1.0,
            quad_pressures: vec![],
            edge_loads: vec![],
            modulus_curves: vec![],
            reinforcement: None,
            load_path: vec![],
            tolerance: 1e-8,
            max_iterations: 40,
            linear_backend: LinearBackend::Existing,
            frontal_max_front_dofs: None,
        })
        .unwrap();
        let centre_id = 1 + (n / 2) * (n + 1) + n / 2;
        let centre_w = result.nodes[centre_id - 1].w_m;
        let rigidity = 30_000.0 * 1000.0 * 0.1_f64.powi(3) / (12.0 * (1.0 - 0.2_f64.powi(2)));
        let navier = -0.00406 * 2.0_f64.powi(4) / rigidity;
        assert!(
            ((centre_w - navier) / navier).abs() < 0.03,
            "{centre_w} vs {navier}"
        );
        assert!(
            result.relative_residual < 1e-8,
            "{}",
            result.relative_residual
        );
    }
    #[test]
    fn sparse_hybrid_fnl_rechecks_tangent_and_keeps_peak_modulus() {
        let n = 14;
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
        let nodes: Vec<Node> = mesh
            .nodes
            .into_iter()
            .map(|node| Node {
                id: node.id,
                x: node.x,
                y: node.y,
            })
            .collect();
        assert!(3 * nodes.len() > 600);
        let supports = nodes
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
                kw_kn_per_m: None,
                ktheta_x_knm_per_rad: None,
                ktheta_y_knm_per_rad: None,
            })
            .collect();
        let result = solve(&Request {
            nodes,
            quads: mesh.quads,
            materials: vec![Material {
                id: 1,
                e_mpa: 30_000.0,
                nu: 0.2,
            }],
            orthotropic_materials: vec![],
            supports,
            loads: vec![],
            pressure_kn_m2: -1.0,
            quad_pressures: vec![],
            edge_loads: vec![],
            modulus_curves: vec![ModulusCurve {
                material_id: 1,
                points: vec![
                    crate::quad2d::ModulusPoint {
                        strain: 0.0,
                        e_mpa: 30_000.0,
                    },
                    crate::quad2d::ModulusPoint {
                        strain: 1e-10,
                        e_mpa: 15_000.0,
                    },
                ],
            }],
            reinforcement: None,
            load_path: vec![1.0, 0.0],
            tolerance: 1e-8,
            max_iterations: 40,
            linear_backend: LinearBackend::Existing,
            frontal_max_front_dofs: None,
        })
        .unwrap();
        assert!(result.nodes.iter().all(|node| node.w_m.abs() < 1e-9));
        assert!(result
            .elements
            .iter()
            .all(|element| (element.effective_e_mpa - 15_000.0).abs() < 1e-8));
        assert!(result
            .elements
            .iter()
            .all(|element| element.max_fibre_strain > 1e-10));
        assert!(result.relative_residual < 1e-8);
    }

    #[test]
    fn geometric_shell_recovers_uniform_membrane_tension_and_bendingdofs() {
        let nodes = vec![
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
        let bending = Request {
            nodes: nodes.clone(),
            materials: vec![Material {
                id: 1,
                e_mpa: 30_000.0,
                nu: 0.0,
            }],
            orthotropic_materials: vec![],
            quads: vec![Quad {
                id: 1,
                node_ids: [1, 2, 3, 4],
                material_id: 1,
                thickness_m: 0.1,
            }],
            supports: nodes
                .iter()
                .map(|node| Support {
                    node_id: node.id,
                    w: true,
                    theta_x: true,
                    theta_y: true,
                    kw_kn_per_m: None,
                    ktheta_x_knm_per_rad: None,
                    ktheta_y_knm_per_rad: None,
                })
                .collect(),
            loads: vec![],
            edge_loads: vec![],
            pressure_kn_m2: 0.0,
            quad_pressures: vec![],
            modulus_curves: vec![],
            reinforcement: None,
            load_path: vec![],
            tolerance: 1e-9,
            max_iterations: 30,
            linear_backend: LinearBackend::Existing,
            frontal_max_front_dofs: None,
        };
        let result = solve_geometric_shell(&GeometricShellRequest {
            bending: bending.clone(),
            analysis: Analysis::default(),
            material_laws: HashMap::new(),
            membrane_supports: vec![
                MembraneSupport {
                    node_id: 1,
                    u: true,
                    v: true,
                    ku_kn_per_m: None,
                    kv_kn_per_m: None,
                },
                MembraneSupport {
                    node_id: 4,
                    u: true,
                    v: true,
                    ku_kn_per_m: None,
                    kv_kn_per_m: None,
                },
            ],
            membrane_loads: vec![
                MembraneLoad {
                    node_id: 2,
                    fx_kn: 2.5,
                    fy_kn: 0.0,
                },
                MembraneLoad {
                    node_id: 3,
                    fx_kn: 2.5,
                    fy_kn: 0.0,
                },
            ],
        })
        .unwrap();
        // E=30,000 MPa = 30,000,000 kN/m² and A=0.1 m².
        let linear_strain: f64 = 5.0 / (30_000_000.0 * 0.1);
        let exact = (1.0 + 2.0 * linear_strain).sqrt() - 1.0;
        assert!((result.nodes[1].u_m - exact).abs() < 1e-10);
        assert!((result.nodes[2].u_m - exact).abs() < 1e-10);
        assert!(result.nodes.iter().all(|node| node.w_m.abs() < 1e-10));

        let mut spring_bending = bending.clone();
        spring_bending
            .supports
            .retain(|support| support.node_id == 1 || support.node_id == 4);
        spring_bending.supports.extend([
            Support {
                node_id: 2,
                w: false,
                theta_x: false,
                theta_y: false,
                kw_kn_per_m: Some(100.0),
                ktheta_x_knm_per_rad: Some(20.0),
                ktheta_y_knm_per_rad: None,
            },
            Support {
                node_id: 3,
                w: false,
                theta_x: false,
                theta_y: false,
                kw_kn_per_m: Some(100.0),
                ktheta_x_knm_per_rad: None,
                ktheta_y_knm_per_rad: Some(20.0),
            },
        ]);
        spring_bending.pressure_kn_m2 = -1.0;
        let spring_shell = solve_geometric_shell(&GeometricShellRequest {
            bending: spring_bending,
            analysis: Analysis::default(),
            material_laws: HashMap::new(),
            membrane_supports: vec![
                MembraneSupport {
                    node_id: 1,
                    u: true,
                    v: true,
                    ku_kn_per_m: None,
                    kv_kn_per_m: None,
                },
                MembraneSupport {
                    node_id: 4,
                    u: true,
                    v: true,
                    ku_kn_per_m: None,
                    kv_kn_per_m: None,
                },
            ],
            membrane_loads: vec![],
        })
        .unwrap();
        for node_id in [2, 3] {
            let node = spring_shell
                .nodes
                .iter()
                .find(|node| node.node_id == node_id)
                .unwrap();
            assert!((node.reaction_fz_kn + 100.0 * node.w_m).abs() < 1e-8);
            if node_id == 2 {
                assert!((node.reaction_mx_knm + 20.0 * node.theta_x_rad).abs() < 1e-8);
            } else {
                assert!((node.reaction_my_knm + 20.0 * node.theta_y_rad).abs() < 1e-8);
            }
        }
        assert!(
            (spring_shell
                .nodes
                .iter()
                .map(|node| node.reaction_fz_kn)
                .sum::<f64>()
                - 1.0)
                .abs()
                < 1e-8
        );
        assert!(spring_shell.relative_residual < 1e-8);

        let mut reinforced_bending = bending;
        reinforced_bending.reinforcement = Some(
            serde_json::from_value(serde_json::json!({
                "limitState":"service", "fckMpa":30.0, "fctmMpa":2.9,
                "gammaC":1.5, "fydMpa":435.0, "fywdMpa":435.0,
                "esMpa":200000.0, "coverMm":20.0, "barDiameterMm":12.0,
                "topXMm2PerM":2000.0, "topYMm2PerM":2000.0,
                "bottomXMm2PerM":2000.0, "bottomYMm2PerM":2000.0,
                "crackLimitMm":0.3
            }))
            .unwrap(),
        );
        let reinforced = solve_geometric_shell(&GeometricShellRequest {
            bending: reinforced_bending,
            analysis: Analysis::default(),
            material_laws: HashMap::new(),
            membrane_supports: vec![
                MembraneSupport {
                    node_id: 1,
                    u: true,
                    v: true,
                    ku_kn_per_m: None,
                    kv_kn_per_m: None,
                },
                MembraneSupport {
                    node_id: 4,
                    u: true,
                    v: true,
                    ku_kn_per_m: None,
                    kv_kn_per_m: None,
                },
            ],
            membrane_loads: vec![
                MembraneLoad {
                    node_id: 2,
                    fx_kn: 200.0,
                    fy_kn: 0.0,
                },
                MembraneLoad {
                    node_id: 3,
                    fx_kn: 200.0,
                    fy_kn: 0.0,
                },
            ],
        })
        .unwrap();
        let membrane_nxx = reinforced.elements[0].membrane_kn_per_m[0];
        assert!(membrane_nxx > 300.0, "{membrane_nxx}");
        let reinforcement = reinforced.elements[0].reinforcement.as_ref().unwrap();
        assert_eq!(reinforcement.checked_points, 21);
        let crack = reinforcement.crack.as_ref().unwrap();
        for face in [0, 2] {
            assert!((crack[face].check.tensile_force_kn_per_m - 0.5 * membrane_nxx).abs() < 1e-3);
            assert!(crack[face].check.cracked);
            assert!(crack[face].check.characteristic_width_mm.unwrap() > 0.0);
        }
        assert!(result.relative_residual < 1e-9);
        assert!(reinforced.relative_residual < 1e-9);
    }

    #[test]
    fn geometric_shell_secant_modulus_retains_peak_strain_after_unloading() {
        let nodes = vec![
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
        let bending = Request {
            nodes: nodes.clone(),
            materials: vec![Material {
                id: 1,
                e_mpa: 30_000.0,
                nu: 0.0,
            }],
            orthotropic_materials: vec![],
            quads: vec![Quad {
                id: 1,
                node_ids: [1, 2, 3, 4],
                material_id: 1,
                thickness_m: 0.1,
            }],
            supports: nodes
                .iter()
                .map(|node| Support {
                    node_id: node.id,
                    w: true,
                    theta_x: true,
                    theta_y: true,
                    kw_kn_per_m: None,
                    ktheta_x_knm_per_rad: None,
                    ktheta_y_knm_per_rad: None,
                })
                .collect(),
            loads: vec![],
            edge_loads: vec![],
            pressure_kn_m2: 0.0,
            quad_pressures: vec![],
            modulus_curves: vec![ModulusCurve {
                material_id: 1,
                points: vec![
                    crate::quad2d::ModulusPoint {
                        strain: 0.0,
                        e_mpa: 30_000.0,
                    },
                    crate::quad2d::ModulusPoint {
                        strain: 1e-10,
                        e_mpa: 15_000.0,
                    },
                ],
            }],
            reinforcement: None,
            load_path: vec![1.0, 0.0],
            tolerance: 1e-8,
            max_iterations: 40,
            linear_backend: LinearBackend::Existing,
            frontal_max_front_dofs: None,
        };
        let result = solve_geometric_shell(&GeometricShellRequest {
            bending: bending.clone(),
            analysis: Analysis::default(),
            material_laws: HashMap::new(),
            membrane_supports: vec![
                MembraneSupport {
                    node_id: 1,
                    u: true,
                    v: true,
                    ku_kn_per_m: None,
                    kv_kn_per_m: None,
                },
                MembraneSupport {
                    node_id: 4,
                    u: true,
                    v: true,
                    ku_kn_per_m: None,
                    kv_kn_per_m: None,
                },
            ],
            membrane_loads: vec![
                MembraneLoad {
                    node_id: 2,
                    fx_kn: 2.5,
                    fy_kn: 0.0,
                },
                MembraneLoad {
                    node_id: 3,
                    fx_kn: 2.5,
                    fy_kn: 0.0,
                },
            ],
        })
        .unwrap();
        let mut peak_bending = bending;
        peak_bending.load_path = vec![1.0];
        let peak = solve_geometric_shell(&GeometricShellRequest {
            bending: peak_bending,
            analysis: Analysis::default(),
            material_laws: HashMap::new(),
            membrane_supports: vec![
                MembraneSupport {
                    node_id: 1,
                    u: true,
                    v: true,
                    ku_kn_per_m: None,
                    kv_kn_per_m: None,
                },
                MembraneSupport {
                    node_id: 4,
                    u: true,
                    v: true,
                    ku_kn_per_m: None,
                    kv_kn_per_m: None,
                },
            ],
            membrane_loads: vec![
                MembraneLoad {
                    node_id: 2,
                    fx_kn: 2.5,
                    fy_kn: 0.0,
                },
                MembraneLoad {
                    node_id: 3,
                    fx_kn: 2.5,
                    fy_kn: 0.0,
                },
            ],
        })
        .unwrap();
        let exact_secant_strain: f64 = 5.0 / (15_000_000.0 * 0.1);
        let exact_secant_displacement = (1.0 + 2.0 * exact_secant_strain).sqrt() - 1.0;
        assert!((peak.nodes[1].u_m - exact_secant_displacement).abs() < 1e-10);
        assert!((peak.elements[0].effective_e_mpa - 15_000.0).abs() < 1e-8);
        assert!(result.nodes.iter().all(|node| node.u_m.abs() < 1e-10));
        assert!((result.elements[0].effective_e_mpa - 15_000.0).abs() < 1e-8);
        assert!(result.elements[0].max_combined_strain > 1e-10);
        assert!(result.relative_residual < 1e-8);
    }

    #[test]
    fn geometric_shell_membrane_tangent_matches_finite_difference() {
        let nodes = [
            Node {
                id: 1,
                x: 0.0,
                y: 0.0,
            },
            Node {
                id: 2,
                x: 1.3,
                y: 0.1,
            },
            Node {
                id: 3,
                x: 1.2,
                y: 1.0,
            },
            Node {
                id: 4,
                x: -0.1,
                y: 0.9,
            },
        ];
        let coords = [&nodes[0], &nodes[1], &nodes[2], &nodes[3]];
        let dofs: [usize; 20] = std::array::from_fn(|i| i);
        let u: Vec<f64> = (0..20)
            .map(|i| {
                if i % 5 < 3 {
                    (i as f64 - 8.0) * 1.0e-4
                } else {
                    0.0
                }
            })
            .collect();
        let base = shell_membrane_response(coords, dofs, &u, 30_000.0, 0.2, 0.12).unwrap();
        let mut error_squared = 0.0;
        let mut tangent_squared = 0.0;
        for column in 0..20 {
            let step = 1e-8;
            let mut perturbed = u.clone();
            perturbed[column] += step;
            let shifted =
                shell_membrane_response(coords, dofs, &perturbed, 30_000.0, 0.2, 0.12).unwrap();
            for row in 0..20 {
                let numerical = (shifted.force[row] - base.force[row]) / step;
                let exact = base.tangent[row][column];
                error_squared += (numerical - exact).powi(2);
                tangent_squared += exact.powi(2);
            }
        }
        assert!((error_squared / tangent_squared).sqrt() < 1e-6);
    }

    #[test]
    fn geometric_shell_membrane_retains_steel_plasticity_and_concrete_damage() {
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
        let coords = [&nodes[0], &nodes[1], &nodes[2], &nodes[3]];
        let dofs: [usize; 20] = std::array::from_fn(|i| i);
        let make_displacement = |ex: f64, ey: f64| {
            let mut displacement = vec![0.0; 20];
            for (node, point) in nodes.iter().enumerate() {
                displacement[5 * node] = ex * point.x;
                displacement[5 * node + 1] = ey * point.y;
            }
            displacement
        };
        let steel_law = MaterialLaw::SteelBilinear {
            yield_mpa: 235.0,
            hardening_ratio: 0.02,
        };
        let steel_load = make_displacement(0.004, -0.3 * 0.004);
        let steel = shell_membrane_response_with_law(
            coords,
            dofs,
            &steel_load,
            210_000.0,
            0.3,
            0.1,
            steel_law,
            &[MaterialState::default(); NGAUSS * NGAUSS],
        )
        .unwrap();
        let elastic_steel = shell_membrane_response_with_law(
            coords,
            dofs,
            &steel_load,
            210_000.0,
            0.3,
            0.1,
            MaterialLaw::Elastic,
            &[MaterialState::default(); NGAUSS * NGAUSS],
        )
        .unwrap();
        assert!(steel.centre_resultant[0] < elastic_steel.centre_resultant[0]);
        assert!(steel
            .states
            .iter()
            .all(|state| state.equivalent_plastic_strain > 0.0));
        let steel_unload = make_displacement(
            steel.states[0].plastic_strain[0],
            steel.states[0].plastic_strain[1],
        );
        let unloaded_steel = shell_membrane_response_with_law(
            coords,
            dofs,
            &steel_unload,
            210_000.0,
            0.3,
            0.1,
            steel_law,
            &steel.states,
        )
        .unwrap();
        assert!(unloaded_steel.centre_resultant[0].is_finite());
        assert!(unloaded_steel
            .states
            .iter()
            .all(|state| state.equivalent_plastic_strain > 0.0));

        let concrete_law = MaterialLaw::ConcreteCracking {
            tensile_mpa: 3.0,
            residual_ratio: 0.02,
        };
        let concrete_load = make_displacement(0.001, -0.2 * 0.001);
        let concrete = shell_membrane_response_with_law(
            coords,
            dofs,
            &concrete_load,
            30_000.0,
            0.2,
            0.1,
            concrete_law,
            &[MaterialState::default(); NGAUSS * NGAUSS],
        )
        .unwrap();
        assert!(concrete
            .states
            .iter()
            .all(|state| state.tensile_damage > 0.8));
        let unloaded_concrete = shell_membrane_response_with_law(
            coords,
            dofs,
            &make_displacement(0.0, 0.0),
            30_000.0,
            0.2,
            0.1,
            concrete_law,
            &concrete.states,
        )
        .unwrap();
        assert!(unloaded_concrete
            .states
            .iter()
            .all(|state| state.tensile_damage > 0.8));
        assert!(unloaded_concrete
            .centre_resultant
            .iter()
            .all(|value| value.abs() < 1e-8));
    }

    #[test]
    fn geometric_shell_load_path_reports_irreversible_membrane_damage_and_plasticity() {
        let make_request = |law: MaterialLaw, e_mpa: f64, total_force_kn: f64| {
            let nodes = vec![
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
            let bending = Request {
                nodes: nodes.clone(),
                materials: vec![Material {
                    id: 1,
                    e_mpa,
                    nu: 0.3,
                }],
                orthotropic_materials: vec![],
                quads: vec![Quad {
                    id: 1,
                    node_ids: [1, 2, 3, 4],
                    material_id: 1,
                    thickness_m: 0.1,
                }],
                supports: nodes
                    .iter()
                    .map(|node| Support {
                        node_id: node.id,
                        w: true,
                        theta_x: true,
                        theta_y: true,
                        kw_kn_per_m: None,
                        ktheta_x_knm_per_rad: None,
                        ktheta_y_knm_per_rad: None,
                    })
                    .collect(),
                loads: vec![],
                edge_loads: vec![],
                pressure_kn_m2: 0.0,
                quad_pressures: vec![],
                modulus_curves: vec![],
                reinforcement: None,
                load_path: vec![0.1, 0.2, 0.5, 1.0, 0.5, 0.0],
                tolerance: 1e-8,
                max_iterations: 80,
                linear_backend: LinearBackend::Existing,
                frontal_max_front_dofs: None,
            };
            GeometricShellRequest {
                bending,
                analysis: Analysis::Combined,
                material_laws: HashMap::from([(1, law)]),
                membrane_supports: vec![
                    MembraneSupport {
                        node_id: 1,
                        u: true,
                        v: true,
                        ku_kn_per_m: None,
                        kv_kn_per_m: None,
                    },
                    MembraneSupport {
                        node_id: 4,
                        u: true,
                        v: true,
                        ku_kn_per_m: None,
                        kv_kn_per_m: None,
                    },
                    MembraneSupport {
                        node_id: 2,
                        u: false,
                        v: true,
                        ku_kn_per_m: None,
                        kv_kn_per_m: None,
                    },
                    MembraneSupport {
                        node_id: 3,
                        u: false,
                        v: true,
                        ku_kn_per_m: None,
                        kv_kn_per_m: None,
                    },
                ],
                membrane_loads: vec![
                    MembraneLoad {
                        node_id: 2,
                        fx_kn: total_force_kn * 0.5,
                        fy_kn: 0.0,
                    },
                    MembraneLoad {
                        node_id: 3,
                        fx_kn: total_force_kn * 0.5,
                        fy_kn: 0.0,
                    },
                ],
            }
        };
        let steel = solve_geometric_shell(&make_request(
            MaterialLaw::SteelBilinear {
                yield_mpa: 235.0,
                hardening_ratio: 0.02,
            },
            210_000.0,
            40_000.0,
        ))
        .unwrap();
        assert!(steel.elements[0].max_equivalent_plastic_strain > 0.0);
        assert_eq!(steel.elements[0].max_tensile_damage, 0.0);
        assert_eq!(steel.elements[0].material_points.len(), NGAUSS * NGAUSS);
        assert!(steel.elements[0].material_points.iter().all(|point| {
            point.equivalent_plastic_strain > 0.0
                && point.tensile_damage == 0.0
                && point.membrane_strain.iter().all(|value| value.is_finite())
        }));
        assert!(steel.elements[0]
            .material_points
            .iter()
            .any(|point| point.gauss_index == [0, 0]));
        assert!(steel.relative_residual < 1e-7);

        let concrete = solve_geometric_shell(&make_request(
            MaterialLaw::ConcreteCracking {
                tensile_mpa: 3.0,
                residual_ratio: 0.02,
            },
            30_000.0,
            400.0,
        ))
        .unwrap();
        assert!(concrete.elements[0].max_tensile_damage > 0.0);
        assert_eq!(concrete.elements[0].max_equivalent_plastic_strain, 0.0);
        assert_eq!(concrete.elements[0].material_points.len(), NGAUSS * NGAUSS);
        assert!(concrete.elements[0]
            .material_points
            .iter()
            .all(|point| point.tensile_damage > 0.0));
        assert!(concrete.relative_residual < 1e-7);
    }

    #[test]
    fn secant_e_uses_combined_membrane_and_fibre_strain_at_the_same_points() {
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
        let coords = [&nodes[0], &nodes[1], &nodes[2], &nodes[3]];
        let material = Material {
            id: 1,
            e_mpa: 30_000.0,
            nu: 0.0,
        };
        let quad = Quad {
            id: 1,
            node_ids: [1, 2, 3, 4],
            material_id: 1,
            thickness_m: 0.1,
        };
        let bending = element(&quad, coords, std::array::from_fn(|i| i), &material).unwrap();
        let dofs: [usize; 20] = std::array::from_fn(|i| i);
        let membrane_strain = 1e-3;
        let curvature = 0.02;
        let mut displacement = vec![0.0; 20];
        for node in 0..4 {
            let x = nodes[node].x;
            displacement[5 * node] = membrane_strain * x;
            displacement[5 * node + 2] = 0.5 * curvature * x * x;
            displacement[5 * node + 4] = curvature * x;
        }
        let response = shell_membrane_response(
            coords,
            dofs,
            &displacement,
            material.e_mpa,
            material.nu,
            quad.thickness_m,
        )
        .unwrap();
        let bending_local: [f64; 12] =
            std::array::from_fn(|i| displacement[5 * (i / 3) + 2 + i % 3]);
        let membrane_only = shell_membrane_response(
            coords,
            dofs,
            &displacement
                .iter()
                .enumerate()
                .map(|(i, value)| if i % 5 >= 2 { 0.0 } else { *value })
                .collect::<Vec<_>>(),
            material.e_mpa,
            material.nu,
            quad.thickness_m,
        )
        .unwrap()
        .gauss_strains[0][0];
        let fibre_only = max_fibre_strain(&bending, &bending_local, material.e_mpa);
        let combined = shell_max_combined_fibre_strain(
            &bending,
            coords,
            &bending_local,
            material.e_mpa,
            &response.gauss_strains,
        )
        .unwrap();
        let von_karman_bending = 0.5 * (0.5 * curvature).powi(2);
        assert!(
            (combined - (membrane_only + von_karman_bending + fibre_only)).abs() < 1e-8,
            "combined={combined}, membrane={membrane_only}, vonKarman={von_karman_bending}, fibre={fibre_only}"
        );
    }

    #[test]
    fn shallow_shell_bending_approaches_hybrid_plate_at_small_deflection() {
        let bending = cantilever_request(false);
        let reference = solve(&bending).unwrap();
        let membrane_supports = bending
            .nodes
            .iter()
            .filter(|node| node.x == 0.0)
            .map(|node| MembraneSupport {
                node_id: node.id,
                u: true,
                v: true,
                ku_kn_per_m: None,
                kv_kn_per_m: None,
            })
            .collect();
        let shell = solve_geometric_shell(&GeometricShellRequest {
            bending,
            analysis: Analysis::Geometric,
            material_laws: HashMap::new(),
            membrane_supports,
            membrane_loads: vec![],
        })
        .unwrap();
        let reference_by_id: HashMap<usize, f64> = reference
            .nodes
            .into_iter()
            .map(|node| (node.node_id, node.w_m))
            .collect();
        let difference = shell
            .nodes
            .iter()
            .map(|node| (node.w_m - reference_by_id[&node.node_id]).abs())
            .fold(0.0_f64, f64::max);
        let scale = reference_by_id
            .values()
            .map(|w| w.abs())
            .fold(0.0_f64, f64::max);
        assert!(
            difference / scale < 1e-3,
            "relative bending difference {}",
            difference / scale
        );
    }

    #[test]
    fn geometric_shell_matches_levy_large_deflection_square_plate() {
        // Independent von Karman benchmark: Levy, NACA Report 737 (1942),
        // tables 8 and 9. For nu=0.316, p*a^4/(E*h^4)=51.4 gives w_center/h=0.952
        // (six-term result). Edges are immovable in-plane and simply supported
        // out-of-plane. NASA-hosted report: https://ntrs.nasa.gov/citations/19930091816
        let side: f64 = 1.0;
        let thickness: f64 = 0.05;
        let e_mpa: f64 = 1_000.0;
        let nu: f64 = 0.316;
        let pressure_kn_m2 = 51.4 * e_mpa * 1_000.0 * thickness.powi(4) / side.powi(4);
        let solve_mesh = |divisions: usize| {
            let nodes: Vec<Node> = (0..=divisions)
                .flat_map(|j| {
                    (0..=divisions).map(move |i| Node {
                        id: j * (divisions + 1) + i + 1,
                        x: side * i as f64 / divisions as f64,
                        y: side * j as f64 / divisions as f64,
                    })
                })
                .collect();
            let quads: Vec<Quad> = (0..divisions)
                .flat_map(|j| {
                    (0..divisions).map(move |i| {
                        let lower_left = j * (divisions + 1) + i + 1;
                        Quad {
                            id: j * divisions + i + 1,
                            node_ids: [
                                lower_left,
                                lower_left + 1,
                                lower_left + divisions + 2,
                                lower_left + divisions + 1,
                            ],
                            material_id: 1,
                            thickness_m: thickness,
                        }
                    })
                })
                .collect();
            let boundary_nodes: Vec<usize> = (0..=divisions)
                .flat_map(|j| {
                    (0..=divisions).filter_map(move |i| {
                        (i == 0 || i == divisions || j == 0 || j == divisions)
                            .then_some(j * (divisions + 1) + i + 1)
                    })
                })
                .collect();
            let result = solve_geometric_shell(&GeometricShellRequest {
                bending: Request {
                    nodes,
                    materials: vec![Material { id: 1, e_mpa, nu }],
                    orthotropic_materials: vec![],
                    quads,
                    supports: boundary_nodes
                        .iter()
                        .map(|node_id| Support {
                            node_id: *node_id,
                            w: true,
                            theta_x: false,
                            theta_y: false,
                            kw_kn_per_m: None,
                            ktheta_x_knm_per_rad: None,
                            ktheta_y_knm_per_rad: None,
                        })
                        .collect(),
                    loads: vec![],
                    edge_loads: vec![],
                    pressure_kn_m2,
                    quad_pressures: vec![],
                    modulus_curves: vec![],
                    reinforcement: None,
                    load_path: vec![],
                    tolerance: 1e-8,
                    max_iterations: 80,
                    linear_backend: LinearBackend::Existing,
                    frontal_max_front_dofs: None,
                },
                analysis: Analysis::default(),
                material_laws: HashMap::new(),
                membrane_supports: boundary_nodes
                    .into_iter()
                    .map(|node_id| MembraneSupport {
                        node_id,
                        u: true,
                        v: true,
                        ku_kn_per_m: None,
                        kv_kn_per_m: None,
                    })
                    .collect(),
                membrane_loads: vec![],
            })
            .unwrap();
            let centre_id = (divisions / 2) * (divisions + 1) + divisions / 2 + 1;
            let centre = result
                .nodes
                .iter()
                .find(|node| node.node_id == centre_id)
                .unwrap();
            let vertical_reaction: f64 = result.nodes.iter().map(|node| node.reaction_fz_kn).sum();
            (
                centre.w_m / thickness,
                vertical_reaction,
                result.relative_residual,
            )
        };
        let (coarse_w_over_h, coarse_reaction, coarse_residual) = solve_mesh(4);
        let (fine_w_over_h, fine_reaction, fine_residual) = solve_mesh(8);
        let (refined_w_over_h, refined_reaction, refined_residual) = solve_mesh(16);
        println!(
            "Levy square plate w/h: 4x4={coarse_w_over_h:.6}, 8x8={fine_w_over_h:.6}, 16x16={refined_w_over_h:.6}, reference=0.952"
        );
        assert!(
            (fine_w_over_h - 0.952).abs() < 0.02,
            "8x8 mesh gives w/h={fine_w_over_h}, Levy NACA Report 737 gives 0.952"
        );
        assert!(
            (fine_w_over_h - 0.952).abs() < (coarse_w_over_h - 0.952).abs(),
            "mesh refinement should approach Levy: 4x4={coarse_w_over_h}, 8x8={fine_w_over_h}, reference=0.952"
        );
        assert!(
            (refined_w_over_h - 0.952).abs() < (fine_w_over_h - 0.952).abs(),
            "16x16 mesh should improve on 8x8: 8x8={fine_w_over_h}, 16x16={refined_w_over_h}, reference=0.952"
        );
        for (divisions, reaction, residual) in [
            (4, coarse_reaction, coarse_residual),
            (8, fine_reaction, fine_residual),
            (16, refined_reaction, refined_residual),
        ] {
            assert!(
                (reaction + pressure_kn_m2 * side.powi(2)).abs() < 1e-5,
                "{divisions}x{divisions} vertical reactions sum to {reaction}, applied load is {}",
                pressure_kn_m2 * side.powi(2)
            );
            assert!(residual < 1e-8);
        }
    }

    #[test]
    fn geometric_shell_bilinear_pressure_matches_navier_series_at_small_deflection() {
        let side: f64 = 1.0;
        let thickness: f64 = 0.05;
        let e_mpa: f64 = 1_000.0;
        let nu = 0.2;
        let maximum_pressure_kn_per_m2 = -10.0;
        let divisions = 8;
        let mesh = crate::quad2d::mesh_squares(&crate::quad2d::SquareGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: side,
            height_m: side,
            cell_size_m: side / divisions as f64,
            material_id: 1,
            thickness_m: thickness,
        })
        .unwrap();
        let nodes: Vec<Node> = mesh
            .nodes
            .into_iter()
            .map(|node| Node {
                id: node.id,
                x: node.x,
                y: node.y,
            })
            .collect();
        let node_by_id: HashMap<usize, &Node> = nodes.iter().map(|node| (node.id, node)).collect();
        let bending = Request {
            nodes: nodes.clone(),
            materials: vec![Material { id: 1, e_mpa, nu }],
            orthotropic_materials: vec![],
            quads: mesh.quads.clone(),
            supports: nodes
                .iter()
                .filter(|node| node.x == 0.0 || node.y == 0.0 || node.x == side || node.y == side)
                .map(|node| Support {
                    node_id: node.id,
                    w: true,
                    theta_x: false,
                    theta_y: false,
                    kw_kn_per_m: None,
                    ktheta_x_knm_per_rad: None,
                    ktheta_y_knm_per_rad: None,
                })
                .collect(),
            loads: vec![],
            edge_loads: vec![],
            pressure_kn_m2: 0.0,
            quad_pressures: mesh
                .quads
                .iter()
                .map(|quad| QuadPressure {
                    quad_id: quad.id,
                    nodal_pressure_kn_m2: quad
                        .node_ids
                        .map(|id| maximum_pressure_kn_per_m2 * node_by_id[&id].x / side),
                })
                .collect(),
            modulus_curves: vec![],
            reinforcement: None,
            load_path: vec![],
            tolerance: 1e-8,
            max_iterations: 40,
            linear_backend: LinearBackend::Existing,
            frontal_max_front_dofs: None,
        };
        let membrane_supports = nodes
            .iter()
            .filter(|node| node.x == 0.0 || node.y == 0.0 || node.x == side || node.y == side)
            .map(|node| MembraneSupport {
                node_id: node.id,
                u: true,
                v: true,
                ku_kn_per_m: None,
                kv_kn_per_m: None,
            })
            .collect();
        let result = solve_geometric_shell(&GeometricShellRequest {
            bending,
            analysis: Analysis::Geometric,
            material_laws: HashMap::new(),
            membrane_supports,
            membrane_loads: vec![],
        })
        .unwrap();

        // Independent Navier double-sine solution for q(x,y)=q_max*x/a.
        // Integrating this pressure field analytically gives the coefficients
        // below; the series is evaluated at x=a/4, y=b/2, away from its
        // symmetry point so a uniform-pressure shortcut cannot pass.
        let rigidity_kn_m = e_mpa * 1_000.0 * thickness.powi(3) / (12.0 * (1.0 - nu * nu));
        let mut navier_w = 0.0;
        let terms = 61;
        for m in 1..=terms {
            for n in 1..=terms {
                if n % 2 == 0 {
                    continue;
                }
                let coefficient =
                    8.0 * maximum_pressure_kn_per_m2 * if m % 2 == 0 { -1.0 } else { 1.0 }
                        / (m as f64 * n as f64 * std::f64::consts::PI.powi(2));
                let wave_x = m as f64 * std::f64::consts::PI / side;
                let wave_y = n as f64 * std::f64::consts::PI / side;
                let denominator = rigidity_kn_m * (wave_x.powi(2) + wave_y.powi(2)).powi(2);
                navier_w +=
                    coefficient * (wave_x * side * 0.25).sin() * (wave_y * side * 0.5).sin()
                        / denominator;
            }
        }
        let quarter_mid_node_id = nodes
            .iter()
            .find(|node| {
                (node.x - side * 0.25).abs() < 1e-12 && (node.y - side * 0.5).abs() < 1e-12
            })
            .unwrap()
            .id;
        let actual_w = result
            .nodes
            .iter()
            .find(|node| node.node_id == quarter_mid_node_id)
            .unwrap()
            .w_m;
        assert!(
            (actual_w - navier_w).abs() / navier_w.abs() < 0.03,
            "GNL shell w({:.2}a,{:.2}b)={actual_w} m, independent Navier={navier_w} m",
            0.25,
            0.5
        );
        let applied_force_kn = -maximum_pressure_kn_per_m2 * side * side * 0.5;
        let vertical_reaction_kn: f64 = result.nodes.iter().map(|node| node.reaction_fz_kn).sum();
        assert!((vertical_reaction_kn - applied_force_kn).abs() < 1e-7);
        assert!(result.relative_residual < 1e-8);
    }

    #[test]
    fn geometric_shell_large_deflection_tapered_pressure_matches_ritz_and_reflection() {
        let side: f64 = 1.0;
        let thickness: f64 = 0.05;
        let e_mpa: f64 = 1_000.0;
        let nu = 0.316;
        let divisions = 8;
        let maximum_pressure_kn_per_m2 = -51.4 * e_mpa * 1_000.0 * thickness.powi(4) / side.powi(4);
        let mesh = crate::quad2d::mesh_squares(&crate::quad2d::SquareGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: side,
            height_m: side,
            cell_size_m: side / divisions as f64,
            material_id: 1,
            thickness_m: thickness,
        })
        .unwrap();
        let nodes: Vec<Node> = mesh
            .nodes
            .iter()
            .map(|node| Node {
                id: node.id,
                x: node.x,
                y: node.y,
            })
            .collect();
        let node_by_id: HashMap<usize, &Node> = nodes.iter().map(|node| (node.id, node)).collect();
        let solve_taper = |reverse: bool| {
            let bending = Request {
                nodes: nodes.clone(),
                materials: vec![Material { id: 1, e_mpa, nu }],
                orthotropic_materials: vec![],
                quads: mesh.quads.clone(),
                supports: nodes
                    .iter()
                    .filter(|node| {
                        node.x == 0.0 || node.y == 0.0 || node.x == side || node.y == side
                    })
                    .map(|node| Support {
                        node_id: node.id,
                        w: true,
                        theta_x: false,
                        theta_y: false,
                        kw_kn_per_m: None,
                        ktheta_x_knm_per_rad: None,
                        ktheta_y_knm_per_rad: None,
                    })
                    .collect(),
                loads: vec![],
                edge_loads: vec![],
                pressure_kn_m2: 0.0,
                quad_pressures: mesh
                    .quads
                    .iter()
                    .map(|quad| QuadPressure {
                        quad_id: quad.id,
                        nodal_pressure_kn_m2: quad.node_ids.map(|id| {
                            let ratio = node_by_id[&id].x / side;
                            maximum_pressure_kn_per_m2 * if reverse { 1.0 - ratio } else { ratio }
                        }),
                    })
                    .collect(),
                modulus_curves: vec![],
                reinforcement: None,
                load_path: vec![0.2, 0.4, 0.6, 0.8, 1.0],
                tolerance: 1e-8,
                max_iterations: 80,
                linear_backend: LinearBackend::Existing,
                frontal_max_front_dofs: None,
            };
            let membrane_supports = nodes
                .iter()
                .filter(|node| node.x == 0.0 || node.y == 0.0 || node.x == side || node.y == side)
                .map(|node| MembraneSupport {
                    node_id: node.id,
                    u: true,
                    v: true,
                    ku_kn_per_m: None,
                    kv_kn_per_m: None,
                })
                .collect();
            solve_geometric_shell(&GeometricShellRequest {
                bending,
                analysis: Analysis::Geometric,
                material_laws: HashMap::new(),
                membrane_supports,
                membrane_loads: vec![],
            })
            .unwrap()
        };
        let forward = solve_taper(false);
        let reverse = solve_taper(true);
        let forward_by_id: HashMap<usize, &GeometricShellNodeResult> = forward
            .nodes
            .iter()
            .map(|node| (node.node_id, node))
            .collect();
        let quarter_mid_id = 4 * (divisions + 1) + divisions / 4 + 1;
        let quarter_mid_w_over_h = forward_by_id[&quarter_mid_id].w_m.abs() / thickness;
        // Independent 5x5 Fourier-Ritz solution of the Föppl-von Kármán
        // energy equations: 0.4274852 h at (a/4,b/2). The 4x4 and 3x3
        // truncations give 0.4274090 h and 0.4271455 h, respectively.
        assert!(
            (quarter_mid_w_over_h - 0.427_485_2).abs() / 0.427_485_2 < 0.01,
            "8x8 Q4 GNL w/h={quarter_mid_w_over_h}, independent 5x5 Ritz=0.4274852"
        );
        let centre_id = 4 * (divisions + 1) + divisions / 2 + 1;
        let centre_w_over_h = forward_by_id[&centre_id].w_m.abs() / thickness;
        assert!(
            (centre_w_over_h - 0.669_985_7).abs() / 0.669_985_7 < 0.01,
            "8x8 Q4 centre w/h={centre_w_over_h}, independent 5x5 Ritz=0.6699857"
        );
        let reverse_by_id: HashMap<usize, &GeometricShellNodeResult> = reverse
            .nodes
            .iter()
            .map(|node| (node.node_id, node))
            .collect();
        let displacement_scale = forward
            .nodes
            .iter()
            .map(|node| node.w_m.abs())
            .fold(0.0_f64, f64::max);
        assert!(
            displacement_scale / thickness > 0.2,
            "test must exercise large deflection"
        );
        let mut max_reflection_error = 0.0_f64;
        for j in 0..=divisions {
            for i in 0..=divisions {
                let node_id = j * (divisions + 1) + i + 1;
                let mirror_id = j * (divisions + 1) + divisions - i + 1;
                let a = forward_by_id[&node_id];
                let b = reverse_by_id[&mirror_id];
                for (actual, expected) in [
                    (a.u_m, -b.u_m),
                    (a.v_m, b.v_m),
                    (a.w_m, b.w_m),
                    (a.theta_x_rad, b.theta_x_rad),
                    (a.theta_y_rad, -b.theta_y_rad),
                ] {
                    max_reflection_error = max_reflection_error.max((actual - expected).abs());
                }
            }
        }
        assert!(
            max_reflection_error / displacement_scale < 2e-5,
            "mirrored tapered-pressure GNL responses differ by {} of peak deflection",
            max_reflection_error / displacement_scale
        );
        let expected_vertical_reaction_kn = -maximum_pressure_kn_per_m2 * side * side * 0.5;
        for result in [&forward, &reverse] {
            let reaction: f64 = result.nodes.iter().map(|node| node.reaction_fz_kn).sum();
            assert!((reaction - expected_vertical_reaction_kn).abs() < 1e-5);
            assert!(result.relative_residual < 1e-7);
        }
    }

    #[test]
    fn geometric_shell_integrates_edge_line_load_and_balances_reactions() {
        let divisions_x = 8;
        let divisions_y = 4;
        let length = 2.0;
        let width = 1.0;
        let thickness = 0.2;
        let mesh = crate::quad2d::mesh_squares(&crate::quad2d::SquareGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: length,
            height_m: width,
            cell_size_m: 0.25,
            material_id: 1,
            thickness_m: thickness,
        })
        .unwrap();
        let nodes: Vec<Node> = mesh
            .nodes
            .iter()
            .map(|node| Node {
                id: node.id,
                x: node.x,
                y: node.y,
            })
            .collect();
        let node_by_id: HashMap<usize, &Node> = nodes.iter().map(|node| (node.id, node)).collect();
        let solve = |reverse: bool| {
            let mut bending = Request {
                nodes: nodes.clone(),
                materials: vec![Material {
                    id: 1,
                    e_mpa: 30_000.0,
                    nu: 0.0,
                }],
                orthotropic_materials: vec![],
                quads: mesh.quads.clone(),
                supports: nodes
                    .iter()
                    .filter(|node| node.x == 0.0)
                    .map(|node| Support {
                        node_id: node.id,
                        w: true,
                        theta_x: true,
                        theta_y: true,
                        kw_kn_per_m: None,
                        ktheta_x_knm_per_rad: None,
                        ktheta_y_knm_per_rad: None,
                    })
                    .collect(),
                loads: vec![],
                edge_loads: vec![],
                pressure_kn_m2: 0.0,
                quad_pressures: vec![],
                modulus_curves: vec![],
                reinforcement: None,
                load_path: (1..=10).map(|step| step as f64 / 10.0).collect(),
                tolerance: 1e-8,
                max_iterations: 80,
                linear_backend: LinearBackend::Existing,
                frontal_max_front_dofs: None,
            };
            bending.edge_loads = mesh
                .quads
                .iter()
                .filter_map(|quad| {
                    let start = node_by_id[&quad.node_ids[1]];
                    let end = node_by_id[&quad.node_ids[2]];
                    if (start.x - length).abs() > 1e-12 || (end.x - length).abs() > 1e-12 {
                        return None;
                    }
                    let q = |y: f64| {
                        if reverse {
                            -1_600.0 + 1_200.0 * y / width
                        } else {
                            -400.0 - 1_200.0 * y / width
                        }
                    };
                    Some(EdgeLoad {
                        quad_id: quad.id,
                        edge_index: 1,
                        start_kn_per_m: q(start.y),
                        end_kn_per_m: q(end.y),
                    })
                })
                .collect();
            let membrane_supports = nodes
                .iter()
                .filter(|node| node.x == 0.0)
                .map(|node| MembraneSupport {
                    node_id: node.id,
                    u: true,
                    v: true,
                    ku_kn_per_m: None,
                    kv_kn_per_m: None,
                })
                .collect();
            solve_geometric_shell(&GeometricShellRequest {
                bending,
                analysis: Analysis::Geometric,
                material_laws: HashMap::new(),
                membrane_supports,
                membrane_loads: vec![],
            })
            .unwrap()
        };
        let forward = solve(false);
        let reverse = solve(true);
        // Independent polynomial Ritz solution converges to w/t=2/3 at
        // the loaded edge centre; the Rust Q4 mesh should approach it.
        let forward_by_id: HashMap<usize, &GeometricShellNodeResult> = forward
            .nodes
            .iter()
            .map(|node| (node.node_id, node))
            .collect();
        let reverse_by_id: HashMap<usize, &GeometricShellNodeResult> = reverse
            .nodes
            .iter()
            .map(|node| (node.node_id, node))
            .collect();
        let tip_mid_id = divisions_y / 2 * (divisions_x + 1) + divisions_x + 1;
        let tip_mid_w_over_h = forward_by_id[&tip_mid_id].w_m.abs() / thickness;
        assert!(
            (tip_mid_w_over_h - 2.0 / 3.0).abs() / (2.0 / 3.0) < 0.05,
            "Q4 tip-centre w/t={tip_mid_w_over_h}, independent 4x4 Ritz=0.666667"
        );
        let displacement_scale = forward
            .nodes
            .iter()
            .map(|node| node.w_m.abs())
            .fold(0.0_f64, f64::max);
        assert!(displacement_scale / thickness > 0.2);
        let mut max_reflection_error = 0.0_f64;
        for row in 0..=divisions_y {
            for column in 0..=divisions_x {
                let node_id = row * (divisions_x + 1) + column + 1;
                let mirror_id = (divisions_y - row) * (divisions_x + 1) + column + 1;
                max_reflection_error = max_reflection_error
                    .max((forward_by_id[&node_id].w_m - reverse_by_id[&mirror_id].w_m).abs());
            }
        }
        assert!(max_reflection_error / displacement_scale < 2e-4);
        for result in [&forward, &reverse] {
            let vertical_reaction: f64 = result.nodes.iter().map(|node| node.reaction_fz_kn).sum();
            assert!((vertical_reaction - 1_000.0).abs() < 1e-5);
            assert!(result.relative_residual < 1e-7);
        }
    }

    fn assert_frontal_parity(actual: f64, reference: f64, label: &str) {
        let tolerance = 2e-8 * reference.abs().max(1.0);
        assert!(
            (actual - reference).abs() <= tolerance,
            "{label}: frontal {actual:.12e}, existing {reference:.12e}"
        );
    }

    #[test]
    fn frontal_hybrid_matches_pressure_edge_load_spring_reactions_and_moments() {
        let mut request = cantilever_request(false);
        request.pressure_kn_m2 = -0.7;
        request.quad_pressures = vec![QuadPressure {
            quad_id: request.quads[0].id,
            nodal_pressure_kn_m2: [0.0, -0.3, -0.8, 0.2],
        }];
        request.edge_loads = vec![EdgeLoad {
            quad_id: request.quads[1].id,
            edge_index: 1,
            start_kn_per_m: -1.2,
            end_kn_per_m: -0.4,
        }];
        request.loads = vec![Load {
            node_id: request.quads[1].node_ids[2],
            fz: -0.2,
            mx: 0.04,
            my: -0.03,
        }];
        let tip = request.quads[1].node_ids[2];
        request.supports.push(Support {
            node_id: tip,
            w: false,
            theta_x: false,
            theta_y: false,
            kw_kn_per_m: Some(100.0),
            ktheta_x_knm_per_rad: Some(20.0),
            ktheta_y_knm_per_rad: None,
        });
        request.load_path = vec![0.4, 1.0];
        let reference = solve(&request).unwrap();
        request.linear_backend = LinearBackend::FrontalWave;
        let frontal = solve(&request).unwrap();
        assert_eq!(frontal.linear_backend_used, LinearBackend::FrontalWave);
        assert!(frontal.frontal_maximum_front_dofs.unwrap() > 0);
        assert!(frontal.relative_residual < 1e-8);
        for (actual, expected) in frontal.nodes.iter().zip(&reference.nodes) {
            assert_eq!(actual.node_id, expected.node_id);
            for (a, b, label) in [
                (actual.w_m, expected.w_m, "w"),
                (actual.theta_x_rad, expected.theta_x_rad, "theta x"),
                (actual.theta_y_rad, expected.theta_y_rad, "theta y"),
                (
                    actual.reaction_fz_kn,
                    expected.reaction_fz_kn,
                    "reaction fz",
                ),
                (
                    actual.reaction_mx_knm,
                    expected.reaction_mx_knm,
                    "reaction mx",
                ),
                (
                    actual.reaction_my_knm,
                    expected.reaction_my_knm,
                    "reaction my",
                ),
            ] {
                assert_frontal_parity(a, b, label);
            }
        }
        for (actual, expected) in frontal.elements.iter().zip(&reference.elements) {
            assert_eq!(actual.quad_id, expected.quad_id);
            for (a, b) in actual
                .moment_knm_per_m
                .iter()
                .zip(&expected.moment_knm_per_m)
            {
                assert_frontal_parity(*a, *b, "moment");
            }
            for (a, b) in actual.shear_kn_per_m.iter().zip(&expected.shear_kn_per_m) {
                assert_frontal_parity(*a, *b, "shear");
            }
        }
        let reaction_sum: f64 = frontal.nodes.iter().map(|node| node.reaction_fz_kn).sum();
        assert_frontal_parity(
            reaction_sum,
            reference.nodes.iter().map(|node| node.reaction_fz_kn).sum(),
            "vertical reaction total",
        );
    }

    #[test]
    fn frontal_hybrid_rejects_front_limit_mechanism_and_nonlinear_requests() {
        let mut request = cantilever_request(false);
        request.linear_backend = LinearBackend::FrontalWave;
        request.frontal_max_front_dofs = Some(1);
        let error = solve(&request).unwrap_err();
        assert!(error.contains("wavefront exceeded maximum"), "{error}");

        request.frontal_max_front_dofs = None;
        request.supports.clear();
        let error = solve(&request).unwrap_err();
        assert!(error.contains("singular frontal pivot"), "{error}");

        request = cantilever_request(true);
        request.linear_backend = LinearBackend::FrontalWave;
        let error = solve(&request).unwrap_err();
        assert!(error.contains("without modulus curves"), "{error}");

        request.modulus_curves.clear();
        let shell = GeometricShellRequest {
            bending: request,
            analysis: Analysis::Geometric,
            material_laws: HashMap::new(),
            membrane_supports: vec![],
            membrane_loads: vec![],
        };
        let error = solve_geometric_shell(&shell).unwrap_err();
        assert!(
            error.contains("unavailable for shell analysis, including GNL/FNL"),
            "{error}"
        );
    }

    #[test]
    fn frontal_hybrid_is_opt_in_and_matches_rotated_orthotropic_bending() {
        let mut request = cantilever_request(false);
        request.orthotropic_materials = vec![OrthotropicMaterial {
            material_id: 1,
            e1_mpa: 30_000.0,
            e2_mpa: 18_000.0,
            g12_mpa: 7_000.0,
            nu12: 0.2,
            angle_rad: 0.3,
        }];
        let mut value = serde_json::to_value(&request).unwrap();
        value.as_object_mut().unwrap().remove("linearBackend");
        value.as_object_mut().unwrap().remove("frontalMaxFrontDofs");
        let deserialized: Request = serde_json::from_value(value).unwrap();
        assert_eq!(deserialized.linear_backend, LinearBackend::Existing);
        let reference = solve(&deserialized).unwrap();
        assert_eq!(reference.linear_backend_used, LinearBackend::Existing);
        assert_eq!(reference.frontal_maximum_front_dofs, None);
        request.linear_backend = LinearBackend::FrontalWave;
        let frontal = solve(&request).unwrap();
        for (actual, expected) in frontal.nodes.iter().zip(&reference.nodes) {
            assert_frontal_parity(actual.w_m, expected.w_m, "orthotropic deflection");
            assert_frontal_parity(
                actual.reaction_fz_kn,
                expected.reaction_fz_kn,
                "orthotropic reaction",
            );
        }
        for (actual, expected) in frontal.elements.iter().zip(&reference.elements) {
            for (a, b) in actual
                .moment_knm_per_m
                .iter()
                .zip(&expected.moment_knm_per_m)
            {
                assert_frontal_parity(*a, *b, "orthotropic moment");
            }
        }
    }
}
