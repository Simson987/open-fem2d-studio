//! Opleggingen: kan een verbonden modeldeel als star lichaam bewegen? (#64)
//!
//! Rekenregel. Staven (met hun tussenknopen) en schaalelementen verbinden
//! knopen tot starre delen; een knoop zonder staaf of plaat is een deel op
//! zich. Elk deel heeft zes starrelichaamsbewegingen (t, θ) rond het
//! zwaartepunt c van zijn knopen: verschuiven in X, Y, Z en draaien om X, Y, Z.
//! Een oplegging in knoop p (vaste richting of veer) legt per geblokkeerde
//! richting d een voorwaarde op: translatie d·(t + θ × (p − c)) = 0, rotatie
//! d·θ = 0. Het deel is voldoende opgelegd als die voorwaarden samen rang 6
//! hebben; de nulruimte is anders de verzameling vrije bewegingen. De rotaties
//! rekenen als L·θ, met L de afmeting van het deel, zodat alle voorwaarden
//! dezelfde orde hebben.
//!
//! Een starre schijf koppelt alleen X, Y en de rotatie om Z van haar knopen
//! (`schijven`): u_x = a − φ·(y − y_s), u_y = b + φ·(x − x_s), θ_z = φ. Delen die
//! via een schijf samenhangen vormen één verbonden modeldeel. Hun vrije
//! bewegingen bestaan uit twee loodrechte stukken: L, de bewegingen van elk
//! deel bij stilstaande schijven (per deel apart), en G, de bewegingen waarbij
//! schijven meebewegen. Voor G houdt elk deel alleen de schijfbewegingen tegen
//! die het met zijn eigen vrije bewegingen niet kan volgen (de projectie van
//! zijn schijfvoorwaarden buiten het bereik van zijn eigen bewegingen); zo
//! blijft het stelsel klein, drie onbekenden per schijf, ook bij honderden
//! kolommen onder één vloer. Een kolom die alleen via de schijf horizontaal
//! vastzit, telt zo als vastgehouden; een knoop die alleen in een schijf zit,
//! blijft in Z en in de rotaties om X en Y vrij.
//!
//! Benoemen. Eerst de bewegingen van het verbonden deel als geheel, dan die
//! van elke schijf met de delen die eraan hangen (een vloer op pendelkolommen
//! die zwaait of draait), dan die van een deel ten opzichte van de schijf
//! waaraan het hangt. Een vrije verschuiving heet "verschuiven in X"; een vrije
//! draaiing "draaien om Z" als elke knoop van het deel op een toegestane as
//! ligt (de plaats van de as maakt dan niet uit), anders met de as erbij:
//! "draaien om X (as door knoop 1 en 2)". Een schuine as heet naar de knopen
//! erop. Wat zo niet te benoemen is, komt als één bevinding met de betrokken
//! delen. Bij meer dan `GROOTSTE_SCHIJVEN` schijven in één verbonden deel volgt
//! alleen het geheel en elk deel apart, met een melding dat de controle de
//! schijven zelf niet heeft nagegaan.
//!
//! Een staaf op bedding (`bedding`) is langs haar hele lengte opgelegd in de
//! richtingen van haar grondveren: verticaal (Z) en eventueel zijdelings.
//! Langs een rechte staaf houdt een rij veren hetzelfde tegen als de eerste en
//! de laatste ervan; die twee voorwaarden per richting tellen mee, in hun
//! eigen punt op de staafas. Bij alleen druk tellen alleen de veren die
//! meedoen (`controleer_bij`).
//!
//! Een plaat op bedding (`plaatbedding`, #107) is in elke knoop opgelegd langs
//! haar normaal; drie niet-collineaire knopen met een veer die meedoet houden
//! hetzelfde tegen als alle (per eiland, als één plaat uit losse stukken
//! bestaat). De bewegingen in het vlak van zo'n plaat (verschuiven in het vlak,
//! draaien om de normaal) houdt geen veer tegen; heeft een verbonden deel daar
//! vrije bewegingen, dan houdt de adapter die vast (`vlakvrij`) en telt deze
//! controle ze niet als vrij: zonder schijf door ze af te splitsen
//! (`vlak_splits`), met een starre schijf in het deel door de vasthouding als
//! oplegging mee te tellen (`vasthouding_via_schijf`).
//!
//! Buiten deze controle vallen interne mechanismen (scharnieren, vrijgegeven
//! staafeinden): een model dat hier voldoende is opgelegd, kan toch singulier
//! zijn. De melding bij een singuliere stijfheidsmatrix zegt dat dan.
//!
//! Draaiing om de eigen as (#96). Liggen alle knopen van een deel op één
//! rechte lijn (een staaf of een rij staven), dan verplaatst de draaiing van
//! dat deel om die lijn geen enkele knoop: het is alleen een knoopdraaiing,
//! zonder translatie en zonder vervorming. Zo'n draaiing houdt de adapter vast
//! (`knoopdraaiing`) en meldt zij als mechanisme zodra de belasting er een
//! moment op zet. Deze controle telt haar daarom niet als vrije beweging,
//! behalve als een knoop van het deel in een schijf ligt en de lijn niet
//! horizontaal is (de schijf koppelt de draaiing om Z aan haar verschuivingen;
//! die draaiing houdt de regel niet vast). `controleer_zonder_draairegel`
//! geeft het oude beeld, voor de foutmelding als zo'n draaiing toch belast is.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use crate::bedding::{self, Los};
use crate::shell::{add, cross, dot, norm, scale, sub, V3};
use crate::{Member3D, Node3D, SolveRequest3D, Support3D};

pub(crate) type V6 = [f64; 6];

const ASSEN: [&str; 3] = ["X", "Y", "Z"];
/// Relatieve grens voor rang (σ/σ_max): een beweging die minder dan een
/// miljoenste wordt tegengehouden, telt als vrij.
const TOL: f64 = 1e-6;
/// Grens voor "ligt in deze nulruimte" bij het benoemen.
const TOL_LID: f64 = 1e-5;
/// Zoveel schijven in één verbonden modeldeel worden volledig nagegaan.
const GROOTSTE_SCHIJVEN: usize = 200;
/// Een deel dat aan meer schijven hangt, geeft zijn voorwaarden op de
/// schijven rij voor rij door in plaats van samengevat.
const GROOTSTE_SAMENVATTING: usize = 12;
/// Een as telt in een aanwijzing mee vanaf dit deel van de lengte van de richting.
const WEZENLIJK: f64 = 0.1;
/// Zoveel bevindingen schrijft een melding uit.
const MAX_BESCHREVEN: usize = 6;
/// Zoveel groepen (losse nummers of reeksen) noemt een knopenlijst.
const MAX_GROEPEN: usize = 8;

/// Uitleg als de opleggingen voldoende zijn en de kern toch singulier meldt.
const INTERN: &str = "De opleggingen houden elk verbonden modeldeel als geheel vast; de oorzaak is dan een intern mechanisme, bijvoorbeeld scharnieren of vrijgegeven staafeinden waardoor een knoop of een deel van de constructie vrij kan bewegen. Zulke mechanismen vallen buiten de controle op de opleggingen.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Soort {
    /// Een knoop zonder staaf, plaat of schijf die niet volledig is opgelegd.
    LosseKnoop,
    /// Een verbonden modeldeel zonder enige oplegging.
    Los,
    /// Een verbonden modeldeel dat als geheel kan bewegen.
    Onvoldoende,
    /// Een schijf die met de delen die eraan hangen kan verschuiven of draaien.
    /// `steunknoop`: de knoop waarin de schijf al in haar vlak is opgelegd;
    /// `mee`: andere schijven die daarbij meebewegen.
    Schijf { steunknoop: Option<usize>, mee: Vec<usize> },
    /// Een deel dat via een schijf aan de rest hangt en daartegenover kan bewegen.
    ViaSchijf,
    /// Delen die via schijven samen kunnen bewegen; niet afzonderlijk benoemd.
    Samen,
    /// Te veel schijven om volledig na te gaan. Geen tekortkoming op zich: een
    /// berekening die slaagt, krijgt hiervoor geen melding.
    NietNagegaan,
}

#[derive(Debug, Clone, Copy)]
enum Plaats {
    /// De as mag overal liggen (elke knoop ligt op een toegestane as).
    Vrij,
    /// Alle knopen van het deel liggen op de as (een rechte staaf, één knoop).
    OpDeAs,
    /// De as ligt vast.
    Bepaald,
}

/// Waar een oplegging een draaiing tegenhoudt: in deze knopen (ids), in de
/// richting waarin de knoop buiten de as beweegt (ω × (q − anker)).
#[derive(Debug, Clone)]
struct Dwars {
    knopen: Vec<usize>,
    richting: V3,
}

#[derive(Debug, Clone)]
enum Vorm {
    Verschuiven(Option<usize>),
    Draaien { as_: Option<usize>, plaats: Plaats, dwars: Option<Dwars> },
    Schroef,
}

/// Eén vrije beweging met haar gewone naam.
#[derive(Debug, Clone)]
pub(crate) struct Beweging {
    pub naam: String,
    vorm: Vorm,
}

/// Een deel dat onvoldoende is opgelegd, met wat er vrij is.
#[derive(Debug, Clone)]
pub(crate) struct Bevinding {
    pub soort: Soort,
    pub knopen: Vec<usize>,
    pub staven: Vec<usize>,
    pub platen: Vec<usize>,
    pub schijven: Vec<usize>,
    pub vrij: Vec<Beweging>,
}

impl Bevinding {
    /// Een werkelijke tekortkoming, en niet alleen de melding dat de controle
    /// een deel niet volledig heeft nagegaan.
    pub(crate) fn tekort(&self) -> bool { self.soort != Soort::NietNagegaan }
}

/// Geblokkeerde of verende vrijheidsgraden van een oplegging.
fn blokkeringen(steun: &Support3D) -> [bool; 6] {
    [
        steun.ux || steun.kx_kn_per_m.is_some(),
        steun.uy || steun.ky_kn_per_m.is_some(),
        steun.uz || steun.kz_kn_per_m.is_some(),
        steun.rx || steun.krx_knm_per_rad.is_some(),
        steun.ry || steun.kry_knm_per_rad.is_some(),
        steun.rz || steun.krz_knm_per_rad.is_some(),
    ]
}

/// Voorwaarde van richting `richting` (0–2 translatie, 3–5 rotatie) in punt p
/// op de beweging (t, L·θ) rond c: e·(t + θ × r) = e·t + θ·(r × e).
fn rij(richting: usize, p: V3, c: V3, l: f64) -> V6 {
    let mut rij = [0.0; 6];
    rij[richting] = 1.0;
    if richting < 3 {
        let mut e = [0.0; 3];
        e[richting] = 1.0;
        let arm = cross(sub(p, c), e);
        for k in 0..3 { rij[3 + k] = arm[k] / l; }
    }
    rij
}

/// Voorwaarde van een translatie langs eenheidsrichting d in punt p:
/// d·(t + θ × r) = d·t + θ·(r × d), zoals `rij` voor een globale as.
fn rij_langs(d: V3, p: V3, c: V3, l: f64) -> V6 {
    let arm = cross(sub(p, c), d);
    [d[0], d[1], d[2], arm[0] / l, arm[1] / l, arm[2] / l]
}

struct Unie(Vec<usize>);

impl Unie {
    fn nieuw(n: usize) -> Self { Self((0..n).collect()) }

    fn wortel(&mut self, mut i: usize) -> usize {
        while self.0[i] != i {
            let ouder = self.0[self.0[i]];
            self.0[i] = ouder;
            i = ouder;
        }
        i
    }

    /// De kleinste index wordt de wortel, zodat de volgorde vastligt.
    fn verbind(&mut self, a: usize, b: usize) {
        let (a, b) = (self.wortel(a), self.wortel(b));
        if a != b { self.0[a.max(b)] = a.min(b); }
    }
}

#[derive(Default)]
struct Deel {
    /// Knoopindices, oplopend.
    knopen: Vec<usize>,
    staven: Vec<usize>,
    platen: BTreeSet<usize>,
    /// Schijven (id) waarin een knoop van dit deel zit.
    schijven: BTreeSet<usize>,
}

struct Schijf {
    id: usize,
    knopen: Vec<usize>,
}

/// Het vlak van een plaat op bedding: drie niet-collineaire plaatknopen (of
/// minder bij een ontaard net) en de normaal.
struct Plaatvlak {
    plate_id: usize,
    normaal: V3,
    /// Index van een knoop van de plaat (voor het deel).
    knoop: usize,
    punten: Vec<V3>,
}

/// Eén star deel van een verbonden modeldeel met vrije bewegingen in het vlak
/// van een plaat op bedding (`Vlakvrij`).
pub(crate) struct Vlakdeel {
    /// Zwaartepunt van de knopen van het deel; de bewegingen van het deel
    /// staan als (t, L·θ) rond dit punt.
    pub centrum: V3,
    /// De knopen (id) van het deel: welke lasten erop staan en welke
    /// plaatknopen de vasthouding kan nemen (`plaatbedding`).
    pub knopen: BTreeSet<usize>,
    /// De plaat op bedding van dit deel waarvan het vlak telt (laagste id; bij
    /// een plaat met losse eilanden het eiland in dit deel), of geen.
    pub plate_id: Option<usize>,
}

/// De vrije starrelichaamsbewegingen van een verbonden modeldeel (starre
/// delen, eventueel via starre schijven samen) in het vlak van zijn platen op
/// bedding, die de adapter vasthoudt (#107, `plaatbedding`).
pub(crate) struct Vlakvrij {
    /// De plaat op bedding van het verbonden deel met de laagste id (voor de meldingen).
    pub plate_id: usize,
    /// Zwaartepunt van alle knopen van het verbonden deel.
    pub centrum: V3,
    pub lengte: f64,
    pub delen: Vec<Vlakdeel>,
    /// Orthonormaal: per deel zes waarden (t, L·θ) rond zijn centrum, dan per
    /// schijf drie (a, b, L·φ) zoals in `Stelsel`. Zonder schijf zes waarden.
    pub bewegingen: Vec<Vec<f64>>,
    /// Hangen de delen via een starre schijf samen? Dan telt de controle de
    /// vasthouding als oplegging; zonder schijf splitst `vlak_splits` dezelfde
    /// bewegingen af.
    pub via_schijf: bool,
}

/// Het model zoals deze controle het ziet: knopen op index, starre delen en schijven.
struct Model {
    ids: Vec<usize>,
    punt: Vec<V3>,
    blok: Vec<[bool; 6]>,
    /// Vast in het vlak van een schijf (ux, uy of rz), zoals `schijven` het telt.
    vlak_vast: Vec<bool>,
    in_element: Vec<bool>,
    /// Ligt de knoop in een schijf die iets koppelt?
    in_schijf: Vec<bool>,
    /// Telt de draaiing van een recht deel om zijn eigen as als vastgehouden (#96)?
    draairegel: bool,
    /// Voorwaarden van de bedding per knoop: (punt, richting), met het punt
    /// ergens op de staafas; de knoop bepaalt alleen het deel.
    extra: Vec<Vec<(V3, V3)>>,
    /// Platen op bedding (#107), oplopend op plaat-id: hun vlak bepaalt welke
    /// vrije bewegingen de adapter vasthoudt (`vlak_splits`).
    plaatvlakken: Vec<Plaatvlak>,
    deel_van: Vec<usize>,
    delen: Vec<Deel>,
    schijven: Vec<Schijf>,
    grootste_schijven: usize,
}

