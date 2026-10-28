//! Mechanismen die de belasting niet aanstoot (#195).
//!
//! Proef. Elke 3D-berekening (`solve_fixed`) gaat na of de stijfheidsmatrix
//! singulier is: twee proefbelastingen op alle vrije vrijheidsgraden,
//! opgelost met een verse sparse Cholesky-factorisatie zonder verschuiving en
//! drie stappen iteratieve verfijning (`proef`; tot #195
//! `tweede_orde::singulier`, #96 en #110). Is de matrix regulier, dan komt het
//! relatieve residu op afrondingsniveau, ook bij een slecht geconditioneerd
//! model; is zij singulier, dan blijft de component van de proefbelasting
//! langs het mechanisme als residu staan, of faalt de factorisatie al. Dat is
//! dezelfde ene factorisatie per berekening die #110 al deed (ook per ronde
//! van de trek-alleen-lus); een regulier model rekent verder precies zoals
//! voorheen. Alleen een model met een vrije beweging rekent meer: de
//! nulruimte en een tweede oplossing van de kern (gemeten in
//! tests/mechanisme.rs, `tijd_van_de_controle`: een raam van 150 kolommen in
//! de releasebouw 10 ms regulier, 19 ms met een vrije beweging).
//!
//! Vrije bewegingen. Bij een singuliere matrix volgen de vrije bewegingen
//! (de nulruimte) uit inverse iteratie met een blok startvectoren op de naar
//! de diagonaal geschaalde matrix D^-½·K·D^-½, met de factor van de proef of,
//! als die faalde, een factor met een kleine verschuiving σ·D, en daarna een
//! Rayleigh-Ritz-stap: een Ritz-waarde onder `NUL` is een vrije beweging. Het
//! blok verdubbelt tot er minstens één Ritz-waarde boven `NUL` bij zit, zodat
//! geen beweging gemist wordt. Een vrijheidsgraad zonder enige stijfheid
//! (een lege rij) is een vrije beweging op zich.
//!
//! Vastzetten, zoals de knoopdraaiing (#96) een draaiing vastzet: evenveel
//! gewone blokkeringen (een translatie of draaiing van één knoop) als er
//! vrije bewegingen zijn, gekozen met volledige pivotering zodat ze die
//! bewegingen precies vastleggen, en nooit op een vrijheidsgraad die een
//! schijf aan haar meester koppelt. De kern lost zo een reguliere matrix op,
//! zonder ruis langs het mechanisme. De bewegingen worden daarna zo gekozen
//! dat beweging k in blokkering k gelijk is aan 1 en in de andere
//! blokkeringen 0 (`vormen`). Omdat K·m = 0 voor elke vrije beweging m, is
//! m·R = −m·F met R de reacties van de blokkeringen: de reactie in blokkering
//! k is precies min de arbeid van de belasting langs beweging k. Is elke
//! reactie nul (binnen afrondingsruis, dezelfde grens als bij de
//! knoopdraaiing), dan stoot de belasting het mechanisme niet aan en volgt
//! een uitkomst met een melding; anders een fout die de beweging noemt.
//!
//! Uitkomst. De blokkeringen staan niet bij de reacties. De verplaatsingen
//! langs het mechanisme zijn onbepaald; de uitvoer geeft de kleinste
//! oplossing: het deel langs de vrije bewegingen eraf geprojecteerd, met
//! draaiingen gewogen als L·θ (L de modelafmeting), loodrecht op de
//! vastgehouden knoopdraaiingen van #96. Een vrije beweging vervormt geen
//! element, dus de krachten veranderen daardoor niet.
//!
//! Tweede orde en knik. Een vrije beweging waarin staven op druk meebewegen,
//! is onder die drukkracht instabiel (knikfactor 0): de geometrische
//! stijfheid langs de bewegingen, G = Mᵀ·K_G·M, heeft dan een negatieve
//! eigenwaarde. Bij een tweede-ordeberekening is dat een fout (de tangentiële
//! stijfheid is langs die beweging niet positief definiet); bij een lineaire
//! berekening staat het in de melding. Zet de tweede orde zelf kracht langs
//! een vrije beweging (de reacties van de blokkeringen na de tweede orde),
//! dan volgt ook een fout. De knikanalyse bij een lineaire berekening rekent
//! op het model zonder deze blokkeringen, zoals voorheen: een nulmode valt
//! daar weg.
//!
//! Melding. Welke knopen, welke richtingen (translaties, en de knopen die
//! daarbij alleen draaien; bij een zuivere draaiing de draaiassen) en een
//! aanwijzing (verband of schoor, momentvaste aansluiting, inklemming,
//! oplegging). Noemt de controle op de opleggingen (#64) een beweging al,
//! als starre beweging van een deel dat zij onvoldoende opgelegd vindt of
//! als beweging van een schijf met de delen die eraan hangen, dan volgt
//! daarvoor geen tweede melding. Een raam dat volgens die controle alleen kan
//! omvallen, maar ook zonder verband kan zwaaien, krijgt voor het zwaaien wel
//! een melding.
//!
//! Kan de controle zelf niet rekenen (dat hoort niet te gebeuren, behalve
//! bij meer dan `MAX_BEWEGINGEN` vrije bewegingen), dan volgt het rekenpad
//! van vóór #195 met een melding.

use std::collections::{BTreeMap, BTreeSet};

use rekenkern::{
    linalg::{sparse_cholesky_solve, CscMatrix, NumericCholesky},
    solver::{assembly::assemble_stiffness_sparse_3d, constraints::FreeConstraintSystem, dof::DofNumbering},
    types::{AnalysisResults3D, SolverInput3D, SolverSupport3D},
};

use crate::knoopdraaiing::{self, Vastzetting};
use crate::opleggingen::{self, eigen, reeks};
use crate::tweede_orde::{self, factoriseer};
use crate::SolveRequest3D;

/// Een beweging per knoop: (ux, uy, uz, rx, ry, rz).
type Vorm6 = BTreeMap<usize, [f64; 6]>;

