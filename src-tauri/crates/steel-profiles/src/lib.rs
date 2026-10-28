//! Steel profile database — single source of truth shared with TS frontend.
//! JSON loaded at compile-time via include_str!, parsed once via OnceLock.

use section_properties::SectionProperties;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use ts_rs::TS;

const PROFILES_JSON: &str = include_str!("../data/profiles.json");

/// De doorsnedesoorten in de catalogus.
///
/// `Angle` is de hoeklijn (EN 10056-1), gelijk- of ongelijkbenig. Hij staat
/// hier apart en niet onder `ISection` omdat er niets van de I-regels op hem
/// van toepassing is: NEN-EN 1993-1-1 tabel 5.2 heeft er een eigen blad voor
/// (blad 3 van 3), par. 1.7(2) legt de assen anders, en de y-y- en z-z-as zijn
/// geen hoofdassen. Wie hem als I-profiel zou meenemen, rekent stilzwijgend
/// met de verkeerde regels.
///
/// `RoundBar` is massief rond staal, de reeks "RD <d>" met `d` de diameter in
/// mm (EN 10060). Ook deze soort staat apart, want er geldt niets van de
/// plaatregels op: tabel 5.2 classificeert plaatdelen, en een massieve ronde
/// doorsnede heeft er geen. Ze is rotatiesymmetrisch (I_y = I_z, W om elke as
/// gelijk), heeft knikkromme c (tabel 6.2, "massieve doorsneden") en kipt
/// niet. De grootheden zijn gesloten formules van `d`; zie
/// `scripts/genereer-rondstaal.mjs`.
///
/// `FlatBar` is platstaal (strip), de reeks "Strip <b>x<t>" met `b` de
/// breedte en `t` de dikte in mm, b ≥ 2t. Een massieve rechthoek, dus ook hier
/// geen plaatdelen met een gesteunde rand. De STAND ligt vast: de breedte b
/// loopt langs de lokale z-as en de dikte t langs de lokale y-as, zodat
/// I_y = t·b³/12 de sterke as is — net als bij elk ander catalogusprofiel, en
/// net als een rechthoek "t×b" (breedte × hoogte) in de rest van de app. In de
/// maten staat daarom h = b (de breedte van de strip) en b = t_w = t_f = t (de
/// dikte); de dikte is de maat voor tabel 3.1. Knikkromme c om beide assen
/// (tabel 6.2, massieve doorsneden). Zie `scripts/genereer-strip.mjs`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/steel/")]
pub enum ProfileKind {
    ISection,
    Channel,
    Rhs,
    Shs,
    Chs,
    Angle,
    RoundBar,
    FlatBar,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/steel/")]
pub struct ProfileGeometry {
    pub h: f64,
    pub b: f64,
    #[serde(default)]
    pub tw: f64,
    #[serde(default)]
    pub tf: f64,
    #[serde(default)]
    pub t: f64,
    #[serde(default)]
    pub r: f64,
    /// Tweede afrondingsstraal, in mm. Alleen de hoeklijn heeft er twee: `r`
    /// is de walsuitronding in de holle hoek tussen de benen en `r2` de
    /// teenafronding aan het eind van elk been. Beide staan in de maattabel.
    /// Voor elke andere soort blijft dit veld nul, en dat is ook precies wat
    /// de bestaande regels in `profiles.json` opleveren — ze noemen het niet.
    #[serde(default)]
    pub r2: f64,
    /// Flenshelling als verhouding (0,08 voor UNP volgens DIN 1026-1, 0,14
    /// voor INP volgens DIN 1025-1); 0 voor evenwijdige flenzen. Staat al in
    /// `profiles.json` bij die reeksen en beslist welke contour de
    /// doorsnedemotor bouwt; wie hem negeert rekent een INP als I met
    /// evenwijdige flenzen en zit 19 % naast I_z.
    #[serde(default)]
    pub flange_slope: f64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/steel/")]
pub struct BucklingCurves {
    pub y_axis: char,
    pub z_axis: char,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/steel/")]
pub struct SteelProfile {
    pub name: String,
    pub kind: ProfileKind,
    pub geometry: ProfileGeometry,
    pub properties: SectionProperties,
    pub buckling_curves: BucklingCurves,
}

pub struct SteelProfileDb {
    profiles: Vec<SteelProfile>,
    by_name: HashMap<String, usize>,
    by_key: HashMap<String, usize>,
    /// Sleutel na [`zonder_nul_decimalen`]: "CHS 168.3x8.0" staat hier als
    /// "CHS1683X8", zodat "CHS 168.3x8" en "CHS168.3x8" hem vinden (#240).
    by_nul_key: HashMap<String, usize>,
}

/// Zoeksleutel voor een profielnaam: spaties, koppeltekens en punten eruit,
/// alles naar hoofdletters. Zo vindt "HEA 320" hetzelfde profiel als "HEA320"
/// of "hea-320". De database schrijft de namen met spatie, maar de frontend en
/// externe aanroepers doen dat niet altijd.
///
/// Massief rond staat in de database als "RD 24", maar wordt in de praktijk
/// ook als "Ø24", "Ø 24" of "ROND 24" geschreven. Die schrijfwijzen krijgen
/// hier de sleutel van "RD 24"; zie [`rond_staal_sleutel`]. De frontend heeft
/// dezelfde regel in `design-mockup/src/lib/rondStaal.ts`.
///
/// Deze sleutel is ook de vorm waarin de app een catalogusprofiel op een staaf
/// zet ("CHS1683X80" voor "CHS 168.3x8.0"); hij blijft daarom ongewijzigd.
/// Voor schrijfwijzen zonder nul-decimalen ("CHS 168.3x8") is er de tweede
/// index in [`SteelProfileDb::find`].
fn lookup_key(name: &str) -> String {
    let sleutel: String = name
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '.')
        .flat_map(|c| c.to_uppercase())
        .collect();
    rond_staal_sleutel(&sleutel)
        .or_else(|| strip_sleutel(&sleutel))
        .unwrap_or(sleutel)
}

/// Haalt de nullen aan het eind van elk decimaal getal weg, en de punt als er
/// dan niets achter staat: "8.0" → "8", "8.00" → "8", "6.30" → "6.3"; "10.05"
/// en "100" blijven gelijk.
pub fn zonder_nul_decimalen(naam: &str) -> String {
    let c: Vec<char> = naam.chars().collect();
    let mut uit = String::with_capacity(naam.len());
    let mut i = 0;
    while i < c.len() {
        let na_cijfer = i > 0 && c[i - 1].is_ascii_digit();
        if c[i] == '.' && na_cijfer && i + 1 < c.len() && c[i + 1].is_ascii_digit() {
            let mut j = i + 1;
            while j < c.len() && c[j].is_ascii_digit() {
                j += 1;
            }
            let fractie: String = c[i + 1..j].iter().collect();
            let fractie = fractie.trim_end_matches('0');
            if !fractie.is_empty() {
                uit.push('.');
                uit.push_str(fractie);
            }
            i = j;
        } else {
            uit.push(c[i]);
            i += 1;
        }
    }
    uit
}

/// De voorvoegsels waarmee massief rond staal geschreven wordt, na het
/// normaliseren van [`lookup_key`] (dus in hoofdletters: "ø" is dan "Ø").
/// "⌀" (U+2300) is het eigenlijke diameterteken; "Ø" (U+00D8) is wat een
/// toetsenbord meestal oplevert.
const ROND_VOORVOEGSELS: [&str; 4] = ["RD", "ROND", "Ø", "⌀"];

/// De sleutel van "RD <d>" voor een al genormaliseerde sleutel die massief
/// rond aanduidt ("Ø24", "ROND24", "RD24"), of `None` als het geen massief
/// rond is. Alleen een voorvoegsel gevolgd door uitsluitend cijfers telt: een
/// naam als "RHS…" of "RD 24 S235" blijft ongemoeid.
pub fn rond_staal_sleutel(sleutel: &str) -> Option<String> {
    ROND_VOORVOEGSELS.iter().find_map(|v| {
        let rest = sleutel.strip_prefix(v)?;
        (!rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())).then(|| format!("RD{rest}"))
    })
}

/// De voorvoegsels waarmee platstaal geschreven wordt, na het normaliseren
/// van [`lookup_key`] (hoofdletters, zonder spaties): "Strip 80x10",
/// "FL 80x10" en "Platstaal 80x10".
const STRIP_VOORVOEGSELS: [&str; 3] = ["STRIP", "PLATSTAAL", "FL"];

/// De sleutel van "Strip <b>x<t>" voor een al genormaliseerde sleutel die
/// platstaal aanduidt ("FL80X10", "PLATSTAAL80X10", "STRIP80×10"), of `None`
/// als het geen platstaal is. Alleen een voorvoegsel gevolgd door
/// `<cijfers>x<cijfers>` telt (x, X, × of *); "FLB…" of "STRIP 80" blijven
/// ongemoeid. De twee maten worden zo gezet dat de grootste voorop staat: een
/// strip 10×80 is dezelfde doorsnede als 80×10, en de catalogus schrijft de
/// breedte eerst.
pub fn strip_sleutel(sleutel: &str) -> Option<String> {
    STRIP_VOORVOEGSELS.iter().find_map(|v| {
        let rest = sleutel.strip_prefix(v)?;
        let (eerste, tweede) = rest.split_once(['X', '×', '*'])?;
        let geldig = |m: &str| !m.is_empty() && m.chars().all(|c| c.is_ascii_digit());
        if !(geldig(eerste) && geldig(tweede)) {
            return None;
        }
        let (a, b): (u32, u32) = (eerste.parse().ok()?, tweede.parse().ok()?);
        Some(format!("STRIP{}X{}", a.max(b), a.min(b)))
    })
}

impl SteelProfileDb {
    fn load() -> Self {
        let profiles: Vec<SteelProfile> = serde_json::from_str(PROFILES_JSON)
            .expect("profiles.json must parse — checked by build.rs");
        let by_name = profiles
            .iter()
            .enumerate()
            .map(|(i, p)| (p.name.clone(), i))
            .collect();
        // Eerste treffer wint, zodat een later profiel met dezelfde
        // genormaliseerde sleutel een eerder profiel niet overschrijft.
        let mut by_key: HashMap<String, usize> = HashMap::new();
        let mut by_nul_key: HashMap<String, usize> = HashMap::new();
        for (i, p) in profiles.iter().enumerate() {
            by_key.entry(lookup_key(&p.name)).or_insert(i);
            by_nul_key
                .entry(lookup_key(&zonder_nul_decimalen(&p.name)))
                .or_insert(i);
        }
        Self {
            profiles,
            by_name,
            by_key,
            by_nul_key,
        }
    }

