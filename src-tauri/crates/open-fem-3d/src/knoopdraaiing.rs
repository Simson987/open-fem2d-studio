//! Knoopdraaiingen zonder stijfheid (#96).
//!
//! Een staafeind waarvan My en Mz zijn vrijgegeven (de knop Scharnierend)
//! geeft zijn knoop geen buigstijfheid: de kern condenseert het scharnier
//! binnen het element en laat die rijen van de stijfheidsmatrix leeg. Ligt
//! zo'n staaf direct op opleggingen die de draaiing vrijlaten, of komen in een
//! knoop alleen scharnierende staafeinden samen, dan krijgt de knoopdraaiing
//! in sommige richtingen van geen enkel element stijfheid en is de
//! stijfheidsmatrix singulier. Constructief is er niets mis: die draaiing is
//! onbepaald, vervormt niets en heeft geen invloed op de rest.
//!
//! Draaistijfheid uit de structuur (niet uit de getallen van de kern). Bij
//! stilstaande translaties houdt in een knoop tegen:
//! - een staafeind: de draaiing om lokaal y, tenzij My daar is vrijgegeven, en
//!   om lokaal z, tenzij Mz daar is vrijgegeven (de lokale assen van de kern,
//!   met de rolhoek). Een volledige buigstaaf zonder translatie houdt beide
//!   einddraaiingen vast; met één vrij einde alleen het andere;
//! - torsie: (θ_j − θ_i)·e_x = 0 tussen begin- en eindknoop, tenzij één van
//!   beide einden voor torsie is vrijgegeven; dan draagt de kern geen torsie;
//! - een plaat- of schaalelement (MITC4 met draaiveer, DKT): alle drie de
//!   draaiingen van zijn knopen;
//! - een oplegging met een vaste draairichting of een rotatieveer: die
//!   globale richting;
//! - een starre schijf (`schijven`): de draaiing om Z van haar knopen volgt
//!   de schijf, die zonder verschuivingen niet draait; de schijf telt dus als
//!   draaistijfheid om Z, niet om X en Y;
//! - veerelementen (de grondveren van een bedding, #106) alleen translatie.
//! Elementen en koppelingen die de adapter niet zelf maakt, tellen voor de
//! zekerheid als draaistijfheid in alle richtingen: dan verandert er niets.
//!
//! Vrije draaiingen. De vastgehouden ruimte Z bestaat uit alle
//! knoopdraaiingen bij stilstaande translaties die aan al deze voorwaarden
//! voldoen. Per knoop is dat eerst de nulruimte V van zijn eigen voorwaarden
//! (de richtingen waarin zijn 3×3-draaistijfheid nul is, ook schuin bij een
//! schuine staaf). De torsie koppelt knopen: een staaf die torsie overdraagt
//! maar aan beide einden scharnierend op knopen zonder andere draaistijfheid
//! ligt (een ligger op twee scharnieropleggingen) kan als geheel om haar as
//! draaien, en in een vakwerk van scharnierende staven die torsie overdragen
//! draaien de knopen samen zonder dat een staaf tordeert. Per knoop splitst V
//! zich in F (loodrecht op alle torsieassen: een vrije draaiing van die knoop
//! alleen) en E (de richtingen die de torsie met de buren koppelt); de
//! gezamenlijke draaiingen zijn de nulruimte van de torsievoorwaarden in E.
//! Z is zo precies het deel van de nulruimte van K zonder translaties. Zo'n
//! beweging vervormt geen element, dus ook de geometrische stijfheid K_G van
//! de tweede orde en de knik werkt er niet op.
//!
//! Vastzetten. De kern kent geen schuine draaiopleggingen: een schuine
//! oplegging (`is_inclined`) draait alleen de translaties, en een
//! koppelvoorwaarde (`LinearMPC`) zou elk model met een scharnier naar het
//! rekenpad met koppelingen sturen. Daarom krijgt Z evenveel gewone
//! draaiblokkeringen (rx, ry of rz van een knoop) als Z dimensies heeft,
//! gekozen met volledige pivotering zodat de blokkeringen Z precies vastleggen:
//! beperkt tot Z zijn ze inverteerbaar, dus de vrijgebleven draaiingen vormen
//! een complement van Z. Dat is gelijkwaardig aan een oplegging precies langs
//! Z: voor z in Z is K·z = 0 en (K + K_G)·z = 0, dus de kunstmatige reacties R
//! voldoen aan z·R = z·F. Heeft de belasting F geen component langs Z, dan is
//! R = 0 en verandert geen enkele andere vrijheidsgraad: de translaties, de
//! krachten en het fysische deel van de draaiingen zijn die van het model
//! zonder blokkering. Alleen het onbepaalde Z-deel van de knoopdraaiingen ligt
//! vast; in de uitvoer staat de kleinste draaiing die bij de oplossing past
//! (het Z-deel eraf geprojecteerd).
//!
//! Nazien. Na het oplossen horen de reacties van deze blokkeringen nul te zijn
//! (binnen afrondingsruis: `RUIS` maal de grootste kracht maal de
//! modelafmeting of het grootste moment). Is er een die dat niet is, dan zet
//! de belasting een moment langs Z, bijvoorbeeld een knoopmoment op een
//! scharnierende knoop of torsie op een staaf die vrij om haar as kan draaien:
//! een echt mechanisme, en dan volgt een fout in plaats van een uitkomst.
//!
//! Een mechanisme mét translaties (drie scharnieren op een lijn, een raam met
//! scharnierende voeten en een scharnierende ligger zonder verband, een deel
//! dat onvoldoende is opgelegd) hoort niet bij Z: de stijfheidsmatrix blijft
//! daar singulier. De kern merkt dat niet altijd op. Vóór deze regel faalde
//! zo'n model al op de vrije draaiingen, waarvan de rijen precies nul zijn;
//! met de blokkeringen is de spil langs het mechanisme afrondingsruis, en
//! stoot de belasting het niet aan, dan vindt de kern een oplossing met een
//! klein residu. De adapter controleert daarom na iedere 3D-oplossing met
//! proefbelastingen op alle vrije vrijheidsgraden of de stijfheidsmatrix
//! regulier is (#110, sinds #195 in `mechanisme`). Zo niet, dan geldt
//! dezelfde afspraak als voor deze regel: stoot de belasting de vrije
//! beweging niet aan, dan een uitkomst met een melding die haar noemt (de
//! verplaatsingen langs haar de kleinste die bij de krachten passen); stoot
//! zij haar wel aan, dan een fout. Tot #195 was zo'n mechanisme altijd een
//! fout. `mechanisme` zoekt het in het kernmodel met de blokkeringen van
//! deze regel erin.
//!
//! De blokkeringen verschijnen niet bij de reacties; een melding noemt de
//! modelknopen met een vastgehouden draaiing. De controle op de opleggingen
//! (`opleggingen`, #64) telt de draaiing van een recht deel om zijn eigen as,
//! die deze regel vasthoudt, niet meer als vrije beweging.
//!
//! Geen `HashMap` of `HashSet` in deze module: elke nieuwe map schuift de
//! hashsleutels van de maps die daarna in deze draad ontstaan (ook in de
//! kern). De kerninvoer van een model zonder vrije knoopdraaiing blijft
//! daarbij ongewijzigd.