/// Aantal proefbelastingen in `proef`.
const PROEVEN: u64 = 2;
/// Stappen iteratieve verfijning per proefbelasting.
const VERFIJNINGEN: usize = 3;
/// Een proefbelasting met een groter relatief residu wijst op een singuliere
/// stijfheidsmatrix; dezelfde grens als `residual_ok` van de kern.
const PROEFGRENS: f64 = 1e-6;
/// Een Ritz-waarde van de naar de diagonaal geschaalde matrix (diagonaal 1)
/// onder deze grens is een vrije beweging. Afrondingsruis ligt rond 1e-15;
/// een regulier model met een kleinere eigenwaarde heeft een
/// conditiegetal boven 1e10 en haalt de proef dan al niet.
const NUL: f64 = 1e-10;
/// Stappen inverse iteratie per blok.
const ITERATIES: usize = 4;
/// Eerste blokgrootte van de inverse iteratie.
const BLOK: usize = 8;
/// Zoveel vrije bewegingen gaat de adapter afzonderlijk na.
const MAX_BEWEGINGEN: usize = 256;
/// Verschuivingen σ (maal de diagonaal) als de factorisatie zonder
/// verschuiving faalt.
const VERSCHUIVINGEN: [f64; 3] = [1e-12, 1e-9, 1e-6];
/// Zoveel bewegingen schrijft een melding uit.
const MAX_BESCHREVEN: usize = 6;
/// Een eigenwaarde van G = Mᵀ·K_G·M telt als negatief onder −GEOMETRISCH maal
/// de maat Σ |N|/L·|m_e|².
const GEOMETRISCH: f64 = 1e-8;
const ASSEN: [&str; 3] = ["X", "Y", "Z"];

