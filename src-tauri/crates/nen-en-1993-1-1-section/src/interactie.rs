//! NEN-EN 1993-1-1 §6.2.9 en §6.2.10 — buiging met normaalkracht, en met
//! dwarskracht erbij, voor elke doorsnedevorm uit de catalogus en voor de
//! samengestelde doorsneden.
//!
//! ## Welke regel bij welke doorsnede
//!
//! Klasse 1 en 2 (§6.2.9.1): het criterium is M_Ed ≤ M_N,Rd (6.31), met M_N,Rd
//! het plastisch moment, gereduceerd door de normaalkracht. Lid (5) geeft
//! benaderingen voor twee families, lid (6) de interactie bij buiging om twee
//! assen:
//!
//! * dubbelsymmetrische I en H (gewalst, of gelast met gelijke flenzen):
//!   (6.36) M_N,y,Rd = M_pl,y,Rd·(1 − n)/(1 − 0,5a) ≤ M_pl,y,Rd, (6.37)/(6.38)
//!   om de z-as, met a = (A − 2bt_f)/A ≤ 0,5; de vrijstellingen van lid (4),
//!   (6.33)–(6.35); bij twee assen (6.41) met α = 2 en β = 5n ≥ 1;
//! * kokers met gelijke wanddikte en gelaste kokers met gelijke flenzen en
//!   lijven: (6.39) en (6.40) met a_w en a_f; bij twee assen
//!   α = β = 1,66/(1 − 1,13n²) ≤ 6;
//! * de ronde buis: lid (5) geeft geen benadering, lid (6) wel α = β = 2. Dan
//!   geldt lid (2) zelf, en M_N,Rd is voor een ring exact af te leiden (zie
//!   [`ring_interactie`]). Met α = β = 2 en M_N,y = M_N,z is (6.41) precies de
//!   toets op het resulterende moment.
//!
//! Een doorsnede zonder benadering in lid (5) — een U-profiel buiten de
//! vrijstelling van lid (4), een monosymmetrische I, een willekeurige
//! samengestelde doorsnede — krijgt de lineaire optelling van §6.2.1(7), (6.2):
//! N_Ed/N_Rd + M_y,Ed/M_y,Rd + M_z,Ed/M_z,Rd ≤ 1. Die mag volgens de norm voor
//! elke doorsnedeklasse en ligt aan de veilige kant van elke plastische
//! interactie.
//!
//! Klasse 3 (§6.2.9.2): de grootste langsspanning, (6.42),
//! σ_x,Ed = N/A + M_y/W_el,y + M_z/W_el,z ≤ f_y/γ_M0.
//!
//! ## Dwarskracht (§6.2.10)
//!
//! Tot V_Ed ≤ V_pl,Rd/2 verandert er niets (6.2.10(2)). Daarboven rekent de
//! norm met (1 − ρ)·f_y "voor het afschuifoppervlak", ρ = (2V_Ed/V_pl,Rd − 1)²
//! (6.2.10(3)). Hier is die verlaagde vloeigrens op de HELE doorsnede gezet,
//! met de grootste ρ van beide richtingen: N_pl,Rd en beide M_pl,Rd gaan met
//! (1 − ρ) omlaag. Dat is de veilige kant — de flenzen van een I dragen de
//! dwarskracht in z-richting niet — en het is dezelfde aanpak als de toets
//! 6.2.8 en die van massief rond.
//!
//! ## De unity check
//!
//! Zolang het criterium voldoet, is de UC de verhouding zoals de norm het
//! criterium schrijft: M_Ed/M_N,Rd voor (6.31), het linkerlid voor (6.2) en
//! (6.42). Bij buiging om twee assen is het de omgekeerde van de factor μ
//! waarmee beide momenten, bij gelijkblijvende N_Ed en V_Ed, tot de grens van
//! (6.41) kunnen groeien; voor buiging om één as is dat precies M_Ed/M_N,Rd,
//! en het linkerlid van (6.41) staat er als tussenwaarde naast.
//!
//! Voldoet het criterium NIET, dan is de UC de EVENREDIGE overschrijding: de
//! factor waardoor ALLE snedekrachten samen gedeeld moeten worden om op de
//! interactiegrens uit te komen. Dat getal is altijd eindig, is precies 1,0
//! op de grens (dus zonder sprong aan de kant waar het criterium nog
//! voldoet), groeit met elke snedekracht mee en is nooit kleiner dan
//! n = N_Ed/N_pl,Rd. De klassieke M_Ed/M_N,Rd loopt daar uit de hand: bij
//! n → 1 gaat M_N,Rd naar nul en de UC naar oneindig, en bij n > 1 wordt
//! M_N,Rd negatief. Voor een I-profiel om de y-as komt de evenredige UC neer
//! op max(m; n + (1 − 0,5a)·m) met m = M_Ed/M_pl,Rd.
//!
//! Is N_Ed ≥ N_pl,Rd, dan zegt de toets dat met zoveel woorden: "N_Ed ≥
//! N_pl,Rd: de doorsnede bezwijkt al op normaalkracht".

use std::f64::consts::PI;

use mechanics::{ForceStateSnapshot, InternalForces};
use section_properties::SectionProperties;

use crate::classification::CrossSectionClass;
use crate::opmaak::{lx, nl, nv, stap};
use crate::{CheckStatus, Deelstap, NamedValue, ResistanceCalc, SteelGrade, UnityCheck};

/// Het id van de toets buiging met normaalkracht, §6.2.9.
pub const TOETS_MN: &str = "6.2.9_combined_mn";
/// Het id van de toets buiging met normaal- en dwarskracht, §6.2.10.
pub const TOETS_MNV: &str = "6.2.10_combined_mnv";

/// De melding bij N_Ed ≥ N_pl,Rd, letterlijk zoals hij in het rapport komt.
pub const MELDING_BEZWIJKT_OP_NORMAALKRACHT: &str =
    "N_Ed ≥ N_pl,Rd: de doorsnede bezwijkt al op normaalkracht";

/// Welke regel van §6.2.9 bij de doorsnede hoort.
#[derive(Clone, Debug, PartialEq)]
pub enum Interactievorm {
    /// Dubbelsymmetrische I of H, gewalst of gelast met gelijke flenzen:
    /// (6.33)–(6.38) en (6.41) met α = 2, β = 5n ≥ 1.
    I,
    /// U-profiel: vrijstelling (6.33)/(6.34) om de y-as ("andere doorsneden
    /// met flenzen"), en daarbuiten de lineaire optelling (6.2) — §6.2.9.1(5)
    /// geeft voor een U geen benadering.
    U,
    /// Koker met gelijke wanddikte t (warmgewalst of koudgevormd): (6.39),
    /// (6.40) met a_w = (A − 2bt)/A en a_f = (A − 2ht)/A.
    Koker,
    /// Gelaste koker met gelijke flenzen en gelijke lijven: (6.39), (6.40) met
    /// a_w = (A − 2bt_f)/A en a_f = (A − 2ht_w)/A.
    GelasteKoker,
    /// Ronde buis met buitendiameter h en wanddikte t_w: de exacte plastische
    /// interactie van een ring, op het resulterende moment.
    RondeBuis,
    /// Massieve rechthoek (platstaal): (6.32) M_N,Rd = M_pl,Rd·(1 − n²) om elke
    /// as; bij twee assen (6.41) met α = β = 1, de waarde die lid (6) als
    /// conservatief toestaat — voor een rechthoek geeft het lid geen andere.
    Rechthoek,
    /// Geen benadering in §6.2.9.1: de lineaire optelling (6.2). De tekst zegt
    /// waarom, voor het rapport.
    Lineair(String),
}

/// 6.2.9 of 6.2.10.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Interactiesoort {
    /// §6.2.9: buiging en normaalkracht.
    BuigingNormaal,
    /// §6.2.10: buiging, normaal- en dwarskracht.
    BuigingNormaalDwars,
}

