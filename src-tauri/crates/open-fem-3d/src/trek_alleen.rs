//! Trek-alleen staven: een buitenlus om de lineaire en de tweede-ordeberekening.
//!
//! Algoritme:
//! 1. begin met alle staven actief;
//! 2. los het model met de actieve staven op;
//! 3. een actieve trek-alleen staaf met een drukkracht N < −tol aan begin of
//!    eind wordt inactief; een inactieve staaf wordt weer actief als de
//!    verlenging van zijn einden (u_j − u_i)·e_x, verminderd met de vrije
//!    temperatuurverlenging, bij actieve staaf een trekkracht > tol zou geven;
//! 4. herhaal tot de set niet meer verandert.
//!
//! Beide regels kijken naar dezelfde grootheid: de normaalkracht zonder een
//! eigen axiale lijnlast, bij een ongeknipte staaf EA·(verlenging/L − αΔT),
//! constant langs de staaf. Een globale lijnlast met een component langs de
//! staaf (module `globale_lasten`) voegt daar in de uitvoer N_vast aan toe, de
//! normaalkracht van de aan beide einden vastgehouden staaf onder die eigen
//! last (gemiddeld nul). Die telt voor de status niet mee
//! (`status_normaalkracht`, met N_vast van de hele staaf, ook als de kern haar
//! in delen rekent): anders zou een einde dat alleen door de eigen last
//! plaatselijk op druk staat de staaf uitschakelen, terwijl het weer
//! inschakelen naar de N uit de verlenging kijkt, en zou de staaf tussen trek
//! en druk blijven wisselen. Staat een actieve staaf zo aan een einde
//! plaatselijk op druk, dan volgt een melding. De kruisregel kiest met
//! dezelfde grootheid.
//!
//! Bij tweede orde convergeert de set eerst met lineaire rondes; daarna volgen
//! tweede-orderondes vanaf die set. Zo blokkeert een verband dat in de eerste
//! ronde nog op druk meedoet niet ten onrechte de stabiliteitspoort. Een
//! inactieve staaf gaat uit de invoer: zijn staaflasten komen als statisch
//! gelijkwaardige knooplasten (reacties van een vrij opgelegde staaf) op zijn
//! eindknopen, zodat geen last verdwijnt; een temperatuurlast op een slappe
//! staaf geeft geen kracht en vervalt. Het resultaat bevat de inactieve staaf
//! met normaalkracht 0 en nul-snedekrachtlijnen.
//!
//! Bescherming: een toestand die terugkeert (oscilleren) en meer dan
//! `MAX_RONDES` rondes per fase geven een duidelijke fout, net als een
//! inactieve staaf die een knoop zonder andere staaf of volledige oplegging
//! achterlaat.
//!
//! Dezelfde lus houdt de verticale grondveren van een bedding met alleen druk
//! bij (module `bedding`), en de grondveren van een plaat op bedding met
//! alleen druk (module `plaatbedding`, #107): een veer met een zakking < −tol
//! (de staaf of plaat komt van de grond) valt weg, een weggevallen veer met
//! een zakking > tol doet weer mee.
//! De toestand van een ronde is dan het paar (inactieve staven, weggevallen
//! veren); beide sets moeten stabiel zijn, en dezelfde bescherming tegen
//! oscilleren en te veel rondes geldt voor het paar. Valt door het loskomen
//! een beweging vrij, dan volgt vóór het rekenen een melding
//! (`bedding::controleer_contact`).
//!
//! Twee opties op het verzoek: montagelasten (`tensionOnlyFit`, module
//! `montage`) geven elke trek-alleen staaf vóór de lus haar spanningsloze
//! lengte L + Δ0, als gelijkwaardige temperatuurlast die in elke ronde
//! meedoet; de kruisregel (`tensionOnlyCrossRule`, module `kruisregel`)
//! houdt per kruis de diagonaal met de grootste normaalkracht actief.