use std::collections::{BTreeMap, BTreeSet};

use rekenkern::{
    element::compute_local_axes_3d,
    types::{AnalysisResults3D, Constraint, SolverInput3D, SolverLoad3D, SolverSupport3D},
};

use crate::opleggingen::{eigen, noem};
use crate::shell::{add, dot, norm, scale, sub, V3};
use crate::SolveRequest3D;

/// Een richting heeft (geen) draaistijfheid boven (onder) deze relatieve
/// grootte; voor een kwadratische grootheid geldt TOL².
const TOL: f64 = 1e-5;
/// Kleinste spil bij het oplossen van de torsievoorwaarden (genormeerde rijen).
const SPIL: f64 = 1e-8;
/// Waarden onder deze grens vallen bij het elimineren weg (afrondingsruis).
const NUL: f64 = 1e-13;
/// Een kunstmatige reactie telt als nul onder dit deel van de grootste kracht
/// (maal de modelafmeting) of het grootste moment. Afrondingsruis van de kern
/// ligt in de orde n·ε ≈ 1e-13; deze grens laat daar ruim marge boven en laat
/// een klein echt moment op een vrije draaiing niet weg (#96).
pub(crate) const RUIS: f64 = 1e-10;
const ASSEN: [&str; 3] = ["X", "Y", "Z"];

fn eenheid(as_: usize) -> V3 {
    let mut e = [0.0; 3];
    e[as_] = 1.0;
    e
}

/// Orthonormale basis van de richtingen die `rijen` (eenheidsvectoren) niet
/// tegenhouden: de nulruimte van Σ r·rᵀ.
fn vrij(rijen: &[V3]) -> Vec<V3> {
    let mut gram = vec![vec![0.0; 3]; 3];
    for r in rijen {
        for a in 0..3 {
            for b in 0..3 { gram[a][b] += r[a] * r[b]; }
        }
    }
    let (waarden, vectoren) = eigen(gram);
    (0..3).filter(|i| waarden[*i] <= TOL * TOL)
        .map(|i| [vectoren[i][0], vectoren[i][1], vectoren[i][2]])
        .collect()
}

/// Lengte van de projectie van `richting` op de ruimte met orthonormale basis `basis`.
fn deel(basis: &[V3], richting: V3) -> f64 {
    basis.iter().map(|b| dot(*b, richting).powi(2)).sum::<f64>().sqrt()
}

/// Een vastgehouden draaiing: per knoop-id de draaivector.
pub(crate) type Vorm = BTreeMap<usize, V3>;

fn inproduct(a: &Vorm, b: &Vorm) -> f64 {
    a.iter().filter_map(|(knoop, v)| b.get(knoop).map(|w| dot(*v, *w))).sum()
}

/// a −= f·b
fn verminder(a: &mut Vorm, f: f64, b: &Vorm) {
    for (knoop, w) in b {
        let v = a.entry(*knoop).or_insert([0.0; 3]);
        *v = sub(*v, scale(*w, f));
    }
}

/// Knopen waarvan de vrije draaiingen samenhangen, met hun blokkeringen.
#[derive(Debug, Clone)]
struct Groep {
    /// Knoop-id's, oplopend.
    knopen: Vec<usize>,
    /// Kunstmatige draaiblokkeringen (knoop-id, globale as 0–2).
    vast: Vec<(usize, usize)>,
    /// Draaien meer knopen samen (via torsie)?
    samen: bool,
    /// Heeft een knoop een eigen vrije draaiing (F)?
    enkel: bool,
}

/// De vastgehouden knoopdraaiingen van één kernmodel.
#[derive(Debug, Clone, Default)]
pub(crate) struct Vastzetting {
    groepen: Vec<Groep>,
    /// Orthonormale basis van alle vastgehouden draaiingen Z.
    basis: Vec<Vorm>,
    /// Knopen die in de kern pas door deze regel een oplegging krijgen.
    nieuw: BTreeSet<usize>,
}

/// Unie-zoekstructuur over knoopindices.
struct Unie(Vec<usize>);

impl Unie {
    fn wortel(&mut self, mut i: usize) -> usize {
        while self.0[i] != i {
            let ouder = self.0[self.0[i]];
            self.0[i] = ouder;
            i = ouder;
        }
        i
    }

    fn verbind(&mut self, a: usize, b: usize) {
        let (a, b) = (self.wortel(a), self.wortel(b));
        if a != b { self.0[a.max(b)] = a.min(b); }
    }
}

impl Vastzetting {
    /// Geen vrije knoopdraaiing: het kernmodel blijft zoals het was.
    pub(crate) fn is_leeg(&self) -> bool { self.groepen.is_empty() }

