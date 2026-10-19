//! Independent, one-free-DOF reference for a Tet4 and a plane-stress Tri3
//! membrane sharing their three face nodes. The expected stiffness and stress
//! come from continuum strain energy, without consulting element matrices.

use openaec_native_fem::dispatch::{solve_native_fem, NativeFemRequest, NativeFemResult};
use serde_json::{json, Value};

const SOLID_E_MPA: f64 = 1_200.0;
const SOLID_NU: f64 = 0.2;
const MEMBRANE_E_MPA: f64 = 3_000.0;
const MEMBRANE_NU: f64 = 0.25;
const THICKNESS_M: f64 = 0.08;
const FORCE_KN: f64 = 10.0;

fn near(actual: f64, expected: f64, tolerance: f64, what: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{what}: actual={actual:.15e}, expected={expected:.15e}, tolerance={tolerance:.2e}"
    );
}

fn number(value: &Value, key: &str) -> f64 {
    value
        .as_f64()
        .unwrap_or_else(|| panic!("{key} is not a number: {value}"))
}

fn model(backend: &str, membrane_nodes: [usize; 3], rotated: bool) -> NativeFemRequest {
    // A proper +90-degree rotation about z preserves Tet4 orientation. In the
    // unrotated model, node 1 has ux free; in the rotated model it has uy free.
    let nodes = if rotated {
        json!([[0, 0, 0], [0, 1, 0], [-1, 0, 0], [0, 0, 1]])
    } else {
        json!([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]])
    };
    let loads = if rotated {
        json!([[0, 0, 0], [0, FORCE_KN, 0], [0, 0, 0], [0, 0, 0]])
    } else {
        json!([[0, 0, 0], [FORCE_KN, 0, 0], [0, 0, 0], [0, 0, 0]])
    };
    let free_node_support = if rotated {
        json!([0, null, 0])
    } else {
        json!([null, 0, 0])
    };
    let request = json!({
        "kind": "mixed3d",
        "input": {
            "mesh": { "nodes": nodes, "tets": [[0, 1, 2, 3]] },
            "solidMaterial": { "eMpa": SOLID_E_MPA, "poisson": SOLID_NU },
            "membranes": [{
                "nodes": membrane_nodes,
                "eMpa": MEMBRANE_E_MPA,
                "nu": MEMBRANE_NU,
                "thicknessM": THICKNESS_M
            }],
            "trusses": [],
            "loadsKn": loads,
            "prescribedM": [[0, 0, 0], free_node_support, [0, 0, 0], [0, 0, 0]],
            "backend": backend,
            "threads": 2
        }
    });
    serde_json::from_value(request).expect("public mixed3d membrane schema")
}

fn run(backend: &str, membrane_nodes: [usize; 3], rotated: bool) -> Value {
    let output = solve_native_fem(model(backend, membrane_nodes, rotated))
        .unwrap_or_else(|error| panic!("{backend} membrane-solid solve: {error}"));
    let NativeFemResult::Mixed3d(result) = output else {
        panic!("mixed3d request dispatched to another result");
    };
    serde_json::to_value(result).expect("mixed3d result serializes")
}

fn reference_displacement() -> f64 {
    let mu = SOLID_E_MPA / (2.0 * (1.0 + SOLID_NU));
    let lambda = SOLID_E_MPA * SOLID_NU / ((1.0 + SOLID_NU) * (1.0 - 2.0 * SOLID_NU));
    // Tet4: V=1/6 m³ and ∇N_1=(1,0,0) 1/m. Only epsilon_xx=u.
    let solid_k_kn_per_m = 1_000.0 * (lambda + 2.0 * mu) / 6.0;
    // Tri3: A=1/2 m² and ∂N_1/∂x=1 1/m. Plane stress, epsilon_11=u.
    let membrane_k_kn_per_m =
        1_000.0 * MEMBRANE_E_MPA / (1.0 - MEMBRANE_NU * MEMBRANE_NU) * THICKNESS_M / 2.0;
    FORCE_KN / (solid_k_kn_per_m + membrane_k_kn_per_m)
}

