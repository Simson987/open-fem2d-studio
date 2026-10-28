//! Effectieve doorsnede — EN 1993-1-3 §5.5 met EN 1993-1-5 §4.4.
//!
//! # Lokale plooi (§5.5.2)
//! Effectieve breedten met EN 1993-1-5 §4.4: `ρ` uit (4.2) voor inwendige en
//! (4.3) voor uitstekende delen, `λ̄_p = (b_p/t) / (28,4 ε √k_σ)` met
//! `ε = √(235/f_yb)` en de drukspanning `σ_com,Ed = f_yb/γ_M0` (de veilige
//! keuze: de verlaagde slankheid van §5.5.2(3) wordt niet benut). `k_σ` en de
//! verdeling `b_e1`/`b_e2` uit tabel 4.1 (inwendig) en 4.2 (uitstekend).
//!
//! # Randverstijver (§5.5.3.2)
//! De lip van een C- of Z-profiel. Stap 1: de flens als tweezijdig gesteund
//! deel (`ψ = 1`, `k_σ = 4`), de lip met `k_σ` uit (5.13b)/(5.13c); de
//! verstijver is `b_e2` van de flens plus `c_eff` van de lip. Stap 2: de
//! veerstijfheid `K₁` uit (5.10b), `σ_cr,s = 2√(K E I_s)/A_s` (5.15),
//! `λ̄_d = √(f_yb/σ_cr,s)` en `χ_d` uit (5.12a–c). De verstijver krijgt de
//! gereduceerde dikte `t_red = χ_d t` (σ_com,Ed = f_yb/γ_M0). De optionele
//! iteratie van stap 3 (§5.5.3.2(10)) wordt niet uitgevoerd — dat is veilig.
//!
//! # Lijf
//! Bij buiging volgt de spanningsverhouding `ψ` van het lijf uit de doorsnede
//! met de effectieve drukflens (incl. gereduceerde verstijver) en het bruto
//! lijf (EN 1993-1-5 §4.4(3)). Geen verdere iteratie van de neutrale lijn.
//!
//! # Afgeronde hoeken
//! Met `δ` uit §5.1(4) (0 als de hoeken volgens §5.1(3) verwaarloosbaar zijn)
//! worden `A_eff` met `(1 − δ)` en `I_eff`/`W_eff` met `(1 − 2δ)` verlaagd.

use crate::doorsnede::{KvDoorsnede, Plaatrol};
use crate::dunwandig::{Dunwandig, Strook};
use crate::materiaal::{epsilon, E_STAAL, NU_STAAL};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// `k_σ` voor een inwendig deel, EN 1993-1-5 tabel 4.1.
pub fn k_sigma_inwendig(psi: f64) -> f64 {
    if psi >= 1.0 {
        4.0
    } else if psi > 0.0 {
        8.2 / (1.05 + psi)
    } else if psi == 0.0 {
        7.81
    } else if psi > -1.0 {
        7.81 - 6.29 * psi + 9.78 * psi * psi
    } else if psi == -1.0 {
        23.9
    } else {
        5.98 * (1.0 - psi).powi(2)
    }
}

/// `k_σ` van een lip (enkele randzetting), §5.5.3.2(5), (5.13b)/(5.13c):
/// `0,5` voor `b_p,c/b_p ≤ 0,35`, anders `0,5 + 0,83 ∛((b_p,c/b_p − 0,35)²)`
/// (geldig tot 0,6).
pub fn k_sigma_lip(verhouding: f64) -> f64 {
    if verhouding <= 0.35 {
        0.5
    } else {
        0.5 + 0.83 * (verhouding - 0.35).powi(2).cbrt()
    }
}

/// `λ̄_p = (b̄/t) / (28,4 ε √k_σ)`, EN 1993-1-5 §4.4(2).
pub fn lambda_p(b: f64, t: f64, eps: f64, k_sigma: f64) -> f64 {
    (b / t) / (28.4 * eps * k_sigma.sqrt())
}

/// `ρ` van een inwendig deel, EN 1993-1-5 (4.2):
/// 1 voor `λ̄_p ≤ 0,5 + √(0,085 − 0,055ψ)`, anders `(λ̄_p − 0,055(3 + ψ))/λ̄_p² ≤ 1`.
pub fn rho_inwendig(lp: f64, psi: f64) -> f64 {
    if lp <= 0.5 + (0.085 - 0.055 * psi).sqrt() {
        1.0
    } else {
        ((lp - 0.055 * (3.0 + psi)) / (lp * lp)).min(1.0)
    }
}