    /// Zoekt eerst op exacte naam, daarna op de genormaliseerde sleutel, en
    /// daarna op de sleutel zonder nul-decimalen: "CHS 168.3x8", "CHS168.3x8"
    /// en "CHS 168.3x8.00" vinden "CHS 168.3x8.0" (issue #240). Dat moet vóór
    /// de punten wegvallen, anders leest "8.0" als "80". De frontend heeft
    /// dezelfde regel in `design-mockup/src/lib/strip.ts` (`profielSleutel`).
    pub fn find(&self, name: &str) -> Option<&SteelProfile> {
        self.by_name
            .get(name)
            .or_else(|| self.by_key.get(&lookup_key(name)))
            .or_else(|| self.by_nul_key.get(&lookup_key(&zonder_nul_decimalen(name))))
            .map(|&i| &self.profiles[i])
    }

    pub fn all(&self) -> &[SteelProfile] {
        &self.profiles
    }

    /// Tot `max` catalogusnamen die op `name` lijken, voor de foutmelding bij
    /// een onbekend profiel (issue #240): dezelfde reeks (de letters vooraan,
    /// "CHS", "HEA", …) met evenveel maten, gesorteerd op de afstand tussen de
    /// maten (som van |ln(a/b)|). Leeg als de reeks niet bestaat.
    pub fn suggesties(&self, name: &str, max: usize) -> Vec<&str> {
        let (reeks, maten) = reeks_en_maten(name);
        if reeks.is_empty() {
            return vec![];
        }
        let mut kandidaten: Vec<(f64, &str)> = self
            .profiles
            .iter()
            .filter_map(|p| {
                let (r, m) = reeks_en_maten(&p.name);
                if r != reeks || m.len() != maten.len() {
                    return None;
                }
                let afstand: f64 = m
                    .iter()
                    .zip(&maten)
                    .map(|(a, b)| if *a > 0.0 && *b > 0.0 { (a / b).ln().abs() } else { (a - b).abs() })
                    .sum();
                Some((afstand, p.name.as_str()))
            })
            .collect();
        kandidaten.sort_by(|a, b| a.0.total_cmp(&b.0));
        kandidaten.into_iter().take(max).map(|(_, n)| n).collect()
    }
}

/// De reeks (de letters vóór de eerste maat, in hoofdletters, zonder spaties
/// en koppeltekens) en de maten van een profielnaam: "CHS 168.3x8.0" →
/// ("CHS", [168,3, 8]).
fn reeks_en_maten(name: &str) -> (String, Vec<f64>) {
    let reeks: String = name
        .chars()
        .take_while(|c| !c.is_ascii_digit())
        .filter(|c| c.is_alphabetic())
        .flat_map(|c| c.to_uppercase())
        .collect();
    let maten = name
        .split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .filter_map(|t| t.trim_matches('.').parse::<f64>().ok())
        .collect();
    (reeks, maten)
}

pub fn db() -> &'static SteelProfileDb {
    static DB: OnceLock<SteelProfileDb> = OnceLock::new();
    DB.get_or_init(SteelProfileDb::load)
}

