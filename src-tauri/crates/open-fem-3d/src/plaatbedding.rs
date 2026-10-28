//! Plaat op bedding (Winkler), #107: een vloer op zand.
//!
//! Contract. Een plaat met `bedding: { kKnPerM3, compressionOnly? }` ligt op
//! een grond met beddingsconstante k (kN/m³) loodrecht op het plaatvlak. De
//! grond ligt aan de onderzijde: de −z-zijde van de plaatassen (`shell`; bij
//! een niet-verticale plaat wijst z omhoog, bij een horizontale vloer is de
//! grond dus globaal −Z). Zonder het veld verandert er niets.
//!
//! Wanden. Bij een verticale plaat legt de assenafspraak z zo dat de y-as van
//! de plaat omhoog wijst, los van de knoopvolgorde: een wand in het XZ-vlak
//! heeft de grond aan +Y, een wand in het YZ-vlak aan −X. Die zijde is in het
//! contract niet te kiezen. Ligt de grond aan de andere kant, dan is de
//! mechanica met lineaire veren dezelfde maar zijn zakking en gronddruk van
//! teken omgekeerd, en werkt alleen druk aan de verkeerde kant. Daarom noemt
//! `diagnose` bij elke wand op bedding de grondzijde (de app en de API doen
//! dat ook, vóór het rekenen).
//!
//! Veren. Elke knoop van de plaat krijgt een veer k·A_trib (kN/m) langs de
//! plaatnormaal, met A_trib = Σ ∫N_i dA over de aansluitende MITC4-elementen
//! van die plaat (`shell::nodal_area_weights`, exact voor een vlakke
//! vierhoek). Zo is ΣA_trib het plaatoppervlak zonder sparingen, en geeft een
//! gelijkmatige vlaklast, die de adapter met dezelfde gewichten over de knopen
//! verdeelt, in elke knoop precies de zakking q/k. Ligt de normaal langs een
//! globale as en heeft de knoop geen oplegging in het verzoek, dan is de veer
//! een gewone oplegveer (kx, ky of kz; de veren van meer platen in één knoop
//! tellen op). Anders (een schuine plaat, of een knoop met een eigen
//! oplegging) is het een veerelement van de kern naar een vaste grondknoop op
//! 1 m langs −normaal, zoals bij de staaf op bedding (`bedding`): zo telt de
//! veer op bij wat er al is en overschrijft zij niets. De reacties van deze
//! veren tellen mee in de evenwichtssom, maar staan niet bij de oplegreacties
//! van het model; zakking en gronddruk staan per knoop in `plateBedding`.
//!
//! Beweging in het vlak. De veren werken alleen loodrecht op de plaat. Een
//! plaat op bedding die niets in haar vlak vasthoudt (een vloer zonder
//! opleggingen) kan in dat vlak verschuiven en om de normaal draaien zonder
//! dat een element vervormt: een starrelichaamsbeweging, en dus een singuliere
//! stijfheidsmatrix. Gekozen is vasthouden, zoals de knoopdraaiing (#96) een
//! draaiing vasthoudt die niets vervormt; alleen melden zou elke vloer op zand
//! zonder opleggingen weigeren, ook onder alleen verticale lasten. De controle
//! op de opleggingen (`opleggingen::vlakvrij`) geeft per verbonden modeldeel
//! met een plaat op bedding de vrije starrelichaamsbewegingen waarbij geen
//! plaat op bedding uit haar vlak beweegt (per star deel het vlak van zijn
//! plaat op bedding met de laagste id). Hangen starre delen via een starre
//! schijf samen, dan zijn dat de vrije bewegingen van het hele stelsel: een
//! schijf koppelt alleen knopen onderling en houdt bij een starre beweging van
//! het geheel niets tegen, dus een vloer op bedding met een schijf op het dak
//! verschuift in haar vlak net zo vrij als zonder. De adapter zet er
//! hoogstens evenveel veerelementen in het plaatvlak op, naar een vaste
//! grondknoop, in twee ver uit elkaar liggende knopen van de plaat op bedding
//! van een deel langs de plaatassen x en y, gekozen met pivotering zodat ze
//! die bewegingen precies vastleggen en nooit overbodig zijn
//! (`kies_vlakvast`). Bij een deel met een schijf telt de controle die veren
//! als oplegging (`vlakvast_via_schijf`); wat dan nog vrij is (een deel dat
//! aan de schijf zwaait), blijft een mechanisme.
//!
//! Losse eilanden. Eén plaat-id met losse stukken (bijvoorbeeld twee stroken
//! via vrije `shellElements`) is voor de controle meer dan één star deel. Elk
//! eiland krijgt daarom zijn eigen drie steunpunten en zijn eigen vlak
//! (`Plaat::eilanden`), en de vasthouding kiest per deel de knopen van het
//! eiland in dat deel.
//! Heeft de belasting F langs zo'n beweging z geen component (z·F = 0), dan
//! is de vasthouding statisch bepaald en onbelast: met K·z = 0 is
//! z·K_a·u = z·F − z·K·u = 0 en, omdat de veren beperkt tot de vrije bewegingen
//! inverteerbaar zijn, is de kracht in elk van deze veren nul. Alleen is K·z
//! bij de plaatelementen van de externe kern niet precies nul: hun kunstmatige
//! draaistijfheid hangt aan de absolute draaiing om de elementnormaal (niet
//! aan het verschil met de draaiing van het vlak), dus een starre draaiing om
//! de normaal kost een beetje energie. Vervormt de plaat zo dat haar knopen om
//! de normaal draaien (een vloer met een wand die buigt), dan neemt de
//! vasthouding die kleine kracht op, precies zoals een echte statisch bepaalde
//! oplegging in het vlak dat zou doen. Het criterium staat daarom op de
//! belasting zelf (`vlakbelasting`): per verbonden deel de resultante van alle lasten
//! (knooplasten, vlaklasten, staaflasten en puntlasten op staven, gelijk aan
//! die van de knoopkrachten die de kern krijgt; temperatuur heeft geen
//! resultante) langs de vrije bewegingen. Heeft de belasting zo'n component
//! (wind op een vloer zonder horizontale oplegging, zwaartekracht op een
//! schuine plaat), dan neemt niets haar op: een duidelijke fout
//! (`controleer_vlak`). Een melding noemt de vastgehouden plaat en de
//! grootste kracht in de vasthouding.
//!
//! Alleen druk. Dezelfde statuslus als bij de staaf op bedding
//! (`trek_alleen`): een actieve veer met een zakking < −tol valt weg, een
//! weggevallen veer met een zakking > tol doet weer mee (tol = 10⁻⁶ maal de
//! grootste verplaatsing of zakking); de sleutel is (plaat-id, knoop-id) in
//! `Los::platen`. Valt door het loskomen een beweging vrij die met alle veren
//! vastzat, dan meldt `bedding::controleer_contact` dat vóór het rekenen.
//!
//! Uitvoer per plaat en knoop: zakking s = −u·z (positief de grond in), druk
//! k·s (0 waar de veer is weggevallen; bij alleen druk door afronding niet
//! negatief), ΣR = Σ k·A_trib·s over de actieve veren en het losse deel van
//! het oppervlak (Σ A_trib zonder contact / Σ A_trib).
//!
//! Analysesoorten: de veren zijn lineaire stijfheid in K. Een model met
//! platen rekent de adapter alleen lineair (tweede orde met platen wordt
//! geweigerd, de geometrische stijfheid kent alleen staven) en de knikanalyse
//! is voor platen niet van toepassing (`tweede_orde`).
//!
//! Geen `HashMap` of `HashSet` in deze module: elke nieuwe map schuift de
//! hashsleutels van de maps die daarna in deze draad ontstaan (ook in de
//! kern); een verzoek zonder plaat op bedding volgt zo precies het oude
//! rekenpad.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use rekenkern::types::{AnalysisResults3D, ConnectorElement, SolverNode3D, SolverSupport3D};

