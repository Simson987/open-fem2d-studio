//! Staaf op bedding (Winkler), #106.
//!
//! Een staaf op bedding ligt op grondveren: verticaal (globaal Z, de grond
//! ligt onder de staaf) met de lijnstijfheid k·b in kN/m per m, en desgewenst
//! zijdelings met k_lat·b, horizontaal loodrecht op de staafas en naar beide
//! zijden. Bij een staaf die steiler staat dan 45° (|e_x·Z| > 1/√2, een
//! (schoor)paal) werkt de zijdelingse bedding rondom: in twee richtingen
//! loodrecht op de as, bij een loodrechte paal precies globaal X en Y. Alleen
//! horizontaal liet een schoorpaal in zijn schoorvlak vrij (review #106). Bij
//! een (bijna) verticale staaf (|e_x·Z| > 0,95) is alleen de zijdelingse
//! bedding toegestaan.
//!
//! Knippen, zoals in 2D (`beddingSplitsFracties` in engine.ts): de staaf gaat
//! in n gelijke delen met n = ⌈L·λ/0,15⌉, minstens 8 en hoogstens 200, met
//! λ = (k·b/(4·E·I))^¼. I is de traagheid voor buiging in de richting d van de
//! veer, met de rolhoek: een last langs d buigt de staaf in lokaal y (I_z) en
//! lokaal z (I_y), dus I_d = 1/((d·e_y)²/I_z + (d·e_z)²/I_y) voor d loodrecht op
//! de as. Bij meer veerrichtingen telt de grootste λ (het fijnste net).
//! Bestaande tussenknopen (plaatknopen) en de grensknopen van een verlopende
//! staaf (#73, module `verloop`) blijven rekenknopen; een deelpunt binnen een
//! kwart deel van zo'n knoop vervalt. Bij een verlopende staaf bepaalt de
//! kleinste traagheid van de delen λ. De einden en hun
//! eindscharnieren blijven zoals ze zijn: `to_engine_input` geeft de
//! vrijgaven aan het eerste en het laatste deel, behalve een torsievrijgave aan
//! beide einden: die krijgt alleen het eerste deel, anders draaien de
//! rekenknopen ertussen vrij om de staafas. Nieuwe rekenknopen krijgen
//! id's boven de hoogste knoop-id (en boven de grensknopen van verlopende
//! staven); ze staan niet in de uitvoer, en de adapter
//! voegt krachten en snedekrachtlijnen van de delen weer samen tot de ene
//! modelstaaf (zoals bij tussenknopen).
//!
//! Veren. Elke rekenknoop krijgt de tributaire veer k·b·L_trib (kN/m), met
//! L_trib de halve som van de aangrenzende delen (een eindknoop een half
//! deel). Op een nieuwe rekenknoop is dat een veer van een oplegging: kz, en
//! kx of ky voor een zijdelingse veer langs X of Y. Op een bestaande knoop,
//! die al een oplegging of de veer van een andere staaf kan hebben, en voor
//! een zijdelingse veer in een schuine richting is het een veerelement van de
//! kern (connector, alleen axiale stijfheid) naar een vaste grondknoop op 1 m
//! in de veerrichting. Zo telt de veer op bij wat er al is en overschrijft zij
//! niets. Grondknopen zijn vast; hun reacties en de veerreacties van de
//! rekenknopen tellen mee in de evenwichtssom, maar staan niet bij de
//! oplegreacties van het model.
//!
//! Alleen druk: de statuslus in `trek_alleen` houdt per verticale veer bij of
//! zij meedoet. Begin alles actief; een actieve veer met een zakking < −tol
//! (de staaf komt omhoog) valt weg, een weggevallen veer met een zakking > tol
//! doet weer mee, met tol = 10⁻⁶ maal de grootste verplaatsing. De lus
//! herhaalt tot de set stabiel is, eerst lineair en bij tweede orde daarna
//! vanaf die set met de tweede orde, en weigert een terugkerende toestand en
//! meer dan 50 rondes per fase. Valt door het loskomen een beweging vrij die
//! met alle veren wel vastzat, dan volgt vóór het rekenen een melding met de
//! vrije beweging (`controleer_contact`). Zijdelingse veren blijven lineair.
//!
//! Snedekrachten. De normaal- en dwarskrachtlijnen en de eindkrachten van een
//! staaf op bedding tellen elke veer als grond over haar eigen lengte, niet als
//! puntlast op haar rekenknoop (`correctie`): zo is de dwarskracht aan een vrij
//! eind 0 en springt zij bij een puntlast alleen met die last, in plaats van
//! een zaagtand met sprongen van k·b·h·w op elke rekenknoop.
//!
//! Elke analysesoort ziet de veren als lineaire stijfheid in K: lineair,
//! tweede orde (de veren krijgen geen geometrische stijfheid, zoals bij een
//! gewone Winkler-grond) en de knikfactor (K·φ = λ·(−K_G)·φ met de veren in K,
//! de knik op bedding volgens Hetényi).

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use rekenkern::element::compute_local_axes_3d;
use rekenkern::types::{ConnectorElement, SolverNode3D, SolverSupport3D};

use crate::shell::{add, cross, dot, norm, scale, sub, V3};
use crate::{
    BeddingPoint3D, Member3D, MemberBedding3D, Node3D, SolveRequest3D, SolveResult3D,
};

/// Een staaf is (bijna) verticaal boven deze |e_x·Z|.
pub(crate) const VERTICAAL: f64 = 0.95;
/// Boven deze |e_x·Z| (steiler dan 45°) werkt de zijdelingse bedding rondom.
pub(crate) const RONDOM: f64 = std::f64::consts::FRAC_1_SQRT_2;
/// Hoogstens zoveel maal 1/λ per deel.
const DEELLENGTE: f64 = 0.15;
const MIN_DELEN: usize = 8;
const MAX_DELEN: usize = 200;
/// Een deelpunt binnen dit deel van een deellengte van een bestaande
/// tussenknoop vervalt.
const SAMENVALLEN: f64 = 0.25;
/// Afstand van een grondknoop tot zijn rekenknoop, in m. De stijfheid van een
/// veerelement hangt niet van zijn lengte af.
const GRONDAFSTAND: f64 = 1.0;
/// Statusgrens van alleen druk, als deel van de grootste verplaatsing.
const STATUSGRENS: f64 = 1e-6;
const Z: V3 = [0.0, 0.0, 1.0];

