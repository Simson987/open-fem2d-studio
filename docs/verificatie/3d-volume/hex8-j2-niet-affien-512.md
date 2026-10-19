# Niet-affiene plastische Hex8-proef in de gewone 3D-app

`hex8-j2-niet-affien-512.ifcfem2d` is een opgeslagen 1 × 1 × 1 m kubus met
8³ = 512 Hex8-elementen, 729 knopen en 1.944 vrije translatie-DOF. De zijde
`x=0` is ingeklemd. Op `x=1` werkt een consistente dode vlaklast van
`(3, 0, −0,5) MPa`, plus 30 kN in Y op de uiterste hoek. Het staal heeft
`E=1.000 MPa`, `ν=0,3`, `fy=2 MPa` en isotrope verharding `H=100 MPa`.
Die hoeklast breekt de affiene symmetrie en maakt een ruimtelijk variërende
plastische zone. Het project kiest eindige-rek J2 en matrixvrije GMRES met
vier threads.

De bron is reproduceerbaar met
`python3 scripts/verification/generate_hex8_j2_nonaffine_project.py`.
`design-mockup/test-frame3d-volume-finite-j2-hex-nonaffine-512-app-route.mjs`
opent het opgeslagen bestand met dezelfde projectparser als de app en rekent
via de gewone 3D-adapter en release-`toetsbrug`. De proef controleert de
getypeerde Rust-dispatcher, alle knoop- en elementresultaten, de
reactiekrachtsommen `(-3.000, -30, +500) kN`, het vrije evenwicht en het
bestaan van zowel plastische als elastische gebieden. Gemeten: 495 elementen
met plastische rek, 17 zonder en een gerapporteerd relatief residu van
`2,311·10⁻¹⁴`. De app-route gaf eindige spanningen op alle acht Gauss-punten
van ieder element.

De onafhankelijke Rust-proef
`tests/volume_finite_j2_hex_nonaffine_scale.rs` gebruikt hetzelfde 8³-net
en reconstrueert knoopkrachten uit de teruggegeven eerste
Piola–Kirchhoff-spanningen met een afzonderlijke achtpuntsintegratie. Zij
controleert ook globale kracht en moment, intern/extern werk en de niet
uniforme materiaalgeschiedenis. Gemeten: 3.880 plastische en 216 elastische
Gauss-punten, vrije krachtfout `9,26·10⁻¹¹ kN` en vrij residu
`1,89·10⁻¹⁰ kN`. Dit bewijst een specifieke krachtgestuurde niet-affiene
proef; grotere willekeurige netten vergen aparte acceptatie.