/// Een getal in [0, 1) zonder patroon, vast per knoop, richting en proef
/// (splitmix64): de proefbelasting is reproduceerbaar en heeft geen symmetrie
/// die een mechanisme net zou missen.
fn ruis(knoop: usize, lokaal: usize, proef: u64) -> f64 {
    let mut x = (knoop as u64).wrapping_mul(6).wrapping_add(lokaal as u64)
        .wrapping_add(proef.wrapping_mul(0xD1B5_4A32_D192_ED03))
        .wrapping_add(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^= x >> 31;
    (x >> 11) as f64 / (1u64 << 53) as f64
}

/// De diagonaal van het omhullende blok van alle knopen, minstens 1 m.
fn modelmaat(input: &SolverInput3D) -> f64 {
    let mut laag = [f64::INFINITY; 3];
    let mut hoog = [f64::NEG_INFINITY; 3];
    for knoop in input.nodes.values() {
        for (as_, waarde) in [knoop.x, knoop.y, knoop.z].into_iter().enumerate() {
            laag[as_] = laag[as_].min(waarde);
            hoog[as_] = hoog[as_].max(waarde);
        }
    }
    (0..3).map(|as_| (hoog[as_] - laag[as_]).powi(2)).sum::<f64>().sqrt().max(1.0)
}

fn norm(v: &[f64]) -> f64 { v.iter().map(|x| x * x).sum::<f64>().sqrt() }

fn inproduct(a: &[f64], b: &[f64]) -> f64 { a.iter().zip(b).map(|(x, y)| x * y).sum() }

/// De stijfheidsmatrix van een kernmodel op de vrije vrijheidsgraden,
/// gereduceerd voor de koppelingen (schijven). Dezelfde assemblage als de
/// lineaire berekening van de kern, zonder lastvector.
struct Stijfheid {
    dof: DofNumbering,
    nf: usize,
    /// K_s = Cᵀ·K_ff·C (zonder koppelingen K_ff zelf), onderste driehoek.
    k_s: CscMatrix,
    koppelingen: Option<FreeConstraintSystem>,
}

impl Stijfheid {
    fn bouw(input: &SolverInput3D) -> Self {
        let dof = DofNumbering::build_3d(input);
        let nf = dof.n_free;
        let k_ff = assemble_stiffness_sparse_3d(input, &dof, false).k_ff;
        let koppelingen = FreeConstraintSystem::build_3d(&input.constraints, &dof, &input.nodes);
        let k_s = match &koppelingen {
            Some(koppelingen) => koppelingen.reduce_matrix_sparse(&k_ff),
            None => k_ff,
        };
        Self { dof, nf, k_s, koppelingen }
    }

    fn reduceer_vector(&self, vector: &[f64]) -> Vec<f64> {
        match &self.koppelingen {
            Some(koppelingen) => koppelingen.reduce_vector(vector),
            None => vector.to_vec(),
        }
    }

    fn breid_uit(&self, vector: &[f64]) -> Vec<f64> {
        match &self.koppelingen {
            Some(koppelingen) => koppelingen.expand_solution(vector),
            None => vector.to_vec(),
        }
    }
}

/// Een singuliere stijfheidsmatrix, met de factor zonder verschuiving (als
/// die slaagde).
struct Singulier {
    stijfheid: Stijfheid,
    factor: Option<NumericCholesky>,
}

/// De proef: `None` als de stijfheidsmatrix van `input` (met de
/// koppelingen) regulier is.
fn proef(input: &SolverInput3D) -> Result<Option<Singulier>, String> {
    let stijfheid = Stijfheid::bouw(input);
    let k_s = &stijfheid.k_s;
    if stijfheid.nf == 0 || k_s.n == 0 { return Ok(None); }
    let Some(factor) = factoriseer(k_s)? else {
        return Ok(Some(Singulier { stijfheid, factor: None }));
    };
    let lengte = modelmaat(input);
    for proef in 0..PROEVEN {
        let mut f = vec![0.0; stijfheid.nf];
        for (&(knoop, lokaal), &index) in &stijfheid.dof.map {
            if index >= stijfheid.nf { continue; }
            let schaal = if lokaal < 3 { 1.0 } else { lengte };
            f[index] = (2.0 * ruis(knoop, lokaal, proef) - 1.0) * schaal;
        }
        let f_s = stijfheid.reduceer_vector(&f);
        let maat = norm(&f_s);
        if !(maat > 0.0) { continue; }
        let mut q = sparse_cholesky_solve(&factor, &f_s);
        let mut residu;
        let mut stap = 0;
        loop {
            let kq = k_s.sym_mat_vec(&q);
            let r: Vec<f64> = f_s.iter().zip(&kq).map(|(f, k)| f - k).collect();
            residu = norm(&r) / maat;
            if !residu.is_finite() || residu < 1e-13 || stap == VERFIJNINGEN { break; }
            stap += 1;
            let dq = sparse_cholesky_solve(&factor, &r);
            for (a, b) in q.iter_mut().zip(&dq) { *a += b; }
        }
        if !(residu < PROEFGRENS) {
            return Ok(Some(Singulier { stijfheid, factor: Some(factor) }));
        }
    }
    Ok(None)
}

/// Orthonormaliseer de vectoren (Gram-Schmidt, twee keer); een vector die
/// daarbij (vrijwel) verdwijnt, valt weg.
fn orthonormaal(vectoren: Vec<Vec<f64>>) -> Vec<Vec<f64>> {
    let mut uit: Vec<Vec<f64>> = Vec::with_capacity(vectoren.len());
    for mut v in vectoren {
        let begin = norm(&v);
        if !(begin > 0.0) || !begin.is_finite() { continue; }
        for _ in 0..2 {
            for q in &uit {
                let f = inproduct(&v, q);
                for (a, b) in v.iter_mut().zip(q) { *a -= f * b; }
            }
        }
        let grootte = norm(&v);
        if grootte > 1e-10 * begin {
            for a in v.iter_mut() { *a /= grootte; }
            uit.push(v);
        }
    }
    uit
}

/// De nulruimte van de gereduceerde matrix `k_s`, als vectoren in de
/// gereduceerde vrijheidsgraden (zie de moduletekst).
fn nulruimte(k_s: &CscMatrix, factor: Option<&NumericCholesky>) -> Result<Vec<Vec<f64>>, String> {
    let n = k_s.n;
    let diagonaal = k_s.diagonal();
    let grootste = diagonaal.iter().fold(0.0f64, |a, d| a.max(d.abs()));
    let leeg: Vec<bool> = diagonaal.iter().map(|d| !(*d > 1e-300 && *d > 1e-30 * grootste)).collect();
    let s: Vec<f64> = diagonaal.iter().zip(&leeg).map(|(d, l)| if *l { 0.0 } else { 1.0 / d.sqrt() }).collect();
    let mut uit: Vec<Vec<f64>> = Vec::new();
    for i in (0..n).filter(|i| leeg[*i]) {
        let mut e = vec![0.0; n];
        e[i] = 1.0;
        uit.push(e);
    }
    let effectief = n - uit.len();
    if effectief == 0 { return Ok(uit); }
    // De factor zonder verschuiving, of een met verschuiving σ·D (een lege
    // rij krijgt σ maal de grootste diagonaal).
    let verschoven;
    let factor = match factor {
        Some(factor) if uit.is_empty() => factor,
        _ => {
            let mut gevonden = None;
            for sigma in VERSCHUIVINGEN {
                let rijen: Vec<usize> = (0..n).collect();
                let waarden: Vec<f64> = (0..n).map(|i| sigma * if leeg[i] { grootste.max(1.0) } else { diagonaal[i] }).collect();
                let verschuiving = CscMatrix::from_triplets(n, &rijen, &rijen, &waarden);
                let matrix = CscMatrix::linear_combination(1.0, k_s, 1.0, &verschuiving);
                if let Some(factor) = factoriseer(&matrix)? {
                    gevonden = Some(factor);
                    break;
                }
            }
            verschoven = gevonden.ok_or("de stijfheidsmatrix is ook met een kleine verschuiving niet te factoriseren")?;
            &verschoven
        }
    };
    // (D^-½·K·D^-½ + σ·I)^-1 = D^½·(K + σ·D)^-1·D^½; een lege rij blijft nul.
    let wortel: Vec<f64> = diagonaal.iter().zip(&leeg).map(|(d, l)| if *l { 0.0 } else { d.sqrt() }).collect();
    let los = |y: &[f64]| -> Vec<f64> {
        let x: Vec<f64> = y.iter().zip(&wortel).map(|(y, w)| y * w).collect();
        let z = sparse_cholesky_solve(factor, &x);
        z.iter().zip(&wortel).map(|(z, w)| z * w).collect()
    };
    let geschaald = |y: &[f64]| -> Vec<f64> {
        let x: Vec<f64> = y.iter().zip(&s).map(|(y, s)| y * s).collect();
        let kx = k_s.sym_mat_vec(&x);
        kx.iter().zip(&s).map(|(k, s)| k * s).collect()
    };
    // Een startvector zonder patroon, nul in de lege rijen.
    let mut volgnummer: u64 = 100;
    let mut startvector = || {
        volgnummer += 1;
        (0..n).map(|i| if leeg[i] { 0.0 } else { 2.0 * ruis(i, 0, volgnummer) - 1.0 }).collect::<Vec<f64>>()
    };
    let mut blok = effectief.min(BLOK);
    loop {
        // Een vector die na een stap vrijwel in de andere ligt (de inverse
        // iteratie blaast de vrije richtingen tot ~1e16 op), maakt plaats voor
        // een nieuwe startvector: het blok blijft zo groot als gevraagd en
        // bevat naast de vrije bewegingen ook andere richtingen.
        let mut aanvullen = |vectoren: Vec<Vec<f64>>| -> Vec<Vec<f64>> {
            let mut y = orthonormaal(vectoren);
            let mut pogingen = 0;
            while y.len() < blok && pogingen < 4 * blok {
                pogingen += 1;
                let mut erbij = y.clone();
                erbij.push(startvector());
                y = orthonormaal(erbij);
            }
            y
        };
        let mut y = aanvullen(Vec::new());
        for _ in 0..ITERATIES {
            let volgende: Vec<Vec<f64>> = y.iter().map(|v| los(v)).collect();
            if volgende.iter().flatten().any(|w| !w.is_finite()) {
                return Err("de inverse iteratie gaf geen eindige vectoren".into());
            }
            y = aanvullen(volgende);
        }
        let ky: Vec<Vec<f64>> = y.iter().map(|v| geschaald(v)).collect();
        let q = y.len();
        let h: Vec<Vec<f64>> = (0..q)
            .map(|a| (0..q).map(|b| 0.5 * (inproduct(&y[a], &ky[b]) + inproduct(&y[b], &ky[a]))).collect())
            .collect();
        let (waarden, vectoren) = eigen(h);
        let nul: Vec<usize> = (0..q).filter(|&k| waarden[k] <= NUL).collect();
        if nul.len() < q || q >= effectief {
            for k in nul {
                let mut m = vec![0.0; n];
                for (a, v) in y.iter().enumerate() {
                    for (mi, vi) in m.iter_mut().zip(v) { *mi += vectoren[k][a] * vi; }
                }
                for (mi, si) in m.iter_mut().zip(&s) { *mi *= si; }
                uit.push(m);
            }
            return Ok(uit);
        }
        if blok >= MAX_BEWEGINGEN || blok >= effectief {
            return Err(format!("het model heeft meer dan {} vrije bewegingen", blok.min(MAX_BEWEGINGEN)));
        }
        blok = (2 * blok).min(effectief).min(MAX_BEWEGINGEN);
    }
}

/// Het inverse van een kleine vierkante matrix (Gauss-Jordan met
/// rijpivotering); `None` als zij singulier is.
fn inverse(mut a: Vec<Vec<f64>>) -> Option<Vec<Vec<f64>>> {
    let d = a.len();
    let mut b: Vec<Vec<f64>> = (0..d).map(|i| (0..d).map(|j| if i == j { 1.0 } else { 0.0 }).collect()).collect();
    for k in 0..d {
        let p = (k..d).max_by(|&i, &j| a[i][k].abs().total_cmp(&a[j][k].abs()))?;
        if !(a[p][k].abs() > 1e-300) { return None; }
        a.swap(k, p);
        b.swap(k, p);
        let spil = a[k][k];
        for j in 0..d {
            a[k][j] /= spil;
            b[k][j] /= spil;
        }
        for i in 0..d {
            if i == k { continue; }
            let f = a[i][k];
            if f == 0.0 { continue; }
            for j in 0..d {
                a[i][j] -= f * a[k][j];
                b[i][j] -= f * b[k][j];
            }
        }
    }
    Some(b)
}

/// Een oplegging zonder blokkering; de blokkering komt erin.
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

/// De vrije bewegingen van een kernmodel met hun blokkeringen.
pub(crate) struct Mechanisme {
    /// Vrije bewegingen per knoop van de kern: beweging k is 1 in blokkering
    /// k en 0 in de andere blokkeringen.
    vormen: Vec<Vorm6>,
    /// De blokkering per beweging: (knoop, lokaal 0–5).
    vast: Vec<(usize, usize)>,
    /// Knopen die pas door de blokkeringen een oplegging krijgen.
    nieuw: BTreeSet<usize>,
    /// Modelafmeting in m: draaiingen tellen als L·θ.
    lengte: f64,
    /// De plaats van de knopen van de kern.
    punten: BTreeMap<usize, [f64; 3]>,
    /// Het kernmodel met de blokkeringen.
    pub(crate) invoer: SolverInput3D,
}

/// Zoek de vrije bewegingen van `input`: `None` als de stijfheidsmatrix
/// regulier is (de proef: één factorisatie), of als de proef wel een
/// singuliere matrix zag maar de inverse iteratie geen beweging vindt (dan
/// beslist de kern, zoals vóór #195).
pub(crate) fn zoek(input: &SolverInput3D) -> Result<Option<Mechanisme>, String> {
    let Some(Singulier { stijfheid: stelsel, factor }) = proef(input)? else { return Ok(None) };
    let gereduceerd = nulruimte(&stelsel.k_s, factor.as_ref())?;
    if gereduceerd.is_empty() { return Ok(None); }
    let n = stelsel.dof.n_total;
    let mut plek: Vec<(usize, usize)> = vec![(0, 0); n];
    for (&(knoop, lokaal), &index) in &stelsel.dof.map { plek[index] = (knoop, lokaal); }
    let lengte = modelmaat(input);
    let gewicht = |index: usize| if plek[index].1 < 3 { 1.0 } else { lengte };
    let volledig: Vec<Vec<f64>> = gereduceerd.iter().map(|q| {
        let mut u = vec![0.0; n];
        u[..stelsel.nf].copy_from_slice(&stelsel.breid_uit(q));
        u
    }).collect();
    // Blokkeringen: volledige pivotering op de gewogen bewegingen, alleen op
    // vrije vrijheidsgraden die geen koppeling volgen.
    let kandidaat: Vec<bool> = (0..n).map(|index| {
        index < stelsel.nf && plek[index].1 < 6
            && !stelsel.koppelingen.as_ref().is_some_and(|k| k.is_dependent(index))
    }).collect();
    // Een translatie gaat bij gelijke grootte voor: de melding noemt dan een
    // kracht in een knoop in plaats van een moment.
    let voorkeur = |index: usize| if plek[index].1 < 3 { 1.0 } else { 0.1 * lengte };
    let mut rest: Vec<Vec<f64>> = volledig.iter().map(|v| (0..n).map(|i| v[i] * voorkeur(i)).collect()).collect();
    let begin = rest.iter().flatten().fold(0.0f64, |a, w| a.max(w.abs()));
    let mut over: Vec<usize> = (0..rest.len()).collect();
    let mut gekozen: Vec<(usize, usize)> = Vec::new();
    while !over.is_empty() {
        let mut beste = (0usize, 0usize, 0.0f64);
        for &k in &over {
            for (i, w) in rest[k].iter().enumerate() {
                if kandidaat[i] && w.abs() > beste.2 { beste = (k, i, w.abs()); }
            }
        }
        let (k, i, grootte) = beste;
        if !(grootte > 1e-8 * begin) { break; }
        gekozen.push((k, i));
        over.retain(|&j| j != k);
        let spil = rest[k].clone();
        for &j in &over {
            let f = rest[j][i] / spil[i];
            if f == 0.0 { continue; }
            for (a, b) in rest[j].iter_mut().zip(&spil) { *a -= f * b; }
        }
    }
    if gekozen.is_empty() { return Ok(None); }
    // Alleen de bewegingen met een spil; een rest zonder spil is afrondingsruis.
    let basis: Vec<&Vec<f64>> = gekozen.iter().map(|(k, _)| &volledig[*k]).collect();
    let blokken: Vec<usize> = gekozen.iter().map(|(_, i)| *i).collect();
    let d = basis.len();
    let m_bb: Vec<Vec<f64>> = (0..d).map(|j| (0..d).map(|k| basis[k][blokken[j]]).collect()).collect();
    let c = inverse(m_bb).ok_or("interne fout: de blokkeringen leggen de vrije bewegingen niet vast")?;
    let vormen: Vec<Vorm6> = (0..d).map(|j| {
        let v: Vec<f64> = (0..n).map(|i| (0..d).map(|k| basis[k][i] * c[k][j]).sum()).collect();
        let grootste = (0..n).map(|i| (v[i] * gewicht(i)).abs()).fold(0.0, f64::max);
        let mut vorm = Vorm6::new();
        for (i, waarde) in v.iter().enumerate() {
            if (waarde * gewicht(i)).abs() <= 1e-12 * grootste { continue; }
            let (knoop, lokaal) = plek[i];
            vorm.entry(knoop).or_insert([0.0; 6])[lokaal] = *waarde;
        }
        vorm
    }).collect();
    let vast: Vec<(usize, usize)> = blokken.iter().map(|&i| plek[i]).collect();
    let mut invoer = input.clone();
    let opgelegd: BTreeSet<usize> = input.supports.values().map(|steun| steun.node_id).collect();
    for &(knoop, lokaal) in &vast {
        // De oplegging met de meeste blokkeringen: de kern leest daar de veren
        // van een knoop (`DofNumbering::build_3d`), zoals in `knoopdraaiing`.
        let mut sleutel: Option<(usize, String)> = None;
        for (naam, steun) in invoer.supports.iter().filter(|(_, steun)| steun.node_id == knoop) {
            let aantal = [steun.rx, steun.ry, steun.rz, steun.rrx, steun.rry, steun.rrz].iter().filter(|v| **v).count();
            if sleutel.as_ref().is_none_or(|(beste, naam_beste)| aantal > *beste || (aantal == *beste && naam < naam_beste)) {
                sleutel = Some((aantal, naam.clone()));
            }
        }
        let naam = match sleutel {
            Some((_, naam)) => naam,
            None => {
                let naam = format!("mechanisme-{knoop}");
                invoer.supports.insert(naam.clone(), lege_steun(knoop));
                naam
            }
        };
        let steun = invoer.supports.get_mut(&naam).expect("de oplegging bestaat");
        match lokaal {
            0 => steun.rx = true,
            1 => steun.ry = true,
            2 => steun.rz = true,
            3 => steun.rrx = true,
            4 => steun.rry = true,
            _ => steun.rrz = true,
        }
    }
    let nieuw = vast.iter().map(|(knoop, _)| *knoop).filter(|knoop| !opgelegd.contains(knoop)).collect();
    let punten = input.nodes.values().map(|knoop| (knoop.id, [knoop.x, knoop.y, knoop.z])).collect();
    Ok(Some(Mechanisme { vormen, vast, nieuw, lengte, punten, invoer }))
}

/// Hoe een vrije beweging eruitziet, voor de aanwijzing.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Aard {
    /// Verschuiven met een horizontale component (zwaaien, omvallen).
    Horizontaal,
    /// Alleen verticaal verschuiven.
    Verticaal,
    /// Alleen draaien, zonder translatie.
    Draaien,
}

