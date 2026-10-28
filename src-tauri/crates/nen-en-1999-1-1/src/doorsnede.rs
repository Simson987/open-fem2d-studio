//! Gangbare extrusiedoorsneden als stelsel van rechthoekige platen.
//!
//! De doorsnede wordt ZONDER afrondingsstralen gemodelleerd. Gevolgen, beide
//! aan de veilige kant: de vlakke breedte `b` van een deel (§6.1.4.3) is de
//! volle maat tussen de platen en dus niet kleiner dan in werkelijkheid, en een
//! I-profiel mist het materiaal van de hoekafrondingen (kleinere A, I, W).
//!
//! Lokale plooi en HAZ verlagen de DIKTE van een plaat (§6.1.5(1), §6.1.6.2);
//! de plaat blijft op haar hartlijn liggen. Bij een flens wordt de factor van
//! het uitstekende (I) of inwendige (koker) deel over de VOLLE flensbreedte
//! toegepast, ook over het stuk boven het lijf — een kleine vereenvoudiging
//! aan de veilige kant.

use crate::klasse::Deelsoort;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// De doorsnedevorm. Buiging om de sterke as (y); de hoogte `h` staat langs z.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/aluminium/")]
#[serde(tag = "vorm")]
#[serde(deny_unknown_fields)]
pub enum AluDoorsnede {
    /// Dubbelsymmetrisch I-profiel: hoogte, flensbreedte, lijf- en flensdikte.
    IProfiel { h_mm: f64, b_mm: f64, tw_mm: f64, tf_mm: f64 },
    /// Rechthoekige koker met overal dezelfde wanddikte.
    Koker { h_mm: f64, b_mm: f64, t_mm: f64 },
    /// Massieve rechthoek b × h (strip of staf).
    Rechthoek { b_mm: f64, h_mm: f64 },
}

/// Rol van een deel in de doorsnede.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/aluminium/")]
pub enum Deelrol {
    Flens,
    Lijf,
}

/// Een plaatdeel voor de klassering.
#[derive(Clone, Debug, PartialEq)]
pub struct Deel {
    pub naam: &'static str,
    pub rol: Deelrol,
    pub soort: Deelsoort,
    /// Vlakke breedte b (mm).
    pub b: f64,
    /// Dikte t (mm).
    pub t: f64,
}

/// Dikte-factoren per deel: lokale plooi en/of HAZ. 1 = volle dikte.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Factoren {
    pub flens_druk: f64,
    pub flens_trek: f64,
    pub lijf_druk: f64,
    pub lijf_trek: f64,
}

impl Factoren {
    pub fn uniform(f: f64) -> Self {
        Self { flens_druk: f, flens_trek: f, lijf_druk: f, lijf_trek: f }
    }
}

/// Oppervlak, zwaartepunt en traagheid van een (eventueel gereduceerde)
/// doorsnede om de y-as.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Buigeigenschappen {
    pub a: f64,
    /// Zwaartepunt, gemeten vanaf de onderkant (mm). Onder = trekzijde.
    pub z_c: f64,
    pub i_y: f64,
    /// Kleinste elastisch weerstandsmoment `I / max(z_c, h − z_c)`.
    pub w: f64,
}

struct Rect {
    breed: f64,
    hoog: f64,
    z_mid: f64,
}

impl AluDoorsnede {
    pub fn hoogte(&self) -> f64 {
        match *self {
            Self::IProfiel { h_mm, .. } | Self::Koker { h_mm, .. } | Self::Rechthoek { h_mm, .. } => h_mm,
        }
    }

    /// Grootste plaatdikte — bepaalt de rij in tabel 3.2b. Voor een massieve
    /// rechthoek de kleinste zijde (de dikte van de staf).
    pub fn t_max(&self) -> f64 {
        match *self {
            Self::IProfiel { tw_mm, tf_mm, .. } => tw_mm.max(tf_mm),
            Self::Koker { t_mm, .. } => t_mm,
            Self::Rechthoek { b_mm, h_mm } => b_mm.min(h_mm),
        }
    }