impl Interactiesoort {
    pub fn id(self) -> &'static str {
        match self {
            Self::BuigingNormaal => TOETS_MN,
            Self::BuigingNormaalDwars => TOETS_MNV,
        }
    }
    fn titel(self) -> &'static str {
        match self {
            Self::BuigingNormaal => "Buiging en normaalkracht",
            Self::BuigingNormaalDwars => "Buiging, normaal- en dwarskracht",
        }
    }
    fn met_dwarskracht(self) -> bool {
        matches!(self, Self::BuigingNormaalDwars)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  De ring: exacte plastische interactie van N en M
// ═══════════════════════════════════════════════════════════════════════════

/// Oppervlak van het cirkelsegment van een cirkel met straal `rho` voorbij
/// een koorde op afstand `c` van het middelpunt (0 ≤ c).
fn segment_a(rho: f64, c: f64) -> f64 {
    if rho <= 0.0 || c >= rho {
        return 0.0;
    }
    rho * rho * (c / rho).acos() - c * (rho * rho - c * c).sqrt()
}

/// Statisch moment van datzelfde segment om de evenwijdige lijn door het
/// middelpunt: (2/3)·(ρ² − c²)^(3/2).
fn segment_s(rho: f64, c: f64) -> f64 {
    if rho <= 0.0 || c >= rho {
        return 0.0;
    }
    2.0 / 3.0 * (rho * rho - c * c).powf(1.5)
}

/// n en m van een ring (buitenstraal `r_buiten`, binnenstraal `r_binnen`)
/// met de plastische neutrale lijn op afstand `c` van het middelpunt.
///
/// Volledig plastisch staat het deel voorbij de lijn op +f_y en de rest op
/// −f_y. Met A_s en S_s het oppervlak en het statisch moment van dat deel:
/// N = f_y·(A − 2A_s) en M = 2·f_y·S_s, dus n = 1 − 2A_s/A en
/// m = S_s(c)/S_s(0). Bij c = 0 is n = 0 en m = 1; bij c = r_buiten is n = 1
/// en m = 0.
pub fn ring_n_m(r_buiten: f64, r_binnen: f64, c: f64) -> (f64, f64) {
    let a = PI * (r_buiten * r_buiten - r_binnen * r_binnen);
    let a_s = segment_a(r_buiten, c) - segment_a(r_binnen, c);
    let s_s = segment_s(r_buiten, c) - segment_s(r_binnen, c);
    let s_0 = segment_s(r_buiten, 0.0) - segment_s(r_binnen, 0.0);
    (1.0 - 2.0 * a_s / a, if s_0 > 0.0 { s_s / s_0 } else { 0.0 })
}

/// M_N,Rd/M_pl,Rd van een ronde buis met buitendiameter `d` en wanddikte `t`
/// bij een relatieve normaalkracht `n` (§6.2.9.1(2), exact). Geeft ook c/R,
/// de ligging van de plastische neutrale lijn als fractie van de buitenstraal.
///
/// n(c) stijgt monotoon van 0 (c = 0) naar 1 (c = R); c wordt door halveren
/// gevonden. Grensgevallen: een dunne wand nadert m = cos(πn/2), een volle
/// cirkel (t = d/2) de kromme sin³β van massief rond.
pub fn ring_interactie(n: f64, d: f64, t: f64) -> (f64, f64) {
    if !(n > 0.0) {
        return (0.0, 1.0);
    }
    if n >= 1.0 {
        return (1.0, 0.0);
    }
    let r_buiten = d / 2.0;
    let r_binnen = (r_buiten - t).max(0.0);
    let (mut lo, mut hi) = (0.0_f64, r_buiten);
    for _ in 0..200 {
        let mid = 0.5 * (lo + hi);
        if ring_n_m(r_buiten, r_binnen, mid).0 < n {
            lo = mid;
        } else {
            hi = mid;
        }
        if hi - lo <= 1e-15 * r_buiten {
            break;
        }
    }
    let c = 0.5 * (lo + hi);
    (c / r_buiten, ring_n_m(r_buiten, r_binnen, c).1)
}

// ═══════════════════════════════════════════════════════════════════════════
//  De evenredige unity check
// ═══════════════════════════════════════════════════════════════════════════

/// De UC van een toets die bij de werkelijke snedekrachten NIET voldoet: 1/λ*,
/// met λ* de kleinste factor in (0, 1] waarbij `voldoet(λ)` onwaar wordt —
/// `voldoet(λ)` zegt of de toets voldoet als alle snedekrachten met λ zijn
/// vermenigvuldigd.
///
/// De factor wordt eerst in kleine stappen vanaf nul gezocht en daarna door
/// halveren verfijnd: zo wordt ook bij een niet-convexe grens (de β = 5n van
/// (6.41)) de EERSTE overschrijding gevonden, en dat is de veilige kant.
pub fn evenredige_uc(voldoet: impl Fn(f64) -> bool) -> f64 {
    const STAPPEN: usize = 400;
    let mut lo = 0.0_f64;
    let mut hi = 1.0_f64;
    for i in 1..=STAPPEN {
        let l = i as f64 / STAPPEN as f64;
        if !voldoet(l) {
            hi = l;
            lo = (i - 1) as f64 / STAPPEN as f64;
            break;
        }
    }
    for _ in 0..200 {
        let mid = 0.5 * (lo + hi);
        if voldoet(mid) {
            lo = mid;
        } else {
            hi = mid;
        }
        if hi - lo <= 1e-15 * hi {
            break;
        }
    }
    let lambda = 0.5 * (lo + hi);
    if lambda > 0.0 {
        1.0 / lambda
    } else {
        f64::MAX
    }
}

/// 1/μ, met μ de factor waarmee de twee momentverhoudingen `r_y` en `r_z`
/// samen tot de grens van (6.41) groeien: (μ·r_y)^α + (μ·r_z)^β = 1.
fn uc_6_41(r_y: f64, r_z: f64, alpha: f64, beta: f64) -> f64 {
    let g = |mu: f64| (mu * r_y).powf(alpha) + (mu * r_z).powf(beta);
    if r_y <= 0.0 && r_z <= 0.0 {
        return 0.0;
    }
    let mut hi = 1.0_f64;
    while g(hi) < 1.0 {
        hi *= 2.0;
        if hi > 1e12 {
            return 0.0;
        }
    }
    let mut lo = 0.0_f64;
    for _ in 0..200 {
        let mid = 0.5 * (lo + hi);
        if g(mid) < 1.0 {
            lo = mid;
        } else {
            hi = mid;
        }
        if hi - lo <= 1e-15 * hi {
            break;
        }
    }
    1.0 / (0.5 * (lo + hi))
}

// ═══════════════════════════════════════════════════════════════════════════
//  De uitwerking op één krachtentoestand
// ═══════════════════════════════════════════════════════════════════════════

/// Snedekrachten als absolute waarden (kN, kNm).
#[derive(Clone, Copy, Debug)]
struct Krachten {
    n: f64,
    vy: f64,
    vz: f64,
    my: f64,
    mz: f64,
}

impl Krachten {
    fn uit(f: &InternalForces) -> Self {
        Self { n: f.n_ed.abs(), vy: f.vy_ed.abs(), vz: f.vz_ed.abs(), my: f.my_ed.abs(), mz: f.mz_ed.abs() }
    }
    fn maal(self, l: f64) -> Self {
        Self { n: self.n * l, vy: self.vy * l, vz: self.vz * l, my: self.my * l, mz: self.mz * l }
    }
}

/// Wat het criterium op deze krachten is.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Criterium {
    /// Plastisch, klasse 1 en 2: M_N,Rd per as, en α/β voor (6.41).
    Plastisch,
    /// Lineaire optelling (6.2), klasse 1 en 2 zonder benadering in lid (5).
    Lineair,
    /// Elastisch, klasse 3: (6.42).
    Elastisch,
}

