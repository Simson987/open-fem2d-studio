//! Lijnlasten in een globale richting (#80).
//!
//! Een staafbelasting met `globalDirection` werkt in globaal X, Y of Z met de
//! intensiteit q in kN/m, met teken langs de globale as (Z negatief = omlaag),
//! lineair verlopend van `qStartKnPerM` bij startPositionM naar `qEndKnPerM`
//! bij endPositionM (posities langs de staaf vanaf de beginknoop, zoals bij een
//! lokale last). Standaard per meter staaflengte; met `perProjection` per meter
//! projectie van de staaf op het vlak loodrecht op de lastrichting d (sneeuw op
//! een schuine spant: Z-last per horizontale meter). Per staafmeter is dat
//! q·|e_x × d|.
//!
//! Ontbinden. Met de lokale assen e_x, e_y, e_z van de staaf zoals de kern ze
//! neemt (met de rolhoek) zijn de componenten q·(d·e_x), q·(d·e_y) en
//! q·(d·e_z). De factoren zijn per staaf vast, dus elke component verloopt
//! lineair over hetzelfde bereik. De dwarscomponenten (y, z) gaan als gewone
//! verdeelde last naar de kern, precies zoals een lokale last, ook op een
//! staaf die de adapter knipt (tussenknopen, plaatknopen, bedding).
//!
//! Axiaal. De kern kent geen axiale lijnlast. Per kerndeel (een ongeknipte
//! staaf is één deel van lengte h) wordt de axiale component q_x(ξ), ξ langs
//! het deel, een paar gelijkwaardige knooplasten langs e_x op de eindknopen van
//! dat deel:
//!   F_i = ∫q_x·(1 − ξ/h) dξ,   F_j = ∫q_x·ξ/h dξ,
//! het tegengestelde van de reacties van een aan beide einden axiaal
//! vastgehouden deel. Bij een constante EA zijn de verplaatsingen van de
//! eindknopen daarmee exact. De kern geeft het deel dan één normaalkracht
//! N_kern = EA·Δ/h, het gemiddelde van de werkelijke N over het deel. De
//! werkelijke lijn is
//!   N(ξ) = N_kern + N_vast(ξ),   N_vast(ξ) = F_i − ∫₀^ξ q_x dξ',
//! met N_vast de normaalkracht van het vastgehouden deel (trek positief,
//! dN/dξ = −q_x, gemiddelde over het deel nul; bij gelijkmatige q_x over het
//! hele deel N_vast = q_x·(h/2 − ξ)). De adapter telt N_vast op bij de N-lijn
//! van de kern, met extra lijnpunten op het begin en eind van het lastbereik
//! (daar knikt de lijn), en bij n_start/n_end van het deel; daarna voegt hij de
//! delen van een geknipte staaf samen zoals altijd. De knooplasten zijn gewone
//! lasten voor de kern: ze tellen mee in de evenwichtssom en in de reacties.
//!
//! Tweede orde (P-Δ) en knik: de geometrische stijfheid van een kerndeel
//! gebruikt één normaalkracht uit zijn verlenging, N_kern, het gemiddelde over
//! het deel. Bij een axiale lijnlast is dat een benadering van het verloop van
//! N langs de staaf; de adapter knipt daarvoor niet extra.
//!
//! Een globale last op een trek-alleen staaf die op druk wegvalt, gaat zoals
//! een lokale last als knooplasten naar haar eindknopen, nu met alle drie de
//! componenten (`trek_alleen::gereduceerd`).
//!
//! Trek-alleen status. N_vast hoort bij de eigen last van de staaf en is
//! gemiddeld nul; zij zet een einde plaatselijk op druk (amplitude |q_x|·L/2
//! bij een gelijkmatige last) zonder dat de staaf als geheel korter wordt. De
//! trek-alleen-lus kijkt bij het uit- en weer inschakelen daarom naar dezelfde
//! grootheid, de normaalkracht zonder de eigen axiale last: een actieve staaf
//! gaat uit op n_start − N_vast(0) of n_end − N_vast(L) < −tol, een inactieve
//! weer aan op de N uit haar verlenging, die N_vast ook niet bevat. Hier is
//! N_vast die van de hele staaf (lengte L, het hele lastbereik), ook als de
//! kern haar in delen rekent: dan heeft elk deel een eigen N_kern, maar een
//! staaf zonder andere aansluitingen op haar tussenknopen houdt zo aan beide
//! einden precies haar gemiddelde N over, dezelfde waarde als haar verlenging
//! geeft. Het resultaat draagt die N_vast per staaf mee (intern veld
//! `n_vast_einden`, niet in het contract); de lus trekt haar af. Zonder deze
//! afspraak keurde het uitschakelen het einde met N_vast en het inschakelen
//! het gemiddelde, en bleef een verband met een grote axiale lijnlast tussen
//! trek en druk wisselen.

