//! Welke knoop en welke vrijheidsgraad vormen het mechanisme? (issue #243, punt 081)
//!
//! Een singuliere stijfheidsmatrix of een te groot solverresidu gaf alleen
//! algemene adviezen ("controleer per verbonden modeldeel de translatie- en
//! rotatieblokkeringen"). Bij een intern mechanisme — een staaf met de torsie
//! vrijgegeven, een scharnierketting — vindt de controle op de opleggingen
//! (`opleggingen`) niets, want het model als geheel is vastgehouden. Hier
//! wordt de nulvorm van K bepaald (`tweede_orde::nulvorm`) en beschreven:
//! welke knopen bewegen, om of langs welke as, en welke vrijgegeven
//! staafeinden op die knopen zitten.

use rekenkern::types::SolverInput3D;

use crate::{tweede_orde, Member3D, SolveRequest3D};

/// Zoveel knopen noemt de melding hooguit.
const MAX_KNOPEN: usize = 4;

fn lengte(v: [f64; 3]) -> f64 { (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt() }

fn as_naam(v: [f64; 3]) -> Option<&'static str> {
    let l = lengte(v);
    if !(l > 0.0) { return None; }
    ["x", "y", "z"].into_iter().zip(v).find(|(_, c)| (c / l).abs() > 0.99).map(|(n, _)| n)
}

fn staafas(request: &SolveRequest3D, staaf: &Member3D) -> Option<[f64; 3]> {
    let knoop = |id| request.nodes.iter().find(|n| n.id == id);
    let (a, b) = (knoop(staaf.start_node_id)?, knoop(staaf.end_node_id)?);
    let d = [b.x - a.x, b.y - a.y, b.z - a.z];
    let l = lengte(d);
    (l > 0.0).then(|| [d[0] / l, d[1] / l, d[2] / l])
}

/// De beschrijving van het mechanisme, of `None` als er geen nulvorm te
/// bepalen is (regulier, te groot, of alleen adapterknopen).
pub(crate) fn beschrijf(request: &SolveRequest3D, input: &SolverInput3D) -> Option<String> {
    let vorm = tweede_orde::nulvorm(input)?;
    // Draaiingen en verschuivingen vergelijkbaar maken: een draaiing maal de
    // modelafmeting is de verschuiving die zij over het model geeft.
    let (mut laag, mut hoog) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for n in &request.nodes {
        for (i, c) in [n.x, n.y, n.z].into_iter().enumerate() {
            laag[i] = laag[i].min(c);
            hoog[i] = hoog[i].max(c);
        }
    }
    let modelmaat = lengte([hoog[0] - laag[0], hoog[1] - laag[1], hoog[2] - laag[2]]).max(1.0);
    let mut per_knoop: Vec<(usize, [f64; 3], [f64; 3])> = request.nodes.iter().map(|n| {
        let mut t = [0.0; 3];
        let mut r = [0.0; 3];
        for &(knoop, lokaal, waarde) in &vorm {
            if knoop != n.id { continue; }
            if lokaal < 3 { t[lokaal] = waarde } else if lokaal < 6 { r[lokaal - 3] = waarde }
        }
        (n.id, t, r)
    }).collect();
    let maat = |t: [f64; 3], r: [f64; 3]| lengte(t).max(lengte(r) * modelmaat);
    let grootste = per_knoop.iter().map(|&(_, t, r)| maat(t, r)).fold(0.0, f64::max);
    if !(grootste > 0.0) { return None; }
    per_knoop.retain(|&(_, t, r)| maat(t, r) >= 0.5 * grootste);
    per_knoop.sort_by(|a, b| maat(b.1, b.2).total_cmp(&maat(a.1, a.2)).then(a.0.cmp(&b.0)));
    per_knoop.truncate(MAX_KNOPEN);

    let aan = |s: &Member3D, knoop: usize| s.start_node_id == knoop || s.end_node_id == knoop;
    let mut delen: Vec<String> = Vec::new();
    for &(knoop, t, r) in &per_knoop {
        let mut wat: Vec<String> = Vec::new();
        if lengte(r) * modelmaat >= 0.5 * grootste {
            let as_staaf = request.members.iter().filter(|s| aan(s, knoop)).find(|s| {
                staafas(request, s).is_some_and(|e| {
                    let d = (e[0] * r[0] + e[1] * r[1] + e[2] * r[2]) / lengte(r);
                    d.abs() > 0.99
                })
            });
            wat.push(match (as_staaf, as_naam(r)) {
                (Some(s), _) => format!("draait om de staafas van staaf {}", s.id),
                (None, Some(a)) => format!("draait om de globale {a}-as"),
                (None, None) => "draait om een schuine as".to_string(),
            });
        }
        if lengte(t) >= 0.5 * grootste {
            wat.push(match as_naam(t) {
                Some(a) => format!("verschuift in {a}"),
                None => "verschuift schuin".to_string(),
            });
        }
        delen.push(format!("knoop {knoop} {}", wat.join(" en ")));
    }
    let knopen: Vec<usize> = per_knoop.iter().map(|k| k.0).collect();
    let mut releases: Vec<String> = Vec::new();
    for s in &request.members {
        for (knoop, begin) in [(s.start_node_id, true), (s.end_node_id, false)] {
            if !knopen.contains(&knoop) { continue; }
            let r = &s.releases;
            let (t, my, mz) = if begin {
                (r.torsion_start, r.my_start, r.mz_start)
            } else {
                (r.torsion_end, r.my_end, r.mz_end)
            };
            let mut vrij: Vec<&str> = Vec::new();
            if t { vrij.push(if begin { "torsie om de staafas (torsionStart)" } else { "torsie om de staafas (torsionEnd)" }); }
            if my { vrij.push(if begin { "M_y (myStart)" } else { "M_y (myEnd)" }); }
            if mz { vrij.push(if begin { "M_z (mzStart)" } else { "M_z (mzEnd)" }); }
            if !vrij.is_empty() {
                releases.push(format!("staaf {} aan knoop {knoop}: {}", s.id, vrij.join(", ")));
            }
        }
    }
    let mut tekst = format!(
        "Mechanisme gevonden in de stijfheidsmatrix: {} — zonder vervorming.",
        delen.join("; ")
    );
    if releases.is_empty() {
        tekst.push_str(
            " Op deze knopen is geen staafeinde vrijgegeven; controleer de opleggingen en of de staven daar werkelijk verbonden zijn.",
        );
    } else {
        tekst.push_str(&format!(
            " Vrijgegeven staafeinden op deze knopen: {}. Maak een van die einden star of houd de beweging met een oplegging of veer tegen.",
            releases.join("; ")
        ));
    }
    Some(tekst)
}

/// `fout` met de beschrijving van het mechanisme erachter, als die te
/// bepalen is; anders ongewijzigd.
pub(crate) fn aanvullen(request: &SolveRequest3D, input: &SolverInput3D, fout: String) -> String {
    match beschrijf(request, input) {
        Some(tekst) => {
            let fout = fout.trim_end();
            let punt = if fout.ends_with(['.', '!', '?']) { "" } else { "." };
            format!("{fout}{punt} {tekst}")
        }
        None => fout,
    }
}
