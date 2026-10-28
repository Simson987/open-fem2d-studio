//! Karakteristieke waarde uit proefresultaten — NEN-EN 1990 bijlage D,
//! §D.7.2 (statistische bepaling van een enkele eigenschap).
//!
//! 5%-fractiel, variatiecoëfficiënt V_X ONBEKEND (de proeven zelf bepalen de
//! spreiding — bij natuursteen is er geen voorkennis die "V_X bekend"
//! rechtvaardigt):
//!
//! - normale verdeling (vgl. D.1): `X_k = m_X (1 − k_n V_X)` = `m_X − k_n s_X`;
//! - lognormale verdeling (vgl. D.2): `X_k = exp(m_Y − k_n s_Y)` met `Y = ln X`.
//!
//! `k_n` is tabel D.1 (V_X onbekend). Die tabel is de Bayesiaanse
//! voorspellingsgrens `k_n = t_{n−1; 0,95} · √(1 + 1/n)` (Student-t met
//! n − 1 vrijheidsgraden); hier wordt de formule uitgerekend, zodat ook een
//! aantal proeven tussen de tabelkolommen (n = 7, 9, 12, …) een eenduidige
//! waarde krijgt. De tabel heeft geen waarde voor n < 3; dan wordt geweigerd.
//! Voor n = 20 geeft de formule 1,77 waar de tabel 1,76 noemt (afronding in
//! de tabel); de formule is daar de veilige kant.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Minimumaantal proeven: tabel D.1 (V_X onbekend) begint bij n = 3.
pub const N_MIN: usize = 3;

/// Kansverdeling van de proefuitkomsten (§D.7.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
pub enum Verdeling {
    /// Normale verdeling (vgl. D.1).
    Normaal,
    /// Lognormale verdeling (vgl. D.2); gebruikelijk bij natuursteen
    /// (EN 1469 en EN 12372 werken op ln-waarden) en nooit een negatieve
    /// karakteristieke waarde.
    Lognormaal,
}

/// De statistische afleiding, voor rapport en controle.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
pub struct Statistiek {
    pub n: u32,
    pub verdeling: Verdeling,
    /// Gemiddelde `m_X` van de waarden zelf.
    pub gemiddelde: f64,
    /// Steekproefstandaardafwijking `s_X` (deler n − 1).
    pub standaardafwijking: f64,
    /// `V_X = s_X / m_X`.
    pub variatiecoefficient: f64,
    /// Bij lognormaal: `m_Y` en `s_Y` van `Y = ln X`.
    #[ts(optional)]
    pub gemiddelde_ln: Option<f64>,
    #[ts(optional)]
    pub standaardafwijking_ln: Option<f64>,
    /// `t_{n−1; 0,95}`.
    pub t_095: f64,
    /// `k_n = t_{n−1; 0,95} √(1 + 1/n)` (tabel D.1, V_X onbekend).
    pub k_n: f64,
    /// De karakteristieke waarde `X_k`.
    pub karakteristiek: f64,
}

/// ln Γ(x) voor x > 0 (Lanczos, g = 7, 9 coëfficiënten; relatieve fout < 1e-14).
fn ln_gamma(x: f64) -> f64 {
    const G: f64 = 7.0;
    const C: [f64; 9] = [
        0.999_999_999_999_809_9,
        676.520_368_121_885_1,
        -1_259.139_216_722_402_8,
        771.323_428_777_653_1,
        -176.615_029_162_140_6,
        12.507_343_278_686_905,
        -0.138_571_095_265_720_12,
        9.984_369_578_019_572e-6,
        1.505_632_735_149_311_6e-7,
    ];
    if x < 0.5 {
        // Reflectie.
        let pi = std::f64::consts::PI;
        return (pi / (pi * x).sin()).ln() - ln_gamma(1.0 - x);
    }
    let x = x - 1.0;
    let mut a = C[0];
    let t = x + G + 0.5;
    for (i, c) in C.iter().enumerate().skip(1) {
        a += c / (x + i as f64);
    }
    0.5 * (2.0 * std::f64::consts::PI).ln() + (x + 0.5) * t.ln() - t + a.ln()
}

