//! LaTeX uit de rekenkernen als LEESBARE tekst voor de PDF (issue #227).
//!
//! De kernen leveren hun formules als LaTeX (`formula_latex`,
//! `ingevuld_latex`), omdat het live rapport ze met KaTeX zet. De PDF heeft
//! geen formulezetter; tot deze correctie stond de LaTeX er letterlijk in
//! (`\frac{\sigma_{m,y,d}}{f_{m,y,d}} + k_m …`), wat een rapport niet
//! indienbaar maakt. Deze module schrijft de formule uit in gewone tekst met
//! Griekse letters en wiskundige tekens uit Unicode:
//!
//! ```text
//! \frac{\sigma_{m,y,d}}{f_{m,y,d}} + k_m \cdot \frac{\sigma_{m,z,d}}{f_{m,z,d}} \leq 1
//!   → σ_m,y,d / f_m,y,d + k_m · σ_m,z,d / f_m,z,d ≤ 1
//! ```
//!
//! Het is een vertaling voor de lezer, geen formulezetter: breuken worden
//! `teller / noemer` (met haakjes waar de teller of noemer uit meer dan één
//! term bestaat), indices blijven achter een liggend streepje, en een
//! onbekend commando verliest alleen zijn backslash. Er wordt niets
//! uitgerekend en geen getal veranderd.

/// Griekse letters en tekens; een commando dat hier niet staat, verliest
/// alleen zijn backslash.
fn symbool(naam: &str) -> Option<&'static str> {
    Some(match naam {
        "alpha" => "α", "beta" => "β", "gamma" => "γ", "Gamma" => "Γ",
        "delta" => "δ", "Delta" => "Δ", "epsilon" | "varepsilon" => "ε",
        "zeta" => "ζ", "eta" => "η", "theta" | "vartheta" => "θ", "Theta" => "Θ",
        "iota" => "ι", "kappa" => "κ", "lambda" => "λ", "Lambda" => "Λ",
        "mu" => "μ", "nu" => "ν", "xi" => "ξ", "pi" => "π", "Pi" => "Π",
        "rho" => "ρ", "sigma" => "σ", "Sigma" | "sum" => "Σ", "tau" => "τ",
        "phi" | "varphi" => "φ", "Phi" => "Φ", "chi" => "χ", "psi" => "ψ",
        "Psi" => "Ψ", "omega" => "ω", "Omega" => "Ω",
        "cdot" => "·", "times" => "×", "div" => "/",
        "leq" | "le" | "leqslant" => "≤", "geq" | "ge" | "geqslant" => "≥",
        "neq" | "ne" => "≠", "approx" => "≈", "pm" => "±", "infty" => "∞",
        "rightarrow" | "to" | "Rightarrow" => "→", "partial" => "∂",
        "lvert" | "rvert" | "vert" | "mid" => "|", "%" => "%",
        "," | ";" | ":" | "quad" | "qquad" | " " => " ", "!" => "",
        "left" | "right" | "big" | "Big" | "bigg" | "Bigg" | "displaystyle" => "",
        "{" => "{", "}" => "}", "_" => "_", "&" => "&", "#" => "#",
        _ => return None,
    })
}

/// Commando's met één argument waarvan alleen de inhoud telt.
fn is_omhulsel(naam: &str) -> bool {
    matches!(
        naam,
        "text" | "mathrm" | "mathit" | "mathbf" | "textrm" | "textit" | "textbf"
            | "operatorname" | "mbox" | "boldsymbol" | "mathsf" | "hat" | "tilde"
            | "vec" | "underline" | "overline"
    )
}

struct Lezer<'a> {
    tekens: Vec<char>,
    pos: usize,
    _bron: &'a str,
}

impl<'a> Lezer<'a> {
    fn nieuw(bron: &'a str) -> Self {
        Self { tekens: bron.chars().collect(), pos: 0, _bron: bron }
    }