/// Controleer elk verbonden modeldeel op starrelichaamsbewegingen. Staven in
/// `uitgesloten` (bijvoorbeeld inactieve trek-alleen staven) tellen niet mee.
/// Leeg betekent: elk deel is als geheel vastgehouden.
pub(crate) fn controleer(request: &SolveRequest3D, uitgesloten: &HashSet<usize>) -> Vec<Bevinding> {
    controleer_met(request, uitgesloten, GROOTSTE_SCHIJVEN)
}

/// Als `controleer`, met de verticale grondveren in `los` (alleen druk) weggevallen.
pub(crate) fn controleer_bij(request: &SolveRequest3D, uitgesloten: &HashSet<usize>, los: &Los) -> Vec<Bevinding> {
    controleer_volledig(request, uitgesloten, GROOTSTE_SCHIJVEN, los, true)
}

/// Als `controleer`, maar met de draaiing van een recht deel om zijn eigen as
/// als vrije beweging: voor de foutmelding als de belasting die draaiing
/// aanstoot (`knoopdraaiing`).
pub(crate) fn controleer_zonder_draairegel(request: &SolveRequest3D) -> Vec<Bevinding> {
    controleer_volledig(request, &HashSet::new(), GROOTSTE_SCHIJVEN, &Los::new(), false)
}

/// Per verbonden modeldeel met een plaat op bedding: de vrije
/// starrelichaamsbewegingen in het vlak van zijn platen op bedding, die de
/// adapter vasthoudt (#107). Staven in `uitgesloten` tellen niet mee, zoals in
/// `controleer`.
///
/// Zonder schijf is het verbonden deel één star deel, met dezelfde splitsing
/// als in de controle (`vlak_splits`): wat daar niet als vrij telt, zit in de
/// kern ook echt vast. Hangen delen via een starre schijf samen, dan zijn de
/// vrije bewegingen die van het hele stelsel (`Stelsel`: elk deel bij
/// stilstaande schijven en de schijfbewegingen waarbij de delen meegaan). Een
/// schijf koppelt alleen knopen onderling en houdt bij een starre beweging van
/// het geheel niets tegen; een vloer op bedding met een schijf ergens in
/// hetzelfde deel heeft dus dezelfde vrije bewegingen in het vlak als zonder.
/// Vastgehouden worden de vrije bewegingen waarbij geen plaat op bedding uit
/// haar vlak beweegt (drie punten per plaat, zoals in `vlak_splits`). De
/// controle telt de vasthouding van zo'n deel als oplegging
/// (`vasthouding_via_schijf`), omdat de splitsing per star deel daar niet
/// past. Bij meer dan `GROOTSTE_SCHIJVEN` schijven in één verbonden deel geen
/// vasthouding (de controle gaat de schijven dan niet volledig na).
pub(crate) fn vlakvrij(request: &SolveRequest3D, uitgesloten: &HashSet<usize>, los: &Los) -> Vec<Vlakvrij> {
    let model = Model::bouw(request, uitgesloten, GROOTSTE_SCHIJVEN, los, true);
    let mut uit = Vec::new();
    if model.plaatvlakken.is_empty() { return uit; }
    for (delen, schijven) in model.groepen() {
        // Per deel het vlak van zijn eerste plaat op bedding (laagste id).
        let vlakken: Vec<(usize, &Plaatvlak)> = delen.iter().enumerate()
            .filter_map(|(j, deel)| model.plaatvlakken.iter().find(|vlak| model.deel_van[vlak.knoop] == *deel).map(|vlak| (j, vlak)))
            .collect();
        if vlakken.is_empty() { continue; }
        let knopen: Vec<usize> = delen.iter().flat_map(|d| model.delen[*d].knopen.iter().copied()).collect();
        if !knopen.iter().any(|k| model.opgelegd(*k)) { continue; }
        // Centrum en maat zoals in `groep`.
        let c = model.zwaartepunt(&knopen);
        let l = knopen.iter().map(|k| norm(sub(model.punt[*k], c))).fold(1.0_f64, f64::max);
        let via_schijf = !(delen.len() == 1 && schijven.is_empty());
        let (centra, vast): (Vec<V3>, Vec<Vec<f64>>) = if !via_schijf {
            let v = model.zonder_eigen_as(&knopen, nulruimte6(&model.groepsrijen(&knopen, &[], c, l)));
            let Some((_, vast, _)) = model.vlak_splits(delen[0], c, l, &v) else { continue };
            (vec![c], vast.into_iter().map(|x| x.to_vec()).collect())
        } else {
            if schijven.len() > model.grootste_schijven { continue; }
            let (leden, _) = model.leden(&delen, &schijven, l);
            let stelsel = Stelsel::bouw(leden, schijven.len());
            let lengte = stelsel.lengte();
            let mut basis: Vec<Vec<f64>> = Vec::new();
            for (j, lid) in stelsel.leden.iter().enumerate() {
                for u in &lid.lokaal {
                    let mut x = vec![0.0; lengte];
                    x[6 * j..6 * j + 6].copy_from_slice(u);
                    basis.push(x);
                }
            }
            basis.extend(stelsel.g.iter().cloned());
            let centra: Vec<V3> = stelsel.leden.iter().map(|lid| lid.centrum).collect();
            let rijen: Vec<Vec<f64>> = vlakken.iter()
                .flat_map(|(j, vlak)| vlak.punten.iter().map(|p| {
                    let mut r = vec![0.0; lengte];
                    r[6 * j..6 * j + 6].copy_from_slice(&rij_langs(vlak.normaal, *p, centra[*j], l));
                    r
                }).collect::<Vec<_>>())
                .collect();
            (centra, in_de_nulruimte(&rijen, &basis))
        };
        if vast.is_empty() { continue; }
        let plaat_van: BTreeMap<usize, usize> = vlakken.iter().map(|(j, vlak)| (*j, vlak.plate_id)).collect();
        let vlakdelen = delen.iter().enumerate().map(|(j, deel)| Vlakdeel {
            centrum: centra[j],
            knopen: model.delen[*deel].knopen.iter().map(|k| model.ids[*k]).collect(),
            plate_id: plaat_van.get(&j).copied(),
        }).collect();
        let plate_id = vlakken.iter().map(|(_, vlak)| vlak.plate_id).min().expect("minstens één vlak");
        uit.push(Vlakvrij { plate_id, centrum: c, lengte: l, delen: vlakdelen, bewegingen: vast, via_schijf });
    }
    uit
}

/// De bewegingen in de ruimte van de orthonormale `basis` waarop alle
/// voorwaarden `rijen` nul zijn: v·a met a in de nulruimte van M = rijen·basis
/// (eigenvectoren van MᵀM met eigenwaarde onder de rangsgrens), orthonormaal.
fn in_de_nulruimte(rijen: &[Vec<f64>], basis: &[Vec<f64>]) -> Vec<Vec<f64>> {
    let q = basis.len();
    if q == 0 { return vec![]; }
    let m: Vec<Vec<f64>> = rijen.iter().map(|r| basis.iter().map(|x| dot_n(r, x)).collect()).collect();
    let gram = (0..q).map(|i| (0..q).map(|j| m.iter().map(|r| r[i] * r[j]).sum()).collect()).collect();
    let (waarden, vectoren) = eigen(gram);
    let grens = TOL * TOL * waarden.iter().copied().fold(1.0_f64, f64::max);
    let n = basis[0].len();
    waarden.iter().zip(&vectoren)
        .filter(|(waarde, _)| **waarde <= grens)
        .map(|(_, a)| (0..n).map(|k| (0..q).map(|i| a[i] * basis[i][k]).sum()).collect())
        .collect()
}

fn controleer_met(request: &SolveRequest3D, uitgesloten: &HashSet<usize>, grootste_schijven: usize) -> Vec<Bevinding> {
    controleer_volledig(request, uitgesloten, grootste_schijven, &Los::new(), true)
}

fn controleer_volledig(
    request: &SolveRequest3D,
    uitgesloten: &HashSet<usize>,
    grootste_schijven: usize,
    los: &Los,
    draairegel: bool,
) -> Vec<Bevinding> {
    let mut model = Model::bouw(request, uitgesloten, grootste_schijven, los, draairegel);
    model.vasthouding_via_schijf(request, uitgesloten, los);
    model.groepen().iter().flat_map(|(delen, schijven)| model.groep(delen, schijven)).collect()
}

/// Eén star deel in een groep die via schijven samenhangt.
struct Lid {
    centrum: V3,
    /// Lokale indices van de schijven waaraan het deel hangt, oplopend.
    schijven: Vec<usize>,
    /// Vrije bewegingen bij stilstaande schijven: orthonormaal, (t, L·θ) rond `centrum`.
    lokaal: Vec<V6>,
    /// Optillen: bij schijfbeweging s (3 per schijf in `schijven`) beweegt het
    /// deel met −Σ richting·(coëfficiënten·s), de kleinste passende beweging.
    koppel: Vec<(V6, Vec<f64>)>,
    /// Wat het deel van de schijfbewegingen tegenhoudt: de schijfvoorwaarden
    /// buiten het bereik van zijn eigen vrije bewegingen.
    houdt: Vec<Vec<f64>>,
}

/// De vrije bewegingen van delen die via schijven samenhangen: L (per lid
/// `lokaal`) en G (de opgetilde schijfbewegingen). Een volle vector heeft per
/// lid (t, L·θ) rond zijn centrum en per schijf (a, b, L·φ).
struct Stelsel {
    leden: Vec<Lid>,
    nschijf: usize,
    /// Orthonormale basis van de vrije schijfbewegingen.
    s: Vec<Vec<f64>>,
    /// Orthonormale basis van G.
    g: Vec<Vec<f64>>,
}

impl Stelsel {
    fn bouw(leden: Vec<Lid>, nschijf: usize) -> Self {
        let n = 3 * nschijf;
        let plaats = |r: &[f64], sleutel: &[usize]| -> Vec<f64> {
            let mut regel = vec![0.0; n];
            for (i, m) in sleutel.iter().enumerate() { regel[3 * m..3 * m + 3].copy_from_slice(&r[3 * i..3 * i + 3]); }
            regel
        };
        // Delen aan dezelfde schijven samen: hoogstens drie rijen per schijf.
        let mut rijen: Vec<Vec<f64>> = Vec::new();
        let mut samengevat: BTreeMap<Vec<usize>, Vec<Vec<f64>>> = BTreeMap::new();
        for lid in &leden {
            if lid.schijven.len() > GROOTSTE_SAMENVATTING {
                rijen.extend(lid.houdt.iter().filter(|r| norm_n(r) > 1e-12).map(|r| plaats(r, &lid.schijven)));
                continue;
            }
            let breed = 3 * lid.schijven.len();
            let gram = samengevat.entry(lid.schijven.clone()).or_insert_with(|| vec![vec![0.0; breed]; breed]);
            for r in &lid.houdt {
                for i in 0..breed {
                    if r[i] == 0.0 { continue; }
                    for j in 0..breed { gram[i][j] += r[i] * r[j]; }
                }
            }
        }
        for (sleutel, gram) in samengevat {
            let (waarden, vectoren) = eigen(gram);
            let grens = TOL * TOL * waarden.iter().copied().fold(1.0_f64, f64::max);
            rijen.extend(waarden.iter().zip(&vectoren).filter(|(w, _)| **w > grens).map(|(_, v)| plaats(v, &sleutel)));
        }
        let s = nulruimte(rijen, n);
        let mut stelsel = Self { leden, nschijf, s, g: Vec::new() };
        stelsel.g = orthonormaal(stelsel.s.iter().map(|v| stelsel.til(v)).collect());
        stelsel
    }

    fn lengte(&self) -> usize { 6 * self.leden.len() + 3 * self.nschijf }

    fn dimensie(&self) -> usize { self.leden.iter().map(|lid| lid.lokaal.len()).sum::<usize>() + self.g.len() }

    /// De kleinste beweging van alle delen bij schijfbeweging s.
    fn til(&self, s: &[f64]) -> Vec<f64> {
        let p = self.leden.len();
        let mut x = vec![0.0; self.lengte()];
        for (j, lid) in self.leden.iter().enumerate() {
            let eigen_s: Vec<f64> = lid.schijven.iter().flat_map(|m| s[3 * m..3 * m + 3].iter().copied()).collect();
            for (richting, coef) in &lid.koppel {
                let f = -dot_n(coef, &eigen_s);
                for a in 0..6 { x[6 * j + a] += f * richting[a]; }
            }
        }
        x[6 * p..].copy_from_slice(s);
        x
    }

    /// Loodrechte projectie op de vrije bewegingen (L ⊕ G).
    fn projectie(&self, x: &[f64]) -> Vec<f64> {
        let mut p = vec![0.0; x.len()];
        for (j, lid) in self.leden.iter().enumerate() {
            let blok: V6 = std::array::from_fn(|a| x[6 * j + a]);
            for u in &lid.lokaal {
                let f = dot6(&blok, u);
                for a in 0..6 { p[6 * j + a] += f * u[a]; }
            }
        }
        for g in &self.g { axpy(&mut p, dot_n(g, x), g); }
        p
    }
}

/// De benoemde bewegingen. Alle lokale (per lid, binnen L) worden eerst
/// geboekt; de globale daarna, loodrecht op de lokale gemaakt. Zo blijft het
/// boeken per beweging goedkoop, ook bij veel delen.
struct Boek {
    lokaal: Vec<Vec<V6>>,
    globaal: Vec<Vec<f64>>,
    /// Per schijf: welke schijfbewegingen (a, b, L·φ) de globale al dekken.
    gezien: Vec<Vec<V3>>,
    schijfbegin: usize,
}

impl Boek {
    fn nieuw(leden: usize, schijven: usize) -> Self {
        Self { lokaal: vec![Vec::new(); leden], globaal: Vec::new(), gezien: vec![Vec::new(); schijven], schijfbegin: 6 * leden }
    }

    fn rest(&self, x: &[f64]) -> Vec<f64> {
        let mut r = x.to_vec();
        for (j, basis) in self.lokaal.iter().enumerate() {
            for u in basis {
                let f: f64 = (0..6).map(|a| r[6 * j + a] * u[a]).sum();
                for a in 0..6 { r[6 * j + a] -= f * u[a]; }
            }
        }
        for g in &self.globaal {
            let f = dot_n(g, &r);
            axpy(&mut r, -f, g);
        }
        r
    }

    /// Boek een globale vrije beweging (genormeerd); false als ze er al in zit.
    fn neem(&mut self, x: &[f64]) -> bool {
        let rest = self.rest(&self.rest(x));
        let grootte = norm_n(&rest);
        if grootte <= TOL_LID { return false; }
        self.globaal.push(rest.iter().map(|v| v / grootte).collect());
        for (m, gezien) in self.gezien.iter_mut().enumerate() {
            let begin = self.schijfbegin + 3 * m;
            let d = [x[begin], x[begin + 1], x[begin + 2]];
            let n = norm(d);
            if n <= 1e-9 { continue; }
            let r = rest3(d, gezien);
            if norm(r) > TOL_LID * n { gezien.push(scale(r, 1.0 / norm(r))); }
        }
        true
    }
}