/// "X", "X en Z", "X, Y en Z".
fn assen_tekst(assen: &[usize]) -> String {
    let namen: Vec<&str> = assen.iter().map(|a| ASSEN[*a]).collect();
    match namen.as_slice() {
        [] => String::new(),
        [een] => een.to_string(),
        [voor @ .., laatste] => format!("{} en {laatste}", voor.join(", ")),
    }
}

fn getal(x: f64) -> String { format!("{x:.3}").replace('.', ",") }

/// "knoop 7", "knopen 3 en 4", "knopen 100–107"; idem voor staven.
fn noem(enkelvoud: &str, meervoud: &str, ids: &[usize]) -> String {
    if ids.len() == 1 { format!("{enkelvoud} {}", ids[0]) } else { format!("{meervoud} {}", reeks(ids, 3)) }
}

impl Mechanisme {
    /// De beweging k in woorden ("knopen 3 en 4 kunnen samen bewegen in X")
    /// en haar aard. `staaf_van`: de staaf van een rekenknoop van de adapter.
    fn beeld(&self, k: usize, request: &SolveRequest3D, staaf_van: &BTreeMap<usize, usize>) -> (String, Aard) {
        let vorm = &self.vormen[k];
        let l = self.lengte;
        let t = |w: &[f64; 6]| (w[0] * w[0] + w[1] * w[1] + w[2] * w[2]).sqrt();
        let r = |w: &[f64; 6]| l * (w[3] * w[3] + w[4] * w[4] + w[5] * w[5]).sqrt();
        let t_max = vorm.values().map(t).fold(0.0, f64::max);
        let r_max = vorm.values().map(r).fold(0.0, f64::max);
        let translatie = t_max >= 1e-3 * r_max;
        let grootste = if translatie { t_max } else { r_max };
        let component = |w: &[f64; 6], as_: usize, draai: bool| if draai { l * w[3 + as_] } else { w[as_] };
        let bewegend: Vec<(usize, &[f64; 6])> = vorm.iter()
            .filter(|(_, w)| (if translatie { t(w) } else { r(w) }) >= 0.01 * grootste)
            .map(|(knoop, w)| (*knoop, w))
            .collect();
        let assen = |knopen: &[(usize, &[f64; 6])], draai: bool| -> Vec<usize> {
            let grootste = knopen.iter().map(|(_, w)| (0..3).map(|as_| component(w, as_, draai).abs()).fold(0.0, f64::max)).fold(0.0, f64::max);
            (0..3).filter(|as_| knopen.iter().any(|(_, w)| component(w, *as_, draai).abs() >= 0.1 * grootste)).collect()
        };
        let richtingen = assen(&bewegend, !translatie);
        let model: BTreeSet<usize> = request.nodes.iter().map(|knoop| knoop.id).collect();
        let knopen: Vec<usize> = bewegend.iter().map(|(knoop, _)| *knoop).filter(|knoop| model.contains(knoop)).collect();
        let staven: Vec<usize> = bewegend.iter()
            .filter(|(knoop, _)| !model.contains(knoop))
            .filter_map(|(knoop, _)| staaf_van.get(knoop).copied())
            .collect::<BTreeSet<_>>().into_iter().collect();
        let mut wie = Vec::new();
        if !knopen.is_empty() { wie.push(noem("knoop", "knopen", &knopen)); }
        if !staven.is_empty() { wie.push(format!("de rekenknopen langs {}", noem("staaf", "staven", &staven))); }
        if wie.is_empty() { wie.push("rekenknopen van de adapter".into()); }
        let meer = knopen.len() != 1 || wie.len() > 1;
        let mut tekst = match (translatie, meer) {
            (true, true) => format!("{} kunnen samen bewegen in {}", wie.join(" en "), assen_tekst(&richtingen)),
            (true, false) => format!("{} kan bewegen in {}", wie.join(" en "), assen_tekst(&richtingen)),
            (false, true) => format!("{} kunnen samen draaien om {}", wie.join(" en "), assen_tekst(&richtingen)),
            (false, false) => format!("{} kan draaien om {}", wie.join(" en "), assen_tekst(&richtingen)),
        };
        // Modelknopen die niet verschuiven maar wel meedraaien (de voet van
        // een kolom die om haar scharnier kantelt): daar zit het scharnier.
        if translatie {
            let draaiend: Vec<(usize, &[f64; 6])> = vorm.iter()
                .filter(|(knoop, w)| model.contains(knoop) && t(w) < 0.01 * t_max && r(w) >= 0.01 * t_max)
                .map(|(knoop, w)| (*knoop, w))
                .collect();
            if !draaiend.is_empty() {
                let ids: Vec<usize> = draaiend.iter().map(|(knoop, _)| *knoop).collect();
                let werkwoord = if ids.len() == 1 { "draait" } else { "draaien" };
                tekst.push_str(&format!(
                    " ({} {werkwoord} daarbij om {})",
                    noem("knoop", "knopen", &ids), assen_tekst(&assen(&draaiend, true)),
                ));
            }
        }
        let aard = if !translatie {
            Aard::Draaien
        } else if richtingen.iter().any(|as_| *as_ < 2) {
            Aard::Horizontaal
        } else {
            Aard::Verticaal
        };
        (tekst, aard)
    }

