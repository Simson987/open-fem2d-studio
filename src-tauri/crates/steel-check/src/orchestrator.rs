//! Top-level orchestrator: take BeamCheckInput, run all EN 1993 checks,
//! return BeamCheckResult with full derivation trace.

use crate::deflection::check_deflection_pair_met_w_add;
use crate::input::{
    reden_knik_geen_druk, reden_lijfplooi, BeamCheckInput, CustomDoorsnedevorm, CustomSection,
    Staafeind, Staafeinden, MELDING_AANSLUITING_HOEKPROFIEL, MELDING_AFSCHUIVING_HOEKPROFIEL,
    MELDING_AFSCHUIVING_RONDSTAAL, MELDING_BUIGING_HOEKPROFIEL, MELDING_BUIGING_RONDSTAAL,
    MELDING_DOORSNEDE_STRIP, MELDING_INTERACTIE_RONDSTAAL, MELDING_INTERACTIE_STRIP,
    MELDING_KNIK_HOOFDASSEN, MELDING_KNIK_RONDSTAAL, MELDING_KNIK_STRIP,
    MELDING_KOKER_WARMVERVAARDIGD, MELDING_TREK_ALLEEN, MELDING_TREK_RONDSTAAL, MELDING_TREK_STRIP,
    Draadeind, MELDING_VORM_NIET_CONTROLEERBAAR, NIET_VOLLEDIG_GETOETST, REDEN_GESLOTEN_CEL_NIET_GEDECLAREERD,
    REDEN_INTERACTIE_GEEN_DRUK, REDEN_INTERACTIE_ZONDER_KIP, REDEN_KIP_HOEKPROFIEL,
    REDEN_KIP_NIET_DUBBELSYMMETRISCH, REDEN_KIP_NVT_CHS, REDEN_KIP_NVT_RONDSTAAL, REDEN_KIP_NVT_STRIP,
    REDEN_KIP_STRIP_STERKE_AS, REDEN_KLASSE_4, TOETS_TREK_ALLEEN,
};
use crate::result::{BeamCheckResult, CheckKind, NamedCheck};
use mechanics::{ForcePoint, ForceStateSnapshot, InternalForces, Staafstand};
use nen_en_1993_1_1_ltb::{
    m_b_rd_channel_met_veld, m_b_rd_met_veld, KipWeerstandsmoment, Kipprofiel, Kipveld,
};
use nen_en_1993_1_1_section::{
    bending::{m_y_c_rd, m_z_c_rd},
    classification::{
        classify_composite, classify_section, epsilon, CrossSectionClass, SectionShape,
    },
    combined_mv::check_combined_mv,
    compression::n_c_rd,
    effectief::{self, effectieve_doorsnede, EffectieveDoorsnede, Klasse4Vorm},
    grade_by_name,
    interactie::{buiging_en_normaalkracht, Interactiesoort, Interactievorm},
    rond::{combinatie_rond, RondCombinatie},
    shear::{v_y_c_rd, v_z_c_rd},
    trek::{n_t_rd, n_t_rd_draadeind, TOETS_DRAADEIND, TOETS_TREK},
    wringing::{self, TOETS_WRINGING, TOETS_WRINGING_NM},
    CheckStatus, NamedValue, ResistanceCalc, SteelGrade,
};
use nen_en_1993_1_1_stability::{
    buckling_curve::BucklingCurve,
    column_buckling::{n_b_rd, n_b_rd_klasse4, Knikas, Knikassen},
    combined_n_m::{check_combined_n_my, check_combined_n_mz},
    interaction_factors::{cm_uit_momentenlijn, interaction_factors_method_2, CmUitkomst},
    kniklengte::{bepaal_kniklengte, Kniklengte, KniklengteHerkomst, Steunen, Steunrand},
    StabilityCalc,
};
use section_properties::SectionProperties;
use steel_profiles::{db, ProfileKind};

/// Find the force point that maximises `score(forces)`.
/// Falls back to a zero-force point if the envelope is empty.
fn governing_for<F>(env: &[ForcePoint], score: F) -> ForcePoint
where
    F: Fn(&InternalForces) -> f64,
{
    if env.is_empty() {
        return ForcePoint {
            combination_id: 0,
            position_mm: 0.0,
            forces: Default::default(),
        };
    }
    let mut best = env[0];
    let mut best_score = score(&best.forces);
    for p in &env[1..] {
        let s = score(&p.forces);
        if s > best_score {
            best = *p;
            best_score = s;
        }
    }
    best
}

/// Linear interpolation of M_y at a given position within an unbraced segment.
/// Filters envelope to `combo_id`, sorts by position, and interpolates.
fn interpolate_my_at(envelope: &[ForcePoint], position_mm: f64, combo_id: u32) -> f64 {
    let mut pts: Vec<&ForcePoint> = envelope
        .iter()
        .filter(|p| p.combination_id == combo_id)
        .collect();
    if pts.is_empty() {
        // Fall back to all points if no points match the combination
        pts = envelope.iter().collect();
    }
    pts.sort_by(|a, b| a.position_mm.partial_cmp(&b.position_mm).unwrap());
    if pts.is_empty() {
        return 0.0;
    }
    if pts.len() == 1 {
        return pts[0].forces.my_ed;
    }
    let first = pts[0];
    let last = pts[pts.len() - 1];
    if position_mm <= first.position_mm {
        return first.forces.my_ed;
    }
    if position_mm >= last.position_mm {
        return last.forces.my_ed;
    }
    for w in pts.windows(2) {
        let (a, b) = (w[0], w[1]);
        if position_mm >= a.position_mm && position_mm <= b.position_mm {
            let span = (b.position_mm - a.position_mm).max(1e-9);
            let t = (position_mm - a.position_mm) / span;
            return a.forces.my_ed + t * (b.forces.my_ed - a.forces.my_ed);
        }
    }
    last.forces.my_ed
}

/// Plakt de toelichtingen van de aanroeper achter die van de toets zelf.
///
/// Ze horen bij w_fin, want daar zit `deflection_actual_max_mm` in; w_add is
/// eruit afgeleid en erft de aanname. Zie
/// [`BeamCheckInput::deflection_notes`](crate::BeamCheckInput) voor waarom dit
/// kanaal bestaat.
/// w_fin en w_add van de staaf, of van het deel dat de invoerbouwer aanwijst
/// (`deflection_length_m`, bij een doorgaande lijn met een overstek), met de
/// door de bouwer per combinatie bepaalde w_add als die er is
/// (`deflection_add_mm`). Beide velden zijn al gekeurd
/// ([`crate::deflection::keur_doorbuigingsdeel`]).
fn doorbuigingstoetsen(input: &BeamCheckInput) -> (ResistanceCalc, ResistanceCalc) {
    let lengte_m = input.deflection_length_m.unwrap_or(input.length_m);
    let (mut fin, mut add) = check_deflection_pair_met_w_add(
        input.deflection_actual_max_mm,
        input.pre_camber_mm,
        input.deflection_permanent_mm,
        lengte_m,
        input.deflection_limit_class,
        input.deflection_limit_numerator,
        input.deflection_add_limit_numerator,
        input.is_cantilever,
        input.deflection_add_mm,
    );
    if input.deflection_length_m.is_some() {
        let tekst = format!(
            "Getoetst deel: {} mm van de staaflengte {} mm — de invoerbouwer heeft de doorbuiging \
             op dit deel gemeten (zie de toelichting hieronder), en de grens rekent met de lengte \
             van dat deel (NEN-EN 1990:2002/NB:2019 A1.4.3: ℓ_rep is de lengte van de overspanning \
             of tweemaal die van de uitkraging).",
            nl_getal(lengte_m * 1000.0),
            nl_getal(input.length_m * 1000.0),
        );
        fin.notes.push(tekst.clone());
        add.notes.push(tekst);
    }
    (fin, add)
}

fn met_invoernotities(mut check: ResistanceCalc, input: &BeamCheckInput) -> ResistanceCalc {
    check.notes.extend(input.deflection_notes.iter().cloned());
    check
}

fn make_resistance(check: ResistanceCalc) -> NamedCheck {
    NamedCheck {
        id: check.id.clone(),
        kind: CheckKind::Resistance(check),
    }
}