use crate::bedding::{self, Grond, Los};
use crate::globale_lasten;
use crate::opleggingen::{self, Vlakvrij};
use crate::shell::{self, add, cross, dot, norm, scale, sub, PlateAxes3D, V3};
use crate::{PlateBeddingNode3D, PlateBeddingResult3D, SolveRequest3D, SolveResult3D};

/// Afstand van een grondknoop tot zijn plaatknoop, in m. De stijfheid van een
/// veerelement hangt niet van zijn lengte af.
const GRONDAFSTAND: f64 = 1.0;
/// Een component van de belasting langs de vrije bewegingen in het plaatvlak
/// telt als nul onder dit deel van de som van de afzonderlijke lasten van het
/// deel (|F| + |M_c|/L per last). De resultante komt rechtstreeks uit de
/// lastgegevens. Gemeten over de tests van `tests/plaatbedding.rs`: bij
/// lasten loodrecht op het vlak hooguit 7·10⁻¹⁶ maal de som (afronding, de
/// schuine plaat), een echte last in het plaatvlak minstens 1,1·10⁻² maal de
/// som. De grens ligt zes ordes boven de afronding en zeven onder de kleinste
/// echte last.
const VLAKLAST: f64 = 1e-9;

fn lijst(ids: impl IntoIterator<Item = usize>) -> String {
    ids.into_iter().map(|id| id.to_string()).collect::<Vec<_>>().join(", ")
}

fn getal(x: f64) -> String {
    // Geen "−0,000" voor een component die afgerond nul is.
    let x = if x.abs() < 5e-4 { 0.0 } else { x };
    format!("{x:.3}").replace('.', ",")
}

fn richting_tekst(r: V3) -> String { format!("({}; {}; {})", getal(r[0]), getal(r[1]), getal(r[2])) }

/// Eén knoop van een plaat op bedding.
#[derive(Debug, Clone)]
pub(crate) struct Knoop {
    pub id: usize,
    pub punt: V3,
    /// Tributair oppervlak A_trib in m².
    pub oppervlak: f64,
}

/// Een plaat op bedding zoals de adapter haar rekent.
#[derive(Debug, Clone)]
pub(crate) struct Plaat {
    pub plate_id: usize,
    /// Beddingsconstante k in kN/m³.
    pub k: f64,
    pub alleen_druk: bool,
    /// De plaatassen; z is de normaal, de grond ligt aan de −z-zijde.
    pub assen: PlateAxes3D,
    /// Oplopend op knoop-id.
    pub knopen: Vec<Knoop>,
    /// De eilanden van de plaat: elementen die via gedeelde knopen
    /// samenhangen, als indices in `knopen` (oplopend), op volgorde van hun
    /// eerste knoop. Meestal één; een plaat-id met losse stukken (mogelijk via
    /// vrije `shellElements`) heeft er meer, en elk stuk heeft zijn eigen
    /// steunpunten en vlak voor de controle op de opleggingen.
    pub eilanden: Vec<Vec<usize>>,
    /// Σ A_trib: het plaatoppervlak zonder sparingen, in m².
    pub oppervlak: f64,
}

impl Plaat {
    /// Doet de veer in knoop `knoop` mee?
    pub fn actief(&self, knoop: usize, los: &Los) -> bool {
        !(self.alleen_druk && los.platen.contains(&(self.plate_id, knoop)))
    }

    /// Twee ver uit elkaar liggende knopen van de plaat waarvoor `in_deel`
    /// geldt: de verste van hun zwaartepunt en de verste daarvan.
    fn verre_knopen(&self, in_deel: impl Fn(&Knoop) -> bool) -> Option<(&Knoop, &Knoop)> {
        let knopen: Vec<&Knoop> = self.knopen.iter().filter(|knoop| in_deel(knoop)).collect();
        let n = knopen.len().max(1) as f64;
        let midden = scale(knopen.iter().fold([0.0; 3], |som, k| add(som, k.punt)), 1.0 / n);
        let verst = |vanaf: V3| knopen.iter().copied()
            .max_by(|a, b| norm(sub(a.punt, vanaf)).total_cmp(&norm(sub(b.punt, vanaf))));
        let a = verst(midden)?;
        let b = verst(a.punt)?;
        (norm(sub(b.punt, a.punt)) > 1e-9).then_some((a, b))
    }

    /// Staat de plaat verticaal (een wand)? Dan legt de assenafspraak de
    /// grondzijde vast (`shell::plate_axes`), los van de knoopvolgorde.
    pub fn verticaal(&self) -> bool { self.assen.z[2].abs() <= 1e-6 }
}

/// De eilanden van een plaat: per element de indices van zijn knopen in
/// `ids` (oplopend), samengevoegd waar elementen een knoop delen. Zonder
/// `HashMap` (zie de module).
fn eilanden(ids: &[usize], elementen: &[Vec<usize>]) -> Vec<Vec<usize>> {
    let mut ouder: Vec<usize> = (0..ids.len()).collect();
    fn wortel(ouder: &mut [usize], mut i: usize) -> usize {
        while ouder[i] != i {
            ouder[i] = ouder[ouder[i]];
            i = ouder[i];
        }
        i
    }
    for element in elementen {
        let plekken: Vec<usize> = element.iter().filter_map(|id| ids.binary_search(id).ok()).collect();
        for paar in plekken.windows(2) {
            let (a, b) = (wortel(&mut ouder, paar[0]), wortel(&mut ouder, paar[1]));
            if a != b { ouder[a.max(b)] = a.min(b); }
        }
    }
    let mut per_wortel: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for i in 0..ids.len() {
        let w = wortel(&mut ouder, i);
        per_wortel.entry(w).or_default().push(i);
    }
    // De wortel is de kleinste index van het eiland: op volgorde van de eerste knoop.
    per_wortel.into_values().collect()
}

/// De zijde van de grond in woorden: "+Y", "−X" langs een globale as, anders
/// de richting.
fn zijde(grond: V3) -> String {
    for (as_, naam) in ["X", "Y", "Z"].iter().enumerate() {
        if (grond[as_].abs() - 1.0).abs() <= 1e-9 {
            return format!("{}{naam}", if grond[as_] > 0.0 { "+" } else { "−" });
        }
    }
    format!("richting {}", richting_tekst(grond))
}

/// Alle platen op bedding van een verzoek, oplopend op plaat-id.
#[derive(Debug, Clone, Default)]
pub(crate) struct Plan {
    pub platen: Vec<Plaat>,
}

/// Een veerelement in het plaatvlak dat een vrije beweging van een deel
/// vasthoudt (zie de moduletekst).
#[derive(Debug, Clone)]
pub(crate) struct Vlakvast {
    pub plate_id: usize,
    pub knoop: usize,
    pub richting: V3,
    /// Stijfheid in kN/m: k·ΣA_trib van de plaat (alleen voor de conditie).
    pub k: f64,
}

/// Een belasting in het vlak van een plaat op bedding die niets opneemt: de
/// component langs de vrije bewegingen van een deel (`vlakbelasting`).
#[derive(Debug, Clone)]
pub(crate) struct Vlaklast {
    pub plate_id: usize,
    /// Kracht in het plaatvlak in kN.
    pub kracht: V3,
    /// Moment om de plaatnormaal door het zwaartepunt van het verbonden deel, in kNm.
    pub moment: f64,
    pub normaal: V3,
}

/// Wat de platen op bedding aan één kernmodel toevoegen.
#[derive(Debug, Clone, Default)]
pub(crate) struct Kern {
    pub plan: Plan,
    pub vlakvast: Vec<Vlakvast>,
    /// Een deel met een belasting langs zijn vrije bewegingen in het plaatvlak:
    /// de berekening geeft dan een fout (`controleer_vlak`).
    pub vlaklast: Option<Vlaklast>,
    /// Modelknopen met een oplegveer van de plaatbedding en zonder oplegging
    /// in het verzoek: hun reactie is grond, geen oplegreactie.
    pub steunknopen: BTreeSet<usize>,
}