use std::borrow::Cow;
use std::collections::{BTreeSet, HashMap, HashSet};

use rekenkern::element::compute_local_axes_3d;

use crate::{
    bedding::{self, Los}, globale_lasten, kruisregel, montage, plaatbedding, shell::PlateGeometry, AnalysisKind, DiagramPoint3D, Member3D,
    MemberDiagram3D, MemberForces3D, NodalLoad3D, Node3D, SolveRequest3D, SolveResult3D, TensionOnlyFitMember3D,
};

/// Maximaal aantal statusrondes per fase (lineair, tweede orde).
const MAX_RONDES: usize = 50;

fn lijst(ids: impl IntoIterator<Item = usize>) -> String {
    ids.into_iter().map(|id| id.to_string()).collect::<Vec<_>>().join(", ")
}

struct Geometrie<'a> {
    knopen: HashMap<usize, &'a Node3D>,
}

impl<'a> Geometrie<'a> {
    fn van(request: &'a SolveRequest3D) -> Self {
        Self { knopen: request.nodes.iter().map(|node| (node.id, node)).collect() }
    }

    fn lengte(&self, staaf: &Member3D) -> f64 {
        let a = self.knopen[&staaf.start_node_id];
        let b = self.knopen[&staaf.end_node_id];
        ((b.x - a.x).powi(2) + (b.y - a.y).powi(2) + (b.z - a.z).powi(2)).sqrt()
    }

    /// Lokale assen zoals de kern ze voor deze staaf bepaalt.
    fn assen(&self, staaf: &Member3D) -> ([f64; 3], [f64; 3], [f64; 3]) {
        let a = self.knopen[&staaf.start_node_id];
        let b = self.knopen[&staaf.end_node_id];
        compute_local_axes_3d(
            a.x, a.y, a.z, b.x, b.y, b.z, None, None, None,
            staaf.roll_angle_rad.map(f64::to_degrees), false,
        )
    }
}