    pub fn omschrijving(&self) -> String {
        match *self {
            Self::IProfiel { h_mm, b_mm, tw_mm, tf_mm } => {
                format!("I {h_mm}×{b_mm}×{tw_mm}×{tf_mm}")
            }
            Self::Koker { h_mm, b_mm, t_mm } => format!("koker {h_mm}×{b_mm}×{t_mm}"),
            Self::Rechthoek { b_mm, h_mm } => format!("rechthoek {b_mm}×{h_mm}"),
        }
    }

    pub fn valideer(&self) -> Result<(), String> {
        let pos = |v: f64| v.is_finite() && v > 0.0;
        match *self {
            Self::IProfiel { h_mm, b_mm, tw_mm, tf_mm } => {
                if ![h_mm, b_mm, tw_mm, tf_mm].iter().all(|v| pos(*v)) {
                    return Err("I-profiel: alle maten moeten positief zijn".into());
                }
                if h_mm <= 2.0 * tf_mm || b_mm <= tw_mm {
                    return Err("I-profiel: h > 2·t_f en b > t_w vereist".into());
                }
            }
            Self::Koker { h_mm, b_mm, t_mm } => {
                if ![h_mm, b_mm, t_mm].iter().all(|v| pos(*v)) {
                    return Err("koker: alle maten moeten positief zijn".into());
                }
                if h_mm <= 2.0 * t_mm || b_mm <= 2.0 * t_mm {
                    return Err("koker: h en b moeten groter zijn dan 2·t".into());
                }
            }
            Self::Rechthoek { b_mm, h_mm } => {
                if !(pos(b_mm) && pos(h_mm)) {
                    return Err("rechthoek: b en h moeten positief zijn".into());
                }
            }
        }
        Ok(())
    }

    /// Lijfhoogte tussen de flenzen `h_w` en de totale lijfdikte `Σt_w`.
    /// `None` voor een massieve doorsnede.
    pub fn lijf(&self) -> Option<(f64, f64)> {
        match *self {
            Self::IProfiel { h_mm, tw_mm, tf_mm, .. } => Some((h_mm - 2.0 * tf_mm, tw_mm)),
            Self::Koker { h_mm, t_mm, .. } => Some((h_mm - 2.0 * t_mm, 2.0 * t_mm)),
            Self::Rechthoek { .. } => None,
        }
    }

    /// De plaatdelen die geklasseerd worden (§6.1.4). Een massieve rechthoek
    /// heeft er geen: daar is geen dunwandige plaat die plaatselijk plooit.
    pub fn delen(&self) -> Vec<Deel> {
        match *self {
            Self::IProfiel { h_mm, b_mm, tw_mm, tf_mm } => vec![
                Deel {
                    naam: "flens",
                    rol: Deelrol::Flens,
                    soort: Deelsoort::Uitstekend,
                    b: (b_mm - tw_mm) / 2.0,
                    t: tf_mm,
                },
                Deel {
                    naam: "lijf",
                    rol: Deelrol::Lijf,
                    soort: Deelsoort::Inwendig,
                    b: h_mm - 2.0 * tf_mm,
                    t: tw_mm,
                },
            ],
            Self::Koker { h_mm, b_mm, t_mm } => vec![
                Deel {
                    naam: "flens",
                    rol: Deelrol::Flens,
                    soort: Deelsoort::Inwendig,
                    b: b_mm - 2.0 * t_mm,
                    t: t_mm,
                },
                Deel {
                    naam: "lijf",
                    rol: Deelrol::Lijf,
                    soort: Deelsoort::Inwendig,
                    b: h_mm - 2.0 * t_mm,
                    t: t_mm,
                },
            ],
            Self::Rechthoek { .. } => Vec::new(),
        }
    }