/// De belasting van één verbonden deel bij zijn vrije bewegingen in het
/// plaatvlak: de gegeneraliseerde kracht, per star deel [ΣF; ΣM_c/L] (bij de
/// bewegingen (t, L·θ) rond zijn centrum c; nul bij de schijfwaarden), en de
/// som van de afzonderlijke lasten, Σ(|F| + |M_c|/L). Dezelfde lasten als de
/// kern krijgt, als resultante: knooplasten, vlaklasten (via de consistente
/// knoopkrachten q·∫N_i dA, met dezelfde resultante en hetzelfde moment als de
/// vlaklast), staaflasten in de staafassen van de kern (een lineaire last;
/// Simpson is exact voor het moment) en puntlasten op staven. Temperatuur
/// heeft geen resultante. Geen `HashMap` (zie de module).
fn vlakbelasting(request: &SolveRequest3D, groep: &Vlakvrij) -> (Vec<f64>, f64) {
    let punten: BTreeMap<usize, V3> = request.nodes.iter().map(|knoop| (knoop.id, [knoop.x, knoop.y, knoop.z])).collect();
    // Het starre deel van elke knoop van de groep.
    let deel_van: BTreeMap<usize, usize> = groep.delen.iter().enumerate()
        .flat_map(|(j, deel)| deel.knopen.iter().map(move |knoop| (*knoop, j)))
        .collect();
    let lengte = groep.bewegingen.first().map_or(6 * groep.delen.len(), Vec::len);
    let mut som = vec![0.0; lengte];
    let mut maat = 0.0;
    let l = groep.lengte;
    let mut voeg = |j: usize, punt: V3, f: V3, m: V3| {
        let mc = add(m, cross(sub(punt, groep.delen[j].centrum), f));
        let g = [f[0], f[1], f[2], mc[0] / l, mc[1] / l, mc[2] / l];
        for (s, x) in som[6 * j..6 * j + 6].iter_mut().zip(g) { *s += x; }
        maat += norm(f) + norm(mc) / l;
    };
    for last in &request.nodal_loads {
        let Some(&j) = deel_van.get(&last.node_id) else { continue };
        let Some(&punt) = punten.get(&last.node_id) else { continue };
        voeg(j, punt, [last.fx, last.fy, last.fz], [last.mx, last.my, last.mz]);
    }
    let mut q_per_plaat: BTreeMap<usize, V3> = BTreeMap::new();
    for last in &request.surface_loads {
        let q = q_per_plaat.entry(last.plate_id).or_insert([0.0; 3]);
        *q = add(*q, [last.qx_kn_per_m2, last.qy_kn_per_m2, last.qz_kn_per_m2]);
    }
    for element in &request.shell_elements {
        let Some(&q) = q_per_plaat.get(&element.plate_id) else { continue };
        // De knopen van een element horen bij één star deel.
        let Some(&j) = element.node_ids.iter().find_map(|id| deel_van.get(id)) else { continue };
        let Some(p) = element.node_ids.iter().map(|id| punten.get(id).copied()).collect::<Option<Vec<V3>>>() else { continue };
        if p.len() != 4 { continue; }
        for (punt, gewicht) in p.iter().zip(shell::nodal_area_weights(&p)) {
            voeg(j, *punt, scale(q, gewicht), [0.0; 3]);
        }
    }
    let staven: BTreeMap<usize, &crate::Member3D> = request.members.iter().map(|staaf| (staaf.id, staaf)).collect();
    let knopen: BTreeMap<usize, &crate::Node3D> = request.nodes.iter().map(|knoop| (knoop.id, knoop)).collect();
    // Deel, begin, assen en lengte van een staaf van deze groep.
    let staaf_van = |member_id: usize| -> Option<(usize, V3, [V3; 3], f64)> {
        let staaf = *staven.get(&member_id)?;
        let j = *deel_van.get(&staaf.start_node_id)?;
        let (a, b) = (*knopen.get(&staaf.start_node_id)?, *knopen.get(&staaf.end_node_id)?);
        let begin = [a.x, a.y, a.z];
        Some((j, begin, globale_lasten::assen(staaf, a, b), norm(sub([b.x, b.y, b.z], begin))))
    };
    for last in &request.member_loads {
        let Some((j, begin, assen, lengte)) = staaf_van(last.member_id) else { continue };
        let q = globale_lasten::componenten(last, &assen);
        let globaal = |i: usize| add(add(scale(assen[0], q.qx[i]), scale(assen[1], q.qy[i])), scale(assen[2], q.qz[i]));
        let (van, tot) = (last.start_position_m.unwrap_or(0.0), last.end_position_m.unwrap_or(lengte));
        let (qa, qb) = (globaal(0), globaal(1));
        let h = tot - van;
        for (s, gewicht, q) in [(van, h / 6.0, qa), (0.5 * (van + tot), 4.0 * h / 6.0, scale(add(qa, qb), 0.5)), (tot, h / 6.0, qb)] {
            voeg(j, add(begin, scale(assen[0], s)), scale(q, gewicht), [0.0; 3]);
        }
    }
    for last in &request.member_point_loads {
        let Some((j, begin, assen, _)) = staaf_van(last.member_id) else { continue };
        voeg(j, add(begin, scale(assen[0], last.position_m)), add(scale(assen[1], last.py_kn), scale(assen[2], last.pz_kn)), [0.0; 3]);
    }
    (som, maat)
}

/// Het eerste verbonden deel (in de volgorde van `vrij`) met een belasting
/// langs zijn vrije bewegingen in het plaatvlak, boven `VLAKLAST` maal zijn
/// lastsom. De kracht en het moment in de melding zijn de resultante van dat
/// deel van de belasting, rond het zwaartepunt van het verbonden deel.
fn zoek_vlaklast(request: &SolveRequest3D, plan: &Plan, vrij: &[Vlakvrij]) -> Option<Vlaklast> {
    for groep in vrij {
        let (som, maat) = vlakbelasting(request, groep);
        let mut langs = vec![0.0; som.len()];
        let mut grootte = 0.0;
        for z in &groep.bewegingen {
            let g: f64 = z.iter().zip(&som).map(|(a, b)| a * b).sum();
            grootte += g * g;
            for (l, x) in langs.iter_mut().zip(z) { *l += g * x; }
        }
        if grootte.sqrt() <= VLAKLAST * maat + 1e-12 { continue; }
        let normaal = plan.platen.iter().find(|plaat| plaat.plate_id == groep.plate_id)
            .map(|plaat| plaat.assen.z).unwrap_or([0.0, 0.0, 1.0]);
        let mut kracht = [0.0; 3];
        let mut moment = [0.0; 3];
        for (j, deel) in groep.delen.iter().enumerate() {
            let f = [langs[6 * j], langs[6 * j + 1], langs[6 * j + 2]];
            let m = scale([langs[6 * j + 3], langs[6 * j + 4], langs[6 * j + 5]], groep.lengte);
            kracht = add(kracht, f);
            moment = add(moment, add(m, cross(sub(deel.centrum, groep.centrum), f)));
        }
        return Some(Vlaklast { plate_id: groep.plate_id, kracht, moment: dot(moment, normaal), normaal });
    }
    None
}

/// Keur de bedding van de platen: k positief en eindig.
pub(crate) fn valideer(request: &SolveRequest3D) -> Result<(), String> {
    for plaat in &request.plates {
        let Some(bedding) = &plaat.bedding else { continue };
        crate::positive(bedding.k_kn_per_m3, &format!("de beddingsconstante kKnPerM3 van plaat {}", plaat.id))?;
    }
    Ok(())
}