/// Weggevallen grondveren bij alleen druk: de verticale veren van staven op
/// bedding (staaf-id, index van de rekenknoop langs de staaf) en de veren van
/// platen op bedding (plaat-id, knoop-id; module `plaatbedding`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash)]
pub(crate) struct Los {
    pub staven: BTreeSet<(usize, usize)>,
    pub platen: BTreeSet<(usize, usize)>,
}

impl Los {
    pub fn new() -> Self { Self::default() }

    pub fn is_empty(&self) -> bool { self.staven.is_empty() && self.platen.is_empty() }

    /// Aantal weggevallen veren.
    pub fn len(&self) -> usize { self.staven.len() + self.platen.len() }

    /// De veren die in precies één van beide sets los zijn.
    pub fn verschil(&self, ander: &Los) -> Los {
        Los {
            staven: self.staven.symmetric_difference(&ander.staven).copied().collect(),
            platen: self.platen.symmetric_difference(&ander.platen).copied().collect(),
        }
    }
}

/// Weggevallen veren van staven: (staaf-id, index van de rekenknoop).
impl FromIterator<(usize, usize)> for Los {
    fn from_iter<I: IntoIterator<Item = (usize, usize)>>(veren: I) -> Self {
        Los { staven: veren.into_iter().collect(), platen: BTreeSet::new() }
    }
}

fn lijst(ids: impl IntoIterator<Item = usize>) -> String {
    ids.into_iter().map(|id| id.to_string()).collect::<Vec<_>>().join(", ")
}

/// Waaronder veren los zijn: "staaf 1, 2", "plaat 3" of "staaf 1 en plaat 3".
pub(crate) fn beschrijf_los(los: &Los) -> String {
    let platen: BTreeSet<usize> = los.platen.iter().map(|(plaat, _)| *plaat).collect();
    let mut delen = Vec::new();
    if !los.staven.is_empty() { delen.push(format!("staaf {}", lijst(staven_met_los(los)))); }
    if !platen.is_empty() { delen.push(format!("plaat {}", lijst(platen))); }
    delen.join(" en ")
}

/// "staaf", "plaat" of "staaf en plaat": wat er in `los` loskomt.
pub(crate) fn soort_los(los: &Los) -> &'static str {
    match (los.staven.is_empty(), los.platen.is_empty()) {
        (false, true) => "staaf",
        (true, false) => "plaat",
        _ => "staaf en plaat",
    }
}

/// Staafas als eenheidsvector; de knopen zijn al gekeurd.
fn as_van(staaf: &Member3D, knopen: &HashMap<usize, &Node3D>) -> (V3, V3, f64) {
    let a = knopen[&staaf.start_node_id];
    let b = knopen[&staaf.end_node_id];
    let begin = [a.x, a.y, a.z];
    let as_ = sub([b.x, b.y, b.z], begin);
    let lengte = norm(as_);
    (begin, scale(as_, 1.0 / lengte), lengte)
}

/// Keur de bedding van alle staven: positieve, eindige getallen, minstens één
/// beddingsconstante, geen verticale bedding op een (bijna) verticale staaf
/// en geen bedding op een trek-alleen staaf. De knopen zijn al gekeurd.
pub(crate) fn valideer(request: &SolveRequest3D) -> Result<(), String> {
    let knopen: HashMap<usize, &Node3D> = request.nodes.iter().map(|knoop| (knoop.id, knoop)).collect();
    for staaf in &request.members {
        let Some(bedding) = &staaf.bedding else { continue };
        let id = staaf.id;
        crate::positive(bedding.width_m, &format!("de breedte widthM van de bedding van staaf {id}"))?;
        if let Some(k) = bedding.k_kn_per_m3 {
            crate::positive(k, &format!("de beddingsconstante kKnPerM3 van staaf {id}"))?;
        }
        if let Some(k) = bedding.k_lateral_kn_per_m3 {
            crate::positive(k, &format!("de zijdelingse beddingsconstante kLateralKnPerM3 van staaf {id}"))?;
        }
        if bedding.k_kn_per_m3.is_none() && bedding.k_lateral_kn_per_m3.is_none() {
            return Err(format!(
                "de bedding van staaf {id} heeft geen beddingsconstante: geef kKnPerM3 (verticaal), kLateralKnPerM3 (zijdelings) of beide"
            ));
        }
        if staaf.tension_only {
            return Err(format!(
                "staaf {id} is trek-alleen en kan niet op bedding liggen: een trek-alleen staaf valt op druk weg en zou de grond loslaten"
            ));
        }
        let (_, ex, _) = as_van(staaf, &knopen);
        if ex[2].abs() > VERTICAAL && bedding.k_kn_per_m3.is_some() {
            return Err(format!(
                "staaf {id} staat (bijna) verticaal (|e_x·Z| = {:.3}, grens 0,95): een verticale bedding (kKnPerM3) kan daar niet. Geef een paal alleen een zijdelingse bedding (kLateralKnPerM3); die werkt rondom, loodrecht op de paal.",
                ex[2].abs(),
            ));
        }
    }
    Ok(())
}

/// Traagheid voor buiging in richting `d` (loodrecht op de as): een last langs
/// d buigt in lokaal y (I_z) en lokaal z (I_y).
fn traagheid(d: V3, ey: V3, ez: V3, iy: f64, iz: f64) -> f64 {
    let (a, b) = (dot(d, ey), dot(d, ez));
    (a * a + b * b) / (a * a / iz + b * b / iy)
}

/// Horizontale normaal op een niet-verticale staaf: Z × e_x, genormeerd.
fn normaal(ex: V3) -> V3 {
    let n = cross(Z, ex);
    scale(n, 1.0 / norm(n))
}

