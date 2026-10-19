# Eindige-rek volume met een volledig buigende 3D-staaf

`tet4-hex8-j2-buigraamwerk.ifcfem2d` combineert twee Tet4, één Hex8 en een
volledige 3D Euler–Bernoulli-staaf in één opgeslagen app-project. De staaf
deelt zijn startknooptranslaties met het volume, draagt axiale kracht,
dwarskracht, buiging in twee richtingen en torsie, en heeft drie
rotatievrijheidsgraden per aangesloten knoop. Een verticale eindlast van
10 kN en een staaflengte van 1 m leveren onafhankelijk 10 kN dwarskracht
en 10 kNm inklemmingsmoment. De volumes volgen eindige-rek staal-J2; de
staaf gebruikt een lineair elastische referentie-aswet binnen dezelfde
Newton- en laststappen.

De fixture is reproduceerbaar met
`python3 scripts/verification/generate_finite_j2_frame_volume_project.py`.
`design-mockup/test-frame3d-volume-finite-j2-full-frame-app-route.mjs`
opent dit bestand via de gewone projectparser en rekent met de Rust-sidecar
via de echte 3D-app-adapter. Sparse GMRES, frontalWave en matrixvrije GMRES
geven dezelfde zes tipcomponenten binnen 10⁻⁷ m/rad; alle drie voldoen aan
de onafhankelijke staafkracht- en momenteis en aan globaal kracht- en
momentevenwicht.

Het opgeslagen project selecteert de automatische oplosser. Daarmee slagen
ook alle vijf door de app gegenereerde belastingcombinaties, inclusief de
kleine quasi-blijvende factor 0,3, met een relatief evenwichtsresidu onder
10⁻⁸. Bij die kleine factor liep Sparse GMRES rond 2·10⁻⁹ kN in de
Newton-lijnzoeker vast. De automatische route herstart dan dezelfde stap
vanuit de laatst geaccepteerde toestand met een frontale tangent, mits de
werkelijke frontbreedte binnen de ingestelde grens valt. De tolerantie en
materiaalgeschiedenis blijven daarbij gelijk. Een directe frontale oplossing
van precies dezelfde app-invoer geeft dezelfde tipverplaatsingen, rotaties
en staafeindkrachten. De invoer is vastgelegd in
`src-tauri/crates/native-fem/tests/fixtures/finite_j2_frame_combo_03.json`;
hergenereren kan met
`cd design-mockup && node --import tsx export-j2-frame-combo-fixture.mjs`.
De matrixvrije en dichte routes kunnen bij kleine factoren nog steeds
vastlopen wanneer zij expliciet zijn gekozen; dit vraagt verdere diagnose.

`src-tauri/crates/native-fem/tests/volume_finite_j2_frame_coupled_reference.rs`
toetst daarnaast een Tet4/staafmodel met een onafhankelijke
kleine-verplaatsingsoplossing voor beide buigvlakken en torsie, zes
oplossingsstrategieën, lokale staafeindkrachten, een gedeeld Hex8-knooppunt,
JSON-dispatch en foutafhandeling voor een moment op een knoop zonder staaf.

De eerste-orde materiaalroute controleert het globale moment nu met
referentiearmen wanneer een elastische eerste-orde-staaf aan eindige-rek
volumes hangt. Een gedeformeerde arm zou een P-Δ-koppel toevoegen dat
deze staafwet niet bevat. De regressie met `−250 kN` druk en `−0,1 kN`
dwarskracht geeft `4,548142·10⁻⁵ m` relatieve tipdoorbuiging, gelijk aan
`HL³/(3EI)` binnen de testtolerantie; kracht, referentiemoment en vrij
Newton-residu sluiten. De afzonderlijke gecombineerde geometrische route
geeft `5,267360·10⁻⁵ m` tegenover `5,268134·10⁻⁵ m` uit de gesloten
staafkolomformule. De grote niet-affiene Hex8/staafplastische app-proef
blijft na deze wijziging slagen. Dit herstelt de eerste-orde controle
voor deze hybride referentietoestand; een algemene geometrisch exacte
staafwet volgt hier niet uit.

De staafwet werkt met de oorspronkelijke as en een elastische doorsnede.
Geometrische staafnietlineariteit, plastische framevezels, scharnieren,
thermische staaflasten en buigende platen zijn nog geen onderdeel van deze
gedeelde route. De grote 250k-volumeproeven dekken deze nieuwe koppeling
evenmin; daarvoor is een aparte schaalproef nodig.
