//! NEN-EN 1993-1-5 §4.4 — effectieve breedtes van plaatdelen, voor een
//! doorsnede in klasse 4 (NEN-EN 1993-1-1 §6.2.2.5).
//!
//! Een klasse 4-doorsnede plooit plaatselijk voordat zij de vloeigrens haalt.
//! De norm rekent dan met een EFFECTIEVE doorsnede: van elk gedrukt plaatdeel
//! telt alleen de effectieve breedte b_eff = ρ·b̄ mee.
//!
//! * A_eff — de effectieve oppervlakte onder GELIJKMATIGE druk (ψ = 1 in elk
//!   plaatdeel). Bij een dubbelsymmetrische doorsnede blijft het zwaartepunt
//!   daarbij op zijn plaats: e_N = 0.
//! * W_eff,y en W_eff,z — het effectieve elastische weerstandsmoment onder
//!   ZUIVERE buiging om de betreffende as (NEN-EN 1993-1-1 6.2.9.3(2)). Eerst
//!   de gedrukte flens (ψ uit de brutodoorsnede, 4.4(3)), dan het lijf met de
//!   spanningsverdeling van de doorsnede met die effectieve flens en het
//!   bruto lijf (4.4(3)). Eén stap, zonder iteratie.
//!
//! Formules (NEN-EN 1993-1-5:2006+A1:2017):
//!
//! ```text
//! λ̄_p = (b̄/t) / (28,4·ε·√k_σ)                                      (4.4(2))
//! inwendig:   ρ = 1                         λ̄_p ≤ 0,5 + √(0,085 − 0,055ψ)
//!             ρ = (λ̄_p − 0,055·(3 + ψ))/λ̄_p² ≤ 1   anders            (4.2)
//! uitkragend: ρ = 1                         λ̄_p ≤ 0,748
//!             ρ = (λ̄_p − 0,188)/λ̄_p² ≤ 1   anders                    (4.3)
//! k_σ inwendig (tabel 4.1): ψ = 1: 4,0; 1 > ψ > 0: 8,2/(1,05 + ψ);
//!   0: 7,81; 0 > ψ > −1: 7,81 − 6,29ψ + 9,78ψ²; −1: 23,9;
//!   −1 > ψ > −3: 5,98·(1 − ψ)²
//! k_σ uitkragend, grootste druk aan de vrije rand (tabel 4.2):
//!   0,57 − 0,21ψ + 0,07ψ²  (ψ = 1: 0,43)
//! ```
//!
//! b̄ volgt 4.4(2): de breedte c van tabel 5.2 — bij een gewalst I-profiel het
//! lijf h − 2t_f − 2r en de flensuitkraging (b − t_w − 2r)/2, bij een
//! warmvervaardigde koker b − 3t en h − 3t.
//!
//! Alleen de dubbelsymmetrische I en de koker met één wanddikte worden hier
//! uitgewerkt. Voor elke andere vorm (U, hoeklijn, ronde buis — die laatste
//! valt onder NEN-EN 1993-1-6 — en een monosymmetrische of willekeurige
//! samengestelde doorsnede) geeft [`effectieve_doorsnede`] `None`, en weigert
//! de staaltoets de toetsen die van de klasse afhangen met die reden.

use section_properties::SectionProperties;

use crate::classification::epsilon;
use crate::opmaak::{lx, nl, nv, stap};
use crate::{Deelstap, SteelGrade};

/// De vormen waarvoor de effectieve doorsnede bepaald wordt.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Klasse4Vorm {
    /// Dubbelsymmetrische I of H: hoogte h, breedte b, flensdikte t_f,
    /// lijfdikte t_w en afrondingsstraal r (0 bij een gelaste I).
    I { h: f64, b: f64, tf: f64, tw: f64, r: f64 },
    /// Koker met één wanddikte t (SHS/RHS uit de catalogus).
    Koker { h: f64, b: f64, t: f64 },
}

/// Eén plaatdeel met zijn effectieve breedte.
#[derive(Clone, Debug, PartialEq)]
pub struct Plaatdeel {
    /// Leesbare naam: "lijf", "bovenflens (uitkraging)", …
    pub naam: String,
    /// b̄ (mm).
    pub c_mm: f64,
    pub t_mm: f64,
    /// Spanningsverhouding ψ = σ₂/σ₁.
    pub psi: f64,
    pub k_sigma: f64,
    pub lambda_p: f64,
    pub rho: f64,
    /// Het gedrukte deel b_c (mm); gelijk aan c_mm bij ψ ≥ 0.
    pub b_c_mm: f64,
    /// b_eff = ρ·b_c (mm).
    pub b_eff_mm: f64,
    pub uitkragend: bool,
}