impl Model {
    fn bouw(request: &SolveRequest3D, uitgesloten: &HashSet<usize>, grootste_schijven: usize, los: &Los, draairegel: bool) -> Self {
        let mut knopen: Vec<&Node3D> = request.nodes.iter().collect();
        knopen.sort_by_key(|knoop| knoop.id);
        let ids: Vec<usize> = knopen.iter().map(|knoop| knoop.id).collect();
        let index: HashMap<usize, usize> = ids.iter().enumerate().map(|(i, id)| (*id, i)).collect();
        let punt: Vec<V3> = knopen.iter().map(|knoop| [knoop.x, knoop.y, knoop.z]).collect();
        let mut blok = vec![[false; 6]; ids.len()];
        let mut vlak_vast = vec![false; ids.len()];
        for steun in &request.supports {
            if let Some(&i) = index.get(&steun.node_id) {
                blok[i] = blokkeringen(steun);
                vlak_vast[i] = steun.ux || steun.uy || steun.rz;
            }
        }

        let mut extra = vec![Vec::new(); ids.len()];
        for (knoop, punt, richting) in bedding::steunen(request, los) {
            if let Some(&i) = index.get(&knoop) { extra[i].push((punt, richting)); }
        }
        // Platen op bedding (#107): de veren die meedoen, als voorwaarden langs
        // de normaal, en het vlak van elke plaat.
        let plaatplan = crate::plaatbedding::Plan::bouw(request);
        for (knoop, punt, richting) in plaatplan.steunen(los) {
            if let Some(&i) = index.get(&knoop) { extra[i].push((punt, richting)); }
        }
        let plaatvlakken: Vec<Plaatvlak> = plaatplan.vlakpunten().into_iter()
            .filter_map(|(plate_id, normaal, punten)| {
                let knoop = *index.get(&punten.first()?.0)?;
                Some(Plaatvlak { plate_id, normaal, knoop, punten: punten.into_iter().map(|(_, p)| p).collect() })
            })
            .collect();

        let mut unie = Unie::nieuw(ids.len());
        let mut in_element = vec![false; ids.len()];
        let staven: Vec<&Member3D> = request.members.iter().filter(|staaf| !uitgesloten.contains(&staaf.id)).collect();
        let ketens = staven.iter()
            .map(|staaf| {
                std::iter::once(staaf.start_node_id)
                    .chain(staaf.intermediate_node_ids.iter().copied())
                    .chain(std::iter::once(staaf.end_node_id))
                    .collect::<Vec<_>>()
            })
            .chain(request.shell_elements.iter().map(|element| element.node_ids.clone()));
        for keten in ketens {
            let keten: Vec<usize> = keten.iter().filter_map(|id| index.get(id).copied()).collect();
            for &i in &keten { in_element[i] = true; }
            for paar in keten.windows(2) { unie.verbind(paar[0], paar[1]); }
        }
        // Knoopkoppelingen (#97) tellen hier als starre verbinding tussen
        // meester en slaaf: een gekoppelde latei hangt aan de wand. Een
        // beweging in de niet-gekoppelde richtingen ziet deze controle niet;
        // die meldt de kern als singuliere matrix.
        for koppeling in &request.node_links {
            if let (Some(&a), Some(&b)) = (index.get(&koppeling.master_node_id), index.get(&koppeling.slave_node_id)) {
                unie.verbind(a, b);
            }
        }

        let mut delen: Vec<Deel> = Vec::new();
        let mut deel_bij_wortel: HashMap<usize, usize> = HashMap::new();
        let mut deel_van = Vec::with_capacity(ids.len());
        for i in 0..ids.len() {
            let wortel = unie.wortel(i);
            let deel = *deel_bij_wortel.entry(wortel).or_insert_with(|| {
                delen.push(Deel::default());
                delen.len() - 1
            });
            deel_van.push(deel);
            delen[deel].knopen.push(i);
        }
        for staaf in &staven {
            if let Some(&i) = index.get(&staaf.start_node_id) { delen[deel_van[i]].staven.push(staaf.id); }
        }
        for element in &request.shell_elements {
            if let Some(&i) = element.node_ids.first().and_then(|id| index.get(id)) {
                delen[deel_van[i]].platen.insert(element.plate_id);
            }
        }
        for deel in &mut delen { deel.staven.sort_unstable(); }

        // Alleen schijven die iets koppelen, zoals in `schijven::koppelingen`.
        let steunen: HashMap<usize, &Support3D> = request.supports.iter().map(|s| (s.node_id, s)).collect();
        let schijven: Vec<Schijf> = request.diaphragms.iter()
            .filter(|schijf| !schijf.node_ids.iter().all(|k| steunen.get(k).is_some_and(|s| s.ux && s.uy)))
            .map(|schijf| Schijf {
                id: schijf.id,
                knopen: schijf.node_ids.iter().filter_map(|id| index.get(id).copied()).collect(),
            })
            .filter(|schijf| !schijf.knopen.is_empty())
            .collect();
        let mut in_schijf = vec![false; ids.len()];
        for schijf in &schijven {
            for &k in &schijf.knopen {
                delen[deel_van[k]].schijven.insert(schijf.id);
                in_schijf[k] = true;
            }
        }
        Self {
            ids, punt, blok, vlak_vast, in_element, in_schijf, draairegel, extra, plaatvlakken, deel_van, delen,
            schijven, grootste_schijven,
        }
    }

    /// De verbonden modeldelen: starre delen die via schijven samenhangen, met
    /// die schijven (indices), op volgorde van het eerste deel.
    fn groepen(&self) -> Vec<(Vec<usize>, Vec<usize>)> {
        let mut groepen = Unie::nieuw(self.delen.len());
        for schijf in &self.schijven {
            for paar in schijf.knopen.windows(2) {
                groepen.verbind(self.deel_van[paar[0]], self.deel_van[paar[1]]);
            }
        }
        let mut per_groep: BTreeMap<usize, (Vec<usize>, Vec<usize>)> = BTreeMap::new();
        for deel in 0..self.delen.len() {
            per_groep.entry(groepen.wortel(deel)).or_default().0.push(deel);
        }
        for (index, schijf) in self.schijven.iter().enumerate() {
            per_groep.entry(groepen.wortel(self.deel_van[schijf.knopen[0]])).or_default().1.push(index);
        }
        per_groep.into_values().collect()
    }

    /// Een plaat op bedding in een verbonden deel met een starre schijf (#107):
    /// de vasthouding in het plaatvlak die de adapter daar zet
    /// (`plaatbedding::vlakvast_via_schijf`) telt als oplegging, zodat de
    /// controle ziet wat de kern vasthoudt. Zonder schijf splitst
    /// `vlak_splits` dezelfde bewegingen af. Zonder plaat op bedding of zonder
    /// schijf verandert er niets.
    fn vasthouding_via_schijf(&mut self, request: &SolveRequest3D, uitgesloten: &HashSet<usize>, los: &Los) {
        if self.plaatvlakken.is_empty() || self.schijven.is_empty() { return; }
        for (knoop, punt, richting) in crate::plaatbedding::vlakvast_via_schijf(request, uitgesloten, los) {
            if let Ok(i) = self.ids.binary_search(&knoop) { self.extra[i].push((punt, richting)); }
        }
    }

    /// De leden van een verbonden deel met schijven (`lid`) en de zwaartepunten
    /// van die schijven.
    fn leden(&self, delen: &[usize], schijven: &[usize], l: f64) -> (Vec<Lid>, Vec<V3>) {
        let centra_schijven: Vec<V3> = schijven.iter().map(|s| self.zwaartepunt(&self.schijven[*s].knopen)).collect();
        let schijf_van: HashMap<usize, usize> = schijven.iter().enumerate()
            .flat_map(|(m, s)| self.schijven[*s].knopen.iter().map(move |k| (*k, m)))
            .collect();
        let leden = delen.iter().map(|d| self.lid(*d, l, &schijf_van, &centra_schijven)).collect();
        (leden, centra_schijven)
    }

    /// De vrije bewegingen `v` (orthonormaal, rond c) van deel `deel` gesplitst
    /// in die in het vlak van een plaat op bedding van dat deel (bij meer: de
    /// laagste plaat-id), die de adapter vasthoudt (#107), en de rest; beide
    /// orthonormaal. `None` zonder plaat op bedding in het deel.
    ///
    /// Een beweging x ligt in het plaatvlak als geen knoop van de plaat langs
    /// de normaal beweegt; voor een vlakke plaat volstaan drie niet-collineaire
    /// knopen. Met M de voorwaarden van die drie punten op de basis v zijn de
    /// vastgehouden bewegingen v·a met a in de nulruimte van M, de rest v·a met
    /// a loodrecht daarop (eigenvectoren van MᵀM).
    fn vlak_splits(&self, deel: usize, c: V3, l: f64, v: &[V6]) -> Option<(usize, Vec<V6>, Vec<V6>)> {
        let vlak = self.plaatvlakken.iter().find(|vlak| self.deel_van[vlak.knoop] == deel)?;
        if v.is_empty() { return Some((vlak.plate_id, vec![], vec![])); }
        let rijen: Vec<V6> = vlak.punten.iter().map(|p| rij_langs(vlak.normaal, *p, c, l)).collect();
        let q = v.len();
        let m: Vec<Vec<f64>> = rijen.iter().map(|r| v.iter().map(|x| dot6(r, x)).collect()).collect();
        let gram = (0..q).map(|i| (0..q).map(|j| m.iter().map(|r| r[i] * r[j]).sum()).collect()).collect();
        let (waarden, vectoren) = eigen(gram);
        let grens = TOL * TOL * waarden.iter().copied().fold(1.0_f64, f64::max);
        let mut vast = Vec::new();
        let mut rest = Vec::new();
        for (waarde, a) in waarden.iter().zip(&vectoren) {
            let x: V6 = std::array::from_fn(|k| (0..q).map(|i| a[i] * v[i][k]).sum());
            if *waarde <= grens { vast.push(x) } else { rest.push(x) }
        }
        Some((vlak.plate_id, vast, rest))
    }

    /// Eén deel zonder schijf als star lichaam (rond c): zijn vrije bewegingen
    /// zonder de draaiing om de eigen as (#96) en zonder de bewegingen in het
    /// vlak van een plaat op bedding (#107); die twee houdt de adapter vast.
    fn vrij_als_deel(&self, deel: usize, knopen: &[usize], c: V3, l: f64) -> Vec<V6> {
        let v = self.zonder_eigen_as(knopen, nulruimte6(&self.groepsrijen(knopen, &[], c, l)));
        match self.vlak_splits(deel, c, l, &v) {
            Some((_, _, rest)) => rest,
            None => v,
        }
    }

    /// De as van een recht deel: alle `knopen` op één lijn door minstens twee
    /// verschillende punten. Ligt een knoop in een schijf, dan alleen een
    /// horizontale as: de draaiing om Z volgt dan de schijf.
    fn eigen_as(&self, knopen: &[usize]) -> Option<V3> {
        let begin = self.punt[*knopen.first()?];
        let (verst, afstand) = knopen.iter()
            .map(|k| (*k, norm(sub(self.punt[*k], begin))))
            .fold((knopen[0], 0.0), |beste, kandidaat| if kandidaat.1 > beste.1 { kandidaat } else { beste });
        if afstand <= 1e-9 { return None; }
        let d = scale(sub(self.punt[verst], begin), 1.0 / afstand);
        if knopen.iter().any(|k| norm(cross(sub(self.punt[*k], begin), d)) > 1e-6 * afstand.max(1.0)) {
            return None;
        }
        if d[2].abs() > 1e-5 && knopen.iter().any(|k| self.in_schijf[*k]) { return None; }
        Some(d)
    }

    /// De vrije bewegingen `v` (orthonormaal, (t, L·θ) rond een punt op de
    /// lijn) zonder de draaiing om de eigen as van een recht deel, die de
    /// adapter vasthoudt (#96). Alleen als die draaiing hier vrij is.
    fn zonder_eigen_as(&self, knopen: &[usize], v: Vec<V6>) -> Vec<V6> {
        if !self.draairegel || v.is_empty() { return v; }
        let Some(d) = self.eigen_as(knopen) else { return v };
        let as_: V6 = [0.0, 0.0, 0.0, d[0], d[1], d[2]];
        if norm6(&rest6(as_, &v)) > TOL_LID { return v; }
        let mut uit: Vec<V6> = Vec::new();
        for x in v {
            let r = rest6(rest6(x, &[as_]), &uit);
            let grootte = norm6(&r);
            if grootte > TOL_LID { uit.push(scale6(r, 1.0 / grootte)); }
        }
        uit
    }

    fn zwaartepunt(&self, knopen: &[usize]) -> V3 {
        let som = knopen.iter().fold([0.0; 3], |som, k| add(som, self.punt[*k]));
        scale(som, 1.0 / knopen.len().max(1) as f64)
    }

    fn opgelegd(&self, knoop: usize) -> bool { self.blok[knoop].iter().any(|v| *v) || !self.extra[knoop].is_empty() }

    /// De voorwaarden van alle opleggingen in `knopen`, rond c.
    fn steunrijen(&self, knopen: &[usize], c: V3, l: f64) -> Vec<V6> {
        let mut rijen = Vec::new();
        for &k in knopen {
            for (richting, vast) in self.blok[k].iter().enumerate() {
                if *vast { rijen.push(rij(richting, self.punt[k], c, l)); }
            }
            for (punt, richting) in &self.extra[k] {
                rijen.push(rij_langs(*richting, *punt, c, l));
            }
        }
        rijen
    }

    fn bevinding(&self, soort: Soort, delen: &[usize], schijven: Vec<usize>, vrij: Vec<Beweging>) -> Bevinding {
        let mut knopen: Vec<usize> = delen.iter().flat_map(|d| self.delen[*d].knopen.iter().map(|k| self.ids[*k])).collect();
        knopen.sort_unstable();
        let mut staven: Vec<usize> = delen.iter().flat_map(|d| self.delen[*d].staven.iter().copied()).collect();
        staven.sort_unstable();
        let platen: BTreeSet<usize> = delen.iter().flat_map(|d| self.delen[*d].platen.iter().copied()).collect();
        let mut schijven = schijven;
        schijven.sort_unstable();
        schijven.dedup();
        Bevinding { soort, knopen, staven, platen: platen.into_iter().collect(), schijven, vrij }
    }

    /// Eén verbonden modeldeel: starre delen `delen`, gekoppeld door de schijven `schijven` (indices).
    fn groep(&self, delen: &[usize], schijven: &[usize]) -> Vec<Bevinding> {
        let knopen: Vec<usize> = delen.iter().flat_map(|d| self.delen[*d].knopen.iter().copied()).collect();
        let schijf_ids: Vec<usize> = schijven.iter().map(|s| self.schijven[*s].id).collect();
        if delen.len() == 1 && schijven.is_empty() && knopen.len() == 1 && !self.in_element[knopen[0]] {
            if self.blok[knopen[0]].iter().all(|v| *v) { return vec![]; }
            return vec![self.bevinding(Soort::LosseKnoop, delen, vec![], vec![])];
        }
        if !knopen.iter().any(|k| self.opgelegd(*k)) {
            return vec![self.bevinding(Soort::Los, delen, schijf_ids, vec![])];
        }
        let c = self.zwaartepunt(&knopen);
        let l = knopen.iter().map(|k| norm(sub(self.punt[*k], c))).fold(1.0_f64, f64::max);
        if delen.len() == 1 && schijven.is_empty() {
            let v = self.vrij_als_deel(delen[0], &knopen, c, l);
            let vrij: Vec<Beweging> = self.benoem(&knopen, c, l, &v).into_iter().map(|(beweging, _)| beweging).collect();
            return if vrij.is_empty() { vec![] } else { vec![self.bevinding(Soort::Onvoldoende, delen, schijf_ids, vrij)] };
        }
        self.gekoppeld(delen, schijven, &knopen, c, l)
    }

