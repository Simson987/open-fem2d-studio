# Wijzigingen ten opzichte van de bron

Bron: <https://github.com/lambdaclass/stabileo>, map `engine/`, revisie
`7d87e551b765c88956df95b375e0ef0befda53f7` (AGPL-3.0, zie `LICENSE`). Open FEM Studio haakt
deze kopie in via `[patch."https://github.com/lambdaclass/stabileo.git"]` in
`src-tauri/Cargo.toml`; `open-fem-3d` en `frame3d-solver` noemen in hun `Cargo.toml` nog steeds
de oorspronkelijke bron en revisie.

Weggelaten: `tests/`, `benches/`, de dev-dependencies en het releaseprofiel (een profiel in een
niet-rootpakket negeert Cargo). Een paar `#[cfg(test)]`-modules in `src/` lezen bestanden uit
`tests/fixtures`; die worden alleen bij `cargo test` van deze crate zelf gebouwd, en dat doet
Open FEM niet.

## Orthotrope MITC4-schaalelementen (#79, #97)

- `types/input.rs`: `SolverQuadElement` kreeg het optionele veld `constitutive`
  (`QuadConstitutive`: membraanmatrix A, buigmatrix D, dwarskrachtmatrix S en een
  referentiestijfheid voor de boorvrijheidsgraad, in de eigen elementassen). Zonder dat veld
  rekent het element precies als de bron.
- `element/quad.rs`: `quad_element_stiffness` (keuze isotroop/algemeen) en
  `mitc4_local_stiffness_general` (dezelfde MITC4-formulering met volle matrices).
- `solver/assembly.rs` (2×) en `solver/sparse_assembly.rs`: de assemblage roept
  `quad_element_stiffness` aan in plaats van `mitc4_local_stiffness`.
- `solver/sparse_assembly.rs`: twee testconstructies van `SolverQuadElement` kregen
  `constitutive: None`.

Niet aangepast (gebruikt nog de isotrope E en ν van het materiaal): de spanningen in de
kernuitvoer (`compute_quad_stresses`), de massamatrix en de geometrische stijfheid. De adapter
`open-fem-3d` herberekent plaatkrachten zelf (`src/shell.rs`) en weigert tweede orde met platen.
