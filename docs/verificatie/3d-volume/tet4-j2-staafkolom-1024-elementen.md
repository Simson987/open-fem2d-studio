# Slanke tweede-orde staafkolom met 1.024 3D-staven en J2-Tet4

`scripts/verification/generate_beam_column_1024_j2_project.mjs` maakt het
opgeslagen app-project
`tet4-j2-staafkolom-1024-elementen.ifcfem2d`. Het telt 1.028 knopen,
1.024 volledige 12-DOF-staven en één Tet4. De vrije Tet4-knoop deelt zijn
translaties met de staafwortel; de drie andere Tet4-knopen zijn vast en
de wortelrotaties zijn geblokkeerd. De totale staaflengte is 20 m.

Aan het vrije uiteinde werken 0,5 kN druk en 0,01 kN dwarskracht. Elke
staaf heeft een HEA100-doorsnede met `E=210.000 MPa` en
`I_y=3,49·10⁻⁶ m⁴`, dus `EI=732,9 kNm²`. De Tet4 gebruikt eindige-rek
J2-staal maar blijft in deze proef elastisch. Vier absolute laststappen
en `automatic` kiezen de frontale oplosser.

De onafhankelijke Euler-Bernoulli-staafkolomvergelijking is
`EI w'''' + P w'' = 0`. Met een ingeklemde wortel, vrije eindmoment en
einddwarskracht `H` volgt voor de **relatieve** einddoorbuiging
`w(L)=H/P·(tan(kL)/k−L)`, waarbij `k=√(P/EI)`. De Tet4-worteltranslatie
valt weg in `w_tip−w_wortel`. De ingeklemde kniklast is
`P_cr=π²EI/(4L²)`; hier is `P/P_cr=0,111`. Eerste orde geeft
`HL³/(3EI)=0,0363851367 m`; tweede orde geeft `0,0408500008 m`.

`design-mockup/accept-beam-column-1024-j2-app-route.mjs` laadt het echte
project en roept de Rust-sidecar via de gewone 3D-app-adapter aan. De
berekende relatieve doorbuiging is `0,0408500009 m`, het vrije relatieve
residu `1,361·10⁻⁷`, en de globale kracht- en momentbalans sluit. De
gebruikersgrens in dit project is expliciet `10⁻⁶`; de gemeten waarde
blijft eronder. De lokale releaserun duurde 1,70 s. Dit is een
onafhankelijk groot-modelbewijs voor de tweede-orde elastische staafrespons
in het gedeelde J2-volume-Newtonstelsel, binnen de kleine-rotatiegrens.

Een verkennende 2.048-staafketen op dezelfde 20 m bleek nog geen
geaccepteerde schaalvariant: bij 2 kN druk ontstond rond de halve last
een negatieve frontale spil; bij 0,5 kN overschreed het eindresultaat
de strikte appcontrole op het vrije krachtresidu. Compensated summation
bij reactieherstel verlaagde de lineaire residufout, maar loste deze
conditioneringsgrens niet volledig op. De gewone frontale standaard blijft
`10⁻⁸`; alleen de eindige-rek J2-route mag de expliciet gekozen,
begrensde projecttolerantie aan de frontale oplosser doorgeven. De
2.048-staafvariant wordt niet als geslaagd geclaimd.
