//! Dunwandige doorsnede als stelsel van rechte stroken op de hartlijn.
//!
//! EN 1993-1-3 §5.1(3): bij `r ≤ 5t` en `r ≤ 0,10 b_p` mag de doorsnede worden
//! opgevat als vlakke delen met scherpe hoeken, met de fictieve vlakke breedte
//! `b_p` gemeten tussen de snijpunten van de hartlijnen. Dit model rekent
//! precies dat: elke strook is een lijnstuk op de hartlijn met dikte `t`; de
//! termen van orde `t³` (eigen traagheid van een strook dwars op haar richting)
//! worden verwaarloosd, behalve in `I_t = Σ b t³ / 3`.
//!
//! Assenstelsel: `y` horizontaal, `z` verticaal (de hoogte van het profiel),
//! mm. `I_y = ∫ z² dA` (buiging om de y-as, de sterke as van een C), `I_z = ∫ y² dA`.

/// Eén rechte strook van `(y0, z0)` naar `(y1, z1)` met dikte `t`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Strook {
    pub y0: f64,
    pub z0: f64,
    pub y1: f64,
    pub z1: f64,
    pub t: f64,
}

impl Strook {
    pub fn lengte(&self) -> f64 {
        ((self.y1 - self.y0).powi(2) + (self.z1 - self.z0).powi(2)).sqrt()
    }
    pub fn oppervlak(&self) -> f64 {
        self.lengte() * self.t
    }
    /// Het deel van deze strook tussen de fracties `a` en `b` (0 ≤ a < b ≤ 1).
    pub fn deel(&self, a: f64, b: f64, t: f64) -> Strook {
        let p = |s: f64| (self.y0 + s * (self.y1 - self.y0), self.z0 + s * (self.z1 - self.z0));
        let (y0, z0) = p(a);
        let (y1, z1) = p(b);
        Strook { y0, z0, y1, z1, t }
    }
}

/// `∫ f g dA` over een strook voor lineair verlopende `f` en `g`.
fn int_fg(s: &Strook, f0: f64, f1: f64, g0: f64, g1: f64) -> f64 {
    s.oppervlak() * ((f0 * g0 + f1 * g1) / 3.0 + (f0 * g1 + f1 * g0) / 6.0)
}

/// Oppervlak, zwaartepunt en traagheden om het zwaartepunt.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Grootheden {
    pub a: f64,
    pub y_c: f64,
    pub z_c: f64,
    /// `∫ (z − z_c)² dA`
    pub i_y: f64,
    /// `∫ (y − y_c)² dA`
    pub i_z: f64,
    /// `∫ (y − y_c)(z − z_c) dA`
    pub i_yz: f64,
}

impl Grootheden {
    /// Hoofdtraagheden `(I_u, I_v)` met `I_u ≥ I_v`, en de hoek (rad) van de
    /// u-as ten opzichte van de y-as.
    pub fn hoofdassen(&self) -> (f64, f64, f64) {
        let m = 0.5 * (self.i_y + self.i_z);
        let r = (0.25 * (self.i_y - self.i_z).powi(2) + self.i_yz.powi(2)).sqrt();
        let hoek = 0.5 * (-2.0 * self.i_yz).atan2(self.i_y - self.i_z);
        (m + r, m - r, hoek)
    }
}

/// Een doorsnede als lijst stroken.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Dunwandig {
    pub stroken: Vec<Strook>,
}

impl Dunwandig {
    pub fn grootheden(&self) -> Grootheden {
        let mut a = 0.0;
        let mut sy = 0.0;
        let mut sz = 0.0;
        for s in &self.stroken {
            let da = s.oppervlak();
            a += da;
            sy += da * 0.5 * (s.y0 + s.y1);
            sz += da * 0.5 * (s.z0 + s.z1);
        }
        let (y_c, z_c) = if a > 0.0 { (sy / a, sz / a) } else { (0.0, 0.0) };
        let (mut i_y, mut i_z, mut i_yz) = (0.0, 0.0, 0.0);
        for s in &self.stroken {
            let (y0, y1, z0, z1) = (s.y0 - y_c, s.y1 - y_c, s.z0 - z_c, s.z1 - z_c);
            i_y += int_fg(s, z0, z1, z0, z1);
            i_z += int_fg(s, y0, y1, y0, y1);
            i_yz += int_fg(s, y0, y1, z0, z1);
        }
        Grootheden { a, y_c, z_c, i_y, i_z, i_yz }
    }

    /// Torsietraagheid van Saint-Venant voor een open doorsnede, `Σ b t³ / 3`.
    pub fn i_t(&self) -> f64 {
        self.stroken.iter().map(|s| s.lengte() * s.t.powi(3) / 3.0).sum()
    }

