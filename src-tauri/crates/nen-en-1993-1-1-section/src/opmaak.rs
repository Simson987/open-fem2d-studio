//! Opmaakhulpjes voor de afleidingen (deelstappen) van de doorsnedetoetsen in
//! deze crate. Dezelfde schrijfwijze als `nen_en_1993_1_1_stability::opmaak`
//! en de kipketen: de Nederlandse decimaalkomma als `{,}` in LaTeX. Die module
//! kan hier niet gebruikt worden — de stabiliteitscrate hangt van deze af, niet
//! andersom — dus staan de paar regels hier opnieuw.

use crate::{Deelstap, NamedValue};

/// Een getal in LaTeX-mathmodus met de Nederlandse decimaalkomma; een
/// decimaaldeel dat helemaal nul is valt weg.
pub(crate) fn lx(v: f64, decimalen: usize) -> String {
    if !v.is_finite() {
        return r"\text{n.v.t.}".to_string();
    }
    let mut s = format!("{v:.decimalen$}");
    if let Some((geheel, fractie)) = s.split_once('.') {
        if fractie.chars().all(|c| c == '0') {
            s = geheel.to_string();
        }
    }
    if s.trim_start_matches('-').chars().all(|c| c == '0' || c == '.') {
        s = s.trim_start_matches('-').to_string();
    }
    s.replace('.', "{,}")
}

/// Een getal als platte tekst met decimaalkomma, voor kanttekeningen.
pub(crate) fn nl(v: f64, decimalen: usize) -> String {
    if !v.is_finite() {
        return "n.v.t.".to_string();
    }
    format!("{v:.decimalen$}").replace('.', ",")
}

pub(crate) fn nv(symbol: &str, value: f64, unit: &str) -> NamedValue {
    NamedValue { symbol: symbol.to_string(), value, unit: unit.to_string() }
}

/// Eén deelstap; alle velden expliciet, zodat er geen stap zonder vindplaats
/// kan ontstaan. `ingevuld_latex` is de formule met getallen ZONDER de
/// uitkomst erachter — de weergave zet "symbool = uitkomst" er zelf bij.
#[allow(clippy::too_many_arguments)]
pub(crate) fn stap(
    id: &str,
    titel: &str,
    symbol: &str,
    article: &str,
    formula_latex: String,
    ingevuld_latex: String,
    variables: Vec<NamedValue>,
    value: Option<f64>,
    unit: &str,
    notes: Vec<String>,
) -> Deelstap {
    Deelstap {
        id: id.to_string(),
        titel: titel.to_string(),
        symbol: symbol.to_string(),
        article: article.to_string(),
        formula_latex,
        ingevuld_latex,
        variables,
        value,
        unit: unit.to_string(),
        notes,
    }
}
