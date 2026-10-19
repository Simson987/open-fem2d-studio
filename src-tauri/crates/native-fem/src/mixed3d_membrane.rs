//! Three-node, constant-strain, plane-stress membrane embedded in 3D.
//! Only the shared translations are active; this element has no transverse
//! bending stiffness or rotational DOFs. Forces are kN and lengths metres.

use crate::{frontal, mixed3d::Membrane3dElement, volume3d};

pub(crate) struct MembraneData {
    nodes: [usize; 3],
    strain: [[f64; 9]; 3],
    stress: [[f64; 9]; 3],
    force_scale: f64,
    thickness_m: f64,
}

impl MembraneData {
    pub(crate) fn new(
        mesh: &volume3d::Mesh,
        member: &Membrane3dElement,
        index: usize,
    ) -> Result<Self, String> {
        let [a, b, c] = member.nodes;
        if a == b || a == c || b == c {
            return Err(format!("membrane {index}: repeated node"));
        }
        let [Some(&p), Some(&q), Some(&r)] =
            [mesh.nodes.get(a), mesh.nodes.get(b), mesh.nodes.get(c)]
        else {
            return Err(format!("membrane {index}: node outside mesh"));
        };
        if [p, q, r].iter().flatten().any(|v| !v.is_finite()) {
            return Err(format!("membrane {index}: non-finite coordinate"));
        }
        if !member.e_mpa.is_finite()
            || member.e_mpa <= 0.0
            || !member.nu.is_finite()
            || member.nu <= -1.0
            || member.nu >= 0.5
            || !member.thickness_m.is_finite()
            || member.thickness_m <= 0.0
        {
            return Err(format!(
                "membrane {index}: E and thickness must be positive and finite; -1 < nu < 0.5"
            ));
        }
        let pq = std::array::from_fn::<_, 3, _>(|i| q[i] - p[i]);
        let pr = std::array::from_fn::<_, 3, _>(|i| r[i] - p[i]);
        let norm = |v: [f64; 3]| v.iter().fold(0.0_f64, |n, x| n.hypot(*x));
        let length = norm(pq);
        let edge = norm(pr);
        let qr = norm(std::array::from_fn(|i| r[i] - q[i]));
        let largest = length.max(edge).max(qr);
        if !length.is_finite() || !largest.is_finite() || largest == 0.0 {
            return Err(format!("membrane {index}: degenerate triangle"));
        }
        let e1 = pq.map(|v| v / length);
        let x2: f64 = (0..3).map(|i| pr[i] * e1[i]).sum();
        let transverse = std::array::from_fn::<_, 3, _>(|i| pr[i] - x2 * e1[i]);
        let y2 = norm(transverse);
        if !y2.is_finite() || y2 <= 1e-12 * largest {
            return Err(format!(
                "membrane {index}: degenerate or nearly collinear triangle"
            ));
        }
        let e2 = transverse.map(|v| v / y2);
        let area = 0.5 * length * y2;
        let force_scale = 1000.0 * area * member.thickness_m;
        if !force_scale.is_finite() || force_scale <= 0.0 {
            return Err(format!("membrane {index}: area/thickness overflow"));
        }
        // Local vertices are (0,0), (L,0), (x2,y2). Engineering shear gamma12.
        let dx = [-1.0 / length, 1.0 / length, 0.0];
        let dy = [(x2 - length) / (length * y2), -x2 / (length * y2), 1.0 / y2];
        let mut strain = [[0.0; 9]; 3];
        for node in 0..3 {
            for axis in 0..3 {
                let col = 3 * node + axis;
                strain[0][col] = dx[node] * e1[axis];
                strain[1][col] = dy[node] * e2[axis];
                strain[2][col] = dy[node] * e1[axis] + dx[node] * e2[axis];
            }
        }
        let elastic = member.e_mpa / (1.0 - member.nu * member.nu);
        let shear = member.e_mpa / (2.0 * (1.0 + member.nu));
        let mut stress = [[0.0; 9]; 3];
        for col in 0..9 {
            stress[0][col] = elastic * (strain[0][col] + member.nu * strain[1][col]);
            stress[1][col] = elastic * (member.nu * strain[0][col] + strain[1][col]);
            stress[2][col] = shear * strain[2][col];
        }
        if strain
            .iter()
            .flatten()
            .chain(stress.iter().flatten())
            .any(|v| !v.is_finite())
        {
            return Err(format!("membrane {index}: stiffness overflow"));
        }
        Ok(Self {
            nodes: member.nodes,
            strain,
            stress,
            force_scale,
            thickness_m: member.thickness_m,
        })
    }

    pub(crate) fn stress_mpa(&self, u: &[f64]) -> [f64; 3] {
        std::array::from_fn(|row| {
            (0..3)
                .flat_map(|node| {
                    (0..3).map(move |axis| {
                        self.stress[row][3 * node + axis] * u[3 * self.nodes[node] + axis]
                    })
                })
                .sum()
        })
    }

    pub(crate) fn resultants_kn_per_m(&self, stress: [f64; 3]) -> [f64; 3] {
        stress.map(|value| 1000.0 * self.thickness_m * value)
    }

    pub(crate) fn apply_into(&self, u: &[f64], force: &mut [f64]) {
        let stress = self.stress_mpa(u);
        for (local, &node) in self.nodes.iter().enumerate() {
            for axis in 0..3 {
                let column = 3 * local + axis;
                force[3 * node + axis] += self.force_scale
                    * (0..3)
                        .map(|row| self.strain[row][column] * stress[row])
                        .sum::<f64>();
            }
        }
    }

    pub(crate) fn diagonal_into(&self, diagonal: &mut [f64]) {
        for (local, &node) in self.nodes.iter().enumerate() {
            for axis in 0..3 {
                let col = 3 * local + axis;
                diagonal[3 * node + axis] += self.force_scale
                    * (0..3)
                        .map(|row| self.strain[row][col] * self.stress[row][col])
                        .sum::<f64>();
            }
        }
    }

    pub(crate) fn frontal_element(&self) -> Result<frontal::FrontalElement, String> {
        let dofs: Vec<usize> = self
            .nodes
            .iter()
            .flat_map(|&node| (0..3).map(move |axis| 3 * node + axis))
            .collect();
        let stiffness: Vec<f64> = (0..9)
            .flat_map(|row| {
                (0..9).map(move |col| {
                    self.force_scale
                        * (0..3)
                            .map(|axis| self.strain[axis][row] * self.stress[axis][col])
                            .sum::<f64>()
                })
            })
            .collect();
        if stiffness.iter().any(|v| !v.is_finite()) {
            return Err("membrane local stiffness overflow".into());
        }
        Ok(frontal::FrontalElement { dofs, stiffness })
    }
}