use std::collections::BTreeMap;

use rekenkern::element::compute_local_axes_3d;
use rekenkern::postprocess::diagrams_3d::{DiagramPoint3D, ElementDiagram3D};
use rekenkern::types::ElementForces3D;

use crate::shell::{cross, dot, norm, V3};
use crate::{GlobalDirection3D, Member3D, MemberLoad3D, Node3D};

/// Twee lijnpunten binnen deze afstand (in t, 0..1) vallen samen.
const ZELFDE_T: f64 = 1e-9;

impl GlobalDirection3D {
    /// Eenheidsvector van de richting.
    pub(crate) fn vector(self) -> V3 {
        match self {
            Self::X => [1.0, 0.0, 0.0],
            Self::Y => [0.0, 1.0, 0.0],
            Self::Z => [0.0, 0.0, 1.0],
        }
    }

    fn as_naam(self) -> &'static str {
        match self {
            Self::X => "X",
            Self::Y => "Y",
            Self::Z => "Z",
        }
    }
}

/// Keur de velden van een staafbelasting die bij een globale last horen, en
/// geef de waarden die daarna op eindigheid en nul gekeurd worden: bij een
/// globale last [qStart, qEnd], anders de vier lokale waarden.
pub(crate) fn keur_velden(load: &MemberLoad3D) -> Result<Vec<f64>, String> {
    let id = load.id;
    let lokaal = vec![load.qy_start_kn_per_m, load.qy_end_kn_per_m, load.qz_start_kn_per_m, load.qz_end_kn_per_m];
    let Some(richting) = load.global_direction else {
        if load.q_start_kn_per_m.is_some() || load.q_end_kn_per_m.is_some() || load.per_projection {
            return Err(format!(
                "staafbelasting {id}: qStartKnPerM, qEndKnPerM en perProjection horen bij een globale last; geef ook globalDirection (\"x\", \"y\" of \"z\"), of geef een lokale last met qyStartKnPerM … qzEndKnPerM",
            ));
        }
        return Ok(lokaal);
    };
    let naam = richting.as_naam();
    if lokaal.iter().any(|q| *q != 0.0) {
        return Err(format!(
            "staafbelasting {id} is een globale last in {naam} (globalDirection) en kan niet ook lokale waarden hebben: qyStartKnPerM, qyEndKnPerM, qzStartKnPerM en qzEndKnPerM moeten 0 zijn of ontbreken",
        ));
    }
    match (load.q_start_kn_per_m, load.q_end_kn_per_m) {
        (Some(begin), Some(eind)) => Ok(vec![begin, eind]),
        _ => Err(format!(
            "staafbelasting {id} is een globale last in {naam} (globalDirection) maar mist qStartKnPerM of qEndKnPerM (kN/m, met teken langs de globale as)",
        )),
    }
}

/// Lokale assen e_x, e_y, e_z van een staaf zoals de kern ze neemt (met de rolhoek).
pub(crate) fn assen(member: &Member3D, a: &Node3D, b: &Node3D) -> [V3; 3] {
    let (ex, ey, ez) = compute_local_axes_3d(
        a.x, a.y, a.z, b.x, b.y, b.z, None, None, None,
        member.roll_angle_rad.map(f64::to_degrees), false,
    );
    [ex, ey, ez]
}

/// Een staafbelasting in de lokale assen van haar staaf: per component de
/// intensiteit bij het begin en het eind van het lastbereik, in kN/m staaflengte.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Componenten {
    pub qx: [f64; 2],
    pub qy: [f64; 2],
    pub qz: [f64; 2],
}