    fn kijk(&self) -> Option<char> {
        self.tekens.get(self.pos).copied()
    }

    fn sla_spaties_over(&mut self) {
        while self.kijk().is_some_and(char::is_whitespace) {
            self.pos += 1;
        }
    }

    /// Eén argument: `{…}` als groep, anders één teken of één commando.
    fn argument(&mut self) -> String {
        self.sla_spaties_over();
        match self.kijk() {
            Some('{') => {
                self.pos += 1;
                self.tot('}')
            }
            Some('\\') => {
                let mut uit = String::new();
                self.commando(&mut uit);
                uit
            }
            Some(c) => {
                self.pos += 1;
                c.to_string()
            }
            None => String::new(),
        }
    }

    /// Optioneel argument `[…]`.
    fn optioneel(&mut self) -> Option<String> {
        if self.kijk() == Some('[') {
            self.pos += 1;
            Some(self.tot(']'))
        } else {
            None
        }
    }

    /// Lees en vertaal tot het afsluitende teken (dat wordt overgeslagen).
    fn tot(&mut self, eind: char) -> String {
        let mut uit = String::new();
        while let Some(c) = self.kijk() {
            if c == eind {
                self.pos += 1;
                break;
            }
            self.stap(&mut uit);
        }
        uit
    }

    fn commando(&mut self, uit: &mut String) {
        // `self.kijk()` is de backslash.
        self.pos += 1;
        let start = self.pos;
        while self.kijk().is_some_and(|c| c.is_ascii_alphabetic()) {
            self.pos += 1;
        }
        let naam: String = if self.pos == start {
            // Eén leesteken na de backslash: `\,` `\{` `\%` …
            match self.kijk() {
                Some(c) => {
                    self.pos += 1;
                    c.to_string()
                }
                None => return,
            }
        } else {
            self.tekens[start..self.pos].iter().collect()
        };
        match naam.as_str() {
            "frac" | "dfrac" | "tfrac" => {
                let teller = self.argument();
                let noemer = self.argument();
                uit.push_str(&format!("{} / {}", haakjes(&teller), haakjes(&noemer)));
            }
            "sqrt" => {
                let graad = self.optioneel();
                let onder = self.argument();
                if let Some(g) = graad {
                    uit.push_str(&format!("{g}√({})", onder.trim()));
                } else {
                    uit.push_str(&format!("√({})", onder.trim()));
                }
            }
            "bar" => {
                let inhoud = self.argument();
                uit.push_str(inhoud.trim());
                // De streep als combinerend macron (U+0304, wel in Liberation
                // Sans): λ̄ zoals in de normtekst.
                uit.push('\u{0304}');
            }
            "max" | "min" | "sin" | "cos" | "tan" | "ln" | "log" | "exp" => uit.push_str(&naam),
            n if is_omhulsel(n) => {
                let inhoud = self.argument();
                uit.push_str(&inhoud);
            }
            n => match symbool(n) {
                Some(s) => uit.push_str(s),
                None => uit.push_str(n),
            },
        }
    }

    fn stap(&mut self, uit: &mut String) {
        let Some(c) = self.kijk() else { return };
        match c {
            '\\' => self.commando(uit),
            '{' => {
                self.pos += 1;
                let binnen = self.tot('}');
                uit.push_str(&binnen);
            }
            '}' => self.pos += 1,
            '$' => self.pos += 1,
            '_' => {
                self.pos += 1;
                let index = self.argument();
                uit.push('_');
                uit.push_str(index.trim());
            }
            '^' => {
                self.pos += 1;
                let macht = self.argument();
                uit.push_str(&superscript(macht.trim()));
            }
            '~' => {
                self.pos += 1;
                uit.push(' ');
            }
            _ => {
                self.pos += 1;
                uit.push(c);
            }
        }
    }
}

