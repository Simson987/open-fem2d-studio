//! Koudgevormde C-, Z- en U-profielen: hartlijngeometrie, plaatdelen,
//! afgeronde hoeken (§5.1) en maatgrenzen (§5.2).
//!
//! Maten zijn BUITENWERKS (`h`, `b`, `c`) met de KERNDIKTE `t` (zonder
//! zinklaag, §3.2.4(3)) en de binnenstraal `r` van de zetting. Alle zettingen
//! zijn 90°; de lippen staan loodrecht op de flens.
//!
//! Hartlijnmaten (fictieve vlakke breedten `b_p`, §5.1(3) en figuur 5.1,
//! gemeten tussen de snijpunten van de hartlijnen):
//! - lijf `h_p = h − t`;
//! - flens met lip (C, Z) `b_p = b − t`, zonder lip (U) `b_p = b − t/2`;
//! - lip `c_p = c − t/2`.
//!
//! Ligging: lijf op `y = 0` van `z = −h_p/2` tot `+h_p/2`. Bij een C en een U
//! wijzen beide flenzen naar `+y`; bij een Z wijst de bovenflens naar `+y` en de
//! onderflens naar `−y` (puntsymmetrisch). De lippen wijzen naar binnen
//! (naar de halve hoogte).

use crate::dunwandig::{Dunwandig, Strook};
use crate::materiaal::E_STAAL;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// De doorsnedevorm. Buiging om de y-as (evenwijdig aan de flenzen).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/koudgevormd/")]
#[serde(tag = "vorm")]
#[serde(deny_unknown_fields)]
pub enum KvDoorsnede {
    /// C-profiel (U met lippen): hoogte, flensbreedte, liplengte, kerndikte, binnenstraal.
    CProfiel { h_mm: f64, b_mm: f64, c_mm: f64, t_mm: f64, r_mm: f64 },
    /// Z-profiel met lippen, gelijke flenzen.
    ZProfiel { h_mm: f64, b_mm: f64, c_mm: f64, t_mm: f64, r_mm: f64 },
    /// U-profiel zonder lippen.
    UProfiel { h_mm: f64, b_mm: f64, t_mm: f64, r_mm: f64 },
}

/// Rol van een plaatdeel.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/koudgevormd/")]
pub enum Plaatrol {
    Lijf,
    FlensBoven,
    FlensOnder,
    LipBoven,
    LipOnder,
}

/// Een vlak plaatdeel op de hartlijn. De strook begint aan de GESTEUNDE rand
/// (flens: bij het lijf; lip: bij de flens; lijf: boven).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plaatdeel {
    pub rol: Plaatrol,
    pub strook: Strook,
    /// Fictieve vlakke breedte `b_p` (mm).
    pub b_p: f64,
}

impl KvDoorsnede {
    pub fn t(&self) -> f64 {
        match *self {
            Self::CProfiel { t_mm, .. } | Self::ZProfiel { t_mm, .. } | Self::UProfiel { t_mm, .. } => t_mm,
        }
    }
    pub fn r(&self) -> f64 {
        match *self {
            Self::CProfiel { r_mm, .. } | Self::ZProfiel { r_mm, .. } | Self::UProfiel { r_mm, .. } => r_mm,
        }
    }
    pub fn h(&self) -> f64 {
        match *self {
            Self::CProfiel { h_mm, .. } | Self::ZProfiel { h_mm, .. } | Self::UProfiel { h_mm, .. } => h_mm,
        }
    }
    pub fn b(&self) -> f64 {
        match *self {
            Self::CProfiel { b_mm, .. } | Self::ZProfiel { b_mm, .. } | Self::UProfiel { b_mm, .. } => b_mm,
        }
    }
    /// Liplengte (buitenwerks); 0 bij een U.
    pub fn c(&self) -> f64 {
        match *self {
            Self::CProfiel { c_mm, .. } | Self::ZProfiel { c_mm, .. } => c_mm,
            Self::UProfiel { .. } => 0.0,
        }
    }
    pub fn heeft_lippen(&self) -> bool {
        !matches!(self, Self::UProfiel { .. })
    }
    pub fn is_z(&self) -> bool {
        matches!(self, Self::ZProfiel { .. })
    }

