//! Tweede orde (P-Δ) en de eerste knikfactor, uitgevoerd in de adapter (#60).
//!
//! De P-Δ-lus van de externe kern bewaart de symbolische sparse-Cholesky-
//! factorisatie van de eerste iteratie en hergebruikt die, terwijl het patroon
//! van K + K_G per iteratie kan verschuiven. Vanaf ongeveer 64 vrije
//! vrijheidsgraden weigert de factorisatie dan. Deze module gebruikt dezelfde
//! publieke bouwstenen van de kern (vrijheidsgraadnummering, sparse
//! assemblage, reductie voor koppelingen, sparse Cholesky, eigenwaardesolver
//! en het lineaire rekenpad) en factoriseert elke iteratie opnieuw, met een
//! verse symbolische analyse.
//!
//! Formulering:
//! - K is de lineaire stijfheid van de kern, inclusief oplegveren en de
//!   grondveren van een bedding.
//! - K_G per staaf is de consistente geometrische stijfheid die de kern ook
//!   gebruikt (N/(30L), alleen de buigvrijheidsgraden, geen torsieterm). Anders
//!   dan de kern condenseert deze module K_G bij een vrijgegeven staafeinde met
//!   dezelfde betrekking waarmee de kern de lineaire staaf condenseert. Zonder
//!   die condensatie geeft een scharnierende staaf onder druk een negatieve
//!   rotatiestijfheid af aan een knoop die hij niet kan roteren, met een
//!   niet-fysische knikvorm als gevolg.
//! - N (trek positief) volgt uit de staafverlenging en een uniforme
//!   temperatuurlast: N = EA/L·Δ − E·A·α·ΔT. Dat is dezelfde normaalkracht die
//!   de kern na afloop rapporteert.
//! - Iteratie: (K + K_G(N_k))·u_{k+1} = F, met convergentie op de relatieve
//!   verplaatsingswijziging ‖u_{k+1} − u_k‖/‖u_{k+1}‖ < tol. Een K + K_G die niet
//!   positief definiet is, betekent instabiliteit.
//! - Eindresultaat: de kern lost K·u = F − K_G·u lineair op. Dat geeft dezelfde u,
//!   de staafkrachten van de kern (k_e·u minus vaste-eindkrachten) en reacties
//!   ((K + K_G)·u − F) op de opgelegde vrijheidsgraden. K_G voert bij een starre
//!   translatie geen kracht af, dus de krachtensom sluit exact. De momentensom
//!   om de oorsprong in de onvervormde stand wijkt precies af met
//!   Σ N·(e_x × Δu) over de staven: het tweede-ordemoment. De staafkrachten
//!   krijgen daarna K_G·u erbij (`tweede_orde_staafkrachten`), zodat het moment
//!   bij een scharnierende oplegging nul is (K4, #186).
//! - De adapter rekent de tweede orde en de knik met elke gedrukte staaf in
//!   vier delen per stuk tussen twee echte knopen (`KNIKDELEN` in de
//!   crate-wortel), zodat N_cr de Euler-waarde benadert en een staaf met twee
//!   scharnieren een eigen knikvorm heeft. Elk deel rekent in K_G met zijn
//!   eigen normaalkracht; bij een last langs de staafas verloopt N dus per
//!   deel, en het tweede-ordemoment is Σ N_deel·(e_x × Δu_deel) over de delen
//!   (`Tweedeorde::delen`, in de uitkomst `secondOrderParts`).
//! - Knikfactor: K·φ = λ·(−K_G(N_1))·φ met N_1 de eerste-ordenormaalkrachten,
//!   opgelost met de eigenwaardesolver van de kern op de gereduceerde matrices.

use std::collections::HashMap;
use std::rc::Rc;

use rekenkern::{
    element::{compute_local_axes_3d, frame_transform_3d},
    linalg::{
        lanczos_buckling_eigen_sparse, numeric_cholesky, sparse_cholesky_solve, symbolic_cholesky,
        transform_displacement, transform_stiffness, CscMatrix, NumericCholesky,
    },
    solver::{
        assembly::assemble_sparse_3d, constraints::FreeConstraintSystem, dof::DofNumbering,
        linear::solve_3d,
    },
    types::{AnalysisResults3D, DistributedLoadInfo, SolverInput3D, SolverLoad3D, SolverNodalLoad3D},
};

use crate::{BucklingModeSummary, BucklingSummary, MemberBucklingData, SecondOrderSummary};

/// Wat de adapter van de tweede-ordeberekening teruggeeft.
pub(crate) struct Tweedeorde {
    pub results: AnalysisResults3D,
    pub summary: SecondOrderSummary,
    pub buckling: BucklingSummary,
    pub diagnostics: Vec<String>,
    /// Per kernelement de normaalkracht waarmee K_G in de eindtoestand is
    /// gerekend (kN, trek positief) en Δu = u_j − u_i van zijn eindknopen
    /// (globale translaties, m). De momentensom van lasten en reacties in de
    /// onvervormde stand is Σ N·(e_x × Δu) over deze elementen.
    pub delen: HashMap<usize, (f64, [f64; 3])>,
}

/// Staafgegevens die elke iteratie opnieuw nodig zijn.
struct Staaf {
    id: usize,
    dofs: [usize; 12],
    /// Transformatie globaal → lokaal, 12×12 rij voor rij.
    t: Vec<f64>,
    lengte: f64,
    ea_l: f64,
    /// E·A·α·ΔT in kN; N = EA/L·Δ − deze waarde.
    n_thermisch: f64,
    /// Lokaal x-y-vlak (v, θz): vrijgaven mz en schuifparameter.
    vlak_xy: Vlak,
    /// Lokaal x-z-vlak (w, θy): vrijgaven my en schuifparameter.
    vlak_xz: Vlak,
    /// Voor de knikgegevens per staaf.
    e_kn_m2: f64,
    area: f64,
    iy: f64,
    iz: f64,
}

#[derive(Clone, Copy)]
struct Vlak {
    begin_vrij: bool,
    eind_vrij: bool,
    phi: f64,
}

/// Alles wat van de constructie afhangt en niet van de iteratie.
struct Stelsel {
    dof: DofNumbering,
    nf: usize,
    k_ff: CscMatrix,
    f_f: Vec<f64>,
    /// K_fr·u_r voor opgelegde verplaatsingen, anders nul.
    k_fr_ur: Vec<f64>,
    /// Volledige vector met alleen de opgelegde waarden (vrije plaatsen nul).
    u_opgelegd: Vec<f64>,
    heeft_opgelegd: bool,
    koppelingen: Option<FreeConstraintSystem>,
    staven: Vec<Staaf>,
}

