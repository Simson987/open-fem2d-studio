//! Orchestrator: neem TimberBeamCheckInput, voer alle EN 1995-toetsen uit,
//! lever TimberBeamCheckResult met volledige afleiding.

use mechanics::{ForcePoint, ForceStateSnapshot};
use nen_en_1993_1_1_section::{CheckStatus, ResistanceCalc};
use nen_en_1993_1_1_stability::kniklengte::{bepaal_kniklengte, Kniklengte, Steunen, Steunrand};
use nen_en_1993_1_1_stability::StabilityCalc;
use nen_en_1995_1_1::stability::{
    check_beam_stability, check_column_stability, effective_length_mm,
    kip_overgeslagen_drukzijde_gesteund, l_ef_toelichting, BeamStabilityInput,
    ColumnStabilityInput,
};
use nen_en_1995_1_1::{
    bending, beta_c, compression, deflection, design_strength, k_def, k_h, k_m, k_mod, k_sys,
    shear, strength_class_by_name, torsion, LoadDurationClass, StrengthClass, TimberSection,
};
use steel_check::{
    CheckKind, CustomSection, NamedCheck, Staafeind, Staafeinden, NIET_VOLLEDIG_GETOETST,
};

use crate::belastingduur::{self, kmod_notitie, Groep, KlasseUc, KmodPerLoadDuration};
use crate::input::TimberBeamCheckInput;
use crate::result::TimberBeamCheckResult;

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

fn uc_of(c: &NamedCheck) -> f64 {
    let (uc_opt, skip) = match &c.kind {
        CheckKind::Resistance(r) => (
            r.uc.as_ref().map(|u| u.uc),
            matches!(r.status, CheckStatus::NotApplicable),
        ),
        CheckKind::Stability(s) => (
            s.uc.as_ref().map(|u| u.uc),
            matches!(s.status, CheckStatus::NotApplicable),
        ),
    };
    if skip {
        0.0
    } else {
        uc_opt.unwrap_or(0.0)
    }
}

/// De unity check zoals de k_mod-notitie hem noemt: `None` als de toets niet
/// van toepassing is of geen unity check heeft — dat is geen 0,00.
fn uc_optie(c: &NamedCheck) -> Option<f64> {
    match &c.kind {
        CheckKind::Resistance(r) if !matches!(r.status, CheckStatus::NotApplicable) => {
            r.uc.as_ref().map(|u| u.uc)
        }
        CheckKind::Stability(s) if !matches!(s.status, CheckStatus::NotApplicable) => {
            s.uc.as_ref().map(|u| u.uc)
        }
        _ => None,
    }
}

fn force_state_van(c: &NamedCheck) -> ForceStateSnapshot {
    match &c.kind {
        CheckKind::Resistance(r) => r.force_state,
        CheckKind::Stability(s) => s.force_state,
    }
}

fn notes_van(c: &mut NamedCheck) -> &mut Vec<String> {
    match &mut c.kind {
        CheckKind::Resistance(r) => &mut r.notes,
        CheckKind::Stability(s) => &mut s.notes,
    }
}

/// Is deze samengestelde doorsnede in werkelijkheid gewoon een rechthoek?
///
/// Waarom die vraag ertoe doet: aan `TimberSection::rechthoekig` hangen drie
/// normregels (k_h van 3.2(3)/3.3(3), k_m van 6.1.6(2) en de vereenvoudigde
/// sigma_m,crit van 6.3.3(2)). Een gebruiker die in de profieleditor een
/// enkele plaat tekent, heeft een rechthoek en hoort die drie gewoon te
/// krijgen; hem als "samengesteld" behandelen zou de kiptoets laten vervallen
/// zonder dat daar een reden voor is.
///
/// Alleen een echte rechthoek telt: precies een lamel, liggend of staand.
/// Levert `(b, h)` in mm.
fn als_rechthoek(cs: &CustomSection) -> Option<(f64, f64)> {
    if cs.lamellen.len() != 1 || !cs.gesloten_cellen.is_empty() {
        return None;
    }
    let l = cs.lamellen[0];
    if l.alpha_rad.sin().abs() < 1e-9 {
        Some((l.b_mm, l.t_mm)) // liggend: lengte langs y
    } else if l.alpha_rad.cos().abs() < 1e-9 {
        Some((l.t_mm, l.b_mm)) // staand: lengte langs z
    } else {
        None
    }
}