/// De effectieve doorsnede van een klasse 4-doorsnede.
#[derive(Clone, Debug)]
pub struct EffectieveDoorsnede {
    pub a_eff_mm2: f64,
    pub w_eff_y_mm3: f64,
    pub w_eff_z_mm3: f64,
    /// Verschuiving van het zwaartepunt onder gelijkmatige druk (mm). Nul bij
    /// een dubbelsymmetrische doorsnede.
    pub e_n_y_mm: f64,
    pub e_n_z_mm: f64,
    pub druk: Vec<Plaatdeel>,
    pub buiging_y: Vec<Plaatdeel>,
    pub buiging_z: Vec<Plaatdeel>,
    /// De brutodoorsnede met A, W_el,y en W_el,z vervangen door A_eff,
    /// W_eff,y en W_eff,z. I, i, I_t, I_w, A_v en W_pl blijven bruto: knik
    /// en kip rekenen met de bruto stijfheid (NEN-EN 1993-1-1 6.3.1.2 en
    /// 6.3.2.2), de dwarskracht met het bruto afschuifoppervlak.
    pub props: SectionProperties,
}

/// k_σ van een inwendig plaatdeel, tabel 4.1.
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

/// k_σ van een uitkragend plaatdeel met de grootste druk aan de vrije rand,
/// tabel 4.2 (ψ = σ aan de gesteunde rand / σ aan de vrije rand).
pub fn k_sigma_uitkragend(psi: f64) -> f64 {
    if psi >= 1.0 {
        0.43
    } else {
        0.57 - 0.21 * psi + 0.07 * psi * psi
    }
}

/// λ̄_p van 4.4(2).
pub fn lambda_p(c_mm: f64, t_mm: f64, eps: f64, k_sigma: f64) -> f64 {
    if !(t_mm > 0.0) || !(k_sigma > 0.0) {
        return f64::INFINITY;
    }
    (c_mm / t_mm) / (28.4 * eps * k_sigma.sqrt())
}

/// ρ van een inwendig plaatdeel, (4.2).
pub fn rho_inwendig(lambda_p: f64, psi: f64) -> f64 {
    let grens = 0.5 + (0.085 - 0.055 * psi).max(0.0).sqrt();
    if lambda_p <= grens {
        1.0
    } else {
        ((lambda_p - 0.055 * (3.0 + psi).max(0.0)) / (lambda_p * lambda_p)).clamp(0.0, 1.0)
    }
}

/// ρ van een uitkragend plaatdeel, (4.3).
pub fn rho_uitkragend(lambda_p: f64) -> f64 {
    if lambda_p <= 0.748 {
        1.0
    } else {
        ((lambda_p - 0.188) / (lambda_p * lambda_p)).clamp(0.0, 1.0)
    }
}

/// Een gat in de doorsnede: het niet-effectieve deel van een plaatdeel, als
/// rechthoek (oppervlak, zwaartepunt in de buigrichting, eigen traagheid).
#[derive(Clone, Copy, Debug)]
struct Gat {
    a: f64,
    x: f64,
    i_eigen: f64,
}

/// Oppervlak, ligging van de neutrale lijn en traagheidsmoment na het
/// weghalen van de gaten uit een doorsnede met zwaartepunt op x = 0.
fn zonder_gaten(a: f64, i: f64, gaten: &[Gat]) -> (f64, f64, f64) {
    let da: f64 = gaten.iter().map(|g| g.a).sum();
    let ds: f64 = gaten.iter().map(|g| g.a * g.x).sum();
    let di: f64 = gaten.iter().map(|g| g.i_eigen + g.a * g.x * g.x).sum();
    let a_rest = a - da;
    let x_na = if a_rest > 0.0 { -ds / a_rest } else { 0.0 };
    (a_rest, x_na, i - di - a_rest * x_na * x_na)
}