/// Een macht als superscript waar het lettertype dat kan (¹, ², ³ staan in
/// Latin-1; ⁰, ⁶, ⁹ en ⁻ ontbreken in Liberation Sans), anders `^…`.
fn superscript(macht: &str) -> String {
    match macht {
        "1" => "¹".into(),
        "2" => "²".into(),
        "3" => "³".into(),
        _ if macht.chars().count() == 1 => format!("^{macht}"),
        _ => format!("^({macht})"),
    }
}

/// Haakjes om een teller of noemer die uit meer dan één term bestaat.
fn haakjes(deel: &str) -> String {
    let d = deel.trim();
    let samengesteld = d.contains(['+', ' ', '−', '/']) || d.chars().skip(1).any(|c| c == '-');
    if samengesteld && !(d.starts_with('(') && d.ends_with(')')) {
        format!("({d})")
    } else {
        d.to_owned()
    }
}

/// LaTeX → leesbare tekst. Tekst zonder backslash, accolade, `_` of `^` komt
/// ongewijzigd terug.
pub fn latex_naar_tekst(bron: &str) -> String {
    if !bron.contains(['\\', '{', '}', '_', '^', '$']) {
        return bron.to_owned();
    }
    let mut lezer = Lezer::nieuw(bron);
    let mut uit = String::new();
    while lezer.kijk().is_some() {
        lezer.stap(&mut uit);
    }
    // Dubbele spaties die door `\,`, `\left` en dergelijke ontstaan.
    let mut schoon = String::with_capacity(uit.len());
    let mut vorige_spatie = false;
    for c in uit.chars() {
        let spatie = c == ' ';
        if !(spatie && vorige_spatie) {
            schoon.push(c);
        }
        vorige_spatie = spatie;
    }
    schoon.trim().to_owned()
}

#[cfg(test)]
mod tests {
    use super::latex_naar_tekst as t;

    /// De twee formules uit issue #227, letterlijk.
    #[test]
    fn de_formules_uit_het_issue_worden_leesbaar() {
        assert_eq!(
            t(r"\frac{\sigma_{m,y,d}}{f_{m,y,d}} + k_m \cdot \frac{\sigma_{m,z,d}}{f_{m,z,d}} \leq 1"),
            "σ_m,y,d / f_m,y,d + k_m · σ_m,z,d / f_m,z,d ≤ 1"
        );
        assert_eq!(
            t(r"\tau_d = \frac{V_{z,Ed} \cdot S_y}{I_y \cdot b_{ef}}"),
            "τ_d = (V_z,Ed · S_y) / (I_y · b_ef)"
        );
    }

    #[test]
    fn wortel_macht_en_tekst() {
        assert_eq!(t(r"\sqrt{\frac{A f_y}{N_{cr}}}"), "√((A f_y) / N_cr)");
        assert_eq!(t(r"W_{pl} = b h^2 / 4"), "W_pl = b h² / 4");
        assert_eq!(t(r"\text{max}(a, b)"), "max(a, b)");
        assert_eq!(t(r"\left( 1 - \frac{N}{N_{cr}} \right)^{-1}"), "( 1 - N / N_cr )^(-1)");
    }

    #[test]
    fn gewone_tekst_blijft_ongewijzigd() {
        assert_eq!(t("UC = 0,642"), "UC = 0,642");
        assert_eq!(t("w_fin"), "w_fin");
    }

    #[test]
    fn er_blijft_geen_latex_over() {
        for f in [
            r"\frac{\sigma_{c,0,d}}{k_{c,y} f_{c,0,d}} + \frac{\sigma_{m,y,d}}{f_{m,y,d}} \le 1",
            r"\bar{\lambda} = \sqrt{\frac{W_y f_y}{M_{cr}}}",
            r"\chi_{LT} = \frac{1}{\Phi_{LT} + \sqrt{\Phi_{LT}^2 - \beta \bar{\lambda}_{LT}^2}}",
        ] {
            let uit = t(f);
            assert!(!uit.contains(['\\', '{', '}']), "{f} → {uit}");
        }
    }
}