    /// Bepaal de vrije knoopdraaiingen van het kernmodel en de blokkeringen die
    /// ze vastleggen.
    pub(crate) fn bepaal(input: &SolverInput3D) -> Self {
        let mut knopen: Vec<(usize, V3)> = input.nodes.values().map(|k| (k.id, [k.x, k.y, k.z])).collect();
        knopen.sort_by_key(|(id, _)| *id);
        let ids: Vec<usize> = knopen.iter().map(|(id, _)| *id).collect();
        let punt: Vec<V3> = knopen.iter().map(|(_, p)| *p).collect();
        let index: BTreeMap<usize, usize> = ids.iter().enumerate().map(|(i, id)| (*id, i)).collect();
        let n = ids.len();
        let alle = [eenheid(0), eenheid(1), eenheid(2)];
        let mut rijen: Vec<Vec<V3>> = vec![Vec::new(); n];
        let mut in_element = vec![false; n];
        // Alle drie de draaiingen van deze knopen tegengehouden.
        let overal = |knopen: &[usize], rijen: &mut Vec<Vec<V3>>, in_element: &mut Vec<bool>| {
            for id in knopen {
                if let Some(&k) = index.get(id) {
                    in_element[k] = true;
                    rijen[k].extend(alle);
                }
            }
        };

        // Staven: buiging per einde, torsie tussen de einden.
        let mut torsie: Vec<(usize, usize, V3)> = Vec::new();
        let links = input.left_hand.unwrap_or(false);
        let mut staven: Vec<_> = input.elements.values().collect();
        staven.sort_by_key(|staaf| staaf.id);
        for staaf in staven {
            let (Some(&i), Some(&j)) = (index.get(&staaf.node_i), index.get(&staaf.node_j)) else { continue };
            if staaf.elem_type != "frame" {
                overal(&[staaf.node_i, staaf.node_j], &mut rijen, &mut in_element);
                continue;
            }
            in_element[i] = true;
            in_element[j] = true;
            let (a, b) = (punt[i], punt[j]);
            let (ex, ey, ez) = compute_local_axes_3d(
                a[0], a[1], a[2], b[0], b[1], b[2],
                staaf.local_yx, staaf.local_yy, staaf.local_yz, staaf.roll_angle, links,
            );
            if !staaf.release_my_start { rijen[i].push(ey); }
            if !staaf.release_mz_start { rijen[i].push(ez); }
            if !staaf.release_my_end { rijen[j].push(ey); }
            if !staaf.release_mz_end { rijen[j].push(ez); }
            if !staaf.release_t_start && !staaf.release_t_end { torsie.push((i, j, ex)); }
        }
        // Platen en andere elementen: alle draaiingen.
        for plaat in input.plates.values() { overal(&plaat.nodes, &mut rijen, &mut in_element); }
        for plaat in input.quads.values() { overal(&plaat.nodes, &mut rijen, &mut in_element); }
        for plaat in input.quad9s.values() { overal(&plaat.nodes, &mut rijen, &mut in_element); }
        for plaat in input.solid_shells.values() { overal(&plaat.nodes, &mut rijen, &mut in_element); }
        for plaat in input.curved_shells.values() { overal(&plaat.nodes, &mut rijen, &mut in_element); }
        for boog in &input.curved_beams {
            overal(&[boog.node_start, boog.node_mid, boog.node_end], &mut rijen, &mut in_element);
        }
        // Veerelementen: alleen translatie, tenzij ze ook draaistijfheid hebben.
        for veer in input.connectors.values() {
            if veer.k_moment > 0.0 || veer.k_bend_y > 0.0 || veer.k_bend_z > 0.0 {
                overal(&[veer.node_i, veer.node_j], &mut rijen, &mut in_element);
            } else {
                for id in [veer.node_i, veer.node_j] {
                    if let Some(&k) = index.get(&id) { in_element[k] = true; }
                }
            }
        }
        // Opleggingen: vaste draairichtingen en rotatieveren.
        for steun in input.supports.values() {
            let Some(&k) = index.get(&steun.node_id) else { continue };
            for (as_, (vast, veer)) in [(steun.rrx, steun.krx), (steun.rry, steun.kry), (steun.rrz, steun.krz)].into_iter().enumerate() {
                if vast || veer.is_some_and(|waarde| waarde > 0.0) { rijen[k].push(eenheid(as_)); }
            }
        }
        // Koppelingen: een schijf houdt de draaiing loodrecht op haar vlak vast;
        // andere koppelingen voor de zekerheid alle draaiingen.
        for koppeling in &input.constraints {
            let as_van = |id: usize, as_: usize, rijen: &mut Vec<Vec<V3>>| {
                if let Some(&k) = index.get(&id) { rijen[k].push(eenheid(as_)); }
            };
            match koppeling {
                Constraint::Diaphragm(schijf) => {
                    let as_ = match schijf.plane.as_str() { "XZ" => 1, "YZ" => 0, _ => 2 };
                    for id in std::iter::once(schijf.master_node).chain(schijf.slave_nodes.iter().copied()) {
                        as_van(id, as_, &mut rijen);
                    }
                }
                Constraint::EqualDOF(gelijk) => {
                    for dof in gelijk.dofs.iter().filter(|dof| (3..6).contains(*dof)) {
                        as_van(gelijk.master_node, dof - 3, &mut rijen);
                        as_van(gelijk.slave_node, dof - 3, &mut rijen);
                    }
                }
                Constraint::RigidLink(link) => overal(&[link.master_node, link.slave_node], &mut rijen, &mut in_element),
                Constraint::EccentricConnection(link) => overal(&[link.master_node, link.slave_node], &mut rijen, &mut in_element),
                Constraint::LinearMPC(mpc) => {
                    let knopen: Vec<usize> = mpc.terms.iter().map(|term| term.node_id).collect();
                    overal(&knopen, &mut rijen, &mut in_element);
                }
            }
        }

        // V per knoop; een knoop zonder element valt erbuiten (die controle
        // hoort bij de opleggingen, #64).
        let mut v: Vec<Vec<V3>> = (0..n).map(|k| if in_element[k] { vrij(&rijen[k]) } else { Vec::new() }).collect();
        // Torsie naar een knoop zonder vrije draaiing om de staafas legt die
        // draaiing ook aan de andere kant vast. Een werklijst: na elke
        // wijziging alleen de torsie van die knoop opnieuw bekijken; een knoop
        // verliest hoogstens drie keer een richting.
        let mut torsie_van: Vec<Vec<usize>> = vec![Vec::new(); n];
        for (t, &(i, j, _)) in torsie.iter().enumerate() {
            torsie_van[i].push(t);
            torsie_van[j].push(t);
        }
        let mut werk: Vec<usize> = (0..torsie.len()).rev().collect();
        while let Some(t) = werk.pop() {
            let (i, j, ex) = torsie[t];
            let (pi, pj) = (deel(&v[i], ex), deel(&v[j], ex));
            let knoop = if pi <= TOL && pj > TOL { j } else if pj <= TOL && pi > TOL { i } else { continue };
            rijen[knoop].push(ex);
            v[knoop] = vrij(&rijen[knoop]);
            werk.extend(torsie_van[knoop].iter().copied());
        }
        // Torsie die twee vrije draaiingen koppelt.
        let koppel: Vec<(usize, usize, V3)> = torsie.iter().copied()
            .filter(|&(i, j, ex)| deel(&v[i], ex) > TOL && deel(&v[j], ex) > TOL)
            .collect();

        // E: de richtingen in V die de torsie koppelt; F: de rest van V.
        let mut assen: Vec<Vec<V3>> = vec![Vec::new(); n];
        for &(i, j, ex) in &koppel {
            for k in [i, j] {
                let p = v[k].iter().fold([0.0; 3], |som, b| add(som, scale(*b, dot(*b, ex))));
                assen[k].push(scale(p, 1.0 / norm(p)));
            }
        }
        let mut e: Vec<Vec<V3>> = vec![Vec::new(); n];
        let mut f: Vec<Vec<V3>> = vec![Vec::new(); n];
        for k in 0..n {
            if v[k].is_empty() { continue; }
            if !assen[k].is_empty() {
                let mut gram = vec![vec![0.0; 3]; 3];
                for p in &assen[k] {
                    for a in 0..3 {
                        for b in 0..3 { gram[a][b] += p[a] * p[b]; }
                    }
                }
                let (waarden, vectoren) = eigen(gram);
                e[k] = (0..3).filter(|i| waarden[*i] > TOL * TOL)
                    .map(|i| [vectoren[i][0], vectoren[i][1], vectoren[i][2]])
                    .collect();
            }
            let mut met_e = rijen[k].clone();
            met_e.extend(e[k].iter().copied());
            f[k] = vrij(&met_e);
        }

        // Groepen: knopen met een vrije draaiing, verbonden door koppelende torsie.
        let mut unie = Unie((0..n).collect());
        for &(i, j, _) in &koppel { unie.verbind(i, j); }
        let mut per_groep: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for k in 0..n {
            if !e[k].is_empty() || !f[k].is_empty() { per_groep.entry(unie.wortel(k)).or_default().push(k); }
        }
        let mut koppel_van: BTreeMap<usize, Vec<(usize, usize, V3)>> = BTreeMap::new();
        for &(i, j, ex) in &koppel { koppel_van.entry(unie.wortel(i)).or_default().push((i, j, ex)); }

        let mut uitkomst = Vastzetting::default();
        for (wortel, leden) in per_groep {
            // De gezamenlijke draaiingen: nulruimte van de torsievoorwaarden in E.
            let mut kolom: BTreeMap<usize, usize> = BTreeMap::new();
            let mut aantal = 0;
            for &k in &leden {
                if e[k].is_empty() { continue; }
                kolom.insert(k, aantal);
                aantal += e[k].len();
            }
            let mut samen: Vec<Vorm> = Vec::new();
            if aantal > 0 {
                let stelsel: Vec<Vec<(usize, f64)>> = koppel_van.get(&wortel).into_iter().flatten()
                    .map(|&(i, j, ex)| {
                        let mut rij = Vec::new();
                        for (k, teken) in [(i, -1.0), (j, 1.0)] {
                            for (c, as_) in e[k].iter().enumerate() {
                                rij.push((kolom[&k] + c, teken * dot(*as_, ex)));
                            }
                        }
                        rij
                    })
                    .collect();
                for x in nulruimte_ijl(aantal, stelsel) {
                    let mut vorm = Vorm::new();
                    for (&k, &begin) in &kolom {
                        let theta = e[k].iter().enumerate()
                            .fold([0.0; 3], |som, (c, as_)| add(som, scale(*as_, x[begin + c])));
                        if norm(theta) > 0.0 { vorm.insert(ids[k], theta); }
                    }
                    if !vorm.is_empty() { samen.push(vorm); }
                }
            }
            let enkel: Vec<(usize, V3)> = leden.iter()
                .flat_map(|&k| f[k].iter().map(|r| (ids[k], *r)).collect::<Vec<_>>())
                .collect();
            let vast = kies(&enkel, &samen);
            // Orthonormale basis: F per knoop is dat al en staat loodrecht op E;
            // de gezamenlijke draaiingen onderling orthonormaal maken.
            for (knoop, r) in &enkel { uitkomst.basis.push(Vorm::from([(*knoop, *r)])); }
            let mut orthonormaal: Vec<Vorm> = Vec::new();
            for vorm in samen {
                let mut rest = vorm;
                for _ in 0..2 {
                    for q in &orthonormaal {
                        let f = inproduct(&rest, q);
                        verminder(&mut rest, f, q);
                    }
                }
                let grootte = inproduct(&rest, &rest).sqrt();
                if grootte > SPIL {
                    for w in rest.values_mut() { *w = scale(*w, 1.0 / grootte); }
                    orthonormaal.push(rest);
                }
            }
            let samen_knopen = orthonormaal.iter().any(|vorm| vorm.len() > 1);
            uitkomst.basis.extend(orthonormaal);
            if vast.is_empty() { continue; }
            uitkomst.groepen.push(Groep {
                knopen: leden.iter().map(|&k| ids[k]).collect(),
                vast,
                samen: samen_knopen,
                enkel: !enkel.is_empty(),
            });
        }
        let opgelegd: BTreeSet<usize> = input.supports.values().map(|steun| steun.node_id).collect();
        uitkomst.nieuw = uitkomst.groepen.iter()
            .flat_map(|groep| groep.vast.iter().map(|(knoop, _)| *knoop))
            .filter(|knoop| !opgelegd.contains(knoop))
            .collect();
        uitkomst
    }