/// Heeft het verzoek een plaat op bedding met alleen druk?
pub(crate) fn met_alleen_druk(request: &SolveRequest3D) -> bool {
    request.plates.iter().any(|plaat| plaat.bedding.as_ref().is_some_and(|bedding| bedding.compression_only))
}

/// Drie niet-collineaire punten uit `punten` (de eerste, de verste daarvan en
/// de verste van de lijn ertussen), of minder als ze dat niet zijn. Voor
/// voorwaarden langs één normaal in één vlak houden die drie hetzelfde tegen
/// als alle.
fn drie_punten(punten: &[(usize, V3)]) -> Vec<(usize, V3)> {
    let Some(&eerste) = punten.first() else { return vec![] };
    let afstand = |p: &(usize, V3)| norm(sub(p.1, eerste.1));
    let Some(&tweede) = punten.iter().max_by(|a, b| afstand(a).total_cmp(&afstand(b))) else { return vec![eerste] };
    let lengte = afstand(&tweede);
    if lengte <= 1e-9 { return vec![eerste]; }
    let d = scale(sub(tweede.1, eerste.1), 1.0 / lengte);
    let buiten = |p: &(usize, V3)| norm(cross(sub(p.1, eerste.1), d));
    let derde = punten.iter().max_by(|a, b| buiten(a).total_cmp(&buiten(b))).copied();
    match derde {
        Some(derde) if buiten(&derde) > 1e-6 * lengte => vec![eerste, tweede, derde],
        _ => vec![eerste, tweede],
    }
}

impl Plan {
    pub fn is_empty(&self) -> bool { self.platen.is_empty() }

    /// De platen op bedding met hun tributaire oppervlakken en assen. De
    /// geometrie is al gekeurd (`shell::validate_shells`); de plaatnormaal
    /// volgt dezelfde rekenweg, zodat de assen gelijk zijn aan die van het
    /// resultaat.
    pub fn bouw(request: &SolveRequest3D) -> Plan {
        if !request.plates.iter().any(|plaat| plaat.bedding.is_some()) { return Plan::default(); }
        let punten: BTreeMap<usize, V3> = request.nodes.iter().map(|knoop| (knoop.id, [knoop.x, knoop.y, knoop.z])).collect();
        let mut platen: Vec<_> = request.plates.iter().filter(|plaat| plaat.bedding.is_some()).collect();
        platen.sort_by_key(|plaat| plaat.id);
        let mut plan = Plan::default();
        for plaat in platen {
            let bedding = plaat.bedding.as_ref().expect("gefilterd op bedding");
            let mut oppervlak: BTreeMap<usize, f64> = BTreeMap::new();
            let mut referentie: Option<V3> = None;
            let mut normaalsom = [0.0; 3];
            let mut elementen: Vec<Vec<usize>> = Vec::new();
            for element in request.shell_elements.iter().filter(|element| element.plate_id == plaat.id) {
                let Some(p) = element.node_ids.iter().map(|id| punten.get(id).copied()).collect::<Option<Vec<V3>>>()
                    else { continue };
                if p.len() != 4 { continue; }
                let vector = shell::area_vector(&p);
                let Some(r) = referentie.or_else(|| shell::unit(vector)) else { continue };
                referentie = Some(r);
                normaalsom = add(normaalsom, if dot(vector, r) < 0.0 { scale(vector, -1.0) } else { vector });
                for (id, gewicht) in element.node_ids.iter().zip(shell::nodal_area_weights(&p)) {
                    *oppervlak.entry(*id).or_insert(0.0) += gewicht;
                }
                elementen.push(element.node_ids.clone());
            }
            let Some(assen) = shell::unit(normaalsom).and_then(shell::plate_axes) else { continue };
            let knopen: Vec<Knoop> = oppervlak.into_iter()
                .map(|(id, oppervlak)| Knoop { id, punt: punten[&id], oppervlak })
                .collect();
            let ids: Vec<usize> = knopen.iter().map(|knoop| knoop.id).collect();
            let totaal = knopen.iter().map(|knoop| knoop.oppervlak).sum();
            plan.platen.push(Plaat {
                plate_id: plaat.id, k: bedding.k_kn_per_m3, alleen_druk: bedding.compression_only,
                assen, eilanden: eilanden(&ids, &elementen), knopen, oppervlak: totaal,
            });
        }
        plan
    }

    /// Opleggingsrichtingen voor de controle op de opleggingen: per plaat en
    /// per eiland drie niet-collineaire knopen met een veer die meedoet, langs
    /// de normaal.
    pub fn steunen(&self, los: &Los) -> Vec<(usize, V3, V3)> {
        let mut uit = Vec::new();
        for plaat in &self.platen {
            for eiland in &plaat.eilanden {
                let actief: Vec<(usize, V3)> = eiland.iter().map(|i| &plaat.knopen[*i])
                    .filter(|knoop| plaat.actief(knoop.id, los))
                    .map(|knoop| (knoop.id, knoop.punt))
                    .collect();
                uit.extend(drie_punten(&actief).into_iter().map(|(id, punt)| (id, punt, plaat.assen.z)));
            }
        }
        uit
    }

    /// Per plaat en per eiland het vlak: (plaat-id, normaal, drie
    /// niet-collineaire knopen van dat eiland). De eilanden van één plaat
    /// liggen in hetzelfde vlak (`shell::validate_shells`), maar elk eiland is
    /// zonder verbinding een eigen star deel.
    pub fn vlakpunten(&self) -> Vec<(usize, V3, Vec<(usize, V3)>)> {
        self.platen.iter().flat_map(|plaat| plaat.eilanden.iter().map(|eiland| {
            let alle: Vec<(usize, V3)> = eiland.iter().map(|i| (plaat.knopen[*i].id, plaat.knopen[*i].punt)).collect();
            (plaat.plate_id, plaat.assen.z, drie_punten(&alle))
        })).collect()
    }

    /// Zakking en gronddruk per plaatknoop, uit de verplaatsingen van de kern.
    pub fn resultaat(&self, los: &Los, verplaatsing: &BTreeMap<usize, [f64; 6]>) -> Vec<PlateBeddingResult3D> {
        self.platen.iter().map(|plaat| {
            let mut totaal = 0.0;
            let mut los_oppervlak = 0.0;
            let nodes: Vec<PlateBeddingNode3D> = plaat.knopen.iter().map(|knoop| {
                let u = verplaatsing.get(&knoop.id).copied().unwrap_or([0.0; 6]);
                let zakking = -dot([u[0], u[1], u[2]], plaat.assen.z);
                let actief = plaat.actief(knoop.id, los);
                let druk = if actief {
                    totaal += plaat.k * knoop.oppervlak * zakking;
                    let druk = plaat.k * zakking;
                    // Een actieve veer bij alleen druk staat binnen de statusgrens
                    // op druk; afronding laat geen negatieve druk zien.
                    if plaat.alleen_druk { druk.max(0.0) } else { druk }
                } else {
                    los_oppervlak += knoop.oppervlak;
                    0.0
                };
                PlateBeddingNode3D { node_id: knoop.id, settlement_m: zakking, pressure_kn_per_m2: druk, active: actief }
            }).collect();
            let max_druk = nodes.iter().map(|n| n.pressure_kn_per_m2).fold(f64::NEG_INFINITY, f64::max);
            let min_druk = nodes.iter().map(|n| n.pressure_kn_per_m2).fold(f64::INFINITY, f64::min);
            let max_zakking = nodes.iter().map(|n| n.settlement_m).fold(f64::NEG_INFINITY, f64::max);
            PlateBeddingResult3D {
                plate_id: plaat.plate_id,
                nodes,
                max_pressure_kn_per_m2: max_druk,
                min_pressure_kn_per_m2: min_druk,
                max_settlement_m: max_zakking,
                total_reaction_kn: totaal,
                lifted_fraction: (los_oppervlak / plaat.oppervlak).clamp(0.0, 1.0),
            }
        }).collect()
    }
}