    pub fn omschrijving(&self) -> String {
        match *self {
            Self::CProfiel { h_mm, b_mm, c_mm, t_mm, r_mm } => format!("C {h_mm}×{b_mm}×{c_mm}×{t_mm} r{r_mm}"),
            Self::ZProfiel { h_mm, b_mm, c_mm, t_mm, r_mm } => format!("Z {h_mm}×{b_mm}×{c_mm}×{t_mm} r{r_mm}"),
            Self::UProfiel { h_mm, b_mm, t_mm, r_mm } => format!("U {h_mm}×{b_mm}×{t_mm} r{r_mm}"),
        }
    }

    pub fn valideer(&self) -> Result<(), String> {
        let pos = |v: f64| v.is_finite() && v > 0.0;
        let (h, b, c, t, r) = (self.h(), self.b(), self.c(), self.t(), self.r());
        if !(pos(h) && pos(b) && pos(t)) || !(r.is_finite() && r >= 0.0) || !(c.is_finite() && c >= 0.0) {
            return Err("maten moeten positief zijn (r ≥ 0)".into());
        }
        if self.heeft_lippen() && !pos(c) {
            return Err("een C- of Z-profiel heeft lippen: c > 0 (een profiel zonder lippen is een U)".into());
        }
        if h <= 2.0 * t + 2.0 * r || b <= t + r {
            return Err("h > 2(t + r) en b > t + r vereist".into());
        }
        if self.heeft_lippen() && (c <= t / 2.0 + r || c >= h / 2.0) {
            return Err("lip: t/2 + r < c < h/2 vereist".into());
        }
        Ok(())
    }

    /// Hartlijnmaten `(h_p, b_p, c_p)`.
    pub fn hartlijn(&self) -> (f64, f64, f64) {
        let t = self.t();
        let hp = self.h() - t;
        if self.heeft_lippen() {
            (hp, self.b() - t, self.c() - t / 2.0)
        } else {
            (hp, self.b() - t / 2.0, 0.0)
        }
    }

    /// Richting van de onderflens: +1 (C, U) of −1 (Z).
    fn s_onder(&self) -> f64 {
        if self.is_z() { -1.0 } else { 1.0 }
    }

    /// De plaatdelen, elk vanaf de gesteunde rand.
    pub fn delen(&self) -> Vec<Plaatdeel> {
        let t = self.t();
        let (hp, bp, cp) = self.hartlijn();
        let so = self.s_onder();
        let z = hp / 2.0;
        let mut v = vec![
            Plaatdeel { rol: Plaatrol::Lijf, strook: Strook { y0: 0.0, z0: z, y1: 0.0, z1: -z, t }, b_p: hp },
            Plaatdeel { rol: Plaatrol::FlensBoven, strook: Strook { y0: 0.0, z0: z, y1: bp, z1: z, t }, b_p: bp },
            Plaatdeel { rol: Plaatrol::FlensOnder, strook: Strook { y0: 0.0, z0: -z, y1: so * bp, z1: -z, t }, b_p: bp },
        ];
        if self.heeft_lippen() {
            v.push(Plaatdeel { rol: Plaatrol::LipBoven, strook: Strook { y0: bp, z0: z, y1: bp, z1: z - cp, t }, b_p: cp });
            v.push(Plaatdeel {
                rol: Plaatrol::LipOnder,
                strook: Strook { y0: so * bp, z0: -z, y1: so * bp, z1: -z + cp, t },
                b_p: cp,
            });
        }
        v
    }

