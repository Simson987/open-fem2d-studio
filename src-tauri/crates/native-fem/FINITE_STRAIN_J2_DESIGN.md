# Finite-strain J2 volume law: next implementation gate

## Current implementation status

`solid_finite_j2.rs` now contains a separate experimental material-point
implementation of quadratic Hencky elasticity and multiplicative J2 return.
It accepts a total deformation gradient and an immutable committed plastic
state, and returns a trial state, first Piola stress, elastic energy and an
optional consistent tangent. Ten module tests and ten independent
material-point reference tests cover
diagonal and shear loading, hydrostatic response, superposed rotation,
unloading/reversal, isochoric plastic flow, elastic energy differentiation
and the small-strain limit. A separate prepared Tet4 element action assembles
the force and tangent and passes two reference tests. `volume3d_finite_j2.rs`
now solves bounded global Tet4 load paths with transactional plastic history.
Its typed app route has been exercised through the toetsbrug and live
development app. The dense route supports at most 120 DOF and 200 Tet4.
An opt-in CSR-GMRES route is bounded at 2,400 DOF and 3,600 Tet4;
independent tests check dense parity through plastic unloading and equilibrium
of a 192-DOF model above the dense limit. Reference-volume body forces and
reference-face dead tractions are supported. A release test with 3,072 plastic
Tet4 and 2,187 DOF checks the affine Hencky solution with 1,029 free components.
An opt-in symmetric-positive frontal wavefront path has the same model cap and
at most 1,024 simultaneous front DOFs. It explicitly checks element symmetry
against a 1e-13 whole-element norm before removing roundoff-level skew; larger
skew, non-positive pivots and excessive front width are errors. An independent
48-Tet4 plastic load/reversal test matches closed Hencky/J2 stress and reaction
formulas.
An opt-in matrix-free GMRES backend caches local Tet4/truss/membrane tangents
and parallelizes element products over 1–16 workers. Hex8 instead keeps a
compact snapshot of the committed Gauss histories and current displacement;
it shares prepared reference geometry and recomputes each directional tangent
product without retaining a 24×24 matrix. This reduces the per-Hex8 product
cache from 576 doubles to less than one third of that size, at the cost of
material-point work on every Krylov product. The default route remains capped
at 24,000 DOF, 36,000 elements and 5,184,000 cache scalar equivalents. An independent
162-Tet4 plastic reversal verifies sparse parity and closed Hencky stress for
one and four threads. An explicit 34,992-Tet4 release test with 14,739 free
DOF closes on the affine plastic Hencky solution and `6.953e-9 kN` true free
residual in 10.02 s on four threads. A separate opt-in
`matrixFreeGmresLarge` backend has an explicit ceiling of 850,000 DOF,
300,000 solids, 43,200,000 cache scalar equivalents and an estimated 4 GiB
working set. The estimate includes two concurrent element snapshots, shared
Hex8 geometry, material histories/results, input cells/targets, worker vectors
and the selected Krylov basis. A 63³ Hex8 grid with 64³ nodes passes this
*capacity estimate* only with a reduced GMRES restart of 8; it has not been
solved or validated at that size. A separate release check solves a regular
32³ grid with 32,768 plastic Hex8, 107,811 total DOF and 24 free DOF. It
matches the independent affine Hencky/J2 displacement, plastic strain, first
Piola stress and face reaction references with a `6.330e-13 kN` free residual;
on four workers it accepted one step without cutbacks in 5.43 s and reached
321,544 KiB peak RSS. This heavily prescribed affine patch is an intermediate
scale check, not evidence for a general 250k-Hex8 model. The backend's
explicit release test solves
257,250 plastic Tet4 with
139,968 DOF (117,912 free) on four threads against the closed isochoric
Hencky/J2 solution. It accepts one step with no cutbacks, a true free residual
of `5.089e-9 kN`, and takes 131.76 s on this machine. This regular affine
patch does not establish convergence or memory behavior for arbitrary meshes
and load paths.
An opt-in `automatic` choice starts with CSR-GMRES within the 2,400-DOF /
3,600-Tet4 bound. It switches permanently to a bounded frontal solve only
after a diagnosed Krylov iteration exhaustion/stagnation or CSR storage cap,
and reports the actual `linearBackendUsed` and `frontalFallbacks`. It does
not recover geometry, constitutive, mechanism, Arnoldi breakdown or Newton
failures. The frontal path still requires a sufficiently narrow, positive
tangent wavefront.

The current `volume3dGnl` route uses a St Venant–Kirchhoff hyperelastic law,
optionally with a reversible `elementEnergyBeta` energy term. The current
`volume3dJ2` route is small-strain plasticity. Combining their labels or
stresses would not produce a finite-strain plasticity law. A separate
constitutive update and its consistent global linearization are required.

## Reference and selected formulation

- Simo's [continuum formulation, Part I](https://doi.org/10.1016/0045-7825(88)90076-X)
  derives finite-strain elastoplasticity from multiplicative decomposition and
  maximum plastic dissipation.
- Simo's [computational formulation, Part II](https://doi.org/10.1016/0045-7825(88)90104-1)
  develops the return algorithm and its consistent tangent. The implementation
  must follow one fully specified specialization of this formulation; the
  small-strain radial return alone is insufficient.