    /// Het verbonden deel als één star lichaam (rond c).
    fn vrij_als_geheel(&self, knopen: &[usize], schijven: &[usize], c: V3, l: f64) -> Vec<Beweging> {
        let v = self.zonder_eigen_as(knopen, nulruimte6(&self.groepsrijen(knopen, schijven, c, l)));
        self.benoem(knopen, c, l, &v).into_iter().map(|(beweging, _)| beweging).collect()
    }

    /// De opleggingen van alle knopen, plus wat een schijf met hoogteverschil
    /// tegenhoudt: een draaiing om X of Y verschuift haar knopen dan ongelijk.
    fn groepsrijen(&self, knopen: &[usize], schijven: &[usize], c: V3, l: f64) -> Vec<V6> {
        let mut rijen = self.steunrijen(knopen, c, l);
        for &s in schijven {
            let schijf = &self.schijven[s];
            let hoogte = self.zwaartepunt(&schijf.knopen)[2];
            for &k in &schijf.knopen {
                let dz = (self.punt[k][2] - hoogte) / l;
                if dz != 0.0 {
                    rijen.push([0.0, 0.0, 0.0, 0.0, dz, 0.0]);
                    rijen.push([0.0, 0.0, 0.0, -dz, 0.0, 0.0]);
                }
            }
        }
        rijen
    }

    /// Deel `d` met zijn schijfvoorwaarden: zijn vrije bewegingen bij
    /// stilstaande schijven, hoe het een schijfbeweging volgt en wat het
    /// ervan tegenhoudt. Met A de voorwaarden op de eigen vrije bewegingen
    /// van het deel en B die op de schijfbewegingen: lokaal = nul(A),
    /// optillen = −A⁺B, tegenhouden = (I − AA⁺)B.
    fn lid(&self, d: usize, l: f64, schijf_van: &HashMap<usize, usize>, centra_schijven: &[V3]) -> Lid {
        let deel = &self.delen[d];
        let centrum = self.zwaartepunt(&deel.knopen);
        let basis = self.zonder_eigen_as(&deel.knopen, nulruimte6(&self.steunrijen(&deel.knopen, centrum, l)));
        let schijven: Vec<usize> = deel.knopen.iter()
            .filter_map(|k| schijf_van.get(k).copied())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let plek: HashMap<usize, usize> = schijven.iter().enumerate().map(|(i, m)| (*m, i)).collect();
        let breed = 3 * schijven.len();
        let mut a: Vec<Vec<f64>> = Vec::new();
        let mut b: Vec<Vec<f64>> = Vec::new();
        for &k in &deel.knopen {
            let Some(&m) = schijf_van.get(&k) else { continue };
            let (p, cs, i) = (self.punt[k], centra_schijven[m], plek[&m]);
            // u_x − a + φ·(y − y_s) = 0, u_y − b − φ·(x − x_s) = 0, θ_z − φ = 0.
            for (richting, schijfdeel) in [
                (0, [-1.0, 0.0, (p[1] - cs[1]) / l]),
                (1, [0.0, -1.0, -(p[0] - cs[0]) / l]),
                (5, [0.0, 0.0, -1.0]),
            ] {
                let voorwaarde = rij(richting, p, centrum, l);
                a.push(basis.iter().map(|e| dot6(&voorwaarde, e)).collect());
                let mut regel = vec![0.0; breed];
                regel[3 * i..3 * i + 3].copy_from_slice(&schijfdeel);
                b.push(regel);
            }
        }
        let q = basis.len();
        let gram = (0..q).map(|i| (0..q).map(|j| a.iter().map(|r| r[i] * r[j]).sum()).collect()).collect();
        let (waarden, vectoren) = eigen(gram);
        let grens = TOL * TOL * waarden.iter().copied().fold(1.0_f64, f64::max);
        let mut lokaal = Vec::new();
        let mut koppel = Vec::new();
        let mut houdt = b.clone();
        for (waarde, v) in waarden.iter().zip(&vectoren) {
            let richting: V6 = std::array::from_fn(|k| (0..q).map(|i| v[i] * basis[i][k]).sum());
            if *waarde <= grens {
                lokaal.push(richting);
                continue;
            }
            // û = A·v/√λ is een orthonormale basis van het bereik van A.
            let wortel = waarde.sqrt();
            let u: Vec<f64> = a.iter().map(|regel| dot_n(regel, v) / wortel).collect();
            let ub: Vec<f64> = (0..breed).map(|kolom| u.iter().zip(&b).map(|(ui, regel)| ui * regel[kolom]).sum()).collect();
            for (regel, ui) in houdt.iter_mut().zip(&u) {
                for kolom in 0..breed { regel[kolom] -= ui * ub[kolom]; }
            }
            koppel.push((scale6(richting, 1.0 / wortel), ub));
        }
        Lid { centrum, schijven, lokaal, koppel, houdt }
    }

    /// Delen die via schijven samenhangen: de vrije bewegingen van alle delen
    /// en schijven samen, benoemd voor het geheel, per schijf en per deel.
    fn gekoppeld(&self, delen: &[usize], schijven: &[usize], knopen: &[usize], c: V3, l: f64) -> Vec<Bevinding> {
        let schijf_ids: Vec<usize> = schijven.iter().map(|s| self.schijven[*s].id).collect();
        let (leden, centra_schijven) = self.leden(delen, schijven, l);
        if schijven.len() > self.grootste_schijven {
            return self.niet_volledig(delen, schijven, &leden, knopen, c, l);
        }
        let stelsel = Stelsel::bouw(leden, schijven.len());
        if stelsel.dimensie() == 0 { return vec![]; }
        let p = delen.len();
        let lengte = stelsel.lengte();
        let mut boek = Boek::nieuw(p, schijven.len());

        // Eerst geboekt: elk deel bij stilstaande schijven (L).
        let mut per_deel = Vec::new();
        for (j, lid) in stelsel.leden.iter().enumerate() {
            if lid.lokaal.is_empty() { continue; }
            let deel = &self.delen[delen[j]];
            let mut vrij = Vec::new();
            for (beweging, w) in self.benoem(&deel.knopen, lid.centrum, l, &lid.lokaal) {
                let grootte = norm6(&w);
                if grootte == 0.0 { continue; }
                let w = scale6(w, 1.0 / grootte);
                if norm6(&rest6(w, &lid.lokaal)) > TOL_LID { continue; }
                let r = rest6(w, &boek.lokaal[j]);
                let n = norm6(&r);
                if n <= TOL_LID { continue; }
                boek.lokaal[j].push(scale6(r, 1.0 / n));
                vrij.push(beweging);
            }
            if !vrij.is_empty() {
                per_deel.push(self.bevinding(Soort::ViaSchijf, &[delen[j]], deel.schijven.iter().copied().collect(), vrij));
            }
        }

        let mut uitkomst = Vec::new();
        // 1. Het verbonden deel als geheel.
        let geheel = self.zonder_eigen_as(knopen, nulruimte6(&self.groepsrijen(knopen, schijven, c, l)));
        let vrij: Vec<Beweging> = self.benoem(knopen, c, l, &geheel).into_iter()
            .filter_map(|(beweging, w)| {
                let t = [w[0], w[1], w[2]];
                let theta = [w[3] / l, w[4] / l, w[5] / l];
                let mut x = vec![0.0; lengte];
                for (j, lid) in stelsel.leden.iter().enumerate() {
                    let tj = add(t, cross(theta, sub(lid.centrum, c)));
                    x[6 * j..6 * j + 3].copy_from_slice(&tj);
                    x[6 * j + 3..6 * j + 6].copy_from_slice(&w[3..6]);
                }
                for (m, cs) in centra_schijven.iter().enumerate() {
                    let u = add(t, cross(theta, sub(*cs, c)));
                    x[6 * p + 3 * m..6 * p + 3 * m + 3].copy_from_slice(&[u[0], u[1], w[5]]);
                }
                let x = genormeerd(x)?;
                let buiten: Vec<f64> = x.iter().zip(stelsel.projectie(&x)).map(|(a, b)| a - b).collect();
                if norm_n(&buiten) > TOL_LID { return None; }
                boek.neem(&x).then_some(beweging)
            })
            .collect();
        if !vrij.is_empty() { uitkomst.push(self.bevinding(Soort::Onvoldoende, delen, schijf_ids.clone(), vrij)); }

        // 2. Elke schijf met de delen die eraan hangen: zwaaien en draaien.
        for (m, &index) in schijven.iter().enumerate() {
            let eigen_s: Vec<V3> = stelsel.s.iter().map(|v| [v[3 * m], v[3 * m + 1], v[3 * m + 2]]).collect();
            let mut gram = vec![vec![0.0; 3]; 3];
            for v in &eigen_s {
                for a in 0..3 { for b in 0..3 { gram[a][b] += v[a] * v[b]; } }
            }
            let (waarden, vectoren) = eigen(gram);
            let bereik: Vec<(V3, f64)> = (0..3).filter(|i| waarden[*i] > TOL * TOL)
                .map(|i| ([vectoren[i][0], vectoren[i][1], vectoren[i][2]], waarden[i]))
                .collect();
            if bereik.is_empty() { continue; }
            // Als lichaam in het XY-vlak: (a, b, 0, 0, 0, L·φ) rond haar zwaartepunt.
            let v6: Vec<V6> = bereik.iter().map(|(u, _)| [u[0], u[1], 0.0, 0.0, 0.0, u[2]]).collect();
            let schijf = &self.schijven[index];
            let mut mee = BTreeSet::new();
            let mut vrij = Vec::new();
            for (beweging, w) in self.benoem(&schijf.knopen, centra_schijven[m], l, &v6) {
                let d = [w[0], w[1], w[5]];
                let grootte = norm(d);
                if grootte == 0.0 { continue; }
                let d = scale(d, 1.0 / grootte);
                if norm(rest3(d, &boek.gezien[m])) <= TOL_LID { continue; }
                // De kleinste vrije schijfbeweging waarin schijf m zo beweegt.
                let y = bereik.iter().fold([0.0; 3], |som, (u, waarde)| add(som, scale(*u, dot(*u, d) / waarde)));
                let mut s = vec![0.0; 3 * schijven.len()];
                for (v, vm) in stelsel.s.iter().zip(&eigen_s) { axpy(&mut s, dot(*vm, y), v); }
                let Some(x) = genormeerd(stelsel.til(&s)) else { continue };
                if !boek.neem(&x) { continue; }
                let eigen_beweging = norm([s[3 * m], s[3 * m + 1], s[3 * m + 2]]);
                for ander in (0..schijven.len()).filter(|ander| *ander != m) {
                    if norm([s[3 * ander], s[3 * ander + 1], s[3 * ander + 2]]) > 1e-3 * eigen_beweging {
                        mee.insert(schijf_ids[ander]);
                    }
                }
                vrij.push(beweging);
            }
            if vrij.is_empty() { continue; }
            let aan: Vec<usize> = stelsel.leden.iter().enumerate()
                .filter(|(_, lid)| lid.schijven.contains(&m))
                .map(|(j, _)| delen[j])
                .collect();
            let steunknoop = schijf.knopen.iter().find(|k| self.vlak_vast[**k]).map(|k| self.ids[*k]);
            let soort = Soort::Schijf { steunknoop, mee: mee.into_iter().collect() };
            uitkomst.push(self.bevinding(soort, &aan, vec![schijf.id], vrij));
        }
        // 3. Elk deel ten opzichte van de schijf waaraan het hangt (hierboven geboekt).
        uitkomst.extend(per_deel);

        // 4. Wat overblijft: delen die alleen samen kunnen bewegen.
        let lokaal_over = stelsel.leden.iter().enumerate()
            .flat_map(|(j, lid)| lid.lokaal.iter().map(move |u| (j, *u)))
            .map(|(j, u)| {
                let mut x = vec![0.0; lengte];
                x[6 * j..6 * j + 6].copy_from_slice(&u);
                x
            });
        let mut over: Vec<Vec<f64>> = Vec::new();
        let mut samen = BTreeSet::new();
        for kandidaat in lokaal_over.chain(stelsel.g.iter().cloned()) {
            let rest = rest_n(&boek.rest(&kandidaat), &over);
            let grootte = norm_n(&rest);
            if grootte <= TOL { continue; }
            let rest: Vec<f64> = rest.iter().map(|x| x / grootte).collect();
            for (j, &d) in delen.iter().enumerate() {
                if norm_n(&rest[6 * j..6 * j + 6]) > 1e-3 { samen.insert(d); }
            }
            over.push(rest);
        }
        if !over.is_empty() {
            if samen.is_empty() { samen.extend(delen.iter().copied()); }
            let delen: Vec<usize> = samen.into_iter().collect();
            let via = delen.iter().flat_map(|d| self.delen[*d].schijven.iter().copied()).collect();
            uitkomst.push(self.bevinding(Soort::Samen, &delen, via, vec![]));
        }
        uitkomst
    }

    /// Te veel schijven voor het volledige stelsel: het geheel en elk deel bij
    /// stilstaande schijven, en een melding dat de schijven zelf niet zijn nagegaan.
    fn niet_volledig(&self, delen: &[usize], schijven: &[usize], leden: &[Lid], knopen: &[usize], c: V3, l: f64) -> Vec<Bevinding> {
        let schijf_ids: Vec<usize> = schijven.iter().map(|s| self.schijven[*s].id).collect();
        let mut uitkomst = Vec::new();
        let vrij = self.vrij_als_geheel(knopen, schijven, c, l);
        if !vrij.is_empty() { uitkomst.push(self.bevinding(Soort::Onvoldoende, delen, schijf_ids.clone(), vrij)); }
        for (j, lid) in leden.iter().enumerate() {
            if lid.lokaal.is_empty() { continue; }
            let deel = &self.delen[delen[j]];
            let vrij: Vec<Beweging> = self.benoem(&deel.knopen, lid.centrum, l, &lid.lokaal).into_iter()
                .map(|(beweging, _)| beweging)
                .collect();
            if !vrij.is_empty() {
                uitkomst.push(self.bevinding(Soort::ViaSchijf, &[delen[j]], deel.schijven.iter().copied().collect(), vrij));
            }
        }
        uitkomst.push(self.bevinding(Soort::NietNagegaan, delen, schijf_ids, vec![]));
        uitkomst
    }

    /// De knoop die het verst van de as door `anker` in richting ω (eenheid)
    /// ligt, met de richting waarin hij bij de draaiing beweegt: ω × (q − anker).
    fn dwars(&self, knopen: &[usize], anker: V3, omega: V3) -> Option<(usize, V3)> {
        let mut beste: Option<(usize, f64)> = None;
        for &k in knopen {
            let afstand = norm(cross(omega, sub(self.punt[k], anker)));
            if beste.is_none_or(|(_, b)| afstand > b * (1.0 + 1e-9) + 1e-12) { beste = Some((k, afstand)); }
        }
        let (q, afstand) = beste?;
        (afstand > 1e-9).then(|| (q, cross(omega, sub(self.punt[q], anker))))
    }