fn paniek_tekst(payload: Box<dyn std::any::Any + Send>) -> String {
    payload.downcast_ref::<&str>().map(|s| s.to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "onbekende fout".into())
}

/// De geometrische stijfheid van deze module kent alleen raamwerkstaven met
/// zes vrijheidsgraden per knoop. Een model met andere elementen gaat niet
/// door de tweede orde of de knikanalyse van de adapter. De veerelementen
/// (connectors) van een bedding mogen erbij: het zijn lineaire grondveren in
/// K zonder geometrische stijfheid, zoals bij een Winkler-grond (`bedding`).
fn alleen_staven(input: &SolverInput3D) -> Result<(), String> {
    if !input.plates.is_empty() || !input.quads.is_empty() || !input.quad9s.is_empty()
        || !input.solid_shells.is_empty() || !input.curved_shells.is_empty()
        || !input.curved_beams.is_empty()
        || input.sections.values().any(|section| section.cw.is_some())
        || input.elements.values().any(|element| element.elem_type != "frame")
    {
        return Err(
            "tweede orde en de knikfactor rekenen in de adapter alleen met raamwerkstaven; dit model bevat andere elementen"
                .into(),
        );
    }
    Ok(())
}

impl Stelsel {
    /// Nummering, assemblage en koppelingen; staven alleen voor de K_G.
    fn bouw(input: &SolverInput3D) -> Result<Self, String> {
        let dof = DofNumbering::build_3d(input);
        let nf = dof.n_free;
        let n = dof.n_total;
        let sasm = assemble_sparse_3d(input, &dof, true);
        let k_full = sasm.k_full.ok_or("interne fout: de volledige stijfheidsmatrix ontbreekt")?;

        let mut u_opgelegd = vec![0.0; n];
        let mut heeft_opgelegd = false;
        for support in input.supports.values() {
            let waarden = [support.dx, support.dy, support.dz, support.drx, support.dry, support.drz];
            for (lokaal, waarde) in waarden.iter().enumerate() {
                let Some(waarde) = waarde else { continue };
                if waarde.abs() <= 1e-15 { continue; }
                if let Some(&d) = dof.map.get(&(support.node_id, lokaal)) {
                    if d >= nf {
                        u_opgelegd[d] = *waarde;
                        heeft_opgelegd = true;
                    }
                }
            }
        }
        let k_fr_ur = if heeft_opgelegd {
            k_full.sparse_cross_block_matvec(&u_opgelegd[nf..], nf)
        } else {
            vec![0.0; nf]
        };
        let koppelingen = FreeConstraintSystem::build_3d(&input.constraints, &dof, &input.nodes);
        let staven = staven(input, &dof)?;
        Ok(Self {
            nf, k_ff: sasm.k_ff, f_f: sasm.f[..nf].to_vec(), k_fr_ur,
            u_opgelegd, heeft_opgelegd, koppelingen, staven, dof,
        })
    }

    /// Volledige verplaatsingsvector uit de kernuitvoer.
    fn vector_uit(&self, results: &AnalysisResults3D) -> Vec<f64> {
        let mut u = vec![0.0; self.dof.n_total];
        for d in &results.displacements {
            for (lokaal, waarde) in [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz].into_iter().enumerate() {
                if let Some(&index) = self.dof.map.get(&(d.node_id, lokaal)) {
                    u[index] = waarde;
                }
            }
        }
        u
    }

    /// De normaalkracht van elk element uit zijn verlenging: bij een last
    /// langs de staafas het gemiddelde over dat element. Een voor de knik
    /// onderverdeelde staaf (`KNIKDELEN`) rekent zo in elk deel met zijn eigen
    /// N; tot de controle van oktober 2026 (K4) kregen de delen van één stuk
    /// het gemiddelde van het stuk, en dat liet α_cr van een kolom met eigen
    /// gewicht langs de as tot 20 % te hoog uitvallen.
    fn normaalkrachten(&self, u: &[f64]) -> Vec<f64> {
        self.staven.iter().map(|staaf| staaf.normaalkracht(u)).collect()
    }

    /// Per element de normaalkracht `normaalkrachten` en de translatie-
    /// verschillen Δu = u_j − u_i (globaal); zie `Tweedeorde::delen`.
    fn delen(&self, normaalkrachten: &[f64], u: &[f64]) -> HashMap<usize, (f64, [f64; 3])> {
        self.staven.iter().zip(normaalkrachten).map(|(staaf, &n)| {
            let du = [0, 1, 2].map(|as_| u[staaf.dofs[6 + as_]] - u[staaf.dofs[as_]]);
            (staaf.id, (n, du))
        }).collect()
    }

    /// Element-K_G in globale assen voor elke staaf.
    fn geometrisch(&self, normaalkrachten: &[f64]) -> Vec<Vec<f64>> {
        self.staven.iter().zip(normaalkrachten)
            .map(|(staaf, &n)| transform_stiffness(&staaf.kg_lokaal(n), &staaf.t, 12))
            .collect()
    }

    /// Onderste driehoek van het vrije blok van K_G.
    fn kg_vrij(&self, kg: &[Vec<f64>]) -> CscMatrix {
        let (mut rijen, mut kolommen, mut waarden) = (Vec::new(), Vec::new(), Vec::new());
        for (staaf, matrix) in self.staven.iter().zip(kg) {
            for i in 0..12 {
                let gi = staaf.dofs[i];
                if gi >= self.nf { continue; }
                for j in 0..=i {
                    let gj = staaf.dofs[j];
                    if gj >= self.nf { continue; }
                    let waarde = matrix[i * 12 + j];
                    if waarde != 0.0 {
                        rijen.push(gi);
                        kolommen.push(gj);
                        waarden.push(waarde);
                    }
                }
            }
        }
        let mut matrix = CscMatrix::from_triplets(self.nf, &rijen, &kolommen, &waarden);
        matrix.drop_below_threshold(1e-30);
        matrix
    }

    /// K_G·u over alle vrijheidsgraden, staaf voor staaf.
    fn kg_maal(&self, kg: &[Vec<f64>], u: &[f64]) -> Vec<f64> {
        let mut uit = vec![0.0; self.dof.n_total];
        for (staaf, matrix) in self.staven.iter().zip(kg) {
            for i in 0..12 {
                let mut som = 0.0;
                for j in 0..12 {
                    som += matrix[i * 12 + j] * u[staaf.dofs[j]];
                }
                uit[staaf.dofs[i]] += som;
            }
        }
        uit
    }