/// De hele uitwerking op één krachtentoestand.
#[derive(Clone, Debug)]
struct Uitwerking {
    k: Krachten,
    /// V_pl,y,Rd en V_pl,z,Rd (kN) met de volle f_y; bij een ronde buis is
    /// `v_pl_z` de weerstand tegen de resulterende dwarskracht.
    v_pl_y: f64,
    v_pl_z: f64,
    rho_y: f64,
    rho_z: f64,
    /// De resulterende dwarskracht, alleen bij een ronde buis.
    v_res: f64,
    rho: f64,
    /// 1 − ρ.
    factor: f64,
    /// Weerstanden met (1 − ρ)·f_y (kN, kNm).
    n_pl: f64,
    m_pl_y: f64,
    m_pl_z: f64,
    m_el_y: f64,
    m_el_z: f64,
    n: f64,
    criterium: Criterium,
    /// Het resulterende moment (ronde buis) of 0.
    m_res: f64,
    /// a, a_w, a_f — wat bij de vorm hoort (NaN = niet van toepassing).
    a: f64,
    a_w: f64,
    a_f: f64,
    /// Vrijstelling om y (6.33)+(6.34) en om z (6.35); `None` = niet getoetst.
    vrij_y: Option<bool>,
    vrij_z: Option<bool>,
    /// De grenzen van de vrijstellingen (kN): min(0,25·N_pl,Rd; 0,5·h_w·t_w·f_y/γ_M0) en h_w·t_w·f_y/γ_M0.
    grens_vrij_y: f64,
    grens_vrij_z: f64,
    m_n_y: f64,
    m_n_z: f64,
    /// m_N/M_pl van de ring en de ligging van de neutrale lijn (ronde buis).
    ring_m: f64,
    ring_c: f64,
    alpha: f64,
    beta: f64,
    /// Linkerlid van het criterium: M/M_N (één as), (6.41) (twee assen),
    /// (6.2) of (6.42). 0 zonder buiging.
    lhs: f64,
    voldoet: bool,
    /// De gebruikte vorm; bij een U buiten de vrijstelling wordt dat Lineair.
    lineair_reden: Option<String>,
}

fn klasse_12(klasse: CrossSectionClass) -> bool {
    matches!(klasse, CrossSectionClass::Class1 | CrossSectionClass::Class2)
}

/// a ≤ 0,5 en ≥ 0. Een onbekende maat (≤ 0) geeft a = 0 — de kleinste a, dus
/// de grootste reductie: de veilige kant.
fn fractie(a: f64) -> f64 {
    if a.is_finite() { a.clamp(0.0, 0.5) } else { 0.0 }
}

fn uitwerken(
    p: &SectionProperties,
    grade: &SteelGrade,
    klasse: CrossSectionClass,
    vorm: &Interactievorm,
    soort: Interactiesoort,
    k: Krachten,
) -> Uitwerking {
    let fy = grade.fy_mpa;
    let g0 = grade.gamma_m0;
    let ronde_buis = matches!(vorm, Interactievorm::RondeBuis);

    // ── Dwarskracht: ρ (6.2.10(3)) ─────────────────────────────────────────
    let v_pl_y = p.av_y_mm2 * (fy / 3f64.sqrt()) / g0 * 1e-3;
    let v_pl_z = p.av_z_mm2 * (fy / 3f64.sqrt()) / g0 * 1e-3;
    let rho_van = |v: f64, v_pl: f64| -> f64 {
        if !soort.met_dwarskracht() || !(v_pl > 0.0) || v <= 0.5 * v_pl {
            0.0
        } else {
            (2.0 * v / v_pl - 1.0).powi(2)
        }
    };
    let v_res = if ronde_buis { k.vy.hypot(k.vz) } else { 0.0 };
    let (rho_y, rho_z) = if ronde_buis {
        (0.0, rho_van(v_res, v_pl_z))
    } else {
        (rho_van(k.vy, v_pl_y), rho_van(k.vz, v_pl_z))
    };
    let rho = rho_y.max(rho_z);
    let factor = 1.0 - rho;

    // ── Weerstanden met (1 − ρ)·f_y ─────────────────────────────────────────
    // Bij ρ ≥ 1 blijft er niets over; geen negatieve weerstanden.
    let fyd = factor.max(0.0) * fy / g0;
    let n_pl = p.area_mm2 * fyd * 1e-3;
    let m_pl_y = p.wpl_y_mm3 * fyd * 1e-6;
    let m_pl_z = p.wpl_z_mm3 * fyd * 1e-6;
    let m_el_y = p.wel_y_mm3 * fyd * 1e-6;
    let m_el_z = p.wel_z_mm3 * fyd * 1e-6;
    let n = if n_pl > 0.0 { k.n / n_pl } else if k.n > 0.0 { f64::INFINITY } else { 0.0 };
    let m_res = if ronde_buis { k.my.hypot(k.mz) } else { 0.0 };

    let mut u = Uitwerking {
        k,
        v_pl_y,
        v_pl_z,
        rho_y,
        rho_z,
        v_res,
        rho,
        factor,
        n_pl,
        m_pl_y,
        m_pl_z,
        m_el_y,
        m_el_z,
        n,
        criterium: Criterium::Plastisch,
        m_res,
        a: f64::NAN,
        a_w: f64::NAN,
        a_f: f64::NAN,
        vrij_y: None,
        vrij_z: None,
        grens_vrij_y: f64::NAN,
        grens_vrij_z: f64::NAN,
        m_n_y: m_pl_y,
        m_n_z: m_pl_z,
        ring_m: f64::NAN,
        ring_c: f64::NAN,
        alpha: f64::NAN,
        beta: f64::NAN,
        lhs: 0.0,
        voldoet: true,
        lineair_reden: None,
    };

    // Geen weerstand meer over: de dwarskracht alleen (ρ ≥ 1) of de
    // normaalkracht alleen (n > 1) put de doorsnede al uit.
    if factor <= 0.0 {
        u.voldoet = false;
        u.lhs = f64::INFINITY;
        return u;
    }

    // ── Klasse 3: (6.42) ────────────────────────────────────────────────────
    if !klasse_12(klasse) {
        u.criterium = Criterium::Elastisch;
        let n_rd = n_pl;
        u.lhs = k.n / n_rd
            + if ronde_buis {
                m_res / m_el_y
            } else {
                (if k.my > 0.0 { k.my / m_el_y } else { 0.0 }) + (if k.mz > 0.0 { k.mz / m_el_z } else { 0.0 })
            };
        u.voldoet = u.lhs <= 1.0;
        return u;
    }

    // ── Klasse 1 en 2 ───────────────────────────────────────────────────────
    let h_w = p.h_mm - 2.0 * p.tf_mm;
    let vrijstelling = |u: &mut Uitwerking| {
        // (6.33) N_Ed ≤ 0,25·N_pl,Rd en (6.34) N_Ed ≤ 0,5·h_w·t_w·f_y/γ_M0;
        // (6.35) N_Ed ≤ h_w·t_w·f_y/γ_M0. Met de verlaagde f_y van 6.2.10.
        let web = if h_w > 0.0 && p.tw_mm > 0.0 { h_w * p.tw_mm * fyd * 1e-3 } else { 0.0 };
        u.grens_vrij_y = (0.25 * n_pl).min(0.5 * web);
        u.grens_vrij_z = web;
        u.vrij_y = Some(k.n <= u.grens_vrij_y);
        u.vrij_z = Some(k.n <= u.grens_vrij_z);
    };
    let lineair = |u: &mut Uitwerking, reden: String| {
        u.criterium = Criterium::Lineair;
        u.lineair_reden = Some(reden);
        u.lhs = k.n / n_pl
            + (if k.my > 0.0 { k.my / m_pl_y } else { 0.0 })
            + (if k.mz > 0.0 { k.mz / m_pl_z } else { 0.0 });
        u.voldoet = u.lhs <= 1.0;
    };

    match vorm {
        Interactievorm::Lineair(reden) => {
            lineair(&mut u, reden.clone());
            return u;
        }
        Interactievorm::U => {
            vrijstelling(&mut u);
            if k.mz > 0.0 || u.vrij_y != Some(true) {
                lineair(
                    &mut u,
                    "U-profiel: §6.2.9.1(5) geeft voor een U-profiel geen benadering van M_N,Rd, en \
                     de vrijstelling van lid (4) — (6.33) en (6.34), alleen voor buiging om de y-as — \
                     geldt hier niet. Getoetst is de lineaire optelling van §6.2.1(7), (6.2)."
                        .to_string(),
                );
                return u;
            }
            // Vrijgesteld en alleen M_y: M_N,y,Rd = M_pl,y,Rd.
            u.m_n_y = m_pl_y;
        }
        Interactievorm::I => {
            vrijstelling(&mut u);
            u.a = if p.b_mm > 0.0 && p.tf_mm > 0.0 {
                fractie((p.area_mm2 - 2.0 * p.b_mm * p.tf_mm) / p.area_mm2)
            } else {
                0.0
            };
            let a = u.a;
            u.m_n_y = if n > 1.0 {
                0.0
            } else if u.vrij_y == Some(true) {
                m_pl_y
            } else {
                (m_pl_y * (1.0 - n) / (1.0 - 0.5 * a)).min(m_pl_y)
            };
            u.m_n_z = if n > 1.0 {
                0.0
            } else if u.vrij_z == Some(true) || n <= a {
                m_pl_z
            } else {
                m_pl_z * (1.0 - ((n - a) / (1.0 - a)).powi(2))
            };
            u.alpha = 2.0;
            u.beta = (5.0 * n).max(1.0);
        }
        Interactievorm::Koker | Interactievorm::GelasteKoker => {
            let (t_flens, t_lijf) = if matches!(vorm, Interactievorm::Koker) {
                (p.tw_mm, p.tw_mm)
            } else {
                (p.tf_mm, p.tw_mm)
            };
            u.a_w = if p.b_mm > 0.0 && t_flens > 0.0 {
                fractie((p.area_mm2 - 2.0 * p.b_mm * t_flens) / p.area_mm2)
            } else {
                0.0
            };
            u.a_f = if p.h_mm > 0.0 && t_lijf > 0.0 {
                fractie((p.area_mm2 - 2.0 * p.h_mm * t_lijf) / p.area_mm2)
            } else {
                0.0
            };
            u.m_n_y = if n > 1.0 { 0.0 } else { (m_pl_y * (1.0 - n) / (1.0 - 0.5 * u.a_w)).min(m_pl_y) };
            u.m_n_z = if n > 1.0 { 0.0 } else { (m_pl_z * (1.0 - n) / (1.0 - 0.5 * u.a_f)).min(m_pl_z) };
            let noemer = 1.0 - 1.13 * n * n;
            let e = if noemer > 0.0 { (1.66 / noemer).min(6.0) } else { 6.0 };
            u.alpha = e;
            u.beta = e;
        }
        Interactievorm::Rechthoek => {
            let f = if n > 1.0 { 0.0 } else { 1.0 - n * n };
            u.m_n_y = m_pl_y * f;
            u.m_n_z = m_pl_z * f;
            u.alpha = 1.0;
            u.beta = 1.0;
        }
        Interactievorm::RondeBuis => {
            let (c, m) = ring_interactie(n, p.h_mm, p.tw_mm);
            u.ring_c = c;
            u.ring_m = m;
            u.m_n_y = m_pl_y * m;
            u.m_n_z = m_pl_z * m;
            u.alpha = 2.0;
            u.beta = 2.0;
        }
    }

    // ── Het criterium: (6.31) of (6.41) ─────────────────────────────────────
    if n > 1.0 {
        u.voldoet = false;
        u.lhs = f64::INFINITY;
        return u;
    }
    let deel = |m: f64, m_n: f64| -> f64 {
        if m <= 0.0 {
            0.0
        } else if m_n > 0.0 {
            m / m_n
        } else {
            f64::INFINITY
        }
    };
    u.lhs = if ronde_buis {
        deel(m_res, u.m_n_y)
    } else if k.my > 0.0 && k.mz > 0.0 {
        let (r_y, r_z) = (deel(k.my, u.m_n_y), deel(k.mz, u.m_n_z));
        r_y.powf(u.alpha) + r_z.powf(u.beta)
    } else if k.mz > 0.0 {
        deel(k.mz, u.m_n_z)
    } else {
        deel(k.my, u.m_n_y)
    };
    u.voldoet = u.lhs <= 1.0;
    u
}