/// De doorsnede waarmee getoetst wordt, met de naam die in het rapport komt.
///
/// Zonder `custom_section` is dat de rechthoek b x h uit de invoer -- het
/// gedrag van voorheen, tot op de laatste decimaal. Met `custom_section`
/// komen A, I, W en de maatgevende schuifvezel uit `section-properties`,
/// dezelfde motor die de profieleditor gebruikt. Zo is er geen tweede plek
/// waar doorsnedegrootheden worden uitgerekend.
///
/// `Err` zodra de doorsnede geen contour heeft (alleen kant-en-klare
/// eigenschappen, of een catalogusdeel erin): dan is er geen breedte op een
/// vezel te meten en dus geen dwarskrachttoets volgens art. 6.1.7 te maken.
/// Doorrekenen met een geraden breedte is precies wat hier niet mag.
fn doorsnede_uit(input: &TimberBeamCheckInput) -> Result<(TimberSection, String), String> {
    let cs = match input.custom_section.as_ref() {
        None => {
            let s = TimberSection::rechthoek(input.width_mm, input.height_mm);
            let naam = s.name();
            return Ok((s, naam));
        }
        Some(cs) => cs,
    };
    if let Some((b, h)) = als_rechthoek(cs) {
        return Ok((TimberSection::rechthoek(b, h), cs.naam.clone()));
    }
    if cs.lamellen.is_empty() {
        return Err(format!(
            "doorsnede \"{}\" is niet uit lamellen opgebouwd. De houttoetsing heeft              de vorm zelf nodig: art. 6.1.7 vraagt de breedte op de beschouwde vezel,              en die staat niet in een kant-en-klare set doorsnede-eigenschappen.              Teken de doorsnede als samenstelling van platen.",
            cs.naam
        ));
    }
    let comp = cs.naar_composite();
    let vezel = comp.maatgevende_schuifvezel().ok_or_else(|| {
        format!(
            "van doorsnede \"{}\" is de maatgevende schuifvezel niet te bepalen              (een catalogusprofiel als bouwsteen heeft geen contour). Bouw de              doorsnede uit platen op.",
            cs.naam
        )
    })?;
    let p = comp.bereken().props;
    if !(p.area_mm2 > 0.0) || !(p.iy_mm4 > 0.0) {
        return Err(format!(
            "doorsnede \"{}\" heeft geen bruikbaar oppervlak of traagheidsmoment.",
            cs.naam
        ));
    }
    Ok((
        TimberSection {
            b_mm: p.b_mm,
            h_mm: p.h_mm,
            a_mm2: p.area_mm2,
            // wel_y_mm3 is de maatgevende (kleinste) van boven- en ondervezel.
            w_y_mm3: p.wel_y_mm3,
            w_z_mm3: p.wel_z_mm3,
            i_y_mm4: p.iy_mm4,
            i_z_mm4: p.iz_mm4,
            radius_y_mm: p.iy_radius_mm,
            radius_z_mm: p.iz_radius_mm,
            s_y_mm3: vezel.s_mm3,
            b_schuif_mm: vezel.b_mm,
            b_flens_mm: vezel.b_max_mm,
            rechthoekig: false,
        },
        cs.naam.clone(),
    ))
}

/// De helling van een verlopende ligger voor §6.4.2, door `crate::verlopend`
/// meegegeven aan de deelvraag van één rekenpunt (die zelf prismatisch is).
#[derive(Clone, Copy, Debug)]
pub(crate) struct Afschuining {
    /// |h_eind − h_begin| / L: de helling als één rand schuin loopt.
    pub tan_alpha_enkel: f64,
    pub rand: Option<nen_en_1995_1_1::afgeschuind::SchuineRand>,
/// Rekenruis in N (kN) en M (kNm) telt niet als druk of buiging — dezelfde
/// drempels als de staalkern.
const N_NUL_KN: f64 = 1e-6;
const M_NUL_KNM: f64 = 1e-6;

/// Wat een DOORLOPEND staafeind (issue #205) aan de stabiliteitstoetsen doet.
///
/// Een staafeind dat zonder oplegging in het verlengde doorloopt in een staaf
/// met een andere doorsnede of een ander materiaal, is geen gaffel en niet
/// zijdelings gesteund. De terugval van de kniklengte op de staaflengte (en de
/// afleiding uit de zijdelingse steunen, die gesteunde einden veronderstelt)
/// en de terugval van de kipsteunafstand op de staaflengte nemen het wél zo
/// aan: bij een getrapte kolom wordt de lengte van één deel de kniklengte. De
/// staalkern weigert hier al (`Staafeind::Doorlopend`); de houtkern nu ook.
struct DoorlopendEind {
    /// Waar de staaf doorloopt, leesbaar ("het eind van de staaf (x = L)").
    plaatsen: Vec<&'static str>,
    /// Reden om art. 6.3.2 te weigeren: niet beide kniklengtes opgegeven.
    knik: Option<String>,
    /// Reden om art. 6.3.3 te weigeren: geen kniklengtes (k_c,z in (6.35)) of
    /// geen kipsteunafstand / l_ef opgegeven.
    kip: Option<String>,
}

fn doorlopend_eind(input: &TimberBeamCheckInput) -> DoorlopendEind {
    let einden = input.staafeinden.unwrap_or(Staafeinden { begin: Staafeind::Gaffel, eind: Staafeind::Gaffel });
    let plaatsen: Vec<&'static str> = [
        (einden.begin, "het begin van de staaf (x = 0)"),
        (einden.eind, "het eind van de staaf (x = L)"),
    ]
    .iter()
    .filter(|(e, _)| *e == Staafeind::Doorlopend)
    .map(|(_, plaats)| *plaats)
    .collect();
    if plaatsen.is_empty() {
        return DoorlopendEind { plaatsen, knik: None, kip: None };
    }
    let opgegeven = |m: f64| m.is_finite() && m > 0.0;
    let waar = plaatsen.join(" en ");
    let kniklengtes = opgegeven(input.buckling_length_y_m) && opgegeven(input.buckling_length_z_m);
    let knik = (!kniklengtes).then(|| {
        format!(
            "de staaf loopt aan {waar} zonder oplegging in het verlengde door in een andere staaf \
             (met een andere doorsnede of een ander materiaal; in 3D elke voortzetting, want daar \
             worden staven niet samengevoegd). De terugval van de kniklengte op de \
             staaflengte zou dat staafeind als zijdelings gesteund aannemen, en dat is het niet: \
             bij een getrapte kolom wordt zo de lengte van één deel de kniklengte. Geef L_cr,y én \
             L_cr,z op voor de doorgaande lijn als geheel; dan wordt art. 6.3.2 uitgevoerd"
        )
    });
    let kipsteun = opgegeven(input.ltb_segment_length_m) || opgegeven(input.ltb_effective_length_override_m);
    let kip = (input.perform_ltb_check && !(kniklengtes && kipsteun)).then(|| {
        let mist: Vec<&str> = [
            (!kniklengtes, "L_cr,y en L_cr,z (k_c,z in de drukterm van (6.35))"),
            (!kipsteun, "de kipsteunafstand of l_ef (tabel 6.1)"),
        ]
        .iter()
        .filter(|(ja, _)| *ja)
        .map(|(_, wat)| *wat)
        .collect();
        format!(
            "de staaf loopt aan {waar} zonder oplegging in het verlengde door in een andere staaf \
             (met een andere doorsnede of een ander materiaal; in 3D elke voortzetting, want daar \
             worden staven niet samengevoegd). Dat staafeind is geen gaffel; de terugval op \
             de staaflengte zou het als zijdelings gesteund en torsievast aannemen. Kip is daarom \
             niet getoetst: geef {} op voor de doorgaande lijn als geheel, of zet op die \
             tussenknoop een steun",
            mist.join(" en ")
        )
    });
    DoorlopendEind { plaatsen, knik, kip }
}

