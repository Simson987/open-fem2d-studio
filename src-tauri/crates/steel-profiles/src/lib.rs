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
        for (i, p) in profiles.iter().enumerate() {
            by_key.entry(lookup_key(&p.name)).or_insert(i);
        }
        Self {
            profiles,
            by_name,
            by_key,
        }
    }

    /// Zoekt eerst op exacte naam, daarna op de genormaliseerde sleutel.
    pub fn find(&self, name: &str) -> Option<&SteelProfile> {
        self.by_name
            .get(name)
            .or_else(|| self.by_key.get(&lookup_key(name)))
            .map(|&i| &self.profiles[i])
    }

    pub fn all(&self) -> &[SteelProfile] {
        &self.profiles
    }
}

pub fn db() -> &'static SteelProfileDb {
    static DB: OnceLock<SteelProfileDb> = OnceLock::new();
    DB.get_or_init(SteelProfileDb::load)
}