/// Reken het verzoek door met trek-alleen staven en bedding met alleen druk,
/// of direct als er geen van beide is.
pub(crate) fn los_op(
    request: &SolveRequest3D,
    platen: &HashMap<usize, PlateGeometry>,
) -> Result<SolveResult3D, String> {
    let trek = request.members.iter().any(|staaf| staaf.tension_only);
    let druk = bedding::met_alleen_druk(request) || plaatbedding::met_alleen_druk(request);
    if !trek && !druk {
        let mut uitkomst = crate::solve_fixed(request, platen, request.analysis, request.buckling_modes, &Los::new())?;
        uitkomst.diagnostics.extend(bedding::diagnose(request, &uitkomst, None));
        uitkomst.diagnostics.extend(plaatbedding::diagnose(request, &uitkomst, None));
        return Ok(uitkomst);
    }
    // Montage: Δ0 per staaf, als temperatuurlast in het verzoek van elke ronde.
    let montage = if trek { montage::bepaal(request, platen)? } else { None };
    let werk: Cow<SolveRequest3D> = match &montage {
        Some(montage) => Cow::Owned(montage::met_aanpassing(request, &montage.delta_m)),
        None => Cow::Borrowed(request),
    };
    let werk = werk.as_ref();
    let kruisen = if trek && request.tension_only_cross_rule { kruisregel::kruisen(request) } else { vec![] };
    let fasen: &[AnalysisKind] = match request.analysis {
        AnalysisKind::Linear => &[AnalysisKind::Linear],
        AnalysisKind::PDelta => &[AnalysisKind::Linear, AnalysisKind::PDelta],
    };
    let mut inactief = BTreeSet::new();
    let mut los = Los::new();
    let mut gehouden = BTreeSet::new();
    let mut toegepast = 0;
    let mut rondes = 0;
    let mut laatste = None;
    for (index, &fase) in fasen.iter().enumerate() {
        let laatste_fase = index + 1 == fasen.len();
        // Bij tweede orde hoort de knikanalyse bij elke ronde (stabiliteitspoort);
        // bij een lineaire berekening volgt zij één keer na de laatste ronde.
        let modes = if fase == AnalysisKind::PDelta { request.buckling_modes } else { 0 };
        let mut gezien: HashSet<(BTreeSet<usize>, Los)> = HashSet::from([(inactief.clone(), los.clone())]);
        let mut stabiel = false;
        for _ in 0..MAX_RONDES {
            rondes += 1;
            controleer_losse_knopen(werk, &inactief)?;
            bedding::controleer_contact(werk, &inactief.iter().copied().collect(), &los)?;
            let verzoek = gereduceerd(werk, &inactief);
            let uitkomst = crate::solve_fixed(&verzoek, platen, fase, modes, &los)
                .map_err(|fout| met_toestand(fout, rondes, &inactief, &los))?;
            let status = if trek {
                nieuwe_status(werk, &uitkomst, &inactief, &kruisen)
            } else {
                Status { inactief: BTreeSet::new(), gehouden: BTreeSet::new(), toegepast: 0 }
            };
            let nieuw = status.inactief;
            let nieuw_los = bedding::nieuwe_los(werk, &uitkomst, &los);
            if nieuw == inactief && nieuw_los == los {
                gehouden = status.gehouden;
                toegepast = status.toegepast;
                laatste = Some(uitkomst);
                stabiel = true;
                break;
            }
            if !gezien.insert((nieuw.clone(), nieuw_los.clone())) {
                return Err(wisselfout(rondes, &inactief, &nieuw, &los, &nieuw_los));
            }
            inactief = nieuw;
            los = nieuw_los;
        }
        if !stabiel {
            return Err(rondefout(&inactief, &los));
        }
        if laatste_fase && fase == AnalysisKind::Linear && request.buckling_modes > 0 {
            laatste = Some(crate::solve_fixed(&gereduceerd(werk, &inactief), platen, fase, request.buckling_modes, &los)?);
        }
    }
    let uitkomst = laatste.expect("minstens één fase met een stabiele set");
    let mut uitkomst = if trek { afronden(werk, uitkomst, &inactief, rondes) } else { uitkomst };
    if let Some(montage) = &montage {
        let aantal = montage.delta_m.len();
        uitkomst.diagnostics.extend(montage::diagnose(montage, aantal));
        uitkomst.tension_only_fit = montage.delta_m.iter()
            .map(|(id, delta)| TensionOnlyFitMember3D { member_id: *id, delta_mm: delta * 1000.0 })
            .collect();
    }
    if trek && request.tension_only_cross_rule {
        uitkomst.diagnostics.push(kruisregel_diagnose(werk, &uitkomst, &kruisen, &gehouden, toegepast));
        uitkomst.cross_rule_members = gehouden.into_iter().collect();
    }
    uitkomst.diagnostics.extend(bedding::diagnose(request, &uitkomst, druk.then_some(rondes)));
    uitkomst.diagnostics.extend(plaatbedding::diagnose(request, &uitkomst, druk.then_some(rondes)));
    Ok(uitkomst)
}

/// Een rekenfout in een statusronde, met de toestand van die ronde.
fn met_toestand(fout: String, rondes: usize, inactief: &BTreeSet<usize>, los: &Los) -> String {
    let mut toestand = Vec::new();
    if !inactief.is_empty() {
        toestand.push(format!("trek-alleen ronde {rondes}; inactief: staaf {}", lijst(inactief.iter().copied())));
    }
    if !los.is_empty() {
        toestand.push(format!(
            "bedding alleen druk ronde {rondes}; {} grondveer/grondveren los onder {}",
            los.len(), bedding::beschrijf_los(los),
        ));
    }
    if toestand.is_empty() { fout } else { format!("{fout} ({})", toestand.join("; ")) }
}

