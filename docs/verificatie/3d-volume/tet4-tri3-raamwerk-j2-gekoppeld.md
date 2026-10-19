# Gedeelde Tet4, Tri3-membraan en 3D-buigstaaf

Het opgeslagen [project](tet4-tri3-raamwerk-j2-gekoppeld.ifcfem2d) bevat één
Tet4-volume, een in-vlaks Tri3-membraan en een buigende 3D-staaf. Knoop 20
is hun gemeenschappelijke knoop; knoop 50 is de vrije staafpunt. De
app-selectie `2e orde + fysisch` bereikt de gedeelde Rust GNL/J2-route met
twee lastdoelen. De zeer hoge J2-vloeigrens is bewust gekozen om de
elastische kleine-belastinglimiet onafhankelijk te kunnen controleren;
dit is geen ontwerpmateriaal.

Voor een horizontale puntkracht `F` op knoop 50 liggen Tet4 en Tri3 parallel
aan de staafwortel. Met `λ=Eν/((1+ν)(1−2ν))`, `μ=E/(2(1+ν))` is

```
k_Tet = 1000 (λ+2μ)/6
k_Tri3 = 1000 E_m t / (2(1−ν_m²))
u_wortel = F/(k_Tet+k_Tri3)
u_punt = u_wortel + F L³/(3·1000 E_b I_z)
```

De factoren 1000 zetten MPa·m om naar kN. De tweede term is de
onafhankelijke Euler–Bernoulli-uitkraging voor de lokale buigas van deze
staaf. De app-test vergelijkt het lineaire gemengde stelsel via dense,
frontalWave en matrixFreePcg met deze formule. Daarna toetst hij de
J2-volume/Tri3/staafroute via dense en frontalWave in de kleine
vervormingslimiet en lost hij het opgeslagen GNL/J2-project ongewijzigd
op. Reacties en Newton-evenwicht sluiten.

**Grens:** Tri3 draagt alleen membraankracht. Een buigende plaat die met
een 3D-volume en buigstaaf deelt, shellvezelplasticiteit en algemene
grote-rotatievalidatie zijn hiermee niet aangetoond.