/// Een geweigerde stabiliteitstoets: NotApplicable, géén UC, de reden in de
/// notities. Nooit een UC van 0 die als "voldoet" leest.
fn stabiliteit_geweigerd(
    id: &str,
    titel: &str,
    artikel: &str,
    reden: &str,
    staaf_notities: &[String],
    force_state: ForceStateSnapshot,
) -> NamedCheck {
    let mut notes = vec![format!("Niet getoetst: {reden}.")];
    notes.extend(staaf_notities.iter().cloned());
    make_stability(StabilityCalc {
        id: id.to_string(),
        title: titel.to_string(),
        article: artikel.to_string(),
        force_state,
        formula_latex: String::new(),
        variables: vec![],
        intermediate_values: vec![],
        deelstappen: vec![],
        value: 0.0,
        unit: "-".to_string(),
        uc: None,
        status: CheckStatus::NotApplicable,
        notes,
    })
}

/// Wat de toetsketen nodig heeft en NIET van de belastingduurklasse afhangt.
struct Keten<'a> {
    input: &'a TimberBeamCheckInput,
    section: &'a TimberSection,
    mat: &'static StrengthClass,
    afschuining: Option<Afschuining>,
    /// Het belastinggeval van tabel 6.1, opgegeven of afgeleid (issue #220),
    /// met de notitie over de afleiding.
    kipgeval: (nen_en_1995_1_1::stability::LtbLoadCase, Option<String>),
}