fn check_reference(result: &Value, rotated: bool, reversed_winding: bool) {
    let u = reference_displacement();
    let free_axis = usize::from(rotated);
    near(
        number(
            &result["nodalDisplacementsM"][1][free_axis],
            "shared free displacement",
        ),
        u,
        1e-12,
        "shared Tet4/Tri3 displacement",
    );
    near(
        number(&result["relativeResidual"], "relativeResidual"),
        0.0,
        1e-9,
        "free residual",
    );

    let mu = SOLID_E_MPA / (2.0 * (1.0 + SOLID_NU));
    let lambda = SOLID_E_MPA * SOLID_NU / ((1.0 + SOLID_NU) * (1.0 - 2.0 * SOLID_NU));
    let solid_stress = &result["solidElementStressMpa"][0];
    near(
        number(&solid_stress[free_axis], "solid stress parallel to load"),
        (lambda + 2.0 * mu) * u,
        1e-9,
        "Tet4 direct stress",
    );
    near(
        number(&solid_stress[1 - free_axis], "solid Poisson stress"),
        lambda * u,
        1e-9,
        "Tet4 transverse stress",
    );
    let membrane_d = MEMBRANE_E_MPA / (1.0 - MEMBRANE_NU * MEMBRANE_NU);
    let membrane_stress = &result["membraneStressMpa"][0];
    let loaded_local_axis = usize::from(reversed_winding);
    near(
        number(
            &membrane_stress[loaded_local_axis],
            "membrane direct stress",
        ),
        membrane_d * u,
        1e-9,
        "Tri3 direct stress",
    );
    near(
        number(
            &membrane_stress[1 - loaded_local_axis],
            "membrane transverse stress",
        ),
        MEMBRANE_NU * membrane_d * u,
        1e-9,
        "Tri3 Poisson stress",
    );
    near(
        number(&membrane_stress[2], "membrane shear stress"),
        0.0,
        1e-9,
        "Tri3 shear stress",
    );
    let resultants = &result["membraneResultantsKnPerM"][0];
    for axis in 0..3 {
        near(
            number(&resultants[axis], "membrane resultant"),
            1_000.0 * THICKNESS_M * number(&membrane_stress[axis], "membrane stress"),
            1e-8,
            "membrane N = sigma times thickness",
        );
    }
    let reaction: f64 = result["nodalReactionsKn"]
        .as_array()
        .expect("reactions are an array")
        .iter()
        .map(|r| number(&r[free_axis], "reaction"))
        .sum();
    near(reaction, -FORCE_KN, 1e-8, "global force equilibrium");
}

#[test]
fn parallel_tet4_tri3_stiffness_and_stress_match_continuum_reference_on_all_backends() {
    let reference = run("dense", [0, 1, 2], false);
    check_reference(&reference, false, false);
    for backend in [
        "sparseDirect",
        "sparsePcg",
        "frontalWave",
        "matrixFreePcg",
        "automatic",
    ] {
        let result = run(backend, [0, 1, 2], false);
        check_reference(&result, false, false);
        near(
            number(&result["nodalDisplacementsM"][1][0], "backend displacement"),
            number(
                &reference["nodalDisplacementsM"][1][0],
                "dense displacement",
            ),
            1e-12,
            "backend parity",
        );
    }
}

#[test]
fn triangle_winding_and_proper_rotation_preserve_global_solution() {
    let standard = run("matrixFreePcg", [0, 1, 2], false);
    let reversed = run("matrixFreePcg", [0, 2, 1], false);
    let rotated = run("matrixFreePcg", [0, 1, 2], true);
    check_reference(&standard, false, false);
    check_reference(&reversed, false, true);
    check_reference(&rotated, true, false);
    near(
        number(
            &reversed["nodalDisplacementsM"][1][0],
            "reversed displacement",
        ),
        number(
            &standard["nodalDisplacementsM"][1][0],
            "standard displacement",
        ),
        1e-12,
        "winding invariance",
    );
    near(
        number(
            &rotated["nodalDisplacementsM"][1][1],
            "rotated displacement",
        ),
        number(
            &standard["nodalDisplacementsM"][1][0],
            "standard displacement",
        ),
        1e-12,
        "proper rotation invariance",
    );
}