/// Twee richtingen loodrecht op een steile staaf (|e_x·Z| > 1/√2): X loodrecht
/// op de as gemaakt, en de richting loodrecht op die en op de as (met een
/// vast teken, positief in Y of anders in Z). Bij een loodrechte staaf precies
/// X en Y. Samen houden ze elke verplaatsing loodrecht op de as tegen; de
/// veren hebben dezelfde stijfheid, dus de keuze binnen dat vlak doet niet ter
/// zake.
fn rondom(ex: V3) -> Vec<V3> {
    let x = sub([1.0, 0.0, 0.0], scale(ex, ex[0]));
    let eerste = scale(x, 1.0 / norm(x));
    let mut tweede = cross(ex, eerste);
    tweede = scale(tweede, 1.0 / norm(tweede));
    if tweede[1] < 0.0 || (tweede[1] == 0.0 && tweede[2] < 0.0) { tweede = scale(tweede, -1.0); }
    vec![eerste, tweede]
}

/// De globale as (0, 1, 2) waarlangs `d` precies ligt, als die er is.
pub(crate) fn globale_as(d: V3) -> Option<usize> {
    (0..3).find(|&as_| (0..3).all(|j| j == as_ || d[j].abs() <= 1e-12))
}

/// Eén rekenknoop van een staaf op bedding.
#[derive(Debug, Clone)]
pub(crate) struct Station {
    pub knoop: usize,
    /// Door de adapter aangelegd (geen modelknoop).
    pub nieuw: bool,
    /// Afstand tot de beginknoop in m.
    pub s: f64,
    pub punt: V3,
    /// Tributaire lengte L_trib in m.
    pub lengte: f64,
}

/// Herkomst van een rekenknoop bij het knippen.
enum Punt {
    /// Begin-, eind- of tussenknoop van het model.
    Model(usize),
    /// Grensknoop van een verlopende staaf (`verloop`), al in het kernmodel.
    Grens(usize, V3),
    /// Nieuwe rekenknoop van de bedding.
    Nieuw,
}

/// Een staaf op bedding zoals de kern haar rekent.
#[derive(Debug, Clone)]
pub(crate) struct Staaf {
    pub member_id: usize,
    pub lengte: f64,
    /// Verticale lijnstijfheid k·b in kN/m²; 0 zonder verticale bedding.
    pub kb: f64,
    /// Zijdelingse lijnstijfheid k_lat·b in kN/m²; 0 zonder.
    pub kb_zij: f64,
    pub alleen_druk: bool,
    /// Steiler dan 45°: de zijdelingse bedding werkt rondom (twee richtingen).
    pub rondom: bool,
    /// Richtingen van de zijdelingse veren: de horizontale normaal, of bij een
    /// steile staaf twee richtingen loodrecht op de as (`rondom`).
    pub zijdelings: Vec<V3>,
    pub stations: Vec<Station>,
    /// Lokale assen e_x, e_y, e_z van de staaf (met de rolhoek), zoals de kern ze neemt.
    pub assen: [V3; 3],
}

impl Staaf {
    /// Doet de verticale veer van rekenknoop `index` mee?
    pub fn actief(&self, index: usize, los: &Los) -> bool {
        !(self.alleen_druk && los.staven.contains(&(self.member_id, index)))
    }

    /// De kracht van de grond op de staaf in rekenknoop `index`, globaal (kN):
    /// −k·b·L_trib·(u·d)·d langs elke veerrichting d; een weggevallen verticale
    /// veer telt niet mee.
    fn grondkracht(&self, index: usize, los: &Los, u: [f64; 6]) -> V3 {
        let lengte = self.stations[index].lengte;
        let verplaatsing = [u[0], u[1], u[2]];
        let mut kracht = [0.0; 3];
        if self.kb > 0.0 && self.actief(index, los) {
            kracht[2] -= self.kb * lengte * u[2];
        }
        for d in &self.zijdelings {
            kracht = sub(kracht, scale(*d, self.kb_zij * lengte * dot(verplaatsing, *d)));
        }
        kracht
    }

    /// De knopen van begin naar eind met hun afstand tot het begin.
    pub fn keten(&self) -> Vec<(usize, f64)> {
        self.stations.iter().map(|station| (station.knoop, station.s)).collect()
    }

    /// Aantal delen waarin de kern de staaf rekent.
    pub fn delen(&self) -> usize { self.stations.len() - 1 }
}

/// Alle staven op bedding van een verzoek.
#[derive(Debug, Clone, Default)]
pub(crate) struct Plan {
    pub staven: Vec<Staaf>,
    /// Nieuwe rekenknopen (id, punt), oplopend op id.
    pub nieuwe_knopen: Vec<(usize, V3)>,
    /// Eerste vrije knoop-id na de rekenknopen (voor de grondknopen).
    volgende_id: usize,
}

/// De grondknopen en veerelementen in één kernmodel.
#[derive(Debug, Clone, Default)]
pub(crate) struct Grond {
    pub knopen: HashSet<usize>,
    pub veren: HashSet<usize>,
}

impl Grond {
    /// Gaat een kernmelding over deze knopen of elementen over de grond?
    pub fn betreft(&self, knopen: &[usize], elementen: &[usize]) -> bool {
        knopen.iter().any(|knoop| self.knopen.contains(knoop))
            || (!elementen.is_empty() && elementen.iter().all(|element| self.veren.contains(element)))
    }
}

impl Plan {
    pub fn is_empty(&self) -> bool { self.staven.is_empty() }

    pub fn staaf(&self, member_id: usize) -> Option<&Staaf> {
        self.staven.iter().find(|staaf| staaf.member_id == member_id)
    }

