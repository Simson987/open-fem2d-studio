# Groot 3D-raamwerk: acceptatieproeven

## Verbonden gebouwmodel in de app

`raamwerk-1120-staven-vier-bouwlagen.ifcfem2d` bevat 500 knopen,
1.120 volledige 3D-raamwerkstaven, 100 ingeklemde voetknopen en 100
daklasten. De vier verdiepingen hebben elk een raster van 10 × 10 vakken;
de staven dragen axiale kracht, dwarskracht, buiging en torsie. De daklasten
sommeren tot +100 kN in X en −1.000 kN in Z. Eigen gewicht is uitgeschakeld
zodat de evenwichtscontrole eenduidig is. Het project opent standaard in
**2e orde (P-Δ)**; de app-routetest vergelijkt ook de eerste-ordeoplossing.

Reproduceer het project met
`python3 scripts/verification/generate_large_frame_fixture.py`. De app-route
wordt gecontroleerd met
`OPEN_FEM_TEST_DIRECT_TSX=1 node design-mockup/scripts/run-tests.mjs --filter=test-frame3d-1120-beam-app-route`.
Deze proef verstuurt het project via dezelfde adapter als de app naar de
releaseversie van de Rust-kernel. Hij controleert de 500 verplaatsingsvectoren,
1.120 staafeindkrachten, eindige uitkomsten en de globale kracht- en
momentbalans. Bij een handmatige run in de ontwikkelapp gaf het actieve
belastinggeval een maximale verplaatsing van 2,554 mm.

Dezelfde app-routetest rekent het gebouw ook met de tweede-orde P-Δ-route.
Daarbij blijven alle 500 knoopvectoren en 1.120 staafresultaten eindig, het
vrije evenwichtsresidu voldoet aan de solvercontrole, de reacties sluiten
op de opgelegde horizontale en verticale lasten en de dakdrift neemt toe ten
opzichte van de eerste-ordeoplossing. De oorspronkelijke gecombineerde
bronproef duurde 98,7 s op de gebruikte machine. Na een minimum-degree-
volgorde per 3D-knoop in de sparse LDLᵀ-stabiliteitscontrole daalde de
afzonderlijke P-Δ-kernproef van 125,16 naar 9,69 s, met numeriek identieke
volledige resultaat-JSON. De actuele app-routetest met beide analyses slaagde
in 12,8 s. Zij vergelijkt nu ook de globale reactiemomenten met de
onafhankelijke som van de daklasten en hun hefboomarmen. Voor P-Δ worden de
verplaatste aangrijpingspunten gebruikt; de grootste resterende
momentafwijking was 0,0106 kNm op circa 19.200 kNm. Dit is een numerieke
schaal- en evenwichtscontrole; voor dit verbonden gebouw bestaat geen
gesloten tweede-ordeoplossing voor alle individuele staafresultaten.
Met de gewone **Berekenen**-knop in de ontwikkelapp is de tweede-ordeanalyse
inclusief de vijf belastingcombinaties ook afgerond: het actieve geval toont
2,560 mm maximale verplaatsing, tegenover 2,554 mm in eerste orde.

## Onafhankelijke schaalreferentie

`src-tauri/crates/native-fem/tests/frame3d_frontal_memory_validation.rs`
toetst 3.334 afzonderlijke buigende 3D-staven, 3.335 knopen en 20.010
vrijheidsgraden met belastingen op alle zes tipcomponenten. De proef vergelijkt
tipverplaatsingen, alle twaalf lokale eindkrachtcomponenten en zes reacties met
de gesloten Euler–Bernoulli-, axiale en torsieoplossingen. De releaseproef
slaagde met een evenwichtsresidu van 3,819 × 10⁻¹⁶; de losse testbinary duurde
0,38 s met 33.096 KiB piek-RSS op de gebruikte machine.

Deze analytische schaalproef heeft een stertopologie met een gemeenschappelijke
ingeklemde wortel. Het verbonden gebouwmodel vult de topologiecontrole aan,
maar heeft geen onafhankelijke gesloten oplossing voor iedere staafkracht.
De resultaten bewijzen evenmin dat een willekeurig 250.000-stavenmodel of een
gekoppeld 3D raamwerk-volume-FNL-model schaalbaar is.