    fn reduceer_matrix(&self, matrix: &CscMatrix) -> CscMatrix {
        match &self.koppelingen {
            Some(koppelingen) => koppelingen.reduce_matrix_sparse(matrix),
            None => matrix.clone(),
        }
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

    /// Eén tangentoplossing met een verse factorisatie. `None` = K + K_G niet positief definiet.
    fn los_tangent(&self, kg: &[Vec<f64>]) -> Result<Option<Vec<f64>>, String> {
        let k_t = CscMatrix::linear_combination(1.0, &self.k_ff, 1.0, &self.kg_vrij(kg));
        let mut rechts = self.f_f.clone();
        if self.heeft_opgelegd {
            let kg_ur = self.kg_maal(kg, &self.u_opgelegd);
            for i in 0..self.nf {
                rechts[i] -= self.k_fr_ur[i] + kg_ur[i];
            }
        }
        let k_s = self.reduceer_matrix(&k_t);
        let f_s = self.reduceer_vector(&rechts);
        let Some(factor) = factoriseer(&k_s)? else { return Ok(None) };
        let q = sparse_cholesky_solve(&factor, &f_s);
        let u_f = self.breid_uit(&q);
        if u_f.iter().any(|waarde| !waarde.is_finite()) {
            return Err("de tangentoplossing bevat geen eindige verplaatsingen".into());
        }
        Ok(Some(u_f))
    }

    /// De staafkrachten van de tweede orde: (k_e + K_G)·u per staaf, met de
    /// lijnen in evenwicht in de vervormde stand (K4, #186).
    ///
    /// De eindstap lost K·u = F − K_G·u op; de kern geeft per staaf k_e·u
    /// minus de vaste-eindkrachten. Op een vrije vrijheidsgraad is
    /// Σ (k_e + K_G)·u = F, dus pas met K_G·u erbij is het moment bij een
    /// scharnierende oplegging nul en loopt de momentenlijn door over een
    /// knoop tussen twee delen van een staaf. `normaalkrachten` en `u` zijn
    /// die van de K_G in de eindstap, zodat dat evenwicht exact is.
    ///
    /// Binnen een staaf geldt het evenwicht in de vervormde stand:
    /// M(x) = M_begin + V·x − N·(v(x) − v_begin) − (lastterm), met v de
    /// Hermite-kromme van het element (bij een vrijgegeven einde met de
    /// gecondenseerde einddraaiing, bij twee vrije einden de koorde). De kern
    /// tekent de lijnen uit de eindkrachten en de staaflasten; het deel N·v''
    /// gaat daarom als lineair verlopende dwarslast q = N·v''(x) mee, en de
    /// dwarskracht wordt V = dM/dx: de kracht loodrecht op de vervormde as.
    /// Bij een staaf zonder normaalkracht verandert er niets.
    fn tweede_orde_staafkrachten(&self, normaalkrachten: &[f64], u: &[f64], results: &mut AnalysisResults3D) {
        let plaats: HashMap<usize, usize> = results.element_forces.iter().enumerate()
            .map(|(index, krachten)| (krachten.element_id, index))
            .collect();
        for (staaf, &n) in self.staven.iter().zip(normaalkrachten) {
            let Some(&index) = plaats.get(&staaf.id) else { continue };
            let globaal: Vec<f64> = staaf.dofs.iter().map(|&d| u[d]).collect();
            let lokaal = transform_displacement(&globaal, &staaf.t, 12);
            let kg = staaf.kg_lokaal(n);
            let df: Vec<f64> = (0..12).map(|i| (0..12).map(|j| kg[i * 12 + j] * lokaal[j]).sum()).collect();
            let l = staaf.lengte;
            let krachten = &mut results.element_forces[index];
            // x-y-vlak: v op 1 en 7, θz = v' op 5 en 11; M_z = M_z,begin − V_y·x.
            let [h0, h1, p0, p1] = vorm(&lokaal, [1, 5, 7, 11], 1.0, staaf.vlak_xy, l);
            krachten.mz_start += df[5];
            krachten.mz_end -= df[11];
            krachten.vy_start += df[1] + n * p0;
            krachten.vy_end += df[1] + n * p1;
            if n * h0 != 0.0 || n * h1 != 0.0 {
                krachten.distributed_loads_y.push(DistributedLoadInfo { q_i: n * h0, q_j: n * h1, a: 0.0, b: l });
            }
            // x-z-vlak: w op 2 en 8, θy = −w' op 4 en 10; M_y = M_y,begin + V_z·x.
            let [h0, h1, p0, p1] = vorm(&lokaal, [2, 4, 8, 10], -1.0, staaf.vlak_xz, l);
            krachten.my_start += df[4];
            krachten.my_end -= df[10];
            krachten.vz_start += df[2] + n * p0;
            krachten.vz_end += df[2] + n * p1;
            if n * h0 != 0.0 || n * h1 != 0.0 {
                krachten.distributed_loads_z.push(DistributedLoadInfo { q_i: n * h0, q_j: n * h1, a: 0.0, b: l });
            }
        }
    }

    /// Eerste knikfactoren λ uit K·φ = λ·(−K_G(N))·φ, oplopend, en of er een
    /// nulmode (0 < λ ≤ 1e-9) tussen zat.
    fn knikfactoren(&self, normaalkrachten: &[f64], modes: usize) -> Result<(Vec<f64>, bool), String> {
        let kg = self.geometrisch(normaalkrachten);
        let mut min_kg = self.kg_vrij(&kg);
        for waarde in min_kg.values.iter_mut() {
            *waarde = -*waarde;
        }
        let k_s = self.reduceer_matrix(&self.k_ff);
        let kg_s = self.reduceer_matrix(&min_kg);
        if k_s.n == 0 {
            return Ok((vec![], false));
        }
        let resultaat = lanczos_buckling_eigen_sparse(&k_s, &kg_s, modes)
            .ok_or("de eigenwaardesolver vond geen oplossing")?;
        // Zelfde selectie als de knikroute van de kern: positieve μ, λ = 1/μ,
        // oplopend, de gevraagde modes. Daarna vallen nulmodi weg: een λ van
        // orde 1e-14 is geen bruikbare knikfactor maar een beweging waar K
        // (vrijwel) geen stijfheid tegen heeft, zoals een raam met
        // scharnierende voeten dat buiten zijn vlak kan omvallen.
        let mut factoren: Vec<f64> = resultaat.values.iter()
            .filter(|mu| mu.is_finite() && **mu > 1e-12)
            .map(|mu| 1.0 / mu)
            .collect();
        factoren.sort_by(|a, b| a.total_cmp(b));
        factoren.truncate(modes);
        let nulmode = factoren.iter().any(|factor| *factor <= 1e-9);
        Ok((factoren.into_iter().filter(|factor| factor.is_finite() && *factor > 1e-9).collect(), nulmode))
    }

    /// Knikgegevens in het contract, uit de eerste-ordenormaalkrachten, en of
    /// de eigenwaardesolver een nulmode vond.
    fn knik_samenvatting(&self, normaalkrachten: &[f64], modes: usize) -> (BucklingSummary, bool) {
        if modes == 0 {
            return (BucklingSummary::NotApplicable { reason: "knikanalyse is uitgeschakeld".into() }, false);
        }
        if self.nf == 0 {
            return (BucklingSummary::NotApplicable { reason: "alle vrijheidsgraden zijn voorgeschreven".into() }, false);
        }
        if !normaalkrachten.iter().any(|n| *n < -1e-6) {
            return (BucklingSummary::NotApplicable { reason: "geen drukstaaf aanwezig".into() }, false);
        }
        let (factoren, nulmode) = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(||
            self.knikfactoren(normaalkrachten, modes)
        )) {
            Ok(Ok(uitkomst)) => uitkomst,
            Ok(Err(reden)) => return (BucklingSummary::Failed { reason: reden }, false),
            Err(paniek) => return (BucklingSummary::Failed {
                reason: format!("de knikanalyse brak af: {}", paniek_tekst(paniek)),
            }, false),
        };
        let Some(&lambda_cr) = factoren.first() else {
            return (BucklingSummary::Failed {
                reason: "geen positieve fysieke knikfactor gevonden (alleen numerieke nulmodi)".into(),
            }, nulmode);
        };
        let modes = factoren.iter().enumerate()
            .map(|(index, &load_factor)| BucklingModeSummary { mode: index + 1, load_factor })
            .collect();
        let members = self.staven.iter().zip(normaalkrachten)
            .filter(|(_, n)| **n < -1e-6)
            .map(|(staaf, &n)| {
                // Kniklengte uit N_cr = λ_cr·|N| = π²·E·I_min/L_cr², zoals de
                // adapter dat eerder ook deed.
                let critical_force = lambda_cr * n.abs();
                let radius_y = if staaf.area > 1e-20 { (staaf.iy / staaf.area).sqrt() } else { 0.0 };
                let radius_z = if staaf.area > 1e-20 { (staaf.iz / staaf.area).sqrt() } else { 0.0 };
                let k_effective = if critical_force > 1e-6 {
                    std::f64::consts::PI
                        * (staaf.e_kn_m2 * staaf.iy.min(staaf.iz) / critical_force).sqrt()
                        / staaf.lengte
                } else { 1.0 };
                let effective_length = k_effective * staaf.lengte;
                MemberBucklingData {
                    member_id: staaf.id,
                    axial_force_kn: n,
                    critical_force_kn: critical_force,
                    effective_length_factor: k_effective,
                    effective_length_m: effective_length,
                    length_m: staaf.lengte,
                    slenderness_y: if radius_y > 1e-12 { effective_length / radius_y } else { 0.0 },
                    slenderness_z: if radius_z > 1e-12 { effective_length / radius_z } else { 0.0 },
                }
            })
            .collect();
        (BucklingSummary::Available { modes, members }, nulmode)
    }
}