/// Een gedrukt plaatdeel onder gelijkmatige druk (ψ = 1).
fn gelijkmatig(naam: &str, c: f64, t: f64, eps: f64, uitkragend: bool) -> Plaatdeel {
    let k = if uitkragend { k_sigma_uitkragend(1.0) } else { k_sigma_inwendig(1.0) };
    let lp = lambda_p(c, t, eps, k);
    let rho = if uitkragend { rho_uitkragend(lp) } else { rho_inwendig(lp, 1.0) };
    Plaatdeel {
        naam: naam.to_string(),
        c_mm: c,
        t_mm: t,
        psi: 1.0,
        k_sigma: k,
        lambda_p: lp,
        rho,
        b_c_mm: c,
        b_eff_mm: rho * c,
        uitkragend,
    }
}

/// Een inwendig plaatdeel (lijf) van `x_druk` (gedrukte rand) tot `x_ander`,
/// met de neutrale lijn op `x_na`; de spanning is evenredig met de afstand
/// tot de neutrale lijn. Geeft het plaatdeel en het gat (in coördinaat x).
fn lijf_met_gradient(naam: &str, x_druk: f64, x_ander: f64, x_na: f64, t: f64, eps: f64) -> (Plaatdeel, Option<Gat>) {
    let c = (x_druk - x_ander).abs();
    let s1 = x_druk - x_na;
    let s2 = x_ander - x_na;
    let psi = if s1.abs() > 0.0 { (s2 / s1).max(-3.0) } else { 1.0 };
    let k = k_sigma_inwendig(psi);
    let lp = lambda_p(c, t, eps, k);
    let rho = rho_inwendig(lp, psi);
    let richting = if x_ander < x_druk { -1.0 } else { 1.0 };
    let (b_c, b_eff, b_e1) = if psi < 0.0 {
        let b_c = c / (1.0 - psi);
        let b_eff = rho * b_c;
        (b_c, b_eff, 0.4 * b_eff)
    } else {
        let b_eff = rho * c;
        (c, b_eff, 2.0 * b_eff / (5.0 - psi))
    };
    let deel = Plaatdeel {
        naam: naam.to_string(),
        c_mm: c,
        t_mm: t,
        psi,
        k_sigma: k,
        lambda_p: lp,
        rho,
        b_c_mm: b_c,
        b_eff_mm: b_eff,
        uitkragend: false,
    };
    let lengte = b_c - b_eff;
    let gat = (lengte > 1e-9).then(|| Gat {
        a: lengte * t,
        x: x_druk + richting * (b_e1 + lengte / 2.0),
        i_eigen: t * lengte.powi(3) / 12.0,
    });
    (deel, gat)
}

