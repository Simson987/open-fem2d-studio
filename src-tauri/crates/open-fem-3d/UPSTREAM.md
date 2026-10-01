# Externe rekenkern

Deze adapter gebruikt een externe 3D-raamwerkkern in Rust. Bron, package-naam en de
vastgezette revisie staan in `Cargo.toml` van deze crate (`[dependencies] rekenkern`);
`Cargo.lock` legt dezelfde revisie vast.

De externe kern valt onder AGPL-3.0. Daarom is deze crate, en de app en de MCP-server die
hem meelinken, AGPL-3.0-or-later (zie `LICENSE.md` in de root). Wie de app verspreidt of als
netwerkdienst aanbiedt, stelt de broncode van die versie beschikbaar, inclusief de revisie
van de externe kern uit `Cargo.toml`.

Open FEM Studio houdt de kern achter de geversioneerde typen van deze crate, zodat
kernspecifieke structuren niet in projectbestanden, de gebruikersinterface of toekomstige
plaat- en volume-adapters terechtkomen. De kern is zo later te vervangen.

De adapter controleert de invoer en zet Open FEM-eenheden om naar het contract van de kern:
krachten in kN, momenten in kNm, geometrie in m, elasticiteitsmodulus in MPa, oppervlak in
m², traagheids- en torsiemomenten in m⁴.

Platen (contractversie 2) rekenen met het MITC4-vierhoekelement van de kern; vlaklasten
(kN/m², globale assen) worden in de adapter consistente knoopkrachten en de resultaten
worden in de adapter naar plaatassen en één tekenafspraak omgezet (`src/shell.rs`). Het
DKT-driehoekelement van de kern wordt niet aangeboden: het haalt de analytische referenties
niet (`tests/plate_cases.rs`).
