//! Orthotrope platen (#79, #97).
//!
//! Een plaat kan in plaats van de isotrope E en ν van haar materiaal een
//! orthotrope stijfheid krijgen in haar eigen plaatassen (zie `shell.rs`:
//! bij een verticale wand wijst y omhoog, x ligt horizontaal in het vlak).
//! Dat is de gedeelde voorziening voor:
//!
//! * de metselwerkwand (#97): E_y = E van het metselwerk (de last gaat naar
//!   de fundering), E_x ≈ 0 (de wand werkt niet als hoge ligger samen met de
//!   funderingsbalk en spreidt verticale last niet zijwaarts), G > 0 (wind in
//!   het vlak gaat via afschuiving naar de fundering);
//! * CLT (#79): verschillende stijfheden langs en dwars op de toplaag.
//!
//! Vlakke-spanningstoestand van een orthotroop materiaal met de hoofdassen
//! langs de plaatassen (Reddy, *Mechanics of Laminated Composite Plates and
//! Shells*, 2e druk, §3.3, vgl. 3.3.15):
//!
//! ```text
//! Q11 = E_x/(1−ν_xy·ν_yx)   Q22 = E_y/(1−ν_xy·ν_yx)
//! Q12 = ν_xy·E_y/(1−ν_xy·ν_yx)   Q66 = G_xy,   ν_yx = ν_xy·E_y/E_x
//! ```
//!
//! Membraan A = Q·t, buiging D = Q·t³/12, dwarskracht S = 5/6·diag(G_xz, G_yz)·t
//! (homogene doorsnede; een gelaagde CLT-opbouw geeft andere A, D en S en hoort
//! bij de plaattypen van #79). De kern krijgt de matrices in de eigen assen
//! van elk element (`QuadConstitutive`); deze module draait ze daarheen en
//! rekent bij het nabewerken rekken weer om naar krachten.

use rekenkern::types::QuadConstitutive;
use serde::{Deserialize, Serialize};

use crate::shell::{dot, PlateAxes3D, V3};

/// Orthotrope stijfheid van een plaat in plaatassen, N/mm² (MPa).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlateOrthotropy3D {
    /// E in de plaat-x-richting (bij een wand: horizontaal).
    pub e_x_mpa: f64,
    /// E in de plaat-y-richting (bij een wand: verticaal).
    pub e_y_mpa: f64,
    /// Schuifmodulus in het vlak.
    pub g_xy_mpa: f64,
    /// Dwarscontractie ν_xy (rek in y door spanning in x); standaard 0.
    #[serde(default)]
    pub nu_xy: f64,
    /// Dwarskracht-schuifmoduli; ontbrekend = G_xy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub g_xz_mpa: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub g_yz_mpa: Option<f64>,
}

impl PlateOrthotropy3D {
    pub(crate) fn validate(&self, plate_id: usize) -> Result<(), String> {
        let values = [
            ("eXMpa", self.e_x_mpa), ("eYMpa", self.e_y_mpa), ("gXyMpa", self.g_xy_mpa),
            ("gXzMpa", self.g_xz_mpa.unwrap_or(self.g_xy_mpa)), ("gYzMpa", self.g_yz_mpa.unwrap_or(self.g_xy_mpa)),
        ];
        for (name, value) in values {
            if !value.is_finite() || value <= 0.0 {
                return Err(format!(
                    "plaat {plate_id}: orthotrope {name} moet groter dan 0 zijn (gegeven {value}); \
                     gebruik voor 'geen stijfheid' een kleine waarde, bijv. E/1000"
                ));
            }
        }
        // Positief definiet: ν_xy·ν_yx < 1, ofwel ν_xy² < E_x/E_y.
        if !self.nu_xy.is_finite() || self.nu_xy * self.nu_xy >= self.e_x_mpa / self.e_y_mpa {
            return Err(format!(
                "plaat {plate_id}: orthotrope ν_xy = {} geeft geen positief definiete stijfheid \
                 (eis ν_xy² < E_x/E_y = {:.4})",
                self.nu_xy, self.e_x_mpa / self.e_y_mpa,
            ));
        }
        Ok(())
    }
}

/// Stijfheidsmatrices (kN, m) in één assenstelsel.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Stiffness {
    /// Membraan A (kN/m), Voigt [xx, yy, xy] met technische schuifhoek.
    pub a: [[f64; 3]; 3],
    /// Buiging D (kNm).
    pub d: [[f64; 3]; 3],
    /// Dwarskracht S (kN/m), inclusief κ = 5/6.
    pub s: [[f64; 2]; 2],
    /// Referentie voor de boorvrijheidsgraad: G_xy·t (kN/m).
    pub drilling: f64,
}

/// Stijfheid in plaatassen.
pub(crate) fn plate_stiffness(o: &PlateOrthotropy3D, t: f64) -> Stiffness {
    let (ex, ey, gxy) = (o.e_x_mpa * 1000.0, o.e_y_mpa * 1000.0, o.g_xy_mpa * 1000.0);
    let nu_yx = o.nu_xy * ey / ex;
    let den = 1.0 - o.nu_xy * nu_yx;
    let q = [
        [ex / den, o.nu_xy * ey / den, 0.0],
        [o.nu_xy * ey / den, ey / den, 0.0],
        [0.0, 0.0, gxy],
    ];
    let scaled = |f: f64| q.map(|row| row.map(|v| v * f));
    let kappa = 5.0 / 6.0;
    let gxz = o.g_xz_mpa.unwrap_or(o.g_xy_mpa) * 1000.0;
    let gyz = o.g_yz_mpa.unwrap_or(o.g_xy_mpa) * 1000.0;
    Stiffness {
        a: scaled(t),
        d: scaled(t * t * t / 12.0),
        s: [[kappa * gxz * t, 0.0], [0.0, kappa * gyz * t]],
        drilling: gxy * t,
    }
}

