//! Tekens die het lettertype niet heeft.
//!
//! Het rapport schrijft eenheden en symbolen met Unicode-super- en
//! subschrift: "10⁻³", "mm⁶", "k₂", "ρ₀". Liberation Sans heeft daarvan alleen
//! ¹ ² ³ ⁴ ⁵ ⁷ ⁸; ⁰ ⁶ ⁹ ⁺ ⁻ en elk subschriftcijfer ontbreken. Een ontbrekend
//! teken komt in de PDF als leeg vakje of helemaal niet — "10⁻³" werd zo
//! "10³", een factor 10⁶ verkeerd.
//!
//! Deze module deelt een tekst op in stukken met een POSITIE: gewoon,
//! superschrift of subschrift. Een reeks super- of subschrifttekens waarin
//! het lettertype ook maar één teken mist, wordt als geheel gezet met de
//! gewone cijfers en tekens van het lettertype, kleiner en verhoogd of
//! verlaagd — dan staan "⁻³" en "³" in één reeks er gelijk uit. Een reeks die
//! het lettertype volledig heeft ("mm²") blijft ongemoeid. Een paar andere
//! tekens krijgen een vervanging die het lettertype wel heeft ("⇒" → "=>",
//! "⌀" → "Ø").
//!
//! De breedte (`FontRegistry::text_width`) en het tekenen
//! (`DocTemplate::render_draw_list`) gebruiken beide deze opdeling, zodat de
//! regelafbreking en het centreren kloppen met wat er werkelijk komt te staan.

/// Waar een stuk tekst staat.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Positie {
    Gewoon,
    Boven,
    Onder,
}

/// Korpsgrootte van gezet super- en subschrift, als fractie van de gewone.
pub const SCHAAL: f32 = 0.65;
/// Verhoging van superschrift, als fractie van de gewone korpsgrootte.
pub const STIJGING_BOVEN: f32 = 0.33;
/// Verlaging van subschrift (negatief), als fractie van de korpsgrootte.
pub const DALING_ONDER: f32 = -0.12;

/// Het gewone teken bij een superschriftteken.
pub fn superschrift(c: char) -> Option<char> {
    Some(match c {
        '⁰' => '0',
        '¹' => '1',
        '²' => '2',
        '³' => '3',
        '⁴' => '4',
        '⁵' => '5',
        '⁶' => '6',
        '⁷' => '7',
        '⁸' => '8',
        '⁹' => '9',
        '⁺' => '+',
        '⁻' => '-',
        '⁼' => '=',
        '⁽' => '(',
        '⁾' => ')',
        'ⁿ' => 'n',
        'ⁱ' => 'i',
        _ => return None,
    })
}

/// Het gewone teken bij een subschriftteken.
pub fn subschrift(c: char) -> Option<char> {
    Some(match c {
        '₀' => '0',
        '₁' => '1',
        '₂' => '2',
        '₃' => '3',
        '₄' => '4',
        '₅' => '5',
        '₆' => '6',
        '₇' => '7',
        '₈' => '8',
        '₉' => '9',
        '₊' => '+',
        '₋' => '-',
        '₌' => '=',
        '₍' => '(',
        '₎' => ')',
        'ₐ' => 'a',
        'ₑ' => 'e',
        'ₒ' => 'o',
        'ₓ' => 'x',
        'ₕ' => 'h',
        'ₖ' => 'k',
        'ₗ' => 'l',
        'ₘ' => 'm',
        'ₙ' => 'n',
        'ₚ' => 'p',
        'ₛ' => 's',
        'ₜ' => 't',
        'ᵢ' => 'i',
        'ⱼ' => 'j',
        'ᵣ' => 'r',
        'ᵤ' => 'u',
        'ᵥ' => 'v',
        _ => return None,
    })
}

/// Een vervanging voor een teken buiten het super- en subschrift dat het
/// lettertype niet heeft.
pub fn vervanging(c: char) -> Option<&'static str> {
    Some(match c {
        '⇒' => "=>",
        '⇐' => "<=",
        '⇔' => "<=>",
        '∅' | '⌀' => "Ø",
        '∬' => "∫∫",
        _ => return None,
    })
}

