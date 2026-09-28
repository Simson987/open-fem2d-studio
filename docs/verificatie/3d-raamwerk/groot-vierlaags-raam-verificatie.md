# Vierlaags 3D-raam — referentieberekening

[`groot-vierlaags-raam.ifcfem2d`](groot-vierlaags-raam.ifcfem2d) is een herhaalbaar project met 100 knopen, 235 staven (75 kolommen HEA 200 en 160 liggers IPE 200), 25 ingeklemde voeten en 72 belastingen. De knopen vormen vier niveaus op z = 0, 3, 6 en 9 m, telkens 5 × 5 knopen met 4 m afstand in X en Y. Materiaal: S235; eigen gewicht is voor deze afzonderlijke proef uitgeschakeld.

De invoer en vijf lineaire berekeningen zijn vastgelegd in [`test-frame3d-campus-frame.mjs`](../../../design-mockup/test-frame3d-campus-frame.mjs). Het script gebruikt dezelfde model-naar-kernadapter als de GUI. De onderstaande verwachtingen volgen onafhankelijk uit ΣF = 0 en ΣM = 0 rond (0,0,0); de momentensom bevat ook de hefboomarm van alle oplegreacties.

| Geval | Aangebracht | Verwachte Σ reacties (Fx, Fy, Fz) kN | Verwachte Σ steunmoment (Mx, My, Mz) kNm |
| --- | --- | --- | --- |
| Daklast | 25 × Fz = −12 kN | (0, 0, +300) | (+2400, −2400, 0) |
| Wind Y | 25 × Fy = +4 kN op z = 9 m | (0, −100, 0) | (+900, 0, −800) |
| Dakliggerlast | 20 × qz = −3 kN/m op 4 m | (0, 0, +240) | (+1920, −1920, 0) |
| Excentrisch | Fx = +15 kN en Mz = +30 kNm op (16,16,9); Pz = −10 kN midden op een dakligger bij (2,0,9) | (−15, 0, +10) | (0, −155, +210) |
| Alle vier, factor 1 | Som van de vier gevallen | (−15, −100, +550) | (+5220, −4475, −590) |

De vijf berekeningen voldeden aan de grenzen 10⁻⁴ kN voor de reactiesom en 10⁻³ kNm voor de momentensom. Onder de symmetrische daklast kreeg iedere voet +12 kN verticale reactie, binnen 10⁻⁵ kN. De grootste werkelijke afwijking van de onafhankelijke balans was 8,7 × 10⁻¹² kN en 9,1 × 10⁻¹¹ kNm. Het relatieve solverresidu bleef onder 3,8 × 10⁻¹³. Daarnaast vergelijkt de test de combinatie met de som van de vier losse gevallen voor alle zes verplaatsingen van 100 knopen, alle zes reactiegrootheden van 25 voeten en alle 12 kracht- en momentwaarden van 235 staven. Geen verschil overschreed 10⁻⁵ in de betreffende uitvoereenheid.

De GUI heeft het project geopend met 100 knopen, 235 staven, 25 opleggingen en 72 lasten. ‘Berekenen’ voltooide de berekening bij de projectinstelling **eerste orde**. In de GUI bedroeg `umax` 0,09559 mm voor daklast, 18,04 mm voor wind Y, 0,7351 mm voor de dakliggerlast en 40,66 mm voor de excentrische last. Die waarden stemmen overeen met het script (respectievelijk 0,09559, 18,04195, 0,73511 en 40,66021 mm na afronden). `umax` omvat ook het veld van iedere staaf; daarom is het bij de dakliggerlast groter dan de grootste *knoop*translatie van 0,09876 mm. De 3D-scène paste volledig in het canvas en kon tussen de belastinggevallen wisselen zonder cameraverplaatsing. Op deze testmachine telde de initiële scène 8 tekenopdrachten en circa 53 ms opbouw; de resultatenweergave telde 60 tekenopdrachten en circa 88 ms. Dit zijn diagnostische metingen, geen ontwerplimieten.

**Open verificatiepunt:** de gepinde Stabileo-knikroutine kan bij dit 235-staafsmodel een sparse-Cholesky-paniek geven doordat de matrixstructuur tijdens eigenwaarde-iteratie verandert. De onafhankelijke lineaire tests hebben knikanalyse daarom expliciet uit; de projectinstelling eerste orde wordt nu ook door de GUI gerespecteerd. De tweede-orde- en knikuitkomst voor dit model zijn nog niet geverifieerd. De adapter vangt de upstream-paniek af en weigert tweede orde als de stabiliteitscontrole faalt, maar de gewijzigde Rust-bron kon in deze omgeving niet opnieuw worden gebouwd omdat `cargo`/`rustc` ontbreken. Deze bescherming moet met een Rust-build en een GUI-herproef worden bevestigd voordat tweede orde voor dit model als betrouwbaar geldt. Het eerdere 104-staafsmodel heeft bovendien een afzonderlijk gedocumenteerde tweede-orde-reactieafwijking in [`groot-staalraam-verificatie.md`](groot-staalraam-verificatie.md).

Deze proef verifieert lineaire raamwerkrespons, globale statica, superpositie, opslag en resultaatweergave. Zij bewijst geen plaat- of volume-elementen en geen algemene staalnormtoetsing.