    /// Zet de gekozen draaiblokkeringen in de opleggingen van het kernmodel:
    /// bij een knoop met een oplegging in die oplegging, anders in een nieuwe.
    pub(crate) fn pas_toe(&self, input: &mut SolverInput3D) {
        for groep in &self.groepen {
            for &(knoop, as_) in &groep.vast {
                // De oplegging met de meeste blokkeringen: de kern leest daar
                // de veren van een knoop (`DofNumbering::build_3d`).
                let mut sleutel: Option<(usize, String)> = None;
                for (naam, steun) in input.supports.iter().filter(|(_, steun)| steun.node_id == knoop) {
                    let aantal = [steun.rx, steun.ry, steun.rz, steun.rrx, steun.rry, steun.rrz].iter().filter(|v| **v).count();
                    if sleutel.as_ref().is_none_or(|(beste, naam_beste)| aantal > *beste || (aantal == *beste && naam < naam_beste)) {
                        sleutel = Some((aantal, naam.clone()));
                    }
                }
                let naam = match sleutel {
                    Some((_, naam)) => naam,
                    None => {
                        let naam = format!("knoopdraaiing-{knoop}");
                        input.supports.insert(naam.clone(), lege_steun(knoop));
                        naam
                    }
                };
                let steun = input.supports.get_mut(&naam).expect("de oplegging bestaat");
                match as_ {
                    0 => steun.rrx = true,
                    1 => steun.rry = true,
                    _ => steun.rrz = true,
                }
            }
        }
    }