    /// Een nette basis voor de vrije bewegingen `v` (orthonormaal, (t, L·θ) rond c)
    /// van het lichaam met deze knopen, met naam en beweging.
    fn benoem(&self, knopen: &[usize], c: V3, l: f64, v: &[V6]) -> Vec<(Beweging, V6)> {
        if v.is_empty() { return vec![]; }
        let k = v.len();
        let theta: Vec<V3> = v.iter().map(|x| [x[3], x[4], x[5]]).collect();
        // Translaties: combinaties zonder draaiing (nulruimte van het θ-deel).
        let gram: Vec<Vec<f64>> = (0..k).map(|i| (0..k).map(|j| dot(theta[i], theta[j])).collect()).collect();
        let (waarden, vectoren) = eigen(gram);
        let grens = TOL * TOL;
        let mut translaties: Vec<V3> = Vec::new();
        for (waarde, coef) in waarden.iter().zip(&vectoren) {
            if *waarde > grens { continue; }
            let t = (0..k).fold([0.0; 3], |som, j| add(som, scale([v[j][0], v[j][1], v[j][2]], coef[j])));
            if norm(t) > TOL { translaties.push(scale(t, 1.0 / norm(t))); }
        }
        let translaties = orthonormaal3(translaties);
        // Draairichtingen: het bereik van het θ-deel.
        let mut m = vec![vec![0.0; 3]; 3];
        for t in &theta { for a in 0..3 { for b in 0..3 { m[a][b] += t[a] * t[b]; } } }
        let (waarden3, vectoren3) = eigen(m);
        let draai: Vec<(V3, f64)> = (0..3).filter(|i| waarden3[*i] > grens)
            .map(|i| ([vectoren3[i][0], vectoren3[i][1], vectoren3[i][2]], waarden3[i]))
            .collect();

        let mut uit = Vec::new();
        let mut gekozen: Vec<V3> = Vec::new();
        for (a, asnaam) in ASSEN.iter().enumerate() {
            let e = eenheid(a);
            if norm(rest3(e, &translaties)) <= TOL_LID {
                gekozen.push(e);
                uit.push((Beweging { naam: format!("verschuiven in {asnaam}"), vorm: Vorm::Verschuiven(Some(a)) },
                    [e[0], e[1], e[2], 0.0, 0.0, 0.0]));
            }
        }
        for t in &translaties {
            let r = rest3(*t, &gekozen);
            if norm(r) <= TOL_LID { continue; }
            let r = richting(r);
            gekozen.push(r);
            uit.push((Beweging { naam: format!("verschuiven in de richting {}", richting_tekst(r)), vorm: Vorm::Verschuiven(None) },
                [r[0], r[1], r[2], 0.0, 0.0, 0.0]));
        }

        let bereik: Vec<V3> = draai.iter().map(|(u, _)| *u).collect();
        let mut richtingen: Vec<(V3, Option<usize>)> = Vec::new();
        for a in 0..3 {
            let e = eenheid(a);
            if norm(rest3(e, &bereik)) <= TOL_LID { richtingen.push((e, Some(a))); }
        }
        for u in &bereik {
            let gehad: Vec<V3> = richtingen.iter().map(|(r, _)| *r).collect();
            let r = rest3(*u, &gehad);
            if norm(r) > TOL_LID { richtingen.push((richting(r), None)); }
        }
        let lijst = |knopen: &[usize]| knopen.iter().map(|k| self.ids[*k]).collect::<Vec<_>>();
        for (omega, as_) in richtingen {
            // Een beweging uit v met θ-deel ω: c = Bᵀ(BBᵀ)⁺ω.
            let y = draai.iter().fold([0.0; 3], |som, (u, waarde)| add(som, scale(*u, dot(*u, omega) / waarde)));
            let mut x = [0.0; 6];
            for (j, vector) in v.iter().enumerate() {
                let f = dot(theta[j], y);
                for a in 0..6 { x[a] += f * vector[a]; }
            }
            // Vrije verschuivingen halen de as zo dicht mogelijk bij c.
            let t = rest3([x[0], x[1], x[2]], &translaties);
            let rond_c = [t[0], t[1], t[2], omega[0], omega[1], omega[2]];
            let asnaam = as_.map(|a| ASSEN[a].to_string());
            if dot(t, omega).abs() > TOL_LID {
                let om = asnaam.unwrap_or_else(|| format!("de richting {}", richting_tekst(omega)));
                uit.push((Beweging {
                    naam: format!("schroefbeweging: draaien om {om} met tegelijk verschuiven langs die as"),
                    vorm: Vorm::Schroef,
                }, rond_c));
                continue;
            }
            let draaiing = scale(omega, 1.0 / l);
            let om_punt = |p: V3| -> V6 {
                let t = cross(draaiing, sub(c, p));
                [t[0], t[1], t[2], omega[0], omega[1], omega[2]]
            };
            let toegestaan: Vec<usize> = knopen.iter().copied()
                .filter(|k| {
                    let w = om_punt(self.punt[*k]);
                    norm6(&rest6(w, v)) <= TOL_LID * norm6(&w)
                })
                .collect();
            let op_lijn = |anker: V3| -> Vec<usize> {
                knopen.iter().copied()
                    .filter(|k| norm(cross(sub(self.punt[*k], anker), omega)) <= 1e-6 * l + 1e-9)
                    .collect()
            };
            if toegestaan.len() == knopen.len() {
                // Elke knoop ligt op een toegestane as: de plaats doet er niet toe.
                let lijn = op_lijn(self.punt[knopen[0]]);
                let (plaats, dwars) = if lijn.len() == knopen.len() {
                    (Plaats::OpDeAs, None)
                } else {
                    // Twee knopen samen houden de draaiing tegen, ongeacht waar de as ligt.
                    let anker = knopen.iter().copied().find(|k| self.opgelegd(*k)).unwrap_or(knopen[0]);
                    let dwars = self.dwars(knopen, self.punt[anker], omega)
                        .map(|(q, richting)| Dwars { knopen: vec![self.ids[anker], self.ids[q]], richting });
                    (Plaats::Vrij, dwars)
                };
                let naam = match (&asnaam, lijn.len()) {
                    (Some(a), _) => format!("draaien om {a}"),
                    (None, 2..) => format!("draaien om de as door {}", knoopreeks(&lijst(&lijn))),
                    (None, _) => format!("draaien om een as in de richting {}", richting_tekst(omega)),
                };
                uit.push((Beweging { naam, vorm: Vorm::Draaien { as_, plaats, dwars } }, rond_c));
            } else if let Some(&anker) = toegestaan.iter().find(|k| self.opgelegd(**k)).or(toegestaan.first()) {
                let lijn = lijst(&op_lijn(self.punt[anker]));
                let naam = match (&asnaam, lijn.len()) {
                    (Some(a), _) => format!("draaien om {a} (as door {})", knoopreeks(&lijn)),
                    (None, 2..) => format!("draaien om de as door {}", knoopreeks(&lijn)),
                    (None, _) => format!("draaien om een as door {} in de richting {}", knoopreeks(&lijn), richting_tekst(omega)),
                };
                let dwars = self.dwars(knopen, self.punt[anker], omega)
                    .map(|(q, richting)| Dwars { knopen: vec![self.ids[q]], richting });
                uit.push((Beweging { naam, vorm: Vorm::Draaien { as_, plaats: Plaats::Bepaald, dwars } }, om_punt(self.punt[anker])));
            } else {
                // Geen knoop op de as: noem het punt van de as het dichtst bij c.
                let punt = add(c, scale(cross(omega, t), l));
                let naam = match &asnaam {
                    Some(a) => format!("draaien om {a} (as door het punt {} m)", punt_tekst(punt)),
                    None => format!("draaien om een as door het punt {} m in de richting {}", punt_tekst(punt), richting_tekst(omega)),
                };
                let dwars = self.dwars(knopen, punt, omega)
                    .map(|(q, richting)| Dwars { knopen: vec![self.ids[q]], richting });
                uit.push((Beweging { naam, vorm: Vorm::Draaien { as_, plaats: Plaats::Bepaald, dwars } }, rond_c));
            }
        }
        uit
    }
}

fn eenheid(as_: usize) -> V3 {
    let mut e = [0.0; 3];
    e[as_] = 1.0;
    e
}

/// Eenheidsvector met de grootste component positief.
fn richting(r: V3) -> V3 {
    let r = scale(r, 1.0 / norm(r));
    let grootste = r.iter().copied().fold(0.0_f64, |a, b| if b.abs() > a.abs() { b } else { a });
    if grootste < 0.0 { scale(r, -1.0) } else { r }
}

fn dot6(a: &V6, b: &V6) -> f64 { (0..6).map(|i| a[i] * b[i]).sum() }

fn norm6(a: &V6) -> f64 { dot6(a, a).sqrt() }

fn scale6(a: V6, s: f64) -> V6 { a.map(|x| x * s) }

/// x min zijn projectie op de orthonormale basis.
fn rest6(x: V6, basis: &[V6]) -> V6 {
    let mut r = x;
    for b in basis {
        let f = dot6(&r, b);
        for i in 0..6 { r[i] -= f * b[i]; }
    }
    r
}

fn rest3(x: V3, basis: &[V3]) -> V3 {
    basis.iter().fold(x, |r, b| sub(r, scale(*b, dot(r, *b))))
}

fn orthonormaal3(vectoren: Vec<V3>) -> Vec<V3> {
    let mut basis: Vec<V3> = Vec::new();
    for v in vectoren {
        let r = rest3(v, &basis);
        if norm(r) > TOL_LID { basis.push(scale(r, 1.0 / norm(r))); }
    }
    basis
}

fn dot_n(a: &[f64], b: &[f64]) -> f64 { a.iter().zip(b).map(|(p, q)| p * q).sum() }

fn norm_n(a: &[f64]) -> f64 { dot_n(a, a).sqrt() }

/// y += f·x
fn axpy(y: &mut [f64], f: f64, x: &[f64]) {
    for (yi, xi) in y.iter_mut().zip(x) { *yi += f * xi; }
}

fn genormeerd(x: Vec<f64>) -> Option<Vec<f64>> {
    let grootte = norm_n(&x);
    (grootte > 0.0).then(|| x.iter().map(|v| v / grootte).collect())
}

fn rest_n(x: &[f64], basis: &[Vec<f64>]) -> Vec<f64> {
    let mut r = x.to_vec();
    for b in basis {
        let f = dot_n(&r, b);
        axpy(&mut r, -f, b);
    }
    r
}

fn orthonormaal(vectoren: Vec<Vec<f64>>) -> Vec<Vec<f64>> {
    let mut basis: Vec<Vec<f64>> = Vec::new();
    for v in vectoren {
        // Twee keer projecteren houdt de basis ook bij veel vectoren orthogonaal.
        let r = rest_n(&rest_n(&v, &basis), &basis);
        let grootte = norm_n(&r);
        if grootte > 1e-9 * norm_n(&v).max(1e-300) { basis.push(r.iter().map(|x| x / grootte).collect()); }
    }
    basis
}

/// Nulruimte van een stelsel met zes onbekenden, via de eigenwaarden van AᵀA.
fn nulruimte6(rijen: &[V6]) -> Vec<V6> {
    let mut gram = vec![vec![0.0; 6]; 6];
    for r in rijen {
        for i in 0..6 {
            if r[i] == 0.0 { continue; }
            for j in 0..6 { gram[i][j] += r[i] * r[j]; }
        }
    }
    let (waarden, vectoren) = eigen(gram);
    let grens = TOL * TOL * waarden.iter().copied().fold(1.0_f64, f64::max);
    (0..6).filter(|i| waarden[*i] <= grens)
        .map(|i| std::array::from_fn(|k| vectoren[i][k]))
        .collect()
}

/// Orthonormale nulruimte van een stelsel met n onbekenden (Gauss-eliminatie
/// met rijpivotering op genormeerde rijen).
fn nulruimte(rijen: Vec<Vec<f64>>, n: usize) -> Vec<Vec<f64>> {
    let mut a: Vec<Vec<f64>> = rijen.into_iter()
        .filter_map(|rij| {
            let grootte = norm_n(&rij);
            (grootte > 0.0).then(|| rij.iter().map(|x| x / grootte).collect())
        })
        .collect();
    let mut spil: Vec<usize> = Vec::new();
    for kolom in 0..n {
        let r = spil.len();
        if r == a.len() { break; }
        let (beste, waarde) = (r..a.len())
            .map(|i| (i, a[i][kolom].abs()))
            .fold((r, -1.0), |best, kandidaat| if kandidaat.1 > best.1 { kandidaat } else { best });
        if waarde <= TOL * 0.1 { continue; }
        a.swap(r, beste);
        let p = a[r][kolom];
        for x in a[r].iter_mut() { *x /= p; }
        let spilrij = a[r].clone();
        for (i, rij) in a.iter_mut().enumerate() {
            if i == r { continue; }
            let f = rij[kolom];
            if f == 0.0 { continue; }
            for (x, s) in rij.iter_mut().zip(&spilrij) { *x -= f * s; }
        }
        spil.push(kolom);
    }
    let vrij: Vec<usize> = (0..n).filter(|k| !spil.contains(k)).collect();
    let basis = vrij.iter().map(|&f| {
        let mut v = vec![0.0; n];
        v[f] = 1.0;
        for (r, &kolom) in spil.iter().enumerate() { v[kolom] = -a[r][f]; }
        v
    }).collect();
    orthonormaal(basis)
}

/// Eigenwaarden en -vectoren van een symmetrische matrix (Jacobi); vector i
/// hoort bij waarde i.
pub(crate) fn eigen(mut a: Vec<Vec<f64>>) -> (Vec<f64>, Vec<Vec<f64>>) {
    let n = a.len();
    let mut v: Vec<Vec<f64>> = (0..n).map(|i| (0..n).map(|j| if i == j { 1.0 } else { 0.0 }).collect()).collect();
    let schaal: f64 = a.iter().flatten().map(|x| x * x).sum();
    for _ronde in 0..100 {
        let buiten: f64 = (0..n).flat_map(|i| (0..n).map(move |j| (i, j)))
            .filter(|(i, j)| i != j)
            .map(|(i, j)| a[i][j] * a[i][j])
            .sum();
        if buiten <= 1e-32 * schaal || buiten < 1e-300 { break; }
        for p in 0..n {
            for q in (p + 1)..n {
                if a[p][q].abs() < 1e-300 { continue; }
                let hoek = (a[q][q] - a[p][p]) / (2.0 * a[p][q]);
                let t = if hoek == 0.0 { 1.0 } else { hoek.signum() / (hoek.abs() + (hoek * hoek + 1.0).sqrt()) };
                let cos = 1.0 / (t * t + 1.0).sqrt();
                let sin = t * cos;
                for rij in a.iter_mut() {
                    let (akp, akq) = (rij[p], rij[q]);
                    rij[p] = cos * akp - sin * akq;
                    rij[q] = sin * akp + cos * akq;
                }
                let (rij_p, rij_q) = (a[p].clone(), a[q].clone());
                for k in 0..n {
                    a[p][k] = cos * rij_p[k] - sin * rij_q[k];
                    a[q][k] = sin * rij_p[k] + cos * rij_q[k];
                }
                for rij in v.iter_mut() {
                    let (vkp, vkq) = (rij[p], rij[q]);
                    rij[p] = cos * vkp - sin * vkq;
                    rij[q] = sin * vkp + cos * vkq;
                }
            }
        }
    }
    let waarden = (0..n).map(|i| a[i][i]).collect();
    let vectoren = (0..n).map(|i| (0..n).map(|k| v[k][i]).collect()).collect();
    (waarden, vectoren)
}