/// Kettingbreuk van de onvolledige bètafunctie (modified Lentz).
fn beta_kettingbreuk(a: f64, b: f64, x: f64) -> f64 {
    const KLEIN: f64 = 1e-300;
    let qab = a + b;
    let qap = a + 1.0;
    let qam = a - 1.0;
    let mut c = 1.0;
    let mut d = 1.0 - qab * x / qap;
    if d.abs() < KLEIN {
        d = KLEIN;
    }
    d = 1.0 / d;
    let mut h = d;
    for m in 1..=300 {
        let m = m as f64;
        let m2 = 2.0 * m;
        let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1.0 + aa * d;
        if d.abs() < KLEIN {
            d = KLEIN;
        }
        c = 1.0 + aa / c;
        if c.abs() < KLEIN {
            c = KLEIN;
        }
        d = 1.0 / d;
        h *= d * c;
        let aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1.0 + aa * d;
        if d.abs() < KLEIN {
            d = KLEIN;
        }
        c = 1.0 + aa / c;
        if c.abs() < KLEIN {
            c = KLEIN;
        }
        d = 1.0 / d;
        let del = d * c;
        h *= del;
        if (del - 1.0).abs() < 1e-15 {
            break;
        }
    }
    h
}

/// Geregulariseerde onvolledige bètafunctie `I_x(a, b)`.
fn onvolledige_beta(a: f64, b: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let ln_bt = ln_gamma(a + b) - ln_gamma(a) - ln_gamma(b) + a * x.ln() + b * (1.0 - x).ln();
    let bt = ln_bt.exp();
    if x < (a + 1.0) / (a + b + 2.0) {
        bt * beta_kettingbreuk(a, b, x) / a
    } else {
        1.0 - bt * beta_kettingbreuk(b, a, 1.0 - x) / b
    }
}

/// Verdelingsfunctie van Student-t met `nu` vrijheidsgraden.
pub fn t_verdeling(t: f64, nu: f64) -> f64 {
    let staart = 0.5 * onvolledige_beta(0.5 * nu, 0.5, nu / (nu + t * t));
    if t >= 0.0 { 1.0 - staart } else { staart }
}

/// Kwantiel `t_{nu; p}` (p > 0,5), door bisectie op de verdelingsfunctie.
pub fn t_kwantiel(p: f64, nu: f64) -> f64 {
    let (mut lo, mut hi) = (0.0_f64, 1.0e3_f64);
    for _ in 0..200 {
        let mid = 0.5 * (lo + hi);
        if t_verdeling(mid, nu) < p {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    0.5 * (lo + hi)
}

/// `k_n` van tabel D.1 (5%-fractiel, V_X onbekend) voor n proeven.
pub fn k_n(n: usize) -> Result<(f64, f64), String> {
    if n < N_MIN {
        return Err(format!(
            "{n} proefresultaten: NEN-EN 1990 tabel D.1 (V_X onbekend) vraagt er minstens {N_MIN}"
        ));
    }
    let t = t_kwantiel(0.95, (n - 1) as f64);
    Ok((t, t * (1.0 + 1.0 / n as f64).sqrt()))
}

fn gemiddelde_en_sd(x: &[f64]) -> (f64, f64) {
    let n = x.len() as f64;
    let m = x.iter().sum::<f64>() / n;
    let s = (x.iter().map(|v| (v - m).powi(2)).sum::<f64>() / (n - 1.0)).sqrt();
    (m, s)
}

/// De karakteristieke waarde (5%-fractiel) uit losse proefresultaten.
pub fn karakteristieke_waarde(waarden: &[f64], verdeling: Verdeling) -> Result<Statistiek, String> {
    if let Some(v) = waarden.iter().find(|v| !(v.is_finite() && **v > 0.0)) {
        return Err(format!("proefresultaat {v} is geen eindig getal > 0"));
    }
    let n = waarden.len();
    let (t_095, kn) = k_n(n)?;
    let (m, s) = gemiddelde_en_sd(waarden);
    let (karakteristiek, m_ln, s_ln) = match verdeling {
        Verdeling::Normaal => (m - kn * s, None, None),
        Verdeling::Lognormaal => {
            let y: Vec<f64> = waarden.iter().map(|v| v.ln()).collect();
            let (my, sy) = gemiddelde_en_sd(&y);
            ((my - kn * sy).exp(), Some(my), Some(sy))
        }
    };
    if !(karakteristiek.is_finite() && karakteristiek > 0.0) {
        return Err(format!(
            "de karakteristieke waarde m − k_n·s = {m:.4} − {kn:.3}·{s:.4} = {karakteristiek:.4} is niet positief: \
             de spreiding is te groot voor een normale verdeling (kies lognormaal of meer proeven)"
        ));
    }
    Ok(Statistiek {
        n: n as u32,
        verdeling,
        gemiddelde: m,
        standaardafwijking: s,
        variatiecoefficient: s / m,
        gemiddelde_ln: m_ln,
        standaardafwijking_ln: s_ln,
        t_095,
        k_n: kn,
        karakteristiek,
    })
}