/// Een veerelement met stijfheid `k` van `knoop` (in `punt`) naar een nieuwe,
/// vaste grondknoop op `GRONDAFSTAND` langs −`richting`.
#[allow(clippy::too_many_arguments)]
fn grondveer(
    knoop: usize,
    punt: V3,
    richting: V3,
    k: f64,
    volgende_knoop: &mut usize,
    volgende_element: &mut usize,
    knopen: &mut HashMap<String, SolverNode3D>,
    steunen: &mut HashMap<String, SolverSupport3D>,
    veren: &mut HashMap<String, ConnectorElement>,
    grond: &mut Grond,
) {
    let id = *volgende_knoop;
    *volgende_knoop += 1;
    let p = sub(punt, scale(richting, GRONDAFSTAND));
    knopen.insert(id.to_string(), SolverNode3D { id, x: p[0], y: p[1], z: p[2] });
    steunen.insert(format!("plaatbedding-grond-{id}"), bedding::steun(id, true, [0.0; 3]));
    let element = *volgende_element;
    *volgende_element += 1;
    veren.insert(element.to_string(), ConnectorElement {
        id: element, node_i: knoop, node_j: id, k_axial: k,
        k_shear: 0.0, k_moment: 0.0, k_shear_z: 0.0, k_bend_y: 0.0, k_bend_z: 0.0,
    });
    grond.knopen.insert(id);
    grond.veren.insert(element);
}

/// De vasthoudingen in het plaatvlak voor de vrije bewegingen `vrij`: per
/// verbonden deel hoogstens evenveel als er vrije bewegingen zijn, uit de
/// kandidaten (A, x), (A, y), (B, x), (B, y) per star deel met een plaat op
/// bedding, met A en B twee ver uit elkaar liggende knopen van die plaat in
/// dat deel en x, y de plaatassen. Gram-Schmidt met de grootste rest eerst:
/// de gekozen voorwaarden zijn op de vrije bewegingen die ze zien
/// inverteerbaar en goed geconditioneerd, en nooit overbodig (dus statisch
/// bepaald). De vier kandidaten van een deel houden elke beweging van dat deel
/// in het vlak tegen, dus ook elke deelruimte daarvan; een vrije beweging
/// waarbij geen plaat op bedding beweegt (een deel dat aan een schijf
/// zwaait), zien ze niet, en die blijft voor de controle vrij.
fn kies_vlakvast(plan: &Plan, vrij: &[Vlakvrij]) -> Vec<Vlakvast> {
    let mut uit = Vec::new();
    for groep in vrij {
        let mut kandidaten: Vec<(&Plaat, &Knoop, V3)> = Vec::new();
        // Voorwaarde d·(t + θ × (p − c)) op elke vrije beweging (t, L·θ) van het deel.
        let mut rijen: Vec<Vec<f64>> = Vec::new();
        for (j, deel) in groep.delen.iter().enumerate() {
            let Some(plate_id) = deel.plate_id else { continue };
            let Some(plaat) = plan.platen.iter().find(|plaat| plaat.plate_id == plate_id) else { continue };
            let Some((a, b)) = plaat.verre_knopen(|knoop| deel.knopen.contains(&knoop.id)) else { continue };
            for (knoop, d) in [(a, plaat.assen.x), (a, plaat.assen.y), (b, plaat.assen.x), (b, plaat.assen.y)] {
                let arm = scale(cross(sub(knoop.punt, deel.centrum), d), 1.0 / groep.lengte);
                let rij = [d[0], d[1], d[2], arm[0], arm[1], arm[2]];
                rijen.push(groep.bewegingen.iter().map(|z| (0..6).map(|i| rij[i] * z[6 * j + i]).sum()).collect());
                kandidaten.push((plaat, knoop, d));
            }
        }
        let grootte = |rij: &Vec<f64>| rij.iter().map(|x| x * x).sum::<f64>().sqrt();
        let mut gekozen = vec![false; kandidaten.len()];
        for _ in 0..groep.bewegingen.len() {
            let Some(i) = (0..kandidaten.len()).filter(|i| !gekozen[*i])
                .max_by(|&i, &j| grootte(&rijen[i]).total_cmp(&grootte(&rijen[j])))
                else { break };
            let lengte = grootte(&rijen[i]);
            if !(lengte > 1e-9) { break; }
            gekozen[i] = true;
            let e: Vec<f64> = rijen[i].iter().map(|x| x / lengte).collect();
            for j in (0..kandidaten.len()).filter(|j| !gekozen[*j]) {
                let f: f64 = rijen[j].iter().zip(&e).map(|(x, y)| x * y).sum();
                for (x, y) in rijen[j].iter_mut().zip(&e) { *x -= f * y; }
            }
            let (plaat, knoop, richting) = kandidaten[i];
            uit.push(Vlakvast { plate_id: plaat.plate_id, knoop: knoop.id, richting, k: plaat.k * plaat.oppervlak });
        }
    }
    uit
}

/// De vasthouding in het plaatvlak van de verbonden delen met een starre
/// schijf, als (knoop, punt, richting): dezelfde veren als in de kern
/// (`Kern::bouw`). De controle op de opleggingen telt ze als oplegging
/// (`opleggingen`). Staven in `uitgesloten` tellen niet mee, zoals in de
/// controle; het verzoek van de kern heeft ze al weggelaten.
pub(crate) fn vlakvast_via_schijf(request: &SolveRequest3D, uitgesloten: &HashSet<usize>, los: &Los) -> Vec<(usize, V3, V3)> {
    let vrij: Vec<Vlakvrij> = opleggingen::vlakvrij(request, uitgesloten, los).into_iter().filter(|groep| groep.via_schijf).collect();
    if vrij.is_empty() { return vec![]; }
    let plan = Plan::bouw(request);
    kies_vlakvast(&plan, &vrij).into_iter().filter_map(|vast| {
        let punt = plan.platen.iter().find(|plaat| plaat.plate_id == vast.plate_id)?
            .knopen.iter().find(|knoop| knoop.id == vast.knoop)?.punt;
        Some((vast.knoop, punt, vast.richting))
    }).collect()
}

impl Kern {
    /// De veren van de platen op bedding en de vasthouding in het plaatvlak in
    /// het kernmodel; weggevallen veren (`los`) ontbreken. Zonder plaat op
    /// bedding verandert er niets.
    #[allow(clippy::too_many_arguments)]
    pub fn bouw(
        request: &SolveRequest3D,
        los: &Los,
        knopen: &mut HashMap<String, SolverNode3D>,
        steunen: &mut HashMap<String, SolverSupport3D>,
        veren: &mut HashMap<String, ConnectorElement>,
        volgende_element: &mut usize,
        grond: &mut Grond,
    ) -> Kern {
        let plan = Plan::bouw(request);
        if plan.is_empty() { return Kern::default(); }
        let opgelegd: BTreeSet<usize> = request.supports.iter().map(|steun| steun.node_id).collect();
        let mut volgende_knoop = knopen.values().map(|knoop| knoop.id).max().unwrap_or(0) + 1;
        let mut oplegveren: BTreeMap<usize, [f64; 3]> = BTreeMap::new();
        for plaat in &plan.platen {
            let as_ = bedding::globale_as(plaat.assen.z);
            for knoop in plaat.knopen.iter().filter(|knoop| plaat.actief(knoop.id, los)) {
                let k = plaat.k * knoop.oppervlak;
                match as_ {
                    Some(as_) if !opgelegd.contains(&knoop.id) => oplegveren.entry(knoop.id).or_insert([0.0; 3])[as_] += k,
                    _ => grondveer(knoop.id, knoop.punt, plaat.assen.z, k, &mut volgende_knoop, volgende_element,
                        knopen, steunen, veren, grond),
                }
            }
        }
        // Een lege set, zoals `vlakvrij` die voorheen zelf maakte: hetzelfde
        // aantal hashmaps in deze draad (zie de module).
        let vrij = opleggingen::vlakvrij(request, &HashSet::new(), los);
        let vlakvast = kies_vlakvast(&plan, &vrij);
        let vlaklast = zoek_vlaklast(request, &plan, &vrij);
        for vast in &vlakvast {
            let punt = plan.platen.iter().find(|plaat| plaat.plate_id == vast.plate_id)
                .and_then(|plaat| plaat.knopen.iter().find(|knoop| knoop.id == vast.knoop))
                .map(|knoop| knoop.punt)
                .expect("een gekozen knoop hoort bij zijn plaat");
            grondveer(vast.knoop, punt, vast.richting, vast.k, &mut volgende_knoop, volgende_element,
                knopen, steunen, veren, grond);
        }
        let mut steunknopen = BTreeSet::new();
        for (knoop, k) in oplegveren {
            steunen.insert(format!("plaatbedding-{knoop}"), bedding::steun(knoop, false, k));
            steunknopen.insert(knoop);
        }
        Kern { plan, vlakvast, vlaklast, steunknopen }
    }