    /// De platen met hun dikte-factoren. Buiging met druk BOVEN; het lijf is
    /// op halve hoogte gesplitst in een druk- en een trekhelft.
    fn platen(&self, f: Factoren) -> Vec<Rect> {
        match *self {
            Self::IProfiel { h_mm, b_mm, tw_mm, tf_mm } => {
                let hw = h_mm - 2.0 * tf_mm;
                vec![
                    Rect { breed: b_mm, hoog: tf_mm * f.flens_druk, z_mid: h_mm - tf_mm / 2.0 },
                    Rect { breed: b_mm, hoog: tf_mm * f.flens_trek, z_mid: tf_mm / 2.0 },
                    Rect { breed: tw_mm * f.lijf_druk, hoog: hw / 2.0, z_mid: h_mm / 2.0 + hw / 4.0 },
                    Rect { breed: tw_mm * f.lijf_trek, hoog: hw / 2.0, z_mid: h_mm / 2.0 - hw / 4.0 },
                ]
            }
            Self::Koker { h_mm, b_mm, t_mm } => {
                let hw = h_mm - 2.0 * t_mm;
                vec![
                    Rect { breed: b_mm, hoog: t_mm * f.flens_druk, z_mid: h_mm - t_mm / 2.0 },
                    Rect { breed: b_mm, hoog: t_mm * f.flens_trek, z_mid: t_mm / 2.0 },
                    Rect { breed: 2.0 * t_mm * f.lijf_druk, hoog: hw / 2.0, z_mid: h_mm / 2.0 + hw / 4.0 },
                    Rect { breed: 2.0 * t_mm * f.lijf_trek, hoog: hw / 2.0, z_mid: h_mm / 2.0 - hw / 4.0 },
                ]
            }
            Self::Rechthoek { b_mm, h_mm } => vec![
                Rect { breed: b_mm * f.lijf_druk, hoog: h_mm / 2.0, z_mid: 3.0 * h_mm / 4.0 },
                Rect { breed: b_mm * f.lijf_trek, hoog: h_mm / 2.0, z_mid: h_mm / 4.0 },
            ],
        }
    }

    /// A, z_c, I_y en W_min van de doorsnede met deze dikte-factoren.
    pub fn buigeigenschappen(&self, f: Factoren) -> Buigeigenschappen {
        let platen = self.platen(f);
        let a: f64 = platen.iter().map(|r| r.breed * r.hoog).sum();
        let s: f64 = platen.iter().map(|r| r.breed * r.hoog * r.z_mid).sum();
        let z_c = s / a;
        let i_y: f64 = platen
            .iter()
            .map(|r| r.breed * r.hoog.powi(3) / 12.0 + r.breed * r.hoog * (r.z_mid - z_c).powi(2))
            .sum();
        let h = self.hoogte();
        Buigeigenschappen { a, z_c, i_y, w: i_y / z_c.max(h - z_c) }
    }

    /// Oppervlak met per deel een (uniforme) dikte-factor, voor `A_eff` onder
    /// centrische druk.
    pub fn oppervlak(&self, f_flens: f64, f_lijf: f64) -> f64 {
        self.buigeigenschappen(Factoren {
            flens_druk: f_flens,
            flens_trek: f_flens,
            lijf_druk: f_lijf,
            lijf_trek: f_lijf,
        })
        .a
    }

    /// Traagheidsmoment om de zwakke as (bruto).
    pub fn i_z(&self) -> f64 {
        match *self {
            Self::IProfiel { h_mm, b_mm, tw_mm, tf_mm } => {
                2.0 * tf_mm * b_mm.powi(3) / 12.0 + (h_mm - 2.0 * tf_mm) * tw_mm.powi(3) / 12.0
            }
            Self::Koker { h_mm, b_mm, t_mm } => {
                let hw = h_mm - 2.0 * t_mm;
                2.0 * t_mm * b_mm.powi(3) / 12.0
                    + 2.0 * (hw * t_mm.powi(3) / 12.0 + hw * t_mm * ((b_mm - t_mm) / 2.0).powi(2))
            }
            Self::Rechthoek { b_mm, h_mm } => h_mm * b_mm.powi(3) / 12.0,
        }
    }