    /// Aanwijzing bij bewegingen van deze aarden.
    fn aanwijzing(aarden: &[Aard]) -> String {
        let mut delen = Vec::new();
        if aarden.contains(&Aard::Horizontaal) {
            delen.push("een verband of schoor naar een vast punt, een momentvaste aansluiting (staafeinden niet scharnierend) of een ingeklemde voet");
        }
        if aarden.contains(&Aard::Verticaal) {
            delen.push("een oplegging of steunende staaf in Z, of een momentvaste aansluiting");
        }
        if aarden.contains(&Aard::Draaien) {
            delen.push("een inklemming, rotatieveer of momentvaste staafaansluiting");
        }
        format!("houd die beweging tegen met {}", delen.join("; of met "))
    }

    /// De bewegingen die de controle op de opleggingen (#64) nog niet noemt.
    /// Een beweging is genoemd als zij binnen een deel ligt dat die controle
    /// onvoldoende opgelegd vindt, en dan een starre beweging van dat deel is
    /// (de translaties passen op t + θ × (p − c)) of bij een schijf hoort
    /// (een schijf die met de delen die eraan hangen zwaait, is geen starre
    /// beweging maar wel genoemd). Een raam dat de controle alleen laat
    /// omvallen, maar dat ook zonder verband kan zwaaien, krijgt zo voor dat
    /// zwaaien wel een melding.
    fn niet_genoemd(&self, request: &SolveRequest3D, los: &crate::bedding::Los, staaf_van: &BTreeMap<usize, usize>) -> Vec<usize> {
        let bevindingen: Vec<opleggingen::Bevinding> = opleggingen::controleer_bij(request, &std::collections::HashSet::new(), los)
            .into_iter().filter(|b| b.tekort()).collect();
        let delen: Vec<(BTreeSet<usize>, bool)> = bevindingen.iter().map(|b| {
            let staven: BTreeSet<usize> = b.staven.iter().copied().collect();
            let mut knopen: BTreeSet<usize> = b.knopen.iter().copied().collect();
            knopen.extend(staaf_van.iter().filter(|(_, staaf)| staven.contains(staaf)).map(|(knoop, _)| *knoop));
            let schijf = matches!(b.soort, opleggingen::Soort::Schijf { .. } | opleggingen::Soort::ViaSchijf | opleggingen::Soort::Samen);
            (knopen, schijf)
        }).collect();
        (0..self.vormen.len()).filter(|&k| {
            let vorm = &self.vormen[k];
            let l = self.lengte;
            let grootte = |w: &[f64; 6]| (0..6).map(|c| if c < 3 { w[c].abs() } else { l * w[c].abs() }).fold(0.0, f64::max);
            let grootste = vorm.values().map(grootte).fold(0.0, f64::max);
            let bewegend: BTreeSet<usize> = vorm.iter().filter(|(_, w)| grootte(w) >= 0.01 * grootste).map(|(knoop, _)| *knoop).collect();
            !delen.iter().any(|(knopen, schijf)| bewegend.is_subset(knopen) && (*schijf || self.star(vorm, knopen)))
        }).collect()
    }