/// De effectieve doorsnede volgens NEN-EN 1993-1-5 4.4, of `None` als een
/// maat ontbreekt.
pub fn effectieve_doorsnede(vorm: Klasse4Vorm, p: &SectionProperties, grade: &SteelGrade) -> Option<EffectieveDoorsnede> {
    let eps = epsilon(grade);
    let ok = |v: f64| v.is_finite() && v > 0.0;
    if !(ok(p.area_mm2) && ok(p.iy_mm4) && ok(p.iz_mm4) && ok(p.wel_y_mm3) && ok(p.wel_z_mm3)) {
        return None;
    }
    match vorm {
        Klasse4Vorm::I { h, b, tf, tw, r } => {
            if !(ok(h) && ok(b) && ok(tf) && ok(tw) && r >= 0.0) {
                return None;
            }
            let c_w = h - 2.0 * tf - 2.0 * r;
            let c_f = (b - tw - 2.0 * r) / 2.0;
            if !(ok(c_w) && ok(c_f)) {
                return None;
            }
            // ── A_eff: alles gelijkmatig gedrukt ────────────────────────────
            let lijf = gelijkmatig("lijf", c_w, tw, eps, false);
            let flens = gelijkmatig("flensuitkraging (4×)", c_f, tf, eps, true);
            let a_eff = p.area_mm2 - (1.0 - lijf.rho) * c_w * tw - 4.0 * (1.0 - flens.rho) * c_f * tf;

            // ── W_eff,y: bovenflens gedrukt, lijf met gradiënt ──────────────
            let mut gaten_y: Vec<Gat> = Vec::new();
            let flens_y = gelijkmatig("gedrukte flens, uitkraging (2×)", c_f, tf, eps, true);
            if flens_y.rho < 1.0 {
                let w = (1.0 - flens_y.rho) * c_f;
                for _ in 0..2 {
                    gaten_y.push(Gat { a: w * tf, x: h / 2.0 - tf / 2.0, i_eigen: w * tf.powi(3) / 12.0 });
                }
            }
            let (_, z_na, _) = zonder_gaten(p.area_mm2, p.iy_mm4, &gaten_y);
            let z_t = h / 2.0 - tf - r;
            let (lijf_y, gat) = lijf_met_gradient("lijf", z_t, -z_t, z_na, tw, eps);
            gaten_y.extend(gat);
            let w_eff_y = if gaten_y.is_empty() {
                p.wel_y_mm3
            } else {
                let (_, z_na, i_eff) = zonder_gaten(p.area_mm2, p.iy_mm4, &gaten_y);
                i_eff / (h / 2.0 - z_na).max(h / 2.0 + z_na)
            };

            // ── W_eff,z: de uitkragingen aan de gedrukte zijde ──────────────
            // Spanning nul in het lijf, grootst aan de vrije rand: ψ = y₀/(b/2)
            // op de brutodoorsnede (4.4(3)).
            let y0 = tw / 2.0 + r;
            let psi_z = y0 / (b / 2.0);
            let k_z = k_sigma_uitkragend(psi_z);
            let lp_z = lambda_p(c_f, tf, eps, k_z);
            let rho_z = rho_uitkragend(lp_z);
            let flens_z = Plaatdeel {
                naam: "flensuitkraging aan de gedrukte zijde (2×)".to_string(),
                c_mm: c_f,
                t_mm: tf,
                psi: psi_z,
                k_sigma: k_z,
                lambda_p: lp_z,
                rho: rho_z,
                b_c_mm: c_f,
                b_eff_mm: rho_z * c_f,
                uitkragend: true,
            };
            let w_eff_z = if rho_z >= 1.0 {
                p.wel_z_mm3
            } else {
                let w = (1.0 - rho_z) * c_f;
                let gat = Gat { a: w * tf, x: y0 + rho_z * c_f + w / 2.0, i_eigen: tf * w.powi(3) / 12.0 };
                let gaten = [gat, gat];
                let (_, y_na, i_eff) = zonder_gaten(p.area_mm2, p.iz_mm4, &gaten);
                let rand_druk = y0 + rho_z * c_f - y_na;
                let rand_trek = b / 2.0 + y_na;
                i_eff / rand_druk.max(rand_trek)
            };
            Some(maak(p, a_eff, w_eff_y, w_eff_z, vec![lijf, flens], vec![flens_y, lijf_y], vec![flens_z]))
        }
        Klasse4Vorm::Koker { h, b, t } => {
            if !(ok(h) && ok(b) && ok(t)) {
                return None;
            }
            let c_f = b - 3.0 * t;
            let c_w = h - 3.0 * t;
            if !(ok(c_f) && ok(c_w)) {
                return None;
            }
            let flens = gelijkmatig("flens (2×)", c_f, t, eps, false);
            let lijf = gelijkmatig("lijf (2×)", c_w, t, eps, false);
            let a_eff = p.area_mm2 - 2.0 * (1.0 - flens.rho) * c_f * t - 2.0 * (1.0 - lijf.rho) * c_w * t;

            // Buiging om een as: de gedrukte wand (breedte c_d) gelijkmatig, de
            // twee zijwanden (breedte c_z) met gradiënt.
            let buiging = |hoogte: f64, i: f64, w_el: f64, c_d: f64, c_z: f64, naam_d: &str, naam_z: &str| {
                let mut gaten: Vec<Gat> = Vec::new();
                let wand = gelijkmatig(naam_d, c_d, t, eps, false);
                if wand.rho < 1.0 {
                    let w = (1.0 - wand.rho) * c_d;
                    gaten.push(Gat { a: w * t, x: hoogte / 2.0 - t / 2.0, i_eigen: w * t.powi(3) / 12.0 });
                }
                let (_, x_na, _) = zonder_gaten(p.area_mm2, i, &gaten);
                let (zij, gat) = lijf_met_gradient(naam_z, c_z / 2.0, -c_z / 2.0, x_na, t, eps);
                if let Some(g) = gat {
                    gaten.push(g);
                    gaten.push(g);
                }
                let w_eff = if gaten.is_empty() {
                    w_el
                } else {
                    let (_, x_na, i_eff) = zonder_gaten(p.area_mm2, i, &gaten);
                    i_eff / (hoogte / 2.0 - x_na).max(hoogte / 2.0 + x_na)
                };
                (w_eff, vec![wand, zij])
            };
            let (w_eff_y, delen_y) =
                buiging(h, p.iy_mm4, p.wel_y_mm3, c_f, c_w, "gedrukte flens", "lijf (2×)");
            let (w_eff_z, delen_z) =
                buiging(b, p.iz_mm4, p.wel_z_mm3, c_w, c_f, "gedrukt lijf", "flens (2×)");
            Some(maak(p, a_eff, w_eff_y, w_eff_z, vec![flens, lijf], delen_y, delen_z))
        }
    }
}