/// De toetsen die van k_mod afhangen — doorsneden §6.1 en stabiliteit §6.3.2
/// en §6.3.3 — voor één omhullende en één belastingduurklasse.
///
/// Zonder belastingduur per combinatie wordt dit één keer aangeroepen, met de
/// hele omhullende en `load_duration` van de staaf: precies de keten van vóór
/// september 2026. Met die lijst één keer per aanwezige klasse, met de punten
/// van die klasse (zie `crate::belastingduur`).
fn toetsketen_punt(k: &Keten, punt: ForcePoint, duur: LoadDurationClass) -> Vec<NamedCheck> {
    let input = k.input;
    let section = k.section;
    let mat = k.mat;

    // Factoren en rekenwaarden.
    // γ_M uit de rij van de bijlage die in DEZE invoer staat (2.4.1, tabel
    // 2.3), niet uit een vaste constante: dit is de plek waar een tweede
    // bijlage een andere materiaalfactor krijgt.
    let ndp = nationale_bijlage::Ndp1995::voor(input.bijlage);
    let gamma = match mat.timber_type {
        nen_en_1995_1_1::TimberType::Solid => ndp.gamma_m_massief,
        nen_en_1995_1_1::TimberType::Glulam => ndp.gamma_m_gelamineerd,
    };
    let kmod = k_mod(mat.timber_type, input.service_class, duur);
    let ksys = k_sys(input.load_sharing);
    // k_h geldt volgens §3.2(3) en §3.3(3) uitdrukkelijk bij een RECHTHOEKIGE
    // doorsnede ("bij rechthoekig gezaagd hout", "bij rechthoekig gelijmd
    // gelamineerd hout"). Bij een samengestelde doorsnede blijft hij dus 1,0.
    // Dat is bovendien de veilige kant: k_h is een verhoging van f_m,k en
    // f_t,0,k, geen verlaging.
    let (kh_y, kh_z, kh_t) = if section.rechthoekig {
        (
            k_h(mat.timber_type, section.h_mm), // buiging om y: hoogte h
            k_h(mat.timber_type, section.b_mm), // buiging om z: hoogte b
            k_h(mat.timber_type, section.h_mm.max(section.b_mm)), // trek: grootste maat (§3.2(3))
        )
    } else {
        (1.0, 1.0, 1.0)
    };
    // §6.1.6(2): k_m = 0,7 bij een rechthoekige doorsnede, 1,0 bij alle andere.
    let km = k_m(section.rechthoekig);
    // Scheurfactor voor de dwarskracht. Bij een prismatische (rechthoekige)
    // ligger is dat de waarde uit de invoer -- de NB schrijft daar 1,0 voor en
    // dat is ook de standaardwaarde van het invoerveld. Bij een I-, T- of
    // kokervorm leest de NB bij 6.1.7 k_cr af uit de verhouding lijfdikte /
    // flensbreedte; die verhouding kent de invoer niet en de doorsnede wel,
    // dus wordt hij hier bepaald. Zie `shear::k_cr_nb`.
    let k_cr = if section.rechthoekig {
        input.k_cr
    } else {
        shear::k_cr_nb(section.b_schuif_mm, section.b_flens_mm)
    };

    let f_c0d = design_strength(mat.f_c0k, kmod, gamma, 1.0, ksys);
    let f_t0d = design_strength(mat.f_t0k, kmod, gamma, kh_t, ksys);
    let f_myd = design_strength(mat.f_mk, kmod, gamma, kh_y, ksys);
    let f_mzd = design_strength(mat.f_mk, kmod, gamma, kh_z, ksys);
    let f_vd = design_strength(mat.f_vk, kmod, gamma, 1.0, ksys);

    // Elke toets wordt op ieder station van zijn combinatie uitgevoerd.
    // De omhulling kiest verderop per toets de hoogste berekende UC, zodat
    // My, Mz, Vy, Vz, T en N op verschillende stations kunnen regeren.
    let state = ForceStateSnapshot::from_point(&punt);

    // Doorsnedetoetsen.
    let mut checks: Vec<NamedCheck> = Vec::new();
    checks.push(make_resistance(compression::check_tension_parallel(
        section, f_t0d, state,
    )));
    checks.push(make_resistance(compression::check_compression_parallel(
        section, f_c0d, state,
    )));
    checks.push(make_resistance(bending::check_bending(
        section, f_myd, f_mzd, km, state,
    )));
    checks.push(make_resistance(bending::check_bending_tension(
        section, f_t0d, f_myd, f_mzd, km, state,
    )));
    // §6.2.4 (6.19)/(6.20): druk met buiging op doorsnedeniveau.
    checks.push(make_resistance(bending::check_bending_compression(
        section, f_c0d, f_myd, f_mzd, km, state,
    )));
    checks.push(make_resistance(shear::check_shear(
        section, f_vd, k_cr, state,
    )));
    // §6.4.2: buiging aan de schuine rand van een verlopende ligger (issue
    // #253). Alleen in de deelvraag van een rekenpunt van een staaf waarvan
    // de HOOGTE verloopt; een prismatische staaf houdt haar lijst.
    if let Some(a) = k.afschuining {
        let f_t90d = design_strength(mat.f_t90k, kmod, gamma, 1.0, ksys);
        let f_c90d = design_strength(mat.f_c90k, kmod, gamma, 1.0, ksys);
        checks.push(make_resistance(nen_en_1995_1_1::afgeschuind::check_tapered_edge(
            section,
            nen_en_1995_1_1::afgeschuind::Sterkten642 { f_md: f_myd, f_vd, f_t90d, f_c90d },
            a.tan_alpha_enkel,
            a.rand,
            state,
        )));
    }
    // De nieuwe torsietoetsen verschijnen zodra de staaf in een van haar
    // combinaties torsie draagt. De 2D-referenties (T = 0) houden hun lijst.
    if input
        .forces_envelope
        .iter()
        .any(|p| p.forces.mt_ed.abs() > 1e-12)
    {
        checks.push(make_resistance(torsion::check_torsion(
            section, f_vd, state,
        )));
        checks.push(make_resistance(torsion::check_torsion_shear(
            section, f_vd, k_cr, state,
        )));
    }

    // Kolomknik §6.3.2 op het maatgevende buigpunt (conform de
    // referentie-uitwerking: veldmoment + normaalkracht).
    //
    // De kniklengten beslist de kern, mét herkomst (zie
    // `nen_en_1993_1_1_stability::kniklengte`): opgegeven, of om z uit
    // steunen aan BEIDE randen, of de staaflengte. Dezelfde L_cr,z gaat
    // hieronder ook naar de drukterm van de kiptoets.
    let bc = beta_c(mat.timber_type);
    let l_staaf_mm = input.length_m * 1e3;
    // Een vrij eind zonder opgegeven kniklengte: 2·L, of de staaflengte om
    // een as waarvan de zijdelingse uitbuiging al in de globale tweede-orde-
    // berekening met scheefstand zit (zie `ZijdelingseKnikInAnalyse`).
    let zijdelings = input.zijdelingse_knik_in_analyse.unwrap_or_default();
    let kniklengte_of_vrij = |as_naam: &str,
                              in_vlak: bool,
                              opgegeven_m: f64,
                              steunen: Option<Steunen<'_>>,
                              gedekt: bool| {
        if input.is_cantilever && !(opgegeven_m.is_finite() && opgegeven_m > 0.0) {
    // Een vrij eind: de vlag, of een `Vrij` eind in `staafeinden`.
    let vrij_eind = input.is_cantilever
        || input
            .staafeinden
            .is_some_and(|e| e.begin == Staafeind::Vrij || e.eind == Staafeind::Vrij);
    let doorlopend = doorlopend_eind(input);
    let kniklengte_of_vrij = |as_naam: &str, in_vlak: bool, opgegeven_m: f64, steunen: Option<Steunen<'_>>, gedekt: bool| {
        if vrij_eind && !(opgegeven_m.is_finite() && opgegeven_m > 0.0) {
            Kniklengte::vrij_eind_volgens_analyse(
                as_naam,
                l_staaf_mm,
                in_vlak,
                "een van de staafeinden",
                gedekt,
                "NEN-EN 1995-1-1 5.4.4, op voorwaarde dat die berekening met E_d = E_mean/γ_M (2.2.2(1)P) en de imperfecties van 5.4.4(2) is gemaakt",
            )
        } else {
            bepaal_kniklengte(as_naam, in_vlak, opgegeven_m, l_staaf_mm, steunen)
        }
    };
    let kniklengte_y = kniklengte_of_vrij("y", true, input.buckling_length_y_m, None, zijdelings.y);
    let kniklengte_z = kniklengte_of_vrij(
        "z",
        input.ruimtelijk,
        input.buckling_length_z_m,
        input.lateral_bracing.as_ref().map(|b| Steunen {
            boven: &b.top_flange_positions,
            onder: &b.bottom_flange_positions,
            soort: Steunrand::Rand,
        }),
        zijdelings.z,
    );
    let l_cr_z_mm = kniklengte_z.l_cr_mm;
    let kniklengte_z_samenvatting = kniklengte_z.samenvatting();
    let staaf_notities: Vec<String> = input.staaf_notities.iter().flatten().cloned().collect();
    if let Some(reden) = &doorlopend.knik {
        checks.push(stabiliteit_geweigerd(
            "6.3.2_column_stability",
            "Kolomknik (druk en buiging)",
            "art. 6.3.2",
            reden,
            &staaf_notities,
            state,
        ));
    } else {
        let mut kolom = check_column_stability(
            section,
            &ColumnStabilityInput {
                kniklengte_y,
                kniklengte_z,
                f_c0k_mpa: mat.f_c0k,
                e0_05_mpa: mat.e0_05,
                beta_c: bc,
                f_c0d_mpa: f_c0d,
                f_myd_mpa: f_myd,
                f_mzd_mpa: f_mzd,
                k_m: km,
            },
            state,
        );
        kolom.notes.extend(staaf_notities.iter().cloned());
        checks.push(make_stability(kolom));
    }

    // Kipstabiliteit §6.3.3.
    if let Some(reden) = &doorlopend.kip {
        checks.push(stabiliteit_geweigerd(
            "6.3.3_beam_stability",
            "Kipstabiliteit (buiging en druk)",
            "art. 6.3.3",
            reden,
            &staaf_notities,
            state,
        ));
    } else if input.perform_ltb_check {
        let (segment_mm, segment_herkomst) = if input.ltb_segment_length_m > 0.0 {
            (input.ltb_segment_length_m * 1e3, "kipsteunafstand")
        } else {
            (input.length_m * 1e3, "staaflengte, terugval")
        };
        // Hoe l_ef tot stand kwam, mét het aangrijpingspunt van de belasting:
        // dat is een keuze van de gebruiker en hoort daarom in het rapport.
        let (l_ef_mm, l_ef_notitie) = if input.ltb_effective_length_override_m > 0.0 {
            (
                input.ltb_effective_length_override_m * 1e3,
                format!(
                    "l_ef = {:.0} mm is rechtstreeks opgegeven (ltb_effective_length_override_m) en \
                     niet uit tabel 6.1 afgeleid.",
                    input.ltb_effective_length_override_m * 1e3
                ),
            )
        } else {
            (
                effective_length_mm(
                    segment_mm,
                    k.kipgeval.0,
                    input.ltb_load_position,
                    section.h_mm,
                ),
                l_ef_toelichting(
                    segment_mm,
                    segment_herkomst,
                    k.kipgeval.0,
                    input.ltb_load_position,
                    section.h_mm,
                ),
            )
        };
        let mut kip = check_beam_stability(
            section,
            &BeamStabilityInput {
                l_ef_mm,
                l_cr_z_mm,
                f_mk_mpa: mat.f_mk,
                f_c0k_mpa: mat.f_c0k,
                e0_05_mpa: mat.e0_05,
                beta_c: bc,
                f_myd_mpa: f_myd,
                f_mzd_mpa: f_mzd,
                f_c0d_mpa: f_c0d,
            },
            state,
        );
        // Waar de kniklengte in de drukterm van (6.35) vandaan komt. Zonder
        // deze regel ziet de lezer van de kiptoets k_c,z staan maar niet met
        // welke L_cr,z hij bepaald is — en die kan op de staaflengte zijn
        // teruggevallen.
        kip.notes.push(l_ef_notitie);
        if input.ltb_effective_length_override_m <= 0.0 {
            if let Some(n) = &k.kipgeval.1 {
                kip.notes.push(n.clone());
            }
        }
        kip.notes.push(format!(
            "k_c,z in de drukterm van (6.35) is bepaald met {kniklengte_z_samenvatting} — dezelfde \
             kniklengte als in de kolomtoets van art. 6.3.2, waar haar afleiding staat."
        ));
        kip.notes.extend(staaf_notities.iter().cloned());
        checks.push(make_stability(kip));
    } else {
        // Uitgezet door de invoer: NIET stil weglaten. De toets staat als
        // "niet van toepassing" in het resultaat, met de aanname (gedrukte
        // rand doorgaand gesteund, art. 6.3.3(5)) in de notitie.
        checks.push(make_stability(kip_overgeslagen_drukzijde_gesteund(
            section, state,
        )));
    }

    // Issue #243 (punt 074): uit welke EDITIE de karakteristieke waarden
    // komen. EN 338:2009 en :2016 verschillen in f_t,0,k (C24: 14,0 tegen
    // 14,5 N/mm²); zonder editie kan de lezer f_t,0,d niet narekenen.
    let bron = format!(
        "Karakteristieke waarden van {} uit {}: f_m,k = {:.1}, f_t,0,k = {:.1}, \
         f_c,0,k = {:.1}, f_v,k = {:.1} N/mm².",
        mat.name,
        mat.bron(),
        mat.f_mk,
        mat.f_t0k,
        mat.f_c0k,
        mat.f_vk,
    );
    for c in checks.iter_mut() {
        if let CheckKind::Resistance(r) = &mut c.kind {
            if r.id.starts_with("6.1.") {
                r.notes.push(bron.clone());
            }
        }
    }

    checks
}

fn toetsketen(k: &Keten, omhullende: &[ForcePoint], duur: LoadDurationClass) -> Vec<NamedCheck> {
    let nul = ForcePoint {
        combination_id: 0,
        position_mm: 0.0,
        forces: Default::default(),
    };
    let mut punten = omhullende.iter().copied();
    let mut checks = toetsketen_punt(k, punten.next().unwrap_or(nul), duur);
    for punt in punten {
        let op_punt = toetsketen_punt(k, punt, duur);
        for (beste, kandidaat) in checks.iter_mut().zip(op_punt) {
            if uc_of(&kandidaat) > uc_of(beste) {
                *beste = kandidaat;
            }
        }
    }
    checks
}

/// Wat de toetsing per belastingduurklasse oplevert.
struct PerKlasse {
    checks: Vec<NamedCheck>,
    k_mod_per_load_duration: Vec<KmodPerLoadDuration>,
    governing_combination_id: Option<u32>,
    maatgevende_duur: LoadDurationClass,
}

/// De keten per klasse, en per toets de zwaarste uitkomst over de klassen.
///
/// Elke klasse levert dezelfde toetsen in dezelfde volgorde (de keten hangt
/// alleen via k_mod en de omhullende van de klasse af), dus toets i van de ene
/// klasse is toets i van de andere. Bij gelijke unity check wint de LANGSTE
/// klasse (die staat vooraan): dat is de kant met de laagste k_mod.
fn toets_per_klasse(k: &Keten, groepen: &[Groep]) -> PerKlasse {
    let service = k.input.service_class;
    let kmods: Vec<f64> = groepen
        .iter()
        .map(|g| k_mod(k.mat.timber_type, service, g.duur))
        .collect();
    let uitkomsten: Vec<Vec<NamedCheck>> = groepen
        .iter()
        .map(|g| toetsketen(k, &g.punten, g.duur))
        .collect();

    let n = uitkomsten[0].len();
    let mut checks = Vec::with_capacity(n);
    let mut maatgevend: Option<(f64, usize, u32)> = None;
    for i in 0..n {
        let mut beste = 0usize;
        for (gi, u) in uitkomsten.iter().enumerate().skip(1) {
            debug_assert_eq!(
                u[i].id, uitkomsten[0][i].id,
                "de ketens horen dezelfde toetsvolgorde te hebben"
            );
            if uc_of(&u[i]) > uc_of(&uitkomsten[beste][i]) {
                beste = gi;
            }
        }
        let mut c = uitkomsten[beste][i].clone();
        let uc = uc_of(&c);
        let combinatie = force_state_van(&c).combination_id;
        let gekozen = KlasseUc {
            duur: groepen[beste].duur,
            k_mod: kmods[beste],
            combinaties: groepen[beste].combinaties.clone(),
            uc: uc_optie(&c),
        };
        let andere: Vec<KlasseUc> = groepen
            .iter()
            .enumerate()
            .filter(|(gi, _)| *gi != beste)
            .map(|(gi, g)| KlasseUc {
                duur: g.duur,
                k_mod: kmods[gi],
                combinaties: g.combinaties.clone(),
                uc: uc_optie(&uitkomsten[gi][i]),
            })
            .collect();
        notes_van(&mut c).push(kmod_notitie(service, &gekozen, combinatie, &andere));
        if uc > 0.0 && maatgevend.map_or(true, |(u, _, _)| uc > u) {
            maatgevend = Some((uc, beste, combinatie));
        }
        checks.push(c);
    }

    let k_mod_per_load_duration = groepen
        .iter()
        .enumerate()
        .map(|(gi, g)| KmodPerLoadDuration {
            load_duration: g.duur,
            k_mod: kmods[gi],
            combination_ids: g.combinaties.clone(),
            bases: g.bases.clone(),
        })
        .collect();
    let (governing_combination_id, maatgevende_duur) = match maatgevend {
        Some((_, gi, combinatie)) => (Some(combinatie), groepen[gi].duur),
        None => (None, groepen[0].duur),
    };
    PerKlasse {
        checks,
        k_mod_per_load_duration,
        governing_combination_id,
        maatgevende_duur,
    }
}

pub fn check_timber_beam(input: TimberBeamCheckInput) -> TimberBeamCheckResult {
    check_timber_beam_intern(input, None)
}

/// [`check_timber_beam`] met, voor een rekenpunt van een verlopende staaf, de
/// helling voor §6.4.2 (zie `crate::verlopend`).
pub(crate) fn check_timber_beam_intern(
    input: TimberBeamCheckInput,
    afschuining: Option<Afschuining>,
) -> TimberBeamCheckResult {
    // -2. DE DOORBUIGINGSNOEMERS. Een opgegeven noemer van 0 of kleiner gaf
    //     tot september 2026 een oneindige grens, UC 0 en status Ok. Het is
    //     een invoerfout (beide velden hebben een NB-standaardwaarde voor als
    //     ze wegblijven), dus de staaf wordt geweigerd met de reden — dezelfde
    //     vorm als een onbekende sterkteklasse hieronder. Vóór de
    //     verloopafslag, zodat een verlopende staaf dezelfde keuring krijgt.
    // Een aangeleverde langeduurzakking w_qp,fin (2.2.3(4)) krijgt dezelfde
    // behandeling: een niet-eindig getal is geen zakking.
    if let Err(reden) = nen_en_1995_1_1::deflection::keur_noemers(
        input.deflection_limit_fin,
        input.deflection_limit_add,
    )
    .and_then(|_| {
        nen_en_1995_1_1::deflection::keur_langeduurzakking(input.deflection_quasi_perm_fin_mm)
    })
    .and_then(|_| nen_en_1995_1_1::deflection::keur_w_add(input.deflection_add_mm))
    .and_then(|_| nen_en_1995_1_1::deflection::keur_zeeg(input.pre_camber_mm))
    {
        return TimberBeamCheckResult {
            beam_id: input.beam_id,
            section_name: format!("{} x {}", input.width_mm, input.height_mm),
            strength_class: input.strength_class.clone(),
            service_class: input.service_class,
            load_duration: input.load_duration,
            checks: vec![],
            uc_max: 0.0,
            status: CheckStatus::NotApplicable,
            governing_check_id: format!("ERROR: {reden}"),
            k_mod_per_load_duration: vec![],
            governing_combination_id: None,
            verloop: None,
        };
    }

    // -1. VERLOPENDE STAAF? Dan gaat hij langs een eigen weg
    //     (`crate::verlopend`), die deze functie per rekenpunt opnieuw
    //     aanroept met de PLAATSELIJKE rechthoek. Zonder eindmaten — en dat is
    //     elke bestaande staaf — valt deze afslag weg en loopt alles hieronder
    //     ongewijzigd door: een prismatische staaf verandert geen enkel getal.
    match crate::verlopend::bepaal_verloop(&input) {
        Ok(None) => {}
        Ok(Some(v)) => return crate::verlopend::check_timber_beam_verlopend(input, v),
        Err(reden) => {
            return TimberBeamCheckResult {
                beam_id: input.beam_id,
                section_name: format!("{} x {}", input.width_mm, input.height_mm),
                strength_class: input.strength_class.clone(),
                service_class: input.service_class,
                load_duration: input.load_duration,
                checks: vec![],
                uc_max: 0.0,
                status: CheckStatus::NotApplicable,
                governing_check_id: format!("ERROR: {reden}"),
                k_mod_per_load_duration: vec![],
                governing_combination_id: None,
                verloop: None,
            }
        }
    }

    // 0. De doorsnede. Lukt dat niet, dan STOPT de toetsing van deze staaf met
    //    de reden erbij -- er wordt geen vervangende doorsnede verzonnen.
    let (section, section_name) = match doorsnede_uit(&input) {
        Ok(paar) => paar,
        Err(reden) => {
            return TimberBeamCheckResult {
                beam_id: input.beam_id,
                section_name: input
                    .custom_section
                    .as_ref()
                    .map(|c| c.naam.clone())
                    .unwrap_or_default(),
                strength_class: input.strength_class.clone(),
                service_class: input.service_class,
                load_duration: input.load_duration,
                checks: vec![],
                uc_max: 0.0,
                status: CheckStatus::NotApplicable,
                governing_check_id: format!("ERROR: {reden}"),
                k_mod_per_load_duration: vec![],
                governing_combination_id: None,
                // Prismatische staaf: geen verloopgegevens.
                verloop: None,
            };
        }
    };

    // 1. Sterkteklasse opzoeken.
    let mat = match strength_class_by_name(&input.strength_class) {
        Some(m) => m,
        None => {
            return TimberBeamCheckResult {
                beam_id: input.beam_id,
                section_name,
                strength_class: input.strength_class.clone(),
                service_class: input.service_class,
                load_duration: input.load_duration,
                checks: vec![],
                uc_max: 0.0,
                status: CheckStatus::NotApplicable,
                governing_check_id: format!(
                    "ERROR: sterkteklasse {} onbekend",
                    input.strength_class
                ),
                k_mod_per_load_duration: vec![],
                governing_combination_id: None,
                // Prismatische staaf: geen verloopgegevens.
                verloop: None,
            };
        }
    };

    // 2-6. De toetsen die van k_mod afhangen. Zonder belastingduur per
    //      combinatie één keten met `load_duration`; met die lijst één keten
    //      per aanwezige klasse (EN 1995-1-1 3.1.3(2)).
    let keten = Keten {
        input: &input,
        section: &section,
        mat,
        afschuining,
        kipgeval: crate::kipgeval::kipgeval(&input),
    };
    let (mut checks, k_mod_per_load_duration, governing_combination_id, load_duration) =
        match belastingduur::groepeer(
            &input.forces_envelope,
            &input.load_duration_per_combination,
            input.load_duration,
        ) {
            None => (
                toetsketen(&keten, &input.forces_envelope, input.load_duration),
                Vec::new(),
                None,
                input.load_duration,
            ),
            Some(groepen) => {
                let pk = toets_per_klasse(&keten, &groepen);
                (
                    pk.checks,
                    pk.k_mod_per_load_duration,
                    pk.governing_combination_id,
                    pk.maatgevende_duur,
                )
            }
        };

    // 7. Doorbuiging §7.2 met kruip. Hangt niet van k_mod af (wel van k_def),
    //    en wordt dus één keer getoetst.
    let kdef = k_def(mat.timber_type, input.service_class);
    // Met een aangeleverde w_qp,fin volgens 2.2.3(4) (delen met verschillend
    // kruipgedrag), anders de vereenvoudiging van 2.2.3(5) — bit-identiek aan
    // de rekengang van vóór dat veld.
    // Met w₃ per BGT-combinatie (`deflection_add_mm`, issues #200/#210) is
    // w_add = w₂ + w₃; zonder dat veld bit-identiek aan de rekengang van daarvoor.
    let (mut fin, mut add) = deflection::check_deflection_pair_volledig(
        input.deflection_inst_mm,
        input.deflection_quasi_perm_mm,
        input.deflection_quasi_perm_fin_mm,
        input.deflection_permanent_mm,
        input.deflection_add_mm,
        input.pre_camber_mm.unwrap_or(0.0),
        kdef,
        input.length_m * 1e3,
        input.deflection_limit_fin,
        input.deflection_limit_add,
    );
    // Waar w_qp vandaan komt, staat bij w_fin — dat is de enige formule waar
    // hij in voorkomt (w_fin = w_inst + k_def · w_qp). w_add volgt uit w_fin en
    // erft de aanname dus, wat in de toelichting zelf hoort te staan.
    fin.notes.extend(input.deflection_notes.iter().cloned());
    fin.notes
        .extend(input.staaf_notities.iter().flatten().cloned());
    if let Some(reason) = input.deflection_not_applicable_reason.as_ref() {
        for check in [&mut fin, &mut add] {
            check.uc = None;
            check.status = CheckStatus::NotApplicable;
            check.notes.push(format!("BGT niet getoetst: {reason}"));
        }
    }
    checks.push(make_resistance(fin));
    checks.push(make_resistance(add));

    // 8. Aggregatie.
    let mut uc_max = 0.0_f64;
    let mut governing_check_id = String::new();
    for c in &checks {
        let uc = uc_of(c);
        if uc > uc_max {
            uc_max = uc;
            governing_check_id = c.id.clone();
        }
    }
    let status = if uc_max <= 1.0 {
        CheckStatus::Ok
    } else {
        CheckStatus::NotOk
    // Een DOORLOPEND staafeind (issue #205) laat art. 6.3.2 en/of 6.3.3
    // weigeren, en een geweigerde toets telt als 0. Zonder deze regel stond de
    // staaf dan op Ok terwijl de kolomtoets bij druk of de kiptoets bij buiging
    // niet was uitgevoerd. De status is dan NotApplicable: niet volledig
    // getoetst, met de reden achter NIET_VOLLEDIG_GETOETST in
    // `governing_check_id` — dezelfde vorm als de staalkern. NotOk blijft NotOk.
    let doorlopend = doorlopend_eind(&input);
    let knik_ontbreekt = doorlopend.knik.is_some()
        && input.forces_envelope.iter().any(|p| p.forces.n_ed < -N_NUL_KN);
    let kip_ontbreekt = doorlopend.kip.is_some()
        && input.forces_envelope.iter().any(|p| p.forces.my_ed.abs() > M_NUL_KNM);
    let status = if uc_max > 1.0 {
        CheckStatus::NotOk
    } else if knik_ontbreekt || kip_ontbreekt {
        let ontbreekt: Vec<&str> = [
            (knik_ontbreekt, "de kolomknik (art. 6.3.2) bij druk"),
            (kip_ontbreekt, "de kip (art. 6.3.3) bij buiging"),
        ]
        .iter()
        .filter(|(ja, _)| *ja)
        .map(|(_, wat)| *wat)
        .collect();
        governing_check_id = format!(
            "{NIET_VOLLEDIG_GETOETST}: {} niet getoetst: de staaf loopt aan {} zonder oplegging door \
             in het verlengde in een andere staaf (de reden staat bij de toets)",
            ontbreekt.join(" en "),
            doorlopend.plaatsen.join(" en ")
        );
        CheckStatus::NotApplicable
    } else {
        CheckStatus::Ok
    };

    TimberBeamCheckResult {
        beam_id: input.beam_id,
        section_name,
        strength_class: mat.name.to_string(),
        service_class: input.service_class,
        load_duration,
        checks,
        uc_max,
        status,
        governing_check_id,
        k_mod_per_load_duration,
        governing_combination_id,
        // Prismatische staaf: geen verloopgegevens, en dan ook niet
        // geserialiseerd (zie TimberBeamCheckResult::verloop).
        verloop: None,
    }
}

/// De hele lijst in één keer — de batch-instap van deze kern.
///
/// Waarom dit bestaat en niet elke schil zijn eigen lus schrijft: het
/// Tauri-command, de toetsbrug én de MCP-server voeren alle drie dezelfde
/// staven door dezelfde toetsing. Zolang die lus in de schil staat, is er drie
/// keer een plek waar iemand de volgorde omdraait, een staaf overslaat of een
/// filter toevoegt — en dan geeft hetzelfde raamwerk per omgeving een ander
/// antwoord. Staal (`steel_check::check_all_beams`) en beton
/// (`concrete_check::check_all_concrete_beams`) hebben zo'n instap al; hout
/// hield als enige de lus buiten de bibliotheek.
pub fn check_all_timber_beams(inputs: Vec<TimberBeamCheckInput>) -> Vec<TimberBeamCheckResult> {
    inputs.into_iter().map(check_timber_beam).collect()
}