    /// Dwarskrachtcentrum `(y_s, z_s)` en welvingstraagheid `I_w` van een OPEN
    /// doorsnede zonder vertakkingen: de stroken moeten aaneensluiten (eind van
    /// strook i = begin van strook i+1).
    ///
    /// Sectoriële coördinaat `ω_P(s) = ∫ (r − P) × dr`. Het dwarskrachtcentrum is
    /// de pool `P` waarvoor `∫ ω_P y dA = ∫ ω_P z dA = 0` (y, z ten opzichte van
    /// het zwaartepunt); met `ω_P = ω_0 − y_P z + z_P y + c` geeft dat twee
    /// lineaire vergelijkingen. Daarna `ω` genormeerd (`∫ ω dA = 0`) en
    /// `I_w = ∫ ω² dA`.
    pub fn dwarskrachtcentrum_en_welving(&self) -> Option<(f64, f64, f64)> {
        for w in self.stroken.windows(2) {
            if (w[0].y1 - w[1].y0).abs() > 1e-9 || (w[0].z1 - w[1].z0).abs() > 1e-9 {
                return None;
            }
        }
        let g = self.grootheden();
        let rel = |y: f64, z: f64| (y - g.y_c, z - g.z_c);
        // ω_0 met pool in het zwaartepunt.
        let mut omega0 = Vec::with_capacity(self.stroken.len() + 1);
        let mut w = 0.0;
        omega0.push(w);
        for s in &self.stroken {
            let (ya, za) = rel(s.y0, s.z0);
            let (yb, zb) = rel(s.y1, s.z1);
            w += ya * zb - yb * za;
            omega0.push(w);
        }
        let (mut i_wy, mut i_wz) = (0.0, 0.0);
        for (k, s) in self.stroken.iter().enumerate() {
            let (ya, za) = rel(s.y0, s.z0);
            let (yb, zb) = rel(s.y1, s.z1);
            i_wy += int_fg(s, omega0[k], omega0[k + 1], ya, yb);
            i_wz += int_fg(s, omega0[k], omega0[k + 1], za, zb);
        }
        // I_ωy − y_P I_yz + z_P I_zz = 0 ;  I_ωz − y_P I_yy + z_P I_yz = 0
        // (I_zz = ∫y² = g.i_z, I_yy = ∫z² = g.i_y)
        let det = -g.i_yz * g.i_yz + g.i_z * g.i_y;
        if det.abs() < 1e-12 {
            return None;
        }
        // [ −I_yz  I_zz ] [y_P]   [ −I_ωy ]
        // [ −I_yy  I_yz ] [z_P] = [ −I_ωz ]
        let y_p = ((-i_wy) * g.i_yz - g.i_z * (-i_wz)) / det;
        let z_p = ((-g.i_yz) * (-i_wz) - (-g.i_y) * (-i_wy)) / det;
        // ω ten opzichte van het dwarskrachtcentrum (relatief, zonder constante)
        let omega_s: Vec<f64> = {
            let mut uit = Vec::with_capacity(omega0.len());
            let mut pts = vec![rel(self.stroken[0].y0, self.stroken[0].z0)];
            for s in &self.stroken {
                pts.push(rel(s.y1, s.z1));
            }
            for (k, (y, z)) in pts.iter().enumerate() {
                uit.push(omega0[k] - y_p * z + z_p * y);
            }
            uit
        };
        let mut sw = 0.0;
        for (k, s) in self.stroken.iter().enumerate() {
            sw += s.oppervlak() * 0.5 * (omega_s[k] + omega_s[k + 1]);
        }
        let gem = sw / g.a;
        let mut i_w = 0.0;
        for (k, s) in self.stroken.iter().enumerate() {
            let (a, b) = (omega_s[k] - gem, omega_s[k + 1] - gem);
            i_w += int_fg(s, a, b, a, b);
        }
        Some((y_p + g.y_c, z_p + g.z_c, i_w))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Open U (kanaal) met gelijke dikte: hartlijnhoogte h, flens b, dikte t.
    fn kanaal(h: f64, b: f64, t: f64) -> Dunwandig {
        let p = [(b, -h / 2.0), (0.0, -h / 2.0), (0.0, h / 2.0), (b, h / 2.0)];
        Dunwandig {
            stroken: p.windows(2).map(|w| Strook { y0: w[0].0, z0: w[0].1, y1: w[1].0, z1: w[1].1, t }).collect(),
        }
    }

    #[test]
    fn kanaal_dwarskrachtcentrum_en_welving_volgens_de_gesloten_formule() {
        // e = 3b²/(6b + h) vanaf de lijfhartlijn, aan de kant ZONDER flenzen;
        // I_w = t h² b³ (3b + 2h) / (12 (6b + h)).
        let (h, b, t) = (200.0, 80.0, 2.0);
        let d = kanaal(h, b, t);
        let (ys, zs, iw) = d.dwarskrachtcentrum_en_welving().unwrap();
        let e = 3.0 * b * b / (6.0 * b + h);
        assert!((ys + e).abs() < 1e-9, "y_s = {ys}, verwacht {}", -e);
        assert!(zs.abs() < 1e-9);
        let iw_hand = t * h * h * b.powi(3) * (3.0 * b + 2.0 * h) / (12.0 * (6.0 * b + h));
        assert!((iw / iw_hand - 1.0).abs() < 1e-12, "{iw} vs {iw_hand}");
    }

    #[test]
    fn hoofdassen_van_een_symmetrische_doorsnede_zijn_y_en_z() {
        let g = kanaal(200.0, 80.0, 2.0).grootheden();
        let (iu, iv, hoek) = g.hoofdassen();
        assert!((iu - g.i_y).abs() < 1e-6 && (iv - g.i_z).abs() < 1e-6 && hoek.abs() < 1e-12);
    }
}