/// `ρ` van een uitstekend deel, EN 1993-1-5 (4.3):
/// 1 voor `λ̄_p ≤ 0,748`, anders `(λ̄_p − 0,188)/λ̄_p² ≤ 1`.
pub fn rho_uitstekend(lp: f64) -> f64 {
    if lp <= 0.748 {
        1.0
    } else {
        ((lp - 0.188) / (lp * lp)).min(1.0)
    }
}

/// `χ_d` voor vervormingsknik (distortional buckling), §5.5.3.1(7), (5.12a–c).
pub fn chi_d(lambda_d: f64) -> f64 {
    if lambda_d <= 0.65 {
        1.0
    } else if lambda_d < 1.38 {
        1.47 - 0.723 * lambda_d
    } else {
        0.66 / lambda_d
    }
}

/// Veerstijfheid van de randverstijver per lengte-eenheid, §5.5.3.1(5),
/// (5.10b): `K₁ = E t³ / (4(1 − ν²)) · 1/(b₁² h_w + b₁³ + 0,5 b₁ b₂ h_w k_f)`
/// (N/mm per mm).
pub fn veerstijfheid(t: f64, b1: f64, b2: f64, h_w: f64, k_f: f64) -> f64 {
    E_STAAL * t.powi(3) / (4.0 * (1.0 - NU_STAAL * NU_STAAL)) / (b1 * b1 * h_w + b1.powi(3) + 0.5 * b1 * b2 * h_w * k_f)
}

/// Belastinggeval van de effectieve doorsnede.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/koudgevormd/")]
pub enum Belastinggeval {
    /// Uniforme druk `f_yb` (§6.1.3).
    Druk,
    /// Buiging om de y-as met de BOVENflens gedrukt (§6.1.4). Door de
    /// symmetrie van C/U (om y) en de puntsymmetrie van Z geldt het
    /// resultaat ook voor de omgekeerde momentrichting.
    Buiging,
}

/// Effectieve breedte van één plaatdeel.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/koudgevormd/")]
pub struct DeelEffectief {
    pub rol: Plaatrol,
    /// Tweezijdig gesteund (inwendig) of uitstekend.
    pub inwendig: bool,
    pub b_p_mm: f64,
    pub psi: f64,
    pub k_sigma: f64,
    pub lambda_p: f64,
    pub rho: f64,
    pub b_eff_mm: f64,
}

/// De randverstijver (flensdeel `b_e2` + lip `c_eff`) van één flens.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/koudgevormd/")]
pub struct Randverstijver {
    pub rol: Plaatrol,
    pub b_e2_mm: f64,
    pub c_eff_mm: f64,
    pub a_s_mm2: f64,
    pub i_s_mm4: f64,
    /// Afstand lijf–zwaartepunt van de verstijver, `b₁` (mm).
    pub b1_mm: f64,
    pub k_f: f64,
    /// `K₁` (N/mm²).
    pub k_n_mm2: f64,
    pub sigma_cr_s: f64,
    pub lambda_d: f64,
    pub chi_d: f64,
}

/// Effectieve doorsnede voor één belastinggeval (mm-eenheden).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/koudgevormd/")]
pub struct EffectieveDoorsnede {
    pub geval: Belastinggeval,
    pub delen: Vec<DeelEffectief>,
    pub verstijvers: Vec<Randverstijver>,
    pub a_eff_mm2: f64,
    /// Zwaartepunt van de effectieve doorsnede (hartlijnassen).
    pub y_c_mm: f64,
    pub z_c_mm: f64,
    pub i_y_eff_mm4: f64,
    pub i_z_eff_mm4: f64,
    /// `W_eff` voor de bovenste en de onderste vezel (buitenkant), y-as.
    pub w_y_boven_mm3: f64,
    pub w_y_onder_mm3: f64,
    /// Kleinste `W_eff` om de z-as (buitenste vezels).
    pub w_z_min_mm3: f64,
    /// Verschuiving van het zwaartepunt t.o.v. de bruto doorsnede (§6.1.3(4)).
    pub e_ny_mm: f64,
    pub e_nz_mm: f64,
    /// Toegepaste `δ` (§5.1(4)).
    pub delta: f64,
    /// Waar een regel buiten zijn geldigheid is gebruikt (niet leeg ⇒ geen "voldoet").
    pub buiten_bereik: Vec<String>,
}