/// Richtingscosinussen Q[i][j] = e_i · p_j van de elementassen (e1, e2) ten
/// opzichte van de plaatassen (x, y). Een vector: v_e = Q·v_p; een
/// symmetrische tensor: T_e = Q·T_p·Qᵀ. Ligt de elementnormaal tegen de
/// plaatnormaal in, dan is Q een spiegeling; voor de momenten en krommingen
/// wisselen beide van teken, zodat D en S daar ongevoelig voor zijn.
fn direction_cosines(e1: V3, e2: V3, axes: &PlateAxes3D) -> [[f64; 2]; 2] {
    [[dot(e1, axes.x), dot(e1, axes.y)], [dot(e2, axes.x), dot(e2, axes.y)]]
}

fn voigt_strain_to_tensor(v: [f64; 3]) -> [[f64; 2]; 2] { [[v[0], 0.5 * v[2]], [0.5 * v[2], v[1]]] }
fn tensor_to_voigt_strain(t: [[f64; 2]; 2]) -> [f64; 3] { [t[0][0], t[1][1], t[0][1] + t[1][0]] }
fn tensor_to_voigt_stress(t: [[f64; 2]; 2]) -> [f64; 3] { [t[0][0], t[1][1], 0.5 * (t[0][1] + t[1][0])] }
fn voigt_stress_to_tensor(v: [f64; 3]) -> [[f64; 2]; 2] { [[v[0], v[2]], [v[2], v[1]]] }

/// R·T·Rᵀ (transposed = false) of Rᵀ·T·R (transposed = true).
fn rotate(t: [[f64; 2]; 2], r: [[f64; 2]; 2], transposed: bool) -> [[f64; 2]; 2] {
    let at = |i: usize, j: usize| if transposed { r[j][i] } else { r[i][j] };
    let mut out = [[0.0; 2]; 2];
    for i in 0..2 {
        for j in 0..2 {
            for a in 0..2 {
                for b in 0..2 {
                    out[i][j] += at(i, a) * t[a][b] * at(j, b);
                }
            }
        }
    }
    out
}

fn mat_vec3(m: &[[f64; 3]; 3], v: [f64; 3]) -> [f64; 3] {
    [0, 1, 2].map(|i| m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2])
}

/// Een 3×3-stijfheid (rek → kracht, Voigt) van plaatassen naar elementassen:
/// kolom k is de kracht in elementassen bij eenheidsrek k in elementassen.
fn to_element_3(m: &[[f64; 3]; 3], q: [[f64; 2]; 2]) -> [[f64; 3]; 3] {
    let mut out = [[0.0; 3]; 3];
    for k in 0..3 {
        let mut unit = [0.0; 3];
        unit[k] = 1.0;
        let strain_plate = tensor_to_voigt_strain(rotate(voigt_strain_to_tensor(unit), q, true));
        let force_plate = mat_vec3(m, strain_plate);
        let force_element = tensor_to_voigt_stress(rotate(voigt_stress_to_tensor(force_plate), q, false));
        for i in 0..3 { out[i][k] = force_element[i]; }
    }
    out
}

/// De stijfheid in de assen van één element (e1, e2 uit `quad_transform_3d`).
pub(crate) fn element_stiffness(plate: &Stiffness, e1: V3, e2: V3, axes: &PlateAxes3D) -> Stiffness {
    let q = direction_cosines(e1, e2, axes);
    let mut s = [[0.0; 2]; 2];
    for i in 0..2 {
        for j in 0..2 {
            for a in 0..2 {
                for b in 0..2 {
                    s[i][j] += q[i][a] * plate.s[a][b] * q[j][b];
                }
            }
        }
    }
    Stiffness { a: to_element_3(&plate.a, q), d: to_element_3(&plate.d, q), s, drilling: plate.drilling }
}

pub(crate) fn to_engine(s: &Stiffness) -> QuadConstitutive {
    let flat3 = |m: &[[f64; 3]; 3]| [m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2]];
    QuadConstitutive {
        membrane: flat3(&s.a),
        bending: flat3(&s.d),
        shear: [s.s[0][0], s.s[0][1], s.s[1][0], s.s[1][1]],
        drilling: s.drilling,
    }
}

/// Membraankrachten en momenten in elementassen uit rekken en krommingen in
/// elementassen (Voigt, technische schuifhoek / κxy zoals in MITC4).
pub(crate) fn element_forces(s: &Stiffness, strain: [f64; 3], curvature: [f64; 3]) -> ([f64; 3], [f64; 3]) {
    (mat_vec3(&s.a, strain), mat_vec3(&s.d, curvature))
}

pub(crate) fn element_shear(s: &Stiffness, gamma: [f64; 2]) -> [f64; 2] {
    [s.s[0][0] * gamma[0] + s.s[0][1] * gamma[1], s.s[1][0] * gamma[0] + s.s[1][1] * gamma[1]]
}