    /// Knip elke staaf op bedding. Hetzelfde verzoek geeft altijd dezelfde
    /// rekenknopen en id's, zodat een statusset (`Los`) van ronde tot ronde
    /// naar dezelfde veren wijst.
    pub fn bouw(request: &SolveRequest3D) -> Result<Plan, String> {
        if !request.members.iter().any(|staaf| staaf.bedding.is_some()) {
            return Ok(Plan::default());
        }
        let knopen: HashMap<usize, &Node3D> = request.nodes.iter().map(|knoop| (knoop.id, knoop)).collect();
        // De grensknopen van verlopende staven (#73) gaan voor; zonder die
        // staven is dit de hoogste knoop-id plus één.
        let verloop = crate::verloop::Plan::bouw(request)?;
        let mut volgende = verloop.volgende_id;
        let mut plan = Plan::default();
        for staaf in &request.members {
            let Some(bedding) = &staaf.bedding else { continue };
            let (begin, ex, lengte) = as_van(staaf, &knopen);
            let a = knopen[&staaf.start_node_id];
            let b = knopen[&staaf.end_node_id];
            let (_, ey, ez) = compute_local_axes_3d(
                a.x, a.y, a.z, b.x, b.y, b.z, None, None, None,
                staaf.roll_angle_rad.map(f64::to_degrees), false,
            );
            let materiaal = request.materials.iter().find(|m| m.id == staaf.material_id)
                .ok_or_else(|| format!("staaf {} verwijst naar ontbrekend materiaal {}", staaf.id, staaf.material_id))?;
            // De doorsnede, of bij een verlopende staaf die van elk deel.
            let doorsneden = crate::verloop::doorsneden(request, staaf)?;
            let e = materiaal.e_mpa * 1000.0;
            let verticaal = ex[2].abs() > VERTICAAL;
            let kb = if verticaal { 0.0 } else { bedding.k_kn_per_m3.unwrap_or(0.0) * bedding.width_m };
            let kb_zij = bedding.k_lateral_kn_per_m3.unwrap_or(0.0) * bedding.width_m;
            let steil = ex[2].abs() > RONDOM;
            let zijdelings = match (kb_zij > 0.0, steil) {
                (false, _) => vec![],
                (true, true) => rondom(ex),
                (true, false) => vec![normaal(ex)],
            };
            // λ per veerrichting; de grootste bepaalt de deellengte. Bij een
            // verlopende staaf telt elk deel: de kleinste traagheid geeft de
            // grootste λ.
            let lambda = |kb: f64, d: V3, doorsnede: &crate::Section3D| {
                let loodrecht = sub(d, scale(ex, dot(d, ex)));
                let d = scale(loodrecht, 1.0 / norm(loodrecht));
                (kb / (4.0 * e * traagheid(d, ey, ez, doorsnede.iy_m4, doorsnede.iz_m4))).powf(0.25)
            };
            let mut grootste = 0.0f64;
            for doorsnede in &doorsneden {
                if kb > 0.0 { grootste = grootste.max(lambda(kb, Z, doorsnede)); }
                for d in &zijdelings { grootste = grootste.max(lambda(kb_zij, *d, doorsnede)); }
            }
            let delen = ((lengte * grootste / DEELLENGTE).ceil().min(MAX_DELEN as f64) as usize).clamp(MIN_DELEN, MAX_DELEN);
            let h = lengte / delen as f64;

            let bestaand = crate::member_stations(staaf, &knopen)?;
            // Nieuwe grensknopen van een verlopende staaf blijven rekenknoop,
            // net als de tussenknopen; een grens op een tussenknoop zit al in
            // `bestaand`.
            let grenzen: Vec<&crate::verloop::Grens> =
                verloop.grenzen(staaf.id).iter().filter(|grens| grens.nieuw).collect();
            let mut punten: Vec<(Punt, f64)> = Vec::with_capacity(delen + bestaand.len() + grenzen.len() + 1);
            punten.push((Punt::Model(staaf.start_node_id), 0.0));
            punten.extend(bestaand.iter().map(|(id, s)| (Punt::Model(*id), *s)));
            punten.extend(grenzen.iter().map(|grens| (Punt::Grens(grens.knoop, grens.punt), grens.s)));
            for index in 1..delen {
                let s = index as f64 * h;
                let vrij = bestaand.iter().map(|(_, t)| *t).chain(grenzen.iter().map(|grens| grens.s))
                    .all(|t| (t - s).abs() > SAMENVALLEN * h);
                if vrij { punten.push((Punt::Nieuw, s)); }
            }
            punten.push((Punt::Model(staaf.end_node_id), lengte));
            punten.sort_by(|p, q| p.1.total_cmp(&q.1));
            let mut stations = Vec::with_capacity(punten.len());
            for (index, (knoop, s)) in punten.iter().enumerate() {
                let vorige = punten[index.saturating_sub(1)].1;
                let volgende_s = punten[(index + 1).min(punten.len() - 1)].1;
                let (knoop, nieuw, punt) = match knoop {
                    Punt::Model(id) => (*id, false, add(begin, scale(ex, *s))),
                    // Al in het kernmodel (`verloop`); geen modelknoop.
                    Punt::Grens(id, punt) => (*id, true, *punt),
                    Punt::Nieuw => {
                        let id = volgende;
                        volgende += 1;
                        let punt = add(begin, scale(ex, *s));
                        plan.nieuwe_knopen.push((id, punt));
                        (id, true, punt)
                    }
                };
                stations.push(Station { knoop, nieuw, s: *s, punt, lengte: (volgende_s - vorige) / 2.0 });
            }
            plan.staven.push(Staaf {
                member_id: staaf.id,
                lengte,
                kb,
                kb_zij,
                alleen_druk: bedding.compression_only && kb > 0.0,
                rondom: steil,
                zijdelings,
                stations,
                assen: [ex, ey, ez],
            });
        }
        plan.volgende_id = volgende;
        Ok(plan)
    }

