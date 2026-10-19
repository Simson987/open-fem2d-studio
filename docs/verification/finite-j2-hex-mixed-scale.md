# Finite-J2 Hex8 mixed-model scale checks

The acceptance test is [`volume_finite_j2_hex_mixed_scale.rs`](../../src-tauri/crates/native-fem/tests/volume_finite_j2_hex_mixed_scale.rs). It uses a regular Hex8 cube plus one Tet4, one truss and one Tri3 membrane sharing a central node. One x displacement is free; all other displacements follow a prescribed affine stretch. A closed-form load balances the Tet4, truss and membrane at that node, while surrounding Hex8 forces cancel. The test checks the affine displacement, Hex8 plastic stress and all eight histories per cell, Tet4 and membrane stress, truss force, boundary reaction and global equilibrium.

| Run | Elements and DOFs | Backend | Measured result on this host |
| --- | --- | --- | --- |
| Regular debug test | 1,000 Hex8 + 1 Tet4 + 1 truss + 1 Tri3; 3,993 DOFs, 1 free | `MatrixFreeGmresLarge`, 4 threads | Passed, 1 accepted step, 0 cutbacks, residual 5.980e-8 kN, 12.15 s test time. |
| Ignored release test | 4,096 Hex8 + 1 Tet4 + 1 truss + 1 Tri3; 14,739 DOFs, 1 free | `MatrixFreeGmresLarge`, 4 threads | Passed, 1 accepted step, 0 cutbacks, residual 1.106e-8 kN. Direct test process: 1.05 s wall, 57,964 KB peak RSS. |

Commands:

```sh
cd src-tauri
cargo test -p openaec-native-fem --test volume_finite_j2_hex_mixed_scale
cargo test --release -p openaec-native-fem --test volume_finite_j2_hex_mixed_scale -- --ignored --nocapture
```

The 4,096-cell result validates this affine mixed-element case and its output histories. With only one free DOF it does not measure large Krylov solves or nonaffine plastic redistribution. The earlier 180,000-DOF and cached-tangent limits no longer describe the streamed Hex8 implementation; the separate 250,047-Hex8 result appears below.

## Nonaffine Hex8 plasticity with free interior DOFs

[`volume_finite_j2_hex_nonaffine_scale.rs`](../../src-tauri/crates/native-fem/tests/volume_finite_j2_hex_nonaffine_scale.rs) complements the affine check above. A unit cube is clamped on x=0, carries a consistent, uniform dead traction of [3, 0, -0.5] MPa on x=1 and a distinct +30 kN force at its upper outer corner. The other five faces are free. Material parameters are E=1,000 MPa, ν=0.3, initial yield=2 MPa and isotropic hardening=100 MPa. The load makes the displacement field nonaffine and yields part of the mesh while retaining elastic Gauss points. There are no Tet4, truss or membrane elements in this particular check.

The test reconstructs every nodal internal force independently: it forms the eight-point Hex8 reference shape-function gradients, integrates the returned first-Piola tensors over each cell, and compares free-DOF equilibrium and each support reaction to the reported solution. It also checks total force and deformed-configuration moment balance, and internal versus external virtual work at the converged displacement. The 4³ case compares assembled sparse GMRES with four-thread matrix-free GMRES at every displacement component.

| Run | Elements and DOFs | Backend | Measured result on this host |
| --- | --- | --- | --- |
| Regular release test | 64 Hex8; 375 total, 300 free DOFs | `SparseGmres` | Passed; 497 plastic and 15 elastic Gauss points; max independently reconstructed nodal force error 1.548e-9 kN, true residual 2.998e-9 kN, 200.8 ms solve. |
| Same case | 64 Hex8; 375 total, 300 free DOFs | `MatrixFreeGmresLarge`, 4 threads | Passed; max nodal force error 1.539e-9 kN, true residual 2.980e-9 kN, 2.54 s solve. Displacements agree with sparse GMRES within 2e-7 m. |
| Explicit ignored release test | 512 Hex8; 2,187 total, 1,944 free DOFs | `MatrixFreeGmresLarge`, 4 threads | Passed; 3,880 plastic and 216 elastic Gauss points; max nodal force error 9.258e-11 kN, true residual 1.890e-10 kN, 64.89 s solve. |

```sh
cd src-tauri
cargo test --release -p openaec-native-fem --test volume_finite_j2_hex_nonaffine_scale -- --nocapture
cargo test --release -p openaec-native-fem --test volume_finite_j2_hex_nonaffine_scale -- --ignored --nocapture
```

These are force-controlled monotonic tests, not mesh convergence, cyclic path, fracture localization or general large-model acceptance. The 8³ run uses one backend only.

## Streamed 250,047-Hex8 finite-J2 acceptance

[`volume_finite_j2_hex_streamed_250k.rs`](../../src-tauri/crates/native-fem/tests/volume_finite_j2_hex_streamed_250k.rs) is an explicit ignored release test. A regular 63³ unit cube has 250,047 Hex8 cells, 262,144 nodes and 786,432 displacement DOFs. Eight central nodes leave 24 DOFs free; other displacements impose a 0.005 affine x stretch. The material has E=1,000 MPa, ν=0.3, yield stress=1 MPa and isotropic hardening=100 MPa. The test uses `MatrixFreeGmresLarge`, four configured workers and GMRES restart 8. It independently computes the Hencky/J2 radial-return plastic strain and the full first-Piola stress tensor, checks every node and all eight Gauss points in every cell, checks each x-face reaction against the closed stress times area, and checks the true free residual.

| Run | Result on this host |
| --- | --- |
| Baseline 32³ streamed Hex8 | 32,768 cells, 107,811 DOFs, 24 free; passed; 3.45 s wall, 320,784 KB peak RSS. |
| Explicit 63³ streamed Hex8 | 250,047 cells, 786,432 DOFs, 24 free; passed; 1 accepted step, 0 cutbacks; true free residual 7.606e-14 kN; maximum displacement error 8.674e-19 m, plastic strain error 2.520e-16, full first-Piola tensor error 3.553e-13 MPa; x-face reactions −4,949.025824 and +4,949.025824 kN; 31.54 s wall, 2,417,112 KB peak RSS, no swaps. |

```sh
cd src-tauri
cargo test --release -p openaec-native-fem --test volume_finite_j2_hex_streamed_250k -- --ignored --nocapture --test-threads=1
```

The four-worker setting exercises the streamed matrix-free route, but this affine case has only 24 free DOFs. Its measured CPU utilization was 97%, so this run does not establish four-core speedup or convergence for a large free-DOF, nonaffine problem. It establishes the 250,047-cell execution, bounded resident memory, full output histories and closed-form equilibrium for this prescribed affine plastic patch.