/// De UC zolang het criterium voldoet: de verhouding zoals de norm hem schrijft.
fn uc_bij_voldoen(u: &Uitwerking) -> f64 {
    match u.criterium {
        Criterium::Lineair | Criterium::Elastisch => u.lhs,
        Criterium::Plastisch => {
            if u.m_res > 0.0 || !(u.k.my > 0.0 && u.k.mz > 0.0) {
                // Eén as (of het resulterende moment): M_Ed/M_N,Rd.
                u.lhs
            } else {
                uc_6_41(u.k.my / u.m_n_y, u.k.mz / u.m_n_z, u.alpha, u.beta)
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  De toets
// ═══════════════════════════════════════════════════════════════════════════

/// §6.2.9 of §6.2.10 op één krachtentoestand. De aanroeper loopt de
/// omhullende af en houdt de toets met de hoogste unity check.
///
/// Klasse 4 hoort hier niet te komen — de orchestrator weigert dan de hele
/// staaf; komt hij toch, dan is de toets niet uitgevoerd, met reden.
pub fn buiging_en_normaalkracht(
    p: &SectionProperties,
    grade: &SteelGrade,
    klasse: CrossSectionClass,
    vorm: &Interactievorm,
    soort: Interactiesoort,
    force_state: ForceStateSnapshot,
) -> ResistanceCalc {
    let titel = soort.titel().to_string();
    if klasse == CrossSectionClass::Class4 {
        return ResistanceCalc {
            deelstappen: Vec::new(),
            id: soort.id().to_string(),
            title: titel,
            article: if soort.met_dwarskracht() { "art. 6.2.10" } else { "art. 6.2.9" }.to_string(),
            force_state,
            formula_latex: String::new(),
            variables: vec![],
            value: 0.0,
            unit: "-".to_string(),
            uc: None,
            status: CheckStatus::NotApplicable,
            notes: vec![
                "Niet getoetst: de doorsnede is klasse 4 en effectieve breedtes zijn niet \
                 geïmplementeerd."
                    .to_string(),
            ],
        };
    }

    let k = Krachten::uit(&force_state.forces);
    let u = uitwerken(p, grade, klasse, vorm, soort, k);
    let uc = if u.voldoet {
        uc_bij_voldoen(&u)
    } else {
        evenredige_uc(|l| uitwerken(p, grade, klasse, vorm, soort, k.maal(l)).voldoet)
    };
    let status = if uc <= 1.0 { CheckStatus::Ok } else { CheckStatus::NotOk };
    let bezweken_n = u.n >= 1.0 && status == CheckStatus::NotOk;
    let bezweken_v = u.factor <= 0.0;

    let mut notes: Vec<String> = Vec::new();
    let mut deelstappen: Vec<Deelstap> = Vec::new();
    let ronde_buis = matches!(vorm, Interactievorm::RondeBuis);

    // ── ρ (alleen 6.2.10) ───────────────────────────────────────────────────
    if soort.met_dwarskracht() {
        let (v_tekst, v_pl_tekst) = if ronde_buis {
            (
                format!("V_Ed = √(V_y,Ed² + V_z,Ed²) = {} kN", nl(u.v_res, 3)),
                format!("V_pl,Rd = {} kN", nl(u.v_pl_z, 3)),
            )
        } else {
            (
                format!("V_y,Ed = {} kN en V_z,Ed = {} kN", nl(k.vy, 3), nl(k.vz, 3)),
                format!("V_pl,y,Rd = {} kN en V_pl,z,Rd = {} kN", nl(u.v_pl_y, 3), nl(u.v_pl_z, 3)),
            )
        };
        if u.rho == 0.0 {
            notes.push(format!(
                "{v_tekst}, {v_pl_tekst}: de dwarskracht blijft onder V_pl,Rd/2, dus de \
                 weerstanden van 6.2.9 gelden onverminderd (6.2.10(2)), ρ = 0."
            ));
        } else {
            notes.push(format!(
                "{v_tekst}, {v_pl_tekst}: boven V_pl,Rd/2 geldt ρ = (2·V_Ed/V_pl,Rd − 1)² \
                 (6.2.10(3)){}. De verlaagde vloeigrens (1 − ρ)·f_y is op de HELE doorsnede \
                 gezet, met de grootste ρ van beide richtingen: N_pl,Rd en M_pl,Rd gaan beide \
                 met (1 − ρ) = {} omlaag. De norm verlaagt alleen het afschuifoppervlak; dit is de \
                 veilige kant.",
                if ronde_buis {
                    format!(", hier {}", nl(u.rho, 4))
                } else {
                    format!(": ρ_y = {}, ρ_z = {}", nl(u.rho_y, 4), nl(u.rho_z, 4))
                },
                nl(u.factor, 4)
            ));
        }
        let (v_ed, v_pl) = if ronde_buis {
            (u.v_res, u.v_pl_z)
        } else if u.rho_y > u.rho_z {
            (k.vy, u.v_pl_y)
        } else {
            (k.vz, u.v_pl_z)
        };
        deelstappen.push(stap(
            "rho",
            "Invloed van de dwarskracht",
            r"\rho",
            "art. 6.2.10(3)",
            r"\rho = \left( \frac{2 V_{Ed}}{V_{pl,Rd}} - 1 \right)^2 \quad (V_{Ed} > V_{pl,Rd}/2)".to_string(),
            if u.rho > 0.0 {
                format!(r"\rho = \left( \frac{{2 \cdot {}}}{{{}}} - 1 \right)^2", lx(v_ed, 3), lx(v_pl, 3))
            } else {
                String::new()
            },
            vec![nv(r"V_{Ed}", v_ed, "kN"), nv(r"V_{pl,Rd}", v_pl, "kN")],
            Some(u.rho),
            "-",
            vec![],
        ));
    }
    if bezweken_v {
        notes.insert(
            0,
            "V_Ed ≥ V_pl,Rd: de doorsnede bezwijkt al op dwarskracht; er is geen weerstand tegen \
             buiging en normaalkracht over."
                .to_string(),
        );
    }

    // ── n ───────────────────────────────────────────────────────────────────
    let rho_tekst = if u.rho > 0.0 { r"(1 - \rho) \cdot " } else { "" };
    let n_pl_vol = p.area_mm2 * grade.fy_mpa / grade.gamma_m0 * 1e-3;
    deelstappen.push(stap(
        "n",
        "Relatieve normaalkracht",
        "n",
        "art. 6.2.9.1(5)",
        format!(r"n = \frac{{N_{{Ed}}}}{{{rho_tekst}N_{{pl,Rd}}}}"),
        if u.rho > 0.0 {
            format!(r"n = \frac{{{}}}{{{} \cdot {}}}", lx(k.n, 3), lx(u.factor, 4), lx(n_pl_vol, 3))
        } else {
            format!(r"n = \frac{{{}}}{{{}}}", lx(k.n, 3), lx(n_pl_vol, 3))
        },
        vec![nv(r"N_{Ed}", k.n, "kN"), nv(r"N_{pl,Rd}", n_pl_vol, "kN")],
        Some(u.n),
        "-",
        vec![
            "N_Ed als absolute waarde: trek en druk verminderen de momentweerstand van de \
             doorsnede even veel."
                .to_string(),
        ],
    ));
    if bezweken_n {
        notes.insert(
            0,
            format!(
                "{MELDING_BEZWIJKT_OP_NORMAALKRACHT} (n = N_Ed/N_pl,Rd = {} ≥ 1). Er is geen \
                 momentweerstand over; de unity check is de evenredige overschrijding (zie onder) \
                 en is daarom minstens n.",
                nl(u.n, 3)
            ),
        );
    }

    let mut variables: Vec<NamedValue> = vec![
        nv(r"N_{Ed}", k.n, "kN"),
        nv(r"N_{pl,Rd}", u.n_pl, "kN"),
    ];
    let formule: String;
    let waarde: f64;
    let eenheid: &str;

    match (u.criterium, klasse_12(klasse)) {
        (Criterium::Elastisch, _) | (_, false) => {
            // Klasse 3: (6.42).
            let m_term = if ronde_buis {
                r"\frac{M_{Ed}}{M_{el,Rd}}".to_string()
            } else {
                r"\frac{M_{y,Ed}}{M_{el,y,Rd}} + \frac{M_{z,Ed}}{M_{el,z,Rd}}".to_string()
            };
            formule = format!(r"\frac{{\sigma_{{x,Ed}}}}{{f_y/\gamma_{{M0}}}} = \frac{{N_{{Ed}}}}{{N_{{Rd}}}} + {m_term} \leq 1");
            waarde = u.lhs;
            eenheid = "-";
            if ronde_buis {
                variables.push(nv(r"M_{Ed}", u.m_res, "kNm"));
                variables.push(nv(r"M_{el,Rd}", u.m_el_y, "kNm"));
            } else {
                variables.push(nv(r"M_{y,Ed}", k.my, "kNm"));
                variables.push(nv(r"M_{el,y,Rd}", u.m_el_y, "kNm"));
                variables.push(nv(r"M_{z,Ed}", k.mz, "kNm"));
                variables.push(nv(r"M_{el,z,Rd}", u.m_el_z, "kNm"));
            }
            deelstappen.push(stap(
                "sigma",
                "Grootste langsspanning (klasse 3)",
                r"\sigma_{x,Ed}/(f_y/\gamma_{M0})",
                "art. 6.2.9.2 (6.42)",
                formule.clone(),
                if ronde_buis {
                    format!(r"\frac{{{}}}{{{}}} + \frac{{{}}}{{{}}}", lx(k.n, 3), lx(u.n_pl, 3), lx(u.m_res, 3), lx(u.m_el_y, 3))
                } else {
                    format!(
                        r"\frac{{{}}}{{{}}} + \frac{{{}}}{{{}}} + \frac{{{}}}{{{}}}",
                        lx(k.n, 3),
                        lx(u.n_pl, 3),
                        lx(k.my, 3),
                        lx(u.m_el_y, 3),
                        lx(k.mz, 3),
                        lx(u.m_el_z, 3)
                    )
                },
                vec![],
                Some(u.lhs),
                "-",
                vec![
                    "Klasse 3: de spanning is elastisch, met W_el, tot f_y/γ_M0 (§6.2.9.2(1)); \
                     N_Rd = A·f_y/γ_M0."
                        .to_string(),
                ],
            ));
        }
        (Criterium::Lineair, true) => {
            formule = r"\frac{N_{Ed}}{N_{pl,Rd}} + \frac{M_{y,Ed}}{M_{pl,y,Rd}} + \frac{M_{z,Ed}}{M_{pl,z,Rd}} \leq 1".to_string();
            waarde = u.lhs;
            eenheid = "-";
            variables.push(nv(r"M_{y,Ed}", k.my, "kNm"));
            variables.push(nv(r"M_{pl,y,Rd}", u.m_pl_y, "kNm"));
            variables.push(nv(r"M_{z,Ed}", k.mz, "kNm"));
            variables.push(nv(r"M_{pl,z,Rd}", u.m_pl_z, "kNm"));
            if let Some(r) = &u.lineair_reden {
                notes.push(r.clone());
            }
            deelstappen.push(stap(
                "lineair",
                "Lineaire optelling",
                r"\Sigma",
                "art. 6.2.1(7) (6.2)",
                formule.clone(),
                format!(
                    r"\frac{{{}}}{{{}}} + \frac{{{}}}{{{}}} + \frac{{{}}}{{{}}}",
                    lx(k.n, 3),
                    lx(u.n_pl, 3),
                    lx(k.my, 3),
                    lx(u.m_pl_y, 3),
                    lx(k.mz, 3),
                    lx(u.m_pl_z, 3)
                ),
                vec![],
                Some(u.lhs),
                "-",
                vec![
                    "De lineaire optelling mag volgens §6.2.1(7) voor elke doorsnedeklasse en \
                     ligt aan de veilige kant van elke plastische interactie."
                        .to_string(),
                ],
            ));
        }
        (Criterium::Plastisch, true) => {
            let biaxiaal = !ronde_buis && k.my > 0.0 && k.mz > 0.0;
            match vorm {
                Interactievorm::I | Interactievorm::U => {
                    if let Some(vrij) = u.vrij_y {
                        deelstappen.push(stap(
                            "vrijstelling",
                            "Vrijstelling (6.33) tot en met (6.35)",
                            r"N_{Ed}",
                            "art. 6.2.9.1(4)",
                            r"N_{Ed} \leq 0{,}25 N_{pl,Rd} \;\text{en}\; N_{Ed} \leq \frac{0{,}5\, h_w t_w f_y}{\gamma_{M0}} \;(y); \quad N_{Ed} \leq \frac{h_w t_w f_y}{\gamma_{M0}} \;(z)".to_string(),
                            String::new(),
                            vec![
                                nv(r"N_{Ed}", k.n, "kN"),
                                nv(r"0{,}25 N_{pl,Rd}", 0.25 * u.n_pl, "kN"),
                                nv(r"h_w", p.h_mm - 2.0 * p.tf_mm, "mm"),
                                nv(r"t_w", p.tw_mm, "mm"),
                            ],
                            Some(k.n),
                            "kN",
                            vec![
                                format!(
                                    "Om de y-as: grens min(0,25·N_pl,Rd; 0,5·h_w·t_w·f_y/γ_M0) = {} kN — {}.",
                                    nl(u.grens_vrij_y, 2),
                                    if vrij {
                                        "voldaan, de normaalkracht hoeft niet in rekening te worden gebracht: M_N,y,Rd = M_pl,y,Rd"
                                    } else {
                                        "niet voldaan, dus M_N,y,Rd volgt uit (6.36)"
                                    }
                                ),
                                format!(
                                    "Om de z-as: grens h_w·t_w·f_y/γ_M0 = {} kN — {}.",
                                    nl(u.grens_vrij_z, 2),
                                    if u.vrij_z == Some(true) {
                                        "voldaan: M_N,z,Rd = M_pl,z,Rd"
                                    } else {
                                        "niet voldaan, dus M_N,z,Rd volgt uit (6.37)/(6.38)"
                                    }
                                ),
                            ],
                        ));
                    }
                    if matches!(vorm, Interactievorm::I) {
                        deelstappen.push(stap(
                            "a",
                            "Lijfaandeel van de doorsnede",
                            "a",
                            "art. 6.2.9.1(5)",
                            r"a = \frac{A - 2 b t_f}{A} \leq 0{,}5".to_string(),
                            format!(
                                r"a = \frac{{{} - 2 \cdot {} \cdot {}}}{{{}}}",
                                lx(p.area_mm2, 1),
                                lx(p.b_mm, 1),
                                lx(p.tf_mm, 2),
                                lx(p.area_mm2, 1)
                            ),
                            vec![
                                nv("A", p.area_mm2, "mm²"),
                                nv("b", p.b_mm, "mm"),
                                nv("t_f", p.tf_mm, "mm"),
                            ],
                            Some(u.a),
                            "-",
                            vec![format!(
                                "a = {}, dus de reductie om de y-as begint bij n > 0,5·a = {} en die om \
                                 de z-as bij n > a.",
                                nl(u.a, 3),
                                nl(0.5 * u.a, 3)
                            )],
                        ));
                        variables.push(nv("a", u.a, "-"));
                    }
                }
                Interactievorm::Koker | Interactievorm::GelasteKoker => {
                    let gelast = matches!(vorm, Interactievorm::GelasteKoker);
                    deelstappen.push(stap(
                        "a_w_a_f",
                        "Aandeel van lijven en flenzen",
                        "a_w",
                        "art. 6.2.9.1(5)",
                        if gelast {
                            r"a_w = \frac{A - 2 b t_f}{A} \leq 0{,}5, \quad a_f = \frac{A - 2 h t_w}{A} \leq 0{,}5".to_string()
                        } else {
                            r"a_w = \frac{A - 2 b t}{A} \leq 0{,}5, \quad a_f = \frac{A - 2 h t}{A} \leq 0{,}5".to_string()
                        },
                        String::new(),
                        vec![
                            nv("A", p.area_mm2, "mm²"),
                            nv("h", p.h_mm, "mm"),
                            nv("b", p.b_mm, "mm"),
                            nv(if gelast { "t_w" } else { "t" }, p.tw_mm, "mm"),
                        ],
                        Some(u.a_w),
                        "-",
                        vec![format!("a_w = {} en a_f = {}.", nl(u.a_w, 3), nl(u.a_f, 3))],
                    ));
                    variables.push(nv("a_w", u.a_w, "-"));
                    variables.push(nv("a_f", u.a_f, "-"));
                }
                Interactievorm::RondeBuis => {
                    deelstappen.push(stap(
                        "ring",
                        "Plastische interactie van de buiswand",
                        r"M_{N,Rd}/M_{pl,Rd}",
                        "art. 6.2.9.1(2)",
                        r"n = 1 - \frac{2 A_s(c)}{A}, \quad \frac{M_{N,Rd}}{M_{pl,Rd}} = \frac{S_s(c)}{S_s(0)}".to_string(),
                        String::new(),
                        vec![nv("d", p.h_mm, "mm"), nv("t", p.tw_mm, "mm"), nv("n", u.n, "-")],
                        Some(u.ring_m),
                        "-",
                        vec![format!(
                            "§6.2.9.1(5) geeft voor de ronde buis geen benadering; M_N,Rd is \
                             daarom exact afgeleid volgens lid (2). Volledig plastisch staat de \
                             wand aan één kant van een rechte neutrale lijn op +f_y en aan de \
                             andere kant op −f_y; A_s en S_s zijn oppervlak en statisch moment van \
                             het deel voorbij die lijn. De lijn ligt hier op c = {}·R van het \
                             midden. Met α = β = 2 uit lid (6) en M_N,y,Rd = M_N,z,Rd is (6.41) de \
                             toets op het resulterende moment M_Ed = √(M_y,Ed² + M_z,Ed²).",
                            nl(u.ring_c, 4)
                        )],
                    ));
                }
                // Massieve rechthoek: (6.32) heeft geen hulpgrootheid zoals a;
                // de reductie volgt hieronder rechtstreeks uit n.
                Interactievorm::Rechthoek | Interactievorm::Lineair(_) => {}
            }

            // M_N,y,Rd en M_N,z,Rd.
            if ronde_buis {
                formule = r"M_{Ed} \leq M_{N,Rd} = M_{pl,Rd} \cdot \frac{S_s(c)}{S_s(0)}".to_string();
                waarde = u.m_n_y;
                eenheid = "kNm";
                variables.push(nv(r"M_{Ed}", u.m_res, "kNm"));
                variables.push(nv(r"M_{pl,Rd}", u.m_pl_y, "kNm"));
                deelstappen.push(stap(
                    "m_n_rd",
                    "Gereduceerde momentweerstand",
                    r"M_{N,Rd}",
                    "art. 6.2.9.1(2)",
                    r"M_{N,Rd} = M_{pl,Rd} \cdot \frac{S_s(c)}{S_s(0)}".to_string(),
                    format!(r"M_{{N,Rd}} = {} \cdot {}", lx(u.m_pl_y, 3), lx(u.ring_m, 4)),
                    vec![nv(r"M_{pl,Rd}", u.m_pl_y, "kNm")],
                    Some(u.m_n_y),
                    "kNm",
                    vec![],
                ));
                deelstappen.push(stap(
                    "m_ed",
                    "Resulterend moment",
                    r"M_{Ed}",
                    "art. 6.2.9.1(6)",
                    r"M_{Ed} = \sqrt{M_{y,Ed}^2 + M_{z,Ed}^2}".to_string(),
                    format!(r"M_{{Ed}} = \sqrt{{{}^2 + {}^2}}", lx(k.my, 3), lx(k.mz, 3)),
                    vec![nv(r"M_{y,Ed}", k.my, "kNm"), nv(r"M_{z,Ed}", k.mz, "kNm")],
                    Some(u.m_res),
                    "kNm",
                    vec![],
                ));
            } else {
                let (fy_formule, fy_art, fz_formule, fz_art) = match vorm {
                    Interactievorm::I => (
                        r"M_{N,y,Rd} = M_{pl,y,Rd} \cdot \frac{1 - n}{1 - 0{,}5 a} \leq M_{pl,y,Rd}",
                        "art. 6.2.9.1(5) (6.36)",
                        if u.n <= u.a {
                            r"M_{N,z,Rd} = M_{pl,z,Rd} \quad (n \leq a)"
                        } else {
                            r"M_{N,z,Rd} = M_{pl,z,Rd} \left[ 1 - \left( \frac{n - a}{1 - a} \right)^2 \right] \quad (n > a)"
                        },
                        if u.n <= u.a { "art. 6.2.9.1(5) (6.37)" } else { "art. 6.2.9.1(5) (6.38)" },
                    ),
                    Interactievorm::U => (
                        r"M_{N,y,Rd} = M_{pl,y,Rd}",
                        "art. 6.2.9.1(4)",
                        r"M_{N,z,Rd} = M_{pl,z,Rd}",
                        "art. 6.2.9.1(4)",
                    ),
                    Interactievorm::Rechthoek => (
                        r"M_{N,y,Rd} = M_{pl,y,Rd} \left[ 1 - n^2 \right]",
                        "art. 6.2.9.1(3) (6.32)",
                        r"M_{N,z,Rd} = M_{pl,z,Rd} \left[ 1 - n^2 \right]",
                        "art. 6.2.9.1(3) (6.32)",
                    ),
                    _ => (
                        r"M_{N,y,Rd} = M_{pl,y,Rd} \cdot \frac{1 - n}{1 - 0{,}5 a_w} \leq M_{pl,y,Rd}",
                        "art. 6.2.9.1(5) (6.39)",
                        r"M_{N,z,Rd} = M_{pl,z,Rd} \cdot \frac{1 - n}{1 - 0{,}5 a_f} \leq M_{pl,z,Rd}",
                        "art. 6.2.9.1(5) (6.40)",
                    ),
                };
                let ingevuld_y = match vorm {
                    Interactievorm::I if u.vrij_y != Some(true) => format!(
                        r"M_{{N,y,Rd}} = {} \cdot \frac{{1 - {}}}{{1 - 0{{,}}5 \cdot {}}}",
                        lx(u.m_pl_y, 3),
                        lx(u.n, 4),
                        lx(u.a, 4)
                    ),
                    Interactievorm::Koker | Interactievorm::GelasteKoker => format!(
                        r"M_{{N,y,Rd}} = {} \cdot \frac{{1 - {}}}{{1 - 0{{,}}5 \cdot {}}}",
                        lx(u.m_pl_y, 3),
                        lx(u.n, 4),
                        lx(u.a_w, 4)
                    ),
                    Interactievorm::Rechthoek => format!(
                        r"M_{{N,y,Rd}} = {} \left[ 1 - {}^2 \right]",
                        lx(u.m_pl_y, 3),
                        lx(u.n, 4)
                    ),
                    _ => String::new(),
                };
                let mut notities_y = Vec::new();
                if matches!(vorm, Interactievorm::I) && u.vrij_y == Some(true) {
                    notities_y.push(
                        "Vrijgesteld volgens §6.2.9.1(4): M_N,y,Rd = M_pl,y,Rd.".to_string(),
                    );
                } else if u.m_n_y >= u.m_pl_y && u.n <= 1.0 {
                    notities_y.push(
                        "(1 − n)/(1 − 0,5·a) ≥ 1: de bovengrens M_pl,y,Rd van de formule geldt, \
                         er is (nog) geen reductie."
                            .to_string(),
                    );
                }
                deelstappen.push(stap(
                    "m_n_y_rd",
                    "Gereduceerde momentweerstand om de y-as",
                    r"M_{N,y,Rd}",
                    fy_art,
                    fy_formule.to_string(),
                    ingevuld_y,
                    vec![nv(r"M_{pl,y,Rd}", u.m_pl_y, "kNm"), nv("n", u.n, "-")],
                    Some(u.m_n_y),
                    "kNm",
                    notities_y,
                ));
                if k.mz > 0.0 {
                    let ingevuld_z = match vorm {
                        Interactievorm::I if u.vrij_z != Some(true) && u.n > u.a => format!(
                            r"M_{{N,z,Rd}} = {} \left[ 1 - \left( \frac{{{} - {}}}{{1 - {}}} \right)^2 \right]",
                            lx(u.m_pl_z, 3),
                            lx(u.n, 4),
                            lx(u.a, 4),
                            lx(u.a, 4)
                        ),
                        Interactievorm::Koker | Interactievorm::GelasteKoker => format!(
                            r"M_{{N,z,Rd}} = {} \cdot \frac{{1 - {}}}{{1 - 0{{,}}5 \cdot {}}}",
                            lx(u.m_pl_z, 3),
                            lx(u.n, 4),
                            lx(u.a_f, 4)
                        ),
                        Interactievorm::Rechthoek => format!(
                            r"M_{{N,z,Rd}} = {} \left[ 1 - {}^2 \right]",
                            lx(u.m_pl_z, 3),
                            lx(u.n, 4)
                        ),
                        _ => String::new(),
                    };
                    deelstappen.push(stap(
                        "m_n_z_rd",
                        "Gereduceerde momentweerstand om de z-as",
                        r"M_{N,z,Rd}",
                        fz_art,
                        fz_formule.to_string(),
                        ingevuld_z,
                        vec![nv(r"M_{pl,z,Rd}", u.m_pl_z, "kNm"), nv("n", u.n, "-")],
                        Some(u.m_n_z),
                        "kNm",
                        vec![],
                    ));
                }
                variables.push(nv(r"M_{y,Ed}", k.my, "kNm"));
                variables.push(nv(r"M_{pl,y,Rd}", u.m_pl_y, "kNm"));
                if k.mz > 0.0 {
                    variables.push(nv(r"M_{z,Ed}", k.mz, "kNm"));
                    variables.push(nv(r"M_{pl,z,Rd}", u.m_pl_z, "kNm"));
                }
                if biaxiaal {
                    formule = r"\left[ \frac{M_{y,Ed}}{M_{N,y,Rd}} \right]^{\alpha} + \left[ \frac{M_{z,Ed}}{M_{N,z,Rd}} \right]^{\beta} \leq 1".to_string();
                    waarde = u.lhs;
                    eenheid = "-";
                    let (herkomst_ab, ab_formule) = match vorm {
                        Interactievorm::I => ("I- en H-profielen: α = 2, β = 5n ≥ 1", r"\alpha = 2, \quad \beta = 5n \geq 1"),
                        Interactievorm::Rechthoek => (
                            "massieve rechthoek: lid (6) geeft voor deze vorm geen α en β, dus de \
                             conservatieve waarde α = β = 1",
                            r"\alpha = \beta = 1",
                        ),
                        _ => (
                            "kokers: α = β = 1,66/(1 − 1,13n²) ≤ 6",
                            r"\alpha = \beta = \frac{1{,}66}{1 - 1{,}13 n^2} \leq 6",
                        ),
                    };
                    deelstappen.push(stap(
                        "alpha_beta",
                        "Exponenten van de tweeassige interactie",
                        r"\beta",
                        "art. 6.2.9.1(6)",
                        ab_formule.to_string(),
                        String::new(),
                        vec![nv("n", u.n, "-"), nv(r"\alpha", u.alpha, "-")],
                        Some(u.beta),
                        "-",
                        vec![format!("{herkomst_ab}; hier α = {} en β = {}.", nl(u.alpha, 3), nl(u.beta, 3))],
                    ));
                    deelstappen.push(stap(
                        "6_41",
                        "Buiging om twee assen",
                        r"\Sigma",
                        "art. 6.2.9.1(6) (6.41)",
                        formule.clone(),
                        if u.n <= 1.0 {
                            format!(
                                r"\left[ \frac{{{}}}{{{}}} \right]^{{{}}} + \left[ \frac{{{}}}{{{}}} \right]^{{{}}}",
                                lx(k.my, 3),
                                lx(u.m_n_y, 3),
                                lx(u.alpha, 3),
                                lx(k.mz, 3),
                                lx(u.m_n_z, 3),
                                lx(u.beta, 3)
                            )
                        } else {
                            String::new()
                        },
                        vec![],
                        Some(u.lhs),
                        "-",
                        vec![],
                    ));
                } else if k.mz > 0.0 {
                    formule = format!(r"M_{{z,Ed}} \leq M_{{N,z,Rd}}, \quad {fz_formule}");
                    waarde = u.m_n_z;
                    eenheid = "kNm";
                } else {
                    formule = format!(r"M_{{y,Ed}} \leq M_{{N,y,Rd}}, \quad {fy_formule}");
                    waarde = u.m_n_y;
                    eenheid = "kNm";
                }
            }
        }
    }

    // ── De unity check ──────────────────────────────────────────────────────
    let biaxiaal = !ronde_buis && k.my > 0.0 && k.mz > 0.0;
    let (uc_ed, uc_rd, uc_formule): (f64, f64, String) = if !u.voldoet {
        (uc, 1.0, r"1/\lambda".to_string())
    } else {
        match (u.criterium, klasse_12(klasse)) {
            (Criterium::Plastisch, true) if ronde_buis => (u.m_res, u.m_n_y, r"M_{Ed} / M_{N,Rd}".to_string()),
            (Criterium::Plastisch, true) if biaxiaal => (uc, 1.0, r"1/\mu".to_string()),
            (Criterium::Plastisch, true) if k.mz > 0.0 => (k.mz, u.m_n_z, r"M_{z,Ed} / M_{N,z,Rd}".to_string()),
            (Criterium::Plastisch, true) => (k.my, u.m_n_y, r"M_{y,Ed} / M_{N,y,Rd}".to_string()),
            _ => (u.lhs, 1.0, r"\Sigma".to_string()),
        }
    };
    let uc_toelichting = if !u.voldoet {
        format!(
            "Het criterium voldoet niet. De unity check is de EVENREDIGE overschrijding: alle \
             snedekrachten (N, V en M) moeten samen door {} worden gedeeld om op de \
             interactiegrens uit te komen. Dat getal is eindig, is precies 1,0 op de grens en is \
             nooit kleiner dan n; M_Ed/M_N,Rd zou bij n → 1 naar oneindig lopen en bij n > 1 \
             betekenisloos worden.",
            nl(uc, 3)
        )
    } else if biaxiaal && u.criterium == Criterium::Plastisch && klasse_12(klasse) {
        format!(
            "Buiging om twee assen: het linkerlid van (6.41) is {} ≤ 1. De unity check {} is de \
             omgekeerde van de factor μ waarmee M_y,Ed en M_z,Ed samen, bij dezelfde N_Ed, tot de \
             grens van (6.41) kunnen groeien; voor buiging om één as is dat precies M_Ed/M_N,Rd.",
            nl(u.lhs, 3),
            nl(uc, 3)
        )
    } else {
        String::new()
    };
    if !uc_toelichting.is_empty() {
        notes.push(uc_toelichting.clone());
    }
    deelstappen.push(stap(
        "uc",
        "Unity check",
        "UC",
        if soort.met_dwarskracht() { "art. 6.2.10" } else { "art. 6.2.9" },
        uc_formule.clone(),
        String::new(),
        vec![],
        Some(uc),
        "-",
        if uc_toelichting.is_empty() { vec![] } else { vec![uc_toelichting] },
    ));

    let artikel = match (soort, u.criterium, klasse_12(klasse)) {
        (Interactiesoort::BuigingNormaalDwars, ..) => "art. 6.2.10".to_string(),
        (_, Criterium::Elastisch, _) | (_, _, false) => "art. 6.2.9.2 (6.42)".to_string(),
        (_, Criterium::Lineair, _) => "art. 6.2.9 / 6.2.1(7) (6.2)".to_string(),
        (_, Criterium::Plastisch, _) => match vorm {
            Interactievorm::I if biaxiaal => "art. 6.2.9.1 (6.36)–(6.38), (6.41)".to_string(),
            Interactievorm::I => "art. 6.2.9.1 (6.36)–(6.38)".to_string(),
            Interactievorm::Koker | Interactievorm::GelasteKoker if biaxiaal => {
                "art. 6.2.9.1 (6.39)–(6.41)".to_string()
            }
            Interactievorm::Koker | Interactievorm::GelasteKoker => "art. 6.2.9.1 (6.39)/(6.40)".to_string(),
            Interactievorm::RondeBuis => "art. 6.2.9.1(2)".to_string(),
            Interactievorm::Rechthoek if biaxiaal => "art. 6.2.9.1 (6.32), (6.41)".to_string(),
            Interactievorm::Rechthoek => "art. 6.2.9.1(3) (6.32)".to_string(),
            Interactievorm::U => "art. 6.2.9.1(4)".to_string(),
            Interactievorm::Lineair(_) => "art. 6.2.1(7) (6.2)".to_string(),
        },
    };

    ResistanceCalc {
        deelstappen,
        id: soort.id().to_string(),
        title: titel,
        article: artikel,
        force_state,
        formula_latex: formule,
        variables,
        value: waarde,
        unit: eenheid.to_string(),
        uc: Some(UnityCheck { ed: uc_ed, rd: uc_rd, uc, formula_latex: uc_formule }),
        status,
        notes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    /// De ring met een kleine binnenstraal valt samen met de massieve
    /// cirkel (sin³β), en een dunne ring met cos(πn/2).
    #[test]
    fn ring_grensgevallen() {
        // Volle cirkel, β = π/3: n = 0,608998, m = (√3/2)³ = 0,649519.
        let (_, m) = ring_interactie(0.608_997_79, 30.0, 15.0);
        assert_relative_eq!(m, 0.649_519, max_relative = 1e-5);
        // Dunne ring: m → cos(πn/2); bij t/d = 1/2000 binnen 0,05 %.
        for n in [0.2, 0.5, 0.8] {
            let (_, m) = ring_interactie(n, 1000.0, 0.5);
            assert_relative_eq!(m, (PI * n / 2.0).cos(), max_relative = 5e-4);
        }
        assert_eq!(ring_interactie(0.0, 100.0, 5.0), (0.0, 1.0));
        assert_eq!(ring_interactie(1.0, 100.0, 5.0), (1.0, 0.0));
    }

    /// Eén punt van de ring met de hand: R = 10, r = 8, c = 5.
    ///   A      = π(100 − 64) = 113,0973
    ///   A_s(R) = 100·acos(0,5) − 5·√75 = 104,7198 − 43,3013 = 61,4185
    ///   A_s(r) = 64·acos(0,625) − 5·√39 = 64·0,895665 − 31,2250 = 26,0976
    ///   n      = 1 − 2·(61,4185 − 26,0976)/113,0973 = 0,375389
    ///   S_s    = ⅔(75^1,5 − 39^1,5) = ⅔(649,5191 − 243,5549) = 270,6428
    ///   S_s(0) = ⅔(1000 − 512) = 325,3333
    ///   m      = 270,6428/325,3333 = 0,831894
    #[test]
    fn ring_punt_met_de_hand() {
        let (n, m) = ring_n_m(10.0, 8.0, 5.0);
        assert_relative_eq!(n, 0.375_389, max_relative = 1e-5);
        assert_relative_eq!(m, 0.831_894, max_relative = 1e-5);
        let (c, m2) = ring_interactie(n, 20.0, 2.0);
        assert_relative_eq!(c, 0.5, max_relative = 1e-9);
        assert_relative_eq!(m2, m, max_relative = 1e-9);
    }

    /// De evenredige UC van een lineair criterium is het linkerlid zelf.
    #[test]
    fn evenredige_uc_van_een_lineair_criterium() {
        // n + m ≤ 1 met n = 0,9 en m = 0,6: UC = 1,5.
        let uc = evenredige_uc(|l| 0.9 * l + 0.6 * l <= 1.0);
        assert_relative_eq!(uc, 1.5, max_relative = 1e-12);
    }

    /// 1/μ bij α = β is de α-norm van de twee verhoudingen.
    #[test]
    fn uc_6_41_bij_gelijke_exponenten() {
        let uc = uc_6_41(0.6, 0.8, 2.0, 2.0);
        assert_relative_eq!(uc, 1.0, max_relative = 1e-12);
        let uc = uc_6_41(0.3, 0.0, 2.0, 1.0);
        assert_relative_eq!(uc, 0.3, max_relative = 1e-12);
    }
}