/// Ontbind een staafbelasting in de lokale assen `assen` van haar staaf. Een
/// lokale last heeft geen axiale component en behoudt haar waarden exact.
pub(crate) fn componenten(load: &MemberLoad3D, assen: &[V3; 3]) -> Componenten {
    let Some(richting) = load.global_direction else {
        return Componenten {
            qx: [0.0; 2],
            qy: [load.qy_start_kn_per_m, load.qy_end_kn_per_m],
            qz: [load.qz_start_kn_per_m, load.qz_end_kn_per_m],
        };
    };
    let d = richting.vector();
    let [ex, ey, ez] = *assen;
    // Per projectie: de staafmeter heeft |e_x × d| meter projectie.
    let factor = if load.per_projection { norm(cross(ex, d)) } else { 1.0 };
    let q = [load.q_start_kn_per_m.unwrap_or(0.0) * factor, load.q_end_kn_per_m.unwrap_or(0.0) * factor];
    let langs = |as_: V3| {
        let c = dot(d, as_);
        [q[0] * c, q[1] * c]
    };
    Componenten { qx: langs(ex), qy: langs(ey), qz: langs(ez) }
}

/// De axiale component van een globale last op één kerndeel, in de coördinaat
/// ξ van dat deel (0 bij zijn beginknoop, h bij zijn eindknoop): lineair van
/// `q_van` bij ξ = `van` naar `q_tot` bij ξ = `tot`, langs e_x van de staaf.
#[derive(Debug, Clone)]
pub(crate) struct AxiaalDeel {
    pub h: f64,
    pub van: f64,
    pub tot: f64,
    pub q_van: f64,
    pub q_tot: f64,
}

impl AxiaalDeel {
    /// De gelijkwaardige knooplasten (F_i, F_j) langs e_x: het tegengestelde van
    /// de reacties van het aan beide einden vastgehouden deel.
    pub fn knooplasten(&self) -> (f64, f64) {
        let lengte = self.tot - self.van;
        let resultante = (self.q_van + self.q_tot) / 2.0 * lengte;
        // Eerste moment om het begin van het deel.
        let moment = lengte / 6.0 * (self.q_van * (2.0 * self.van + self.tot) + self.q_tot * (self.van + 2.0 * self.tot));
        let eind = moment / self.h;
        (resultante - eind, eind)
    }

    /// ∫₀^ξ q_x dξ'.
    fn som_tot(&self, xi: f64) -> f64 {
        if xi <= self.van {
            return 0.0;
        }
        let s = xi.min(self.tot) - self.van;
        self.q_van * s + (self.q_tot - self.q_van) * s * s / (2.0 * (self.tot - self.van))
    }

    /// N_vast(ξ): de normaalkracht (trek positief) van het aan beide einden
    /// vastgehouden deel onder deze last.
    pub fn n_vast(&self, xi: f64) -> f64 {
        self.knooplasten().0 - self.som_tot(xi)
    }
}