    /// De veren van alle rekenknopen in het kernmodel: oplegveren op nieuwe
    /// rekenknopen langs een globale as, anders een veerelement naar een vaste
    /// grondknoop. Weggevallen verticale veren (`los`) ontbreken.
    pub fn voeg_veren_toe(
        &self,
        los: &Los,
        knopen: &mut HashMap<String, SolverNode3D>,
        opleggingen: &mut HashMap<String, SolverSupport3D>,
        veren: &mut HashMap<String, ConnectorElement>,
        volgende_element: &mut usize,
    ) -> Grond {
        let mut grond = Grond::default();
        // Na de rekenknopen, en na de knikknopen die de adapter voor de
        // knikanalyse en de tweede orde aanlegt (`KNIKDELEN`); zonder die
        // knopen is dat precies `volgende_id`.
        let mut volgende_knoop = self.volgende_id
            .max(knopen.values().map(|knoop| knoop.id).max().map_or(0, |id| id + 1));
        let mut oplegveren: BTreeMap<usize, [f64; 3]> = BTreeMap::new();
        for staaf in &self.staven {
            for (index, station) in staaf.stations.iter().enumerate() {
                let mut lijst: Vec<(V3, f64)> = Vec::with_capacity(3);
                if staaf.kb > 0.0 && staaf.actief(index, los) { lijst.push((Z, staaf.kb * station.lengte)); }
                for d in &staaf.zijdelings { lijst.push((*d, staaf.kb_zij * station.lengte)); }
                for (d, k) in lijst {
                    match (station.nieuw, globale_as(d)) {
                        (true, Some(as_)) => oplegveren.entry(station.knoop).or_insert([0.0; 3])[as_] += k,
                        _ => {
                            let id = volgende_knoop;
                            volgende_knoop += 1;
                            let p = sub(station.punt, scale(d, GRONDAFSTAND));
                            knopen.insert(id.to_string(), SolverNode3D { id, x: p[0], y: p[1], z: p[2] });
                            opleggingen.insert(format!("bedding-grond-{id}"), steun(id, true, [0.0; 3]));
                            let element = *volgende_element;
                            *volgende_element += 1;
                            veren.insert(element.to_string(), ConnectorElement {
                                id: element, node_i: station.knoop, node_j: id, k_axial: k,
                                k_shear: 0.0, k_moment: 0.0, k_shear_z: 0.0, k_bend_y: 0.0, k_bend_z: 0.0,
                            });
                            grond.knopen.insert(id);
                            grond.veren.insert(element);
                        }
                    }
                }
            }
        }
        for (knoop, k) in oplegveren {
            opleggingen.insert(format!("bedding-{knoop}"), steun(knoop, false, k));
        }
        grond
    }

    /// Zakking en grondlast per rekenknoop, uit de verplaatsingen van de kern.
    pub fn resultaat(&self, los: &Los, verplaatsing: &HashMap<usize, [f64; 6]>) -> Vec<MemberBedding3D> {
        let mut uit: Vec<MemberBedding3D> = self.staven.iter().map(|staaf| {
            let mut totaal = 0.0;
            let mut los_lengte = 0.0;
            let points: Vec<BeddingPoint3D> = staaf.stations.iter().enumerate().map(|(index, station)| {
                let u = verplaatsing.get(&station.knoop).copied().unwrap_or([0.0; 6]);
                let zakking = -u[2];
                let actief = staaf.actief(index, los);
                let druk = if staaf.kb > 0.0 && actief {
                    totaal += staaf.kb * station.lengte * zakking;
                    let druk = staaf.kb * zakking;
                    // Een actieve veer bij alleen druk staat binnen de statusgrens
                    // op druk; afronding laat geen negatieve druk zien.
                    if staaf.alleen_druk { druk.max(0.0) } else { druk }
                } else {
                    0.0
                };
                if !actief { los_lengte += station.lengte; }
                let zijdelings = (staaf.kb_zij > 0.0).then(|| {
                    if staaf.rondom {
                        // De grootte van de grondkracht loodrecht op de as.
                        let v = [u[0], u[1], u[2]];
                        staaf.kb_zij * staaf.zijdelings.iter().map(|d| dot(v, *d).powi(2)).sum::<f64>().sqrt()
                    } else {
                        // De grond duwt tegen de verplaatsing in: −k·b·(u·n) langs n.
                        -staaf.kb_zij * dot([u[0], u[1], u[2]], staaf.zijdelings[0])
                    }
                });
                BeddingPoint3D {
                    t: station.s / staaf.lengte,
                    settlement_m: zakking,
                    pressure_kn_per_m: druk,
                    lateral_kn_per_m: zijdelings,
                    active: actief,
                }
            }).collect();
            let max_druk = points.iter().map(|p| p.pressure_kn_per_m).fold(f64::NEG_INFINITY, f64::max);
            let min_druk = points.iter().map(|p| p.pressure_kn_per_m).fold(f64::INFINITY, f64::min);
            let max_zakking = points.iter().map(|p| p.settlement_m).fold(f64::NEG_INFINITY, f64::max);
            MemberBedding3D {
                member_id: staaf.member_id,
                points,
                max_pressure_kn_per_m: max_druk,
                min_pressure_kn_per_m: min_druk,
                max_settlement_m: max_zakking,
                total_reaction_kn: totaal,
                lifted_fraction: (los_lengte / staaf.lengte).clamp(0.0, 1.0),
            }
        }).collect();
        uit.sort_by_key(|staaf| staaf.member_id);
        uit
    }

    /// Per staaf op bedding de kracht van de grond op de staaf in elke
    /// rekenknoop, in de lokale assen van de staaf (x, y, z), voor `correctie`.
    pub fn grondkrachten_lokaal(&self, los: &Los, verplaatsing: &HashMap<usize, [f64; 6]>) -> HashMap<usize, Vec<V3>> {
        self.staven.iter().map(|staaf| {
            let [ex, ey, ez] = staaf.assen;
            let krachten = staaf.stations.iter().enumerate().map(|(index, station)| {
                let u = verplaatsing.get(&station.knoop).copied().unwrap_or([0.0; 6]);
                let kracht = staaf.grondkracht(index, los, u);
                [dot(kracht, ex), dot(kracht, ey), dot(kracht, ez)]
            }).collect();
            (staaf.member_id, krachten)
        }).collect()
    }
}