fn make_stability(check: StabilityCalc) -> NamedCheck {
    NamedCheck {
        id: check.id.clone(),
        kind: CheckKind::Stability(check),
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//  D4.3 — de doorsnede resolveren en de weigeringen hard programmeren
// ═══════════════════════════════════════════════════════════════════════════

/// η uit NEN-EN 1993-1-1 6.2.6(3): 1,2 voor staalsoorten t/m S460. Zelfde
/// waarde als `CompositeSection::eta_schuif` in de rekenkern.
const ETA_SCHUIF: f64 = 1.2;

/// Een dwarskracht tot deze grootte (kN) telt als nul: numerieke ruis uit de
/// solver mag een staaf niet "niet volledig getoetst" maken.
const V_NUL_KN: f64 = 1e-6;

/// Hetzelfde voor de normaalkracht (kN) en het moment om y (kNm) bij een
/// geweigerde knik- of kiptoets aan een doorlopend staafeind: een zuiver
/// gedrukte staaf kreeg zo door M = 6,6·10⁻¹⁸ kNm "niet volledig getoetst"
/// (review van de samenvoeging 2026.42).
const N_NUL_KN: f64 = 1e-6;
const M_NUL_KNM: f64 = 1e-6;

/// De doorsnede waarop getoetst wordt, plus wat er níet gerekend mag worden.
///
/// Voor het databasepad zijn alle weigeringsvelden `None`: D4.3 verandert
/// niets aan het gedrag van een catalogusprofiel. De weigeringen gelden voor
/// het inline pad, waar de doorsnede geen catalogusgeschiedenis heeft en de
/// aannames van de formules dus niet vanzelf opgaan.
struct Doorsnede {
    naam: String,
    props: SectionProperties,
    klasse: CrossSectionClass,
    curve_y: BucklingCurve,
    curve_z: BucklingCurve,
    /// Welke rij van tabel 6.2 de twee knikkrommen levert, als tekst voor de
    /// afleiding van 6.3.1.
    kromme_toelichting: String,
    is_channel: bool,
    /// Gesloten doorsnede (koker of buis). Zo'n staaf is volgens bijlage B
    /// "niet gevoelig voor vervormingen door torsie": de interactiefactoren
    /// komen dan uit tabel B.1, ook als de (behoudende) kipcontrole een
    /// χ_LT < 1 geeft.
    gesloten: bool,
    /// Welke rij van tabel 6.5 de kipkromme levert (art. 6.3.2.3). Dit is een
    /// ANDERE tabel dan de 6.2 waar `curve_y`/`curve_z` uit komen: die gaan
    /// over kolomknik en hebben de grens h/b = 1,2, tabel 6.5 gaat over kip en
    /// heeft de grens h/b = 2.
    kip_profielsoort: Kipprofiel,
    /// Reden waarom kip 6.3.2 (en daarmee 6.3.3) niet gerekend mag worden.
    kip_weigering: Option<String>,
    /// Reden waarom de schuiftoets om de z-as (en M+V, M+N+V) niet mag draaien.
    schuif_weigering: Option<String>,
    /// Reden waarom géén enkele weerstands- of stabiliteitstoets mag draaien.
    totaal_weigering: Option<String>,
    /// De vorm waarvoor bij klasse 4 de effectieve doorsnede volgens
    /// NEN-EN 1993-1-5 4.4 bepaald kan worden (zie `effectief`); `None` voor
    /// elke andere vorm.
    klasse4_vorm: Option<Klasse4Vorm>,
    /// Losse meldingen die als eigen regel in de checklijst landen.
    meldingen: Vec<(&'static str, &'static str, String)>,
    /// Notities die bij de kipcontrole horen als die wél draait.
    kip_notities: Vec<String>,
    /// Om welke assen §6.3.1 de slankheid bepaalt. Voor elke doorsnede met een
    /// symmetrieas zijn dat de eigen assen y-y en z-z; voor een hoekprofiel de
    /// hoofdassen u-u en v-v (par. 1.7(2), OPMERKING).
    knikassen: Knikassen,
    /// Notities die aan een bestaande toets worden geplakt: `(toets-id,
    /// tekst)`. Zo staat een beperking BIJ de toets waarop zij slaat en niet
    /// alleen in een commentaarregel of in een losse melding onderaan.
    toets_notities: Vec<(&'static str, String)>,
    /// Waarom kip 6.3.2 NIET VAN TOEPASSING is — iets anders dan
    /// `kip_weigering`: de toets staat met deze reden als "n.v.t." in de lijst,
    /// maar 6.3.3 draait gewoon door met χ_LT = 1,0. Alleen gevuld bij massief
    /// rond staal.
    kip_nvt: Option<String>,
    /// De diameter (mm) als de doorsnede massief rond staal is; `None` voor
    /// elke andere doorsnede. Stuurt de trektoetsen (6.2.3 en het draadeind)
    /// en de combinatietoetsen van een volle cirkel.
    rond_d_mm: Option<f64>,
    /// Welke regel van §6.2.9 bij deze doorsnede hoort (6.2.9 en 6.2.10; niet
    /// voor massief rond, dat zijn eigen uitwerking heeft).
    interactievorm: Interactievorm,
    /// Hoe 6.2.7 (wringing) bij deze doorsnede getoetst wordt; zie
    /// [`Wringingvorm`].
    wringing: Wringingvorm,
}

/// Hoe de wringing van NEN-EN 1993-1-1 6.2.7 bij een doorsnede getoetst wordt.
///
/// Issue #249: tot oktober 2026 kende de staaltoets 6.2.7 niet, en een CHS
/// 88,9×4 met |T_Ed| = 6,75 kNm (UC 1,15) kreeg status Ok met UC 0.
enum Wringingvorm {
    /// Saint-Venant-wringing, τ_t,Ed = T_Ed/W_t: gesloten doorsneden (welving
    /// verwaarloosbaar, 6.2.7(7)) en massieve of dunwandige doorsneden zonder
    /// noemenswaardige welving (rond, strip, hoeklijn). Met (6.23),
    /// V_pl,T,Rd volgens (6.28) in 6.2.6, 6.2.8 en 6.2.10, en de vloeigrens
    /// naast τ_t,Ed volgens 6.2.1(5) in een eigen toets op buiging en
    /// normaalkracht.
    SaintVenant { w_t_mm3: f64, toelichting: String },
    /// Niet te toetsen, met de reden: een open doorsnede waarin de welving de
    /// wringing draagt (I, U) of een doorsnede zonder bekende W_t. Bij
    /// T_Ed ≠ 0 is de staaf dan NIET VOLLEDIG GETOETST.
    Niet(String),
}

/// Een wringend moment tot deze grootte (kNm) telt als nul (rekenruis).
const T_NUL_KNM: f64 = 1e-6;

/// De reden waarom 6.2.7 bij een open I- of U-doorsnede niet getoetst wordt.
const REDEN_WRINGING_OPEN: &str = "Wringing (NEN-EN 1993-1-1 6.2.7) niet getoetst: in een open \
     I- of U-doorsnede wordt het wringend moment volgens 6.2.7(7) hoofdzakelijk door welving \
     gedragen, en het bimoment B_Ed met de welvingsspanningen σ_w,Ed en τ_w,Ed (6.2.7(4)) komt \
     niet uit een staafanalyse met zes vrijheidsgraden per knoop. Ook de vermindering van de \
     dwarskrachtweerstand tot V_pl,T,Rd (6.26)/(6.27) is daarom niet toegepast. Toets de wringing \
     apart of voorkom haar constructief.";

impl Wringingvorm {
    /// De vorm voor een catalogusprofiel.
    fn catalogus(kind: ProfileKind, p: &SectionProperties, g: &steel_profiles::ProfileGeometry) -> Self {
        let it = p.it_mm4;
        if !(it.is_finite() && it > 0.0) {
            return Wringingvorm::Niet(
                "Wringing (6.2.7) niet getoetst: de catalogus geeft voor dit profiel geen I_t."
                    .to_string(),
            );
        }
        match kind {
            ProfileKind::Chs => Wringingvorm::SaintVenant {
                w_t_mm3: wringing::w_t_rond(it, p.h_mm),
                toelichting: format!(
                    "Ronde buis: W_t = 2·I_t/D = 2·{}/{} (τ_t = T·r/I_t; EN 10210-2 bijlage B, \
                     C_t = 2·W_el). Gesloten doorsnede: welving verwaarloosd (6.2.7(7)).",
                    nl_getal(it),
                    nl_getal(p.h_mm)
                ),
            },
            ProfileKind::RoundBar => Wringingvorm::SaintVenant {
                w_t_mm3: wringing::w_t_rond(it, p.h_mm),
                toelichting: format!(
                    "Massief rond: W_t = 2·I_t/d = π·d³/16 met I_t = {} mm⁴ en d = {} mm; een \
                     cirkel welft niet.",
                    nl_getal(it),
                    nl_getal(p.h_mm)
                ),
            },
            ProfileKind::Shs | ProfileKind::Rhs => {
                let t = g.t.max(p.tw_mm);
                Wringingvorm::SaintVenant {
                    w_t_mm3: wringing::w_t_koker(it, p.h_mm, p.b_mm, t, 1.25 * t),
                    toelichting: format!(
                        "Koker: W_t = C_t = I_t/(t + K/t) volgens EN 10210-2 bijlage B, met \
                         R_c = 1,25·t (r_o = 1,5·t, r_i = 1,0·t) en I_t = {} mm⁴. Gesloten \
                         doorsnede: welving verwaarloosd (6.2.7(7)).",
                        nl_getal(it)
                    ),
                }
            }
            ProfileKind::FlatBar | ProfileKind::Angle => {
                let t = if matches!(kind, ProfileKind::FlatBar) {
                    p.h_mm.min(p.b_mm)
                } else {
                    g.t.max(g.tw).max(g.tf)
                };
                Wringingvorm::SaintVenant {
                    w_t_mm3: wringing::w_t_open(it, t),
                    toelichting: format!(
                        "{}: W_t = I_t/t = {}/{} (τ_max ≤ T·t/I_t, veilige kant). De welving \
                         van deze doorsnede is verwaarloosbaar; alleen Saint-Venant-wringing.",
                        if matches!(kind, ProfileKind::FlatBar) { "Platstaal" } else { "Hoekprofiel" },
                        nl_getal(it),
                        nl_getal(t)
                    ),
                }
            }
            ProfileKind::ISection | ProfileKind::Channel => {
                Wringingvorm::Niet(REDEN_WRINGING_OPEN.to_string())
            }
        }
    }

    fn w_t(&self) -> Option<f64> {
        match self {
            Wringingvorm::SaintVenant { w_t_mm3, .. } => Some(*w_t_mm3),
            Wringingvorm::Niet(_) => None,
        }
    }
}

/// Zit er een wringend moment in de omhullende?
fn heeft_wringing(env: &[ForcePoint]) -> bool {
    env.iter().any(|fp| fp.forces.mt_ed.abs() > T_NUL_KNM)
}

/// V_pl,T,Rd/V_pl,Rd volgens (6.28) op één punt; 1 zonder wringing of als
/// de wringing niet getoetst kan worden. Nooit nul: een V_pl,T,Rd van nul zou
/// in de schuiftoets UC 0 geven; 10⁻³ geeft een UC die "voldoet niet" zegt.
fn factor_v_pl_t(w_t: Option<f64>, grade: &SteelGrade, s: &ForceStateSnapshot) -> f64 {
    match w_t {
        Some(w) if s.forces.mt_ed.abs() > T_NUL_KNM => {
            wringing::factor_v_pl_t_hol(wringing::tau_t_ed_mpa(s.forces.mt_ed, w), grade).max(1e-3)
        }
        _ => 1.0,
    }
}

/// De doorsnede met het afschuifoppervlak maal `k`: V_pl,Rd wordt zo
/// V_pl,T,Rd = k·V_pl,Rd (6.28) in elke toets die V_pl,Rd uit A_v haalt.
fn met_factor_av(p: &SectionProperties, k: f64) -> SectionProperties {
    let mut q = *p;
    q.av_y_mm2 *= k;
    q.av_z_mm2 *= k;
    q
}

/// De tekst bij een toets die met V_pl,T,Rd rekent.
const NOTITIE_V_PL_T: &str = "Wringing: op elk punt met T_Ed ≠ 0 is V_pl,Rd verminderd tot \
     V_pl,T,Rd = (1 − τ_t,Ed/(f_y/(√3·γ_M0)))·V_pl,Rd volgens 6.2.7(9), (6.28); bij 6.2.8 en \
     6.2.10 komt ρ daarmee uit V_pl,T,Rd (6.2.8(4)).";

/// De schuiftoets (`toets` is `v_z_c_rd` of `v_y_c_rd`) met wringing: op elk
/// punt van de omhullende tegen V_pl,T,Rd (6.25)/(6.28). Op het maatgevende
/// punt staat A_v weer bruto in de variabelen, met de factor ernaast.
fn schuif_met_wringing(
    p: &SectionProperties,
    grade: &SteelGrade,
    w_t: f64,
    env: &[ForcePoint],
    terugval: ForceStateSnapshot,
    toets: fn(&SectionProperties, &SteelGrade, ForceStateSnapshot) -> ResistanceCalc,
) -> ResistanceCalc {
    let mut r = maatgevend_over_omhullende(
        env,
        terugval,
        "telkens met V_Ed en T_Ed van dat punt",
        |s| {
            let k = factor_v_pl_t(Some(w_t), grade, &s);
            let mut r = toets(&met_factor_av(p, k), grade, s);
            if k < 1.0 {
                for v in r.variables.iter_mut().filter(|v| v.symbol == "A_v") {
                    v.value /= k;
                }
                r.variables.push(NamedValue {
                    symbol: r"1 - \tau_{t,Ed}/\tau_{Rd}".to_string(),
                    value: k,
                    unit: "-".to_string(),
                });
                r.article = format!("{} met 6.2.7(9) (6.25), (6.28)", r.article);
                r.formula_latex = r"V_{pl,T,Rd} = \left(1 - \frac{\tau_{t,Ed}}{f_y/(\sqrt{3} \cdot \gamma_{M0})}\right) \cdot \frac{A_v \cdot (f_y/\sqrt{3})}{\gamma_{M0}}".to_string();
            }
            r
        },
    );
    r.notes.push(NOTITIE_V_PL_T.to_string());
    r
}

/// De wringtoets (6.23) over de hele omhullende, of de weigering met reden.
/// Zonder wringend moment in de omhullende: niets (de toets komt dan niet in
/// de lijst, en een staaf zonder wringing houdt precies zijn oude uitkomst).
fn wringtoets(
    vorm: &Wringingvorm,
    grade: &SteelGrade,
    env: &[ForcePoint],
    state: ForceStateSnapshot,
) -> Option<NamedCheck> {
    if !heeft_wringing(env) {
        return None;
    }
    Some(match vorm {
        Wringingvorm::SaintVenant { w_t_mm3, toelichting } => {
            let mut r = maatgevend_over_omhullende(env, state, "telkens met T_Ed van dat punt", |s| {
                wringing::t_rd(*w_t_mm3, toelichting, grade, s)
            });
            r.notes.push(
                "Wringing in de stabiliteitstoetsen (6.3) is niet meegenomen; bij een gesloten of \
                 massieve doorsnede is de staaf niet gevoelig voor torsievervorming (bijlage B). \
                 De samenwerking van τ_t,Ed met de normaalspanning uit N en M staat in toets \
                 6.2.7_combined_nmt, met de dwarskracht via V_pl,T,Rd in 6.2.6, 6.2.8 en 6.2.10."
                    .to_string(),
            );
            make_resistance(r)
        }
        Wringingvorm::Niet(reden) => weigering(
            TOETS_WRINGING,
            "Wringing",
            "art. 6.2.7",
            false,
            vec![reden.clone()],
            state,
        ),
    })
}

/// Buiging en normaalkracht naast de wringschuifspanning: de vloeigrens
/// f_y,T = f_y·√(1 − (τ_t,Ed/τ_Rd)²) volgens het vloeicriterium van 6.2.1(5)
/// (6.2.7(5)), op elk punt met T_Ed ≠ 0, in de toets `toets` (6.2.9 of het
/// eigen van massief rond). Bij een gesloten doorsnede met constante
/// wanddikte is τ_t over de wand gelijk, en is dit de exacte plastische
/// ondergrens; bij massief rond, strip en hoek staat τ_max overal: veilige
/// kant. `None` zonder punt met wringing én normaalkracht of moment.
fn buiging_normaal_met_wringing(
    w_t: f64,
    grade: &SteelGrade,
    env: &[ForcePoint],
    toets: impl Fn(&SteelGrade, ForceStateSnapshot) -> ResistanceCalc,
) -> Option<NamedCheck> {
    let punten: Vec<ForcePoint> = env
        .iter()
        .filter(|fp| {
            let f = &fp.forces;
            f.mt_ed.abs() > T_NUL_KNM
                && (f.n_ed.abs() > N_NUL_KN || f.my_ed.abs() > M_NUL_KNM || f.mz_ed.abs() > M_NUL_KNM)
        })
        .cloned()
        .collect();
    let eerste = punten.first()?;
    let terugval = ForceStateSnapshot {
        combination_id: eerste.combination_id,
        position_mm: eerste.position_mm,
        forces: eerste.forces,
    };
    let mut r = maatgevend_over_omhullende(
        &punten,
        terugval,
        "op elk punt met T_Ed ≠ 0, telkens met N, M_y, M_z en T_Ed van dat punt",
        |s| {
            let tau = wringing::tau_t_ed_mpa(s.forces.mt_ed, w_t);
            let fy_t = wringing::fy_onder_wringing(tau, grade).max(1e-3 * grade.fy_mpa);
            let g = SteelGrade { fy_mpa: fy_t, ..*grade };
            let mut r = toets(&g, s);
            r.notes.push(format!(
                "Wringing: τ_t,Ed = {} N/mm², dus f_y,T = f_y·√(1 − (τ_t,Ed/τ_Rd)²) = {}·√(1 − ({}/{})²) \
                 = {} N/mm² voor de normaalspanning (vloeicriterium 6.2.1(5), 6.2.7(5)). De f_y in \
                 deze toets is f_y,T.",
                nl_getal_2(tau),
                nl_getal(grade.fy_mpa),
                nl_getal_2(tau),
                nl_getal_2(wringing::tau_rd_mpa(grade)),
                nl_getal_2(fy_t)
            ));
            r
        },
    );
    r.id = TOETS_WRINGING_NM.to_string();
    r.title = "Buiging en normaalkracht met wringing".to_string();
    r.article = format!("art. 6.2.7(5) met 6.2.1(5); {}", r.article);
    Some(make_resistance(r))
}

/// Plakt een notitie achter de notities van één toets.
pub(crate) fn plak_notitie(c: &mut NamedCheck, tekst: &str) {
    match &mut c.kind {
        CheckKind::Resistance(r) => r.notes.push(tekst.to_string()),
        CheckKind::Stability(s) => s.notes.push(tekst.to_string()),
    }
}

/// Hangt elke notitie aan de toets met dat id. Een id dat niet in de lijst
/// voorkomt wordt overgeslagen — dat gebeurt als een toets al eerder om een
/// andere reden is weggelaten.
fn hang_toets_notities(checks: &mut [NamedCheck], notities: &[(&'static str, String)]) {
    for (id, tekst) in notities {
        for c in checks.iter_mut().filter(|c| c.id == *id) {
            plak_notitie(c, tekst);
        }
    }
}

/// De kanttekening bij elke toets die met de effectieve doorsnede van een
/// klasse 4-doorsnede rekent.
fn klasse4_toelichting(e: &EffectieveDoorsnede, p: &SectionProperties) -> String {
    format!(
        "Klasse 4 (NEN-EN 1993-1-1 6.2.2.5): gerekend met de effectieve doorsnede volgens \
         NEN-EN 1993-1-5 4.4 — A_eff = {} mm² (A = {} mm²), W_eff,y = {} mm³ (W_el,y = {} mm³), \
         W_eff,z = {} mm³ (W_el,z = {} mm³) — en de elastische formules (klasse 3) op die \
         grootheden. De doorsnede is dubbelsymmetrisch: e_N = 0. Stijfheid (I, i, I_t, I_w, N_cr, \
         M_cr) en afschuifoppervlak blijven bruto.",
        nl_getal(e.a_eff_mm2),
        nl_getal(p.area_mm2),
        nl_getal(e.w_eff_y_mm3),
        nl_getal(p.wel_y_mm3),
        nl_getal(e.w_eff_z_mm3),
        nl_getal(p.wel_z_mm3),
    )
}

/// De toetsen waarin f_y (of f_u) rechtstreeks in de formule staat; daar
/// hoort de dikteklasse van tabel 3.1 bij vermeld te worden.
const TOETSEN_MET_F_Y: [&str; 10] = [
    TOETS_TREK,
    TOETS_WRINGING,
    TOETS_DRAADEIND,
    "6.2.4_compression",
    "6.2.5_bending_y",
    "6.2.5_bending_z",
    "6.2.6_shear_z",
    "6.2.6_shear_y",
    "6.3.1_buckling",
    "6.3.2_ltb",
];

/// Plakt de dikteklasse-notitie van tabel 3.1 achter elke GEREKENDE toets uit
/// [`TOETSEN_MET_F_Y`]; een geweigerde toets (`NotApplicable`) blijft ongemoeid.
fn hang_dikte_notitie(checks: &mut [NamedCheck], tekst: &str) {
    for c in checks
        .iter_mut()
        .filter(|c| TOETSEN_MET_F_Y.contains(&c.id.as_str()))
    {
        let gerekend = match &c.kind {
            CheckKind::Resistance(r) => !matches!(r.status, CheckStatus::NotApplicable),
            CheckKind::Stability(s) => !matches!(s.status, CheckStatus::NotApplicable),
        };
        if gerekend {
            plak_notitie(c, tekst);
        }
    }
}

/// De dertien toetsen die bij een weigering met naam en artikel in de lijst
/// blijven staan, zodat het rapport toont wát er niet gerekend is en waarom.
/// De laatste kolom zegt of het een stabiliteitstoets is.
const TOETSEN: [(&str, &str, &str, bool); 13] = [
    (TOETS_TREK, "Trek", "art. 6.2.3", false),
    (
        "6.2.4_compression",
        "Compression",
        "art. 6.2.4 (6.10)",
        false,
    ),
    (
        "6.2.5_bending_y",
        "Bending (y-axis)",
        "art. 6.2.5 (6.12)",
        false,
    ),
    (
        "6.2.5_bending_z",
        "Bending (z-axis)",
        "art. 6.2.5 (6.12)",
        false,
    ),
    ("6.2.6_shear_z", "Shear", "art. 6.2.6 (6.18)", false),
    ("6.2.6_shear_y", "Shear (y-axis)", "art. 6.2.6", false),
    ("6.2.8_combined_mv", "Bending + shear", "art. 6.2.8", false),
    (
        "6.2.9_combined_mn",
        "Bending + axial force",
        "art. 6.2.9",
        false,
    ),
    (
        "6.2.10_combined_mnv",
        "Bending + axial + shear",
        "art. 6.2.10",
        false,
    ),
    (
        "6.3.1_buckling",
        "Column buckling",
        "art. 6.3.1 (6.46)",
        true,
    ),
    // Nederlands, gelijk aan de titel die `m_b_rd` zelf voert: anders heet
    // dezelfde toets in het rapport anders zodra hij geweigerd wordt.
    ("6.3.2_ltb", "Kipweerstand", "art. 6.3.2", true),
    ("6.3.3_eq_6_61", "Combined N+M (6.61)", "art. 6.3.3", true),
    ("6.3.3_eq_6_62", "Combined N+M (6.62)", "art. 6.3.3", true),
];

/// Een geweigerde toets: `CheckStatus::NotApplicable`, géén UC, en de reden in
/// leesbaar Nederlands in `notes`. Nooit een UC van 0,0 die als "voldoet" oogt.
fn weigering(
    id: &str,
    titel: &str,
    artikel: &str,
    stabiliteit: bool,
    redenen: Vec<String>,
    force_state: ForceStateSnapshot,
) -> NamedCheck {
    if stabiliteit {
        NamedCheck {
            id: id.to_string(),
            kind: CheckKind::Stability(StabilityCalc {
                id: id.to_string(),
                title: titel.to_string(),
                article: artikel.to_string(),
                force_state,
                formula_latex: String::new(),
                variables: vec![],
                intermediate_values: vec![],
                // Een geweigerde toets is niet gerekend; er valt niets af te leiden.
                deelstappen: vec![],
                value: 0.0,
                unit: "-".to_string(),
                uc: None,
                status: CheckStatus::NotApplicable,
                notes: redenen,
            }),
        }
    } else {
        NamedCheck {
            id: id.to_string(),
            kind: CheckKind::Resistance(ResistanceCalc {
                deelstappen: Vec::new(),
                id: id.to_string(),
                title: titel.to_string(),
                article: artikel.to_string(),
                force_state,
                formula_latex: String::new(),
                variables: vec![],
                value: 0.0,
                unit: "-".to_string(),
                uc: None,
                status: CheckStatus::NotApplicable,
                notes: redenen,
            }),
        }
    }
}

/// Zoekt titel, artikel en soort bij een toets-id uit [`TOETSEN`].
fn toetsgegevens(id: &str) -> (&'static str, &'static str, bool) {
    TOETSEN
        .iter()
        .find(|(t, ..)| *t == id)
        .map(|&(_, titel, artikel, stab)| (titel, artikel, stab))
        .unwrap_or(("", "", false))
}

/// De schuiftoets om z bij een geweigerde lijfplooitoets (h_w/t_w > 72ε/η,
/// NEN-EN 1993-1-5 §5.1(2)). De plooiweerstand V_b,Rd van 1993-1-5 §5 is niet
/// geïmplementeerd, maar 6.2.6(1) eist hoe dan ook V_Ed ≤ V_pl,Rd: de
/// plastische weerstand is een BOVENGRENS, en de plooitoets kan alleen lager
/// uitkomen. Overschrijdt V_z,Ed die bovengrens, dan voldoet de staaf in elk
/// geval niet; de toets staat er dan gerekend, met status "voldoet niet". Anders
/// blijft hij geweigerd met `redenen` — een V_Ed onder V_pl,Rd zegt zonder de
/// plooitoets niets.
///
/// Tot oktober 2026 werd de toets altijd geweigerd, ook bij V_Ed > V_pl,Rd, en
/// las zo'n staaf als "voldoet" (controle 2026-10, punt B7: een IPE 600 S460 in
/// klasse 4 met V_z,Ed = 2600 kN > V_pl,z,Rd = 2225 kN kreeg status Ok).
fn schuif_met_bovengrens(
    p: &SectionProperties,
    grade: &SteelGrade,
    state: ForceStateSnapshot,
    redenen: Vec<String>,
    lijfplooi: &str,
) -> NamedCheck {
    let mut v = v_z_c_rd(p, grade, state);
    let boven = v.uc.as_ref().is_some_and(|u| u.uc > 1.0);
    if boven {
        v.status = CheckStatus::NotOk;
        v.notes.push(format!(
            "V_z,Ed = {} kN > V_pl,z,Rd = {} kN: de doorsnede voldoet al niet aan 6.2.6(1). De \
             plastische dwarskrachtweerstand is een bovengrens; de plooitoets van NEN-EN 1993-1-5 \
             §5 is niet uitgevoerd ({lijfplooi}) en kan alleen een lagere weerstand geven.",
            nl_getal_2(state.forces.vz_ed.abs()),
            nl_getal_2(v.value),
        ));
        make_resistance(v)
    } else {
        let (titel, artikel, stab) = toetsgegevens("6.2.6_shear_z");
        weigering("6.2.6_shear_z", titel, artikel, stab, redenen, state)
    }
}

/// Kiest de doorsnede: eerst de inline `custom_section`, anders de database.
///
/// De klasse is de ongunstigste van die onder `bend_forces` (het maatgevende
/// buigpunt) en die onder `comp_forces` (het meest gedrukte punt, als dat
/// druk heeft): de druktoetsen rekenen op dat tweede punt. Een klasse 4 wordt
/// voor elke doorsnede geweigerd — er zijn geen effectieve breedtes.
fn resolveer_doorsnede(
    input: &BeamCheckInput,
    grade: &SteelGrade,
    bend_forces: &InternalForces,
    comp_forces: &InternalForces,
) -> Result<Doorsnede, String> {
    // De krachtentoestanden waarop de klasse bepaald wordt.
    let toestanden: Vec<&InternalForces> = if comp_forces.n_ed < 0.0 {
        vec![bend_forces, comp_forces]
    } else {
        vec![bend_forces]
    };
    let Some(custom) = input.custom_section.as_ref() else {
        let profile = match db().find(&input.profile_name) {
            Some(p) => p,
            None => {
                // Met suggesties uit dezelfde reeks (issue #240): een tikfout
                // in de maat hoort de lezer meteen de bedoelde naam te geven.
                let suggesties = db().suggesties(&input.profile_name, 3);
                return Err(if suggesties.is_empty() {
                    format!("ERROR: profile {} not found", input.profile_name)
                } else {
                    format!(
                        "ERROR: profile {} not found; er is niet getoetst. Bedoeld: {}? (zie \
                         list_steel_profiles)",
                        input.profile_name,
                        suggesties
                            .iter()
                            .map(|n| format!("\"{n}\""))
                            .collect::<Vec<_>>()
                            .join(", ")
                    )
                });
            }
        };
        let p = &profile.properties;
        // De vorm bepaalt welk blad van tabel 5.2 geldt: kokerwanden zijn
        // inwendige delen (blad 1) en ronde buizen hebben eigen d/t-grenzen
        // (blad 3). SHS en RHS vallen voor de norm samen.
        let shape = match profile.kind {
            ProfileKind::ISection => SectionShape::ISection,
            ProfileKind::Channel => SectionShape::Channel,
            ProfileKind::Shs | ProfileKind::Rhs => SectionShape::BoxSection,
            ProfileKind::Chs => SectionShape::CircularHollow,
            // Tabel 5.2, blad 3 van 3 heeft een eigen kopje "Hoekprofielen",
            // met alleen een klasse-3-regel. Een hoeklijn onder ISection laten
            // vallen zou hem met de lijf/flens-regels van blad 1 en 2 toetsen,
            // en dat zijn niet de regels die de norm hem geeft.
            ProfileKind::Angle => SectionShape::Angle,
            // Massief rond heeft geen plaatdeel en staat op geen blad van
            // tabel 5.2: altijd klasse 1 (zie `classify_section`).
            ProfileKind::RoundBar => SectionShape::SolidRound,
            // Platstaal: een massieve rechthoek; zie `classify_section`.
            ProfileKind::FlatBar => SectionShape::FlatBar,
        };
        // Massief rond staal: trek met draadeind, knik alleen onder druk, geen
        // kip, en de combinaties van een volle cirkel. Zie de meldingen in
        // `input.rs` en de takken in `check_beam`.
        let is_rond = matches!(profile.kind, ProfileKind::RoundBar);
        // Platstaal: trek op de brutodoorsnede, druk en knik alleen bij druk,
        // en kip alleen als de strip om haar sterke as buigt (zie onder).
        let is_strip = matches!(profile.kind, ProfileKind::FlatBar);
        // Buigt de strip ergens om de sterke as? Dat is de vraag voor kip, en
        // zij gaat over de HELE omhullende: het buigingspunt wordt mede op
        // |N| gekozen en kan daardoor M_y = 0 hebben terwijl elders M_y ≠ 0.
        let strip_buigt_om_sterke_as = is_strip
            && input
                .forces_envelope
                .iter()
                .any(|fp| fp.forces.my_ed != 0.0);
        // Een hoekprofiel is de enige catalogusvorm zonder symmetrieas die met
        // de beschrijvingsassen samenvalt. Wat daar aan beperkingen uit volgt,
        // hangt hieronder BIJ de toetsen waarop het slaat.
        let is_hoeklijn = matches!(profile.kind, ProfileKind::Angle);
        // Koker of buis: de catalogus bevat uitsluitend warmvervaardigde
        // (EN 10210) exemplaren, en dat is een aanname die de lezer bij de
        // kniktoets hoort te zien — een koudgevormde koker (EN 10219) valt in
        // tabel 6.2 onder kromme c en niet onder a (basisaudit nr 36).
        let is_hol = matches!(
            profile.kind,
            ProfileKind::Shs | ProfileKind::Rhs | ProfileKind::Chs
        );
        let toets_notities: Vec<(&'static str, String)> = if is_hol {
            vec![("6.3.1_buckling", MELDING_KOKER_WARMVERVAARDIGD.to_string())]
        } else if is_hoeklijn {
            vec![
                (TOETS_TREK, MELDING_AANSLUITING_HOEKPROFIEL.to_string()),
                (
                    "6.2.4_compression",
                    MELDING_AANSLUITING_HOEKPROFIEL.to_string(),
                ),
                ("6.2.5_bending_y", MELDING_BUIGING_HOEKPROFIEL.to_string()),
                ("6.2.5_bending_z", MELDING_BUIGING_HOEKPROFIEL.to_string()),
                ("6.2.6_shear_z", MELDING_AFSCHUIVING_HOEKPROFIEL.to_string()),
                ("6.2.6_shear_y", MELDING_AFSCHUIVING_HOEKPROFIEL.to_string()),
                ("6.3.1_buckling", MELDING_KNIK_HOOFDASSEN.to_string()),
            ]
        } else if is_rond {
            vec![
                (TOETS_TREK, MELDING_TREK_RONDSTAAL.to_string()),
                ("6.2.5_bending_y", MELDING_BUIGING_RONDSTAAL.to_string()),
                ("6.2.5_bending_z", MELDING_BUIGING_RONDSTAAL.to_string()),
                ("6.2.6_shear_z", MELDING_AFSCHUIVING_RONDSTAAL.to_string()),
                ("6.2.6_shear_y", MELDING_AFSCHUIVING_RONDSTAAL.to_string()),
                ("6.3.1_buckling", MELDING_KNIK_RONDSTAAL.to_string()),
            ]
        } else if is_strip {
            vec![
                (TOETS_TREK, MELDING_TREK_STRIP.to_string()),
                ("6.2.5_bending_y", MELDING_DOORSNEDE_STRIP.to_string()),
                ("6.2.6_shear_z", MELDING_DOORSNEDE_STRIP.to_string()),
                ("6.3.1_buckling", MELDING_KNIK_STRIP.to_string()),
            ]
        } else {
            vec![]
        };
        let klasse = toestanden
            .iter()
            .map(|f| classify_section(p, grade, f, shape))
            .max()
            .unwrap_or(CrossSectionClass::Class1);
        // §6.2.9: welke regel bij deze vorm hoort (zie `interactie`).
        let interactievorm = match profile.kind {
            ProfileKind::ISection => Interactievorm::I,
            ProfileKind::Channel => Interactievorm::U,
            ProfileKind::Shs | ProfileKind::Rhs => Interactievorm::Koker,
            ProfileKind::Chs => Interactievorm::RondeBuis,
            ProfileKind::FlatBar => Interactievorm::Rechthoek,
            ProfileKind::Angle => Interactievorm::Lineair(
                "Hoekprofiel: §6.2.9.1 geeft geen benadering; de toets is de lineaire \
                 optelling, en bij klasse 3 de elastische spanning (6.42) om de eigen assen y en z."
                    .to_string(),
            ),
            // Massief rond heeft een eigen uitwerking (`rond`); deze vorm
            // wordt niet gebruikt.
            ProfileKind::RoundBar => Interactievorm::Lineair(String::new()),
        };
        return Ok(Doorsnede {
            naam: input.profile_name.clone(),
            props: *p,
            klasse,
            curve_y: BucklingCurve::from_char(profile.buckling_curves.y_axis)
                .unwrap_or(BucklingCurve::B),
            curve_z: BucklingCurve::from_char(profile.buckling_curves.z_axis)
                .unwrap_or(BucklingCurve::C),
            kromme_toelichting: if is_hol {
                format!(
                    "Tabel 6.2, rij 'buisprofielen, warmvervaardigd': knikkromme '{}' om de eerste \
                     as en '{}' om de tweede as bij {}. {}",
                    profile.buckling_curves.y_axis,
                    profile.buckling_curves.z_axis,
                    input.profile_name,
                    MELDING_KOKER_WARMVERVAARDIGD
                )
            } else if is_rond || is_strip {
                format!(
                    "Tabel 6.2, rij 'U-, T- en massieve profielen': knikkromme '{}' om de eerste \
                     as en '{}' om de tweede as bij {}, voor elke staalsoort.",
                    profile.buckling_curves.y_axis,
                    profile.buckling_curves.z_axis,
                    input.profile_name
                )
            } else {
                format!(
                    "Tabel 6.2 via de profieldatabase: bij {} staat knikkromme '{}' om de eerste as en \
                     '{}' om de tweede as.",
                    input.profile_name, profile.buckling_curves.y_axis, profile.buckling_curves.z_axis
                )
            },
            is_channel: matches!(profile.kind, ProfileKind::Channel),
            // Massief rond telt hier mee: dit veld zegt of de staaf "niet
            // gevoelig voor vervormingen door torsie" is (bijlage B, tabel
            // B.1), en een volle cirkel is dat — I_t = πd⁴/32, geen welving,
            // en kip treedt niet op.
            gesloten: matches!(
                profile.kind,
                ProfileKind::Shs | ProfileKind::Rhs | ProfileKind::Chs
            ) || is_rond,
            // Tabel 6.5 kent alleen rijen voor I-profielen. Alles uit de
            // catalogus is gewalst; kokers, buizen en hoeklijnen vallen buiten
            // de tabel — bij de hoeklijn draait de kiptoets sowieso niet.
            kip_profielsoort: match profile.kind {
                ProfileKind::ISection => Kipprofiel::GewalsteI,
                ProfileKind::Channel
                | ProfileKind::Shs
                | ProfileKind::Rhs
                | ProfileKind::Chs
                | ProfileKind::Angle
                | ProfileKind::RoundBar
                | ProfileKind::FlatBar => Kipprofiel::Overig,
            },
            // Platstaal dat om de sterke as buigt: kip niet gerekend, met
            // reden (en daarmee ook 6.3.3). Zonder zo'n moment: n.v.t.
            kip_weigering: if is_hoeklijn {
                Some(REDEN_KIP_HOEKPROFIEL.to_string())
            } else if strip_buigt_om_sterke_as {
                Some(REDEN_KIP_STRIP_STERKE_AS.to_string())
            } else {
                None
            },
            kip_nvt: if is_rond {
                Some(REDEN_KIP_NVT_RONDSTAAL.to_string())
            } else if matches!(profile.kind, ProfileKind::Chs) {
                // Issue #240: een ronde buis kipt niet (6.3.2.1(2)); tot
                // oktober 2026 draaide hier de kiptoets met flensteksten.
                Some(REDEN_KIP_NVT_CHS.to_string())
            } else if is_strip && !strip_buigt_om_sterke_as {
                Some(REDEN_KIP_NVT_STRIP.to_string())
            } else {
                None
            },
            rond_d_mm: is_rond.then_some(profile.geometry.h),
            interactievorm,
            wringing: Wringingvorm::catalogus(profile.kind, p, &profile.geometry),
            schuif_weigering: None,
            // Klasse 4 wordt in `check_beam` afgehandeld: met de effectieve
            // doorsnede volgens NEN-EN 1993-1-5 4.4 waar die voor de vorm
            // bepaald kan worden (I-profiel, koker), anders met een gerichte
            // weigering van alleen de toetsen die van de klasse afhangen.
            totaal_weigering: None,
            klasse4_vorm: match profile.kind {
                ProfileKind::ISection => Some(Klasse4Vorm::I {
                    h: p.h_mm,
                    b: p.b_mm,
                    tf: p.tf_mm,
                    tw: p.tw_mm,
                    r: p.r_mm,
                }),
                ProfileKind::Shs | ProfileKind::Rhs => Some(Klasse4Vorm::Koker {
                    h: p.h_mm,
                    b: p.b_mm,
                    t: p.tw_mm,
                }),
                _ => None,
            },
            meldingen: vec![],
            kip_notities: vec![],
            knikassen: if is_hoeklijn {
                Knikassen::hoofdassen(p)
            } else {
                Knikassen::eigen_assen(p)
            },
            toets_notities,
        });
    };
    doorsnede_uit_custom(custom, &input.profile_name, grade, &toestanden)
}

/// Het inline pad van [`resolveer_doorsnede`]: een uit platen samengestelde
/// doorsnede met haar weigeringen — één keuring van dubbelsymmetrie,
/// lijfplooi, klasse en knikkrommen. Losgetrokken van het catalogusdeel omdat
/// de twee paden niets delen behalve hun uitkomst; zo is per pad in één
/// oogopslag te zien wat er wél en niet gerekend wordt. `naam_terugval` is de
/// naam die geldt als `custom.naam` leeg is.
///
/// Een VERLOPENDE staaf loopt hier ook langs: `crate::verlopend` zet per
/// rekenpunt de plaatselijke gelaste I als `custom_section` in een
/// deelvraag, en die komt dan via [`resolveer_doorsnede`] hier uit.
fn doorsnede_uit_custom(
    custom: &CustomSection,
    naam_terugval: &str,
    grade: &SteelGrade,
    toestanden: &[&InternalForces],
) -> Result<Doorsnede, String> {
    // ── Inline doorsnede ────────────────────────────────────────────────────
    let mut meldingen: Vec<(&'static str, &'static str, String)> = Vec::new();
    let mut kip_notities: Vec<String> = Vec::new();

    let (mut props, klasse, kip_toegestaan) = if !custom.lamellen.is_empty() {
        // Geometrie beslist: eigenschappen, klasse per plaatdeel (tabel 5.2)
        // en de dubbelsymmetrie volgen alle drie uit de lamellen.
        let sec = custom.naar_composite();
        let res = sec.bereken();
        let cls = toestanden
            .iter()
            .map(|f| classify_composite(&sec, grade, f).klasse)
            .max()
            .unwrap_or(CrossSectionClass::Class1);
        if custom.heeft_ongedeclareerde_gesloten_cel() {
            meldingen.push((
                "doorsnede_gesloten_cel",
                "Gesloten cel (torsiestijfheid)",
                REDEN_GESLOTEN_CEL_NIET_GEDECLAREERD.to_string(),
            ));
        }
        (res.props, cls, custom.is_dubbelsymmetrische_gelaste_i())
    } else {
        // Alleen eigenschappen: er is geen geometrie om tabel 5.2 op los te
        // laten, dus de gedeclareerde vorm moet zeggen welk blad geldt.
        let p = custom.eigenschappen.ok_or_else(|| {
            "inline doorsnede zonder lamellen en zonder eigenschappen: er valt niets te toetsen"
                .to_string()
        })?;
        let shape =
            match custom.vorm {
                CustomDoorsnedevorm::Onbekend => return Err(
                    "inline doorsnede zonder lamellen én zonder vormaanduiding kan niet volgens \
                     tabel 5.2 worden geklasseerd"
                        .to_string(),
                ),
                CustomDoorsnedevorm::GelasteIDubbelsymmetrisch
                | CustomDoorsnedevorm::GelasteIMonosymmetrisch => SectionShape::ISection,
                CustomDoorsnedevorm::Koker => SectionShape::BoxSection,
                CustomDoorsnedevorm::RondeBuis => SectionShape::CircularHollow,
            };
        kip_notities.push(MELDING_VORM_NIET_CONTROLEERBAAR.to_string());
        (
            p,
            toestanden
                .iter()
                .map(|f| classify_section(&p, grade, f, shape))
                .max()
                .unwrap_or(CrossSectionClass::Class1),
            custom.vorm == CustomDoorsnedevorm::GelasteIDubbelsymmetrisch,
        )
    };

    // `composite.rs` laat t_f en t_w op nul staan: een willekeurige
    // lamellendoorsnede heeft geen "flens" en geen "lijf". Twee formules vragen
    // er wél om, en beide gebruiken het product `2·b·t_f` c.q. `h/t_w`:
    //
    //  * 6.2.9 gebruikt `a = (A − 2·b·t_f)/A ≤ 0,5` — de **lijffractie** van de
    //    doorsnede. Met `t_f = ΣA_liggend/(2·b)` komt daar precies
    //    `A_lijf/A` uit, ook bij ongelijke flenzen. Voor de gelaste I uit D4.1
    //    levert dat de echte flensdikte terug: 6000/(2·200) = 15 mm.
    //  * de kipformules van de nationale bijlage (k_red, C₂-correctie) vragen
    //    om h, b, t_f en t_w; die draaien alleen op de dubbelsymmetrische
    //    gelaste I, waar `t_f` en `t_w` letterlijk de plaatdikten zijn.
    //
    // `t_w` wordt de **dunste** staande plaat: dat is de ongunstigste voor
    // `h/t_w` in k_red.
    if !custom.lamellen.is_empty() {
        let a_liggend: f64 = custom
            .lamellen
            .iter()
            .filter(|l| l.alpha_rad.sin().abs() <= l.alpha_rad.cos().abs())
            .map(|l| l.b_mm * l.t_mm)
            .sum();
        if props.b_mm > 0.0 {
            props.tf_mm = a_liggend / (2.0 * props.b_mm);
        }
        props.tw_mm = custom
            .lamellen
            .iter()
            .filter(|l| l.alpha_rad.sin().abs() > l.alpha_rad.cos().abs())
            .map(|l| l.t_mm)
            .fold(f64::INFINITY, f64::min);
        if !props.tw_mm.is_finite() {
            props.tw_mm = 0.0;
        }
    }

    // §6.2.9: welke regel bij deze doorsnede hoort (zie `interactie`). De
    // benaderingen van §6.2.9.1(5) gelden voor de dubbelsymmetrische I en de
    // koker met gelijke flenzen en lijven, en vragen om hun maten; ontbreken
    // die, dan de lineaire optelling (6.2) in plaats van een a die uit een
    // nul komt.
    let interactievorm = if !custom.lamellen.is_empty() {
        if kip_toegestaan {
            Interactievorm::I
        } else if custom.is_dubbelsymmetrische_koker() {
            Interactievorm::GelasteKoker
        } else {
            Interactievorm::Lineair(
                "Samengestelde doorsnede die geen dubbelsymmetrische gelaste I of koker is: \
                 §6.2.9.1(5) geeft voor haar geen benadering van M_N,Rd. Getoetst is de lineaire \
                 optelling van §6.2.1(7), (6.2)."
                    .to_string(),
            )
        }
    } else {
        let maten = |vereist: &[f64]| vereist.iter().all(|m| m.is_finite() && *m > 0.0);
        match custom.vorm {
            CustomDoorsnedevorm::GelasteIDubbelsymmetrisch if maten(&[props.b_mm, props.tf_mm, props.tw_mm, props.h_mm]) => {
                Interactievorm::I
            }
            CustomDoorsnedevorm::Koker if maten(&[props.b_mm, props.h_mm, props.tf_mm, props.tw_mm]) => {
                Interactievorm::GelasteKoker
            }
            CustomDoorsnedevorm::RondeBuis if maten(&[props.h_mm, props.tw_mm]) && props.tw_mm < props.h_mm / 2.0 => {
                Interactievorm::RondeBuis
            }
            CustomDoorsnedevorm::GelasteIMonosymmetrisch => Interactievorm::Lineair(
                "Monosymmetrische gelaste I: de benadering (6.36) van §6.2.9.1(5) geldt alleen voor \
                 gelijke flenzen. Getoetst is de lineaire optelling van §6.2.1(7), (6.2)."
                    .to_string(),
            ),
            _ => Interactievorm::Lineair(
                "De doorsnede is alleen via haar eigenschappen opgegeven en de maten die de \
                 benadering van §6.2.9.1(5) vraagt (h, b, t_f, t_w) ontbreken. Getoetst is de \
                 lineaire optelling van §6.2.1(7), (6.2)."
                    .to_string(),
            ),
        }
    };

    // (1) Kip 6.3.2 — alleen op een dubbelsymmetrische gelaste I.
    let kip_weigering = if kip_toegestaan {
        None
    } else {
        Some(REDEN_KIP_NIET_DUBBELSYMMETRISCH.to_string())
    };

    // (3) Lijfplooi onder schuifkracht: NEN-EN 1993-1-5 §5.1(2) verlangt een
    //     plooitoets zodra h_w/t_w > 72ε/η. Die toets is niet geïmplementeerd,
    //     dus dan mag V_pl,Rd niet als weerstand doorgaan.
    let grens_lijfplooi = 72.0 * epsilon(grade) / ETA_SCHUIF;
    let schuif_weigering = custom
        .hw_over_tw()
        .filter(|hw| *hw > grens_lijfplooi)
        .map(|hw| reden_lijfplooi(hw, grens_lijfplooi));

    // (2) Klasse 4: in `check_beam`, met de effectieve doorsnede voor de
    //     dubbelsymmetrische gelaste I (NEN-EN 1993-1-5 4.4); elke andere
    //     samengestelde vorm weigert daar de toetsen die van de klasse afhangen.
    let totaal_weigering: Option<String> = None;
    let klasse4_vorm = matches!(interactievorm, Interactievorm::I).then(|| Klasse4Vorm::I {
        h: props.h_mm,
        b: props.b_mm,
        tf: props.tf_mm,
        tw: props.tw_mm,
        r: 0.0,
    });

    // Wringing (6.2.7): alleen voor een ronde buis of koker die met haar
    // eigenschappen is opgegeven (Saint-Venant, welving verwaarloosd volgens
    // 6.2.7(7)). Een doorsnede uit lamellen of een gelaste I: niet getoetst.
    let wringing = if !custom.lamellen.is_empty() {
        Wringingvorm::Niet(
            "Wringing (NEN-EN 1993-1-1 6.2.7) niet getoetst: voor een uit platen samengestelde \
             doorsnede bepaalt de kern geen wringweerstandsmoment W_t en geen welvingsspanningen."
                .to_string(),
        )
    } else {
        let ok = |v: f64| v.is_finite() && v > 0.0;
        match custom.vorm {
            CustomDoorsnedevorm::RondeBuis if ok(props.it_mm4) && ok(props.h_mm) => {
                Wringingvorm::SaintVenant {
                    w_t_mm3: wringing::w_t_rond(props.it_mm4, props.h_mm),
                    toelichting: format!(
                        "Ronde buis: W_t = 2·I_t/D = 2·{}/{} (τ_t = T·r/I_t), I_t uit de opgegeven \
                         eigenschappen. Gesloten doorsnede: welving verwaarloosd (6.2.7(7)).",
                        nl_getal(props.it_mm4),
                        nl_getal(props.h_mm)
                    ),
                }
            }
            CustomDoorsnedevorm::Koker
                if ok(props.h_mm)
                    && ok(props.b_mm)
                    && ok(props.tf_mm)
                    && ok(props.tw_mm)
                    && props.b_mm > props.tw_mm
                    && props.h_mm > props.tf_mm =>
            {
                Wringingvorm::SaintVenant {
                    w_t_mm3: wringing::w_t_bredt(props.h_mm, props.b_mm, props.tf_mm, props.tw_mm),
                    toelichting: "Koker: W_t = 2·A_m·t_min met A_m = (b − t_w)·(h − t_f) (Bredt, \
                         scherpe hoeken). Gesloten doorsnede: welving verwaarloosd (6.2.7(7))."
                        .to_string(),
                }
            }
            CustomDoorsnedevorm::GelasteIDubbelsymmetrisch
            | CustomDoorsnedevorm::GelasteIMonosymmetrisch => {
                Wringingvorm::Niet(REDEN_WRINGING_OPEN.to_string())
            }
            _ => Wringingvorm::Niet(
                "Wringing (NEN-EN 1993-1-1 6.2.7) niet getoetst: uit de opgegeven eigenschappen \
                 volgt geen wringweerstandsmoment W_t (I_t, D of de wanddikten ontbreken)."
                    .to_string(),
            ),
        }
    };

    // Knikkrommen: tabel 6.2, **gelaste** I-doorsnede. t_f ≤ 40 mm → b (y-y) en
    // c (z-z); t_f > 40 mm → c (y-y) en d (z-z). Een inline doorsnede erft
    // nooit stilzwijgend de gunstiger gewalste kromme.
    let (curve_y, curve_z) = if custom.flensdikte_mm() <= 40.0 {
        (BucklingCurve::B, BucklingCurve::C)
    } else {
        (BucklingCurve::C, BucklingCurve::D)
    };

    Ok(Doorsnede {
        naam: if custom.naam.is_empty() { naam_terugval.to_string() } else { custom.naam.clone() },
        props,
        klasse,
        curve_y,
        curve_z,
        kromme_toelichting: format!(
            "Tabel 6.2, gelaste profielen: dikste plaat t_f = {} mm {} 40 mm, dus knikkromme {} om \
             y-y en {} om z-z. Een samengestelde doorsnede krijgt nooit de gunstiger kromme van een \
             gewalst profiel.",
            nl_getal(custom.flensdikte_mm()),
            if custom.flensdikte_mm() <= 40.0 { "≤" } else { ">" },
            curve_y.letter(),
            curve_z.letter()
        ),
        is_channel: false,
        // Kip (en daarmee 6.3.3) draait inline alleen op de dubbelsymmetrische
        // gelaste I, een open doorsnede.
        gesloten: false,
        // Een inline doorsnede heeft geen catalogusgeschiedenis en is per
        // definitie uit platen samengesteld, dus gelast. Kip draait hier
        // bovendien alleen op de dubbelsymmetrische gelaste I (zie
        // `kip_weigering`), precies de rij "gelaste I-profielen" van tabel 6.5.
        kip_profielsoort: Kipprofiel::GelasteI,
        kip_weigering,
        schuif_weigering,
        totaal_weigering,
        klasse4_vorm,
        meldingen,
        kip_notities,
        // Een inline doorsnede is uit platen samengesteld en heeft geen
        // catalogusvorm; de eigen assen blijven de assen waarin zij is
        // ingevoerd.
        knikassen: Knikassen::eigen_assen(&props),
        toets_notities: vec![],
        kip_nvt: None,
        rond_d_mm: None,
        interactievorm,
        wringing,
    })
}

pub(crate) fn uc_of(c: &NamedCheck) -> f64 {
    let (uc_opt, status_skip) = match &c.kind {
        CheckKind::Resistance(r) => (
            r.uc.as_ref().map(|u| u.uc),
            matches!(r.status, CheckStatus::NotApplicable),
        ),
        CheckKind::Stability(s) => (
            s.uc.as_ref().map(|u| u.uc),
            matches!(s.status, CheckStatus::NotApplicable),
        ),
    };
    if status_skip {
        0.0
    } else {
        uc_opt.unwrap_or(0.0)
    }
}

/// Het draadeind van een staaf van massief rond staal, naar de opgegeven
/// eindafwerking (issue #226). Gesneden: de toets van NEN-EN 1993-1-8 tabel
/// 3.4 telt gewoon mee. Opgestuikt, gelast of geen draad: geen draadeindtoets,
/// wel een notitie bij de trektoets (al in `checks`). Niet opgegeven: de toets
/// als AANNAME van een gesneden draad, met een notitie; zij telt niet mee in
/// de maatgevende UC (zie [`check_beam`], `draadeind_als_informatie`).
fn draadeind_toets(
    input: &BeamCheckInput,
    d_mm: f64,
    grade: &SteelGrade,
    trek_state: ForceStateSnapshot,
    checks: &mut [NamedCheck],
) -> Option<NamedCheck> {
    let tekst = match input.draadeind {
        Some(Draadeind::Gesneden) => {
            return Some(make_resistance(n_t_rd_draadeind(d_mm, grade, trek_state)))
        }
        None => {
            let mut c = n_t_rd_draadeind(d_mm, grade, trek_state);
            c.notes.insert(
                0,
                format!(
                    "AANNAME: de eindafwerking is niet opgegeven (veld 'draadeind'); gerekend is een \
                     in de staaf gesneden draad M{}. Deze toets is informatie en telt niet mee in \
                     de maatgevende unity check. Voldoet zij niet, dan is de staaf niet volledig \
                     getoetst: geef de eindafwerking op (gesneden, opgestuikt, gelast of geen \
                     draad).",
                    nl_getal(d_mm)
                ),
            );
            return Some(make_resistance(c));
        }
        Some(Draadeind::Opgestuikt) => {
            "Eindafwerking opgestuikte draad: de draad is groter dan de staaf, dus de \
             spanningsdoorsnede verzwakt de staaf niet en de brutodoorsnede (6.6) is de \
             trektoets van de staaf. De draad en de moer horen bij de aansluiting (NEN-EN \
             1993-1-8 tabel 3.4) en zijn hier niet getoetst."
        }
        Some(Draadeind::Gelast) => {
            "Eindafwerking gelast, zonder draad: geen draadeindtoets; de brutodoorsnede (6.6) is \
             de trektoets van de staaf. De las hoort bij de aansluiting (NEN-EN 1993-1-8 4.5) en \
             is hier niet getoetst."
        }
        Some(Draadeind::Geen) => {
            "Geen draad aan de staafeinden: geen draadeindtoets; de brutodoorsnede (6.6) is de \
             trektoets van de staaf."
        }
    };
    for c in checks.iter_mut().filter(|c| c.id == TOETS_TREK) {
        plak_notitie(c, tekst);
    }
    None
}

/// De reden bij een staaf die alleen op het AANGENOMEN draadeind niet zou
/// voldoen (zie [`draadeind_toets`]).
fn reden_draadeind_aanname(uc: f64) -> String {
    format!(
        "het draadeind is niet opgegeven (veld 'draadeind'); bij een in de staaf gesneden draad \
         voldoet het niet (UC {}, NEN-EN 1993-1-8 tabel 3.4). Geef de eindafwerking op",
        nl_getal_3(uc)
    )
}

/// Bij massief rond zonder opgegeven eindafwerking is het draadeind
/// informatie (issue #226): uc_max en de maatgevende toets zonder die toets,
/// en een overschrijding daarvan maakt de staaf NIET VOLLEDIG GETOETST — geen
/// Ok, en geen NotOk die alleen op de aanname rust.
fn draadeind_als_informatie(mut r: BeamCheckResult) -> BeamCheckResult {
    let Some(draad) = r.checks.iter().find(|c| c.id == TOETS_DRAADEIND) else {
        return r;
    };
    let uc_draad = uc_of(draad);
    let mut uc_max = 0.0_f64;
    let mut maatgevend = String::new();
    for c in r.checks.iter().filter(|c| c.id != TOETS_DRAADEIND) {
        let uc = uc_of(c);
        if uc > uc_max {
            uc_max = uc;
            maatgevend = c.id.clone();
        }
    }
    if r.governing_check_id == TOETS_DRAADEIND {
        r.governing_check_id = maatgevend;
    }
    r.uc_max = uc_max;
    if uc_max > 1.0 {
        r.status = CheckStatus::NotOk;
    } else if uc_draad > 1.0 {
        let reden = reden_draadeind_aanname(uc_draad);
        r.governing_check_id = if r.governing_check_id.starts_with(NIET_VOLLEDIG_GETOETST) {
            format!("{}; {reden}", r.governing_check_id)
        } else {
            format!("{NIET_VOLLEDIG_GETOETST}: {reden}")
        };
        r.status = CheckStatus::NotApplicable;
    }
    r
}

pub fn check_beam(mut input: BeamCheckInput) -> BeamCheckResult {
    // Issue #243 (punt 084): de staalsoort is hoofdletterongevoelig, net als
    // de profielnaam. Het resultaat (en dus het rapport) draagt de naam zoals
    // tabel 3.1 hem schrijft, niet "s355".
    if let Some(g) = grade_by_name(&input.steel_grade) {
        input.steel_grade = g.name.to_string();
    }
    let als_informatie = input.draadeind.is_none();
    let r = check_beam_kern(input);
    if als_informatie {
        draadeind_als_informatie(r)
    } else {
        r
    }
}

fn check_beam_kern(input: BeamCheckInput) -> BeamCheckResult {
    // 0. DE DOORBUIGINGSNOEMERS. Een noemer van 0 of kleiner geeft geen grens
    //    L/n; tot september 2026 werd dat bij klasse 'Custom' een oneindige
    //    grens met UC 0 en status Ok. Het is een invoerfout, dus de staaf
    //    wordt geweigerd met de reden — dezelfde vorm als een onbekende
    //    staalsoort hieronder. Vóór de verloopafslag, zodat een verlopende
    //    staaf dezelfde keuring krijgt.
    if let Err(reden) = crate::deflection::keur_noemers(
        input.deflection_limit_class,
        input.deflection_limit_numerator,
        input.deflection_add_limit_numerator,
    )
    .and_then(|_| {
        crate::deflection::keur_doorbuigingsdeel(
            input.length_m,
            input.deflection_length_m,
            input.deflection_add_mm,
        )
    }) {
        return BeamCheckResult {
            beam_id: input.beam_id,
            profile_name: input.profile_name.clone(),
            steel_grade: input.steel_grade.clone(),
            classification: CrossSectionClass::Class1,
            checks: vec![],
            uc_max: 0.0,
            status: CheckStatus::NotApplicable,
            governing_check_id: format!("ERROR: {reden}"),
            verloop: None,
        };
    }

    // 1. VERLOPEND PROFIEL? Dan gaat de staaf langs een eigen weg
    //    (`crate::verlopend`), die deze functie per rekenpunt opnieuw aanroept
    //    met de PLAATSELIJKE doorsnede. Zonder eindprofiel — en dat is elke
    //    bestaande staaf — valt deze afslag weg en loopt alles hieronder
    //    ongewijzigd door: een prismatische staaf verandert geen enkel getal.
    match crate::verlopend::bepaal_verloop(&input) {
        Ok(None) => {}
        Ok(Some(v)) => return crate::verlopend::check_beam_verlopend(input, v),
        Err(reden) => {
            return BeamCheckResult {
                beam_id: input.beam_id,
                profile_name: input.profile_name.clone(),
                steel_grade: input.steel_grade.clone(),
                classification: CrossSectionClass::Class1,
                checks: vec![],
                uc_max: 0.0,
                status: CheckStatus::NotApplicable,
                governing_check_id: format!("ERROR: {reden}"),
                verloop: None,
            }
        }
    }

    // 2. De staalsoort. Een naam die de kern niet kent is een FOUT en geen
    //    S235. Eerder viel "S355J2", "s355", "S 355", "" of een tikfout stil
    //    terug op S235, terwijl het resultaat de opgegeven naam herhaalde —
    //    en het rapport die naam dus in de PDF zette bij een toetsing met
    //    f_y = 235. De houtkern weigert een onbekende sterkteklasse al op
    //    dezelfde manier (`timber_check::check_timber_beam`): geen toetsen,
    //    status NotApplicable en de reden in `governing_check_id`. De vijf
    //    namen zijn de staalsoorten van NEN-EN 1993-1-1 tabel 3.1 die
    //    `grade_by_name` kent; behalve hoofdletters (#243) wordt er niets
    //    geraden of genormaliseerd.
    let grade: SteelGrade = match grade_by_name(&input.steel_grade) {
        Some(g) => g,
        None => {
            return BeamCheckResult {
                beam_id: input.beam_id,
                profile_name: input.profile_name.clone(),
                steel_grade: input.steel_grade.clone(),
                classification: CrossSectionClass::Class1,
                checks: vec![],
                uc_max: 0.0,
                status: CheckStatus::NotApplicable,
                governing_check_id: format!(
                    "ERROR: staalsoort \"{}\" onbekend — de kern kent S235, S275, S355, S420 \
                     en S460 (NEN-EN 1993-1-1 tabel 3.1); er is niet getoetst",
                    input.steel_grade
                ),
                // Prismatische staaf: geen verloopgegevens, en dan ook niet
                // geserialiseerd (zie BeamCheckResult::verloop).
                verloop: None,
            };
        }
    };

    // De partiele factoren horen bij de BIJLAGE, niet bij de staalsoort.
    // `SteelGrade` draagt ze mee omdat dat type ook langs de drie wegen naar
    // buiten gaat, maar de waarde komt uit de rij van de bijlage die in DEZE
    // invoer staat — niet uit een vaste constante. Voor NL levert dat exact
    // dezelfde getallen; voor een tweede bijlage is dit de plek waar ze
    // veranderen.
    let ndp = nationale_bijlage::Ndp1993::voor(input.bijlage);
    let grade = SteelGrade {
        gamma_m0: ndp.gamma_m0,
        gamma_m1: ndp.gamma_m1,
        gamma_m2: ndp.gamma_m2,
        ..grade
    };

    // 3. De maatgevende punten per toets.
    //
    //    - Trek (6.2.3):                de grootste N (trek-positief).
    //    - Druk en knik (6.2.4, 6.3.1): de kleinste N, dus de grootste DRUK.
    //      Tot oktober 2026 was dat bij elke doorsnede behalve massief rond de
    //      grootste |N|: bij een trekstaaf belandde de trekkracht zo als
    //      drukkracht in de kniktoets (een slanke trekstaaf keurde af op knik),
    //      en een staaf met trek én druk kon zijn druk missen.
    //    - Buiging om y:                max |M_y| (+ 0,01·|N| als scheidsrechter).
    //    - Dwarskracht in z:            max |V_z|.
    //    - Buiging om z, dwarskracht in y: hun eigen punt (max |M_z|, max |V_y|);
    //      is die grootheid overal nul, dan het punt van M_y respectievelijk V_z.
    //    - 6.2.9 en 6.2.10:             elk punt van de omhullende (stap 5).
    //    - 6.3.2 en 6.3.3:              per belastingcombinatie (stap 7 en 8).
    //
    //    Massief rond: buiging en dwarskracht als RESULTANTE — een cirkel heeft
    //    om elke as dezelfde weerstand, dus een moment om z telt even zwaar als
    //    een om y.
    let env = &input.forces_envelope;
    let is_rond = input.custom_section.is_none()
        && db()
            .find(&input.profile_name)
            .is_some_and(|p| p.kind == ProfileKind::RoundBar);
    // Platstaal: geen flenzen (stap 7) en een eigen kanttekening bij 6.3.3.
    let is_strip = input.custom_section.is_none()
        && db()
            .find(&input.profile_name)
            .is_some_and(|p| p.kind == ProfileKind::FlatBar);
    let is_massief = is_rond || is_strip;
    let snap = |p: ForcePoint| ForceStateSnapshot {
        combination_id: p.combination_id,
        position_mm: p.position_mm,
        forces: p.forces,
    };
    let gov_compression = governing_for(env, |f| -f.n_ed);
    let gov_bending = if is_rond {
        governing_for(env, |f| f.my_ed.hypot(f.mz_ed) + f.n_ed.abs() * 0.01)
    } else {
        governing_for(env, |f| f.my_ed.abs() + f.n_ed.abs() * 0.01)
    };
    let gov_shear = if is_rond {
        governing_for(env, |f| f.vy_ed.hypot(f.vz_ed))
    } else {
        governing_for(env, |f| f.vz_ed.abs())
    };
    let gov_trek = governing_for(env, |f| f.n_ed);

    let comp_state = snap(gov_compression);
    // Wringing (6.2.7): het punt met het grootste |T_Ed|, als terugval en voor
    // een geweigerde wringtoets.
    let torsie_state = snap(governing_for(env, |f| f.mt_ed.abs()));
    let bend_state = snap(gov_bending);
    let shear_state = snap(gov_shear);
    let trek_state = snap(gov_trek);
    let bend_z_state = {
        let pz = governing_for(env, |f| f.mz_ed.abs());
        if !is_rond && pz.forces.mz_ed != 0.0 {
            snap(pz)
        } else {
            bend_state
        }
    };
    let shear_y_state = {
        let py = governing_for(env, |f| f.vy_ed.abs());
        if !is_rond && py.forces.vy_ed != 0.0 {
            snap(py)
        } else {
            shear_state
        }
    };

    // 3b. De vloeigrens hangt aan de elementdikte (NEN-EN 1993-1-1 tabel 3.1:
    //     t ≤ 40 mm, 40 mm < t ≤ 80 mm, daarboven niets). De dikste plaat
    //     beslist: bij een catalogusprofiel de flens (of de wand van een
    //     koker, buis of hoeklijn), bij een samengestelde doorsnede de dikste
    //     lamel. Dat moet VÓÓR de doorsnede wordt opgelost, want de
    //     classificatie volgens tabel 5.2 rekent al met ε = √(235/f_y).
    //     Tot september 2026 kreeg een plaat van 50 mm dezelfde f_y als een
    //     van 10 mm (basisaudit nr 17); een plaat boven 80 mm wordt nu
    //     geweigerd in plaats van stilzwijgend met de volle f_y getoetst.
    let dikte_mm = match input.custom_section.as_ref() {
        Some(c) => c.flensdikte_mm(),
        None => db()
            .find(&input.profile_name)
            .map(|p| {
                if p.geometry.tf > 0.0 {
                    p.geometry.tf
                } else {
                    p.geometry.t
                }
            })
            .unwrap_or(0.0),
    };
    let (grade, _dikteklasse, dikte_notitie) = match grade.voor_dikte(dikte_mm) {
        Ok(x) => x,
        Err(reden) => {
            return BeamCheckResult {
                beam_id: input.beam_id,
                profile_name: input.profile_name.clone(),
                steel_grade: input.steel_grade.clone(),
                classification: CrossSectionClass::Class1,
                checks: vec![],
                uc_max: 0.0,
                status: CheckStatus::NotApplicable,
                governing_check_id: format!("ERROR: {reden}"),
                // Prismatische staaf: geen verloopgegevens, en dan ook niet
                // geserialiseerd (zie BeamCheckResult::verloop).
                verloop: None,
            };
        }
    };

    // 4. Resolveer de doorsnede: inline (D4.3) of uit de database, inclusief
    //    de classificatie en de expliciete weigeringen die bij die doorsnede
    //    horen. De klasse is de ongunstigste van die onder het maatgevende
    //    buigpunt en die onder het punt met de grootste druk: de druktoetsen
    //    6.2.4, 6.3.1 en 6.3.3 rekenen op dat tweede punt, en een lijf dat
    //    daar volledig gedrukt is, kan een hogere klasse hebben dan onder het
    //    buigpunt.
    //
    //    Bij een TREK-ALLEEN staaf telt alleen het trekpunt, ook voor de
    //    klasse: een drukkracht die als speling geldt, mag de staaf niet in
    //    klasse 4 duwen en zo de trektoets wegnemen.
    let trek_alleen = input.tension_only.unwrap_or(false);
    let (klasse_buig, klasse_druk) = if trek_alleen {
        (gov_trek.forces, gov_trek.forces)
    } else {
        (gov_bending.forces, gov_compression.forces)
    };
    let doorsnede = match resolveer_doorsnede(&input, &grade, &klasse_buig, &klasse_druk) {
        Ok(d) => d,
        Err(reden) => {
            return BeamCheckResult {
                beam_id: input.beam_id,
                profile_name: input.profile_name.clone(),
                steel_grade: input.steel_grade.clone(),
                classification: CrossSectionClass::Class1,
                checks: vec![],
                uc_max: 0.0,
                status: CheckStatus::NotApplicable,
                governing_check_id: reden,
                // Prismatische staaf: geen verloopgegevens, en dan ook niet
                // geserialiseerd (zie BeamCheckResult::verloop).
                verloop: None,
            }
        }
    };
    let p = &doorsnede.props;
    let classification = doorsnede.klasse;

    // 4b. De nettodoorsnede voor 6.2.3. `None` of 0 = niet opgegeven. Een
    //     waarde die geen doorsnede kan zijn (negatief, niet eindig, groter
    //     dan A) is een invoerfout: de staaf wordt met reden geweigerd, net als
    //     bij een ongeldige doorbuigingsnoemer — een tikfout mag niet stil een
    //     andere trekweerstand geven.
    let a_net: Option<f64> = match input.a_net_mm2 {
        None => None,
        Some(a) if a == 0.0 => None,
        Some(a) if a.is_finite() && a > 0.0 && a <= p.area_mm2 * (1.0 + 1e-9) => Some(a),
        Some(a) => {
            return BeamCheckResult {
                beam_id: input.beam_id,
                profile_name: doorsnede.naam.clone(),
                steel_grade: input.steel_grade.clone(),
                classification,
                checks: vec![],
                uc_max: 0.0,
                status: CheckStatus::NotApplicable,
                governing_check_id: format!(
                    "ERROR: A_net = {} mm² is ongeldig voor {}: de nettodoorsnede van NEN-EN \
                     1993-1-1 6.2.3(2) moet groter dan 0 en ten hoogste A = {} mm² zijn; er is \
                     niet getoetst",
                    nl_getal(a),
                    doorsnede.naam,
                    nl_getal(p.area_mm2)
                ),
                verloop: None,
            }
        }
    };

    // 4c. TREK-ALLEEN STAAF: alleen trek, en de grootste drukkracht als
    //     informatieve regel. Zie `BeamCheckInput::tension_only`.
    if trek_alleen {
        return trek_alleen_staaf(
            &input,
            &grade,
            &doorsnede,
            a_net,
            trek_state,
            comp_state,
            torsie_state,
            &dikte_notitie,
        );
    }

    let mut checks: Vec<NamedCheck> = Vec::new();

    // Losse meldingen over de doorsnede zelf (bijvoorbeeld een gesloten cel
    // die niet is gedeclareerd) landen als eigen NotApplicable-regel.
    for (id, titel, reden) in &doorsnede.meldingen {
        checks.push(weigering(
            id,
            titel,
            "NEN-EN 1993-1-1 6.2.7 / kern",
            false,
            vec![reden.clone()],
            bend_state,
        ));
    }

    // KLASSE 4 (NEN-EN 1993-1-1 6.2.2.5). Een doorsnede in klasse 4 plooit
    // plaatselijk voordat zij de vloeigrens haalt; de norm rekent dan met de
    // effectieve doorsnede volgens NEN-EN 1993-1-5 4.4: A_eff onder
    // gelijkmatige druk, W_eff,y en W_eff,z onder zuivere buiging (zie
    // `nen_en_1993_1_1_section::effectief`). Daarmee lopen de toetsen zoals
    // bij klasse 3 — elastisch — maar op de effectieve grootheden: (6.11),
    // (6.15), (6.44), (6.48)/(6.51), kip met W_eff,y (6.3.2.1(3)) en 6.3.3 met
    // tabel 6.7, klasse 4. Knik en kip houden de bruto stijfheid.
    //
    // Tot oktober 2026 werd elke klasse 4-doorsnede als geheel geweigerd, met
    // uc_max = 0 en status "n.v.t." — ook trek en dwarskracht, die niet van de
    // plooiklasse afhangen. Een IPE 300 in S355 onder druk (lijf c/t = 35,0 >
    // 42ε = 34,2) kreeg zo geen enkele uitkomst (controle 2026-10, punt B7).
    let klasse4: Option<EffectieveDoorsnede> = if classification == CrossSectionClass::Class4 {
        doorsnede
            .klasse4_vorm
            .and_then(|v| effectieve_doorsnede(v, p, &grade))
    } else {
        None
    };
    // Klasse 4 zonder effectieve doorsnede (een vorm waarvoor 4.4 hier niet is
    // uitgewerkt): de toetsen die van de klasse afhangen worden geweigerd.
    let klasse4_reden: Option<String> = (classification == CrossSectionClass::Class4
        && klasse4.is_none())
    .then(|| REDEN_KLASSE_4.to_string())
    .or_else(|| doorsnede.totaal_weigering.clone());
    // Lijfplooi onder schuifkracht (NEN-EN 1993-1-5 §5.1(2)) bij een slanke
    // doorsnede: boven h_w/t_w = 72ε/η draagt het lijf de volle V_pl,Rd niet
    // meer, en die plooitoets is niet geïmplementeerd. Op het inline pad stond
    // dit al in `schuif_weigering`; bij klasse 4 geldt het voor elke vorm.
    let schuif_weigering: Option<String> = doorsnede.schuif_weigering.clone().or_else(|| {
        let h_w = p.h_mm - 2.0 * p.tf_mm;
        let grens = 72.0 * epsilon(&grade) / ETA_SCHUIF;
        (classification == CrossSectionClass::Class4
            && p.tw_mm > 0.0
            && h_w > 0.0
            && h_w / p.tw_mm > grens)
            .then(|| reden_lijfplooi(h_w / p.tw_mm, grens))
    });

    // Klasse 4 zonder effectieve doorsnede: alleen trek (6.2.3), dwarskracht
    // (6.2.6) en de doorbuiging worden gerekend — die hangen niet van de
    // plooiklasse af. Alle andere toetsen blijven mét reden in de lijst. De
    // staaf is dan NIET VOLLEDIG GETOETST: status n.v.t. (of "voldoet niet"
    // als een gerekende toets faalt), nooit "voldoet".
    if let Some(reden4) = klasse4_reden.clone() {
        for &(id, titel, artikel, stabiliteit) in TOETSEN.iter() {
            match id {
                TOETS_TREK => {
                    checks.push(make_resistance(n_t_rd(p, &grade, a_net, trek_state)));
                    continue;
                }
                "6.2.6_shear_z" => {
                    checks.push(match &schuif_weigering {
                        None => make_resistance(v_z_c_rd(p, &grade, shear_state)),
                        // Lijfplooi: V_pl,Rd als bovengrens (zie `schuif_met_bovengrens`).
                        Some(r) => schuif_met_bovengrens(
                            p,
                            &grade,
                            shear_state,
                            vec![reden4.clone(), r.clone()],
                            r,
                        ),
                    });
                    continue;
                }
                "6.2.6_shear_y" => {
                    checks.push(make_resistance(v_y_c_rd(p, &grade, shear_y_state)));
                    continue;
                }
                _ => {}
            }
            let mut redenen = vec![reden4.clone()];
            if let Some(r) = &schuif_weigering {
                if matches!(
                    id,
                    "6.2.6_shear_z" | "6.2.8_combined_mv" | "6.2.10_combined_mnv"
                ) {
                    redenen.push(r.clone());
                }
            }
            if let Some(r) = &doorsnede.kip_weigering {
                if matches!(id, "6.3.2_ltb" | "6.3.3_eq_6_61" | "6.3.3_eq_6_62") {
                    redenen.push(r.clone());
                }
            }
            let state = match id {
                TOETS_TREK => trek_state,
                "6.2.4_compression" | "6.3.1_buckling" => comp_state,
                "6.2.5_bending_z" => bend_z_state,
                "6.2.6_shear_z" => shear_state,
                "6.2.6_shear_y" => shear_y_state,
                _ => bend_state,
            };
            checks.push(weigering(id, titel, artikel, stabiliteit, redenen, state));
        }
        // Wringing (6.2.7) op de brutodoorsnede; de plooi van de wanden onder
        // de wringschuifspanning is bij klasse 4 niet getoetst, maar de staaf
        // staat hier toch al op "niet toetsbaar". Een overschreden T_Rd maakt
        // haar wél "voldoet niet".
        if let Some(c) = wringtoets(&doorsnede.wringing, &grade, env, torsie_state) {
            checks.push(c);
        }
        let (defl_fin, defl_add) = doorbuigingstoetsen(&input);
        checks.push(make_resistance(met_invoernotities(defl_fin, &input)));
        checks.push(make_resistance(defl_add));

        // Ook op het klasse-4-pad hoort een doorsnedegebonden beperking bij de
        // toets te staan waarop zij slaat; de toets is er, hij is alleen
        // geweigerd. De dikteklasse (tabel 3.1) alleen bij de gerekende toetsen.
        hang_toets_notities(&mut checks, &doorsnede.toets_notities);
        hang_dikte_notitie(&mut checks, &dikte_notitie);

        let mut uc_max = 0.0_f64;
        let mut governing = String::new();
        for c in &checks {
            let uc = uc_of(c);
            if uc > uc_max {
                uc_max = uc;
                governing = c.id.clone();
            }
        }
        // Faalt een gerekende toets, dan voldoet de staaf niet — dat staat
        // vast, ook zonder de andere toetsen. Anders is hij niet volledig
        // getoetst, en leest de status nooit als "voldoet".
        let faalt = uc_max > 1.0;
        return BeamCheckResult {
            beam_id: input.beam_id,
            profile_name: doorsnede.naam.clone(),
            steel_grade: input.steel_grade.clone(),
            classification,
            checks,
            uc_max,
            status: if faalt {
                CheckStatus::NotOk
            } else {
                CheckStatus::NotApplicable
            },
            governing_check_id: if faalt {
                governing
            } else {
                format!("NIET TOETSBAAR: {reden4}")
            },
            // Prismatische staaf: geen verloopgegevens, en dan ook niet
            // geserialiseerd (zie BeamCheckResult::verloop).
            verloop: None,
        };
    }

    // 5. Doorsnedetoetsen.
    //
    //    Eerst trek (6.2.3), voor elke doorsnede: N_t,Rd = N_pl,Rd, of met een
    //    opgegeven A_net de kleinste van (6.6) en (6.7). Zonder trek in de
    //    omhullende is de toets n.v.t., zonder unity check. Massief rond krijgt
    //    daarnaast het draadeind (NEN-EN 1993-1-8 tabel 3.4).
    checks.push(make_resistance(n_t_rd(p, &grade, a_net, trek_state)));
    if let Some(d_mm) = doorsnede.rond_d_mm {
        if let Some(c) = draadeind_toets(&input, d_mm, &grade, trek_state, &mut checks) {
            checks.push(c);
        }
    }

    // Klasse 4 met effectieve doorsnede: vanaf hier rekenen de toetsen die van
    // de klasse afhangen met `p_reken` (A_eff, W_eff,y, W_eff,z; de rest
    // bruto) en, waar een klasse gevraagd wordt, als klasse 3 — de elastische
    // formules, op de effectieve grootheden. Trek (hierboven) en dwarskracht
    // blijven op de brutodoorsnede. Zonder klasse 4 is `p_reken` gewoon `p`.
    let p_reken: &SectionProperties = klasse4.as_ref().map(|e| &e.props).unwrap_or(p);
    let klasse_reken = if klasse4.is_some() {
        CrossSectionClass::Class3
    } else {
        classification
    };
    let klasse4_notitie: Option<String> = klasse4.as_ref().map(|e| klasse4_toelichting(e, p));

    // Druk op het punt met de grootste druk; zonder druk n.v.t.
    let mut druk = n_c_rd(p_reken, &grade, comp_state);
    if let Some(e) = &klasse4 {
        // (6.11): N_c,Rd = A_eff·f_y/γ_M0.
        druk.article = "art. 6.2.4 (6.11)".to_string();
        druk.formula_latex = r"N_{c,Rd} = \frac{A_{eff} \cdot f_y}{\gamma_{M0}}".to_string();
        for v in druk.variables.iter_mut().filter(|v| v.symbol == "A") {
            v.symbol = "A_{eff}".to_string();
        }
        druk.deelstappen = effectief::deelstappen(
            &e.druk,
            &grade,
            "A_{eff}",
            "Effectieve oppervlakte onder gelijkmatige druk",
            e.a_eff_mm2,
            "mm²",
            p.area_mm2,
        );
        druk.notes.push(format!(
            "Klasse 4: A_eff = {} mm² (bruto A = {} mm²) volgens NEN-EN 1993-1-5 4.4 — {}. De \
             doorsnede is dubbelsymmetrisch, dus het zwaartepunt verschuift niet (e_N = 0).",
            nl_getal(e.a_eff_mm2),
            nl_getal(p.area_mm2),
            effectief::beschrijf(&e.druk)
        ));
    }
    checks.push(make_resistance(druk));

    // Bij klasse 4 W_eff,y (6.15): `m_y_c_rd` noemt W_eff,y al bij klasse 4.
    let mut bend_y = m_y_c_rd(p_reken, &grade, classification, bend_state);
    if let Some(e) = &klasse4 {
        bend_y.article = "art. 6.2.5 (6.15)".to_string();
        bend_y.formula_latex =
            r"M_{y,c,Rd} = \frac{W_{eff,y,min} \cdot f_y}{\gamma_{M0}}".to_string();
        bend_y.deelstappen = effectief::deelstappen(
            &e.buiging_y,
            &grade,
            "W_{eff,y}",
            "Effectief weerstandsmoment onder buiging om y",
            e.w_eff_y_mm3,
            "mm³",
            p.wel_y_mm3,
        );
        bend_y.notes.push(format!(
            "Klasse 4: W_eff,y = {} mm³ (W_el,y = {} mm³) onder zuivere buiging om de y-as, \
             NEN-EN 1993-1-5 4.4 — {}.",
            nl_getal(e.w_eff_y_mm3),
            nl_getal(p.wel_y_mm3),
            effectief::beschrijf(&e.buiging_y)
        ));
    }
    let m_y_c_rd_knm = bend_y.value;
    checks.push(make_resistance(bend_y));

    let mut bend_z = m_z_c_rd(p_reken, &grade, classification, bend_z_state);
    if let Some(e) = &klasse4 {
        bend_z.article = "art. 6.2.5 (6.15)".to_string();
        bend_z.formula_latex =
            r"M_{z,c,Rd} = \frac{W_{eff,z,min} \cdot f_y}{\gamma_{M0}}".to_string();
        for v in bend_z
            .variables
            .iter_mut()
            .filter(|v| v.symbol == r"W_{el,z}")
        {
            v.symbol = r"W_{eff,z}".to_string();
        }
        bend_z.deelstappen = effectief::deelstappen(
            &e.buiging_z,
            &grade,
            "W_{eff,z}",
            "Effectief weerstandsmoment onder buiging om z",
            e.w_eff_z_mm3,
            "mm³",
            p.wel_z_mm3,
        );
        bend_z.notes.push(format!(
            "Klasse 4: W_eff,z = {} mm³ (W_el,z = {} mm³) onder zuivere buiging om de z-as, \
             NEN-EN 1993-1-5 4.4 — {}.",
            nl_getal(e.w_eff_z_mm3),
            nl_getal(p.wel_z_mm3),
            effectief::beschrijf(&e.buiging_z)
        ));
    }
    checks.push(make_resistance(bend_z));

    // Wringing (6.2.7): W_t als er een wringend moment is en de doorsnede
    // Saint-Venant getoetst wordt. Dan rekenen 6.2.6, 6.2.8 en 6.2.10 op elk
    // punt met V_pl,T,Rd (6.28); zonder wringing verandert er niets.
    let w_t_v: Option<f64> = if heeft_wringing(env) {
        doorsnede.wringing.w_t()
    } else {
        None
    };
    let k_t = |s: &ForceStateSnapshot| factor_v_pl_t(w_t_v, &grade, s);

    // Lijfplooi (weigering 3): boven 72ε/η draagt het lijf niet meer de volle
    // V_pl,Rd. Dan vervallen de schuiftoets om de z-as en alles wat V_pl,Rd
    // als weerstand gebruikt.
    // De volgorde van de checklijst blijft in beide takken gelijk:
    // V_z, V_y, M+V, M+N, M+N+V.
    let geweigerd_v = |id: &str, state: ForceStateSnapshot| -> NamedCheck {
        let (titel, artikel, stab) = toetsgegevens(id);
        weigering(
            id,
            titel,
            artikel,
            stab,
            vec![schuif_weigering.clone().unwrap_or_default()],
            state,
        )
    };
    let v_z_pl_rd = if let Some(r) = &schuif_weigering {
        // V_pl,Rd als bovengrens: V_Ed > V_pl,Rd voldoet in elk geval niet.
        checks.push(schuif_met_bovengrens(
            p,
            &grade,
            shear_state,
            vec![r.clone()],
            r,
        ));
        0.0 // wordt niet gebruikt: elke afnemer van V_pl,Rd is hieronder geweigerd
    } else {
        let shear_z = match w_t_v {
            Some(w) => schuif_met_wringing(p, &grade, w, env, shear_state, v_z_c_rd),
            None => v_z_c_rd(p, &grade, shear_state),
        };
        checks.push(make_resistance(shear_z));
        // V_pl,z,Rd zonder wringing; 6.2.8 vermindert hem per punt.
        v_z_c_rd(p, &grade, shear_state).value
    };

    let shear_y = match w_t_v {
        Some(w) => schuif_met_wringing(p, &grade, w, env, shear_y_state, v_y_c_rd),
        None => v_y_c_rd(p, &grade, shear_y_state),
    };
    checks.push(make_resistance(shear_y));

    // De combinaties. 6.2.8, 6.2.9 en 6.2.10 gaan over V, N en M samen, en het
    // punt waar één daarvan het grootst is, is niet vanzelf het punt waar de
    // combinatie het zwaarst is: ze worden op ELK punt van de omhullende
    // getoetst, en het punt met de hoogste unity check is de uitkomst.
    if doorsnede.rond_d_mm.is_some() {
        // Massief rond: de plastische interactie van een volle cirkel, met
        // het resulterende moment en de resulterende dwarskracht.
        for soort in [
            RondCombinatie::BuigingDwarskracht,
            RondCombinatie::BuigingNormaalkracht,
            RondCombinatie::BuigingNormaalDwars,
        ] {
            let resultanten = match soort {
                RondCombinatie::BuigingNormaalkracht => "het resulterende moment",
                _ => "het resulterende moment en de resulterende dwarskracht",
            };
            let mut r = maatgevend_over_omhullende(
                env,
                bend_state,
                &format!("telkens met {resultanten}"),
                |s| combinatie_rond(&met_factor_av(p, k_t(&s)), &grade, soort, s),
            );
            if w_t_v.is_some() && soort != RondCombinatie::BuigingNormaalkracht {
                r.notes.push(NOTITIE_V_PL_T.to_string());
            }
            checks.push(make_resistance(r));
        }
    } else {
        match schuif_weigering {
            Some(_) => checks.push(geweigerd_v("6.2.8_combined_mv", bend_state)),
            None => {
                // 6.2.8 op ELK punt van de omhullende, net als 6.2.9 en 6.2.10:
                // de grootste dwarskracht en het grootste moment liggen zelden
                // op dezelfde plaats, en een plaats waar ze allebei groot zijn
                // (naast een zware puntlast bij een oplegging) kan maatgevend
                // zijn. Tot oktober 2026 stond 6.2.8 alleen op het buigpunt
                // (grootste |M_y|), waar V_z vaak nul is.
                let mut r = maatgevend_over_omhullende(
                    env,
                    bend_state,
                    "telkens met V_z,Ed en M_y,Ed van dat punt",
                    |s| {
                        check_combined_mv(
                            p,
                            &grade,
                            classification,
                            &doorsnede.interactievorm,
                            // V_pl,T,Rd (6.28) bij wringing, 6.2.8(4).
                            v_z_pl_rd * k_t(&s),
                            m_y_c_rd_knm,
                            s,
                        )
                    },
                );
                if w_t_v.is_some() {
                    r.notes.push(NOTITIE_V_PL_T.to_string());
                }
                checks.push(make_resistance(r));
            }
        }

        checks.push(make_resistance(maatgevend_over_omhullende(
            env,
            bend_state,
            "telkens met N, M_y en M_z van dat punt",
            |s| {
                buiging_en_normaalkracht(
                    p_reken,
                    &grade,
                    klasse_reken,
                    &doorsnede.interactievorm,
                    Interactiesoort::BuigingNormaal,
                    s,
                )
            },
        )));

        match schuif_weigering {
            Some(_) => checks.push(geweigerd_v("6.2.10_combined_mnv", bend_state)),
            None => {
                let mut r = maatgevend_over_omhullende(
                    env,
                    bend_state,
                    "telkens met N, V_y, V_z, M_y en M_z van dat punt",
                    |s| {
                        buiging_en_normaalkracht(
                            // V_pl,T,Rd (6.28) bij wringing, 6.2.8(4).
                            &met_factor_av(p_reken, k_t(&s)),
                            &grade,
                            klasse_reken,
                            &doorsnede.interactievorm,
                            Interactiesoort::BuigingNormaalDwars,
                            s,
                        )
                    },
                );
                if w_t_v.is_some() {
                    r.notes.push(NOTITIE_V_PL_T.to_string());
                }
                checks.push(make_resistance(r));
            }
        }
    }

    // 5b. Wringing (6.2.7). Zonder wringend moment in de omhullende komt hier
    //     niets bij. Met: de wringtoets (6.23) — of de weigering met reden bij
    //     een open I of U — en bij Saint-Venant de toets op buiging en
    //     normaalkracht met f_y,T volgens 6.2.1(5).
    if let Some(c) = wringtoets(&doorsnede.wringing, &grade, env, torsie_state) {
        checks.push(c);
    }
    if let Some(w) = w_t_v {
        let nmt = if doorsnede.rond_d_mm.is_some() {
            buiging_normaal_met_wringing(w, &grade, env, |g, s| {
                combinatie_rond(p, g, RondCombinatie::BuigingNormaalkracht, s)
            })
        } else {
            buiging_normaal_met_wringing(w, &grade, env, |g, s| {
                buiging_en_normaalkracht(
                    p_reken,
                    g,
                    klasse_reken,
                    &doorsnede.interactievorm,
                    Interactiesoort::BuigingNormaal,
                    s,
                )
            })
        };
        if let Some(c) = nmt {
            checks.push(c);
        }
    }

    // 6. Member stability — column buckling 6.3.1 (compression-governing location)
    //
    // De kniklengten beslist de kern zelf, mét herkomst (zie
    // `nen_en_1993_1_1_stability::kniklengte`). Om de eerste as (y, in het vlak)
    // is dat de opgegeven waarde of de staaflengte. Om de tweede as (z, uit het
    // vlak) kan het ook de grootste afstand zijn tussen plaatsen waar een
    // kipsteun aan BEIDE flenzen zit — een steun aan één flens houdt de
    // doorsnede niet als geheel vast.
    //
    // Bij een hoekprofiel zijn de assen u en v: geen van beide valt samen met
    // het vlak van het model, en "boven- en onderflens" betekent daar niets.
    // Dan geen afleiding uit steunen; de opgegeven lengte of de staaflengte.
    let assen_info = doorsnede.knikassen;
    let eigen_assen = assen_info.naam_1 == "y" && assen_info.naam_2 == "z";
    let l_staaf_mm = input.length_m * 1000.0;

    // ── De staafeinden (basisaudit kip-1/kip-2 en nr 29) ──────────────────
    //
    // Beide stabiliteitstoetsen nemen een staafeind als gaffel: zijdelings
    // gesteund en torsievast. Een VRIJ eind (uitkraging, vrijstaande kolom) is
    // dat niet, en een DOORLOPEND eind (de staaf loopt zonder oplegging door in
    // een staaf met een andere doorsnede) evenmin. Zie `Staafeind` voor de
    // achtergrond; hier de gevolgen: bij een vrij eind wordt de kniklengte
    // 2·L en de kiptoets die van de vervangende ligger (tabel NB.NB.1 geval 5),
    // bij een doorlopend eind wordt geweigerd wat niet per deel te bepalen is.
    let einden = input.staafeinden.unwrap_or(Staafeinden {
        begin: Staafeind::Gaffel,
        eind: Staafeind::Gaffel,
    });
    let beide_vrij = einden.begin == Staafeind::Vrij && einden.eind == Staafeind::Vrij;
    let vrij_eind: Option<&'static str> = match (einden.begin, einden.eind) {
        (Staafeind::Vrij, Staafeind::Vrij) => None,
        (Staafeind::Vrij, _) => Some("het begin van de staaf (x = 0)"),
        (_, Staafeind::Vrij) => Some("het eind van de staaf (x = L)"),
        _ => None,
    };
    let doorlopend: Vec<&'static str> = [
        (einden.begin, "het begin van de staaf (x = 0)"),
        (einden.eind, "het eind van de staaf (x = L)"),
    ]
    .iter()
    .filter(|(e, _)| *e == Staafeind::Doorlopend)
    .map(|(_, plaats)| *plaats)
    .collect();
    let reden_beide_vrij = "beide staafeinden zijn vrij (geen oplegging en geen aansluitende \
        staaf): de staaf wordt nergens vastgehouden en is als los onderdeel een mechanisme; \
        de stabiliteitstoetsen zijn niet uitgevoerd"
        .to_string();
    let reden_doorlopend_kip: Option<String> = (!doorlopend.is_empty() && !beide_vrij).then(|| {
        format!(
            "de staaf loopt aan {} zonder oplegging in het verlengde door in een staaf met een \
             andere doorsnede, een ander materiaal of een verlopend profiel. Dat staafeind is geen \
             gaffel, en NB.NB.4.3 \
             kent alleen kipvelden tussen gaffels en kipsteunen; de kipvelden van een doorgaande \
             lijn met wisselende doorsnede zijn niet per deel te bepalen. Kip is daarom niet \
             getoetst: zet op die tussenknoop een kipsteun (aan beide flenzen) of toets de \
             doorgaande lijn als geheel",
            doorlopend.join(" en ")
        )
    });
    let opgegeven = |m: f64| m.is_finite() && m > 0.0;
    let knik_weigering: Option<String> = if beide_vrij {
        Some(reden_beide_vrij.clone())
    } else if !doorlopend.is_empty()
        && !(opgegeven(input.buckling_length_y_m) && opgegeven(input.buckling_length_z_m))
    {
        Some(format!(
            "de staaf loopt aan {} zonder oplegging in het verlengde door in een staaf met een \
             andere doorsnede, een ander materiaal of een verlopend profiel. De terugval van de \
             kniklengte op de \
             staaflengte zou dat staafeind als zijdelings gesteund aannemen, en dat is het niet \
             (basisaudit nr 29: een tussenknoop halveerde zo de kniklengte). Geef L_cr,y én \
             L_cr,z op voor de doorgaande lijn als geheel; dan wordt de kniktoets uitgevoerd",
            doorlopend.join(" en ")
        ))
    } else {
        None
    };
    // Een vrij eind zonder opgegeven kniklengte: 2·L, niet de staaflengte en
    // ook niet de afleiding uit de kipsteunen — die veronderstelt gesteunde
    // staafeinden. Zit de zijdelingse uitbuiging om die as al in een globale
    // tweede-orde-berekening met scheefstand, dan de staaflengte (5.2.2(7)b).
    // Bij een hoekprofiel vallen u en v niet samen met y en z: dan alleen als
    // de berekening beide richtingen dekt.
    let zijdelings = input.zijdelingse_knik_in_analyse.unwrap_or_default();
    let (gedekt_1, gedekt_2) = if eigen_assen {
        (zijdelings.y, zijdelings.z)
    } else {
        let beide = zijdelings.y && zijdelings.z;
        (beide, beide)
    };
    let kniklengte_of_vrij = |as_naam: &str,
                              in_vlak: bool,
                              opgegeven_m: f64,
                              steunen: Option<Steunen<'_>>,
                              gedekt: bool| {
        match vrij_eind {
            Some(plaats) if !opgegeven(opgegeven_m) => Kniklengte::vrij_eind_volgens_analyse(
                as_naam,
                l_staaf_mm,
                in_vlak,
                plaats,
                gedekt,
                "NEN-EN 1993-1-1 5.2.2(7)b",
            ),
            _ => bepaal_kniklengte(as_naam, in_vlak, opgegeven_m, l_staaf_mm, steunen),
        }
    };
    let mut kniklengte_1 = kniklengte_of_vrij(assen_info.naam_1, eigen_assen, input.buckling_length_y_m, None, gedekt_1);
    // Een OPGEGEVEN L_cr,y groter dan de staaflengte wijst op een knikvorm met
    // verplaatsbare knopen (sway). De opgave blijft staan, en stap 8 houdt er
    // C_my = 0,9 bij (tabel B.3). Maar de toetskrachten van een model in deze
    // app zijn altijd tweede orde met scheefstand: dan zit de sway al in de
    // krachten, staat 5.2.2(7)b de systeemlengte toe, en telt de opgave de sway
    // dubbel. Dat zegt de kanttekening; er verandert geen getal. Een 2·L van de
    // kern bij een vrij eind is geen opgave: daar zit de zijdelingse knik juist
    // niet in de krachten.
    let opgegeven_boven_l_1 = kniklengte_1.herkomst == KniklengteHerkomst::Opgegeven
        && kniklengte_1.l_cr_mm > l_staaf_mm * (1.0 + 1e-6);
    if opgegeven_boven_l_1 {
        let a = kniklengte_1.as_naam.clone();
        kniklengte_1.toelichting.push(format!(
            "KANTTEKENING, DUBBELE SWAY: de opgegeven L_cr,{a} = {} mm is groter dan de staaflengte \
             L = {} mm, wat op een knikvorm met verplaatsbare knopen (sway) wijst. Bij de toetsing van \
             een model in deze app komen de UGT-krachten altijd uit een tweede-ordeberekening (P-Δ) met \
             scheefstand (NEN-EN 1993-1-1 5.2.2(3)b en 5.3.2): de zijdelingse verplaatsing en haar \
             vergroting zitten dan al in de krachten, en 5.2.2(7)b staat de systeemlengte L als \
             kniklengte toe. Met deze opgave telt de sway dus dubbel: in χ_{a}, en in de interactie \
             van 6.3.3 via de ondergrens C_my = 0,9 van tabel B.3 waar die maatgevend is. Dat ligt \
             aan de veilige kant; de opgave blijft staan. Alleen wie de krachten zelf uit een \
             eerste-ordeberekening aanlevert, heeft deze kniklengte wel nodig.",
            nl_getal(kniklengte_1.l_cr_mm),
            nl_getal(l_staaf_mm)
        ));
    }
    let kniklengte_2 = kniklengte_of_vrij(
        assen_info.naam_2,
        false,
        input.buckling_length_z_m,
        eigen_assen.then_some(Steunen {
            boven: &input.lateral_bracing.top_flange_positions,
            onder: &input.lateral_bracing.bottom_flange_positions,
            soort: Steunrand::Flens,
        }),
        gedekt_2,
    );
    // L_cr,y blijft nodig voor de sway-kanttekening bij C_my (stap 8).
    let l_cr_y_mm = kniklengte_1.l_cr_mm;
    // Een vrij eind heeft een knikvorm met verplaatsbare knopen, met 2·L én met
    // L uit de tweede orde; stap 8 houdt dan C_m = 0,9 als ondergrens, om
    // beide assen. (Om y deed de regel L_cr,y > L dat bij 2·L al.)
    let zijdelings_l_1 = kniklengte_1.herkomst == KniklengteHerkomst::VrijEindTweedeOrde;
    let vrij_as_2 = matches!(
        kniklengte_2.herkomst,
        KniklengteHerkomst::VrijEind | KniklengteHerkomst::VrijEindTweedeOrde
    );
    let knikassen = [
        Knikas {
            kniklengte: kniklengte_1,
            i_mm: assen_info.i_1_mm,
            traagheid_mm4: assen_info.traagheid_1_mm4,
            kromme: doorsnede.curve_y,
            kromme_toelichting: doorsnede.kromme_toelichting.clone(),
        },
        Knikas {
            kniklengte: kniklengte_2,
            i_mm: assen_info.i_2_mm,
            traagheid_mm4: assen_info.traagheid_2_mm4,
            kromme: doorsnede.curve_z,
            kromme_toelichting: doorsnede.kromme_toelichting.clone(),
        },
    ];
    // De slankheid gaat om de assen die de doorsnede voorschrijft: y-y en z-z,
    // of bij een hoekprofiel de hoofdassen u-u en v-v (par. 1.7(2)).
    //
    // χ en λ̄ komen als velden mee en worden niet uit `intermediate_values`
    // opgezocht: de symboolnamen dragen de asnaam ("\chi_u" bij een
    // hoekprofiel), en een zoekopdracht op "\chi_y" zou daar stilzwijgend op
    // de standaardwaarde 1,0 uitkomen — een knikreductie die er niet is.
    let n_pl_rd_kn = p_reken.area_mm2 * grade.fy_mpa * 1e-3;
    // Zonder druk in de omhullende is knik niet van toepassing — voor elke
    // doorsnede; er valt niets te knikken. `comp_state` is het meest gedrukte
    // punt, dus N ≥ 0 daar betekent: nergens druk. De knikweerstanden worden
    // dan tóch bepaald (zonder toets), want 6.3.3 kan ze nodig hebben bij een
    // combinatie met buiging om twee assen.
    let knik_nvt: Option<String> =
        (comp_state.forces.n_ed >= 0.0).then(|| reden_knik_geen_druk(comp_state.forces.n_ed));
    let (n_b_rd_y_kn, n_b_rd_z_kn, lambda_bar_y, lambda_bar_z) =
        if let Some(reden) = &knik_weigering {
            let (titel, artikel, stab) = toetsgegevens("6.3.1_buckling");
            checks.push(weigering(
                "6.3.1_buckling",
                titel,
                artikel,
                stab,
                vec![reden.clone()],
                comp_state,
            ));
            (f64::NAN, f64::NAN, f64::NAN, f64::NAN)
        } else {
            // Klasse 4: (6.48) met A_eff en (6.51) met √(A_eff/A).
            let knik = if klasse4.is_some() {
                n_b_rd_klasse4(p_reken, &grade, &knikassen, comp_state, p.area_mm2)
            } else {
                n_b_rd(p, &grade, &knikassen, comp_state)
            };
            let uit = (
                knik.per_as[0].chi * n_pl_rd_rd_fn(n_pl_rd_kn, grade.gamma_m1),
                knik.per_as[1].chi * n_pl_rd_rd_fn(n_pl_rd_kn, grade.gamma_m1),
                knik.per_as[0].lambda_bar,
                knik.per_as[1].lambda_bar,
            );
            match &knik_nvt {
                Some(reden) => checks.push(weigering(
                    "6.3.1_buckling",
                    "Kolomknik",
                    "art. 6.3.1 (6.46)",
                    true,
                    vec![reden.clone()],
                    comp_state,
                )),
                None => checks.push(make_stability(knik.calc)),
            }
            uit
        };
    // De kipcontrole (en daarmee 6.3.3) wordt geweigerd om een doorsnedereden,
    // om een doorlopend staafeind, of omdat de kniktoets al is geweigerd — 6.61
    // en 6.62 delen ook door N_b,Rd.
    //
    // Een doorsnede waarvoor kip NIET VAN TOEPASSING is (massief rond) kent
    // geen kipweigering: 6.3.3 wordt dan apart afgehandeld (zie
    // `nm_weigering` bij stap 8).
    let kip_weigering: Option<String> = if doorsnede.kip_nvt.is_some() {
        None
    } else {
        doorsnede
            .kip_weigering
            .clone()
            .or_else(|| knik_weigering.clone())
            .or_else(|| reden_doorlopend_kip.clone())
    };

    // 7. Kip 6.3.2 — PER BELASTINGCOMBINATIE.
    //
    //    Kip hangt aan de momentenLIJN, niet aan het grootste moment alleen:
    //    de vorm bepaalt C₁ en β, het teken per kipsteun welke flens gedrukt
    //    is. Een combinatie met een kleiner moment kan daardoor maatgevend
    //    zijn — windzuiging op een dakligger met kipsteunen aan de bovenflens
    //    drukt de ONDERflens, die over de hele lengte vrij is. Tot oktober 2026
    //    werd alleen de combinatie met het grootste |M_y| getoetst. Nu krijgt
    //    elke combinatie haar eigen kipvelden, eindmomenten en M_b,Rd, en is de
    //    combinatie met de hoogste unity check de uitkomst. 6.3.3 gebruikt per
    //    combinatie de M_b,Rd en χ_LT van díe combinatie.
    //
    //    Channel sections use monosymmetric (conservative) Mcr × 0.7.
    //    Doubly-symmetric I/H sections use the standard I-section formula.
    //
    //    Weigering (1): voor een inline doorsnede die géén dubbelsymmetrische
    //    gelaste I is, bestaat er geen M_cr. `m_cr_i_section` gebruikt alleen
    //    I_z en I_t en `m_cr_algemeen` I_w zonder monosymmetrieparameter z_j;
    //    beide veronderstellen dubbelsymmetrie. Dan blijft de kipcontrole leeg
    //    — mét reden — en vervalt 6.3.3, want dat deelt door M_b,Rd.
    let is_channel = doorsnede.is_channel;
    let l_staaf_kip_mm = input.length_m * 1000.0;
    let is_class_1_or_2 = matches!(
        klasse_reken,
        CrossSectionClass::Class1 | CrossSectionClass::Class2
    );
    // Art. 6.3.2.1(3): W_y = W_pl,y bij klasse 1 en 2, W_el,y bij klasse 3 — in
    // λ̄_LT, in M_b,Rd en daarmee in de M_y,Rk van 6.3.3 (tabel 6.7). Klasse 4
    // is hierboven al als hele staaf geweigerd (`totaal_weigering`); kwam hij
    // hier toch, dan rekent hij elastisch, en dat is voor klasse 4 te gunstig —
    // vandaar de expliciete weigering hieronder.
    // Klasse 4 met effectieve doorsnede: W_y = W_eff,y (art. 6.3.2.1(3)), via
    // `p_reken` en de elastische tak.
    let kip_w = KipWeerstandsmoment::voor_klasse(klasse_reken);
    let kip_weigering = kip_weigering.or_else(|| {
        (kip_w.is_none() && doorsnede.kip_nvt.is_none()).then(|| {
            "kip 6.3.2 is niet gerekend: de doorsnede is klasse 4 en W_eff,y (NEN-EN 1993-1-5) is \
             niet geïmplementeerd"
                .to_string()
        })
    });
    let kip_w = kip_w.unwrap_or(KipWeerstandsmoment::Elastisch);

    // De belastingcombinaties, in de volgorde waarin ze in de omhullende staan.
    let mut combinaties: Vec<u32> = Vec::new();
    for fp in env {
        if !combinaties.contains(&fp.combination_id) {
            combinaties.push(fp.combination_id);
        }
    }
    if combinaties.is_empty() {
        combinaties.push(bend_state.combination_id);
    }
    let punten_van = |c: u32| -> Vec<ForcePoint> {
        env.iter()
            .filter(|fp| fp.combination_id == c)
            .copied()
            .collect()
    };

    // De kipvelden van één combinatie (NB.NB.4.3).
    //
    // Drie beslissingen, en alle drie horen hier omdat de ltb-crate de
    // momentenlijn niet kent:
    //
    //  1. WELKE FLENS. Kip is uitknikken van de GEDRUKTE flens; een steun aan
    //     de getrokken flens telt niet mee. Bij sagging (M_y ≥ 0) gelden de
    //     bovenflenssteunen, bij hogging de onderflenssteunen. Vóór deze
    //     reparatie werd `bottom_flange_positions` nergens gelezen: een ligger
    //     met een bovenflenssteun halverwege en een onderflenssteun aan het
    //     eind rekende bij windzuiging met de halve kiplengte. De keuze valt
    //     PER STEUN, op het moment ter plaatse van die steun — niet één keer
    //     voor de hele staaf op het teken van het maatgevende moment; zie
    //     `LateralBracing::kipsteunen_op_de_gedrukte_flens` voor waarom dat
    //     laatste de uitkomst discontinu maakt in de belasting.
    //  2. WAAR DE VELDGRENZEN LIGGEN. Alleen de grootste tussenafstand kennen
    //     is niet genoeg — de eindmomenten moeten op de werkelijke veldgrenzen
    //     worden afgelezen, niet op L_st/4 vanaf x = 0.
    //  3. WELK VELD MAATGEVEND IS. Die keuze zit in de ltb-crate (laagste
    //     M_cr), want zij vergt de hele NB-keten; zie `maatgevend_kipveld`.
    let kipgeometrie = |c: u32| -> Kipgeometrie {
        let kipsteunen = input
            .lateral_bracing
            .kipsteunen_op_de_gedrukte_flens(|f| interpolate_my_at(env, f * l_staaf_kip_mm, c));
        // Een UITKRAGING (één vrij staafeind) valt buiten NB.NB.4.3: dat kent geen
        // kipveld dat bij een vrij eind eindigt. Getoetst wordt dan de vervangende
        // ligger van tabel NB.NB.1 geval 5 — het spiegelbeeld om het ingeklemde
        // eind, 2·L tussen twee gaffels, met C₁ = 1,0 en C₂ = 0. Tot september
        // 2026 kreeg een uitkraging L_st = L en gold het vrije eind als gaffel:
        // een IPE 300 van 3 m kwam zo op UC_kip 0,406 waar 0,720 hoort.
        let (l_g_mm, kipvelden, uitkraging_notities): (f64, Vec<Kipveld>, Vec<String>) =
            if let Some(plaats) = vrij_eind {
                let l_g_mm = 2.0 * l_staaf_kip_mm;
                let (x_vrij, x_vast) = if einden.begin == Staafeind::Vrij {
                    (0.0, l_staaf_kip_mm)
                } else {
                    (l_staaf_kip_mm, 0.0)
                };
                let m_vrij = interpolate_my_at(env, x_vrij, c);
                let m_vast = interpolate_my_at(env, x_vast, c);
                let mut notities = vec![format!(
                "UITKRAGING. {} is vrij: geen oplegging en geen aansluitende \
                 staaf. Het is geen gaffel, en NB.NB.4.3 kent geen kipveld dat bij een vrij eind \
                 eindigt. Getoetst is daarom de vervangende ligger van tabel NB.NB.1 geval 5: het \
                 spiegelbeeld van de uitkraging om haar ingeklemde eind, L_g = L_st = L_kip = 2·L = \
                 {} mm tussen twee gaffels, met C₁ = 1,0 en C₂ = 0. Het ingeklemde eind is daarbij \
                 als gaffel aangenomen (torsie verhinderd, welving vrij).",
                hoofdletter(plaats),
                nl_getal(l_g_mm)
            )];
                if !kipsteunen.is_empty() {
                    notities.push(format!(
                    "De {} kipsteun(en) aan de gedrukte flens van deze uitkraging zijn NIET \
                     meegeteld: NB.NB.4.3 geeft geen regel voor een veld tussen een kipsteun en een \
                     vrij eind, en de volle vervangende lengte is de veilige kant.",
                    kipsteunen.len()
                ));
                }
                (
                    l_g_mm,
                    vec![Kipveld {
                        l_st_mm: l_g_mm,
                        // Het spiegelbeeld heeft aan beide gaffels het moment van het
                        // vrije eind (in de regel nul) en halverwege dat van het
                        // ingeklemde eind. Rekent bij een uitkraging nergens in mee;
                        // staat in het rapport.
                        m_begin_knm: m_vrij,
                        m_eind_knm: m_vrij,
                        m_midden_knm: m_vast,
                        tussen_gaffels: true,
                        uitkraging: true,
                    }],
                    notities,
                )
            } else {
                let l_g_mm = l_staaf_kip_mm;
                let grenzen =
                    nen_en_1993_1_1_ltb::lambda_chi::kipveld_grenzen_mm(l_g_mm, &kipsteunen);
                // Zonder tussenliggende kipsteun is er één veld, en dat loopt van gaffel
                // tot gaffel: dan geldt L_kip = L_st en NIET de formule met β.
                let tussen_gaffels = grenzen.len() == 2;
                let kipvelden: Vec<Kipveld> = grenzen
                    .windows(2)
                    .map(|w| Kipveld {
                        l_st_mm: w[1] - w[0],
                        m_begin_knm: interpolate_my_at(env, w[0], c),
                        m_eind_knm: interpolate_my_at(env, w[1], c),
                        // Rekent niet mee — NB.NB.4.3 werkt met de eindmomenten. Staat in
                        // het rapport zodat de lezer ziet of de momentenlijn tussen die
                        // eindmomenten doorbuigt; met alleen twee eindmomenten is een
                        // rechte lijn niet van een parabool te onderscheiden, terwijl
                        // NB.NB.4.3(3) juist op "verdeelde belasting mét eindmomenten"
                        // berust. De momentenlijn kent alleen de orchestrator.
                        m_midden_knm: interpolate_my_at(env, (w[0] + w[1]) / 2.0, c),
                        tussen_gaffels,
                        uitkraging: false,
                    })
                    .collect();
                (l_g_mm, kipvelden, Vec::new())
            };

        // β en B* hangen rechtstreeks aan de momenten op de STAAFEINDEN, en
        // `interpolate_my_at` houdt buiten het bemonsterde bereik de laatste waarde
        // vast. Reikt de omhullende van de combinatie niet tot beide uiteinden,
        // dan zijn die eindmomenten dus niet gemeten maar doorgetrokken, en de
        // richting is onveilig: een vastgehouden veldmoment maakt van een vrij
        // opgelegde ligger een ligger onder eindmomenten (B* → ±1, C₁ van 1,13
        // naar 1,75) en daarmee M_cr te hoog. De invoer wordt niet gecorrigeerd —
        // de kern weet niet wat er niet bemonsterd is — maar het rapport hoort te
        // zeggen dat het hierop berust.
        let mut envelop_notities: Vec<String> = Vec::new();
        {
            let tol_mm = (l_staaf_kip_mm * 1e-6).max(1e-9);
            let mut posities = env
                .iter()
                .filter(|fp| fp.combination_id == c)
                .map(|fp| fp.position_mm);
            if let Some(eerste) = posities.next() {
                let (mut min_mm, mut max_mm) = (eerste, eerste);
                for x in posities {
                    min_mm = min_mm.min(x);
                    max_mm = max_mm.max(x);
                }
                if min_mm > tol_mm || max_mm < l_staaf_kip_mm - tol_mm {
                    envelop_notities.push(format!(
                        "De momentenlijn van de maatgevende combinatie is bemonsterd van \
                         x = {min_mm:.0} tot x = {max_mm:.0} mm op een staaf van {l_staaf_kip_mm:.0} mm. \
                         Buiten dat bereik is de laatst bemonsterde waarde vastgehouden, dus \
                         de eindmomenten waaruit β en B* volgen (NB.NB.4.3) zijn \
                         doorgetrokken en niet gemeten."
                    ));
                }
            }
        }
        Kipgeometrie {
            l_g_mm,
            kipvelden,
            uitkraging_notities,
            envelop_notities,
        }
    };

    /// M_b,Rd (kNm) uit de kiptoets, zoals de kiptoets hem zélf berekende.
    ///
    /// Hier stond `chi_lt * W_pl,y * f_y / γ_M1 * 1e-6`, met χ_LT gelezen uit
    /// `ltb.value`. Dat was op twee manieren broos. Ten eerste een tweede som:
    /// dezelfde formule stond ook in de ltb-crate, en die twee konden uit
    /// elkaar lopen zonder dat iets het merkte. Ten tweede leunde hij op de
    /// afspraak dat `value` van de kiptoets χ_LT is — een afspraak die niemand
    /// kon zien en die bij het herstellen van de rapportregel
    /// (`M_b,Rd = … = 0,9`) omviel: 6.61 en 6.62 gingen toen stilzwijgend door
    /// M_b,Rd² delen, waardoor een staaf met UC 1,02 op UC 0,25 uitkwam en van
    /// "voldoet niet" naar "voldoet" sprong.
    ///
    /// De noemer van de unity check ÍS M_b,Rd, en die is met de toets zelf
    /// meegereisd. Eén bron, geen afspraak nodig.
    fn m_b_rd_van(ltb: &nen_en_1993_1_1_stability::StabilityCalc) -> f64 {
        ltb.uc
            .as_ref()
            .map(|u| u.rd)
            // Onbereikbaar zolang m_b_rd/m_b_rd_channel een UC leveren; NaN
            // stopt de interactietoetsen in plaats van ze met een verzonnen
            // M_b,Rd door te laten rekenen.
            .unwrap_or(f64::NAN)
    }

    /// χ_LT zoals de kiptoets hem in haar tussenwaarden zette. Ontbreekt het
    /// symbool, dan geldt 0,0: de staaf telt dan als kipgevoelig en 6.3.3
    /// neemt tabel B.2 — de strengere tabel, nooit stilzwijgend de gunstige.
    fn chi_lt_van(ltb: &nen_en_1993_1_1_stability::StabilityCalc) -> f64 {
        ltb.variables
            .iter()
            .chain(ltb.intermediate_values.iter())
            .find(|v| v.symbol == r"\chi_{LT}")
            .map(|v| v.value)
            .unwrap_or(0.0)
    }

    // Per combinatie de kipgeometrie en — als kip gerekend wordt — de kiptoets
    // met M_Ed het grootste |M_y| van die combinatie. Het maatgevende kipveld
    // en χ_LT gaan door naar 6.3.3: C_mLT hoort bij het momentenverloop van
    // dát veld (bijlage B, tabel B.3, laatste regel: "C_mLT: buigingsas y-y,
    // punten gesteund in richting y-y"), en of tabel B.2 geldt hangt aan
    // χ_LT < 1.
    let kip_gerekend = kip_weigering.is_none() && doorsnede.kip_nvt.is_none();
    // Waar kip niet van toepassing is, is χ_LT = 1 en M_b,Rd = M_c,Rd met de
    // weerstand van de doorsneedklasse (γ_M1).
    let m_b_rd_zonder_kip = kip_w.mm3(p_reken) * grade.fy_mpa / grade.gamma_m1 * 1e-6;
    let per_combinatie: Vec<KipPerCombinatie> = combinaties
        .iter()
        .map(|&c| {
            let geo = kipgeometrie(c);
            if !kip_gerekend {
                return KipPerCombinatie {
                    c,
                    geo,
                    ltb: None,
                    veld: 0,
                    chi_lt: 1.0,
                    m_b_rd_knm: if doorsnede.kip_nvt.is_some() {
                        m_b_rd_zonder_kip
                    } else {
                        f64::NAN
                    },
                };
            }
            let bend_c = snap(governing_for(&punten_van(c), |f| f.my_ed.abs()));
            let (ltb, veld) = if is_channel {
                m_b_rd_channel_met_veld(
                    p_reken,
                    &grade,
                    kip_w,
                    geo.l_g_mm,
                    &geo.kipvelden,
                    input.q_equiv_n_per_mm,
                    input.z_a_mm,
                    bend_c,
                )
            } else {
                m_b_rd_met_veld(
                    p_reken,
                    &grade,
                    kip_w,
                    geo.l_g_mm,
                    &geo.kipvelden,
                    input.q_equiv_n_per_mm,
                    input.z_a_mm,
                    doorsnede.kip_profielsoort,
                    bend_c,
                )
            };
            let m_b_rd_knm = m_b_rd_van(&ltb);
            let chi_lt = chi_lt_van(&ltb);
            KipPerCombinatie {
                c,
                geo,
                ltb: Some(ltb),
                veld,
                chi_lt,
                m_b_rd_knm,
            }
        })
        .collect();

    let ltb_check = if let Some(reden_kip) = kip_weigering.clone() {
        let (titel, artikel, stab) = toetsgegevens("6.3.2_ltb");
        weigering(
            "6.3.2_ltb",
            titel,
            artikel,
            stab,
            vec![reden_kip],
            bend_state,
        )
    } else if let Some(reden_nvt) = doorsnede.kip_nvt.clone() {
        // Niet van toepassing (massief rond): de toets staat als "n.v.t." met
        // reden in de lijst, zonder unity check. Voor 6.3.3 is χ_LT = 1,0, dus
        // M_b,Rd = W_y·f_y/γ_M1.
        let (titel, artikel, stab) = toetsgegevens("6.3.2_ltb");
        weigering(
            "6.3.2_ltb",
            titel,
            artikel,
            stab,
            vec![reden_nvt],
            bend_state,
        )
    } else {
        // De combinatie met de hoogste unity check; bij gelijke waarden de
        // eerste.
        let uc_van = |k: &KipPerCombinatie| {
            k.ltb
                .as_ref()
                .and_then(|l| l.uc.as_ref())
                .map_or(0.0, |u| u.uc)
        };
        let mut i_max = 0;
        for (i, k) in per_combinatie.iter().enumerate() {
            if uc_van(k) > uc_van(&per_combinatie[i_max]) {
                i_max = i;
            }
        }
        let k = &per_combinatie[i_max];
        let mut ltb = k.ltb.clone().expect("kip gerekend");
        if !is_channel {
            // Leeg voor een catalogusprofiel; gevuld als de dubbelsymmetrie op
            // een declaratie berust in plaats van op lamellen.
            ltb.notes.extend(doorsnede.kip_notities.iter().cloned());
        }
        ltb.notes.extend(k.geo.envelop_notities.iter().cloned());
        ltb.notes.extend(k.geo.uitkraging_notities.iter().cloned());
        if per_combinatie.len() > 1 {
            ltb.notes.push(format!(
                "Kip is per belastingcombinatie getoetst: {} combinaties, elk met de eigen \
                 momentenlijn, de eigen kipvelden en per kipsteun de eigen gedrukte flens. \
                 Maatgevend is combinatie {} (UC = {}).",
                per_combinatie.len(),
                k.c,
                nl_getal_3(uc_van(k))
            ));
        }
        make_stability(ltb)
    };
    checks.push(ltb_check);
    // Issue #243 (punt 089): reikt de omhullende van een combinatie met
    // buiging niet tot beide staafeinden, dan zijn de eindmomenten waaruit β
    // en B* (NB.NB.4.3) volgen niet gemeten maar doorgetrokken — en dat is
    // de onveilige richting (zie `envelop_notities`). Alleen een notitie liet
    // de staaf op "voldoet" staan; nu is hij NIET VOLLEDIG GETOETST, tenzij
    // een gerekende toets al faalt. Alleen bij een GEREKENDE kiptoets: een
    // geweigerde of n.v.t.-kiptoets gebruikt die eindmomenten niet.
    let kip_eindmomenten_doorgetrokken: Vec<u32> =
        if kip_weigering.is_none() && doorsnede.kip_nvt.is_none() {
            per_combinatie
                .iter()
                .filter(|k| k.ltb.as_ref().is_some_and(|l| l.uc.is_some()))
                .filter(|k| !k.geo.envelop_notities.is_empty())
                .filter(|k| {
                    env.iter()
                        .any(|fp| fp.combination_id == k.c && fp.forces.my_ed.abs() > M_NUL_KNM)
                })
                .map(|k| k.c)
                .collect()
        } else {
            Vec::new()
        };
    // Welke flens "boven" is, in wereldtermen. De kiptoets kiest per steun de
    // gedrukte flens uit het teken van M_y en de afleiding noemt die flens
    // BOVEN of ONDER. Bij een staande staaf is dat geen wereldbegrip; zie
    // `mechanics::Staafstand`.
    //
    // Niet bij massief rond en platstaal: die hebben geen flenzen.
    if let Some(tekst) =
        flenzen_in_wereldtermen(input.staafstand.unwrap_or_default()).filter(|_| !is_massief)
    {
        if let Some(kip) = checks.last_mut() {
            plak_notitie(kip, &tekst);
        }
    }
    // De kanttekeningen van de bouwer bij de staafstand — de waarschuwing dat
    // de staaf dicht bij de sprong van "boven" ligt — horen bij dezelfde toets:
    // de kiptoets is de toets die per steun de gedrukte flens BOVEN of ONDER
    // noemt en de kipsteunen per flens telt.
    if let Some(kip) = checks.last_mut().filter(|_| !is_massief) {
        for tekst in input.staafstand_notities.iter().flatten() {
            plak_notitie(kip, tekst);
        }
    }

    // 8. Combined N+M 6.3.3 — PER BELASTINGCOMBINATIE.
    //
    // Art. 6.3.3(4): N_Ed, M_y,Ed en M_z,Ed zijn "de rekenwaarden van de
    // drukkracht en de maximale momenten om de y-y- en de z-z-as langs de
    // staaf". Per combinatie dus de grootste druk en de grootste momenten
    // langs de staaf — ze hoeven niet op dezelfde plaats op te treden — en
    // de C_m's, M_b,Rd en χ_LT van die combinatie. Tot oktober 2026 werd 6.3.3
    // op één punt getoetst (het buigingspunt), met de |N| van dat punt als
    // drukkracht, ook als dat een TREKkracht was.
    //
    // Alleen combinaties met druk tellen. Een combinatie zonder druk maar met
    // buiging om BEIDE assen wordt met N_Ed = 0 getoetst: dan is 6.3.3 de enige
    // toets die kip met buiging om z combineert. Een combinatie zonder druk
    // met buiging om één as voegt niets toe aan 6.3.2 en 6.2.5.
    //
    // De interactiefactoren volgens bijlage B (NB bij 6.3.3(5): verplicht).
    // C_my, C_mz en C_mLT komen uit tabel B.3, uit het momentenverloop tussen
    // de gesteunde punten:
    //   C_my  — buiging om y-y, gesteund in richting z-z: de hele staaf tussen
    //           haar knopen (het vlak van het model);
    //   C_mz  — buiging om z-z, gesteund in richting y-y: idem, over M_z;
    //   C_mLT — buiging om y-y, gesteund in richting y-y: het maatgevende
    //           kipveld, tussen de kipsteunen aan de gedrukte flens.
    // Tot september 2026 stond hier C_m = 0,6 vast (basisaudit nr 7): bij een
    // constant moment 40 % te gunstig, en k_zy kwam altijd uit tabel B.1, ook
    // voor een kipgevoelige staaf.
    // Tabel 6.7: de karakteristieke weerstanden naar de doorsnedeklasse.
    // Klasse 1 en 2: A, W_pl,y, W_pl,z; klasse 3: A, W_el,y, W_el,z. In (6.61)
    // en (6.62) staat M_z,Rk/γ_M1 — niet γ_M0 (onder de NB zijn beide 1,0,
    // maar de formule is die van 6.3.3). M_y,Rk zit in M_b,Rd = χ_LT·M_y,Rk/γ_M1
    // van de kiptoets; die rekent per art. 6.3.2.1(3) met dezelfde W_y.
    let (w_z_rk, w_z_symbool) = if is_class_1_or_2 {
        (p_reken.wpl_z_mm3, "W_pl,z")
    } else if klasse4.is_some() {
        (p_reken.wel_z_mm3, "W_eff,z")
    } else {
        (p_reken.wel_z_mm3, "W_el,z")
    };
    let n_rk_kn = p_reken.area_mm2 * grade.fy_mpa * 1e-3;
    let m_y_rk_knm = kip_w.mm3(p_reken) * grade.fy_mpa * 1e-6;
    let m_z_rk_knm = w_z_rk * grade.fy_mpa * 1e-6;
    let m_z_c_rd_knm = m_z_rk_knm / grade.gamma_m1;
    let tabel_6_7 = if klasse4.is_some() {
        format!(
            "Tabel 6.7, klasse 4: N_Rk = A_eff·f_y = {} kN, M_y,Rk = W_eff,y·f_y = {} kNm en \
             M_z,Rk = W_eff,z·f_y = {} kNm; ΔM_y,Ed = e_N,y·N_Ed en ΔM_z,Ed = e_N,z·N_Ed zijn nul, \
             want de doorsnede is dubbelsymmetrisch (e_N = 0). De interactiefactoren zijn die \
             van klasse 3 en 4 (bijlage B, tabel B.1/B.2).",
            nl_getal_3(n_rk_kn),
            nl_getal_3(m_y_rk_knm),
            nl_getal_3(m_z_rk_knm)
        )
    } else {
        format!(
            "Tabel 6.7, klasse {}: N_Rk = A·f_y = {} kN, M_y,Rk = {}·f_y = {} kNm en M_z,Rk = \
         {}·f_y = {} kNm{}.",
            match classification {
                CrossSectionClass::Class1 => "1",
                CrossSectionClass::Class2 => "2",
                _ => "3",
            },
            nl_getal_3(n_rk_kn),
            if is_class_1_or_2 { "W_pl,y" } else { "W_el,y" },
            nl_getal_3(m_y_rk_knm),
            w_z_symbool,
            nl_getal_3(m_z_rk_knm),
            if is_class_1_or_2 {
                ""
            } else {
                "; bij klasse 3 de elastische weerstandsmomenten, ook in M_b,Rd (art. 6.3.2.1(3))"
            }
        )
    };
    // Wanneer 6.3.3 niet gerekend wordt, en waarom. Als de kip geweigerd is —
    // 6.61 en 6.62 delen door M_b,Rd, en zonder kipcontrole bestaat dat getal
    // niet; doorrekenen met χ_LT = 1 zou de kip stilzwijgend wegpoetsen. Waar
    // kip niet van toepassing is (χ_LT = 1 is daar de uitkomst, geen aanname),
    // valt 6.3.3 alleen weg als de kniktoets geweigerd is.
    let nm_weigering: Option<Vec<String>> = if doorsnede.kip_nvt.is_some() {
        knik_weigering.clone().map(|r| {
            vec![format!(
                "6.61 en 6.62 delen door N_b,Rd, en de kniktoets 6.3.1 is niet uitgevoerd: {r}"
            )]
        })
    } else {
        kip_weigering
            .clone()
            .map(|reden_kip| vec![REDEN_INTERACTIE_ZONDER_KIP.to_string(), reden_kip])
    };
    if let Some(redenen) = nm_weigering {
        for id in ["6.3.3_eq_6_61", "6.3.3_eq_6_62"] {
            let (titel, artikel, stab) = if doorsnede.kip_nvt.is_some() {
                interactie_titel(id)
            } else {
                toetsgegevens(id)
            };
            checks.push(weigering(
                id,
                titel,
                artikel,
                stab,
                redenen.clone(),
                bend_state,
            ));
        }
    } else {
        let mut beste_61: Option<StabilityCalc> = None;
        let mut beste_62: Option<StabilityCalc> = None;
        let mut met_druk = 0usize;
        let mut tweeassig = 0usize;
        let uc_s = |s: &StabilityCalc| s.uc.as_ref().map_or(0.0, |u| u.uc);
        for k in &per_combinatie {
            let pts = punten_van(k.c);
            if pts.is_empty() {
                continue;
            }
            let p_n = governing_for(&pts, |f| -f.n_ed);
            let p_my = governing_for(&pts, |f| f.my_ed.abs());
            let p_mz = governing_for(&pts, |f| f.mz_ed.abs());
            let druk = p_n.forces.n_ed < 0.0;
            let biaxiaal = p_my.forces.my_ed != 0.0 && p_mz.forces.mz_ed != 0.0;
            if !druk && !biaxiaal {
                continue;
            }
            if druk {
                met_druk += 1;
            } else {
                tweeassig += 1;
            }
            let n_ed_kn = if druk { -p_n.forces.n_ed } else { 0.0 };

            let momentenlijn = |waarde: fn(&InternalForces) -> f64| -> Vec<(f64, f64)> {
                pts.iter()
                    .map(|fp| (fp.position_mm, waarde(&fp.forces)))
                    .collect()
            };
            let mut cm_y: CmUitkomst = cm_uit_momentenlijn(&momentenlijn(|f| f.my_ed));
            // Tabel B.3, onder de tabel: bij een knikvorm met verplaatsbare knopen
            // ("sway") geldt C_my = 0,9. Of het raamwerk verplaatsbaar is, weet de
            // kern niet; een opgegeven L_cr,y groter dan de staaflengte wijst
            // erop. Dan is de grootste van beide waarden aangehouden, zodat de
            // sway-regel nooit stilzwijgend een lagere C_m oplevert dan het
            // momentenverloop zelf.
            // Bij een OPGEGEVEN L_cr,y > L blijft de regel staan, met de
            // kanttekening dat zij na een tweede-ordeberekening met scheefstand
            // (de toetskrachten van deze app) de sway dubbel telt; zie de
            // kanttekening bij de kniklengte.
            if l_cr_y_mm > l_staaf_mm * (1.0 + 1e-6) && cm_y.cm < 0.9 {
                cm_y.toelichting.push_str(&format!(
                    " L_cr,y = {} mm is groter dan de staaflengte {} mm, wat op een knikvorm met \
                     verplaatsbare knopen wijst; tabel B.3 schrijft daarvoor C_my = 0,9 voor, en die \
                     is hier als ondergrens aangehouden (C_my = 0,9).",
                    nl_getal(l_cr_y_mm),
                    nl_getal(l_staaf_mm)
                ));
                if opgegeven_boven_l_1 {
                    cm_y.toelichting.push_str(
                        " L_cr,y is opgegeven. Komen de krachten uit een tweede-ordeberekening (P-Δ) met \
                         scheefstand, zoals bij de toetsing van een model in deze app altijd, dan zit de \
                         sway al in de krachten en telt deze ondergrens de sway dubbel; NEN-EN 1993-1-1 \
                         5.2.2(7)b staat dan L als kniklengte toe. De ondergrens blijft staan, aan de \
                         veilige kant.",
                    );
                }
                cm_y.cm = 0.9;
            } else if zijdelings_l_1 && cm_y.cm < 0.9 {
                // Tabel B.3, onder de tabel: een staaf met een knikvorm met
                // verplaatsbare knopen krijgt C_m = 0,9. Een vrij staafeind IS
                // zo'n staaf, ook als haar zijdelingse knik in de tweede-orde-
                // berekening zit en L_cr daarom de staaflengte is. Of de
                // ondergrens na zo'n berekening nog nodig is, laat de norm open;
                // hier is de veilige lezing gekozen.
                cm_y.toelichting.push_str(
                    " Een staafeind is vrij: de staaf heeft een knikvorm met verplaatsbare knopen, ook al \
                     is L_cr,y de staaflengte omdat de zijdelingse knik in de tweede-orde-berekening zit. \
                     Tabel B.3 schrijft daarvoor C_my = 0,9 voor, en die is hier als ondergrens \
                     aangehouden (C_my = 0,9).",
                );
                cm_y.cm = 0.9;
            }
            let mut cm_z: CmUitkomst = cm_uit_momentenlijn(&momentenlijn(|f| f.mz_ed));
            if vrij_as_2 && cm_z.cm < 0.9 {
                // Zie hierboven bij C_my; om z geldt het ook bij 2·L, want
                // daar is geen regel L_cr,z > L zoals om y.
                cm_z.toelichting.push_str(
                    " Een staafeind is vrij: de staaf heeft een knikvorm met verplaatsbare knopen. \
                     Tabel B.3 schrijft daarvoor C_mz = 0,9 voor, en die is hier als ondergrens \
                     aangehouden (C_mz = 0,9).",
                );
                cm_z.cm = 0.9;
            }
            let cm_lt: CmUitkomst = {
                // Het maatgevende kipveld van deze combinatie: de bemonsterde
                // punten erbinnen, plus de (geïnterpoleerde) momenten op de
                // veldgrenzen zelf. De veldgrenzen volgen uit de kipvelden zelf:
                // die liggen aaneengesloten vanaf x = 0 (bij een uitkraging is het
                // ene veld het spiegelbeeld 2·L, waarvan de bemonsterde punten 0–L
                // erbinnen vallen).
                let kipvelden = &k.geo.kipvelden;
                let (w0, w1) = {
                    // fold vanaf +0,0: `Sum` voor f64 begint bij -0,0 en dat zou als "-0" in de notitie komen.
                    let voor: f64 = kipvelden
                        .iter()
                        .take(k.veld)
                        .fold(0.0, |a, v| a + v.l_st_mm);
                    match kipvelden.get(k.veld) {
                        Some(v) => (voor, voor + v.l_st_mm),
                        None => (0.0, k.geo.l_g_mm),
                    }
                };
                let mut lijn: Vec<(f64, f64)> = momentenlijn(|f| f.my_ed)
                    .into_iter()
                    .filter(|(x, _)| *x > w0 && *x < w1)
                    .collect();
                lijn.push((w0, interpolate_my_at(env, w0, k.c)));
                lijn.push((w1, interpolate_my_at(env, w1, k.c)));
                let mut u = cm_uit_momentenlijn(&lijn);
                u.toelichting = format!(
                    "(kipveld {} van {}, x = {}–{} mm) {}",
                    k.veld + 1,
                    kipvelden.len().max(1),
                    nl_getal(w0),
                    nl_getal(w1),
                    u.toelichting
                );
                u
            };
            // Bijlage B, tabel B.2 geldt voor staven die gevoelig zijn voor
            // vervormingen door torsie: een open doorsnede die kipt (χ_LT < 1). Een
            // gesloten doorsnede is dat per definitie niet; een open doorsnede met
            // χ_LT = 1 evenmin (tabel B.1).
            let torsiegevoelig = !doorsnede.gesloten && k.chi_lt < 1.0 - 1e-9;
            let factors = interaction_factors_method_2(
                n_ed_kn,
                n_b_rd_y_kn,
                n_b_rd_z_kn,
                lambda_bar_y,
                lambda_bar_z,
                &cm_y,
                &cm_z,
                &cm_lt,
                torsiegevoelig,
                is_class_1_or_2,
            );
            let state = ForceStateSnapshot {
                combination_id: k.c,
                position_mm: if p_my.forces.my_ed != 0.0 {
                    p_my.position_mm
                } else {
                    p_n.position_mm
                },
                forces: InternalForces {
                    n_ed: if druk { p_n.forces.n_ed } else { 0.0 },
                    my_ed: p_my.forces.my_ed,
                    mz_ed: p_mz.forces.mz_ed,
                    ..p_my.forces
                },
            };
            let herkomst = format!(
                "Art. 6.3.3(4), combinatie {}: N_Ed = {} kN{}, M_y,Ed = {} kNm (x = {} mm) en \
                 M_z,Ed = {} kNm (x = {} mm) — de grootste druk en de grootste momenten langs de \
                 staaf binnen deze combinatie; ze hoeven niet op dezelfde plaats op te treden.",
                k.c,
                nl_getal_3(n_ed_kn),
                if druk {
                    format!(" (druk, x = {} mm)", nl_getal(p_n.position_mm))
                } else {
                    " (geen druk in deze combinatie: met N_Ed = 0 getoetst omdat zij buiging om \
                     beide assen heeft; de trek is veilig-zijdig verwaarloosd)"
                        .to_string()
                },
                nl_getal_3(p_my.forces.my_ed),
                nl_getal(p_my.position_mm),
                nl_getal_3(p_mz.forces.mz_ed),
                nl_getal(p_mz.position_mm)
            );
            let mut n_my = check_combined_n_my(
                n_ed_kn,
                n_b_rd_y_kn,
                p_my.forces.my_ed,
                k.m_b_rd_knm.max(1e-9),
                p_mz.forces.mz_ed,
                m_z_c_rd_knm,
                &factors,
                state,
            );
            let mut n_mz = check_combined_n_mz(
                n_ed_kn,
                n_b_rd_z_kn,
                p_my.forces.my_ed,
                k.m_b_rd_knm.max(1e-9),
                p_mz.forces.mz_ed,
                m_z_c_rd_knm,
                &factors,
                state,
            );
            for s in [&mut n_my, &mut n_mz] {
                s.variables.extend([
                    NamedValue {
                        symbol: "N_{Rk}".to_string(),
                        value: n_rk_kn,
                        unit: "kN".to_string(),
                    },
                    NamedValue {
                        symbol: "M_{y,Rk}".to_string(),
                        value: m_y_rk_knm,
                        unit: "kNm".to_string(),
                    },
                    NamedValue {
                        symbol: "M_{z,Rk}".to_string(),
                        value: m_z_rk_knm,
                        unit: "kNm".to_string(),
                    },
                    NamedValue {
                        symbol: r"\chi_{LT}".to_string(),
                        value: k.chi_lt,
                        unit: "-".to_string(),
                    },
                ]);
                s.notes.push(herkomst.clone());
                s.notes.push(tabel_6_7.clone());
                if is_rond {
                    s.notes.push(MELDING_INTERACTIE_RONDSTAAL.to_string());
                } else if is_strip && doorsnede.kip_nvt.is_some() {
                    s.notes.push(MELDING_INTERACTIE_STRIP.to_string());
                }
            }
            if beste_61.as_ref().map_or(true, |b| uc_s(&n_my) > uc_s(b)) {
                beste_61 = Some(n_my);
            }
            if beste_62.as_ref().map_or(true, |b| uc_s(&n_mz) > uc_s(b)) {
                beste_62 = Some(n_mz);
            }
        }
        match (beste_61, beste_62) {
            (Some(mut n_my), Some(mut n_mz)) => {
                if met_druk + tweeassig > 1 {
                    let samenvatting = format!(
                        "Getoetst voor {} belastingcombinatie(s) met druk{}; maatgevend is \
                         combinatie {}.",
                        met_druk,
                        if tweeassig > 0 {
                            format!(" en {tweeassig} zonder druk maar met buiging om beide assen")
                        } else {
                            String::new()
                        },
                        "{}"
                    );
                    let c61 = n_my.force_state.combination_id;
                    let c62 = n_mz.force_state.combination_id;
                    n_my.notes
                        .push(samenvatting.replace("{}", &c61.to_string()));
                    n_mz.notes
                        .push(samenvatting.replace("{}", &c62.to_string()));
                }
                checks.push(make_stability(n_my));
                checks.push(make_stability(n_mz));
            }
            _ => {
                for id in ["6.3.3_eq_6_61", "6.3.3_eq_6_62"] {
                    let (titel, artikel, stab) = interactie_titel(id);
                    checks.push(weigering(
                        id,
                        titel,
                        artikel,
                        stab,
                        vec![REDEN_INTERACTIE_GEEN_DRUK.to_string()],
                        bend_state,
                    ));
                }
            }
        }
    }

    // 9. Doorbuiging (BGT): eindzakking w_fin (L/klasse, A1.4.3(4)) en
    //    bijkomende zakking w_add (ℓ_rep/n uit A1.4.3(3), afgeleid van de
    //    klasse tenzij `deflection_add_limit_numerator` een noemer opgeeft).
    let (defl_fin, defl_add) = doorbuigingstoetsen(&input);
    checks.push(make_resistance(met_invoernotities(defl_fin, &input)));
    checks.push(make_resistance(defl_add));

    // Gevolgklasse (K_FI): hier BEWUST NIET toegepast. NEN-EN 1990:2002/NB:2019
    // verwerkt K_FI in de partiële belastingsfactoren zelf — tabel NB.4 (CC2)
    // en NB.5 (CC1, CC3), bijvoorbeeld 6.10b γ_G = 1,1 / 1,2 / 1,3 en
    // γ_Q = 1,35 / 1,5 / 1,65. De krachten in `forces_envelope` komen uit
    // combinaties die die factoren al dragen (design-mockup/src/components/fem/
    // solver/normcombinaties.ts). Nog eens met K_FI vermenigvuldigen zou de
    // klasse dubbel tellen; `consequence_class` is in deze kern vermelding.

    // 9b. De doorsnedegebonden beperkingen bij de toetsen waarop zij slaan.
    //     Zij staan NIET als losse regel onderaan het rapport: wie de
    //     knikweerstand van een hoeklijn leest, hoort dáár te zien dat de
    //     slankheid om u-u en v-v is bepaald.
    hang_toets_notities(&mut checks, &doorsnede.toets_notities);
    // De klasse-4-toelichting alleen bij de toetsen die werkelijk met de
    // effectieve doorsnede gerekend hebben; een geweigerde toets houdt alleen
    // zijn reden.
    if let Some(tekst) = &klasse4_notitie {
        const MET_EFFECTIEVE_DOORSNEDE: [&str; 7] = [
            "6.2.8_combined_mv",
            "6.2.9_combined_mn",
            "6.2.10_combined_mnv",
            "6.3.1_buckling",
            "6.3.2_ltb",
            "6.3.3_eq_6_61",
            "6.3.3_eq_6_62",
        ];
        for c in checks
            .iter_mut()
            .filter(|c| MET_EFFECTIEVE_DOORSNEDE.contains(&c.id.as_str()))
        {
            let gerekend = match &c.kind {
                CheckKind::Resistance(r) => r.uc.is_some(),
                CheckKind::Stability(s) => s.uc.is_some(),
            };
            if gerekend {
                plak_notitie(c, tekst);
            }
        }
        // De kiptoets rekent met W_eff,y (art. 6.3.2.1(3)) via de elastische
        // tak, die het symbool W_el,y voert; in het rapport hoort het
        // weerstandsmoment te heten naar wat het is.
        for c in checks.iter_mut().filter(|c| c.id == "6.3.2_ltb") {
            if let CheckKind::Stability(s) = &mut c.kind {
                let noem = |t: &mut String| *t = t.replace("W_{el,y}", "W_{eff,y}");
                noem(&mut s.formula_latex);
                s.variables.iter_mut().for_each(|v| noem(&mut v.symbol));
                for d in s.deelstappen.iter_mut() {
                    noem(&mut d.formula_latex);
                    noem(&mut d.ingevuld_latex);
                    d.variables.iter_mut().for_each(|v| noem(&mut v.symbol));
                }
            }
        }
    }
    // 9c. De dikteklasse van tabel 3.1 bij elke GEREKENDE toets die f_y in
    //     haar formule heeft. Een geweigerde toets heeft geen f_y gebruikt en
    //     krijgt de regel niet; haar notities zijn de reden van de weigering.
    hang_dikte_notitie(&mut checks, &dikte_notitie);

    // 9c. De toelichtingen van de bouwer bij de staaf als geheel (een
    //     doorgaande lijn die als één staaf is getoetst) — bij de drie toetsen
    //     waarvoor de staaflengte de uitkomst bepaalt.
    for tekst in input.staaf_notities.iter().flatten() {
        for c in checks.iter_mut().filter(|c| {
            matches!(
                c.id.as_str(),
                "6.3.1_buckling" | "6.3.2_ltb" | "deflection_w_fin"
            )
        }) {
            plak_notitie(c, tekst);
        }
    }

    // 10. Aggregate
    let mut uc_max = 0.0_f64;
    let mut governing_check_id = String::new();
    for c in &checks {
        let uc = uc_of(c);
        if uc > uc_max {
            uc_max = uc;
            governing_check_id = c.id.clone();
        }
    }
    // Een geweigerde lijfplooitoets terwijl er dwarskracht is: 6.2.6 om z, 6.2.8
    // en 6.2.10 zijn niet gerekend, en die toetsen zijn bij V_z,Ed ≠ 0 nodig. De
    // staaf is dan NIET VOLLEDIG GETOETST — status n.v.t., nooit "voldoet" —
    // tenzij een gerekende toets al faalt (waaronder V_Ed > V_pl,Rd, zie
    // `schuif_met_bovengrens`). Zonder dwarskracht speelt de lijfplooi niet:
    // dan zeggen 6.2.8 en 6.2.10 niets meer dan 6.2.5 en 6.2.9. Tot oktober
    // 2026 telde de weigering niet mee en las zo'n staaf als "voldoet"
    // (controle 2026-10, punt B7).
    let onvolledig = schuif_weigering
        .as_ref()
        .filter(|_| shear_state.forces.vz_ed.abs() > V_NUL_KN);
    // Een DOORLOPEND staafeind laat de kniktoets (zonder opgegeven
    // kniklengtes) en de kiptoets weigeren. Een geweigerde toets telt als 0;
    // zonder deze regel stond de staaf dan op Ok terwijl 6.3.1 bij druk of
    // 6.3.2 bij buiging niet was getoetst (controle oktober 2026, K6: een
    // kolom met een veer op 3 m kwam zo van UC 1,162 NotOk op 0,329 Ok). De
    // status is dan NotApplicable: niet volledig getoetst. NotOk blijft NotOk.
    //
    // Rekenruis (|N|, |M_y| tot 10⁻⁶) telt niet als druk of buiging, net als
    // bij de dwarskracht hierboven.
    //
    // De reden staat, net als bij de lijfplooi, in `governing_check_id` achter
    // NIET_VOLLEDIG_GETOETST: zo toont elke weergave de reden in plaats van
    // een toets-id met een UC onder 1, en ziet de toetsing van een verlopende
    // staaf (`verlopend.rs`) dat een deelvraag niet volledig getoetst is. Zonder
    // dat voorvoegsel kwam een verlopende kolom met een doorlopend eind op Ok
    // (review van de samenvoeging 2026.42).
    let doorlopend_geweigerd = !doorlopend.is_empty() && !beide_vrij;
    let knik_ontbreekt =
        doorlopend_geweigerd && knik_weigering.is_some() && comp_state.forces.n_ed < -N_NUL_KN;
    let kip_ontbreekt = doorlopend_geweigerd
        && kip_weigering.is_some()
        && env.iter().any(|fp| fp.forces.my_ed.abs() > M_NUL_KNM);
    // Wringing (6.2.7) die niet getoetst kon worden terwijl T_Ed ≠ 0 (open I
    // of U, doorsnede zonder W_t), of een klasse 4-doorsnede onder wringing
    // (de plooi van de wanden onder τ_t,Ed, NEN-EN 1993-1-5, is niet
    // getoetst): de staaf is NIET VOLLEDIG GETOETST, nooit "voldoet" (#249).
    let wringing_ontbreekt: Option<String> = if !heeft_wringing(env) {
        None
    } else {
        match &doorsnede.wringing {
            Wringingvorm::Niet(reden) => Some(reden.clone()),
            Wringingvorm::SaintVenant { .. } if klasse4.is_some() => Some(
                "Wringing bij een doorsnede in klasse 4: de plooi van de wanden onder de \
                 wringschuifspanning (NEN-EN 1993-1-5) is niet getoetst"
                    .to_string(),
            ),
            Wringingvorm::SaintVenant { .. } => None,
        }
    };
    let status = if uc_max > 1.0 {
        CheckStatus::NotOk
    } else if onvolledig.is_some()
        || knik_ontbreekt
        || kip_ontbreekt
        || wringing_ontbreekt.is_some()
        || !kip_eindmomenten_doorgetrokken.is_empty()
    {
        CheckStatus::NotApplicable
    } else {
        CheckStatus::Ok
    };
    if status == CheckStatus::NotApplicable {
        let mut redenen: Vec<String> = Vec::new();
        if let Some(reden) = onvolledig {
            redenen.push(reden.clone());
        }
        if let Some(reden) = &wringing_ontbreekt {
            redenen.push(reden.clone());
        }
        if !kip_eindmomenten_doorgetrokken.is_empty() {
            let combis: Vec<String> =
                kip_eindmomenten_doorgetrokken.iter().map(|c| c.to_string()).collect();
            redenen.push(format!(
                "de kip (6.3.2) berust op eindmomenten die niet gemeten maar doorgetrokken zijn: \
                 de krachtenomhullende van {} {} reikt niet tot beide staafeinden, terwijl \
                 β en B* (NB.NB.4.3) uit de momenten op de staafeinden volgen; geef de omhullende \
                 ook op x = 0 en x = L",
                if combis.len() == 1 { "combinatie" } else { "combinaties" },
                combis.join(", ")
            ));
        }
        let ontbreekt: Vec<&str> = [
            (knik_ontbreekt, "de kolomknik (6.3.1) bij druk"),
            (kip_ontbreekt, "de kip (6.3.2) bij buiging"),
        ]
        .iter()
        .filter(|(ja, _)| *ja)
        .map(|(_, wat)| *wat)
        .collect();
        if !ontbreekt.is_empty() {
            redenen.push(format!(
                "{} niet getoetst: de staaf loopt aan {} zonder oplegging door in een staaf met een \
                 andere doorsnede, een ander materiaal of een verlopend profiel (de reden staat bij de toets)",
                ontbreekt.join(" en "),
                doorlopend.join(" en ")
            ));
        }
        if !redenen.is_empty() {
            governing_check_id = format!("{NIET_VOLLEDIG_GETOETST}: {}", redenen.join("; "));
        }
    }

    BeamCheckResult {
        beam_id: input.beam_id,
        // Gelijk aan `input.profile_name` op het databasepad; bij een inline
        // doorsnede staat hier de naam waaronder hij in het rapport hoort.
        profile_name: doorsnede.naam.clone(),
        steel_grade: input.steel_grade.clone(),
        classification,
        checks,
        uc_max,
        status,
        governing_check_id,
        // Prismatische staaf: geen verloopgegevens, en dan ook niet
        // geserialiseerd (zie BeamCheckResult::verloop).
        verloop: None,
    }
}

/// De toetsing van een TREK-ALLEEN staaf (zie `BeamCheckInput::tension_only`):
/// alleen 6.2.3 — de brutodoorsnede, en bij massief rond het draadeind — op
/// het punt met de grootste trek, plus een informatieve regel met de grootste
/// drukkracht, die niet getoetst wordt. Buiging, dwarskracht, druk, knik, kip,
/// 6.3.3 en de doorbuiging vallen weg; een klasse-4-weigering ook, want de
/// trekweerstand A·f_y/γ_M0 hangt niet van de plooiklasse af.
fn trek_alleen_staaf(
    input: &BeamCheckInput,
    grade: &SteelGrade,
    doorsnede: &Doorsnede,
    a_net: Option<f64>,
    trek_state: ForceStateSnapshot,
    comp_state: ForceStateSnapshot,
    torsie_state: ForceStateSnapshot,
    dikte_notitie: &str,
) -> BeamCheckResult {
    let p = &doorsnede.props;
    let mut checks: Vec<NamedCheck> = Vec::new();
    let mut trek = n_t_rd(p, grade, a_net, trek_state);
    trek.notes.push(
        "Trek-alleen staaf: alleen de trek is getoetst (6.2.3). Druk, buiging, dwarskracht, \
         knik, kip en doorbuiging zijn bij een trek-alleen staaf niet getoetst."
            .to_string(),
    );
    checks.push(make_resistance(trek));
    if let Some(d_mm) = doorsnede.rond_d_mm {
        if let Some(c) = draadeind_toets(input, d_mm, grade, trek_state, &mut checks) {
            checks.push(c);
        }
    }
    // De informatieve regel: de grootste drukkracht, niet getoetst.
    let druk = comp_state.forces.n_ed < 0.0;
    let tekst = if druk {
        format!(
            "{MELDING_TREK_ALLEEN}. Grootste drukkracht in de omhullende: N_Ed = {} kN \
             (combinatie {}, x = {} mm).",
            nl_getal_2(comp_state.forces.n_ed),
            comp_state.combination_id,
            nl_getal(comp_state.position_mm)
        )
    } else {
        format!("{MELDING_TREK_ALLEEN}. De omhullende bevat geen drukkracht.")
    };
    checks.push(weigering(
        TOETS_TREK_ALLEEN,
        "Trek-alleen staaf: drukkracht niet getoetst",
        "trek-alleen",
        false,
        vec![tekst],
        comp_state,
    ));
    // Wringing (6.2.7), ook bij een trek-alleen staaf: de wringtoets en, bij
    // Saint-Venant, de trek naast τ_t,Ed met f_y,T volgens 6.2.1(5) (#249).
    let env = &input.forces_envelope;
    if let Some(c) = wringtoets(&doorsnede.wringing, grade, env, torsie_state) {
        checks.push(c);
    }
    if let (true, Some(w)) = (heeft_wringing(env), doorsnede.wringing.w_t()) {
        if let Some(c) =
            buiging_normaal_met_wringing(w, grade, env, |g, s| n_t_rd(p, g, None, s))
        {
            checks.push(c);
        }
    }
    let wringing_ontbreekt = match &doorsnede.wringing {
        Wringingvorm::Niet(reden) if heeft_wringing(env) => Some(reden.clone()),
        _ => None,
    };
    hang_toets_notities(&mut checks, &doorsnede.toets_notities);
    hang_dikte_notitie(&mut checks, dikte_notitie);

    let mut uc_max = 0.0_f64;
    let mut governing_check_id = String::new();
    for c in &checks {
        let uc = uc_of(c);
        if uc > uc_max {
            uc_max = uc;
            governing_check_id = c.id.clone();
        }
    }
    BeamCheckResult {
        beam_id: input.beam_id,
        profile_name: doorsnede.naam.clone(),
        steel_grade: input.steel_grade.clone(),
        classification: doorsnede.klasse,
        checks,
        uc_max,
        status: if uc_max > 1.0 {
            CheckStatus::NotOk
        } else if wringing_ontbreekt.is_some() {
            CheckStatus::NotApplicable
        } else {
            CheckStatus::Ok
        },
        governing_check_id: match (&wringing_ontbreekt, uc_max > 1.0) {
            (Some(reden), false) => format!("{NIET_VOLLEDIG_GETOETST}: {reden}"),
            _ => governing_check_id,
        },
        verloop: None,
    }
}

/// Een kracht in kN met twee decimalen en een decimaalkomma.
fn nl_getal_2(v: f64) -> String {
    format!("{v:.2}").replace('.', ",")
}

#[inline]
fn n_pl_rd_rd_fn(n_pl_rd_kn: f64, gamma_m1: f64) -> f64 {
    n_pl_rd_kn / gamma_m1
}

/// Een combinatietoets op ELK punt van de omhullende, en het punt met de
/// hoogste unity check als uitkomst — met een notitie die zegt dat dat zo is
/// gedaan. `wijze` vult de zin aan ("telkens met …"). Een lege omhullende valt
/// terug op `terugval`.
fn maatgevend_over_omhullende(
    envelop: &[ForcePoint],
    terugval: ForceStateSnapshot,
    wijze: &str,
    toets: impl Fn(ForceStateSnapshot) -> ResistanceCalc,
) -> ResistanceCalc {
    let uc = |r: &ResistanceCalc| r.uc.as_ref().map_or(0.0, |u| u.uc);
    let mut beste: Option<ResistanceCalc> = None;
    for fp in envelop {
        let r = toets(ForceStateSnapshot {
            combination_id: fp.combination_id,
            position_mm: fp.position_mm,
            forces: fp.forces,
        });
        if beste.as_ref().map_or(true, |b| uc(&r) > uc(b)) {
            beste = Some(r);
        }
    }
    let mut r = beste.unwrap_or_else(|| toets(terugval));
    // Een melding dat de doorsnede al op normaal- of dwarskracht alleen
    // bezwijkt, blijft bovenaan staan; deze kanttekening komt erna.
    let plek = r
        .notes
        .iter()
        .take_while(|t| t.starts_with("N_Ed ≥ N_pl,Rd") || t.starts_with("V_Ed ≥ V_pl,Rd"))
        .count();
    r.notes.insert(
        plek,
        format!(
            "Getoetst op alle {} punten van de omhullende, {wijze}; maatgevend is combinatie {} \
             op x = {} mm.",
            envelop.len(),
            r.force_state.combination_id,
            nl_getal(r.force_state.position_mm)
        ),
    );
    r
}

/// Titel, artikel en soort van 6.61/6.62 zoals de gerekende toets ze voert,
/// voor de "n.v.t."-regel (geen druk, of geen kniktoets bij een doorsnede
/// zonder kip). De weigeringen om een kipreden houden hun titels uit
/// [`TOETSEN`].
fn interactie_titel(id: &str) -> (&'static str, &'static str, bool) {
    match id {
        "6.3.3_eq_6_61" => ("Knik en kip om de y-as (N + M)", "art. 6.3.3 (6.61)", true),
        _ => ("Knik en kip om de z-as (N + M)", "art. 6.3.3 (6.62)", true),
    }
}

/// De kipvelden van één belastingcombinatie, met de kanttekeningen die bij
/// die velden horen.
struct Kipgeometrie {
    l_g_mm: f64,
    kipvelden: Vec<Kipveld>,
    uitkraging_notities: Vec<String>,
    envelop_notities: Vec<String>,
}

/// Kip (6.3.2) voor één belastingcombinatie: de kipgeometrie, de kiptoets als
/// die gerekend is, het maatgevende kipveld, χ_LT en M_b,Rd — wat 6.3.3 voor
/// die combinatie nodig heeft.
struct KipPerCombinatie {
    c: u32,
    geo: Kipgeometrie,
    ltb: Option<StabilityCalc>,
    veld: usize,
    chi_lt: f64,
    m_b_rd_knm: f64,
}

/// Een getal met drie decimalen en een decimaalkomma, voor een kanttekening.
fn nl_getal_3(v: f64) -> String {
    let s = format!("{v:.3}");
    let s = if s == "-0.000" {
        "0.000".to_string()
    } else {
        s
    };
    s.replace('.', ",")
}

/// Eerste letter als hoofdletter, voor een zin die met een plaatsaanduiding begint.
fn hoofdletter(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(eerste) => eerste.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

/// Een maat in mm als tekst met decimaalkomma, voor een kanttekening.
fn nl_getal(v: f64) -> String {
    let s = format!("{v:.1}");
    s.strip_suffix(".0").unwrap_or(&s).replace('.', ",")
}

/// De kanttekening die bij een STAANDE staaf zegt welke flens in de afleiding
/// de boven- en welke de onderflens is. `None` bij een liggende staaf: daar is
/// de benaming letterlijk.
///
/// De krachten komen bij een staande staaf van voet naar kop binnen, met
/// lokaal +y 90° tegen de klok in vanaf de staafas — dat is naar LINKS. "M_y
/// positief = trek in de onderste vezel" betekent dan trek in de rechterflens
/// en druk in de linkerflens. Zie `mechanics::Staafstand`.
pub fn flenzen_in_wereldtermen(stand: Staafstand) -> Option<String> {
    match stand {
        Staafstand::Liggend => None,
        Staafstand::Staand => Some(
            "Flenzen in wereldtermen. Deze staaf staat overwegend verticaal (75° of meer met de \
             horizontaal) en is getoetst van VOET naar KOP. De tekenafspraak \"M_y positief = \
             trek in de onderste vezel\" geldt in die richting: de BOVENflens in deze afleiding \
             is de LINKERflens van de staaf zoals hij in het model staat, de ONDERflens is de \
             RECHTERflens. Een positief moment drukt de linkerflens, een negatief moment de \
             rechterflens. De kipsteunen die als bovenflens en onderflens zijn opgegeven, zitten \
             dus aan de linker- en de rechterflens."
                .to_string(),
        ),
    }
}