// ── Tekst ──────────────────────────────────────────────────────────────────

fn getal(x: f64) -> String {
    let x = if x.abs() < 5e-4 { 0.0 } else { x };
    format!("{x:.3}").replace('.', ",")
}

fn richting_tekst(r: V3) -> String { format!("({}; {}; {})", getal(r[0]), getal(r[1]), getal(r[2])) }

fn punt_tekst(p: V3) -> String { richting_tekst(p) }

/// "a", "a en b", "a, b en c".
fn opsomming(delen: &[String]) -> String { opsomming_met(delen, "en") }

/// "a", "a of b", "a, b of c".
fn keuze(delen: &[String]) -> String { opsomming_met(delen, "of") }

fn opsomming_met(delen: &[String], voegwoord: &str) -> String {
    match delen {
        [] => String::new(),
        [een] => een.clone(),
        [voor @ .., laatste] => format!("{} {voegwoord} {laatste}", voor.join(", ")),
    }
}

/// Oplopende nummers, opeenvolgende vanaf `min_reeks` stuks als reeks "7–9";
/// lange lijsten ingekort.
pub(crate) fn reeks(ids: &[usize], min_reeks: usize) -> String {
    let mut ids = ids.to_vec();
    ids.sort_unstable();
    ids.dedup();
    let mut groepen = Vec::new();
    let mut i = 0;
    while i < ids.len() {
        let mut j = i;
        while j + 1 < ids.len() && ids[j + 1] == ids[j] + 1 { j += 1; }
        if j + 1 - i >= min_reeks.max(2) {
            groepen.push(format!("{}–{}", ids[i], ids[j]));
            i = j + 1;
        } else {
            groepen.push(ids[i].to_string());
            i += 1;
        }
    }
    if groepen.len() > MAX_GROEPEN {
        format!("{}, … ({} in totaal)", groepen[..MAX_GROEPEN - 1].join(", "), ids.len())
    } else {
        opsomming(&groepen)
    }
}

/// "knoop 7" of "knopen 7–9".
pub(crate) fn noem(enkelvoud: &str, meervoud: &str, ids: &[usize]) -> String {
    if ids.len() == 1 { format!("{enkelvoud} {}", ids[0]) } else { format!("{meervoud} {}", reeks(ids, 2)) }
}

/// Knopen op een as: "knoop 4", "knoop 1 en 2", "de knopen 1, 5 en 9".
fn knoopreeks(ids: &[usize]) -> String {
    if ids.len() <= 2 { format!("knoop {}", reeks(ids, 3)) } else { format!("de knopen {}", reeks(ids, 3)) }
}

/// De assen waarin een oplegging een beweging in richting v tegenhoudt: "in Y", "in X of Y".
fn dwars_tekst(v: V3) -> String {
    let grootte = norm(v);
    let assen: Vec<String> = (0..3)
        .filter(|a| v[*a].abs() >= WEZENLIJK * grootte)
        .map(|a| ASSEN[a].to_string())
        .collect();
    format!("in {}", keuze(&assen))
}

fn onderwerp(b: &Bevinding, met_schijven: bool) -> String {
    let mut delen = vec![noem("knoop", "knopen", &b.knopen)];
    if !b.staven.is_empty() { delen.push(noem("staaf", "staven", &b.staven)); }
    if !b.platen.is_empty() { delen.push(noem("plaat", "platen", &b.platen)); }
    if met_schijven && !b.schijven.is_empty() { delen.push(noem("schijf", "schijven", &b.schijven)); }
    opsomming(&delen)
}

pub(crate) fn hoofdletter(tekst: &str) -> String {
    let mut tekens = tekst.chars();
    tekens.next().map(|eerste| eerste.to_uppercase().chain(tekens).collect()).unwrap_or_default()
}

/// Concrete aanwijzingen bij de vrije bewegingen.
fn aanwijzing(bewegingen: &[Beweging]) -> String {
    let mut delen: Vec<String> = Vec::new();
    let assen: Vec<usize> = bewegingen.iter()
        .filter_map(|b| match &b.vorm { Vorm::Verschuiven(Some(a)) => Some(*a), _ => None })
        .collect();
    let horizontaal: Vec<String> = assen.iter().filter(|a| **a < 2).map(|a| ASSEN[*a].to_string()).collect();
    let mut opleggingen = Vec::new();
    match horizontaal.as_slice() {
        [] => {}
        [as_] => opleggingen.push(format!("een horizontale oplegging in {as_}")),
        _ => opleggingen.push(format!("horizontale opleggingen in {}", opsomming(&horizontaal))),
    }
    if assen.contains(&2) { opleggingen.push("een verticale oplegging (Z)".to_string()); }
    if bewegingen.iter().any(|b| matches!(b.vorm, Vorm::Verschuiven(None))) {
        opleggingen.push("een oplegging in de vrije richting".to_string());
    }
    if !opleggingen.is_empty() { delen.push(format!("voeg {} toe", opsomming(&opleggingen))); }
    for beweging in bewegingen {
        match &beweging.vorm {
            Vorm::Draaien { as_, plaats, dwars } => {
                let om = as_.map(|a| format!("om {}", ASSEN[a])).unwrap_or_else(|| "om die as".into());
                let blokkeer = format!("blokkeer de rotatie {om} met een inklemming of rotatieveer");
                delen.push(match (plaats, dwars) {
                    (Plaats::OpDeAs, _) => format!("blokkeer de rotatie {om} met een inklemming, rotatieveer of passende revolute-oplegging"),
                    (Plaats::Vrij, Some(d)) => format!("{blokkeer}, of houd {} {} vast", knoopreeks(&d.knopen), dwars_tekst(d.richting)),
                    (Plaats::Bepaald, Some(d)) => format!("{blokkeer}, of houd {} buiten de draaias {} vast", knoopreeks(&d.knopen), dwars_tekst(d.richting)),
                    (Plaats::Vrij, None) => format!("{blokkeer}, of houd een tweede knoop dwars op de draaias vast"),
                    (Plaats::Bepaald, None) => format!("{blokkeer}, of houd een knoop buiten de draaias vast"),
                });
            }
            Vorm::Schroef => delen.push("voeg een oplegging toe die deze schroefbeweging tegenhoudt".into()),
            Vorm::Verschuiven(_) => {}
        }
    }
    delen.join("; ")
}

/// Aanwijzing bij een schijf die met de delen die eraan hangen kan bewegen.
fn schijf_aanwijzing(schijf: usize, steunknoop: Option<usize>, bewegingen: &[Beweging]) -> String {
    let assen: Vec<String> = bewegingen.iter()
        .filter_map(|b| match &b.vorm { Vorm::Verschuiven(Some(a)) => Some(ASSEN[*a].to_string()), _ => None })
        .collect();
    let schuin = bewegingen.iter().any(|b| matches!(b.vorm, Vorm::Verschuiven(None)));
    let draaien = bewegingen.iter().any(|b| matches!(b.vorm, Vorm::Draaien { .. } | Vorm::Schroef));
    let mut waarin = Vec::new();
    if !assen.is_empty() { waarin.push(format!("in {}", opsomming(&assen))); }
    if schuin { waarin.push("in de vrije richting".to_string()); }
    if draaien { waarin.push("tegen draaien om Z".to_string()); }
    // Een schijf mag in haar vlak maar in één knoop zijn opgelegd (`schijven`).
    let plek = steunknoop.map_or_else(|| "in één knoop van de schijf".to_string(), |k| format!("in knoop {k}"));
    let mut tekst = format!(
        "voeg stabiliteitsverbanden, inklemmingen of een oplegging {plek} toe die schijf {schijf} {} vasthouden",
        opsomming(&waarin),
    );
    if draaien && waarin.len() > 1 {
        tekst.push_str("; tegen draaien zijn minstens drie verbanden nodig, niet alle evenwijdig en niet alle door één punt");
    }
    tekst
}

fn zin(b: &Bevinding) -> String {
    let vrij = opsomming(&b.vrij.iter().map(|beweging| beweging.naam.clone()).collect::<Vec<_>>());
    match &b.soort {
        Soort::LosseKnoop => format!(
            "Knoop {} hangt aan geen enkele staaf, plaat of schijf; verwijder hem of verbind hem met de constructie.",
            b.knopen[0],
        ),
        Soort::Los => {
            let meer = b.knopen.len() + b.staven.len() + b.platen.len() + b.schijven.len() > 1;
            format!(
                "{} {} nergens aan: geen oplegging houdt dit deel vast. Aanwijzing: verbind het met de constructie of geef het opleggingen.",
                hoofdletter(&onderwerp(b, true)), if meer { "hangen" } else { "hangt" },
            )
        }
        Soort::Onvoldoende => format!(
            "Het deel met {} is onvoldoende opgelegd; vrij: {vrij}. Aanwijzing: {}.",
            onderwerp(b, true), aanwijzing(&b.vrij),
        ),
        Soort::Schijf { steunknoop, mee } => {
            let schijf = b.schijven[0];
            let meebewegend = match mee.len() {
                0 => String::new(),
                1 => format!(" (schijf {} beweegt mee)", mee[0]),
                _ => format!(" ({} bewegen mee)", noem("schijf", "schijven", mee)),
            };
            format!(
                "Schijf {schijf} kan met de delen die eraan hangen ({}) als geheel bewegen{meebewegend}; vrij: {vrij}. Aanwijzing: {}.",
                onderwerp(b, false), schijf_aanwijzing(schijf, *steunknoop, &b.vrij),
            )
        }
        Soort::ViaSchijf => {
            let alleen_knoop = b.knopen.len() == 1 && b.staven.is_empty() && b.platen.is_empty();
            let wie = if alleen_knoop { format!("Knoop {}", b.knopen[0]) } else { format!("Het deel met {}", onderwerp(b, false)) };
            let verbind = if alleen_knoop {
                format!("verbind knoop {} met een staaf of plaat, of houd hem zelf vast: ", b.knopen[0])
            } else {
                String::new()
            };
            format!(
                "{wie} hangt via {} aan de rest, maar een schijf houdt alleen X, Y en de rotatie om Z vast; vrij: {vrij}. Aanwijzing: {verbind}{}.",
                noem("schijf", "schijven", &b.schijven), aanwijzing(&b.vrij),
            )
        }
        Soort::Samen => format!(
            "De delen met {} hangen via {} aan elkaar en kunnen samen nog bewegen, in een combinatie die deze controle niet afzonderlijk benoemt. Aanwijzing: geef deze delen eigen opleggingen of verbind ze met staven.",
            onderwerp(b, false), noem("schijf", "schijven", &b.schijven),
        ),
        Soort::NietNagegaan => format!(
            "De delen met {} hangen via {} aan elkaar; dat stelsel is te groot om de opleggingen volledig na te gaan. Of de schijven met de delen die eraan hangen kunnen verschuiven of draaien, heeft deze controle niet bekeken; controleer daarvoor zelf de stabiliteitsverbanden.",
            onderwerp(b, false), noem("schijf", "schijven", &b.schijven),
        ),
    }
}

/// De bevindingen als zinnen, de eerste `MAX_BESCHREVEN` uitgeschreven.
pub(crate) fn beschrijf(bevindingen: &[Bevinding]) -> String {
    let mut zinnen: Vec<String> = bevindingen.iter().take(MAX_BESCHREVEN).map(zin).collect();
    match bevindingen.len().saturating_sub(MAX_BESCHREVEN) {
        0 => {}
        1 => zinnen.push("Daarnaast nog 1 bevinding over de opleggingen.".into()),
        over => zinnen.push(format!("Daarnaast nog {over} bevindingen over de opleggingen.")),
    }
    zinnen.join(" ")
}

// ── Meldingen voor de adapter ──────────────────────────────────────────────

/// Wat de controle bij een singuliere stijfheidsmatrix zegt: de bevindingen,
/// of, als de opleggingen voldoende zijn, dat het een intern mechanisme is.
fn specifiek(bevindingen: &[Bevinding]) -> String {
    if bevindingen.is_empty() { INTERN.to_string() } else { beschrijf(bevindingen) }
}

/// De fout als de kern een singuliere stijfheidsmatrix meldt: welk deel, wat
/// er vrij is en wat te doen, met de algemene uitleg erachter.
pub(crate) fn singuliere_fout(request: &SolveRequest3D, context: &str, detail: &str) -> String {
    mechanismefout(request, context, &format!("Engine: {detail}"))
}

/// Als `singuliere_fout`, met een eigen toelichting in plaats van de melding
/// van de kern: voor de controle van de adapter dat de stijfheidsmatrix
/// regulier is (`knoopdraaiing`, #96).
pub(crate) fn mechanismefout(request: &SolveRequest3D, context: &str, toelichting: &str) -> String {
    let bevindingen = controleer(request, &HashSet::new());
    format!(
        "{context}: het model is een mechanisme of onvoldoende opgelegd (singuliere stijfheidsmatrix). {} {} {toelichting}",
        specifiek(&bevindingen),
        crate::MECHANISME_UITLEG,
    )
}

/// Wat de controle zegt bij een mechanisme dat de adapter zelf vond (#195):
/// "Opleggingen: …" met de bevindingen in de toestand `los` als de
/// opleggingen tekortschieten, anders dat het een intern mechanisme is.
pub(crate) fn bij_mechanisme(request: &SolveRequest3D, los: &Los) -> String {
    let tekort: Vec<Bevinding> = controleer_bij(request, &HashSet::new(), los).into_iter().filter(|b| b.tekort()).collect();
    if tekort.is_empty() { INTERN.to_string() } else { format!("Opleggingen: {}", beschrijf(&tekort)) }
}

/// Een andere rekenfout, aangevuld met de bevindingen als de opleggingen tekortschieten.
pub(crate) fn aanvullen(request: &SolveRequest3D, fout: String) -> String {
    let bevindingen = controleer(request, &HashSet::new());
    if bevindingen.is_empty() { return fout; }
    let fout = fout.trim_end();
    let punt = if fout.ends_with(['.', '!', '?']) { "" } else { "." };
    format!("{fout}{punt} Opleggingen: {}", beschrijf(&bevindingen))
}

/// Melding bij een geslaagde berekening van een model dat onvoldoende is
/// opgelegd. Alleen werkelijke tekortkomingen; een goed opgelegd model krijgt
/// geen melding, ook niet als de controle een deel niet volledig kon nagaan.
pub(crate) fn waarschuwing(bevindingen: &[Bevinding]) -> Option<String> {
    let tekort: Vec<Bevinding> = bevindingen.iter().filter(|b| b.tekort()).cloned().collect();
    (!tekort.is_empty()).then(|| format!(
        "Opleggingen: {} De kern vond voor deze belasting toch een oplossing; een belasting op een van deze delen in een vrije richting maakt het model onoplosbaar.",
        beschrijf(&tekort),
    ))
}