    /// Plastisch weerstandsmoment om de sterke as (bruto), en het deel
    /// daarvan dat van het lijf komt (voor de reductie door dwarskracht).
    pub fn w_pl_y(&self) -> (f64, f64) {
        match *self {
            Self::IProfiel { h_mm, b_mm, tw_mm, tf_mm } => {
                let hw = h_mm - 2.0 * tf_mm;
                let lijf = tw_mm * hw * hw / 4.0;
                (b_mm * tf_mm * (h_mm - tf_mm) + lijf, lijf)
            }
            Self::Koker { h_mm, b_mm, t_mm } => {
                let hw = h_mm - 2.0 * t_mm;
                let lijf = 2.0 * t_mm * hw * hw / 4.0;
                (b_mm * t_mm * (h_mm - t_mm) + lijf, lijf)
            }
            Self::Rechthoek { b_mm, h_mm } => {
                let w = b_mm * h_mm * h_mm / 4.0;
                (w, w)
            }
        }
    }

    /// Elastisch weerstandsmoment van alleen het lijf, `I_lijf / (h/2)`.
    pub fn w_el_lijf(&self) -> f64 {
        let h = self.hoogte();
        match self.lijf() {
            Some((hw, tw)) => tw * hw.powi(3) / 12.0 / (h / 2.0),
            None => self.buigeigenschappen(Factoren::uniform(1.0)).w,
        }
    }

    /// Afschuifoppervlak voor dwarskracht langs z (§6.2.6(2)):
    /// - doorsneden met lijven: `A_v = h_w · Σt_w`;
    /// - massieve rechthoek: hier `A_v = A / 1,5`, het elastische maximum
    ///   `τ = 1,5 V/A` — veilig ten opzichte van `η_v · A` uit §6.2.6(2)b.
    pub fn a_v(&self) -> f64 {
        match self.lijf() {
            Some((hw, tw)) => hw * tw,
            None => self.buigeigenschappen(Factoren::uniform(1.0)).a / 1.5,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bruto_i_profiel_volgt_de_gesloten_formules() {
        // I 200×100×6×10: A = 2·100·10 + 180·6 = 3080 mm²,
        // I_y = 100·200³/12 − 94·180³/12 = 66 666 667 − 45 684 000 = 20 982 667 mm⁴.
        let d = AluDoorsnede::IProfiel { h_mm: 200.0, b_mm: 100.0, tw_mm: 6.0, tf_mm: 10.0 };
        let e = d.buigeigenschappen(Factoren::uniform(1.0));
        assert!((e.a - 3080.0).abs() < 1e-9);
        assert!((e.z_c - 100.0).abs() < 1e-9);
        let iy = 100.0 * 200f64.powi(3) / 12.0 - 94.0 * 180f64.powi(3) / 12.0;
        assert!((e.i_y - iy).abs() < 1e-6, "{} vs {iy}", e.i_y);
        assert!((e.w - iy / 100.0).abs() < 1e-6);
        // W_pl = 100·10·190 + 6·180²/4 = 190 000 + 48 600 = 238 600 mm³.
        assert!((d.w_pl_y().0 - 238_600.0).abs() < 1e-9);
    }

    #[test]
    fn bruto_koker_volgt_de_gesloten_formules() {
        // Koker 120×60×4: I_y = (60·120³ − 52·112³)/12.
        let d = AluDoorsnede::Koker { h_mm: 120.0, b_mm: 60.0, t_mm: 4.0 };
        let e = d.buigeigenschappen(Factoren::uniform(1.0));
        let iy = (60.0 * 120f64.powi(3) - 52.0 * 112f64.powi(3)) / 12.0;
        assert!((e.i_y - iy).abs() < 1e-6);
        assert!((e.a - (60.0 * 120.0 - 52.0 * 112.0)).abs() < 1e-9);
        let iz = (120.0 * 60f64.powi(3) - 112.0 * 52f64.powi(3)) / 12.0;
        assert!((d.i_z() - iz).abs() < 1e-6, "{} vs {iz}", d.i_z());
    }
}
