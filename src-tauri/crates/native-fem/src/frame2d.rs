//! Linear plane-frame elements in m, kN and MPa. The plane is X/Y;
//! the 2D app maps its vertical Z coordinate and R_y rotation here explicitly.

use crate::math::{constrained_solve, Matrix};
use crate::{positive, Analysis};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

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
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Section {
    pub id: usize,
    pub area_m2: f64,
    pub inertia_m4: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Member {
    pub id: usize,
    pub start_node_id: usize,
    pub end_node_id: usize,
    pub material_id: usize,
    pub section_id: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Support {
    pub node_id: usize,
    pub ux: bool,
    pub uy: bool,
    pub rz: bool,
    #[serde(default)]
    pub kx_kn_per_m: Option<f64>,
    #[serde(default)]
    pub ky_kn_per_m: Option<f64>,
    #[serde(default)]
    pub krz_knm_per_rad: Option<f64>,
    #[serde(default)]
    pub ux_prescribed_m: Option<f64>,
    #[serde(default)]
    pub uy_prescribed_m: Option<f64>,
    #[serde(default)]
    pub rz_prescribed_rad: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodalLoad {
    pub node_id: usize,
    pub fx: f64,
    pub fy: f64,
    pub mz: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberLoad {
    pub member_id: usize,
    pub qx_start_kn_per_m: f64,
    pub qx_end_kn_per_m: f64,
    pub qy_start_kn_per_m: f64,
    pub qy_end_kn_per_m: f64,
    #[serde(default)]
    pub start_position_m: Option<f64>,
    #[serde(default)]
    pub end_position_m: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberPointLoad {
    pub member_id: usize,
    pub px_kn: f64,
    pub py_kn: f64,
    pub position_m: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    #[serde(default)]
    pub analysis: Analysis,
    pub nodes: Vec<Node>,
    pub materials: Vec<Material>,
    pub sections: Vec<Section>,
    pub members: Vec<Member>,
    #[serde(default)]
    pub supports: Vec<Support>,
    #[serde(default)]
    pub nodal_loads: Vec<NodalLoad>,
    #[serde(default)]
    pub member_loads: Vec<MemberLoad>,
    #[serde(default)]
    pub member_point_loads: Vec<MemberPointLoad>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeResult {
    pub node_id: usize,
    pub displacement: [f64; 3],
    pub reaction: [f64; 3],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberResult {
    pub member_id: usize,
    /// Local nodal forces [N1, V1, M1, N2, V2, M2].
    pub local_end_forces: [f64; 6],
    pub stations_m: Vec<f64>,
    pub normal_force_kn: Vec<f64>,
    pub shear_force_kn: Vec<f64>,
    pub bending_moment_knm: Vec<f64>,
    pub deflection_m: Vec<f64>,
    pub axial_disp_m: Vec<f64>,
    pub rotation_rad: Vec<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Result2D {
    pub nodes: Vec<NodeResult>,
    pub members: Vec<MemberResult>,
    pub equilibrium_residual: f64,
}

#[derive(Clone)]
struct Element {
    dofs: [usize; 6],
    length: f64,
    transform: [[f64; 6]; 6],
    local_stiffness: [[f64; 6]; 6],
    local_load: [f64; 6],
    ea_kn: f64,
    ei_knm2: f64,
}

fn shape(length: f64, position: f64) -> ([f64; 6], [f64; 6]) {
    let t = position / length;
    let axial = [1.0 - t, 0.0, 0.0, t, 0.0, 0.0];
    let transverse = [
        0.0,
        1.0 - 3.0 * t * t + 2.0 * t * t * t,
        length * (t - 2.0 * t * t + t * t * t),
        0.0,
        3.0 * t * t - 2.0 * t * t * t,
        length * (-t * t + t * t * t),
    ];
    (axial, transverse)
}

fn add_member_load(local: &mut [f64; 6], load: &MemberLoad, length: f64) -> Result<(), String> {
    let a = load.start_position_m.unwrap_or(0.0);
    let b = load.end_position_m.unwrap_or(length);
    if ![
        a,
        b,
        load.qx_start_kn_per_m,
        load.qx_end_kn_per_m,
        load.qy_start_kn_per_m,
        load.qy_end_kn_per_m,
    ]
    .iter()
    .all(|v| v.is_finite())
        || a < 0.0
        || b > length + 1e-10
        || b <= a
    {
        return Err(format!(
            "invalid distributed load on member {}",
            load.member_id
        ));
    }
    // Three-point Gauss exactly integrates a cubic Hermite shape times a
    // linearly varying pressure over any subspan.
    let abscissas = [-(3.0_f64 / 5.0).sqrt(), 0.0, (3.0_f64 / 5.0).sqrt()];
    let weights = [5.0 / 9.0, 8.0 / 9.0, 5.0 / 9.0];
    for (&xi, &weight) in abscissas.iter().zip(&weights) {
        let position = (a + b) / 2.0 + xi * (b - a) / 2.0;
        let fraction = (position - a) / (b - a);
        let px = load.qx_start_kn_per_m * (1.0 - fraction) + load.qx_end_kn_per_m * fraction;
        let py = load.qy_start_kn_per_m * (1.0 - fraction) + load.qy_end_kn_per_m * fraction;
        let (axial, transverse) = shape(length, position);
        for i in 0..6 {
            local[i] += (axial[i] * px + transverse[i] * py) * weight * (b - a) / 2.0;
        }
    }
    Ok(())
}

fn integrated_load(load: &MemberLoad, length: f64, x: f64, axial: bool, power: u32) -> f64 {
    let a = load.start_position_m.unwrap_or(0.0);
    let b = load.end_position_m.unwrap_or(length).min(x);
    if b <= a {
        return 0.0;
    }
    let original_end = load.end_position_m.unwrap_or(length);
    let (start, end) = if axial {
        (load.qx_start_kn_per_m, load.qx_end_kn_per_m)
    } else {
        (load.qy_start_kn_per_m, load.qy_end_kn_per_m)
    };
    let abscissas = [-(3.0_f64 / 5.0).sqrt(), 0.0, (3.0_f64 / 5.0).sqrt()];
    let weights = [5.0 / 9.0, 8.0 / 9.0, 5.0 / 9.0];
    let factorial = match power {
        0 | 1 => 1.0,
        2 => 2.0,
        3 => 6.0,
        _ => unreachable!(),
    };
    abscissas
        .iter()
        .zip(&weights)
        .map(|(&xi, &weight)| {
            let position = (a + b) / 2.0 + xi * (b - a) / 2.0;
            let fraction = (position - a) / (original_end - a);
            let q = start * (1.0 - fraction) + end * fraction;
            q * (x - position).powi(power as i32) / factorial * weight * (b - a) / 2.0
        })
        .sum()
}

pub fn solve(request: &Request) -> Result<Result2D, String> {
    if request.analysis != Analysis::Linear {
        return Err("2D frame currently supports linear analysis only".into());
    }
    if request.nodes.len() < 2 || request.members.is_empty() {
        return Err("2D frame requires nodes and members".into());
    }
    let mut node_index = HashMap::new();
    for (index, node) in request.nodes.iter().enumerate() {
        if node.id == 0
            || !node.x.is_finite()
            || !node.y.is_finite()
            || node_index.insert(node.id, index).is_some()
        {
            return Err("invalid or duplicate 2D frame node".into());
        }
    }
    let mut materials = HashMap::new();
    for material in &request.materials {
        positive(material.e_mpa, "E")?;
        if material.id == 0 || materials.insert(material.id, material).is_some() {
            return Err("invalid or duplicate 2D frame material".into());
        }
    }
    let mut sections = HashMap::new();
    for section in &request.sections {
        positive(section.area_m2, "area")?;
        positive(section.inertia_m4, "inertia")?;
        if section.id == 0 || sections.insert(section.id, section).is_some() {
            return Err("invalid or duplicate 2D frame section".into());
        }
    }
    let mut k = Matrix::zeros(3 * request.nodes.len())?;
    let mut f = vec![0.0; k.n];
    let mut elements = HashMap::new();
    let mut member_ids = HashSet::new();
    for member in &request.members {
        if member.id == 0 || !member_ids.insert(member.id) {
            return Err("invalid or duplicate 2D frame member".into());
        }
        let start = *node_index
            .get(&member.start_node_id)
            .ok_or("unknown start node")?;
        let end = *node_index
            .get(&member.end_node_id)
            .ok_or("unknown end node")?;
        let material = materials
            .get(&member.material_id)
            .ok_or("unknown member material")?;
        let section = sections
            .get(&member.section_id)
            .ok_or("unknown member section")?;
        let dx = request.nodes[end].x - request.nodes[start].x;
        let dy = request.nodes[end].y - request.nodes[start].y;
        let length = dx.hypot(dy);
        positive(length, "member length")?;
        let c = dx / length;
        let s = dy / length;
        let mut transform = [[0.0; 6]; 6];
        for offset in [0, 3] {
            transform[offset][offset] = c;
            transform[offset][offset + 1] = s;
            transform[offset + 1][offset] = -s;
            transform[offset + 1][offset + 1] = c;
            transform[offset + 2][offset + 2] = 1.0;
        }
        let ea_l = material.e_mpa * 1000.0 * section.area_m2 / length;
        let ei_l3 = material.e_mpa * 1000.0 * section.inertia_m4 / length.powi(3);
        let mut local_stiffness = [[0.0; 6]; 6];
        local_stiffness[0][0] = ea_l;
        local_stiffness[0][3] = -ea_l;
        local_stiffness[3][0] = -ea_l;
        local_stiffness[3][3] = ea_l;
        let bending = [
            [12.0, 6.0 * length, -12.0, 6.0 * length],
            [
                6.0 * length,
                4.0 * length * length,
                -6.0 * length,
                2.0 * length * length,
            ],
            [-12.0, -6.0 * length, 12.0, -6.0 * length],
            [
                6.0 * length,
                2.0 * length * length,
                -6.0 * length,
                4.0 * length * length,
            ],
        ];
        for (i, &row) in [1, 2, 4, 5].iter().enumerate() {
            for (j, &column) in [1, 2, 4, 5].iter().enumerate() {
                local_stiffness[row][column] = bending[i][j] * ei_l3;
            }
        }
        let dofs = [
            3 * start,
            3 * start + 1,
            3 * start + 2,
            3 * end,
            3 * end + 1,
            3 * end + 2,
        ];
        let element = Element {
            dofs,
            length,
            transform,
            local_stiffness,
            local_load: [0.0; 6],
            ea_kn: material.e_mpa * 1000.0 * section.area_m2,
            ei_knm2: material.e_mpa * 1000.0 * section.inertia_m4,
        };
        for i in 0..6 {
            for j in 0..6 {
                let mut value = 0.0;
                for a in 0..6 {
                    for b in 0..6 {
                        value += transform[a][i] * local_stiffness[a][b] * transform[b][j];
                    }
                }
                k.add(dofs[i], dofs[j], value);
            }
        }
        elements.insert(member.id, element);
    }
    for load in &request.nodal_loads {
        let index = *node_index.get(&load.node_id).ok_or("unknown loaded node")?;
        if ![load.fx, load.fy, load.mz]
            .iter()
            .all(|value| value.is_finite())
        {
            return Err("non-finite 2D nodal load".into());
        }
        for (axis, value) in [load.fx, load.fy, load.mz].iter().enumerate() {
            f[3 * index + axis] += value;
        }
    }
    for load in &request.member_loads {
        let element = elements
            .get_mut(&load.member_id)
            .ok_or("unknown loaded member")?;
        add_member_load(&mut element.local_load, load, element.length)?;
    }
    for load in &request.member_point_loads {
        let element = elements
            .get_mut(&load.member_id)
            .ok_or("unknown point-loaded member")?;
        if ![load.position_m, load.px_kn, load.py_kn]
            .iter()
            .all(|v| v.is_finite())
            || load.position_m < 0.0
            || load.position_m > element.length
        {
            return Err("invalid 2D member point load".into());
        }
        let (axial, transverse) = shape(element.length, load.position_m);
        for i in 0..6 {
            element.local_load[i] += axial[i] * load.px_kn + transverse[i] * load.py_kn;
        }
    }
    for element in elements.values() {
        for i in 0..6 {
            for j in 0..6 {
                f[element.dofs[i]] += element.transform[j][i] * element.local_load[j];
            }
        }
    }
    let mut prescribed = vec![None; k.n];
    let mut spring_stiffness = vec![0.0; k.n];
    let mut supported = HashSet::new();
    for support in &request.supports {
        let node = *node_index
            .get(&support.node_id)
            .ok_or("unknown support node")?;
        if !supported.insert(support.node_id) {
            return Err("duplicate 2D frame support".into());
        }
        let fixed = [support.ux, support.uy, support.rz];
        let values = [
            support.ux_prescribed_m,
            support.uy_prescribed_m,
            support.rz_prescribed_rad,
        ];
        let springs = [
            support.kx_kn_per_m,
            support.ky_kn_per_m,
            support.krz_knm_per_rad,
        ];
        for axis in 0..3 {
            if let Some(value) = values[axis] {
                if !fixed[axis] || !value.is_finite() {
                    return Err("invalid 2D prescribed displacement".into());
                }
            }
            if let Some(stiffness) = springs[axis] {
                positive(stiffness, "spring stiffness")?;
                if fixed[axis] {
                    return Err("2D support cannot fix and spring the same DOF".into());
                }
                k.add(3 * node + axis, 3 * node + axis, stiffness);
                spring_stiffness[3 * node + axis] = stiffness;
            }
            if fixed[axis] {
                prescribed[3 * node + axis] = Some(values[axis].unwrap_or(0.0));
            }
        }
    }
    let (u, reactions) = constrained_solve(&k, &f, &prescribed)?;
    let max_load = f
        .iter()
        .fold(1.0_f64, |maximum, &value| maximum.max(value.abs()));
    let equilibrium_residual = reactions
        .iter()
        .enumerate()
        .filter(|(dof, _)| prescribed[*dof].is_none())
        .fold(0.0_f64, |maximum, (_, value)| maximum.max(value.abs()))
        / max_load;
    let nodes = request
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| NodeResult {
            node_id: node.id,
            displacement: [u[3 * index], u[3 * index + 1], u[3 * index + 2]],
            reaction: [
                reactions[3 * index] - spring_stiffness[3 * index] * u[3 * index],
                reactions[3 * index + 1] - spring_stiffness[3 * index + 1] * u[3 * index + 1],
                reactions[3 * index + 2] - spring_stiffness[3 * index + 2] * u[3 * index + 2],
            ],
        })
        .collect();
    let members = request
        .members
        .iter()
        .map(|member| {
            let element = &elements[&member.id];
            let mut local_displacement = [0.0; 6];
            for (i, value) in local_displacement.iter_mut().enumerate() {
                for j in 0..6 {
                    *value += element.transform[i][j] * u[element.dofs[j]];
                }
            }
            let mut local_end_forces = [0.0; 6];
            for i in 0..6 {
                local_end_forces[i] = (0..6)
                    .map(|j| element.local_stiffness[i][j] * local_displacement[j])
                    .sum::<f64>()
                    - element.local_load[i];
            }
            let line_loads: Vec<&MemberLoad> = request
                .member_loads
                .iter()
                .filter(|load| load.member_id == member.id)
                .collect();
            let point_loads: Vec<&MemberPointLoad> = request
                .member_point_loads
                .iter()
                .filter(|load| load.member_id == member.id)
                .collect();
            let mut samples: Vec<(f64, bool)> = (0..=20)
                .map(|index| (element.length * index as f64 / 20.0, true))
                .collect();
            for point in &point_loads {
                samples.retain(|(x, _)| (x - point.position_m).abs() > 1e-10);
                samples.push((point.position_m, false));
                samples.push((point.position_m, true));
            }
            samples.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
            let mut stations_m = Vec::with_capacity(samples.len());
            let mut normal_force_kn = Vec::with_capacity(samples.len());
            let mut shear_force_kn = Vec::with_capacity(samples.len());
            let mut bending_moment_knm = Vec::with_capacity(samples.len());
            let mut deflection_m = Vec::with_capacity(samples.len());
            let mut axial_disp_m = Vec::with_capacity(samples.len());
            let mut rotation_rad = Vec::with_capacity(samples.len());
            for (x, right_side) in samples {
                let integral = |axial, power| {
                    line_loads
                        .iter()
                        .map(|load| integrated_load(load, element.length, x, axial, power))
                        .sum::<f64>()
                };
                let point = |axial, power| {
                    point_loads
                        .iter()
                        .filter(|load| {
                            load.position_m < x - 1e-10
                                || (right_side && (load.position_m - x).abs() <= 1e-10)
                        })
                        .map(|load| {
                            let force = if axial { load.px_kn } else { load.py_kn };
                            let distance = (x - load.position_m).max(0.0);
                            let factorial = match power {
                                0 | 1 => 1.0,
                                2 => 2.0,
                                3 => 6.0,
                                _ => unreachable!(),
                            };
                            force * distance.powi(power as i32) / factorial
                        })
                        .sum::<f64>()
                };
                stations_m.push(x);
                normal_force_kn.push(-local_end_forces[0] - integral(true, 0) - point(true, 0));
                shear_force_kn.push(local_end_forces[1] + integral(false, 0) + point(false, 0));
                bending_moment_knm.push(
                    -local_end_forces[2]
                        + local_end_forces[1] * x
                        + integral(false, 1)
                        + point(false, 1),
                );
                axial_disp_m.push(
                    local_displacement[0]
                        + (-local_end_forces[0] * x - integral(true, 1) - point(true, 1))
                            / element.ea_kn,
                );
                rotation_rad.push(
                    local_displacement[2]
                        + (-local_end_forces[2] * x
                            + local_end_forces[1] * x * x / 2.0
                            + integral(false, 2)
                            + point(false, 2))
                            / element.ei_knm2,
                );
                deflection_m.push(
                    local_displacement[1]
                        + local_displacement[2] * x
                        + (-local_end_forces[2] * x * x / 2.0
                            + local_end_forces[1] * x.powi(3) / 6.0
                            + integral(false, 3)
                            + point(false, 3))
                            / element.ei_knm2,
                );
            }
            MemberResult {
                member_id: member.id,
                local_end_forces,
                stations_m,
                normal_force_kn,
                shear_force_kn,
                bending_moment_knm,
                deflection_m,
                axial_disp_m,
                rotation_rad,
            }
        })
        .collect();
    Ok(Result2D {
        nodes,
        members,
        equilibrium_residual,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cantilever() -> Request {
        Request {
            analysis: Analysis::Linear,
            nodes: vec![
                Node {
                    id: 1,
                    x: 0.0,
                    y: 0.0,
                },
                Node {
                    id: 2,
                    x: 3.0,
                    y: 0.0,
                },
            ],
            materials: vec![Material {
                id: 1,
                e_mpa: 210_000.0,
            }],
            sections: vec![Section {
                id: 1,
                area_m2: 0.01,
                inertia_m4: 8e-6,
            }],
            members: vec![Member {
                id: 1,
                start_node_id: 1,
                end_node_id: 2,
                material_id: 1,
                section_id: 1,
            }],
            supports: vec![Support {
                node_id: 1,
                ux: true,
                uy: true,
                rz: true,
                kx_kn_per_m: None,
                ky_kn_per_m: None,
                krz_knm_per_rad: None,
                ux_prescribed_m: None,
                uy_prescribed_m: None,
                rz_prescribed_rad: None,
            }],
            nodal_loads: vec![],
            member_loads: vec![],
            member_point_loads: vec![],
        }
    }

    #[test]
    fn tip_force_matches_euler_bernoulli_closed_form() {
        let mut input = cantilever();
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 0.0,
            fy: -10.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let ei = 210_000.0 * 1000.0 * 8e-6;
        assert!(
            (result.nodes[1].displacement[1] + 10.0 * 3.0_f64.powi(3) / (3.0 * ei)).abs() < 1e-12
        );
        assert!(
            (result.nodes[1].displacement[2] + 10.0 * 3.0_f64.powi(2) / (2.0 * ei)).abs() < 1e-12
        );
        assert!((result.nodes[0].reaction[1] - 10.0).abs() < 1e-10);
        assert!((result.nodes[0].reaction[2] - 30.0).abs() < 1e-10);
        assert!(
            (result.members[0].deflection_m[20] - result.nodes[1].displacement[1]).abs() < 1e-12
        );
        assert!(
            (result.members[0].rotation_rad[20] - result.nodes[1].displacement[2]).abs() < 1e-12
        );
        assert!(result.equilibrium_residual < 1e-10);
    }

    #[test]
    fn documented_cantilever_example_matches_closed_form() {
        let input: Request =
            serde_json::from_str(include_str!("../examples/frame2d-cantilever.json")).unwrap();
        let result = solve(&input).unwrap();
        let ei = 210_000.0 * 1000.0 * 8e-6;
        assert!((result.nodes[1].displacement[1] + 10.0 * 27.0 / (3.0 * ei)).abs() < 1e-12);
        assert!((result.nodes[1].displacement[2] + 10.0 * 9.0 / (2.0 * ei)).abs() < 1e-12);
        assert!((result.nodes[0].reaction[1] - 10.0).abs() < 1e-10);
        assert!((result.nodes[0].reaction[2] - 30.0).abs() < 1e-10);
    }

    #[test]
    fn uniform_load_and_midspan_point_force_match_resultants() {
        let mut input = cantilever();
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -5.0,
            qy_end_kn_per_m: -5.0,
            start_position_m: None,
            end_position_m: None,
        });
        input.member_point_loads.push(MemberPointLoad {
            member_id: 1,
            px_kn: 0.0,
            py_kn: -4.0,
            position_m: 1.5,
        });
        let result = solve(&input).unwrap();
        assert!((result.nodes[0].reaction[1] - 19.0).abs() < 1e-10);
        assert!((result.nodes[0].reaction[2] - 28.5).abs() < 1e-10);
        assert!((result.members[0].local_end_forces[1] - 19.0).abs() < 1e-10);
        let stations = &result.members[0].stations_m;
        let jump = stations
            .windows(2)
            .position(|pair| (pair[0] - 1.5).abs() < 1e-12 && (pair[1] - 1.5).abs() < 1e-12)
            .unwrap();
        assert!(
            (result.members[0].shear_force_kn[jump + 1] - result.members[0].shear_force_kn[jump]
                + 4.0)
                .abs()
                < 1e-10
        );
        assert!(result.members[0].bending_moment_knm.last().unwrap().abs() < 1e-10);
        assert!(result.equilibrium_residual < 1e-10);
    }

    #[test]
    fn simply_supported_uniform_load_matches_closed_form_midspan_field() {
        let mut input = cantilever();
        input.supports[0].rz = false;
        input.supports.push(Support {
            node_id: 2,
            ux: false,
            uy: true,
            rz: false,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -5.0,
            qy_end_kn_per_m: -5.0,
            start_position_m: None,
            end_position_m: None,
        });
        let result = solve(&input).unwrap();
        let ei = 210_000.0 * 1000.0 * 8e-6;
        assert!(
            (result.members[0].deflection_m[10] + 5.0 * 5.0 * 3.0_f64.powi(4) / (384.0 * ei)).abs()
                < 1e-12
        );
        assert!(
            (result.members[0].bending_moment_knm[10] - 5.0 * 3.0_f64.powi(2) / 8.0).abs() < 1e-10
        );
        assert!((result.nodes[0].reaction[1] - 7.5).abs() < 1e-10);
        assert!((result.nodes[1].reaction[1] - 7.5).abs() < 1e-10);
    }

    #[test]
    fn imposed_axial_displacement_gives_ea_delta_over_length() {
        let mut input = cantilever();
        input.supports.push(Support {
            node_id: 2,
            ux: true,
            uy: false,
            rz: false,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: Some(0.001),
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        let result = solve(&input).unwrap();
        let expected = 210_000.0 * 1000.0 * 0.01 * 0.001 / 3.0;
        assert!((result.nodes[0].reaction[0] + expected).abs() < 1e-10);
        assert!((result.nodes[1].reaction[0] - expected).abs() < 1e-10);
    }

    #[test]
    fn axial_spring_reaction_completes_force_balance() {
        let mut input = cantilever();
        input.supports.push(Support {
            node_id: 2,
            ux: false,
            uy: false,
            rz: false,
            kx_kn_per_m: Some(700.0),
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 100.0,
            fy: 0.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let axial_stiffness = 210_000.0 * 1000.0 * 0.01 / 3.0;
        let displacement = 100.0 / (axial_stiffness + 700.0);
        assert!((result.nodes[1].displacement[0] - displacement).abs() < 1e-12);
        assert!((result.nodes[1].reaction[0] + 700.0 * displacement).abs() < 1e-10);
        assert!((result.nodes[0].reaction[0] + axial_stiffness * displacement).abs() < 1e-10);
        assert!(
            (result
                .nodes
                .iter()
                .map(|node| node.reaction[0])
                .sum::<f64>()
                + 100.0)
                .abs()
                < 1e-10
        );
    }

    #[test]
    fn unsupported_analysis_and_unknown_member_load_are_rejected() {
        let mut input = cantilever();
        input.analysis = Analysis::Combined;
        assert!(solve(&input).unwrap_err().contains("linear"));
        input.analysis = Analysis::Linear;
        input.member_point_loads.push(MemberPointLoad {
            member_id: 99,
            px_kn: 0.0,
            py_kn: 1.0,
            position_m: 0.5,
        });
        assert!(solve(&input)
            .unwrap_err()
            .contains("unknown point-loaded member"));
    }
}