/// Een toestand die terugkeert: de staven of de grondveren blijven wisselen.
fn wisselfout(rondes: usize, inactief: &BTreeSet<usize>, nieuw: &BTreeSet<usize>, los: &Los, nieuw_los: &Los) -> String {
    let staven: Vec<usize> = inactief.symmetric_difference(nieuw).copied().collect();
    let grond: Los = los.verschil(nieuw_los);
    let mut delen = Vec::new();
    if !staven.is_empty() {
        delen.push(format!(
            "trek-alleen: de staven {} blijven tussen trek en druk wisselen; na ronde {rondes} keerde een eerdere toestand terug. Er is geen eenduidige set actieve staven. Controleer of deze verbanden samen een mechanisme vormen, of maak een ervan een gewone staaf.",
            lijst(staven),
        ));
    }
    if !grond.is_empty() {
        delen.push(format!(
            "bedding (alleen druk): de grondveren onder {} blijven tussen contact en loskomen wisselen; na ronde {rondes} keerde een eerdere toestand terug. Er is geen eenduidige contactzone. Controleer de belasting en de opleggingen van deze {}, of reken de bedding zonder alleen druk.",
            bedding::beschrijf_los(&grond), bedding::soort_los(&grond),
        ));
    }
    delen.join(" ")
}

/// Na `MAX_RONDES` rondes in één fase nog geen stabiele toestand.
fn rondefout(inactief: &BTreeSet<usize>, los: &Los) -> String {
    if los.is_empty() {
        return format!(
            "trek-alleen: na {MAX_RONDES} statusrondes nog geen stabiele set actieve staven; inactief waren laatst de staven {}.",
            lijst(inactief.iter().copied()),
        );
    }
    let mut tekst = format!(
        "bedding (alleen druk): na {MAX_RONDES} statusrondes nog geen stabiele contactzone; los van de grond waren laatst {} grondveer/grondveren onder {}",
        los.len(), bedding::beschrijf_los(los),
    );
    if !inactief.is_empty() {
        tekst.push_str(&format!("; trek-alleen inactief waren laatst de staven {}", lijst(inactief.iter().copied())));
    }
    tekst.push('.');
    tekst
}

/// De regel voor de diagnostiek van de kruisregel.
fn kruisregel_diagnose(
    request: &SolveRequest3D,
    uitkomst: &SolveResult3D,
    kruisen: &[(usize, usize)],
    gehouden: &BTreeSet<usize>,
    nodig: usize,
) -> String {
    if kruisen.is_empty() {
        return "Kruisregel: geen kruis van twee trek-alleen staven gevonden; de regel had niets te doen.".into();
    }
    let schaal = uitkomst.member_forces.iter()
        .map(|f| f.n_start_kn.abs().max(f.n_end_kn.abs()))
        .fold(1.0, f64::max);
    let inactief: HashSet<usize> = uitkomst.inactive_members.iter().copied().collect();
    let trek_alleen: HashSet<usize> = request.members.iter()
        .filter(|staaf| staaf.tension_only).map(|staaf| staaf.id).collect();
    let druk = uitkomst.member_forces.iter()
        .filter(|f| trek_alleen.contains(&f.member_id) && !inactief.contains(&f.member_id))
        .map(|f| (status_normaalkracht(uitkomst, f), f.member_id))
        .filter(|(n, _)| *n < -1e-6 * schaal)
        .min_by(|a, b| a.0.total_cmp(&b.0));
    let regel = if nodig == 0 {
        format!("Kruisregel: {} kruis(en) van trek-alleen staven; de regel was nergens nodig.", kruisen.len())
    } else {
        format!(
            "Kruisregel: {} kruis(en) van trek-alleen staven; in {nodig} daarvan zou geen diagonaal meedoen en bleef de diagonaal met de grootste normaalkracht actief (staaf {}).",
            kruisen.len(), lijst(gehouden.iter().copied()),
        )
    };
    match druk {
        Some((n, id)) => format!("{regel} Grootste drukkracht in een actieve trek-alleen staaf: {:.3} kN (staaf {id}).", -n),
        None => format!("{regel} Geen actieve trek-alleen staaf staat op druk."),
    }
}

