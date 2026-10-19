# Gekoppelde Hex8, Tet4, Tri3-membraan en 3D-raamwerk

Het opgeslagen project `tet4-hex8-tri3-raamwerk-j2-gekoppeld.ifcfem2d`
bevat één Hex8, één Tet4, één Tri3-membraan en één buigende 3D-staaf.
Alle vier delen hetzelfde knooppunt 2. Alleen zijn x-translatie is vrij;
de overige volumeknopen en de drie wortelrotaties zijn vast. Een
dwarskracht op het vrije staafeinde belast de gedeelde translatie en de
staafbuiging in serie. De Tet4 ligt naast de Hex8 en raakt haar alleen
in dit knooppunt; dit is een transparante koppelingstest, geen
volledig conforme interfacepatch.

Met `E_s=1200 MPa`, `ν_s=0,2`, `E_m=3000 MPa`, `ν_m=0,25`,
`t=0,08 m`, staaflengte `L=1 m` en `F=0,05 kN` is de onafhankelijke
scalaire referentie:

```text
λ = E_s ν_s / ((1+ν_s)(1−2ν_s));  μ = E_s / (2(1+ν_s))
k_Hex8 = 1000(λ+4μ)/9
k_Tet4 = 1000(λ+2μ)/6
k_Tri3 = 1000 E_m t / (2(1−ν_m²))
u_wortel = F / (k_Hex8+k_Tet4+k_Tri3)
u_tip = u_wortel + F L³ / (3·1000 E_b I_z)
```

De app-routetest `design-mockup/test-frame3d-membrane-volume-app-route.mjs`
toetst de lineaire uitkomst voor `dense`, `frontalWave` en
`matrixFreePcg`, en de eindige-rek J2-route met hoge vloeigrens voor
`material` en `combined`. Hij laadt het opgeslagen project via
`deserializeProject`, kiest de analyse zoals de app en vergelijkt de
wortel- en tipverplaatsingen met deze referentie. De hoge vloeigrens
toetst uitsluitend de elastische limiet van het gedeelde J2/GNL-pad.
Plastische framevezels, plaatbuiging en een algemeen gedeeld
plaat-volume-frame-model zijn hiermee niet gevalideerd.

Het tweede opgeslagen project
`tet4-hex8-tri3-raamwerk-j2-plastisch.ifcfem2d` gebruikt op beide
volumes `Y=0,001 MPa`, `H=300 MPa` en `F=5 kN` in drie laststappen.
Zowel Hex8 als Tet4 krijgen een positieve equivalente plastische rek.
De app-routetest vergelijkt de eerste-orde materiaaloplossingen van
`dense` en `frontalWave`, controleert het globale evenwicht en toetst
voor elk volume de grens `q(σ̄) ≤ Y + H p_max + 10⁻⁵ MPa`. Ook de
gecombineerde GNL/J2-route en het herladen van dit project slagen.
De grens gebruikt de volumegemiddelde spanning en maximale lokale
plastische rek; zij vervangt geen materiaalpuntvalidatie of een
referentie voor de volledige plastische verplaatsing.

In de lege 3D-editor staat nu de knop **Hex8 + Tet4 + Tri3-plaat +
3D-staaf**. Deze laadt dezelfde opgeslagen elastische-limietfixture.
Een live berekening via de ontwikkelapp op `127.0.0.1:1440` liet alle
12 knopen, 2 volumes, 1 membraan en 1 staaf zien en eindigde met
`frontalWave` en `u_max = 0,001332 mm`. De normale app-route en de
opgeslagen J2/GNL-projecten blijven afzonderlijk getest; de voorbeeldknop
zet het actieve analysetype van een bestaand project niet om.
Na handmatig kiezen van **GNL + staal-FNL (Tet4/Hex8)** rekende dezelfde
live app het voorbeeld opnieuw door als `2e orde + FNL`, met sluitende
berekening en dezelfde verplaatsing in deze kleine-belastinglimiet.

Een derde opgeslagen project
`tet4-hex8-tri3-raamwerk-j2-ontlasten.ifcfem2d` voegt doelwaarde
`0` toe aan het plastische lastpad `[0,25; 0,5; 1; 0]`. Beide volumes
houden plastische rek over. De onbelaste gecombineerde oplossing sluit
kracht en moment, houdt een tiprestverplaatsing van `3,455270·10⁻⁶ m`
over en geeft de elastische staaf geen spookachtige restbuiging:
`u_tip,x = u_wortel,x` tot `10⁻⁸ m`. Dichte en frontale eerste-orde
materiaalroutes stemmen binnen `10⁻⁷ m` overeen; het opgeslagen
GNL/J2-project doorloopt de normale app-route.
