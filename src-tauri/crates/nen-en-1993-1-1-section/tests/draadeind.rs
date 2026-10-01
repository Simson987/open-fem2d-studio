//! De spanningsdoorsnede A_s van metrische draad: de formule van ISO 898-1
//! tegen de gedrukte tabel.
//!
//! De kern rekent A_s = π/4·(d − 0,9382·P)² met de grove spoed P van ISO 261;
//! de formule is de bron. De tabel hieronder is alleen ter controle — zij is
//! op drie à vier cijfers afgerond (M16: 157 mm² tegen 156,67 uit de formule,
//! 0,21 %). Wijkt de formule meer dan 0,25 % af, dan klopt de spoed of de
//! formule niet.
//!
//! Tabel (mm²): M10 58,0; M12 84,3; M16 157; M20 245; M24 353; M27 459;
//! M30 561; M33 694; M36 817; M39 976; M42 1120; M45 1306; M48 1473;
//! M52 1758; M56 2030; M60 2362; M64 2676.

use approx::assert_relative_eq;
use nen_en_1993_1_1_section::trek::{grove_spoed_mm, spanningsdoorsnede_mm2, K2_DRAAD};

const TABEL: [(f64, f64); 17] = [
    (10.0, 58.0),
    (12.0, 84.3),
    (16.0, 157.0),
    (20.0, 245.0),
    (24.0, 353.0),
    (27.0, 459.0),
    (30.0, 561.0),
    (33.0, 694.0),
    (36.0, 817.0),
    (39.0, 976.0),
    (42.0, 1120.0),
    (45.0, 1306.0),
    (48.0, 1473.0),
    (52.0, 1758.0),
    (56.0, 2030.0),
    (60.0, 2362.0),
    (64.0, 2676.0),
];

#[test]
fn formule_ligt_binnen_de_afronding_van_de_tabel() {
    let mut ergste = 0.0_f64;
    for (d, tabel) in TABEL {
        let p = grove_spoed_mm(d).unwrap_or_else(|| panic!("M{d} heeft geen grove spoed"));
        let a_s = spanningsdoorsnede_mm2(d, p);
        let afw = (a_s - tabel) / tabel;
        ergste = ergste.max(afw.abs());
        assert!(afw.abs() < 2.5e-3, "M{d}: formule {a_s:.2} tegen tabel {tabel} ({:+.3} %)", afw * 100.0);
    }
    // De grootste afwijking zit bij M16 (0,21 %): de tabel rondt daar op drie
    // cijfers af. Zakt dit onder 0,1 %, dan is de tabel of de spoed veranderd.
    assert!(ergste > 1e-3, "grootste afwijking {ergste}");
}

/// Twee spoeden met de hand: M24 heeft P = 3,0 mm, M30 P = 3,5 mm (ISO 261).
///   M24: A_s = π/4·(24 − 2,8146)² = π/4·448,821 = 352,503 mm²
///   M30: A_s = π/4·(30 − 3,2837)² = π/4·713,761 = 560,586 mm²
#[test]
fn m24_en_m30_met_de_hand() {
    assert_eq!(grove_spoed_mm(24.0), Some(3.0));
    assert_eq!(grove_spoed_mm(30.0), Some(3.5));
    assert_relative_eq!(spanningsdoorsnede_mm2(24.0, 3.0), 352.503, max_relative = 1e-6);
    assert_relative_eq!(spanningsdoorsnede_mm2(30.0, 3.5), 560.586, max_relative = 1e-6);
    // k₂ uit NEN-EN 1993-1-8 tabel 3.4 (geen verzonken kop).
    assert_eq!(K2_DRAAD, 0.9);
}
