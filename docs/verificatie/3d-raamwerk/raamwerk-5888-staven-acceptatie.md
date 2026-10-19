# Verbonden 3D-staalraam met 5.888 staven

Het opgeslagen project `raamwerk-5888-staven-acht-bouwlagen.ifcfem2d`
bevat een 16 × 16 knopenraster op negen niveaus: 2.304 knopen,
2.048 kolomsegmenten, 3.840 liggers, 256 ingeklemde voetknopen en
256 belaste dakknopen. Iedere staaf is een volledig buigend 3D-raamwerkelement
met zes vrijheidsgraden per knoop. De graaf van staven is één verbonden
component. De nominale globale matrix telt 13.824 vrijheidsgraden,
waarvan 1.536 vastgelegd en 12.288 vrij. Het project is ingesteld op
tweede-orde P-Δ-analyse; eigen gewicht staat uit voor controleerbare lasttotalen.

De daklast is per knoop +0,25 kN in X en −2,5 kN in Z. Onafhankelijk van de
solver volgen hieruit totaal +64 kN en −640 kN, plus de globale momenten
(−19.200, +20.736, −1.920) kNm ten opzichte van de oorsprong. De
acceptatieproef controleert alle knoopverplaatsingen en staafeindkrachten,
vrije evenwichtsresiduen, reactiekrachten en volledige reactiemomenten met
hefboomarmen. Bij P-Δ gebruikt de momentcontrole de verplaatste
lastposities. Deze grote, verbonden berekening heeft geen gesloten
referentie voor de afzonderlijke staafkrachten.

Reproduceer het project met
`python3 scripts/verification/generate_frame3d_5888_project.py`.
Reken het via de echte app-adapter en de release-Rust-sidecar met
`cd design-mockup && node --import tsx accept-frame3d-5888-beam-app-route.mjs`.
De test accepteert `FRAME_LARGE_LINEAR_ONLY=1` voor een gerichte
eerste-ordecontrole. Het project is ook in de ontwikkelapp geladen: de UI
toonde 2.304 knopen, 5.888 staven en 256 opleggingen en knooplasten in de
3D-weergave.

Op de huidige machine voltooide de eerste-orde app-route in 22,57 s met
maximaal 1,342 mm verplaatsing en sluitende onafhankelijke kracht- en
momentbalans. De tweede-orde P-Δ-route voltooide in 350,46 s, met maximaal
1,343 mm verplaatsing, een grotere dakdrift dan in eerste orde en sluitende
reactiekrachten en -momenten op de verplaatste lastposities. De handmatige
proef gebruikt nu een grens van 600 s per afzonderlijke Rust-aanroep: de
gemeten tweede-ordelooptijd lag slechts 9,54 s onder de oorspronkelijke
360 s-grens. De gewone **Berekenen**-knop in de ontwikkelapp heeft daarnaast
de eerste-ordeanalyse en vijf belastingcombinaties afgerond; het actieve
geval toont dezelfde maximale verplaatsing van 1,342 mm en de Rust-resultaten
in de 3D-weergave. De P-Δ-doorlooptijd is duidelijk hoger dan die van eerste
orde. Dit meet één machine en één regelmatige gebouwtopologie;
hieruit volgt geen prestatiegarantie voor willekeurige grote raamwerken.

Op 8 oktober is de tijdelijke sparse LDLᵀ-opslag voor de stabiliteitscontrole
van boomknopen naar hashopslag gewijzigd. De actieve buurkolommen worden
voor elke pivot gesorteerd, zodat de rekenvolgorde reproduceerbaar blijft;
de vrijgekomen pivotopslag wordt direct afgegeven. De grens van twee miljoen
gelijktijdige factorentries en de positieve-pivotcontrole blijven gelden.
Met deze code slaagde dezelfde release-app-proef opnieuw: eerste orde
7,82 s, P-Δ 266,18 s, totale route 274,45 s en piekgeheugen circa
631 MB. De afgeronde maximale verplaatsingen bleven 1,342 en 1,343 mm,
en kracht- en momentbalans sloten. De eerdere 350,46 s P-Δ-meting is uit
een andere run; het verschil is een prestatie-indicatie, geen gecontroleerde
A/B-meting of garantie. Bij het kleinere 1.120-stavenmodel veranderde de
totale routetijd van 8,03 naar 8,20 s, dus daar is geen winst aangetoond.
Alle 15 gerichte matrix-unit-tests, 515 Rust-unit-tests en 10
3D-raamwerkpariteitstests slagen met de nieuwe opslag.