/// Volledig opgelegd: elke vrijheidsgraad is geblokkeerd of heeft een veer.
fn volledig_opgelegd(request: &SolveRequest3D, knoop: usize) -> bool {
    request.supports.iter().find(|support| support.node_id == knoop).is_some_and(|s| {
        [
            s.ux || s.kx_kn_per_m.is_some(), s.uy || s.ky_kn_per_m.is_some(), s.uz || s.kz_kn_per_m.is_some(),
            s.rx || s.krx_knm_per_rad.is_some(), s.ry || s.kry_knm_per_rad.is_some(), s.rz || s.krz_knm_per_rad.is_some(),
        ].into_iter().all(|vast| vast)
    })
}

fn controleer_losse_knopen(request: &SolveRequest3D, inactief: &BTreeSet<usize>) -> Result<(), String> {
    if inactief.is_empty() { return Ok(()); }
    let mut alle: HashMap<usize, usize> = HashMap::new();
    let mut actief: HashMap<usize, usize> = HashMap::new();
    // Een staaf houdt ook zijn tussenknopen vast, en een plaat haar knopen.
    for staaf in &request.members {
        let knopen = [staaf.start_node_id, staaf.end_node_id].into_iter()
            .chain(staaf.intermediate_node_ids.iter().copied());
        for knoop in knopen {
            *alle.entry(knoop).or_default() += 1;
            if !inactief.contains(&staaf.id) { *actief.entry(knoop).or_default() += 1; }
        }
    }
    for element in &request.shell_elements {
        for knoop in &element.node_ids { *actief.entry(*knoop).or_default() += 1; }
    }
    let mut los: Vec<usize> = alle.keys().copied()
        .filter(|knoop| actief.get(knoop).copied().unwrap_or(0) == 0 && !volledig_opgelegd(request, *knoop))
        .collect();
    if los.is_empty() { return Ok(()); }
    los.sort_unstable();
    let staven: Vec<usize> = request.members.iter()
        .filter(|staaf| inactief.contains(&staaf.id) && los.iter().any(|k|
            *k == staaf.start_node_id || *k == staaf.end_node_id || staaf.intermediate_node_ids.contains(k)))
        .map(|staaf| staaf.id)
        .collect();
    Err(format!(
        "trek-alleen: staaf {} valt op druk weg en laat knoop {} los hangen; geen andere staaf of volledige oplegging houdt die knoop op zijn plaats. Verbind de knoop met een gewone staaf, of maak de staaf niet trek-alleen.",
        lijst(staven), lijst(los.iter().copied()),
    ))
}