    /// De bruto doorsnede als aaneengesloten hartlijn (voor het
    /// dwarskrachtcentrum en `I_w`), met scherpe hoeken.
    pub fn hartlijn_bruto(&self) -> Dunwandig {
        let t = self.t();
        let (hp, bp, cp) = self.hartlijn();
        let so = self.s_onder();
        let z = hp / 2.0;
        let mut p: Vec<(f64, f64)> = Vec::new();
        if self.heeft_lippen() {
            p.push((so * bp, -z + cp));
        }
        p.push((so * bp, -z));
        p.push((0.0, -z));
        p.push((0.0, z));
        p.push((bp, z));
        if self.heeft_lippen() {
            p.push((bp, z - cp));
        }
        Dunwandig {
            stroken: p.windows(2).map(|w| Strook { y0: w[0].0, z0: w[0].1, y1: w[1].0, z1: w[1].1, t }).collect(),
        }
    }

    /// Aantal zettingen van 90° (voor `δ` en voor `n` in formule (3.1)).
    pub fn aantal_zettingen(&self) -> f64 {
        if self.heeft_lippen() { 4.0 } else { 2.0 }
    }

    /// Mag de invloed van de afgeronde hoeken verwaarloosd worden? §5.1(3):
    /// `r ≤ 5t` en `r ≤ 0,10 b_p` voor elk aansluitend vlak deel.
    pub fn hoeken_verwaarloosbaar(&self) -> bool {
        let r = self.r();
        let bp_min = self.delen().iter().map(|d| d.b_p).fold(f64::INFINITY, f64::min);
        r <= 5.0 * self.t() && r <= 0.10 * bp_min
    }

    /// `δ` van §5.1(4), formule (5.1d): `δ = 0,43 Σ r_j φ_j/90° / Σ b_p,i`;
    /// 0 als de hoeken volgens §5.1(3) verwaarloosd mogen worden.
    pub fn delta(&self) -> f64 {
        if self.hoeken_verwaarloosbaar() {
            return 0.0;
        }
        let som_bp: f64 = self.delen().iter().map(|d| d.b_p).sum();
        0.43 * self.aantal_zettingen() * self.r() / som_bp
    }

    /// Overschrijdingen van de maatgrenzen waarbinnen de rekenregels gelden.
    /// Niet leeg ⇒ de doorsnede valt buiten deel 1-3 (berekening door proeven,
    /// §5.2(1)); de toets geeft dan geen "voldoet".
    pub fn buiten_maatgrenzen(&self, f_yb: f64) -> Vec<String> {
        let (h, b, c, t, r) = (self.h(), self.b(), self.c(), self.t(), self.r());
        let mut v = Vec::new();
        // Tabel 5.1
        if self.heeft_lippen() {
            if b / t > 60.0 {
                v.push(format!("b/t = {:.1} > 60 (tabel 5.1, flens met lip)", b / t));
            }
            if c / t > 50.0 {
                v.push(format!("c/t = {:.1} > 50 (tabel 5.1, lip)", c / t));
            }
            // §5.2(2): 0,2 ≤ c/b ≤ 0,6. Onder 0,2 wordt de lip genegeerd (§5.2(3)),
            // dat is geen overschrijding.
            if c / b > 0.6 {
                v.push(format!("c/b = {:.3} > 0,6 (§5.2(2)): de lip valt buiten de regels van §5.5.3", c / b));
            }
        } else if b / t > 50.0 {
            v.push(format!("b/t = {:.1} > 50 (tabel 5.1, onverstijfde flens)", b / t));
        }
        if h / t > 500.0 {
            v.push(format!("h/t = {:.1} > 500 (tabel 5.1, lijf)", h / t));
        }
        // §5.1(6): bij een grote binnenstraal is de weerstand door proeven te bepalen.
        let r_max = 0.04 * t * E_STAAL / f_yb;
        if r > r_max {
            v.push(format!("r = {r} mm > 0,04 t E / f_yb = {r_max:.1} mm (§5.1(6))"));
        }
        // §3.2.4(1)
        if !(crate::materiaal::T_COR_MIN..=crate::materiaal::T_COR_MAX).contains(&t) {
            v.push(format!("kerndikte t = {t} mm buiten 0,45 … 15 mm (§3.2.4(1))"));
        }
        v
    }

    /// Doet de lip mee als randverstijver? §5.2(3): bij `c/b < 0,2` niet.
    pub fn lip_verstijft(&self) -> bool {
        self.heeft_lippen() && self.c() / self.b() >= 0.2
    }
}