fn factoriseer(matrix: &CscMatrix) -> Result<Option<NumericCholesky>, String> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let symbolisch = Rc::new(symbolic_cholesky(matrix));
        numeric_cholesky(&symbolisch, matrix)
    }))
    .map_err(|paniek| format!("de sparse factorisatie brak af: {}", paniek_tekst(paniek)))
}

fn staven(input: &SolverInput3D, dof: &DofNumbering) -> Result<Vec<Staaf>, String> {
    let knopen: HashMap<_, _> = input.nodes.values().map(|node| (node.id, node)).collect();
    let materialen: HashMap<_, _> = input.materials.values().map(|m| (m.id, m)).collect();
    let doorsneden: HashMap<_, _> = input.sections.values().map(|s| (s.id, s)).collect();
    let mut temperatuur: HashMap<usize, f64> = HashMap::new();
    for load in &input.loads {
        if let SolverLoad3D::Thermal(thermal) = load {
            *temperatuur.entry(thermal.element_id).or_default() += thermal.dt_uniform;
        }
    }
    let mut elementen: Vec<_> = input.elements.values().collect();
    elementen.sort_by_key(|element| element.id);
    let links = input.left_hand.unwrap_or(false);
    elementen.into_iter().map(|element| {
        if element.elem_type != "frame" {
            return Err(format!("staaf {} is geen raamwerkstaaf", element.id));
        }
        let a = knopen[&element.node_i];
        let b = knopen[&element.node_j];
        let materiaal = materialen[&element.material_id];
        let doorsnede = doorsneden[&element.section_id];
        let lengte = ((b.x - a.x).powi(2) + (b.y - a.y).powi(2) + (b.z - a.z).powi(2)).sqrt();
        let e = materiaal.e * 1000.0;
        let g = e / (2.0 * (1.0 + materiaal.nu));
        let (ex, ey, ez) = compute_local_axes_3d(
            a.x, a.y, a.z, b.x, b.y, b.z,
            element.local_yx, element.local_yy, element.local_yz,
            element.roll_angle, links,
        );
        let mut dofs = [0usize; 12];
        for (plaats, knoop) in [element.node_i, element.node_j].into_iter().enumerate() {
            for lokaal in 0..6 {
                dofs[plaats * 6 + lokaal] = dof.global_dof(knoop, lokaal)
                    .ok_or_else(|| format!("knoop {knoop} van staaf {} heeft geen vrijheidsgraad {lokaal}", element.id))?;
            }
        }
        // Zelfde schuifparameters als de staaf van de kern: het x-y-vlak (Iz)
        // gebruikt phi_z, het x-z-vlak (Iy) phi_y.
        let l2 = lengte * lengte;
        let (phi_y, phi_z) = if doorsnede.as_y.is_some() || doorsnede.as_z.is_some() {
            (
                doorsnede.as_y.map(|ay| 12.0 * e * doorsnede.iy / (g * ay * l2)).unwrap_or(0.0),
                doorsnede.as_z.map(|az| 12.0 * e * doorsnede.iz / (g * az * l2)).unwrap_or(0.0),
            )
        } else {
            (0.0, 0.0)
        };
        Ok(Staaf {
            id: element.id,
            dofs,
            t: frame_transform_3d(&ex, &ey, &ez),
            lengte,
            ea_l: e * doorsnede.a / lengte,
            // De kern rekent temperatuur met α = 12e-6/K; de adapter heeft ΔT al
            // naar die basis geschaald.
            n_thermisch: e * doorsnede.a * 12e-6 * temperatuur.get(&element.id).copied().unwrap_or(0.0),
            vlak_xy: Vlak { begin_vrij: element.release_mz_start, eind_vrij: element.release_mz_end, phi: phi_z },
            vlak_xz: Vlak { begin_vrij: element.release_my_start, eind_vrij: element.release_my_end, phi: phi_y },
            e_kn_m2: e,
            area: doorsnede.a,
            iy: doorsnede.iy,
            iz: doorsnede.iz,
        })
    }).collect()
}