/// Het verzoek zonder de inactieve staven; hun staaflasten gaan naar de eindknopen.
fn gereduceerd(request: &SolveRequest3D, inactief: &BTreeSet<usize>) -> SolveRequest3D {
    let mut verzoek = request.clone();
    if inactief.is_empty() { return verzoek; }
    let geometrie = Geometrie::van(request);
    let staven: HashMap<usize, &Member3D> = request.members.iter().map(|staaf| (staaf.id, staaf)).collect();
    let mut volgende_id = request.nodal_loads.iter().map(|load| load.id).max().unwrap_or(0) + 1;
    let mut knooplast = |knoop: usize, kracht: [f64; 3]| {
        if kracht.iter().all(|waarde| *waarde == 0.0) { return; }
        verzoek.nodal_loads.push(NodalLoad3D {
            id: volgende_id, node_id: knoop, fx: kracht[0], fy: kracht[1], fz: kracht[2], mx: 0.0, my: 0.0, mz: 0.0,
        });
        volgende_id += 1;
    };
    // Eindreacties van een vrij opgelegde staaf onder een last in lokale assen
    // (x, y, z) als globale knoopkrachten op begin- en eindknoop. Een lokale
    // last heeft geen x-component; een globale last (#80) wel.
    let mut verdeel = |staaf: &Member3D, begin: [f64; 3], eind: [f64; 3]| {
        let (ex, ey, ez) = geometrie.assen(staaf);
        let globaal = |[x, y, z]: [f64; 3]| [
            x * ex[0] + y * ey[0] + z * ez[0],
            x * ex[1] + y * ey[1] + z * ez[1],
            x * ex[2] + y * ey[2] + z * ez[2],
        ];
        knooplast(staaf.start_node_id, globaal(begin));
        knooplast(staaf.end_node_id, globaal(eind));
    };
    for load in request.member_loads.iter().filter(|load| inactief.contains(&load.member_id)) {
        let staaf = staven[&load.member_id];
        let lengte = geometrie.lengte(staaf);
        let a = load.start_position_m.unwrap_or(0.0);
        let b = load.end_position_m.unwrap_or(lengte);
        // Trapezium van q_a (bij a) naar q_b (bij b): resultante en eerste moment om het begin.
        let einden = |[qa, qb]: [f64; 2]| {
            let resultante = (qa + qb) / 2.0 * (b - a);
            let moment = (b - a) / 6.0 * (qa * (2.0 * a + b) + qb * (a + 2.0 * b));
            let eind = moment / lengte;
            (resultante - eind, eind)
        };
        let (ex, ey, ez) = geometrie.assen(staaf);
        let lokaal = globale_lasten::componenten(load, &[ex, ey, ez]);
        let (begin_x, eind_x) = einden(lokaal.qx);
        let (begin_y, eind_y) = einden(lokaal.qy);
        let (begin_z, eind_z) = einden(lokaal.qz);
        verdeel(staaf, [begin_x, begin_y, begin_z], [eind_x, eind_y, eind_z]);
    }
    for load in request.member_point_loads.iter().filter(|load| inactief.contains(&load.member_id)) {
        let staaf = staven[&load.member_id];
        let deel = load.position_m / geometrie.lengte(staaf);
        verdeel(staaf, [0.0, load.py_kn * (1.0 - deel), load.pz_kn * (1.0 - deel)], [0.0, load.py_kn * deel, load.pz_kn * deel]);
    }
    verzoek.members.retain(|staaf| !inactief.contains(&staaf.id));
    verzoek.member_loads.retain(|load| !inactief.contains(&load.member_id));
    verzoek.member_point_loads.retain(|load| !inactief.contains(&load.member_id));
    verzoek.thermal_loads.retain(|load| !inactief.contains(&load.member_id));
    verzoek
}

/// De status na één berekening: de nieuwe set inactieve staven, en de staven
/// die alleen dankzij de kruisregel actief blijven.
struct Status {
    inactief: BTreeSet<usize>,
    gehouden: BTreeSet<usize>,
    /// Aantal kruisen waarin de regel een diagonaal actief hield.
    toegepast: usize,
}

/// De normaalkracht waarnaar de status van een actieve trek-alleen staaf
/// kijkt: de kleinste van begin en eind, zonder N_vast van een eigen axiale
/// lijnlast (zie de moduletekst). Zonder zo'n last is dat precies
/// min(n_start, n_end).
fn status_normaalkracht(uitkomst: &SolveResult3D, kracht: &MemberForces3D) -> f64 {
    let [begin, eind] = uitkomst.n_vast_einden.get(&kracht.member_id).copied().unwrap_or([0.0; 2]);
    (kracht.n_start_kn - begin).min(kracht.n_end_kn - eind)
}