/// De fout vóór het oplossen van een model met platen: de kern zou een
/// mechanisme pas na een dichte terugvaloplossing melden, en die is voor een
/// fijn plaatnet onbetaalbaar.
pub(crate) fn plaatfout(bevindingen: &[Bevinding]) -> String {
    let plaat = bevindingen.iter().any(|b| !b.platen.is_empty());
    format!(
        "het model is een mechanisme: {}{}",
        beschrijf(bevindingen),
        if plaat {
            " Een plaat die alleen loodrecht op haar vlak is opgelegd heeft ook steun in haar vlak nodig, bijvoorbeeld twee richtingen in één knoop en één richting in een tweede knoop."
        } else {
            ""
        },
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{
        beschrijf, controleer, controleer_met, controleer_zonder_draairegel, specifiek, waarschuwing, Bevinding, Soort,
    };
    use crate::{
        AnalysisKind, Diaphragm3D, Material3D, Member3D, Node3D, Section3D, SolveRequest3D, Support3D,
    };

    const VAST: [bool; 6] = [true; 6];
    const SCHARNIER: [bool; 6] = [true, true, true, false, false, false];
    const VERTICAAL: [bool; 6] = [false, false, true, false, false, false];

    fn knoop(id: usize, x: f64, y: f64, z: f64) -> Node3D { Node3D { id, x, y, z } }

    fn staaf(id: usize, begin: usize, eind: usize) -> Member3D {
        Member3D {
            id, start_node_id: begin, end_node_id: eind, material_id: 1, section_id: 1,
            releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: vec![], tension_only: false,
            bedding: None, part_section_ids: None,
        }
    }

    fn steun(node_id: usize, v: [bool; 6]) -> Support3D {
        Support3D { node_id, ux: v[0], uy: v[1], uz: v[2], rx: v[3], ry: v[4], rz: v[5], ..Default::default() }
    }

    fn model(nodes: Vec<Node3D>, members: Vec<Member3D>, supports: Vec<Support3D>) -> SolveRequest3D {
        SolveRequest3D {
            schema_version: 2, analysis: AnalysisKind::Linear, nodes,
            materials: vec![Material3D { id: 1, name: "S235".into(), e_mpa: 210_000.0, nu: 0.3, g_mpa: None, alpha_per_k: None }],
            sections: vec![Section3D { id: 1, name: "HEA".into(), area_m2: 5e-3, iy_m4: 1e-5, iz_m4: 1e-5,
                torsion_j_m4: 1e-6, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }],
            members, supports, nodal_loads: vec![], member_loads: vec![], member_point_loads: vec![],
            thermal_loads: vec![], plates: vec![], shell_elements: vec![], surface_loads: vec![], diaphragms: vec![], node_links: vec![],
            tension_only_fit: None, tension_only_cross_rule: false, max_iterations: 50, tolerance: 1e-10, buckling_modes: 0,
        }
    }

    fn bevindingen(request: &SolveRequest3D) -> Vec<Bevinding> { controleer(request, &HashSet::new()) }

    fn namen(bevinding: &Bevinding) -> Vec<&str> { bevinding.vrij.iter().map(|b| b.naam.as_str()).collect() }

    /// Horizontaal raam in het XY-vlak: knoop 1 (0, 0), 2 (4, 0), 3 (4, 3).
    fn raam(supports: Vec<Support3D>) -> SolveRequest3D {
        model(
            vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 4.0, 0.0, 0.0), knoop(3, 4.0, 3.0, 0.0)],
            vec![staaf(1, 1, 2), staaf(2, 2, 3)],
            supports,
        )
    }

    /// Portaal in het XZ-vlak: voeten 1 (0, 0, 0) en 2 (12, 0, 0), koppen 3 en 4 op 5 m.
    fn portaal(voet: [bool; 6]) -> SolveRequest3D {
        model(
            vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 12.0, 0.0, 0.0), knoop(3, 0.0, 0.0, 5.0), knoop(4, 12.0, 0.0, 5.0)],
            vec![staaf(1, 1, 3), staaf(2, 2, 4), staaf(3, 3, 4)],
            vec![steun(1, voet), steun(2, voet)],
        )
    }

    #[test]
    fn alleen_verticale_opleggingen_laten_x_y_en_draaien_om_z_vrij() {
        let b = bevindingen(&raam(vec![steun(1, VERTICAAL), steun(2, VERTICAAL), steun(3, VERTICAAL)]));
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(b[0].soort, Soort::Onvoldoende);
        assert_eq!(b[0].knopen, vec![1, 2, 3]);
        assert_eq!(b[0].staven, vec![1, 2]);
        assert_eq!(namen(&b[0]), vec!["verschuiven in X", "verschuiven in Y", "draaien om Z"]);
        let tekst = beschrijf(&b);
        assert!(tekst.contains("knopen 1–3 en staven 1–2"), "{tekst}");
        assert!(tekst.contains("horizontale opleggingen in X en Y"), "{tekst}");
        // Knoop 3 beweegt bij draaien om knoop 1 in (−3; 4; 0): X en Y helpen allebei.
        assert!(tekst.contains("blokkeer de rotatie om Z met een inklemming of rotatieveer, of houd knoop 1 en 3 in X of Y vast"), "{tekst}");
    }

    #[test]
    fn een_inklemming_houdt_alles_vast() {
        let ligger = model(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 3.0, 0.0, 0.0)], vec![staaf(1, 1, 2)], vec![steun(1, VAST)]);
        assert!(bevindingen(&ligger).is_empty());
        // Drie verticale opleggingen plus X en Y in één knoop en Y in een tweede: ook rang 6.
        let mut x = steun(1, VERTICAAL);
        x.ux = true;
        x.uy = true;
        let mut y = steun(2, VERTICAAL);
        y.uy = true;
        assert!(bevindingen(&raam(vec![x, y, steun(3, VERTICAAL)])).is_empty());
    }

    #[test]
    fn twee_scharnieren_op_een_lijn_langs_x_laten_draaien_om_x_vrij() {
        // Zonder de draairegel (#96): de ligger kan om haar eigen as draaien.
        let ligger = model(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 3.0, 0.0, 0.0)], vec![staaf(1, 1, 2)],
            vec![steun(1, SCHARNIER), steun(2, SCHARNIER)]);
        let b = controleer_zonder_draairegel(&ligger);
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(namen(&b[0]), vec!["draaien om X"]);
        assert!(beschrijf(&b).contains("revolute-oplegging"), "{}", beschrijf(&b));
        // Die draaiing verplaatst geen knoop; de adapter houdt haar vast en
        // meldt een mechanisme zodra de belasting er een moment op zet
        // (`knoopdraaiing`). Voor deze controle is de ligger dan vast.
        assert!(bevindingen(&ligger).is_empty(), "{:?}", bevindingen(&ligger));

        // Dezelfde ligger met een tussenknoop: één deel, dezelfde vrije beweging.
        let mut gesplitst = model(
            vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 1.5, 0.0, 0.0), knoop(3, 3.0, 0.0, 0.0)],
            vec![staaf(1, 1, 3)],
            vec![steun(1, SCHARNIER), steun(3, SCHARNIER)],
        );
        gesplitst.members[0].intermediate_node_ids = vec![2];
        let b = controleer_zonder_draairegel(&gesplitst);
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(b[0].knopen, vec![1, 2, 3]);
        assert_eq!(namen(&b[0]), vec!["draaien om X"]);
        assert!(bevindingen(&gesplitst).is_empty());

        // Echte vrije bewegingen blijven gemeld: alleen verticaal opgelegd kan
        // de ligger ook schuiven en om Z draaien; alleen de draaiing om haar
        // eigen as valt weg.
        let rollen = model(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 3.0, 0.0, 0.0)], vec![staaf(1, 1, 2)],
            vec![steun(1, VERTICAAL), steun(2, VERTICAAL)]);
        let b = bevindingen(&rollen);
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(namen(&b[0]), vec!["verschuiven in X", "verschuiven in Y", "draaien om Z"]);
        assert!(namen(&controleer_zonder_draairegel(&rollen)[0]).contains(&"draaien om X"));
    }

    #[test]
    fn portaal_met_twee_scharnieren_kan_buiten_zijn_vlak_bewegen() {
        // Ruimtelijke scharnieren: alleen omvallen om de lijn door beide voeten.
        let b = bevindingen(&portaal(SCHARNIER));
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(namen(&b[0]), vec!["draaien om X (as door knoop 1 en 2)"]);
        // De koppen op 5 m bewegen daarbij zuiver in Y; een steun in Z helpt niet.
        let tekst = beschrijf(&b);
        assert!(tekst.contains("blokkeer de rotatie om X met een inklemming of rotatieveer, of houd knoop 3 buiten de draaias in Y vast"), "{tekst}");
        assert!(!tekst.contains("in Y of Z"), "{tekst}");
        // Scharnieren zonder Y-steun buiten het vlak: verschuiven in Y, omvallen
        // om X en draaien om Z; in het vlak is het portaal wel vastgehouden.
        let b = bevindingen(&portaal([true, false, true, false, false, false]));
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(namen(&b[0]), vec!["verschuiven in Y", "draaien om X", "draaien om Z"]);
        // Alle knopen liggen op y = 0: elke draaiing tegenhouden kan alleen in Y.
        let tekst = beschrijf(&b);
        assert!(tekst.contains("voeg een horizontale oplegging in Y toe"), "{tekst}");
        assert!(tekst.contains("blokkeer de rotatie om X met een inklemming of rotatieveer, of houd knoop 1 en 3 in Y vast"), "{tekst}");
        assert!(tekst.contains("blokkeer de rotatie om Z met een inklemming of rotatieveer, of houd knoop 1 en 2 in Y vast"), "{tekst}");
        assert!(!tekst.contains("in Y of Z") && !tekst.contains("in X of Z"), "{tekst}");
        // Met Y-steun en een rotatieveer om Z in één voet: niets meer vrij.
        let mut veer = steun(1, SCHARNIER);
        veer.krz_knm_per_rad = Some(1000.0);
        let mut voldoende = portaal(SCHARNIER);
        voldoende.supports[0] = veer;
        voldoende.supports[1].rx = true;
        assert!(bevindingen(&voldoende).is_empty());
    }

    #[test]
    fn een_deel_zonder_oplegging_hangt_nergens_aan() {
        let los = model(
            vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 3.0, 0.0, 0.0),
                knoop(7, 0.0, 5.0, 0.0), knoop(8, 2.0, 5.0, 0.0), knoop(9, 4.0, 5.0, 0.0)],
            vec![staaf(1, 1, 2), staaf(12, 7, 8), staaf(13, 8, 9)],
            vec![steun(1, VAST)],
        );
        let b = bevindingen(&los);
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(b[0].soort, Soort::Los);
        assert_eq!(b[0].knopen, vec![7, 8, 9]);
        assert_eq!(b[0].staven, vec![12, 13]);
        let tekst = beschrijf(&b);
        assert!(tekst.contains("Knopen 7–9 en staven 12–13 hangen nergens aan"), "{tekst}");

        // Een knoop zonder staaf of plaat: los, tenzij volledig opgelegd.
        let mut eenzaam = model(
            vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 3.0, 0.0, 0.0), knoop(5, 9.0, 9.0, 0.0)],
            vec![staaf(1, 1, 2)],
            vec![steun(1, VAST), steun(5, VERTICAAL)],
        );
        let b = bevindingen(&eenzaam);
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(b[0].soort, Soort::LosseKnoop);
        assert!(beschrijf(&b).contains("Knoop 5 hangt aan geen enkele staaf, plaat of schijf"), "{}", beschrijf(&b));
        eenzaam.supports[1] = steun(5, VAST);
        assert!(bevindingen(&eenzaam).is_empty());
    }

    /// Kolom A (1–2) ingeklemd; kolom B (3–4) met voet 3; koppen 2 en 4 in schijf 1.
    fn twee_kolommen(voet_b: [bool; 6], met_schijf: bool) -> SolveRequest3D {
        let mut r = model(
            vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 0.0, 0.0, 3.0), knoop(3, 4.0, 0.0, 0.0), knoop(4, 4.0, 0.0, 3.0)],
            vec![staaf(1, 1, 2), staaf(2, 3, 4)],
            vec![steun(1, VAST), steun(3, voet_b)],
        );
        if met_schijf { r.diaphragms.push(Diaphragm3D { id: 1, node_ids: vec![2, 4] }); }
        r
    }

    #[test]
    fn een_deel_dat_alleen_via_een_starre_schijf_vastzit() {
        // Zonder schijf draait kolom B om haar scharnierende voet. Haar draaiing
        // om haar eigen as (Z) houdt de adapter vast (#96).
        let b = bevindingen(&twee_kolommen(SCHARNIER, false));
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(b[0].knopen, vec![3, 4]);
        assert_eq!(namen(&b[0]), vec!["draaien om X (as door knoop 3)", "draaien om Y (as door knoop 3)"]);
        let b = controleer_zonder_draairegel(&twee_kolommen(SCHARNIER, false));
        assert_eq!(namen(&b[0]), vec!["draaien om X (as door knoop 3)", "draaien om Y (as door knoop 3)", "draaien om Z"]);
        // De schijf houdt de kop in X, Y en de rotatie om Z vast: niets vrij.
        assert!(bevindingen(&twee_kolommen(SCHARNIER, true)).is_empty());

        // Een voet die alleen verticaal is opgelegd: de schijf houdt de kop
        // horizontaal vast, maar de kolom kan nog om de kop scharnieren.
        let b = bevindingen(&twee_kolommen(VERTICAAL, true));
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(b[0].soort, Soort::ViaSchijf);
        assert_eq!(b[0].knopen, vec![3, 4]);
        assert_eq!(b[0].schijven, vec![1]);
        assert_eq!(namen(&b[0]), vec!["draaien om X (as door knoop 4)", "draaien om Y (as door knoop 4)"]);
        // Voet 3 beweegt bij draaien om X zuiver in Y en bij draaien om Y zuiver in X.
        let tekst = beschrijf(&b);
        assert!(tekst.contains("blokkeer de rotatie om X met een inklemming of rotatieveer, of houd knoop 3 buiten de draaias in Y vast"), "{tekst}");
        assert!(tekst.contains("blokkeer de rotatie om Y met een inklemming of rotatieveer, of houd knoop 3 buiten de draaias in X vast"), "{tekst}");

        // Een knoop die alleen in de schijf zit: Z en de rotaties om X en Y
        // houdt een schijf niet vast.
        let mut meester = twee_kolommen(VAST, true);
        meester.nodes.push(knoop(5, 2.0, 1.0, 3.0));
        meester.diaphragms[0].node_ids.push(5);
        let b = bevindingen(&meester);
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(b[0].soort, Soort::ViaSchijf);
        assert_eq!(b[0].knopen, vec![5]);
        assert_eq!(namen(&b[0]), vec!["verschuiven in Z", "draaien om X", "draaien om Y"]);
        assert!(beschrijf(&b).contains("Knoop 5 hangt via schijf 1"), "{}", beschrijf(&b));

        // Twee kolommen zonder eigen opleggingen aan één schijf: het geheel hangt nergens aan.
        let mut los = twee_kolommen(VAST, true);
        los.supports.clear();
        let b = bevindingen(&los);
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(b[0].soort, Soort::Los);
        assert_eq!(b[0].schijven, vec![1]);
    }

    #[test]
    fn veren_tellen_als_oplegging() {
        let veer = |id: usize, x: bool, y: bool| {
            let mut s = steun(id, [false; 6]);
            s.kz_kn_per_m = Some(5000.0);
            if x { s.kx_kn_per_m = Some(100.0); }
            if y { s.ky_kn_per_m = Some(100.0); }
            s
        };
        assert!(bevindingen(&raam(vec![veer(1, true, true), veer(2, false, true), veer(3, false, false)])).is_empty());
        let b = bevindingen(&raam(vec![veer(1, false, false), veer(2, false, false), veer(3, false, false)]));
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(namen(&b[0]), vec!["verschuiven in X", "verschuiven in Y", "draaien om Z"]);
    }

    /// Een staaf op bedding is langs haar lengte opgelegd in de richtingen van
    /// haar grondveren (#106); bij alleen druk tellen alleen de veren die meedoen.
    #[test]
    fn bedding_telt_als_oplegging() {
        use super::{controleer_bij, Los};
        use crate::Bedding3D;
        let op_bedding = |mut s: Member3D, k: Option<f64>, k_lat: Option<f64>| {
            s.bedding = Some(Bedding3D { k_kn_per_m3: k, width_m: 1.0, k_lateral_kn_per_m3: k_lat, compression_only: true });
            s
        };
        let ligger = |k_lat: Option<f64>| model(
            vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 6.0, 0.0, 0.0)],
            vec![op_bedding(staaf(1, 1, 2), Some(1e4), k_lat)],
            vec![],
        );
        // Alleen verticaal: vrij zijn de bewegingen in het grondvlak en de
        // torsie; die laatste (draaien om de eigen as) houdt de adapter vast (#96).
        let b = bevindingen(&ligger(None));
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(namen(&b[0]), vec!["verschuiven in X", "verschuiven in Y", "draaien om Z"]);
        assert_eq!(namen(&controleer_zonder_draairegel(&ligger(None))[0]),
            vec!["verschuiven in X", "verschuiven in Y", "draaien om X", "draaien om Z"]);
        // Met zijdelingse bedding: alleen langs de staaf schuiven (en torsie).
        let r = ligger(Some(1e4));
        assert_eq!(namen(&bevindingen(&r)[0]), vec!["verschuiven in X"]);
        assert_eq!(namen(&controleer_zonder_draairegel(&r)[0]), vec!["verschuiven in X", "draaien om X"]);
        // Alleen druk, alle verticale veren los: de ligger kan ook omhoog.
        let n = crate::bedding::Plan::bouw(&r).unwrap().staven[0].stations.len();
        let alle: Los = (0..n).map(|i| (1, i)).collect();
        let b = controleer_bij(&r, &HashSet::new(), &alle);
        assert!(namen(&b[0]).contains(&"verschuiven in Z"), "{b:?}");
        // Alleen de veer in het begin doet mee: de ligger kan om Y kantelen.
        let een: Los = (1..n).map(|i| (1, i)).collect();
        let b = controleer_bij(&r, &HashSet::new(), &een);
        assert!(!namen(&b[0]).contains(&"verschuiven in Z"), "{b:?}");
        assert!(namen(&b[0]).iter().any(|naam| naam.starts_with("draaien om Y")), "{b:?}");
        // Een paal met zijdelingse bedding en een verticale oplegging in de voet:
        // alleen de torsie om de paalas blijft vrij, en die houdt de adapter vast.
        let paal = model(
            vec![knoop(1, 0.0, 0.0, -10.0), knoop(2, 0.0, 0.0, 0.0)],
            vec![op_bedding(staaf(1, 1, 2), None, Some(1e4))],
            vec![steun(1, VERTICAAL)],
        );
        assert!(bevindingen(&paal).is_empty(), "{:?}", bevindingen(&paal));
        assert_eq!(namen(&controleer_zonder_draairegel(&paal)[0]), vec!["draaien om Z"]);
    }

    #[test]
    fn uitgesloten_staven_tellen_niet_mee() {
        // Zonder staaf 2 hangt knoop 3 los (bijvoorbeeld een trek-alleen staaf op druk).
        let r = raam(vec![steun(1, VAST)]);
        assert!(controleer(&r, &HashSet::new()).is_empty());
        let b = controleer(&r, &HashSet::from([2]));
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(b[0].soort, Soort::LosseKnoop);
        assert_eq!(b[0].knopen, vec![3]);
    }

    #[test]
    fn een_schuine_as_heet_naar_haar_knopen() {
        // Twee scharnieren op een lijn onder 53° in het XY-vlak, met een
        // zijtak zodat niet elke knoop op de as ligt.
        let r = model(
            vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 3.0, 4.0, 0.0), knoop(3, 3.0, 0.0, 0.0)],
            vec![staaf(1, 1, 2), staaf(2, 2, 3)],
            vec![steun(1, SCHARNIER), steun(2, SCHARNIER)],
        );
        let b = bevindingen(&r);
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(namen(&b[0]), vec!["draaien om de as door knoop 1 en 2"]);
    }

    /// `n` kolommen van 4 m op een raster van 6 m, scharnierend aan de voet
    /// (voet 2i + 1, kop 2i + 2, staaf i + 1), met alle koppen in schijf 1.
    fn pendelkolommen(n: usize) -> SolveRequest3D {
        let rij = (n as f64).sqrt().ceil() as usize;
        let (mut nodes, mut members, mut supports, mut koppen) = (vec![], vec![], vec![], vec![]);
        for i in 0..n {
            let (x, y) = ((i % rij) as f64 * 6.0, (i / rij) as f64 * 6.0);
            nodes.extend([knoop(2 * i + 1, x, y, 0.0), knoop(2 * i + 2, x, y, 4.0)]);
            members.push(staaf(i + 1, 2 * i + 1, 2 * i + 2));
            supports.push(steun(2 * i + 1, SCHARNIER));
            koppen.push(2 * i + 2);
        }
        let mut r = model(nodes, members, supports);
        r.diaphragms.push(Diaphragm3D { id: 1, node_ids: koppen });
        r
    }

    #[test]
    fn vier_pendelkolommen_onder_een_schijf_kunnen_zwaaien_en_draaien() {
        // Elke kolom zit via haar voet en de schijf vast, het geheel ook (de
        // voeten liggen niet op één lijn); de schijf kan met alle kolommen
        // tegelijk zwaaien en draaien.
        let b = bevindingen(&pendelkolommen(4));
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(b[0].soort, Soort::Schijf { steunknoop: None, mee: vec![] });
        assert_eq!(b[0].knopen, (1..=8).collect::<Vec<_>>());
        assert_eq!(b[0].staven, vec![1, 2, 3, 4]);
        assert_eq!(b[0].schijven, vec![1]);
        assert_eq!(namen(&b[0]), vec!["verschuiven in X", "verschuiven in Y", "draaien om Z"]);
        let tekst = beschrijf(&b);
        assert!(tekst.starts_with("Schijf 1 kan met de delen die eraan hangen (knopen 1–8 en staven 1–4) als geheel bewegen; vrij: verschuiven in X, verschuiven in Y en draaien om Z."), "{tekst}");
        assert!(tekst.contains("toe die schijf 1 in X en Y en tegen draaien om Z vasthouden"), "{tekst}");
        assert!(!tekst.contains("kunnen samen nog bewegen"), "{tekst}");

        // Eén kolom ingeklemd: de schijf zit vast.
        let mut ingeklemd = pendelkolommen(4);
        ingeklemd.supports[0] = steun(1, VAST);
        assert!(bevindingen(&ingeklemd).is_empty());

        // Eén kolom ingeklemd op de torsie na: de schijf kan alleen om die kolom draaien.
        let mut torsie = pendelkolommen(4);
        torsie.supports[0] = steun(1, [true, true, true, true, true, false]);
        let b = bevindingen(&torsie);
        assert_eq!(b.len(), 1, "{b:?}");
        assert!(matches!(b[0].soort, Soort::Schijf { .. }), "{b:?}");
        assert_eq!(namen(&b[0]), vec!["draaien om Z (as door knoop 2)"]);
        let tekst = beschrijf(&b);
        assert!(tekst.contains("toe die schijf 1 tegen draaien om Z vasthouden."), "{tekst}");

        // Al in het vlak opgelegd in kop 4 (alleen X): de aanwijzing noemt die knoop.
        let mut in_x = pendelkolommen(4);
        in_x.supports.push(steun(4, [true, false, false, false, false, false]));
        let b = bevindingen(&in_x);
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(b[0].soort, Soort::Schijf { steunknoop: Some(4), mee: vec![] });
        assert!(beschrijf(&b).contains("een oplegging in knoop 4 toe"), "{}", beschrijf(&b));
    }

    #[test]
    fn honderden_pendelkolommen_onder_een_schijf_worden_volledig_nagegaan() {
        // 250 kolommen: 3·250 + 3 onbekenden als één stelsel; per deel
        // samengevat blijven er drie over (de schijf).
        let b = bevindingen(&pendelkolommen(250));
        assert_eq!(b.len(), 1, "{b:?}");
        assert!(matches!(b[0].soort, Soort::Schijf { .. }), "{b:?}");
        assert_eq!(b[0].knopen.len(), 500);
        assert_eq!(namen(&b[0]), vec!["verschuiven in X", "verschuiven in Y", "draaien om Z"]);
        assert!(beschrijf(&b).starts_with("Schijf 1 kan met de delen die eraan hangen (knopen 1–500 en staven 1–250)"), "{}", beschrijf(&b));
        // Eén ingeklemde kolom houdt de hele vloer vast.
        let mut vast = pendelkolommen(250);
        vast.supports[100] = steun(201, VAST);
        assert!(bevindingen(&vast).is_empty());
    }

    /// Vier doorgaande kolommen, scharnierend aan de voet, met `n` vloeren om
    /// de 4 m (schijf v op hoogte 4v). Kolom i heeft de knopen
    /// (n + 1)·i + 1 … (n + 1)·(i + 1) van onder naar boven.
    fn verdiepingen(n: usize) -> SolveRequest3D {
        let (mut nodes, mut members, mut supports) = (vec![], vec![], vec![]);
        let mut vloeren = vec![vec![]; n];
        for (i, (x, y)) in [(0.0, 0.0), (6.0, 0.0), (0.0, 6.0), (6.0, 6.0)].into_iter().enumerate() {
            let k = (n + 1) * i;
            for v in 0..=n {
                nodes.push(knoop(k + v + 1, x, y, 4.0 * v as f64));
                if v > 0 {
                    members.push(staaf(n * i + v, k + v, k + v + 1));
                    vloeren[v - 1].push(k + v + 1);
                }
            }
            supports.push(steun(k + 1, SCHARNIER));
        }
        let mut r = model(nodes, members, supports);
        for (v, knopen) in vloeren.into_iter().enumerate() { r.diaphragms.push(Diaphragm3D { id: v + 1, node_ids: knopen }); }
        r
    }

    fn twee_verdiepingen() -> SolveRequest3D { verdiepingen(2) }

    #[test]
    fn een_deel_aan_veel_schijven_geeft_dezelfde_uitkomst() {
        // Dertien vloeren: elke kolom hangt aan meer schijven dan er samengevat
        // worden, en geeft haar voorwaarden rij voor rij door.
        let b = bevindingen(&verdiepingen(13));
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(b[0].soort, Soort::Schijf { steunknoop: None, mee: (2..=13).collect() });
        assert_eq!(namen(&b[0]), vec!["verschuiven in X", "verschuiven in Y"]);
        assert!(beschrijf(&b).contains("(schijven 2–13 bewegen mee)"), "{}", beschrijf(&b));
        let mut vast = verdiepingen(13);
        vast.supports[0] = steun(1, VAST);
        assert!(bevindingen(&vast).is_empty());
    }

    #[test]
    fn twee_schijven_zwaaien_samen_en_te_veel_schijven_geeft_een_zichtbare_melding() {
        // De starre kolommen draaien om hun voet: het dak zwaait twee keer zo
        // ver als de verdieping. Draaien om Z kan niet: beide schijven draaien
        // even ver, maar hun verschuivingen verschillen een factor twee.
        let b = bevindingen(&twee_verdiepingen());
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(b[0].soort, Soort::Schijf { steunknoop: None, mee: vec![2] });
        assert_eq!(namen(&b[0]), vec!["verschuiven in X", "verschuiven in Y"]);
        assert!(beschrijf(&b).contains("als geheel bewegen (schijf 2 beweegt mee); vrij: verschuiven in X en verschuiven in Y."), "{}", beschrijf(&b));

        // Boven de grens: alleen het geheel en elk deel apart, en een melding
        // dat de schijven niet zijn nagegaan; nooit "intern mechanisme".
        let b = controleer_met(&twee_verdiepingen(), &HashSet::new(), 1);
        assert_eq!(b.len(), 1, "{b:?}");
        assert_eq!(b[0].soort, Soort::NietNagegaan);
        assert!(!b[0].tekort());
        let tekst = specifiek(&b);
        assert!(tekst.contains("De delen met knopen 1–12 en staven 1–8 hangen via schijven 1–2 aan elkaar; dat stelsel is te groot"), "{tekst}");
        assert!(!tekst.contains("intern mechanisme"), "{tekst}");
        // Een geslaagde berekening krijgt hiervoor geen melding.
        assert!(waarschuwing(&b).is_none());
        let mut vast = twee_verdiepingen();
        vast.supports[0] = steun(1, VAST);
        assert!(controleer_met(&vast, &HashSet::new(), 1).iter().all(|b| !b.tekort()));
        assert!(specifiek(&[]).contains("intern mechanisme"));
    }

    #[test]
    fn lange_lijsten_en_veel_bevindingen_worden_ingekort() {
        // Een zigzagligger met de knopen 1, 3, …, 19 (geen reeks), alleen verticaal opgelegd.
        let mut nodes: Vec<Node3D> = (0..10).map(|i| knoop(2 * i + 1, 2.0 * i as f64, (i % 2) as f64, 0.0)).collect();
        let mut members: Vec<Member3D> = (0..9).map(|i| staaf(101 + i, 2 * i + 1, 2 * i + 3)).collect();
        let supports = vec![steun(1, VERTICAAL), steun(3, VERTICAAL), steun(19, VERTICAAL)];
        // Zeven losse liggers zonder oplegging.
        for i in 0..7 {
            nodes.extend([knoop(200 + 2 * i, 0.0, 10.0 + i as f64, 0.0), knoop(201 + 2 * i, 3.0, 10.0 + i as f64, 0.0)]);
            members.push(staaf(201 + i, 200 + 2 * i, 201 + 2 * i));
        }
        let b = bevindingen(&model(nodes, members, supports));
        assert_eq!(b.len(), 8, "{b:?}");
        let tekst = beschrijf(&b);
        // Tien groepen: de eerste zeven, dan het totaal.
        assert!(tekst.contains("Het deel met knopen 1, 3, 5, 7, 9, 11, 13, … (10 in totaal) en staven 101–109 is onvoldoende opgelegd"), "{tekst}");
        assert!(!tekst.contains("15, 17"), "{tekst}");
        // Zes bevindingen uitgeschreven (één deel en vijf losse liggers), twee niet.
        assert_eq!(tekst.matches("hangen nergens aan").count(), 5, "{tekst}");
        assert!(tekst.contains("Knopen 208–209 en staaf 205 hangen nergens aan") && !tekst.contains("staaf 206"), "{tekst}");
        assert!(tekst.ends_with("Daarnaast nog 2 bevindingen over de opleggingen."), "{tekst}");
        let melding = waarschuwing(&b).unwrap();
        assert!(melding.contains("Daarnaast nog 2 bevindingen over de opleggingen."), "{melding}");
        assert!(melding.ends_with("een belasting op een van deze delen in een vrije richting maakt het model onoplosbaar."), "{melding}");
        assert!(!melding.contains("deze beweging") && !melding.contains("hetzelfde soort"), "{melding}");
    }
}