/// De grond als verdeelde last in de normaal- en dwarskrachten van een staaf
/// op bedding: de correctie (ΔN, ΔVy, ΔVz) in deel `deel` (van rekenknoop
/// `deel` naar `deel + 1`, lengte h) op afstand x van het begin van dat deel.
///
/// De kern zet de grond als veren op de rekenknopen. In zijn snedekrachten
/// springt de dwarskracht daar met de veerkracht en is zij ertussen constant
/// (zonder staaflast). Aan een staafeinde en naast een puntlast op een knoop
/// staat dan de dwarskracht van het halve deel ernaast: bij een vrij eind niet
/// 0 maar de veerkracht van dat eind, naast een kolom de halve sprong te
/// weinig, een fout van orde λh/2 (bij h = 0,15/λ tot ruim 7 %). De veer van
/// rekenknoop i staat voor de grond over haar eigen lengte L_i (de halve delen
/// ernaast); verdeeld over die lengte wordt het
///   ΔV(x) = −F_i·max(0, h/2 − x)/L_i + F_{i+1}·max(0, x − h/2)/L_{i+1}
/// voor Vy en Vz (de kern: dV/dx = +q) en ΔN met het tegengestelde teken voor
/// de axiale component (N trek-positief, dN/dx = −q_x). Midden in elk deel
/// blijft de waarde van de kern staan; aan een vrij eind wordt de dwarskracht
/// 0 en bij een puntlast op een knoop springt zij alleen nog met die last. De
/// momenten blijven die van de kern: hun fout is van orde (λh)².
pub(crate) fn correctie(staaf: &Staaf, krachten: &[V3], deel: usize, x: f64) -> V3 {
    let h = staaf.stations[deel + 1].s - staaf.stations[deel].s;
    let links = scale(krachten[deel], -(h / 2.0 - x).max(0.0) / staaf.stations[deel].lengte);
    let rechts = scale(krachten[deel + 1], (x - h / 2.0).max(0.0) / staaf.stations[deel + 1].lengte);
    let dv = add(links, rechts);
    [-dv[0], dv[1], dv[2]]
}

/// Een oplegging van de bedding: volledig vast (grondknoop) of met veren in X, Y, Z.
pub(crate) fn steun(node_id: usize, vast: bool, k: [f64; 3]) -> SolverSupport3D {
    let veer = |waarde: f64| (waarde > 0.0).then_some(waarde);
    SolverSupport3D {
        node_id,
        rx: vast, ry: vast, rz: vast, rrx: vast, rry: vast, rrz: vast,
        kx: veer(k[0]), ky: veer(k[1]), kz: veer(k[2]),
        krx: None, kry: None, krz: None,
        dx: None, dy: None, dz: None, drx: None, dry: None, drz: None,
        rw: None, kw: None, normal_x: None, normal_y: None, normal_z: None,
        is_inclined: None,
    }
}

/// Heeft het verzoek een staaf op bedding met alleen druk (en een verticale bedding)?
pub(crate) fn met_alleen_druk(request: &SolveRequest3D) -> bool {
    request.members.iter().any(|staaf| staaf.bedding.as_ref()
        .is_some_and(|bedding| bedding.compression_only && bedding.k_kn_per_m3.is_some()))
}

/// De nieuwe set weggevallen veren na één berekening (alleen druk), van
/// staven en van platen op bedding (`plaatbedding::nieuwe_los`).
pub(crate) fn nieuwe_los(request: &SolveRequest3D, uitkomst: &SolveResult3D, los: &Los) -> Los {
    let druk: HashSet<usize> = request.members.iter()
        .filter(|staaf| staaf.bedding.as_ref().is_some_and(|b| b.compression_only && b.k_kn_per_m3.is_some()))
        .map(|staaf| staaf.id)
        .collect();
    // Ruis in de zakking schaalt met de grootste verplaatsing van het model.
    let schaal = uitkomst.bedding.iter().flat_map(|b| b.points.iter()).map(|p| p.settlement_m.abs())
        .chain(uitkomst.plate_bedding.iter().flat_map(|b| b.nodes.iter()).map(|n| n.settlement_m.abs()))
        .chain(uitkomst.displacements.iter().flat_map(|d| [d.ux.abs(), d.uy.abs(), d.uz.abs()]))
        .fold(0.0, f64::max);
    let grens = STATUSGRENS * schaal;
    let mut nieuw = Los::new();
    for staaf in uitkomst.bedding.iter().filter(|b| druk.contains(&b.member_id)) {
        for (index, punt) in staaf.points.iter().enumerate() {
            let sleutel = (staaf.member_id, index);
            let blijft_los = if los.staven.contains(&sleutel) { punt.settlement_m <= grens } else { punt.settlement_m < -grens };
            if blijft_los { nieuw.staven.insert(sleutel); }
        }
    }
    nieuw.platen = crate::plaatbedding::nieuwe_los(request, uitkomst, los, grens);
    nieuw
}

/// De staven met weggevallen veren, oplopend.
pub(crate) fn staven_met_los(los: &Los) -> Vec<usize> {
    los.staven.iter().map(|(staaf, _)| *staaf).collect::<BTreeSet<_>>().into_iter().collect()
}

/// Opleggingsrichtingen van de bedding voor de controle op de opleggingen:
/// (beginknoop van de staaf, punt, richting). Een rij veren langs een rechte
/// staaf houdt hetzelfde tegen als de veren in de eerste en de laatste ervan,
/// dus volstaan die twee punten per richting.
pub(crate) fn steunen(request: &SolveRequest3D, los: &Los) -> Vec<(usize, V3, V3)> {
    let Ok(plan) = Plan::bouw(request) else { return vec![] };
    let mut uit = Vec::new();
    for staaf in &plan.staven {
        let Some(member) = request.members.iter().find(|m| m.id == staaf.member_id) else { continue };
        let start = member.start_node_id;
        if staaf.kb > 0.0 {
            let actief: Vec<&Station> = staaf.stations.iter().enumerate()
                .filter(|(index, _)| staaf.actief(*index, los))
                .map(|(_, station)| station)
                .collect();
            if let (Some(eerste), Some(laatste)) = (actief.first(), actief.last()) {
                uit.push((start, eerste.punt, Z));
                if laatste.s > eerste.s { uit.push((start, laatste.punt, Z)); }
            }
        }
        let (eerste, laatste) = (&staaf.stations[0], staaf.stations.last().unwrap());
        for d in &staaf.zijdelings {
            uit.push((start, eerste.punt, *d));
            uit.push((start, laatste.punt, *d));
        }
    }
    uit
}