// ═══════════════════════════════════════════════════════════════════════════
//  Herkomst van de cataloguswaarden (issue #241)
// ═══════════════════════════════════════════════════════════════════════════

/// Waar de grootheden van een groep catalogusprofielen vandaan komen.
///
/// De catalogus is niet uit één bron: bij de gewalste I-profielen van EN 10365
/// staan A, I, W, i, A_v en I_t zoals de gepubliceerde profieltabel ze geeft
/// (afgerond), terwijl I_w uit de doorsnedemotor komt (`scripts/
/// genereer-profieldata.mjs`, `MOTOR_OVERNAME`): de tabelwaarde is de
/// bovengrens I_z·h_s²/4 van een doorsnede met haar hele I_z in de
/// flensmiddenvlakken, en een te hoge I_w is onveilig voor kip. Tot oktober
/// 2026 stond die menging nergens vermeld (issue #241).
#[derive(Clone, Debug, Serialize)]
pub struct Herkomst {
    /// Om welke profielen het gaat.
    pub profielen: &'static str,
    /// Grootheden uit een gepubliceerde profieltabel.
    pub tabel: Vec<&'static str>,
    /// Grootheden uit de doorsnedemotor of gesloten formules van de
    /// genormeerde maten.
    pub berekend: Vec<&'static str>,
    pub toelichting: &'static str,
}