impl EffectieveDoorsnede {
    pub fn w_y_min(&self) -> f64 {
        self.w_y_boven_mm3.min(self.w_y_onder_mm3)
    }
}

/// Bepaal de effectieve doorsnede.
pub fn effectieve_doorsnede(d: &KvDoorsnede, f_yb: f64, geval: Belastinggeval) -> EffectieveDoorsnede {
    let t = d.t();
    let eps = epsilon(f_yb);
    let (hp, _, _) = d.hartlijn();
    let delen = d.delen();
    let deel = |rol: Plaatrol| delen.iter().find(|x| x.rol == rol).copied();
    let lip_verstijft = d.lip_verstijft();
    let mut stroken: Vec<Strook> = Vec::new();
    let mut uit_delen: Vec<DeelEffectief> = Vec::new();
    let mut verstijvers: Vec<Randverstijver> = Vec::new();
    let mut buiten_bereik: Vec<String> = Vec::new();

    for (flens_rol, lip_rol) in [(Plaatrol::FlensBoven, Plaatrol::LipBoven), (Plaatrol::FlensOnder, Plaatrol::LipOnder)] {
        let flens = deel(flens_rol).expect("flens");
        let lip = deel(lip_rol);
        let gedrukt = geval == Belastinggeval::Druk || flens_rol == Plaatrol::FlensBoven;
        if !gedrukt {
            stroken.push(flens.strook);
            if let Some(l) = lip {
                stroken.push(l.strook);
            }
            continue;
        }
        let bp = flens.b_p;
        if let (true, Some(l)) = (lip_verstijft, lip) {
            // Flens als inwendig deel, ψ = 1.
            let ks = 4.0;
            let lp = lambda_p(bp, t, eps, ks);
            let rho = rho_inwendig(lp, 1.0);
            let beff = rho * bp;
            let (be1, be2) = (0.5 * beff, 0.5 * beff);
            uit_delen.push(DeelEffectief { rol: flens_rol, inwendig: true, b_p_mm: bp, psi: 1.0, k_sigma: ks, lambda_p: lp, rho, b_eff_mm: beff });
            // Lip, §5.5.3.2(5).
            let cp = l.b_p;
            let verh = cp / bp;
            if verh > 0.6 {
                buiten_bereik.push(format!("b_p,c/b_p = {verh:.3} > 0,6: k_σ van de lip (5.13c) buiten zijn bereik"));
            }
            let ks_lip = k_sigma_lip(verh.min(0.6));
            let lp_lip = lambda_p(cp, t, eps, ks_lip);
            let rho_lip = rho_uitstekend(lp_lip);
            let ceff = rho_lip * cp;
            uit_delen.push(DeelEffectief { rol: lip_rol, inwendig: false, b_p_mm: cp, psi: 1.0, k_sigma: ks_lip, lambda_p: lp_lip, rho: rho_lip, b_eff_mm: ceff });
            // Verstijver, §5.5.3.2(3)–(7).
            let a_s = t * (be2 + ceff);
            let b1 = (be2 * (bp - 0.5 * be2) + ceff * bp) / (be2 + ceff);
            let zs = 0.5 * ceff * ceff / (be2 + ceff);
            let i_s = t * (be2 * t * t / 12.0 + be2 * zs * zs + ceff.powi(3) / 12.0 + ceff * (0.5 * ceff - zs).powi(2));
            // k_f: bij druk A_s2/A_s1 = 1 (twee gelijke flenzen); bij buiging 0 (andere flens in trek).
            let k_f = if geval == Belastinggeval::Druk { 1.0 } else { 0.0 };
            let k = veerstijfheid(t, b1, b1, hp, k_f);
            let sigma_cr_s = 2.0 * (k * E_STAAL * i_s).sqrt() / a_s;
            let lambda_d = (f_yb / sigma_cr_s).sqrt();
            let chid = chi_d(lambda_d);
            verstijvers.push(Randverstijver {
                rol: flens_rol, b_e2_mm: be2, c_eff_mm: ceff, a_s_mm2: a_s, i_s_mm4: i_s, b1_mm: b1, k_f,
                k_n_mm2: k, sigma_cr_s, lambda_d, chi_d: chid,
            });
            stroken.push(flens.strook.deel(0.0, be1 / bp, t));
            stroken.push(flens.strook.deel(1.0 - be2 / bp, 1.0, chid * t));
            stroken.push(l.strook.deel(0.0, ceff / cp, chid * t));
        } else {
            // Uitstekende flens (U, of lip genegeerd volgens §5.2(3)), ψ = 1.
            let ks = 0.43;
            let lp = lambda_p(bp, t, eps, ks);
            let rho = rho_uitstekend(lp);
            let beff = rho * bp;
            uit_delen.push(DeelEffectief { rol: flens_rol, inwendig: false, b_p_mm: bp, psi: 1.0, k_sigma: ks, lambda_p: lp, rho, b_eff_mm: beff });
            stroken.push(flens.strook.deel(0.0, beff / bp, t));
        }
    }

    // Lijf.
    let lijf = deel(Plaatrol::Lijf).expect("lijf");
    let psi = match geval {
        Belastinggeval::Druk => 1.0,
        Belastinggeval::Buiging => {
            let mut tijdelijk = stroken.clone();
            tijdelijk.push(lijf.strook);
            let zc = Dunwandig { stroken: tijdelijk }.grootheden().z_c;
            (-0.5 * hp - zc) / (0.5 * hp - zc)
        }
    };
    if psi < -3.0 {
        buiten_bereik.push(format!("ψ = {psi:.2} < −3 voor het lijf: buiten tabel 4.1"));
    }
    let ks = k_sigma_inwendig(psi);
    let lp = lambda_p(hp, t, eps, ks);
    let rho = rho_inwendig(lp, psi);
    let (beff, a1, a2) = if psi < 0.0 {
        let bc = hp / (1.0 - psi);
        let beff = rho * bc;
        (beff, 0.4 * beff, bc - 0.6 * beff)
    } else {
        let beff = rho * hp;
        let be1 = if psi >= 1.0 { 0.5 * beff } else { 2.0 * beff / (5.0 - psi) };
        (beff, be1, hp - (beff - be1))
    };
    uit_delen.push(DeelEffectief { rol: Plaatrol::Lijf, inwendig: true, b_p_mm: hp, psi, k_sigma: ks, lambda_p: lp, rho, b_eff_mm: beff });
    if rho >= 1.0 || a1 >= a2 {
        stroken.push(lijf.strook);
    } else {
        stroken.push(lijf.strook.deel(0.0, a1 / hp, t));
        stroken.push(lijf.strook.deel(a2 / hp, 1.0, t));
    }

    // Grootheden, met δ.
    let delta = d.delta();
    let g = Dunwandig { stroken }.grootheden();
    let bruto = d.hartlijn_bruto();
    let gb = bruto.grootheden();
    let i_y = g.i_y * (1.0 - 2.0 * delta);
    let i_z = g.i_z * (1.0 - 2.0 * delta);
    let h2 = 0.5 * d.h();
    let (mut y_min, mut y_max) = (f64::INFINITY, f64::NEG_INFINITY);
    for s in &bruto.stroken {
        for y in [s.y0, s.y1] {
            y_min = y_min.min(y - 0.5 * t);
            y_max = y_max.max(y + 0.5 * t);
        }
    }
    let w_z_min = i_z / (g.y_c - y_min).max(y_max - g.y_c);
    EffectieveDoorsnede {
        geval,
        delen: uit_delen,
        verstijvers,
        a_eff_mm2: g.a * (1.0 - delta),
        y_c_mm: g.y_c,
        z_c_mm: g.z_c,
        i_y_eff_mm4: i_y,
        i_z_eff_mm4: i_z,
        w_y_boven_mm3: i_y / (h2 - g.z_c),
        w_y_onder_mm3: i_y / (h2 + g.z_c),
        w_z_min_mm3: w_z_min,
        e_ny_mm: g.y_c - gb.y_c,
        e_nz_mm: g.z_c - gb.z_c,
        delta,
        buiten_bereik,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn k_sigma_tabel_4_1_sluit_aan_op_de_knikpunten() {
        assert_eq!(k_sigma_inwendig(1.0), 4.0);
        assert!((k_sigma_inwendig(1e-9) - 8.2 / 1.05).abs() < 1e-6);
        assert!((k_sigma_inwendig(-1.0 + 1e-12) - 23.88).abs() < 1e-6);
        assert!((k_sigma_lip(0.35) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn chi_d_is_continu() {
        assert!((chi_d(0.65) - 1.0).abs() < 1e-12);
        assert!((1.47_f64 - 0.723 * 0.65 - 1.0).abs() < 0.001);
        assert!((1.47_f64 - 0.723 * 1.38 - 0.66 / 1.38).abs() < 0.01);
    }
}