/// Vóór een ronde met weggevallen veren: houdt het model zonder die veren nog
/// stand? Zo niet, en zat dezelfde beweging met alle veren wel vast, dan is
/// het loskomen de oorzaak en volgt een melding met de vrije beweging.
pub(crate) fn controleer_contact(request: &SolveRequest3D, uitgesloten: &HashSet<usize>, los: &Los) -> Result<(), String> {
    if los.is_empty() { return Ok(()); }
    let tekort: Vec<_> = crate::opleggingen::controleer_bij(request, uitgesloten, los)
        .into_iter().filter(|bevinding| bevinding.tekort()).collect();
    if tekort.is_empty() { return Ok(()); }
    if crate::opleggingen::controleer(request, uitgesloten).iter().any(|bevinding| bevinding.tekort()) {
        // Het model was met alle veren al onvoldoende opgelegd; de kern beslist.
        return Ok(());
    }
    let soort = soort_los(los);
    Err(format!(
        "bedding (alleen druk): {} komt los van de grond en zonder de weggevallen veren is het model niet meer opgelegd. {} De belasting tilt of kantelt de {soort} van de grond. Geef de {soort} een oplegging die ook trek opneemt, of reken de bedding zonder alleen druk.",
        beschrijf_los(los),
        crate::opleggingen::beschrijf(&tekort),
    ))
}