/// De reeksen waarvan de catalogus de tabelwaarden van EN 10365 draagt.
const EN10365_REEKSEN: [&str; 4] = ["IPE", "HEA", "HEB", "HEM"];

/// Toelichting bij de EN 10365-reeksen.
const TOELICHTING_EN10365: &str = "A, I_y, I_z, W_el, W_pl, i, A_v en I_t zijn de (afgeronde) waarden \
    van de profieltabel volgens EN 10365; W_pl is alleen vervangen door de exacte contourwaarde \
    waar de tabel meer dan 0,5 % afweek (HEM, HEB/HEM 220). I_w komt uit de doorsnedemotor: de \
    tabelwaarde (≈ t_f·b³/12·(h − t_f)²/2, ook I_z·h_s²/4) neemt alle buigstijfheid om z in de \
    flensmiddenvlakken aan en is een bovengrens; de motor rekent de welvingsfunctie op de \
    werkelijke contour met lijf en uitrondingen en ligt 1–2,5 % lager (veilige kant voor kip; de \
    kipketen van NB.NB.13/NB.148 gebruikt I_w overigens niet). De motor-I_t van \
    compute_section_properties (met onder- en bovengrens) ligt 2–3 % onder de tabel-I_t: de band \
    is de numerieke insluiting voor de geïdealiseerde contour (rechte flenzen, kwartcirkels r), \
    niet een betrouwbaarheidsband rond de tabel; gepubliceerde tabellen verschillen onderling in \
    dezelfde orde (IPE 300: 19,9 tegen 20,12 cm⁴). De toetsing rekent met de cataloguswaarde.";

/// Toelichting bij alle andere reeksen.
const TOELICHTING_BEREKEND: &str = "Alle grootheden zijn afgeleid uit de genormeerde maten (h, b, t_w, \
    t_f, r of d, t): gesloten formules van de generatiescripts (scripts/genereer-*.mjs) en, voor \
    I_t en I_w waar die formules tekortschieten (U-profielen), de doorsnedemotor. Bij kokers en \
    buizen is I_w = 0 (gesloten doorsnede).";

/// De herkomst van de grootheden van één catalogusprofiel.
pub fn herkomst(p: &SteelProfile) -> Herkomst {
    let reeks: String = p
        .name
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_uppercase();
    if p.kind == ProfileKind::ISection && EN10365_REEKSEN.contains(&reeks.as_str()) {
        herkomst_en10365()
    } else {
        herkomst_berekend()
    }
}

fn herkomst_en10365() -> Herkomst {
    Herkomst {
        profielen: "IPE, HEA, HEB, HEM (EN 10365)",
        tabel: vec![
            "area_mm2", "iy_mm4", "iz_mm4", "wel_y_mm3", "wel_z_mm3", "wpl_y_mm3", "wpl_z_mm3",
            "av_y_mm2", "av_z_mm2", "it_mm4", "iy_radius_mm", "iz_radius_mm",
        ],
        berekend: vec!["iw_mm6"],
        toelichting: TOELICHTING_EN10365,
    }
}

fn herkomst_berekend() -> Herkomst {
    Herkomst {
        profielen: "alle overige reeksen (INP, DIE/DIL/DIN, UNP, UPE, SHS, RHS, CHS, L, RD, Strip)",
        tabel: vec![],
        berekend: vec![
            "area_mm2", "iy_mm4", "iz_mm4", "wel_y_mm3", "wel_z_mm3", "wpl_y_mm3", "wpl_z_mm3",
            "av_y_mm2", "av_z_mm2", "it_mm4", "iw_mm6", "iy_radius_mm", "iz_radius_mm",
        ],
        toelichting: TOELICHTING_BEREKEND,
    }
}

/// De twee herkomstgroepen van de catalogus, voor `list_steel_profiles`.
pub fn herkomst_groepen() -> Vec<Herkomst> {
    vec![herkomst_en10365(), herkomst_berekend()]
}