    /// Zijn de reacties van de kunstmatige blokkeringen nul? Zo niet, dan zet
    /// de belasting een moment op een draaiing die niets tegenhoudt: een echt
    /// mechanisme, en een fout.
    pub(crate) fn controleer(
        &self,
        context: &str,
        request: &SolveRequest3D,
        input: &SolverInput3D,
        results: &AnalysisResults3D,
    ) -> Result<(), String> {
        if self.is_leeg() { return Ok(()); }
        let reacties: BTreeMap<usize, [f64; 3]> = results.reactions.iter()
            .map(|r| (r.node_id, [r.mx, r.my, r.mz]))
            .collect();
        let grens = RUIS * schaal(input, results) + 1e-12;
        let mut belast: Vec<(&Groep, usize, usize, f64)> = Vec::new();
        for groep in &self.groepen {
            let mut grootste: Option<(usize, usize, f64)> = None;
            for &(knoop, as_) in &groep.vast {
                let moment = reacties.get(&knoop).map(|m| m[as_]).unwrap_or(0.0);
                if moment.abs() > grens && grootste.is_none_or(|(_, _, m)| moment.abs() > m.abs()) {
                    grootste = Some((knoop, as_, moment));
                }
            }
            if let Some((knoop, as_, moment)) = grootste { belast.push((groep, knoop, as_, moment)); }
        }
        if belast.is_empty() { return Ok(()); }
        Err(fout(context, request, &belast))
    }

    /// Een orthonormale basis van de vastgehouden draaiingen Z, per knoop de
    /// draaivector; voor de kleinste oplossing langs een mechanisme
    /// (`mechanisme`, #195).
    pub(crate) fn draaivormen(&self) -> &[Vorm] { &self.basis }

    /// Haal de kunstmatige blokkeringen uit de uitkomst van de kern: geen
    /// reacties, en knoopdraaiingen zonder het onbepaalde deel.
    pub(crate) fn ruim_op(&self, results: &mut AnalysisResults3D) {
        if self.is_leeg() { return; }
        results.reactions.retain(|reactie| !self.nieuw.contains(&reactie.node_id));
        for groep in &self.groepen {
            for &(knoop, as_) in &groep.vast {
                for reactie in results.reactions.iter_mut().filter(|reactie| reactie.node_id == knoop) {
                    match as_ {
                        0 => reactie.mx = 0.0,
                        1 => reactie.my = 0.0,
                        _ => reactie.mz = 0.0,
                    }
                }
            }
        }
        let plaats: BTreeMap<usize, usize> = results.displacements.iter().enumerate()
            .map(|(i, d)| (d.node_id, i))
            .collect();
        for vorm in &self.basis {
            let draaiing = |d: &rekenkern::types::Displacement3D| [d.rx, d.ry, d.rz];
            let s: f64 = vorm.iter()
                .filter_map(|(knoop, q)| plaats.get(knoop).map(|&i| dot(*q, draaiing(&results.displacements[i]))))
                .sum();
            if s == 0.0 { continue; }
            for (knoop, q) in vorm {
                let Some(&i) = plaats.get(knoop) else { continue };
                let d = &mut results.displacements[i];
                d.rx -= s * q[0];
                d.ry -= s * q[1];
                d.rz -= s * q[2];
            }
        }
    }