    /// Zijn de translaties van `vorm` op `knopen` een starre beweging
    /// t + θ × (p − c) (kleinste kwadraten), en elders nul? Een beweging
    /// zonder translatie telt niet als star.
    fn star(&self, vorm: &Vorm6, knopen: &BTreeSet<usize>) -> bool {
        let totaal: f64 = vorm.values().map(|w| w[0] * w[0] + w[1] * w[1] + w[2] * w[2]).sum();
        if !(totaal > 0.0) { return false; }
        let erbuiten: f64 = vorm.iter().filter(|(knoop, _)| !knopen.contains(knoop))
            .map(|(_, w)| w[0] * w[0] + w[1] * w[1] + w[2] * w[2]).sum();
        let punten: Vec<(usize, [f64; 3])> = knopen.iter().filter_map(|k| self.punten.get(k).map(|p| (*k, *p))).collect();
        if punten.is_empty() { return false; }
        let mut c = [0.0; 3];
        for (_, p) in &punten { for a in 0..3 { c[a] += p[a] / punten.len() as f64; } }
        let maat = punten.iter().map(|(_, p)| ((p[0] - c[0]).powi(2) + (p[1] - c[1]).powi(2) + (p[2] - c[2]).powi(2)).sqrt()).fold(1.0, f64::max);
        // Kolommen (t, θ·maat) per translatievrijheidsgraad van elke knoop.
        let mut ata = vec![vec![0.0; 6]; 6];
        let mut atb = [0.0; 6];
        for (knoop, p) in &punten {
            let d = [(p[0] - c[0]) / maat, (p[1] - c[1]) / maat, (p[2] - c[2]) / maat];
            let w = vorm.get(knoop).copied().unwrap_or([0.0; 6]);
            for as_ in 0..3 {
                // u_as = t_as + (θ × d)_as
                let mut rij = [0.0; 6];
                rij[as_] = 1.0;
                let (b, e) = ((as_ + 1) % 3, (as_ + 2) % 3);
                rij[3 + b] = d[e];
                rij[3 + e] = -d[b];
                for i in 0..6 {
                    atb[i] += rij[i] * w[as_];
                    for j in 0..6 { ata[i][j] += rij[i] * rij[j]; }
                }
            }
        }
        let (waarden, vectoren) = eigen(ata);
        let grootste = waarden.iter().copied().fold(0.0, f64::max);
        // Kleinste-kwadratenpassing via de eigenbasis (pseudo-inverse).
        let mut x = [0.0; 6];
        for (waarde, v) in waarden.iter().zip(&vectoren) {
            if !(*waarde > 1e-12 * grootste) { continue; }
            let f = (0..6).map(|i| v[i] * atb[i]).sum::<f64>() / waarde;
            for i in 0..6 { x[i] += f * v[i]; }
        }
        let mut rest = erbuiten;
        for (knoop, p) in &punten {
            let d = [(p[0] - c[0]) / maat, (p[1] - c[1]) / maat, (p[2] - c[2]) / maat];
            let w = vorm.get(knoop).copied().unwrap_or([0.0; 6]);
            let theta = [x[3], x[4], x[5]];
            let draai = [theta[1] * d[2] - theta[2] * d[1], theta[2] * d[0] - theta[0] * d[2], theta[0] * d[1] - theta[1] * d[0]];
            for as_ in 0..3 { rest += (w[as_] - x[as_] - draai[as_]).powi(2); }
        }
        rest <= 1e-12 * totaal
    }

