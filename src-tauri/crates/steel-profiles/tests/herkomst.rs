//! Issue #241: de catalogus vermeldt per grootheid de bron.
//!
//! IPE 300 (h = 300, b = 150, t_w = 7,1, t_f = 10,7, r = 15): I_t = 201 000
//! mm⁴ staat zoals de EN 10365-tabel (201,2·10³, afgerond), I_w komt uit de
//! motor. Hand: de dunwandige tabelformule
//! I_w = t_f·b³/12·(h − t_f)²/2 = 10,7·150³/12·289,3²/2 = 125,93·10⁹ mm⁶ is
//! een bovengrens; de catalogus (motor) moet eronder liggen, binnen 2,5 %.
//! HEA 200: 108,00·10⁹ tegen de catalogus.

use steel_profiles::{db, herkomst, herkomst_groepen};

fn iw_formule(h: f64, b: f64, tf: f64) -> f64 {
    tf * b.powi(3) / 12.0 * (h - tf).powi(2) / 2.0
}

#[test]
fn ipe_300_bronnen() {
    let p = db().find("IPE 300").unwrap();
    let h = herkomst(p);
    assert!(h.tabel.contains(&"it_mm4") && h.berekend.contains(&"iw_mm6"));
    assert!(h.toelichting.contains("EN 10365"));
    assert_eq!(p.properties.it_mm4, 201_000.0);
    let f = iw_formule(300.0, 150.0, 10.7);
    assert!((f - 125.93e9).abs() < 0.01e9, "formule {f}");
    let iw = p.properties.iw_mm6;
    assert!(iw < f && (f - iw) / f < 0.025, "I_w {iw} tegen {f}");
}

#[test]
fn hea_200_iw_onder_de_formule() {
    let p = db().find("HEA 200").unwrap();
    let f = iw_formule(190.0, 200.0, 10.0);
    assert!((f - 108.0e9).abs() < 0.01e9);
    let iw = p.properties.iw_mm6;
    assert!(iw < f && (f - iw) / f < 0.025, "I_w {iw} tegen {f}");
    assert_eq!(p.properties.it_mm4, 209_800.0);
}

#[test]
fn overige_reeksen_berekend() {
    for naam in ["UNP 200", "CHS 88.9x4", "INP 200", "RD 24"] {
        let h = herkomst(db().find(naam).unwrap());
        assert!(h.tabel.is_empty(), "{naam}");
    }
    assert_eq!(herkomst_groepen().len(), 2);
}