    /// Melding bij een geslaagde berekening: welke knoopdraaiingen vastgehouden zijn.
    pub(crate) fn melding(&self, request: &SolveRequest3D) -> Option<String> {
        if self.is_leeg() { return None; }
        let knopen = modelknopen(request, self.groepen.iter().flat_map(|groep| groep.knopen.iter().copied()));
        let mut redenen = Vec::new();
        if self.groepen.iter().any(|groep| groep.enkel) { redenen.push("scharnierende staafeinden"); }
        if self.groepen.iter().any(|groep| groep.samen) {
            redenen.push("staven die torsie overdragen maar zonder torsieblokkering samen om hun as kunnen draaien");
        }
        Some(format!(
            "Vrije knoopdraaiing in {}: in een of meer richtingen houdt geen staafeind, plaat of oplegging de draaiing tegen ({}). Die draaiing is onbepaald en verandert geen kracht; de berekening houdt haar vast en de knoopverdraaiingen in de uitvoer bevatten haar niet.",
            knopen_tekst(&knopen),
            redenen.join("; "),
        ))
    }
}

/// De knopen van het model (oplopend, zonder dubbele): de rekenknopen die de
/// adapter langs een staaf aanlegt, staan niet in het model.
fn modelknopen(request: &SolveRequest3D, knopen: impl Iterator<Item = usize>) -> Vec<usize> {
    let model: BTreeSet<usize> = request.nodes.iter().map(|knoop| knoop.id).collect();
    knopen.filter(|knoop| model.contains(knoop)).collect::<BTreeSet<_>>().into_iter().collect()
}

/// "knoop 2", "knopen 1–4", of de rekenknopen langs een staaf.
fn knopen_tekst(knopen: &[usize]) -> String {
    if knopen.is_empty() { "rekenknopen langs een staaf".to_string() } else { noem("knoop", "knopen", knopen) }
}

/// Een oplegging zonder blokkering; de regel zet er een draairichting in.
fn lege_steun(node_id: usize) -> SolverSupport3D {
    SolverSupport3D {
        node_id,
        rx: false, ry: false, rz: false, rrx: false, rry: false, rrz: false,
        kx: None, ky: None, kz: None, krx: None, kry: None, krz: None,
        dx: None, dy: None, dz: None, drx: None, dry: None, drz: None,
        rw: None, kw: None, normal_x: None, normal_y: None, normal_z: None,
        is_inclined: None,
    }
}

/// De grootste kracht maal de modelafmeting en het grootste moment in de
/// uitkomst en de knooplasten: de maat voor afrondingsruis.
pub(crate) fn schaal(input: &SolverInput3D, results: &AnalysisResults3D) -> f64 {
    let mut laag = [f64::INFINITY; 3];
    let mut hoog = [f64::NEG_INFINITY; 3];
    for knoop in input.nodes.values() {
        for (as_, waarde) in [knoop.x, knoop.y, knoop.z].into_iter().enumerate() {
            laag[as_] = laag[as_].min(waarde);
            hoog[as_] = hoog[as_].max(waarde);
        }
    }
    let lengte = (0..3).map(|as_| (hoog[as_] - laag[as_]).powi(2)).sum::<f64>().sqrt().max(1.0);
    let mut grootste = 0.0f64;
    for f in &results.element_forces {
        for kracht in [f.n_start, f.n_end, f.vy_start, f.vy_end, f.vz_start, f.vz_end] {
            grootste = grootste.max(kracht.abs() * lengte);
        }
        for moment in [f.mx_start, f.mx_end, f.my_start, f.my_end, f.mz_start, f.mz_end] {
            grootste = grootste.max(moment.abs());
        }
    }
    for r in &results.reactions {
        for kracht in [r.fx, r.fy, r.fz] { grootste = grootste.max(kracht.abs() * lengte); }
        for moment in [r.mx, r.my, r.mz] { grootste = grootste.max(moment.abs()); }
    }
    for last in &input.loads {
        if let SolverLoad3D::Nodal(last) = last {
            for kracht in [last.fx, last.fy, last.fz] { grootste = grootste.max(kracht.abs() * lengte); }
            for moment in [last.mx, last.my, last.mz] { grootste = grootste.max(moment.abs()); }
        }
    }
    grootste
}

fn getal(x: f64) -> String { format!("{x:.3}").replace('.', ",") }

/// De fout bij een belaste vrije draaiing.
fn fout(context: &str, request: &SolveRequest3D, belast: &[(&Groep, usize, usize, f64)]) -> String {
    let zinnen: Vec<String> = belast.iter().map(|(groep, knoop, as_, moment)| {
        let plek = if modelknopen(request, std::iter::once(*knoop)).is_empty() {
            "in een rekenknoop langs een staaf".to_string()
        } else {
            format!("in knoop {knoop}")
        };
        let waar = format!("{} kNm om {} {plek}", getal(moment.abs()), ASSEN[*as_]);
        if groep.samen {
            let knopen = modelknopen(request, groep.knopen.iter().copied());
            format!(
                "{} kunnen samen draaien zonder dat een staaf vervormt of een oplegging iets tegenhoudt (bijvoorbeeld een staaf die torsie overdraagt en vrij om haar as kan draaien), maar de belasting zet daar een moment op ({waar})",
                crate::opleggingen::hoofdletter(&knopen_tekst(&knopen)),
            )
        } else {
            format!(
                "{} houdt in een of meer richtingen geen staafeind, plaat of oplegging de draaiing tegen (scharnierende staafeinden), maar de belasting zet daar een moment op ({waar})",
                crate::opleggingen::hoofdletter(&plek),
            )
        }
    }).collect();
    let opleggingen = crate::opleggingen::controleer_zonder_draairegel(request);
    let bij = if opleggingen.is_empty() {
        String::new()
    } else {
        format!(" Opleggingen: {}", crate::opleggingen::beschrijf(&opleggingen))
    };
    format!(
        "{context}: het model is een mechanisme. {}. Aanwijzing: blokkeer die draaiing met een inklemming, passende revolute-oplegging of rotatieveer, of maak een staafeind daar momentvast.{bij} {}",
        zinnen.join(". "),
        crate::MECHANISME_UITLEG,
    )
}