impl Staaf {
    /// Normaalkracht in kN, trek positief.
    fn normaalkracht(&self, u: &[f64]) -> f64 {
        let globaal: Vec<f64> = self.dofs.iter().map(|&d| u[d]).collect();
        let lokaal = transform_displacement(&globaal, &self.t, 12);
        self.ea_l * (lokaal[6] - lokaal[0]) - self.n_thermisch
    }

    /// Lokale K_G (12×12) bij normaalkracht `n` (trek positief).
    fn kg_lokaal(&self, n: f64) -> Vec<f64> {
        let mut k = vec![0.0; 144];
        // x-y-vlak: v op 1 en 7, θz op 5 en 11; teken +1 zoals in de kern.
        buigblok(&mut k, n, self.lengte, [1, 5, 7, 11], 1.0, self.vlak_xy);
        // x-z-vlak: w op 2 en 8, θy op 4 en 10; teken −1 (θy = −dw/dx).
        buigblok(&mut k, n, self.lengte, [2, 4, 8, 10], -1.0, self.vlak_xz);
        k
    }
}

/// Eén buigvlak van K_G. Zonder vrijgave is dit het 4×4-blok van de kern.
/// Bij een vrijgegeven einde volgt de einddraaiing van de staaf uit het
/// momentloze einde van de lineaire staaf (Timoshenko, zoals de kern), en
/// wordt K_G daarmee gecondenseerd: K_c = Qᵀ·B·Q. Bij twee vrije einden blijft
/// de koordestijfheid N/L over.
fn buigblok(k: &mut [f64], n: f64, l: f64, index: [usize; 4], s: f64, vlak: Vlak) {
    let mut blok = [[0.0f64; 4]; 4];
    if vlak.begin_vrij && vlak.eind_vrij {
        let koorde = n / l;
        blok[0][0] = koorde;
        blok[0][2] = -koorde;
        blok[2][0] = -koorde;
        blok[2][2] = koorde;
    } else {
        let c = n / (30.0 * l);
        let volledig = [
            [36.0, 3.0 * l * s, -36.0, 3.0 * l * s],
            [3.0 * l * s, 4.0 * l * l, -3.0 * l * s, -l * l],
            [-36.0, -3.0 * l * s, 36.0, -3.0 * l * s],
            [3.0 * l * s, -l * l, -3.0 * l * s, 4.0 * l * l],
        ];
        // Q beeldt (v1, θ1, v2, θ2) af op de toegelaten vorm van de staaf.
        let mut q = [[0.0f64; 4]; 4];
        for (i, rij) in q.iter_mut().enumerate() {
            rij[i] = 1.0;
        }
        // Momentloos einde van het lineaire blok: θ_vrij = a·(v1 − v2) + d·θ_ander,
        // met a = −s·6/(L(4+φ)) en d = −(2−φ)/(4+φ).
        let a = -s * 6.0 / (l * (4.0 + vlak.phi));
        let d = -(2.0 - vlak.phi) / (4.0 + vlak.phi);
        if vlak.begin_vrij {
            q[1] = [a, 0.0, -a, d];
        } else if vlak.eind_vrij {
            q[3] = [a, d, -a, 0.0];
        }
        for i in 0..4 {
            for j in 0..4 {
                let mut som = 0.0;
                for p in 0..4 {
                    for r in 0..4 {
                        som += q[p][i] * volledig[p][r] * q[r][j];
                    }
                }
                blok[i][j] = c * som;
            }
        }
    }
    for i in 0..4 {
        for j in 0..4 {
            k[index[i] * 12 + index[j]] += blok[i][j];
        }
    }
}

/// De kromme van één buigvlak van een element: [v''(0), v''(L), v'(0), v'(L)]
/// van de Hermite-kromme door (v1, v1', v2, v2'). `index` zijn de lokale
/// plaatsen van (v1, θ1, v2, θ2) en `s` het teken van θ = s·v' (+1 in het
/// x-y-vlak, −1 in het x-z-vlak). Bij een vrijgegeven einde is de einddraaiing
/// die van het momentloze einde (dezelfde betrekking als in `buigblok`); bij
/// twee vrije einden is de kromme de koorde.
fn vorm(lokaal: &[f64], index: [usize; 4], s: f64, vlak: Vlak, l: f64) -> [f64; 4] {
    let (v1, v2) = (lokaal[index[0]], lokaal[index[2]]);
    let (mut t1, mut t2) = (lokaal[index[1]], lokaal[index[3]]);
    if vlak.begin_vrij && vlak.eind_vrij {
        let koorde = s * (v2 - v1) / l;
        t1 = koorde;
        t2 = koorde;
    } else if vlak.begin_vrij || vlak.eind_vrij {
        let a = -s * 6.0 / (l * (4.0 + vlak.phi));
        let d = -(2.0 - vlak.phi) / (4.0 + vlak.phi);
        if vlak.begin_vrij {
            t1 = a * (v1 - v2) + d * t2;
        } else {
            t2 = a * (v1 - v2) + d * t1;
        }
    }
    let (p1, p2) = (s * t1, s * t2);
    let dv = v2 - v1;
    [
        6.0 * dv / (l * l) - (4.0 * p1 + 2.0 * p2) / l,
        -6.0 * dv / (l * l) + (2.0 * p1 + 4.0 * p2) / l,
        p1,
        p2,
    ]
}