- Sandia's [FeFp material description](https://www.sandia.gov/files/sierra/SM_LAME_5_24/main/models/phase_field_fefp.html)
  gives an independent implementation-oriented description of the
  multiplicative `F = Fe Fp` kinematics. Sandia's ordinary J2 LAMÉ material
  uses a *hypoelastic rate formulation* and must not be treated as a source for
  a multiplicative hyperelastic return map.

Use a deformation gradient `F` with positive determinant. Store the plastic
deformation gradient `Fp` and accumulated equivalent plastic strain at each
material point. Compute the elastic part from `Fe = F Fp⁻¹` and a specified
isotropic hyperelastic energy, then apply the selected yield and hardening law
in the stress measure belonging to that energy. For the reference-volume
Tet4 equilibrium equation, return the first Piola stress `P` and its
derivative with respect to `F`; `P` must transform correctly under a rigid
rotation. Plastic flow should be isochoric for the selected J2 law. No trial
`Fp` or hardening state may be committed during a failed Newton iteration or
rejected load step.

## Verification gates for broader app use

1. Material point: rigid rotation leaves elastic energy and equivalent
   plastic strain unchanged and rotates the spatial stress; `det(Fp)` remains
   one within numerical tolerance.
2. Small-strain limit: uniaxial, pure shear, hydrostatic, load reversal and
   unloading approach the existing `solid_j2` results with the same hardening
   convention. The hydrostatic path stays elastic for J2.
3. Tangent: compare every component of the returned `dP/dF` to independently
   perturbed updates about elastic, plastic, rotated and unloaded states,
   always holding the committed history fixed.
4. Global Tet4: reconstruct `P Grad(N)` forces, reactions and external work
   independently on affine and nonaffine multi-element meshes. Check true
   free residual after each accepted step and commit/rollback after cutbacks.
5. Scalability: compare dense, sparse and frontal/iterative backends on the
   same model. Record element count, DOFs, wall time, peak memory, residual,
   plastic-state distribution and failure mode at each declared limit.

Until these gates pass, the application must continue to identify StVK-beta
as a reversible research material and small-strain J2 as a separate route.

## Material-point implementation and tangent (experimental)

`src/solid_finite_j2.rs` implements a **separate, opt-in material point**, using
the quadratic Hencky specialization in [Ren, Rabczuk and Zhuang (2023),
Eqs. 42–56 and 62–63](https://arxiv.org/pdf/2302.13783). It takes an immutable
committed symmetric-positive, isochoric `Fp` and accumulated equivalent plastic
strain `alpha`; it returns a trial `Fp` in the same plastic-rotation gauge.
Its yield stress is `sigma_y + H alpha`, with `H` defined exactly as in the
existing small-strain `solid_j2` law. The caller must commit the returned state
only after accepting the global step.

The material point now also returns a branch-consistent `9×9` nominal tangent
through `update_with_tangent`. With the committed plastic metric fixed, let
`be = F Cp^-1 F^T`, `e = (log be)/2`, `s = 2 mu dev(e)`,
`q = sqrt(3/2)||s||`, and `Y = sigma_y + H alpha_n`. The elastic branch uses
`tau = kappa tr(e) I + s`; the plastic branch uses
`tau = kappa tr(e) I + r s`, where
`r = (H + 3 mu Y/q)/(3 mu + H)`. For each `dF`, compute
`dbe = dF Cp^-1 F^T + F Cp^-1 dF^T`, then `de = L_log(be)[dbe]/2`
using the spectral Fréchet derivative with its repeated-eigenvalue limit.
Differentiate `r` on the plastic branch and finish with
`dP = d(tau) F^-T − P dF^T F^-T`. The classical tangent is undefined exactly
at yield; `update_with_tangent` rejects a small neighborhood of that switching
surface. The global Newton iteration explicitly selects the one-sided branch
used by the stress update through `update_with_one_sided_tangent`.

Validation: 10 module tests and 10 independent material-point integration
tests pass. The independent test checks all 81 tangent entries with central
differences for virgin elastic, virgin plastic, rotated plastic history, and
unloaded rotated history. The largest absolute discrepancy in those checks was
`6.9e-4 MPa`; nominal major symmetry and elastic `P = dW/dF` are also checked.
The tensor is assembled into a prepared Tet4 element by
`src/solid_finite_j2_tet.rs`. Its two independent reference tests check an
affine hydrostatic patch and all 144 entries of the element force derivative.
The global Newton route has focused module tests, six global reference, two
distributed-load and one frontal independent reference tests. Additional
independent tests exercise matrix-free plastic reversal, backend parity and
the explicit 257,250-Tet4 release scale acceptance.
Those include an affine plastic load/reversal with closed stress and reaction
formulas, a nonaffine plastic nodal-load force balance, dense/GMRES parity
through unloading, independent forces and reactions on 162 Tet4 above the dense
limit, explicit GMRES exhaustion and a failed second-target path. The checked-in
six-Tet4 coupon passes the typed dispatcher and live app in dense mode.
The CSR-GMRES route is opt-in and bounded at 2,400 DOF/3,600 Tet4 with further
storage limits. Matrix-free GMRES extends the experimental ceiling to 24,000
DOF/36,000 Tet4 with a local tangent cache and deterministic parallel element
products. The explicit large variant has a 300,000-Tet4 cap and passed the
257,250-element affine plastic release test described above. Follower loads,
arbitrary-topology large models and the design gates above remain open; the
app labels this as an experimental analysis mode.