    /// De reacties van de blokkeringen in `results`, per beweging: arbeid van
    /// de belasting langs beweging k (met het teken van de reactie), en of
    /// die boven de afrondingsruis ligt.
    fn aangestoten(&self, input: &SolverInput3D, results: &AnalysisResults3D) -> Vec<(usize, f64)> {
        let grens = knoopdraaiing::RUIS * knoopdraaiing::schaal(input, results) + 1e-12;
        self.vast.iter().enumerate().filter_map(|(k, &(knoop, lokaal))| {
            let reactie = results.reactions.iter().find(|r| r.node_id == knoop)
                .map(|r| [r.fx, r.fy, r.fz, r.mx, r.my, r.mz][lokaal])
                .unwrap_or(0.0);
            let gewogen = if lokaal < 3 { reactie.abs() * self.lengte } else { reactie.abs() };
            (gewogen > grens).then_some((k, reactie))
        }).collect()
    }

    /// Zet de belasting (of, met `tweede_orde`, de tweede orde) kracht langs
    /// een vrije beweging? Dan is dat een fout die de beweging noemt.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn controleer(
        &self,
        context: &str,
        request: &SolveRequest3D,
        los: &crate::bedding::Los,
        staaf_van: &BTreeMap<usize, usize>,
        results: &AnalysisResults3D,
        tweede_orde: bool,
    ) -> Result<(), String> {
        let belast = self.aangestoten(&self.invoer, results);
        if belast.is_empty() { return Ok(()); }
        let mut aarden = Vec::new();
        let zinnen: Vec<String> = belast.iter().take(MAX_BESCHREVEN).map(|&(k, reactie)| {
            let (tekst, aard) = self.beeld(k, request, staaf_van);
            aarden.push(aard);
            let (knoop, lokaal) = self.vast[k];
            let eenheid = if lokaal < 3 { "kN" } else { "kNm" };
            let plek = if request.nodes.iter().any(|n| n.id == knoop) {
                format!("knoop {knoop}")
            } else {
                "een rekenknoop langs een staaf".to_string()
            };
            let soort = if lokaal < 3 { format!("in {}", ASSEN[lokaal]) } else { format!("om {}", ASSEN[lokaal - 3]) };
            format!("{tekst} (de kracht langs die beweging: {} {eenheid} {soort} in {plek})", getal(reactie.abs()))
        }).collect();
        let meer = match belast.len().saturating_sub(MAX_BESCHREVEN) {
            0 => String::new(),
            1 => " Daarnaast nog 1 beweging.".into(),
            over => format!(" Daarnaast nog {over} bewegingen."),
        };
        let wat = if tweede_orde {
            "de tweede-ordekrachten (P-Δ) stoten die beweging aan"
        } else {
            "de belasting stoot die beweging aan"
        };
        Err(format!(
            "{context}: het model is een mechanisme of onvoldoende opgelegd (singuliere stijfheidsmatrix), en {wat}. Vrije beweging: {}.{meer} Geen staaf, plaat of oplegging neemt die kracht op. {} Aanwijzing: {}. {}",
            zinnen.join("; "),
            opleggingen::bij_mechanisme(request, los),
            Self::aanwijzing(&aarden),
            crate::MECHANISME_UITLEG,
        ))
    }

    /// Maken de drukkrachten van de eerste-ordeoplossing een vrije beweging
    /// instabiel (een negatieve eigenwaarde van G = Mᵀ·K_G·M)? `input` is het
    /// kernmodel zonder deze blokkeringen. `false` zonder normaalkracht of
    /// bij een model met andere elementen dan staven.
    pub(crate) fn instabiel(&self, input: &SolverInput3D, results: &AnalysisResults3D) -> Result<bool, String> {
        let basis = self.orthonormaal(None);
        let Some((g, maat)) = tweede_orde::geometrisch_langs(input, results, &basis)? else { return Ok(false) };
        if !(maat > 0.0) || g.is_empty() { return Ok(false); }
        let (waarden, _) = eigen(g);
        Ok(waarden.iter().any(|w| *w < -GEOMETRISCH * maat))
    }

    /// De fout bij een tweede-ordeberekening als `instabiel`.
    pub(crate) fn fout_instabiel(
        &self,
        context: &str,
        request: &SolveRequest3D,
        los: &crate::bedding::Los,
        staaf_van: &BTreeMap<usize, usize>,
    ) -> String {
        let (zinnen, aarden) = self.beelden(request, staaf_van, &(0..self.vormen.len()).collect::<Vec<_>>());
        format!(
            "{context}: het model is een mechanisme dat de drukkrachten in de tweede orde aanstoten. Vrije beweging: {zinnen}. De belasting heeft langs die beweging geen component, maar de tangentiële stijfheid K + K_G is er niet positief definiet (knikfactor 0): elke scheefstand groeit onder de drukkracht, zoals bij een raam met scharnierende voeten dat zonder verband zijdelings of buiten zijn vlak kan omvallen. {} Aanwijzing: {}. {}",
            opleggingen::bij_mechanisme(request, los),
            Self::aanwijzing(&aarden),
            crate::MECHANISME_UITLEG,
        )
    }

    /// De bewegingen `welke` in zinnen, met hun aarden.
    fn beelden(&self, request: &SolveRequest3D, staaf_van: &BTreeMap<usize, usize>, welke: &[usize]) -> (String, Vec<Aard>) {
        let mut aarden = Vec::new();
        let mut zinnen: Vec<String> = welke.iter().take(MAX_BESCHREVEN).map(|&k| {
            let (tekst, aard) = self.beeld(k, request, staaf_van);
            aarden.push(aard);
            tekst
        }).collect();
        if welke.len() > 1 {
            zinnen = zinnen.into_iter().enumerate().map(|(i, zin)| format!("({}) {zin}", i + 1)).collect();
        }
        let mut tekst = zinnen.join("; ");
        match welke.len().saturating_sub(MAX_BESCHREVEN) {
            0 => {}
            1 => tekst.push_str("; en nog 1 beweging"),
            over => tekst.push_str(&format!("; en nog {over} bewegingen")),
        }
        (tekst, aarden)
    }

    /// Melding bij een uitkomst: de vrije bewegingen die de belasting niet
    /// aanstoot, tenzij de controle op de opleggingen (#64) dezelfde knopen al
    /// noemt. `instabiel`: de drukkrachten maken een beweging instabiel.
    pub(crate) fn melding(
        &self,
        request: &SolveRequest3D,
        los: &crate::bedding::Los,
        staaf_van: &BTreeMap<usize, usize>,
        instabiel: bool,
    ) -> Option<String> {
        let welke = self.niet_genoemd(request, los, staaf_van);
        if welke.is_empty() { return None; }
        let (zinnen, aarden) = self.beelden(request, staaf_van, &welke);
        let vrij = "zonder dat een staaf of plaat vervormt of een oplegging iets tegenhoudt";
        let (wat, langs, een) = if welke.len() == 1 {
            (format!("{zinnen} {vrij}"), "die beweging", "die beweging")
        } else {
            (format!("{} vrije bewegingen {vrij}: {zinnen}", welke.len()), "deze bewegingen", "een van deze bewegingen")
        };
        let zin = match (instabiel, welke.len()) {
            (false, _) => "",
            (true, 1) => " Onder de drukkrachten van deze belasting is die beweging bovendien instabiel (knikfactor 0): een tweede-ordeberekening geeft hier een fout.",
            (true, _) => " Onder de drukkrachten van deze belasting is minstens een van deze bewegingen bovendien instabiel (knikfactor 0): een tweede-ordeberekening geeft hier een fout.",
        };
        // Bij een instabiele beweging heeft een lineaire berekening ook geen
        // knikfactoren (knikfactor 0, zie `solve_fixed`).
        let knik = zin;
        Some(format!(
            "Mechanisme: {wat}. De belasting heeft langs {langs} geen component, dus er is een uitkomst; de verplaatsingen langs {langs} zijn onbepaald en de uitvoer geeft de kleinste verplaatsingen die bij deze krachten passen. Een belasting met een component langs {een} (ook een kleine horizontale last of een scheefstand) maakt het model onoplosbaar.{knik} Aanwijzing: {}.",
            Self::aanwijzing(&aarden),
        ))
    }

    /// Inproduct met draaiingen als L·θ.
    fn inproduct(&self, a: &Vorm6, b: &BTreeMap<usize, [f64; 6]>) -> f64 {
        let l2 = self.lengte * self.lengte;
        a.iter().filter_map(|(knoop, w)| b.get(knoop).map(|v| {
            (0..6).map(|c| if c < 3 { w[c] * v[c] } else { l2 * w[c] * v[c] }).sum::<f64>()
        })).sum()
    }

    /// Een orthonormale basis (draaiingen als L·θ) van de vrije bewegingen,
    /// eerst loodrecht op de vastgehouden knoopdraaiingen van #96.
    fn orthonormaal(&self, draaiing: Option<&Vastzetting>) -> Vec<Vorm6> {
        let mut uit: Vec<Vorm6> = Vec::new();
        for vorm in &self.vormen {
            let mut v = vorm.clone();
            if let Some(draaiing) = draaiing {
                for z in draaiing.draaivormen() {
                    let s: f64 = z.iter().filter_map(|(knoop, r)| v.get(knoop).map(|w| r[0] * w[3] + r[1] * w[4] + r[2] * w[5])).sum();
                    if s == 0.0 { continue; }
                    for (knoop, r) in z {
                        let w = v.entry(*knoop).or_insert([0.0; 6]);
                        for c in 0..3 { w[3 + c] -= s * r[c]; }
                    }
                }
            }
            let begin = self.inproduct(&v, &v).sqrt();
            if !(begin > 0.0) { continue; }
            for _ in 0..2 {
                for q in &uit {
                    let f = self.inproduct(&v, q);
                    for (knoop, w) in q {
                        let e = v.entry(*knoop).or_insert([0.0; 6]);
                        for c in 0..6 { e[c] -= f * w[c]; }
                    }
                }
            }
            let grootte = self.inproduct(&v, &v).sqrt();
            if grootte > 1e-8 * begin {
                for w in v.values_mut() { for x in w.iter_mut() { *x /= grootte; } }
                uit.push(v);
            }
        }
        uit
    }

    /// Haal de blokkeringen uit de uitkomst van de kern: geen reacties, en
    /// verplaatsingen zonder het deel langs de vrije bewegingen (de kleinste
    /// oplossing). Na `Vastzetting::ruim_op`.
    pub(crate) fn ruim_op(&self, results: &mut AnalysisResults3D, draaiing: &Vastzetting) {
        results.reactions.retain(|reactie| !self.nieuw.contains(&reactie.node_id));
        for &(knoop, lokaal) in &self.vast {
            for reactie in results.reactions.iter_mut().filter(|reactie| reactie.node_id == knoop) {
                match lokaal {
                    0 => reactie.fx = 0.0,
                    1 => reactie.fy = 0.0,
                    2 => reactie.fz = 0.0,
                    3 => reactie.mx = 0.0,
                    4 => reactie.my = 0.0,
                    _ => reactie.mz = 0.0,
                }
            }
        }
        let plaats: BTreeMap<usize, usize> = results.displacements.iter().enumerate().map(|(i, d)| (d.node_id, i)).collect();
        let lees = |results: &AnalysisResults3D, i: usize| {
            let d = &results.displacements[i];
            [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz]
        };
        for vorm in self.orthonormaal(Some(draaiing)) {
            let u: BTreeMap<usize, [f64; 6]> = vorm.keys()
                .filter_map(|knoop| plaats.get(knoop).map(|&i| (*knoop, lees(results, i))))
                .collect();
            let s = self.inproduct(&vorm, &u);
            if s == 0.0 { continue; }
            for (knoop, w) in &vorm {
                let Some(&i) = plaats.get(knoop) else { continue };
                let d = &mut results.displacements[i];
                d.ux -= s * w[0];
                d.uy -= s * w[1];
                d.uz -= s * w[2];
                d.rx -= s * w[3];
                d.ry -= s * w[4];
                d.rz -= s * w[5];
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Twee vrije richtingen van een matrix met een nulruimte van dimensie 2:
    /// diag(1, 0, 2) met een lege rij en een koppeling die (1, 1) vrij laat.
    #[test]
    fn nulruimte_van_een_kleine_matrix() {
        // K = [[1, -1, 0, 0], [-1, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 2]]
        let rijen = [0, 1, 1, 3];
        let kolommen = [0, 0, 1, 3];
        let waarden = [1.0, -1.0, 1.0, 2.0];
        let k = CscMatrix::from_triplets(4, &rijen, &kolommen, &waarden);
        let vormen = nulruimte(&k, None).unwrap();
        assert_eq!(vormen.len(), 2, "{vormen:?}");
        for v in &vormen {
            let kv = k.sym_mat_vec(v);
            assert!(norm(&kv) < 1e-9 * norm(v), "K·v = {kv:?} voor {v:?}");
            assert!(v[3].abs() < 1e-9 * norm(v), "{v:?}");
        }
    }

    #[test]
    fn inverse_van_een_kleine_matrix() {
        let a = vec![vec![0.0, 2.0], vec![4.0, 1.0]];
        let b = inverse(a.clone()).unwrap();
        for i in 0..2 {
            for j in 0..2 {
                let som: f64 = (0..2).map(|k| a[i][k] * b[k][j]).sum();
                assert!((som - if i == j { 1.0 } else { 0.0 }).abs() < 1e-14);
            }
        }
    }
}