/// Grootste versterking van een vrije translatie ten opzichte van de eerste
/// orde. Alleen translaties die minstens 1/1000 van de grootste eerste-orde-
/// translatie zijn tellen mee: een vrijheidsgraad die lineair vrijwel stil
/// staat, geeft anders een betekenisloze verhouding.
fn versterking(stelsel: &Stelsel, u_lineair: &[f64], u: &[f64]) -> f64 {
    let vrije_translaties: Vec<usize> = stelsel.dof.map.iter()
        .filter(|((_, lokaal), &index)| *lokaal < 3 && index < stelsel.nf)
        .map(|(_, &index)| index)
        .collect();
    let grootste = vrije_translaties.iter().map(|&i| u_lineair[i].abs()).fold(0.0, f64::max);
    if !(grootste > 1e-15) {
        return 1.0;
    }
    vrije_translaties.iter()
        .filter(|&&i| u_lineair[i].abs() >= 1e-3 * grootste)
        .map(|&i| (u[i] / u_lineair[i]).abs())
        .fold(0.0, f64::max)
}

/// Het residu van een berekening met koppelingen (schijven), gereduceerd.
///
/// De kern meet bij koppelingen ‖K_ff·u_f − f_f‖/‖f_f‖ over alle vrije
/// vrijheidsgraden. Op een slaafvrijheidsgraad is dat verschil de
/// koppelkracht zelf, dus zodra een schijf kracht overdraagt, keurt dat getal
/// een juiste oplossing af. Het gereduceerde residu ‖Cᵀ(K·u − f)‖/‖Cᵀ·f‖ meet
/// wat het opgeloste stelsel werkelijk moet halen.
pub(crate) fn herstel_residu(input: &SolverInput3D, results: &mut AnalysisResults3D) -> Result<(), String> {
    if input.constraints.is_empty() || results.equilibrium.is_none() { return Ok(()); }
    let stelsel = Stelsel::bouw(input)?;
    let u = stelsel.vector_uit(results);
    let ku = stelsel.k_ff.sym_mat_vec(&u[..stelsel.nf]);
    let rechts: Vec<f64> = (0..stelsel.nf).map(|i| stelsel.f_f[i] - stelsel.k_fr_ur[i]).collect();
    let verschil: Vec<f64> = (0..stelsel.nf).map(|i| ku[i] - rechts[i]).collect();
    let norm = |v: Vec<f64>| v.iter().map(|x| x * x).sum::<f64>().sqrt();
    let residu = norm(stelsel.reduceer_vector(&verschil)) / norm(stelsel.reduceer_vector(&rechts)).max(1e-30);
    if let Some(evenwicht) = results.equilibrium.as_mut() {
        evenwicht.relative_residual = residu;
        evenwicht.residual_ok = residu < 1e-6;
    }
    Ok(())
}

/// Aantal proefbelastingen in `singulier`.
const PROEVEN: u64 = 2;
/// Stappen iteratieve verfijning per proefbelasting.
const VERFIJNINGEN: usize = 3;
/// Een proefbelasting met een groter relatief residu wijst op een singuliere
/// stijfheidsmatrix; dezelfde grens als `residual_ok` van de kern.
const PROEFGRENS: f64 = 1e-6;

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

/// Is de stijfheidsmatrix van `input` (met de koppelingen) numeriek singulier?
/// Dan volgt een toelichting voor de foutmelding (#96).
///
/// Een mechanisme dat de belasting niet aanstoot, laat de kern soms door: de
/// spil langs het mechanisme is afrondingsruis en niet precies nul, en zonder
/// een lastcomponent langs het mechanisme blijft het residu klein. Daarom twee
/// proefbelastingen op alle vrije vrijheidsgraden (krachten van grootte tot
/// 1 kN, momenten tot 1 kN maal de modelafmeting, met een vast pseudo-
/// willekeurig patroon), opgelost met een verse sparse Cholesky-factorisatie
/// zonder verschuiving en drie stappen iteratieve verfijning. Is de matrix
/// regulier, dan komt het relatieve residu op afrondingsniveau. Is zij
/// singulier, dan blijft de component van de proefbelasting langs het
/// mechanisme als residu staan, ongeacht de verfijning (K·m ≈ 0), of faalt de
/// factorisatie al. Een model van raamwerkstaven, veren en platen (met hun
/// draaiveer) heeft een positief definiete stijfheidsmatrix zodra er geen
/// mechanisme is; de factorisatie zonder verschuiving hoort dan te slagen.
pub(crate) fn singulier(input: &SolverInput3D) -> Result<Option<String>, String> {
    let stelsel = Stelsel::bouw(input)?;
    let k_s = stelsel.reduceer_matrix(&stelsel.k_ff);
    if stelsel.nf == 0 || k_s.n == 0 { return Ok(None); }
    let Some(factor) = factoriseer(&k_s)? else {
        return Ok(Some(
            "Controle van de adapter: de stijfheidsmatrix is niet positief definiet (de Cholesky-factorisatie zonder verschuiving faalt)."
                .into(),
        ));
    };
    let mut laag = [f64::INFINITY; 3];
    let mut hoog = [f64::NEG_INFINITY; 3];
    for knoop in input.nodes.values() {
        for (as_, waarde) in [knoop.x, knoop.y, knoop.z].into_iter().enumerate() {
            laag[as_] = laag[as_].min(waarde);
            hoog[as_] = hoog[as_].max(waarde);
        }
    }
    let lengte = (0..3).map(|as_| (hoog[as_] - laag[as_]).powi(2)).sum::<f64>().sqrt().max(1.0);
    let norm = |v: &[f64]| v.iter().map(|x| x * x).sum::<f64>().sqrt();
    for proef in 0..PROEVEN {
        let mut f = vec![0.0; stelsel.nf];
        for (&(knoop, lokaal), &index) in &stelsel.dof.map {
            if index >= stelsel.nf { continue; }
            let schaal = if lokaal < 3 { 1.0 } else { lengte };
            f[index] = (2.0 * ruis(knoop, lokaal, proef) - 1.0) * schaal;
        }
        let f_s = stelsel.reduceer_vector(&f);
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
            return Ok(Some(format!(
                "Controle van de adapter: een proefbelasting op alle vrije vrijheidsgraden houdt een relatief residu van {residu:.1e} over (grens {PROEFGRENS:.0e}), dus de stijfheidsmatrix is singulier. De belasting van dit model zet geen kracht langs die beweging, maar elke belasting die dat wel doet, maakt het model onoplosbaar.",
            )));
        }
    }
    Ok(None)
}

