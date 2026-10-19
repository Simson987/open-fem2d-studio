//! Independent, elementwise parity cases for the three linear backends.
//!
//! The one-dimensional case uses force equilibrium in a series of springs.
//! The two-dimensional scalar spring grid is an affine patch test: every
//! interior node must reproduce the imposed affine field exactly.

use openaec_native_fem::csr::{CsrAssembler, PcgOptions};
use openaec_native_fem::frontal::{self, FrontalElement, FrontalOptions};
use openaec_native_fem::math::{self, Matrix};

fn spring(a: usize, b: usize, stiffness: f64) -> FrontalElement {
    FrontalElement {
        dofs: vec![a, b],
        stiffness: vec![stiffness, -stiffness, -stiffness, stiffness],
    }
}

fn assert_close(actual: f64, expected: f64, label: &str) {
    let tolerance = 1e-10 * expected.abs().max(1.0);
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual {actual:.12e}, expected {expected:.12e}, tolerance {tolerance:.3e}"
    );
}

fn compare_backends(
    elements: &[FrontalElement],
    loads: &[f64],
    prescribed: &[Option<f64>],
) -> (Vec<f64>, Vec<f64>) {
    let mut dense = Matrix::zeros(loads.len()).unwrap();
    let mut sparse = CsrAssembler::new(loads.len()).unwrap();
    for element in elements {
        let width = element.dofs.len();
        sparse
            .add_element(&element.dofs, &element.stiffness)
            .unwrap();
        for (local_row, &row) in element.dofs.iter().enumerate() {
            for (local_col, &col) in element.dofs.iter().enumerate() {
                dense.add(row, col, element.stiffness[local_row * width + local_col]);
            }
        }
    }

    let (reference_u, reference_r) = math::constrained_solve(&dense, loads, prescribed).unwrap();
    let csr = sparse
        .build()
        .unwrap()
        .solve_constrained(loads, prescribed, PcgOptions::default())
        .unwrap();
    let frontal = frontal::solve(elements, loads, prescribed, FrontalOptions::default()).unwrap();
    for dof in 0..loads.len() {
        assert_close(csr.displacements[dof], reference_u[dof], "CSR displacement");
        assert_close(
            frontal.displacements[dof],
            reference_u[dof],
            "frontal displacement",
        );
        assert_close(csr.reactions[dof], reference_r[dof], "CSR reaction");
        assert_close(frontal.reactions[dof], reference_r[dof], "frontal reaction");
        if prescribed[dof].is_none() {
            assert_close(reference_r[dof], 0.0, "free residual");
        }
    }
    assert!(csr.true_free_residual_norm < 1e-9);
    assert!(frontal.relative_free_residual < 1e-9);
    (reference_u, reference_r)
}

#[test]
fn series_springs_match_force_equilibrium_with_settlement_and_point_loads() {
    // Right-to-left equilibrium gives element forces 7, 5, and 8.
    // Their elongations are F/k, independent of the prescribed 0.25 offset.
    let elements = [spring(0, 1, 10.0), spring(1, 2, 20.0), spring(2, 3, 5.0)];
    let (u, r) = compare_backends(
        &elements,
        &[0.0, 3.0, -2.0, 7.0],
        &[Some(0.25), None, None, None],
    );
    for (actual, expected) in u.iter().zip([0.25, 1.05, 1.30, 2.70]) {
        assert_close(*actual, expected, "series displacement");
    }
    assert_close(r[0], -8.0, "support reaction");
    assert_close(r.iter().sum::<f64>(), -8.0, "total reaction");
}

fn grid_4x4() -> (Vec<FrontalElement>, Vec<Option<f64>>) {
    let node = |x: usize, y: usize| x + 4 * y;
    let mut elements = Vec::new();
    let mut prescribed = vec![None; 16];
    for y in 0..4 {
        for x in 0..4 {
            if x == 0 || x == 3 || y == 0 || y == 3 {
                prescribed[node(x, y)] = Some(0.1 + x as f64 + 2.0 * y as f64);
            }
            if x < 3 {
                elements.push(spring(node(x, y), node(x + 1, y), 4.0));
            }
            if y < 3 {
                elements.push(spring(node(x, y), node(x, y + 1), 7.0));
            }
            if x < 3 && y < 3 {
                elements.push(spring(node(x, y), node(x + 1, y + 1), 2.0));
            }
        }
    }
    (elements, prescribed)
}

#[test]
fn two_dimensional_affine_patch_matches_all_backends() {
    let (elements, prescribed) = grid_4x4();
    let (u, reactions) = compare_backends(&elements, &[0.0; 16], &prescribed);
    for y in 1..3 {
        for x in 1..3 {
            assert_close(
                u[x + 4 * y],
                0.1 + x as f64 + 2.0 * y as f64,
                "affine patch",
            );
        }
    }
    assert_close(reactions.iter().sum(), 0.0, "affine reaction balance");
}

#[test]
fn two_dimensional_point_loads_preserve_parity_and_reaction_balance() {
    let (elements, prescribed) = grid_4x4();
    let mut loads = [0.0; 16];
    loads[5] = 3.0;
    loads[10] = -1.0;
    let (u, reactions) = compare_backends(&elements, &loads, &prescribed);
    assert!(u[5] > 3.1);
    assert_close(reactions.iter().sum(), -2.0, "loaded grid reaction balance");
}

#[test]
fn incompatible_unrestrained_mechanism_is_rejected_by_all_backends() {
    let elements = [spring(0, 1, 10.0)];
    let loads = [1.0, 0.0];
    let prescribed = [None, None];
    let mut dense = Matrix::zeros(2).unwrap();
    let mut sparse = CsrAssembler::new(2).unwrap();
    for (i, &row) in elements[0].dofs.iter().enumerate() {
        for (j, &col) in elements[0].dofs.iter().enumerate() {
            dense.add(row, col, elements[0].stiffness[2 * i + j]);
        }
    }
    sparse
        .add_element(&elements[0].dofs, &elements[0].stiffness)
        .unwrap();
    assert!(math::constrained_solve(&dense, &loads, &prescribed).is_err());
    assert!(sparse
        .build()
        .unwrap()
        .solve_constrained(&loads, &prescribed, PcgOptions::default())
        .is_err());
    assert!(frontal::solve(&elements, &loads, &prescribed, FrontalOptions::default()).is_err());
}

#[test]
fn frontal_front_limit_is_explicit_while_csr_and_dense_still_solve() {
    let elements = [spring(0, 1, 10.0), spring(1, 2, 20.0)];
    let loads = [0.0, 0.0, 5.0];
    let prescribed = [Some(0.0), None, None];
    compare_backends(&elements, &loads, &prescribed);
    let err = frontal::solve(
        &elements,
        &loads,
        &prescribed,
        FrontalOptions {
            max_front_dofs: 1,
            ..FrontalOptions::default()
        },
    )
    .unwrap_err();
    assert!(err.contains("wavefront exceeded maximum"), "{err}");
}