/// Kies evenveel draaiblokkeringen (knoop-id, as) als er vrije draaiingen
/// zijn, zodat ze die samen precies vastleggen: Gauss-eliminatie met
/// volledige pivotering op de vrije draaiingen. Eerst de draaiingen van één
/// knoop (F), daarna de gezamenlijke (E), die eerst van de gekozen
/// vrijheidsgraden van F worden ontdaan.
fn kies(enkel: &[(usize, V3)], samen: &[Vorm]) -> Vec<(usize, usize)> {
    let mut gekozen = Vec::new();
    let mut rest: Vec<Vorm> = samen.to_vec();
    let mut per_knoop: BTreeMap<usize, Vec<V3>> = BTreeMap::new();
    for (knoop, r) in enkel { per_knoop.entry(*knoop).or_default().push(*r); }
    for (knoop, mut vectoren) in per_knoop {
        while !vectoren.is_empty() {
            let mut beste = (0, 0, 0.0f64);
            for (k, r) in vectoren.iter().enumerate() {
                for as_ in 0..3 {
                    if r[as_].abs() > beste.2 { beste = (k, as_, r[as_].abs()); }
                }
            }
            let (k, as_, _) = beste;
            let spil = vectoren.remove(k);
            gekozen.push((knoop, as_));
            for r in vectoren.iter_mut() {
                let f = r[as_] / spil[as_];
                *r = sub(*r, scale(spil, f));
            }
            for vorm in rest.iter_mut() {
                if let Some(w) = vorm.get_mut(&knoop) {
                    let f = w[as_] / spil[as_];
                    *w = sub(*w, scale(spil, f));
                }
            }
        }
    }
    while !rest.is_empty() {
        let mut beste = (0, 0, 0, 0.0f64);
        for (m, vorm) in rest.iter().enumerate() {
            for (&knoop, w) in vorm {
                for as_ in 0..3 {
                    if w[as_].abs() > beste.3 { beste = (m, knoop, as_, w[as_].abs()); }
                }
            }
        }
        let (m, knoop, as_, grootte) = beste;
        if grootte <= SPIL { break; }
        let spil = rest.remove(m);
        let p = spil[&knoop][as_];
        gekozen.push((knoop, as_));
        for vorm in rest.iter_mut() {
            let Some(w) = vorm.get(&knoop) else { continue };
            let f = w[as_] / p;
            if f != 0.0 { verminder(vorm, f, &spil); }
        }
    }
    gekozen
}

/// Een genormeerde, op kolom gesorteerde rij zonder dubbele kolommen.
fn rij_netjes(mut rij: Vec<(usize, f64)>) -> Option<Vec<(usize, f64)>> {
    rij.sort_by_key(|(kolom, _)| *kolom);
    let mut samen: Vec<(usize, f64)> = Vec::with_capacity(rij.len());
    for (kolom, waarde) in rij {
        match samen.last_mut() {
            Some((vorige, som)) if *vorige == kolom => *som += waarde,
            _ => samen.push((kolom, waarde)),
        }
    }
    let grootte = samen.iter().map(|(_, w)| w * w).sum::<f64>().sqrt();
    (grootte > 0.0).then(|| samen.into_iter().map(|(k, w)| (k, w / grootte)).filter(|(_, w)| w.abs() > NUL).collect())
}

fn waarde_in(rij: &[(usize, f64)], kolom: usize) -> f64 {
    rij.binary_search_by_key(&kolom, |(k, _)| *k).map(|i| rij[i].1).unwrap_or(0.0)
}

/// a − f·b zonder kolom `weg`: de nieuwe rij, de kolommen die erbij komen
/// en de kolommen die wegvallen (`weg` of afrondingsruis).
fn combineer(a: &[(usize, f64)], b: &[(usize, f64)], f: f64, weg: usize) -> (Vec<(usize, f64)>, Vec<usize>, Vec<usize>) {
    let mut uit = Vec::with_capacity(a.len() + b.len());
    let mut erbij = Vec::new();
    let mut eraf = Vec::new();
    let (mut i, mut j) = (0, 0);
    while i < a.len() || j < b.len() {
        let (kolom, waarde, in_a) = match (a.get(i), b.get(j)) {
            (Some(&(ka, wa)), Some(&(kb, wb))) if ka == kb => { i += 1; j += 1; (ka, wa - f * wb, true) }
            (Some(&(ka, wa)), Some(&(kb, _))) if ka < kb => { i += 1; (ka, wa, true) }
            (Some(&(ka, wa)), None) => { i += 1; (ka, wa, true) }
            (_, Some(&(kb, wb))) => { j += 1; (kb, -f * wb, false) }
            (None, None) => unreachable!(),
        };
        if kolom == weg || waarde.abs() <= NUL {
            if in_a { eraf.push(kolom); }
            continue;
        }
        if !in_a { erbij.push(kolom); }
        uit.push((kolom, waarde));
    }
    (uit, erbij, eraf)
}

/// Zet kolom `kolom` in de wachtrij op haar nieuwe aantal rijen.
fn bijwerken(kolom: usize, klaar: &[bool], in_kolom: &[BTreeSet<usize>], aantal: &mut [usize], wachtrij: &mut BTreeSet<(usize, usize)>) {
    if klaar[kolom] { return; }
    wachtrij.remove(&(aantal[kolom], kolom));
    aantal[kolom] = in_kolom[kolom].len();
    wachtrij.insert((aantal[kolom], kolom));
}