/// Knikanalyse bij een lineaire berekening: de eerste-ordetoestand komt uit
/// de reeds berekende uitkomst van de kern.
pub(crate) fn knik_bij_eerste_orde(
    input: &SolverInput3D,
    lineair: &AnalysisResults3D,
    modes: usize,
) -> BucklingSummary {
    if modes == 0 {
        return BucklingSummary::NotApplicable { reason: "knikanalyse is uitgeschakeld".into() };
    }
    if let Err(reden) = alleen_staven(input) {
        return BucklingSummary::NotApplicable { reason: reden };
    }
    let stelsel = match Stelsel::bouw(input) {
        Ok(stelsel) => stelsel,
        Err(reden) => return BucklingSummary::Failed { reason: reden },
    };
    let u = stelsel.vector_uit(lineair);
    stelsel.knik_samenvatting(&stelsel.normaalkrachten(&u), modes).0
}

fn is_nul(results: &AnalysisResults3D) -> bool {
    results.displacements.iter()
        .flat_map(|d| [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz])
        .all(|waarde| waarde.abs() <= 1e-20)
}

/// Directe tweede orde met een verse factorisatie per iteratie.
///
/// `lineair` is de eerste-ordeoplossing van de kern voor dezelfde invoer.
pub(crate) fn los_op(
    input: &SolverInput3D,
    lineair: AnalysisResults3D,
    max_iterations: usize,
    tolerance: f64,
    buckling_modes: usize,
) -> Result<Tweedeorde, String> {
    alleen_staven(input)?;
    let stelsel = Stelsel::bouw(input)?;
    let u_lineair = stelsel.vector_uit(&lineair);
    let n_lineair = stelsel.normaalkrachten(&u_lineair);

    // Stabiliteitspoort: een P-Δ-iteratie kan wiskundig convergeren nadat het
    // evenwichtspad het eerste bifurcatiepunt al voorbij is. Bereken daarom
    // altijd minstens één fysieke knikfactor, ook als de aanroeper de
    // knikuitvoer heeft uitgezet.
    let (poort, nulmode) = stelsel.knik_samenvatting(&n_lineair, buckling_modes.max(1));
    let buckling = if buckling_modes == 0 {
        BucklingSummary::NotApplicable { reason: "knikanalyse is uitgeschakeld".into() }
    } else {
        poort.clone()
    };
    if let BucklingSummary::Failed { reason } = &poort {
        return Err(format!(
            "tweede-orde 3D-berekening is geblokkeerd omdat de stabiliteitscontrole faalde: {reason}"
        ));
    }
    if let BucklingSummary::Available { modes, .. } = &poort {
        if let Some(mode) = modes.first() {
            if mode.load_factor <= 1.0 + 1e-6 {
                return Err(format!(
                    "tweede-orde 3D-berekening wijst op instabiliteit: de eerste lineaire knikfactor alpha_cr={:.6} is kleiner dan of gelijk aan 1,0. De belasting bereikt of overschrijdt daarmee de kritieke last. Verlaag de belasting of voeg stabiliserende schoren, opleggingen of staafstijfheid toe.",
                    mode.load_factor,
                ));
            }
        }
    }

    // Zonder iteratie rekent geen K_G mee: de delen dragen dan N = 0, zodat
    // Σ N·(e_x × Δu) nul is, zoals bij de lineaire reacties hoort.
    let zonder_kg = || stelsel.delen(&vec![0.0; stelsel.staven.len()], &u_lineair);
    if stelsel.nf == 0 {
        // Een volledig voorgeschreven model heeft wel geldige verplaatsingen,
        // staafkrachten en reacties, maar geen onbekende om op te itereren.
        return Ok(Tweedeorde {
            delen: zonder_kg(),
            results: lineair,
            summary: SecondOrderSummary { iterations: 1, converged: true, stable: true, max_amplification: 1.0 },
            buckling,
            diagnostics: vec![
                "P-Delta-nultoestand: alle vrijheidsgraden zijn voorgeschreven; lineaire reacties zijn geldig en de tweede-orde-amplificatie is 1,0."
                    .into(),
            ],
        });
    }
    if is_nul(&lineair) {
        // Elke last staat op een geblokkeerde vrijheidsgraad: er is geen
        // vervormde stand waaruit een geometrische stijfheid kan ontstaan.
        return Ok(Tweedeorde {
            delen: zonder_kg(),
            results: lineair,
            summary: SecondOrderSummary { iterations: 1, converged: true, stable: true, max_amplification: 1.0 },
            buckling,
            diagnostics: vec![
                "P-Delta-nultoestand: geen vrije verplaatsing; lineaire reacties zijn geldig en de tweede-orde-amplificatie is 1,0."
                    .into(),
            ],
        });
    }

    let mut u = u_lineair.clone();
    let mut kg_laatst = Vec::new();
    let mut n_laatst = Vec::new();
    let mut converged = false;
    let mut iterations = 0;
    for iteratie in 1..=max_iterations {
        iterations = iteratie;
        let normaalkrachten = stelsel.normaalkrachten(&u);
        let kg = stelsel.geometrisch(&normaalkrachten);
        let Some(u_f) = stelsel.los_tangent(&kg)? else {
            if nulmode {
                return Err(format!(
                    "tweede-orde 3D-berekening wijst op instabiliteit: de tangentiële stijfheid K + K_G is in iteratie {iteratie} niet positief definiet. Het model heeft een beweging zonder stijfheid (knikfactor vrijwel 0) die onder elke drukkracht instabiel is, bijvoorbeeld een raam met scharnierende voeten dat buiten zijn vlak kan omvallen. De eerste orde laat die beweging ongemoeid omdat de belasting er loodrecht op staat. Voeg opleggingen, verbanden of rotatieblokkeringen toe die deze beweging tegenhouden.",
                ));
            }
            return Err(format!(
                "tweede-orde 3D-berekening wijst op instabiliteit: de tangentiële stijfheid K + K_G is in iteratie {iteratie} niet positief definiet. Verlaag de belasting of voeg stabiliserende schoren, opleggingen of rotatieblokkeringen toe.",
            ));
        };
        let mut verschil = 0.0;
        let mut norm = 0.0;
        for i in 0..stelsel.nf {
            verschil += (u_f[i] - u[i]).powi(2);
            norm += u_f[i].powi(2);
        }
        u[..stelsel.nf].copy_from_slice(&u_f);
        kg_laatst = kg;
        n_laatst = normaalkrachten;
        if norm.sqrt() > 1e-300 && verschil.sqrt() / norm.sqrt() < tolerance {
            converged = true;
            break;
        }
    }
    if !converged {
        return Err(format!("tweede-orde 3D-berekening convergeerde niet binnen {iterations} iteraties"));
    }

    // Eindtoestand via het lineaire pad van de kern: K·u = F − K_G·u.
    let fictief = stelsel.kg_maal(&kg_laatst, &u);
    let mut eind = input.clone();
    let mut knoopnummers: Vec<usize> = stelsel.dof.node_order.clone();
    knoopnummers.sort_unstable();
    for knoop in knoopnummers {
        let krachten: Vec<f64> = (0..6)
            .map(|lokaal| stelsel.dof.global_dof(knoop, lokaal).map(|d| -fictief[d]).unwrap_or(0.0))
            .collect();
        if krachten.iter().all(|waarde| *waarde == 0.0) { continue; }
        eind.loads.push(SolverLoad3D::Nodal(SolverNodalLoad3D {
            node_id: knoop,
            fx: krachten[0], fy: krachten[1], fz: krachten[2],
            mx: krachten[3], my: krachten[4], mz: krachten[5],
            bw: None,
        }));
    }
    let mut results = solve_3d(&eind).map_err(|error| crate::solver_error("tweede-orde 3D-berekening (eindtoestand)", error))?;
    herstel_residu(&eind, &mut results)?;
    crate::require_usable_solution("tweede-orde 3D-berekening", &results)?;
    // Alleen de meldingen over het model zelf; het rekenpad van de eindstap is
    // een hulpmiddel en geen eigenschap van de tweede-ordeoplossing.
    results.structured_diagnostics.retain(|melding|
        matches!(melding.phase.as_deref(), Some("pre_solve" | "constraints" | "conditioning")));
    results.solver_diagnostics.retain(|melding| melding.category == "conditioning");
    results.solver_run_meta = None;
    let u_eind = stelsel.vector_uit(&results);
    let schaal = u.iter().map(|waarde| waarde.abs()).fold(0.0, f64::max);
    let afwijking = u.iter().zip(&u_eind).map(|(a, b)| (a - b).abs()).fold(0.0, f64::max);
    if afwijking > 1e-6 * schaal.max(1e-12) {
        return Err(format!(
            "tweede-orde 3D-berekening: de eindcontrole K·u = F − K_G·u reproduceert de iteratie niet (afwijking {afwijking:.3e} bij {schaal:.3e})"
        ));
    }
    // De staafkrachten van de kern zijn k_e·u: de fictieve knooplasten −K_G·u
    // komen daarin als eindkracht en eindmoment terug, ook als moment bij een
    // scharnierende oplegging. Tel K_G·u per staaf erbij op.
    stelsel.tweede_orde_staafkrachten(&n_laatst, &u, &mut results);
    let max_amplification = versterking(&stelsel, &u_lineair, &u);
    Ok(Tweedeorde {
        delen: stelsel.delen(&n_laatst, &u),
        results,
        summary: SecondOrderSummary { iterations, converged, stable: true, max_amplification },
        buckling,
        diagnostics: vec![format!(
            "Tweede orde: {iterations} iteraties met een verse factorisatie per iteratie; relatieve verplaatsingswijziging onder {tolerance:.0e}.",
        )],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn staaf_met(vlak: Vlak) -> Staaf {
        Staaf {
            id: 1, dofs: [0; 12], t: vec![0.0; 144], lengte: 2.0, ea_l: 1.0, n_thermisch: 0.0,
            vlak_xy: vlak, vlak_xz: vlak, e_kn_m2: 1.0, area: 1.0, iy: 1.0, iz: 1.0,
        }
    }

    /// Zonder vrijgave is K_G exact de matrix van de kern: N/(30L)·[36, 3L, 4L², −L²].
    #[test]
    fn kg_zonder_vrijgave_is_het_blok_van_de_kern() {
        let staaf = staaf_met(Vlak { begin_vrij: false, eind_vrij: false, phi: 0.0 });
        let k = staaf.kg_lokaal(-30.0);
        let c = -30.0 / (30.0 * 2.0);
        assert!((k[12 + 1] - 36.0 * c).abs() < 1e-12);
        assert!((k[12 + 5] - 6.0 * c).abs() < 1e-12);
        assert!((k[5 * 12 + 5] - 16.0 * c).abs() < 1e-12);
        assert!((k[5 * 12 + 11] + 4.0 * c).abs() < 1e-12);
        assert!((k[2 * 12 + 4] + 6.0 * c).abs() < 1e-12, "x-z-vlak draait het teken van de θy-koppeling om");
    }

    /// Twee scharnieren: alleen de koordestijfheid N/L op de dwarsverplaatsing.
    #[test]
    fn kg_met_twee_scharnieren_is_de_koordestijfheid() {
        let staaf = staaf_met(Vlak { begin_vrij: true, eind_vrij: true, phi: 0.0 });
        let k = staaf.kg_lokaal(10.0);
        assert!((k[12 + 1] - 5.0).abs() < 1e-12);
        assert!((k[12 + 7] + 5.0).abs() < 1e-12);
        for rotatie in [4, 5, 10, 11] {
            assert!((0..12).all(|j| k[rotatie * 12 + j] == 0.0), "geen rotatieterm op {rotatie}");
        }
    }

    /// Eén scharnier: de bekende gecondenseerde matrix N/L·[6/5, −6/5, L/5; …; L²/5].
    #[test]
    fn kg_met_een_scharnier_volgt_de_gecondenseerde_vorm() {
        let staaf = staaf_met(Vlak { begin_vrij: true, eind_vrij: false, phi: 0.0 });
        let l = 2.0;
        let n = 7.0;
        let k = staaf.kg_lokaal(n);
        let verwacht = |waarde: f64| n / l * waarde;
        assert!((k[12 + 1] - verwacht(1.2)).abs() < 1e-12);
        assert!((k[12 + 7] - verwacht(-1.2)).abs() < 1e-12);
        assert!((k[12 + 11] - verwacht(l / 5.0)).abs() < 1e-12);
        assert!((k[11 * 12 + 11] - verwacht(l * l / 5.0)).abs() < 1e-12);
        assert!((0..12).all(|j| k[5 * 12 + j] == 0.0), "het vrije einde draagt niets over");
    }
}
