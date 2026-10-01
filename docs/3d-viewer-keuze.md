# 3D-viewer: editor, resultaten en IFC

## Keuze

De bestaande Three.js-scene blijft de 3D-editor en wordt later ook de viewer voor berekeningsresultaten. Knopen, staven, opleggingen en lasten moeten direct bewerkbaar blijven; een aparte BIM-renderer zou daarvoor een tweede scène en selectiepad introduceren. Three.js biedt selectie met [Raycaster](https://threejs.org/docs/pages/Raycaster.html), zichtbaarheid met [Layers](https://threejs.org/docs/pages/Layers.html), en bij grotere modellen minder tekenaanroepen met [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html) en eigen diagramgeometrie met [BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html). Die optimalisaties zijn pas nodig wanneer metingen aantonen dat de huidige afzonderlijke meshes te traag worden.

Het rekenmodel is de bron van waarheid. Elk object krijgt een stabiele model-ID; de viewer bewaart alleen een koppeling van ID naar renderobject en selectie. Camerastand, zichtbaarheid, kleuren en vergrotingsfactoren veranderen geen modelcoördinaten of berekeningswaarden. X en Y zijn horizontaal, Z is verticaal, ook bij IFC-uitwisseling.

## Resultaatlagen

Berekeningsresultaten komen in een afzonderlijke, getypeerde gegevenslaag per belastinggeval of combinatie. De viewer kan daaruit straks afzonderlijk tonen:

- ongewijzigde geometrie en een vervormde vorm met **zichtbaar vermelde schaalfactor**;
- knoopverplaatsingen en rotaties, plus oplegreacties;
- staafdiagrammen voor normaalkracht, twee dwarskrachten, torsie en twee buigmomenten;
- numerieke labels, eenheden, tekenconventies, legenda en extremen.

Deze lagen krijgen eigen zichtbaarheid en selectie. De vervormde vorm is uitsluitend een visualisatie; de oorspronkelijke geometrie blijft bewaard. Totdat een geverifieerde 3D-solver bestaat, toont de app **geen berekende 3D-uitslagen**. Voorbeeldwaarden of verificatiegevallen mogen niet als projectresultaat worden gepresenteerd.

## IFC en BIM

Gebruik de al aanwezige `@thatopen/components`/`@thatopen/fragments` voor het inladen en weergeven van grotere *fysieke* IFC/BIM-referentiemodellen naast het analytische raamwerk. Hun [IfcLoader](https://github.com/ThatOpen/engine_components/blob/main/packages/core/src/fragments/IfcLoader/index.ts) zet geometrie om naar Fragments; de [FragmentsManager](https://github.com/ThatOpen/engine_components/blob/main/packages/core/src/fragments/FragmentsManager/example.ts) gebruikt een worker voor grote modellen. Voor analytische IFC-entiteiten en relaties leest een aparte adapter de IFC-data via [web-ifc](https://github.com/ThatOpen/engine_web-ifc), want de standaardimport van IfcLoader neemt slechts een beperkte set attributen en relaties mee. De zichtbare BIM-mesh is dus geen betrouwbare bron voor knopen, opleggingen of lasten. Het oudere [web-ifc-three](https://github.com/ThatOpen/web-ifc-three) is door de makers verouderd verklaard.

De bestaande IFC4-exporter kan met een aparte 3D-mapping worden uitgebreid; IFC4.3 ADD2 is een tweede exportdoel zodra beide schema's zijn gevalideerd. [buildingSMART](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/ifcstructuralanalysisdomain/content.html) definieert een ruimtelijk analysemodel: `IfcStructuralAnalysisModel` met `LOADING_3D`, puntverbindingen voor knopen, curveleden voor staven, zes steunvrijheidsgraden en een `IfcStructuralLoadSingleForce` met Fx/Fy/Fz/Mx/My/Mz voor een nodale actie. Zie de specificaties voor [modeltype](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcAnalysisModelTypeEnum.htm), [knoop](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcStructuralPointConnection.htm), [staaf en lokale assen](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcStructuralCurveMember.htm), [oplegging](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcBoundaryNodeCondition.htm) en [kracht/moment](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcStructuralLoadSingleForce.htm). Leg bij export de gedeelde plaatsing, lokale staafassen, eenheden en tekenconventies expliciet vast. `GLOBAL_COORDS` betekent de assen van het analysemodel, die niet altijd gelijk zijn aan de projectwereldassen ([IfcStructuralPointAction](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcStructuralPointAction.htm)).

Na een echte berekening kan IFC [IfcStructuralResultGroup](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcStructuralResultGroup.htm) per lastgroep koppelen aan [puntreacties en verplaatsingen](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcStructuralPointReaction.htm) en eventueel [bemonsterde curvereacties](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcStructuralCurveReaction.htm). Gedetailleerde FE-topologie, spanningen en rekvelden vallen buiten de [IFC Structural Analysis Domain](https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/ifcstructuralanalysisdomain/content.html); bewaar die in het eigen resultatenformaat. Valideer IFC-export onafhankelijk met bijvoorbeeld [IfcOpenShell `validate --rules`](https://docs.ifcopenshell.org/autoapi/ifcopenshell/validate/index.html) en een semantische round-trip.

## Afgewogen alternatief

[xeokit](https://xeokit.github.io/xeokit-sdk/docs/) is sterk voor zeer grote, gegeorefereerde BIM-modellen en gecomprimeerde XKT-weergave. De eigen documentatie raadt directe browserimport van IFC alleen voor kleine tot middelgrote modellen aan ([WebIFCLoaderPlugin](https://xeokit.github.io/xeokit-sdk/docs/class/src/plugins/WebIFCLoaderPlugin/WebIFCLoaderPlugin.js~WebIFCLoaderPlugin.html)). Voor deze bewerkbare FEM-scene levert het geen duidelijk voordeel op boven de bestaande Three.js-stack. Bovendien heeft de SDK een [AGPL-3.0/commerciële licentie](https://github.com/xeokit/xeokit-sdk); een overstap vraagt daarom een aparte licentiebeoordeling.