/// Tel N_vast op bij de normaalkrachtlijnen en de eindnormaalkrachten van de
/// kerndelen met een axiale lijnlast (`axiaal`, per kern-id). Een lijn krijgt
/// extra punten op het begin en eind van elk lastbereik; de lijn van de kern
/// zelf is lineair in t (n_start + t·(n_end − n_start)).
pub(crate) fn corrigeer(
    axiaal: &BTreeMap<usize, Vec<AxiaalDeel>>,
    lijnen: &mut [ElementDiagram3D],
    krachten: &mut [ElementForces3D],
) {
    for kracht in krachten.iter_mut() {
        let Some(delen) = axiaal.get(&kracht.element_id) else { continue };
        let n_vast = |t: f64| delen.iter().map(|deel| deel.n_vast(t * deel.h)).sum::<f64>();
        let (n_begin, n_eind) = (kracht.n_start, kracht.n_end);
        if let Some(lijn) = lijnen.iter_mut().find(|lijn| lijn.element_id == kracht.element_id) {
            let mut plaatsen: Vec<f64> = lijn.points.iter().map(|punt| punt.t).collect();
            for deel in delen {
                plaatsen.push(deel.van / deel.h);
                plaatsen.push(deel.tot / deel.h);
            }
            plaatsen.sort_by(f64::total_cmp);
            plaatsen.dedup_by(|later, eerder| (*later - *eerder).abs() <= ZELFDE_T);
            lijn.points = plaatsen.into_iter()
                .map(|t| DiagramPoint3D { t, value: n_begin + t * (n_eind - n_begin) + n_vast(t) })
                .collect();
            // Zoals de kern: grootste, kleinste en de waarde met teken met de
            // grootste absolute waarde.
            lijn.max_value = lijn.points.iter().map(|p| p.value).fold(f64::NEG_INFINITY, f64::max);
            lijn.min_value = lijn.points.iter().map(|p| p.value).fold(f64::INFINITY, f64::min);
            lijn.max_abs_value = lijn.points.iter().map(|p| p.value)
                .fold(0.0, |grootste: f64, waarde| if waarde.abs() > grootste.abs() { waarde } else { grootste });
        }
        kracht.n_start = n_begin + n_vast(0.0);
        kracht.n_end = n_eind + n_vast(1.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Gelijkmatig over het hele deel: F_i = F_j = q·h/2 en N_vast = q·(h/2 − ξ).
    #[test]
    fn gelijkmatig_over_het_hele_deel() {
        let deel = AxiaalDeel { h: 4.0, van: 0.0, tot: 4.0, q_van: 3.0, q_tot: 3.0 };
        assert_eq!(deel.knooplasten(), (6.0, 6.0));
        for xi in [0.0, 1.0, 2.0, 3.5, 4.0] {
            assert!((deel.n_vast(xi) - 3.0 * (2.0 - xi)).abs() < 1e-14, "ξ = {xi}");
        }
    }

    /// Gedeeltelijk trapezium: knooplasten uit resultante en moment, N_vast
    /// gemiddeld nul over het deel en −F_j aan het eind.
    #[test]
    fn gedeeltelijk_trapezium() {
        let deel = AxiaalDeel { h: 5.0, van: 1.0, tot: 3.0, q_van: 2.0, q_tot: 6.0 };
        // Resultante 8 kN op 1 + 2·(2 + 2·6)/(3·(2 + 6)) = 2,1667 m.
        let (fi, fj) = deel.knooplasten();
        assert!((fi + fj - 8.0).abs() < 1e-14);
        assert!((fj - 8.0 * (1.0 + 2.0 * 14.0 / 24.0) / 5.0).abs() < 1e-14);
        assert!((deel.n_vast(5.0) + fj).abs() < 1e-14);
        assert!((deel.n_vast(0.5) - fi).abs() < 1e-14, "voor het bereik constant");
        let stappen = 100_000;
        let gemiddeld: f64 = (0..stappen).map(|i| deel.n_vast(5.0 * (i as f64 + 0.5) / stappen as f64)).sum::<f64>() / stappen as f64;
        assert!(gemiddeld.abs() < 1e-9, "gemiddelde {gemiddeld}");
    }

    /// Per projectie op een staaf onder 30°: factor cos 30°; een lokale last
    /// blijft ongewijzigd.
    #[test]
    fn ontbinden_en_per_projectie() {
        let (c, s) = (30f64.to_radians().cos(), 30f64.to_radians().sin());
        let assen = [[c, 0.0, s], [0.0, 1.0, 0.0], [-s, 0.0, c]];
        let mut last = MemberLoad3D {
            id: 1, member_id: 1, global_direction: Some(GlobalDirection3D::Z),
            q_start_kn_per_m: Some(-2.0), q_end_kn_per_m: Some(-4.0), ..Default::default()
        };
        let per_meter = componenten(&last, &assen);
        assert_eq!(per_meter.qx, [-2.0 * s, -4.0 * s]);
        assert_eq!(per_meter.qy, [0.0, 0.0]);
        assert_eq!(per_meter.qz, [-2.0 * c, -4.0 * c]);
        last.per_projection = true;
        let projectie = componenten(&last, &assen);
        assert!((projectie.qz[1] - -4.0 * c * c).abs() < 1e-15 && (projectie.qx[0] - -2.0 * s * c).abs() < 1e-15);
        let lokaal = MemberLoad3D { id: 1, member_id: 1, qy_start_kn_per_m: 1.5, qz_end_kn_per_m: -2.5, ..Default::default() };
        let ontbonden = componenten(&lokaal, &assen);
        assert_eq!((ontbonden.qx, ontbonden.qy, ontbonden.qz), ([0.0; 2], [1.5, 0.0], [0.0, -2.5]));
    }
}