/// Meldregels over de bedding: de rekenknopen en, bij alleen druk, de losse lengte.
pub(crate) fn diagnose(request: &SolveRequest3D, uitkomst: &SolveResult3D, rondes: Option<usize>) -> Vec<String> {
    if uitkomst.bedding.is_empty() { return vec![]; }
    let Ok(plan) = Plan::bouw(request) else { return vec![] };
    let delen: Vec<String> = plan.staven.iter().take(8)
        .map(|staaf| format!("staaf {} in {} delen", staaf.member_id, staaf.delen())).collect();
    let meer = if plan.staven.len() > 8 { format!(" en {} andere", plan.staven.len() - 8) } else { String::new() };
    let mut regels = vec![format!(
        "Bedding: {}{meer}, met per rekenknoop een grondveer k·b·L_trib (deellengte hoogstens 0,15/λ).",
        delen.join(", "),
    )];
    let druk: Vec<&MemberBedding3D> = uitkomst.bedding.iter()
        .filter(|b| plan.staaf(b.member_id).is_some_and(|staaf| staaf.alleen_druk))
        .collect();
    if !druk.is_empty() {
        let los: Vec<String> = druk.iter().filter(|b| b.lifted_fraction > 0.0).take(8)
            .map(|b| format!("staaf {} over {:.0} % van de lengte", b.member_id, 100.0 * b.lifted_fraction))
            .collect();
        let rondes = rondes.map(|n| format!("; {n} statusronde(s)")).unwrap_or_default();
        regels.push(if los.is_empty() {
            format!("Bedding alleen druk: overal contact met de grond{rondes}.")
        } else {
            format!("Bedding alleen druk: los van de grond ligt {}{rondes}.", los.join(", "))
        });
    }
    regels
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AnalysisKind, Bedding3D, Material3D, Section3D};

    fn verzoek(eind: V3, bedding: Bedding3D, iy: f64, iz: f64, rol: Option<f64>, tussen: Vec<Node3D>) -> SolveRequest3D {
        let mut nodes = vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: eind[0], y: eind[1], z: eind[2] }];
        let tussenknopen = tussen.iter().map(|k| k.id).collect();
        nodes.extend(tussen);
        SolveRequest3D {
            schema_version: 2, analysis: AnalysisKind::Linear, nodes,
            materials: vec![Material3D { id: 1, name: "staal".into(), e_mpa: 210_000.0, nu: 0.3, g_mpa: None, alpha_per_k: None }],
            sections: vec![Section3D { id: 1, name: "s".into(), area_m2: 0.01, iy_m4: iy, iz_m4: iz,
                torsion_j_m4: 1e-5, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }],
            members: vec![Member3D { id: 1, start_node_id: 1, end_node_id: 2, material_id: 1, section_id: 1,
                releases: Default::default(), roll_angle_rad: rol, intermediate_node_ids: tussenknopen,
                tension_only: false, bedding: Some(bedding), part_section_ids: None }],
            supports: vec![], nodal_loads: vec![], member_loads: vec![], member_point_loads: vec![],
            thermal_loads: vec![], plates: vec![], shell_elements: vec![], surface_loads: vec![], diaphragms: vec![], node_links: vec![],
            tension_only_fit: None, tension_only_cross_rule: false, max_iterations: 50, tolerance: 1e-8, buckling_modes: 0,
        }
    }

    fn bed(k: Option<f64>, k_lat: Option<f64>) -> Bedding3D {
        Bedding3D { k_kn_per_m3: k, width_m: 1.0, k_lateral_kn_per_m3: k_lat, compression_only: false }
    }

    /// n = ⌈L·λ/0,15⌉ met λ uit I_y voor de verticale veer van een liggende staaf.
    #[test]
    fn delen_volgen_de_deellengte_met_minimum_en_maximum() {
        let ei: f64 = 210e6 * 2e-4;
        let k = 40_000.0;
        let lam: f64 = (k / (4.0 * ei)).powf(0.25);
        let plan = Plan::bouw(&verzoek([10.0, 0.0, 0.0], bed(Some(k), None), 2e-4, 1e-4, None, vec![])).unwrap();
        assert_eq!(plan.staven[0].delen(), (10.0 * lam / 0.15).ceil() as usize);
        // Kort en stijf: minstens 8 delen; lang en slap: hoogstens 200.
        let kort = Plan::bouw(&verzoek([0.5, 0.0, 0.0], bed(Some(1.0), None), 1.0, 1.0, None, vec![])).unwrap();
        assert_eq!(kort.staven[0].delen(), 8);
        let lang = Plan::bouw(&verzoek([500.0, 0.0, 0.0], bed(Some(1e6), None), 1e-6, 1e-6, None, vec![])).unwrap();
        assert_eq!(lang.staven[0].delen(), 200);
        // De tributaire lengten tellen op tot de staaflengte; de einden een half deel.
        let staaf = &plan.staven[0];
        let som: f64 = staaf.stations.iter().map(|s| s.lengte).sum();
        assert!((som - 10.0).abs() < 1e-12);
        let h = 10.0 / staaf.delen() as f64;
        assert!((staaf.stations[0].lengte - h / 2.0).abs() < 1e-12);
        assert!((staaf.stations[1].lengte - h).abs() < 1e-12);
        // Nieuwe rekenknopen boven de hoogste knoop-id, de einden blijven modelknopen.
        assert_eq!((staaf.stations[0].knoop, staaf.stations.last().unwrap().knoop), (1, 2));
        assert!(staaf.stations[1..staaf.stations.len() - 1].iter().all(|s| s.nieuw && s.knoop > 2));
    }

    /// Met een rol van 90° buigt een verticale last om de zwakke as: λ uit I_z.
    #[test]
    fn de_rolhoek_kiest_de_traagheid() {
        let k = 40_000.0;
        let (iy, iz) = (8e-4, 1e-4);
        let zonder = Plan::bouw(&verzoek([20.0, 0.0, 0.0], bed(Some(k), None), iy, iz, None, vec![])).unwrap();
        let met = Plan::bouw(&verzoek([20.0, 0.0, 0.0], bed(Some(k), None), iy, iz, Some(std::f64::consts::FRAC_PI_2), vec![])).unwrap();
        let delen = |i: f64| (20.0 * (k / (4.0 * 210e6 * i)).powf(0.25) / 0.15).ceil() as usize;
        assert_eq!(zonder.staven[0].delen(), delen(iy));
        assert_eq!(met.staven[0].delen(), delen(iz));
        // Een zijdelingse veer op een liggende staaf buigt om de zwakke as.
        let zij = Plan::bouw(&verzoek([20.0, 0.0, 0.0], bed(None, Some(k)), iy, iz, None, vec![])).unwrap();
        assert_eq!(zij.staven[0].delen(), delen(iz));
        assert_eq!(zij.staven[0].zijdelings, vec![[0.0, 1.0, 0.0]]);
    }

    /// Een bestaande tussenknoop blijft rekenknoop; een deelpunt vlak ernaast vervalt.
    #[test]
    fn bestaande_tussenknopen_blijven_rekenknoop() {
        let k = 40_000.0;
        let plan = Plan::bouw(&verzoek([10.0, 0.0, 0.0], bed(Some(k), None), 2e-4, 1e-4, None,
            vec![Node3D { id: 7, x: 5.01, y: 0.0, z: 0.0 }])).unwrap();
        let staaf = &plan.staven[0];
        let h = 10.0 / ((10.0 * (k / (4.0 * 210e6 * 2e-4)).powf(0.25) / 0.15).ceil());
        let zeven = staaf.stations.iter().position(|s| s.knoop == 7).expect("tussenknoop 7");
        assert!(!staaf.stations[zeven].nieuw);
        for paar in staaf.stations.windows(2) {
            assert!(paar[1].s - paar[0].s > 0.25 * h - 1e-12, "geen te kort deel");
        }
        let som: f64 = staaf.stations.iter().map(|s| s.lengte).sum();
        assert!((som - 10.0).abs() < 1e-12);
    }

    /// Een paal: zijdelingse veren in X en Y, geen verticale veer.
    #[test]
    fn een_paal_veert_in_x_en_y() {
        let plan = Plan::bouw(&verzoek([0.0, 0.0, -12.0], bed(None, Some(20_000.0)), 5e-4, 5e-4, None, vec![])).unwrap();
        let staaf = &plan.staven[0];
        assert!(staaf.rondom);
        assert_eq!(staaf.kb, 0.0);
        assert_eq!(staaf.zijdelings, vec![[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]);
    }

    /// Steiler dan 45° werkt de zijdelingse bedding rondom: twee eenheidsrichtingen
    /// loodrecht op de as en op elkaar. Vlakker alleen de horizontale normaal.
    #[test]
    fn zijdelings_rondom_vanaf_45_graden() {
        let richtingen = |graden: f64| {
            let (c, s) = (graden.to_radians().cos(), graden.to_radians().sin());
            let plan = Plan::bouw(&verzoek([10.0 * c, 0.0, -10.0 * s], bed(None, Some(20_000.0)), 5e-4, 5e-4, None, vec![])).unwrap();
            let staaf = &plan.staven[0];
            (staaf.rondom, staaf.zijdelings.clone(), [c, 0.0, -s])
        };
        let (rondom_, lijst, _) = richtingen(44.0);
        assert!(!rondom_);
        assert_eq!(lijst.len(), 1);
        assert!((lijst[0][1].abs() - 1.0).abs() < 1e-15, "horizontaal loodrecht op het schoorvlak: {lijst:?}");
        for graden in [46.0, 71.565, 80.0] {
            let (rondom_, lijst, ex) = richtingen(graden);
            assert!(rondom_, "{graden}°");
            assert_eq!(lijst.len(), 2, "{graden}°");
            for d in &lijst {
                assert!((norm(*d) - 1.0).abs() < 1e-14 && dot(*d, ex).abs() < 1e-14, "{graden}°: {d:?} loodrecht op de as");
            }
            assert!(dot(lijst[0], lijst[1]).abs() < 1e-14, "{graden}°: onderling loodrecht");
            assert!((lijst[1][1] - 1.0).abs() < 1e-14, "{graden}°: de tweede loodrecht op het schoorvlak: {lijst:?}");
        }
    }

    #[test]
    fn een_schuine_normaal_ligt_niet_op_een_as() {
        assert_eq!(globale_as([0.0, 1.0, 0.0]), Some(1));
        assert_eq!(globale_as([-1.0, 0.0, 0.0]), Some(0));
        assert_eq!(globale_as(normaal([0.8, 0.6, 0.0])), None);
        let n = normaal([0.8, 0.6, 0.0]);
        assert!((n[0] + 0.6).abs() < 1e-15 && (n[1] - 0.8).abs() < 1e-15 && n[2] == 0.0);
    }
}