/// De nieuwe set inactieve staven na één berekening.
fn nieuwe_status(
    request: &SolveRequest3D,
    uitkomst: &SolveResult3D,
    inactief: &BTreeSet<usize>,
    kruisen: &[(usize, usize)],
) -> Status {
    let geometrie = Geometrie::van(request);
    let krachten: HashMap<usize, &MemberForces3D> = uitkomst.member_forces.iter().map(|f| (f.member_id, f)).collect();
    let verplaatsing: HashMap<usize, [f64; 3]> = uitkomst.displacements.iter()
        .map(|d| (d.node_id, [d.ux, d.uy, d.uz])).collect();
    // Numerieke ruis in N schaalt met de grootste normaalkracht van het model.
    let schaal = uitkomst.member_forces.iter()
        .map(|f| f.n_start_kn.abs().max(f.n_end_kn.abs()))
        .fold(1.0, f64::max);
    let tolerantie = 1e-6 * schaal;
    let mut nieuw = BTreeSet::new();
    let mut normaalkracht: HashMap<usize, f64> = HashMap::new();
    for staaf in request.members.iter().filter(|staaf| staaf.tension_only) {
        let (n, op_druk) = if inactief.contains(&staaf.id) {
            // Normaalkracht die de staaf bij de huidige verplaatsingen zou krijgen.
            let (ex, _, _) = geometrie.assen(staaf);
            let (a, b) = (verplaatsing[&staaf.start_node_id], verplaatsing[&staaf.end_node_id]);
            let verlenging: f64 = (0..3).map(|as_| (b[as_] - a[as_]) * ex[as_]).sum();
            let materiaal = request.materials.iter().find(|m| m.id == staaf.material_id).unwrap();
            // Bij een verlopende staaf (#73) de delen in serie: n/Σ(1/A_i).
            let oppervlakte = crate::verloop::axiale_oppervlakte(request, staaf).expect("doorsnede is gekeurd");
            let alpha = materiaal.alpha_per_k.unwrap_or(12e-6);
            let delta_t: f64 = request.thermal_loads.iter()
                .filter(|load| load.member_id == staaf.id)
                .map(|load| load.delta_t_uniform_k)
                .sum();
            let lengte = geometrie.lengte(staaf);
            let n = materiaal.e_mpa * 1000.0 * oppervlakte * (verlenging / lengte - alpha * delta_t);
            (n, n <= tolerantie)
        } else {
            let n = status_normaalkracht(uitkomst, krachten[&staaf.id]);
            (n, n < -tolerantie)
        };
        normaalkracht.insert(staaf.id, n);
        if op_druk { nieuw.insert(staaf.id); }
    }
    // Kruisregel: zouden beide diagonalen van een kruis wegvallen, dan blijft
    // die met de grootste normaalkracht actief. Bij gelijke kracht (binnen de
    // ruis) blijft de staaf die al actief was, anders de laagste id: zo kan de
    // keuze niet op ruis heen en weer springen.
    let mut gehouden = BTreeSet::new();
    let mut toegepast = 0;
    for &(a, b) in kruisen {
        if !(nieuw.contains(&a) && nieuw.contains(&b)) { continue; }
        toegepast += 1;
        let (na, nb) = (normaalkracht[&a], normaalkracht[&b]);
        let kies_a = if (na - nb).abs() <= tolerantie {
            match (inactief.contains(&a), inactief.contains(&b)) {
                (false, true) => true,
                (true, false) => false,
                _ => a < b,
            }
        } else {
            na > nb
        };
        let houd = if kies_a { a } else { b };
        nieuw.remove(&houd);
        gehouden.insert(houd);
    }
    Status { inactief: nieuw, gehouden, toegepast }
}