    /// De grootste kracht (kN) in de vasthoudingen in het plaatvlak na het
    /// oplossen; 0 zonder vasthouding.
    pub fn vlakkracht(&self, results: &AnalysisResults3D) -> f64 {
        self.vlakvast.iter().filter_map(|vast| {
            let u = results.displacements.iter().find(|u| u.node_id == vast.knoop)?;
            Some((vast.k * dot([u.ux, u.uy, u.uz], vast.richting)).abs())
        }).fold(0.0, f64::max)
    }

    /// Melding als de berekening een plaat in haar vlak vasthoudt, met de
    /// grootste kracht in de vasthouding (`vlakkracht`).
    pub fn melding_vlak(&self, kracht: f64) -> Option<String> {
        if self.vlakvast.is_empty() { return None; }
        let platen: BTreeSet<usize> = self.vlakvast.iter().map(|vast| vast.plate_id).collect();
        let knopen: BTreeSet<usize> = self.vlakvast.iter().map(|vast| vast.knoop).collect();
        let wie = if platen.len() == 1 { format!("plaat {}", lijst(platen)) } else { format!("platen {}", lijst(platen)) };
        let hoeveel = if kracht < 1e-3 { "minder dan 0,001 kN".to_string() } else { format!("hoogstens {} kN", getal(kracht)) };
        Some(format!(
            "Plaat op bedding: de bedding werkt alleen loodrecht op de plaat en niets anders houdt {wie} in het plaatvlak vast. De berekening houdt die vrije beweging (verschuiven in het plaatvlak en draaien om de plaatnormaal; {} richting(en)) vast in knoop {}. De belasting heeft langs die beweging geen component; de vasthouding neemt {hoeveel} op (afronding en de kleine kunstmatige draaistijfheid van de plaatelementen), net als een statisch bepaalde oplegging in het plaatvlak.",
            self.vlakvast.len(), lijst(knopen),
        ))
    }
}

/// Heeft de belasting van een deel met vrije bewegingen in het plaatvlak een
/// component langs die bewegingen (`zoek_vlaklast`)? Dan neemt niets haar op
/// (de bedding werkt alleen loodrecht op de plaat): een fout in plaats van
/// een uitkomst.
pub(crate) fn controleer_vlak(context: &str, kern: &Kern) -> Result<(), String> {
    let Some(last) = &kern.vlaklast else { return Ok(()) };
    let kracht = norm(last.kracht);
    let langs = if kracht > 0.0 { format!(" langs {}", richting_tekst(scale(last.kracht, 1.0 / kracht))) } else { String::new() };
    Err(format!(
        "{context}: plaat {} ligt op bedding, maar de bedding werkt alleen loodrecht op de plaat en niets anders houdt het deel in het plaatvlak vast. De belasting heeft een component in het plaatvlak die niets opneemt (in het plaatvlak {} kN{langs} en {} kNm om de plaatnormaal {}). Geef de plaat of een aansluitend deel een oplegging in het plaatvlak (bijvoorbeeld horizontaal vast in twee knopen), of belast de plaat alleen loodrecht op haar vlak.",
        last.plate_id, getal(kracht), getal(last.moment.abs()), richting_tekst(last.normaal),
    ))
}

/// De weggevallen veren van platen met alleen druk na één berekening; `grens`
/// is de statusgrens van `bedding::nieuwe_los`.
pub(crate) fn nieuwe_los(request: &SolveRequest3D, uitkomst: &SolveResult3D, los: &Los, grens: f64) -> BTreeSet<(usize, usize)> {
    let druk: BTreeSet<usize> = request.plates.iter()
        .filter(|plaat| plaat.bedding.as_ref().is_some_and(|bedding| bedding.compression_only))
        .map(|plaat| plaat.id)
        .collect();
    let mut nieuw = BTreeSet::new();
    for plaat in uitkomst.plate_bedding.iter().filter(|b| druk.contains(&b.plate_id)) {
        for knoop in &plaat.nodes {
            let sleutel = (plaat.plate_id, knoop.node_id);
            let blijft_los = if los.platen.contains(&sleutel) { knoop.settlement_m <= grens } else { knoop.settlement_m < -grens };
            if blijft_los { nieuw.insert(sleutel); }
        }
    }
    nieuw
}