/// Nulruimte van een ijl stelsel met `n` onbekenden: Gauss-eliminatie met
/// telkens de kolom met de minste rijen (Markowitz, weinig opvulling, ook in
/// een groot vakwerk) en in die kolom een spil van minstens een tiende van de
/// grootste waarde, de kortste rij eerst. Een kolom zonder spil boven `SPIL`
/// is vrij en geeft één basisvector (die kolom 1, de andere vrije kolommen
/// 0). Onafhankelijk, niet orthonormaal.
fn nulruimte_ijl(n: usize, rijen: Vec<Vec<(usize, f64)>>) -> Vec<Vec<f64>> {
    let mut rijen: Vec<Vec<(usize, f64)>> = rijen.into_iter().filter_map(rij_netjes).collect();
    let mut in_kolom: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); n];
    for (r, rij) in rijen.iter().enumerate() {
        for &(kolom, _) in rij { in_kolom[kolom].insert(r); }
    }
    let mut aantal: Vec<usize> = in_kolom.iter().map(|rijen| rijen.len()).collect();
    let mut wachtrij: BTreeSet<(usize, usize)> = (0..n).map(|k| (aantal[k], k)).collect();
    let mut klaar = vec![false; n];
    let mut volgorde: Vec<usize> = Vec::with_capacity(n);
    let mut spil: Vec<Option<usize>> = vec![None; n];
    while let Some((_, kolom)) = wachtrij.pop_first() {
        klaar[kolom] = true;
        volgorde.push(kolom);
        let kandidaten: Vec<usize> = std::mem::take(&mut in_kolom[kolom]).into_iter().collect();
        let waarden: Vec<f64> = kandidaten.iter().map(|&r| waarde_in(&rijen[r], kolom)).collect();
        let grootste = waarden.iter().map(|w| w.abs()).fold(0.0, f64::max);
        if grootste <= SPIL {
            // Vrije kolom: wat er nog staat is afrondingsruis.
            for &r in &kandidaten { rijen[r].retain(|(k, _)| *k != kolom); }
            continue;
        }
        let (p, pw) = kandidaten.iter().zip(&waarden)
            .filter(|(_, w)| w.abs() >= 0.1 * grootste)
            .min_by_key(|(r, _)| (rijen[**r].len(), **r))
            .map(|(r, w)| (*r, *w))
            .expect("minstens één kandidaat");
        spil[kolom] = Some(p);
        for &(k, _) in &rijen[p] {
            if in_kolom[k].remove(&p) { bijwerken(k, &klaar, &in_kolom, &mut aantal, &mut wachtrij); }
        }
        let spilrij = rijen[p].clone();
        for (&r, &w) in kandidaten.iter().zip(&waarden) {
            if r == p || w == 0.0 { continue; }
            let (nieuw, erbij, eraf) = combineer(&rijen[r], &spilrij, w / pw, kolom);
            for k in eraf {
                if in_kolom[k].remove(&r) { bijwerken(k, &klaar, &in_kolom, &mut aantal, &mut wachtrij); }
            }
            for k in erbij {
                if in_kolom[k].insert(r) { bijwerken(k, &klaar, &in_kolom, &mut aantal, &mut wachtrij); }
            }
            rijen[r] = nieuw;
        }
    }
    // Terugsubstitutie in omgekeerde volgorde: een spilrij bevat alleen
    // kolommen die na haar spilkolom aan de beurt kwamen.
    let vrije: Vec<usize> = volgorde.iter().copied().filter(|k| spil[*k].is_none()).collect();
    vrije.into_iter().map(|vrije_kolom| {
        let mut x = vec![0.0; n];
        x[vrije_kolom] = 1.0;
        for &kolom in volgorde.iter().rev() {
            let Some(p) = spil[kolom] else { continue };
            let mut som = 0.0;
            let mut w_spil = 0.0;
            for &(k, w) in &rijen[p] {
                if k == kolom { w_spil = w } else { som += w * x[k] }
            }
            x[kolom] = -som / w_spil;
        }
        x
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Twee knopen met één torsiekoppeling: één gezamenlijke draaiing.
    #[test]
    fn nulruimte_van_een_rij_torsievoorwaarden() {
        // c1 − c0 = 0, c2 − c1 = 0: één vrije richting (1, 1, 1).
        let x = nulruimte_ijl(3, vec![vec![(0, -1.0), (1, 1.0)], vec![(1, -1.0), (2, 1.0)]]);
        assert_eq!(x.len(), 1);
        assert!(x[0].iter().all(|w| (w - x[0][0]).abs() < 1e-12 && w.abs() > 0.5), "{x:?}");
        // Een volledig bepaald stelsel heeft geen nulruimte.
        assert!(nulruimte_ijl(2, vec![vec![(0, 1.0)], vec![(0, 1.0), (1, 2.0)]]).is_empty());
        // Een gesloten ring van vijf (één afhankelijke rij) en een losse
        // onbekende: nulruimte 2, en elke vector voldoet aan alle rijen.
        let mut rijen: Vec<Vec<(usize, f64)>> = (0..5).map(|i| vec![(i, 0.3 + i as f64), (((i + 1) % 5), -(0.3 + i as f64))]).collect();
        rijen.push(vec![(1, 2.0), (3, -2.0)]);
        let x = nulruimte_ijl(6, rijen.clone());
        assert_eq!(x.len(), 2, "{x:?}");
        for v in &x {
            for rij in &rijen {
                let rest: f64 = rij.iter().map(|(k, w)| w * v[*k]).sum();
                assert!(rest.abs() < 1e-12, "{rest} in {rij:?}");
            }
        }
    }

    /// De keuze legt de vrije draaiingen vast: beperkt tot Z inverteerbaar.
    #[test]
    fn de_keuze_neemt_de_grootste_component() {
        // F in knoop 7: de richtingen loodrecht op een schuine as (0,6; 0,8; 0).
        let enkel = [(7, [-0.8, 0.6, 0.0]), (7, [0.0, 0.0, 1.0])];
        let gekozen = kies(&enkel, &[]);
        assert_eq!(gekozen, vec![(7, 2), (7, 0)]);
    }

    #[test]
    fn vrije_richtingen_van_een_knoop() {
        // Alleen torsie om X: vrij om Y en Z.
        let v = vrij(&[[1.0, 0.0, 0.0]]);
        assert_eq!(v.len(), 2);
        assert!(v.iter().all(|r| r[0].abs() < 1e-12));
        // Twee bijna evenwijdige rijen laten de derde richting en de kleine hoek ertussen.
        let v = vrij(&[[1.0, 0.0, 0.0], [1.0, 1e-7, 0.0]]);
        assert_eq!(v.len(), 2);
        assert!(vrij(&[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]).is_empty());
    }
}