/// Inactieve staven met nul-uitvoer in het resultaat, en de statusgegevens.
fn afronden(request: &SolveRequest3D, mut uitkomst: SolveResult3D, inactief: &BTreeSet<usize>, rondes: usize) -> SolveResult3D {
    let geometrie = Geometrie::van(request);
    let nul_lijn = |member_id: usize| MemberDiagram3D {
        member_id,
        points: vec![DiagramPoint3D { t: 0.0, value: 0.0 }, DiagramPoint3D { t: 1.0, value: 0.0 }],
        max_value: 0.0, min_value: 0.0, max_abs_value: 0.0,
    };
    for staaf in request.members.iter().filter(|staaf| inactief.contains(&staaf.id)) {
        uitkomst.member_forces.push(MemberForces3D {
            member_id: staaf.id, length_m: geometrie.lengte(staaf),
            n_start_kn: 0.0, n_end_kn: 0.0, vy_start_kn: 0.0, vy_end_kn: 0.0, vz_start_kn: 0.0, vz_end_kn: 0.0,
            torsion_start_knm: 0.0, torsion_end_knm: 0.0, my_start_knm: 0.0, my_end_knm: 0.0,
            mz_start_knm: 0.0, mz_end_knm: 0.0,
        });
        let lijnen = &mut uitkomst.diagrams;
        for reeks in [&mut lijnen.moment_y, &mut lijnen.moment_z, &mut lijnen.shear_y,
            &mut lijnen.shear_z, &mut lijnen.axial, &mut lijnen.torsion]
        {
            reeks.push(nul_lijn(staaf.id));
        }
    }
    uitkomst.member_forces.sort_by_key(|kracht| kracht.member_id);
    let lijnen = &mut uitkomst.diagrams;
    for reeks in [&mut lijnen.moment_y, &mut lijnen.moment_z, &mut lijnen.shear_y,
        &mut lijnen.shear_z, &mut lijnen.axial, &mut lijnen.torsion]
    {
        reeks.sort_by_key(|lijn| lijn.member_id);
    }
    let aantal = request.members.iter().filter(|staaf| staaf.tension_only).count();
    uitkomst.diagnostics.push(if inactief.is_empty() {
        format!("Trek-alleen: alle {aantal} trek-alleen staven doen mee; {rondes} statusronde(s).")
    } else {
        format!(
            "Trek-alleen: {} van {aantal} trek-alleen staven staan op druk en doen niet mee (staaf {}); {rondes} statusrondes.",
            inactief.len(), lijst(inactief.iter().copied()),
        )
    });
    if request.member_loads.iter().any(|load| inactief.contains(&load.member_id))
        || request.member_point_loads.iter().any(|load| inactief.contains(&load.member_id))
    {
        uitkomst.diagnostics.push(
            "Trek-alleen: staaflasten op inactieve staven zijn als knooplasten op hun eindknopen gezet.".into(),
        );
    }
    // Een actieve staaf die alleen door haar eigen axiale lijnlast aan een
    // einde op druk staat: de status keek naar de normaalkracht zonder die last.
    let schaal = uitkomst.member_forces.iter()
        .map(|f| f.n_start_kn.abs().max(f.n_end_kn.abs()))
        .fold(1.0, f64::max);
    let tolerantie = 1e-6 * schaal;
    let plaatselijk: Vec<String> = request.members.iter()
        .filter(|staaf| staaf.tension_only && !inactief.contains(&staaf.id)
            && uitkomst.n_vast_einden.contains_key(&staaf.id))
        .filter_map(|staaf| uitkomst.member_forces.iter().find(|f| f.member_id == staaf.id))
        .filter(|f| f.n_start_kn.min(f.n_end_kn) < -tolerantie && status_normaalkracht(&uitkomst, f) >= -tolerantie)
        .map(|f| format!("staaf {} (kleinste N {:.3} kN)", f.member_id, f.n_start_kn.min(f.n_end_kn)))
        .collect();
    if !plaatselijk.is_empty() {
        uitkomst.diagnostics.push(format!(
            "Trek-alleen: {} staat aan een einde plaatselijk op druk door de eigen lijnlast langs de staaf (een globale last met een component langs de staafas). De status volgt de normaalkracht zonder die eigen last (bij een staaf zonder aansluitingen tussen haar einden het gemiddelde over de staaf); die is trek, dus de staaf doet mee.",
            plaatselijk.join(", "),
        ));
    }
    uitkomst.inactive_members = inactief.iter().copied().collect();
    uitkomst.tension_only_rounds = rondes;
    uitkomst
}