fn maak(
    p: &SectionProperties,
    a_eff: f64,
    w_eff_y: f64,
    w_eff_z: f64,
    druk: Vec<Plaatdeel>,
    buiging_y: Vec<Plaatdeel>,
    buiging_z: Vec<Plaatdeel>,
) -> EffectieveDoorsnede {
    let a_eff = a_eff.min(p.area_mm2);
    let w_eff_y = w_eff_y.min(p.wel_y_mm3);
    let w_eff_z = w_eff_z.min(p.wel_z_mm3);
    let props = SectionProperties {
        area_mm2: a_eff,
        wel_y_mm3: w_eff_y,
        wel_z_mm3: w_eff_z,
        wel_y_top_mm3: w_eff_y,
        wel_y_bot_mm3: w_eff_y,
        wel_z_left_mm3: w_eff_z,
        wel_z_right_mm3: w_eff_z,
        ..*p
    };
    EffectieveDoorsnede {
        a_eff_mm2: a_eff,
        w_eff_y_mm3: w_eff_y,
        w_eff_z_mm3: w_eff_z,
        e_n_y_mm: 0.0,
        e_n_z_mm: 0.0,
        druk,
        buiging_y,
        buiging_z,
        props,
    }
}

/// Eén regel per plaatdeel, voor de kanttekeningen.
pub fn beschrijf(delen: &[Plaatdeel]) -> String {
    delen
        .iter()
        .map(|d| {
            format!(
                "{}: b̄ = {} mm, t = {} mm, ψ = {}, k_σ = {}, λ̄_p = {}, ρ = {}{}",
                d.naam,
                nl(d.c_mm, 1),
                nl(d.t_mm, 1),
                nl(d.psi, 3),
                nl(d.k_sigma, 3),
                nl(d.lambda_p, 3),
                nl(d.rho, 4),
                if d.rho < 1.0 {
                    format!(", b_eff = {} mm (van b_c = {} mm)", nl(d.b_eff_mm, 1), nl(d.b_c_mm, 1))
                } else {
                    " (volledig effectief)".to_string()
                }
            )
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// De afleiding van A_eff of W_eff als deelstappen: per plaatdeel λ̄_p en ρ,
/// en tot slot de effectieve grootheid zelf.
pub fn deelstappen(
    delen: &[Plaatdeel],
    grade: &SteelGrade,
    symbool: &str,
    titel: &str,
    waarde: f64,
    eenheid: &str,
    bruto: f64,
) -> Vec<Deelstap> {
    let eps = epsilon(grade);
    let mut uit: Vec<Deelstap> = delen
        .iter()
        .enumerate()
        .map(|(i, d)| {
            stap(
                &format!("plaatdeel_{i}"),
                &format!("Effectieve breedte — {}", d.naam),
                r"\rho",
                if d.uitkragend { "NEN-EN 1993-1-5 4.4(2) (4.3)" } else { "NEN-EN 1993-1-5 4.4(2) (4.2)" },
                if d.uitkragend {
                    r"\bar\lambda_p = \frac{\bar b/t}{28{,}4\,\varepsilon\sqrt{k_\sigma}}, \quad \rho = \frac{\bar\lambda_p - 0{,}188}{\bar\lambda_p^2} \le 1".to_string()
                } else {
                    r"\bar\lambda_p = \frac{\bar b/t}{28{,}4\,\varepsilon\sqrt{k_\sigma}}, \quad \rho = \frac{\bar\lambda_p - 0{,}055(3+\psi)}{\bar\lambda_p^2} \le 1".to_string()
                },
                format!(
                    r"\bar\lambda_p = \frac{{{}/{}}}{{28{{,}}4 \cdot {} \cdot \sqrt{{{}}}}} = {}",
                    lx(d.c_mm, 1),
                    lx(d.t_mm, 1),
                    lx(eps, 4),
                    lx(d.k_sigma, 3),
                    lx(d.lambda_p, 4)
                ),
                vec![
                    nv(r"\bar b", d.c_mm, "mm"),
                    nv("t", d.t_mm, "mm"),
                    nv(r"\psi", d.psi, "-"),
                    nv(r"k_\sigma", d.k_sigma, "-"),
                    nv(r"\bar\lambda_p", d.lambda_p, "-"),
                ],
                Some(d.rho),
                "-",
                vec![if d.rho < 1.0 {
                    format!(
                        "b_eff = ρ·b_c = {} · {} = {} mm.",
                        nl(d.rho, 4),
                        nl(d.b_c_mm, 1),
                        nl(d.b_eff_mm, 1)
                    )
                } else {
                    "ρ = 1: dit plaatdeel is volledig effectief.".to_string()
                }],
            )
        })
        .collect();
    uit.push(stap(
        "effectief",
        titel,
        symbool,
        "NEN-EN 1993-1-1 6.2.2.5, NEN-EN 1993-1-5 4.3",
        String::new(),
        String::new(),
        vec![nv("bruto", bruto, eenheid)],
        Some(waarde),
        eenheid,
        vec![format!(
            "{} = {} {} tegen bruto {} {} ({} %).",
            symbool,
            nl(waarde, 0),
            eenheid,
            nl(bruto, 0),
            eenheid,
            nl(100.0 * waarde / bruto, 1)
        )],
    ));
    uit
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    fn ipe300() -> SectionProperties {
        SectionProperties {
            area_mm2: 5381.0,
            iy_mm4: 83.56e6,
            iz_mm4: 6.038e6,
            wel_y_mm3: 557.1e3,
            wel_z_mm3: 80.5e3,
            wpl_y_mm3: 628.4e3,
            h_mm: 300.0,
            b_mm: 150.0,
            tw_mm: 7.1,
            tf_mm: 10.7,
            r_mm: 15.0,
            ..Default::default()
        }
    }

    /// Controle 2026-10, punt B7: IPE 300 S355 onder druk. Met de hand:
    /// ε = √(235/355) = 0,8136; lijf c = 300 − 2·10,7 − 2·15 = 248,6 mm,
    /// c/t = 35,01; k_σ = 4; λ̄_p = 35,01/(28,4·0,8136·2) = 0,7577 > 0,673;
    /// ρ = (0,7577 − 0,22)/0,7577² = 0,9366; A_eff = 5381 − 0,0634·248,6·7,1
    /// = 5269 mm². De flenzen (c/t = 5,28) blijven volledig effectief.
    #[test]
    fn ipe300_s355_a_eff() {
        let p = ipe300();
        let v = Klasse4Vorm::I { h: 300.0, b: 150.0, tf: 10.7, tw: 7.1, r: 15.0 };
        let e = effectieve_doorsnede(v, &p, &crate::S355).unwrap();
        assert_relative_eq!(e.druk[0].rho, 0.9366, max_relative = 2e-4);
        assert_relative_eq!(e.a_eff_mm2, 5269.0, max_relative = 2e-4);
        assert_eq!(e.druk[1].rho, 1.0);
        // Onder zuivere buiging is het lijf (k_σ = 23,9) volledig effectief:
        // W_eff,y = W_el,y; de flenzen ook, dus W_eff,z = W_el,z.
        assert_eq!(e.w_eff_y_mm3, p.wel_y_mm3);
        assert_eq!(e.w_eff_z_mm3, p.wel_z_mm3);
        assert_eq!(e.e_n_y_mm, 0.0);
        assert_eq!(e.props.area_mm2, e.a_eff_mm2);
        assert_eq!(e.props.iz_mm4, p.iz_mm4);
    }

    /// Tabel 4.1 en de grenzen van (4.2) en (4.3).
    #[test]
    fn k_sigma_en_rho() {
        assert_eq!(k_sigma_inwendig(1.0), 4.0);
        assert_relative_eq!(k_sigma_inwendig(0.0), 7.81);
        assert_relative_eq!(k_sigma_inwendig(-1.0), 23.9);
        assert_relative_eq!(k_sigma_inwendig(-0.5), 7.81 + 3.145 + 2.445, max_relative = 1e-12);
        assert_relative_eq!(k_sigma_uitkragend(1.0), 0.43);
        assert_relative_eq!(k_sigma_uitkragend(0.0), 0.57);
        assert_eq!(rho_inwendig(0.673, 1.0), 1.0);
        assert!(rho_inwendig(0.674, 1.0) < 1.0);
        assert_eq!(rho_uitkragend(0.748), 1.0);
        assert_relative_eq!(rho_uitkragend(1.0), 0.812, max_relative = 1e-12);
    }

    /// Een gelaste I met een slank lijf onder buiging: het gedrukte deel van
    /// het lijf plooit, de neutrale lijn zakt en W_eff,y < W_el,y. Lijf 800×6,
    /// flenzen 200×15 (S235): c/t = 133,3 > 124ε. Handmatig: ψ = −1 (geen
    /// flensverlies), k_σ = 23,9, λ̄_p = 133,33/(28,4·√23,9) = 0,9603, ρ =
    /// (0,9603 − 0,11)/0,9603² = 0,9221; b_c = 400, b_eff = 368,8 mm, gat
    /// 31,2 mm op 0,4·368,8 = 147,5 mm onder de bovenkant van het lijf.
    #[test]
    fn slank_lijf_onder_buiging() {
        let (h, b, tf, tw): (f64, f64, f64, f64) = (830.0, 200.0, 15.0, 6.0);
        let hw = h - 2.0 * tf;
        let a = 2.0 * b * tf + hw * tw;
        let iy = 2.0 * (b * tf.powi(3) / 12.0 + b * tf * ((h - tf) / 2.0).powi(2)) + tw * hw.powi(3) / 12.0;
        let iz = 2.0 * tf * b.powi(3) / 12.0 + hw * tw.powi(3) / 12.0;
        let p = SectionProperties {
            area_mm2: a,
            iy_mm4: iy,
            iz_mm4: iz,
            wel_y_mm3: iy / (h / 2.0),
            wel_z_mm3: iz / (b / 2.0),
            h_mm: h,
            b_mm: b,
            tw_mm: tw,
            tf_mm: tf,
            ..Default::default()
        };
        let e = effectieve_doorsnede(Klasse4Vorm::I { h, b, tf, tw, r: 0.0 }, &p, &crate::S235).unwrap();
        let lijf = &e.buiging_y[1];
        assert_relative_eq!(lijf.psi, -1.0, max_relative = 1e-12);
        assert_relative_eq!(lijf.k_sigma, 23.9);
        assert_relative_eq!(lijf.rho, 0.9221, max_relative = 2e-4);
        assert!(e.w_eff_y_mm3 < p.wel_y_mm3);
        // Met de hand: gat 31,17 × 6 mm, zwaartepunt op 400 − 147,5 − 15,6 =
        // 236,9 mm boven het midden.
        let b_eff = lijf.rho * 400.0;
        let gat_l = 400.0 - b_eff;
        let x = 400.0 - 0.4 * b_eff - gat_l / 2.0;
        let a_gat = gat_l * tw;
        let a_rest = a - a_gat;
        let z_na = -a_gat * x / a_rest;
        let i_eff = iy - (tw * gat_l.powi(3) / 12.0 + a_gat * x * x) - a_rest * z_na * z_na;
        assert_relative_eq!(e.w_eff_y_mm3, i_eff / (h / 2.0 - z_na).max(h / 2.0 + z_na), max_relative = 1e-12);
    }

    /// Een slanke koker onder druk: alle vier de wanden plooien.
    #[test]
    fn koker_onder_druk() {
        // 300×300×5, S355: c = 300 − 15 = 285, c/t = 57 > 42ε = 34,2.
        let (h, t) = (300.0, 5.0);
        let a = 4.0 * (h - t) * t;
        let p = SectionProperties {
            area_mm2: a,
            iy_mm4: 1.0e8,
            iz_mm4: 1.0e8,
            wel_y_mm3: 1.0e8 / 150.0,
            wel_z_mm3: 1.0e8 / 150.0,
            h_mm: h,
            b_mm: h,
            tw_mm: t,
            tf_mm: t,
            ..Default::default()
        };
        let e = effectieve_doorsnede(Klasse4Vorm::Koker { h, b: h, t }, &p, &crate::S355).unwrap();
        let eps = (235.0f64 / 355.0).sqrt();
        let lp = 57.0 / (28.4 * eps * 2.0);
        let rho = (lp - 0.22) / (lp * lp);
        assert_relative_eq!(e.a_eff_mm2, a - 4.0 * (1.0 - rho) * 285.0 * t, max_relative = 1e-12);
        assert!(e.w_eff_y_mm3 < p.wel_y_mm3);
    }
}