/// Meldregels over de platen op bedding: de veren en, bij alleen druk, het losse deel.
pub(crate) fn diagnose(request: &SolveRequest3D, uitkomst: &SolveResult3D, rondes: Option<usize>) -> Vec<String> {
    if uitkomst.plate_bedding.is_empty() { return vec![]; }
    let plan = Plan::bouw(request);
    let delen: Vec<String> = plan.platen.iter().take(8)
        .map(|plaat| format!("plaat {} ({} knopen, {} m²)", plaat.plate_id, plaat.knopen.len(), getal(plaat.oppervlak)))
        .collect();
    let meer = if plan.platen.len() > 8 { format!(" en {} andere", plan.platen.len() - 8) } else { String::new() };
    let mut regels = vec![format!(
        "Plaat op bedding: {}{meer}, met in elke plaatknoop een grondveer k·A_trib langs de plaatnormaal (A_trib uit de elementen van de plaat).",
        delen.join(", "),
    )];
    // Een wand: de grondzijde volgt uit de assenafspraak en is niet te kiezen.
    for plaat in plan.platen.iter().filter(|plaat| plaat.verticaal()) {
        let gevolg = if plaat.alleen_druk {
            "; met alleen druk laat de grondveer dan juist los waar de wand de grond in duwt: reken zo'n wand zonder alleen druk"
        } else {
            ""
        };
        regels.push(format!(
            "Plaat op bedding {} staat verticaal (een wand): de grond ligt volgens de plaatassen aan de {}-zijde, tegen de plaatnormaal {} in. Die zijde volgt uit de assenafspraak (bij een wand wijst de y-as van de plaat omhoog) en is niet te kiezen. Ligt de grond aan de andere kant (bij een kelder bij twee van de vier wanden), dan zijn zakking en gronddruk van teken omgekeerd{gevolg}.",
            plaat.plate_id, zijde(scale(plaat.assen.z, -1.0)), richting_tekst(plaat.assen.z),
        ));
    }
    let druk: Vec<&PlateBeddingResult3D> = uitkomst.plate_bedding.iter()
        .filter(|b| plan.platen.iter().any(|plaat| plaat.plate_id == b.plate_id && plaat.alleen_druk))
        .collect();
    if !druk.is_empty() {
        let los: Vec<String> = druk.iter().filter(|b| b.lifted_fraction > 0.0).take(8)
            .map(|b| format!("plaat {} over {:.0} % van het oppervlak", b.plate_id, 100.0 * b.lifted_fraction))
            .collect();
        let rondes = rondes.map(|n| format!("; {n} statusronde(s)")).unwrap_or_default();
        regels.push(if los.is_empty() {
            format!("Plaat op bedding alleen druk: overal contact met de grond{rondes}.")
        } else {
            format!("Plaat op bedding alleen druk: los van de grond ligt {}{rondes}.", los.join(", "))
        });
    }
    regels
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AnalysisKind, Material3D, Node3D, Plate3D, PlateBedding3D, ShellElement3D};

    /// Rechthoekig net van nx × ny vierhoeken van 0,5 m in het vlak z = 0,
    /// zonder de elementen waar `open(i, j)`; alleen gebruikte knopen.
    fn verzoek(nx: usize, ny: usize, open: impl Fn(usize, usize) -> bool) -> SolveRequest3D {
        let id = |i: usize, j: usize| 1 + j * (nx + 1) + i;
        let mut elementen = Vec::new();
        for j in 0..ny {
            for i in 0..nx {
                if open(i, j) { continue; }
                elementen.push(ShellElement3D {
                    id: elementen.len() + 1, plate_id: 1,
                    node_ids: vec![id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)],
                });
            }
        }
        let gebruikt: BTreeSet<usize> = elementen.iter().flat_map(|e| e.node_ids.iter().copied()).collect();
        let mut nodes = Vec::new();
        for j in 0..=ny {
            for i in 0..=nx {
                if gebruikt.contains(&id(i, j)) {
                    nodes.push(Node3D { id: id(i, j), x: 0.5 * i as f64, y: 0.5 * j as f64, z: 0.0 });
                }
            }
        }
        SolveRequest3D {
            schema_version: 2, analysis: AnalysisKind::Linear, nodes,
            materials: vec![Material3D { id: 1, name: "beton".into(), e_mpa: 30_000.0, nu: 0.2, g_mpa: None, alpha_per_k: None }],
            sections: vec![], members: vec![], supports: vec![], nodal_loads: vec![], member_loads: vec![],
            member_point_loads: vec![], thermal_loads: vec![],
            plates: vec![Plate3D { id: 1, material_id: 1, thickness_m: 0.2,
                bedding: Some(PlateBedding3D { k_kn_per_m3: 10_000.0, compression_only: true }), orthotropy: None }],
            shell_elements: elementen, surface_loads: vec![], diaphragms: vec![], node_links: vec![],
            tension_only_fit: None, tension_only_cross_rule: false, max_iterations: 50, tolerance: 1e-8, buckling_modes: 0,
        }
    }

    /// ΣA_trib = plaatoppervlak min sparing; een hoekknoop een kwart element,
    /// een randknoop een half, een binnenknoop een heel.
    #[test]
    fn tributaire_oppervlakken_tellen_op_tot_het_plaatoppervlak_zonder_sparing() {
        let plan = Plan::bouw(&verzoek(12, 8, |i, j| (4..8).contains(&i) && (2..5).contains(&j)));
        let plaat = &plan.platen[0];
        let a = 6.0 * 4.0 - 2.0 * 1.5;
        assert!((plaat.oppervlak - a).abs() < 1e-12, "{}", plaat.oppervlak);
        assert!((plaat.knopen.iter().map(|k| k.oppervlak).sum::<f64>() - a).abs() < 1e-12);
        let opp = |id: usize| plaat.knopen.iter().find(|k| k.id == id).unwrap().oppervlak;
        assert!((opp(1) - 0.0625).abs() < 1e-15, "hoek");
        assert!((opp(2) - 0.125).abs() < 1e-15, "rand");
        assert!((opp(1 + 13 + 1) - 0.25).abs() < 1e-15, "binnen");
        assert_eq!(plaat.assen.z, [0.0, 0.0, 1.0]);
        assert!(plaat.alleen_druk && plaat.k == 10_000.0);
    }

    /// ∫N_i dA van een scheve vierhoek (geen parallellogram), met de hand: het
    /// trapezium (0; 0), (2; 0), (1,5; 1), (0,5; 1) heeft x_ξ = (3 − η)/4,
    /// x_η = −ξ/4, y_ξ = 0 en y_η = 1/2, dus det J = (3 − η)/8 en
    /// ∫N_i dA = ∫∫ ¼(1 + ξ_i·ξ)(1 + η_i·η)·(3 − η)/8 dξ dη = 3/8 − η_i/24:
    /// 5/12 aan de lange zijde (η = −1) en 1/3 aan de korte (η = +1), samen
    /// 1,5 m². Een parallellogram zou elke knoop A/4 = 0,375 geven.
    #[test]
    fn tributair_oppervlak_van_een_trapezium_met_de_hand() {
        let mut r = verzoek(1, 1, |_, _| false);
        // Knopen 1 (0,0), 2 (1,0), 3 (0,1) en 4 (1,1) van het net; element 1-2-4-3.
        for (id, x, y) in [(1, 0.0, 0.0), (2, 2.0, 0.0), (4, 1.5, 1.0), (3, 0.5, 1.0)] {
            let knoop = r.nodes.iter_mut().find(|n| n.id == id).unwrap();
            (knoop.x, knoop.y) = (x, y);
        }
        let plaat = &Plan::bouw(&r).platen[0];
        let opp: Vec<f64> = plaat.knopen.iter().map(|k| k.oppervlak).collect();
        for (werkelijk, verwacht) in opp.iter().zip([5.0 / 12.0, 5.0 / 12.0, 1.0 / 3.0, 1.0 / 3.0]) {
            assert!((werkelijk - verwacht).abs() < 1e-15, "{opp:?}");
        }
        assert!((plaat.oppervlak - 1.5).abs() < 1e-15);
    }

    /// Een plaat met twee losse stroken: twee eilanden, elk met drie
    /// steunpunten en een eigen vlak, en per eiland een eigen vasthouding op
    /// knopen van dat eiland (twee verbonden delen, elk drie bewegingen vrij).
    #[test]
    fn een_plaat_met_losse_eilanden() {
        let r = verzoek(8, 2, |i, _| (3..5).contains(&i));
        let plan = Plan::bouw(&r);
        let plaat = &plan.platen[0];
        assert_eq!(plaat.eilanden.len(), 2);
        let ids = |eiland: &Vec<usize>| eiland.iter().map(|i| plaat.knopen[*i].id).collect::<Vec<_>>();
        // Knopen: id = 1 + j·9 + i; links i ≤ 3, rechts i ≥ 5.
        assert_eq!(ids(&plaat.eilanden[0]), vec![1, 2, 3, 4, 10, 11, 12, 13, 19, 20, 21, 22]);
        assert_eq!(ids(&plaat.eilanden[1]), vec![6, 7, 8, 9, 15, 16, 17, 18, 24, 25, 26, 27]);
        assert_eq!(plan.steunen(&Los::new()).len(), 6);
        let vlakken = plan.vlakpunten();
        assert_eq!(vlakken.len(), 2);
        assert!(vlakken.iter().all(|(id, _, punten)| *id == 1 && punten.len() == 3));
        let vrij = opleggingen::vlakvrij(&r, &HashSet::new(), &Los::new());
        assert_eq!(vrij.len(), 2);
        assert!(vrij.iter().all(|groep| groep.bewegingen.len() == 3 && !groep.via_schijf));
        let vast = kies_vlakvast(&plan, &vrij);
        assert_eq!(vast.len(), 6);
        for (groep, veren) in vrij.iter().zip(vast.chunks(3)) {
            assert!(veren.iter().all(|v| groep.delen[0].knopen.contains(&v.knoop)), "de veren van een eiland liggen op dat eiland");
        }
        assert!(opleggingen::controleer(&r, &HashSet::new()).is_empty(), "elk eiland is opgelegd en in het vlak vastgehouden");
    }

    /// Zonder plaat op bedding is het plan leeg (en het oude rekenpad blijft).
    #[test]
    fn zonder_bedding_een_leeg_plan() {
        let mut r = verzoek(2, 2, |_, _| false);
        r.plates[0].bedding = None;
        assert!(Plan::bouw(&r).is_empty());
        assert!(!met_alleen_druk(&r));
    }

    #[test]
    fn drie_punten_van_een_vlak_en_van_een_lijn() {
        let vlak = [(1, [0.0, 0.0, 0.0]), (2, [1.0, 0.0, 0.0]), (3, [2.0, 0.0, 0.0]), (4, [1.0, 1.0, 0.0])];
        assert_eq!(drie_punten(&vlak).iter().map(|p| p.0).collect::<Vec<_>>(), vec![1, 3, 4]);
        let lijn = [(1, [0.0, 0.0, 0.0]), (2, [1.0, 0.0, 0.0]), (3, [2.0, 0.0, 0.0])];
        assert_eq!(drie_punten(&lijn).len(), 2);
        assert_eq!(drie_punten(&[(5, [1.0, 2.0, 3.0])]).len(), 1);
        assert!(drie_punten(&[]).is_empty());
    }

    /// Een vloer op bedding zonder opleggingen: drie vrije bewegingen in het
    /// vlak, door drie vasthoudingen precies vastgelegd (de voorwaarden op de
    /// vrije bewegingen zijn inverteerbaar). Met een horizontale oplegging in
    /// twee knopen is er niets vrij.
    #[test]
    fn de_vasthouding_legt_de_vrije_bewegingen_in_het_vlak_vast() {
        let r = verzoek(6, 4, |_, _| false);
        let vrij = opleggingen::vlakvrij(&r, &HashSet::new(), &Los::new());
        assert_eq!(vrij.len(), 1);
        assert_eq!(vrij[0].bewegingen.len(), 3);
        let plan = Plan::bouw(&r);
        let vast = kies_vlakvast(&plan, &vrij);
        assert_eq!(vast.len(), 3);
        let punt = |id: usize| plan.platen[0].knopen.iter().find(|k| k.id == id).unwrap().punt;
        let m: Vec<Vec<f64>> = vast.iter().map(|v| {
            let arm = scale(cross(sub(punt(v.knoop), vrij[0].delen[0].centrum), v.richting), 1.0 / vrij[0].lengte);
            let rij = [v.richting[0], v.richting[1], v.richting[2], arm[0], arm[1], arm[2]];
            vrij[0].bewegingen.iter().map(|z| (0..6).map(|i| rij[i] * z[i]).sum()).collect()
        }).collect();
        let det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
        assert!(det.abs() > 0.1, "goed geconditioneerd: det {det}");
        // De controle op de opleggingen telt ze dan niet als vrij.
        assert!(opleggingen::controleer(&r, &std::collections::HashSet::new()).is_empty());
        let mut vastgezet = r.clone();
        vastgezet.supports.push(crate::Support3D { node_id: 1, ux: true, uy: true, ..Default::default() });
        vastgezet.supports.push(crate::Support3D { node_id: 7, uy: true, ..Default::default() });
        assert!(opleggingen::vlakvrij(&vastgezet, &HashSet::new(), &Los::new()).is_empty());
    }

    /// Het criterium van de vasthouding staat op de belasting zelf: per deel de
    /// resultante langs de vrije bewegingen in het plaatvlak. Verticale lasten
    /// en lasten in het vlak die samen nul zijn (kracht én moment om de
    /// normaal) geven niets; een kracht of een koppel in het vlak wel, ook uit
    /// een staaflast in een globale richting of een puntlast op een staaf.
    #[test]
    fn de_belasting_in_het_plaatvlak_komt_uit_de_lastgegevens() {
        use crate::{GlobalDirection3D, Member3D, MemberLoad3D, MemberPointLoad3D, NodalLoad3D};
        let basis = verzoek(6, 4, |_, _| false);
        let plan = Plan::bouw(&basis);
        let last = |id: usize, node_id: usize, f: V3| NodalLoad3D { id, node_id, fx: f[0], fy: f[1], fz: f[2], mx: 0.0, my: 0.0, mz: 0.0 };
        let zoek = |r: &SolveRequest3D| zoek_vlaklast(r, &plan, &opleggingen::vlakvrij(r, &HashSet::new(), &Los::new()));
        // Knopen: id = 1 + j·7 + i op (0,5·i; 0,5·j).
        let mut r = basis.clone();
        r.nodal_loads = vec![last(1, 1 + 7 + 2, [0.0, 0.0, -50.0])];
        r.surface_loads.push(crate::SurfaceLoad3D { id: 1, plate_id: 1, qx_kn_per_m2: 0.0, qy_kn_per_m2: 0.0, qz_kn_per_m2: -4.0 });
        assert!(zoek(&r).is_none(), "verticaal: niets in het vlak");
        // Twee tegengestelde krachten op één lijn: kracht en moment nul.
        r.nodal_loads.push(last(2, 1 + 14 + 1, [3.0, 0.0, 0.0]));
        r.nodal_loads.push(last(3, 1 + 14 + 5, [-3.0, 0.0, 0.0]));
        assert!(zoek(&r).is_none(), "evenwicht in het vlak: niets dat de vasthouding opneemt");
        // Op verschillende lijnen: een koppel 3 kN × 1 m om de normaal, geen kracht.
        r.nodal_loads[2] = last(3, 1 + 28 + 5, [-3.0, 0.0, 0.0]);
        let koppel = zoek(&r).expect("een koppel in het vlak");
        assert!(norm(koppel.kracht) < 1e-12 && (koppel.moment.abs() - 3.0).abs() < 1e-12, "{koppel:?}");
        // Een staaf over de vloer met een lijnlast in globaal X van 2 kN/m over 1,5 m.
        let mut s = basis.clone();
        s.members.push(Member3D { id: 1, start_node_id: 1, end_node_id: 4, material_id: 1, section_id: 1,
            releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: vec![], tension_only: false, bedding: None, part_section_ids: None });
        s.member_loads.push(MemberLoad3D { id: 1, member_id: 1, global_direction: Some(GlobalDirection3D::X),
            q_start_kn_per_m: Some(2.0), q_end_kn_per_m: Some(2.0), ..Default::default() });
        let lijn = zoek(&s).expect("een lijnlast langs de staaf in het vlak");
        assert!((lijn.kracht[0] - 3.0).abs() < 1e-12 && lijn.kracht[1].abs() < 1e-12, "{lijn:?}");
        s.member_loads[0].global_direction = Some(GlobalDirection3D::Z);
        assert!(zoek(&s).is_none(), "een lijnlast in globaal Z");
        // Een puntlast dwars op die staaf (lokaal y ligt bij een liggende staaf in het vlak).
        s.member_point_loads.push(MemberPointLoad3D { id: 1, member_id: 1, py_kn: 4.0, pz_kn: 0.0, position_m: 0.5 });
        let punt = zoek(&s).expect("een puntlast in het vlak");
        assert!((norm(punt.kracht) - 4.0).abs() < 1e-12 && punt.kracht[2].abs() < 1e-12, "{punt:?}");
    }

    /// Zonder bedding is dezelfde vloer zonder opleggingen een los deel.
    #[test]
    fn zonder_bedding_blijft_de_vloer_los() {
        let mut r = verzoek(2, 2, |_, _| false);
        r.plates[0].bedding = None;
        let bevindingen = opleggingen::controleer(&r, &std::collections::HashSet::new());
        assert_eq!(bevindingen.len(), 1);
        assert!(opleggingen::vlakvrij(&r, &HashSet::new(), &Los::new()).is_empty());
    }
}