/// Deelt `tekst` op in stukken met één positie. `heeft` zegt of het
/// lettertype een teken heeft. Aangrenzende gewone stukken worden samengevoegd.
pub fn tekstruns(tekst: &str, mut heeft: impl FnMut(char) -> bool) -> Vec<(Positie, String)> {
    let mut uit: Vec<(Positie, String)> = Vec::new();
    let mut voeg = |uit: &mut Vec<(Positie, String)>, pos: Positie, s: &str| {
        if s.is_empty() {
            return;
        }
        match uit.last_mut() {
            Some((p, t)) if *p == pos && pos == Positie::Gewoon => t.push_str(s),
            _ => uit.push((pos, s.to_string())),
        }
    };
    let tekens: Vec<char> = tekst.chars().collect();
    let mut i = 0;
    while i < tekens.len() {
        let c = tekens[i];
        let reeks_soort: Option<(Positie, fn(char) -> Option<char>)> = if superschrift(c).is_some() {
            Some((Positie::Boven, superschrift))
        } else if subschrift(c).is_some() {
            Some((Positie::Onder, subschrift))
        } else {
            None
        };
        match reeks_soort {
            // Een reeks super- of subschrift, als geheel.
            Some((soort, omzetting)) => {
                let mut j = i;
                while j < tekens.len() && omzetting(tekens[j]).is_some() {
                    j += 1;
                }
                let reeks = &tekens[i..j];
                if reeks.iter().all(|&t| heeft(t)) {
                    let s: String = reeks.iter().collect();
                    voeg(&mut uit, Positie::Gewoon, &s);
                } else {
                    let s: String = reeks.iter().filter_map(|&t| omzetting(t)).collect();
                    voeg(&mut uit, soort, &s);
                }
                i = j;
            }
            None => {
                let mut buf = [0u8; 4];
                if heeft(c) {
                    voeg(&mut uit, Positie::Gewoon, c.encode_utf8(&mut buf));
                } else if let Some(v) = vervanging(c) {
                    voeg(&mut uit, Positie::Gewoon, v);
                } else {
                    // Geen uitweg bekend: het teken blijft staan, zoals voorheen.
                    voeg(&mut uit, Positie::Gewoon, c.encode_utf8(&mut buf));
                }
                i += 1;
            }
        }
    }
    uit
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Het lettertype van het rapport: Liberation Sans, met ¹²³⁴⁵⁷⁸ maar
    /// zonder ⁰⁶⁹⁺⁻ en zonder subschrift.
    fn liberation(c: char) -> bool {
        !matches!(c, '⁰' | '⁶' | '⁹' | '⁺' | '⁻' | '⁼' | '⁽' | '⁾' | '⇒' | '∅' | '⌀')
            && subschrift(c).is_none()
    }

    fn g(s: &str) -> (Positie, String) {
        (Positie::Gewoon, s.to_string())
    }

    #[test]
    fn min_drie_wordt_als_geheel_verhoogd() {
        assert_eq!(
            tekstruns("10⁻³/m", liberation),
            vec![g("10"), (Positie::Boven, "-3".to_string()), g("/m")]
        );
    }

    #[test]
    fn een_reeks_die_het_lettertype_heeft_blijft_staan() {
        assert_eq!(tekstruns("A = 800 mm²", liberation), vec![g("A = 800 mm²")]);
        assert_eq!(tekstruns("mm⁶", liberation), vec![g("mm"), (Positie::Boven, "6".to_string())]);
    }

    #[test]
    fn subschrift_wordt_verlaagd() {
        assert_eq!(
            tekstruns("k₂ = 0,9", liberation),
            vec![g("k"), (Positie::Onder, "2".to_string()), g(" = 0,9")]
        );
        assert_eq!(
            tekstruns("ρ₀", liberation),
            vec![g("ρ"), (Positie::Onder, "0".to_string())]
        );
    }

    #[test]
    fn vervangingen_en_onbekende_tekens() {
        assert_eq!(tekstruns("a ⇒ b, ⌀24", liberation), vec![g("a => b, Ø24")]);
        // Een teken zonder uitweg blijft staan.
        assert_eq!(tekstruns("x", |_| false), vec![g("x")]);
    }
}
