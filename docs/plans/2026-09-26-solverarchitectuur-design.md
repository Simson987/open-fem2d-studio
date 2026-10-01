# Solverarchitectuur — ontwerp

## Besluit

Open FEM Studio ondersteunt een zichtbare solverkeuze in de algemene instellingen. De standaardwaarde is `automatic`. De eerste externe engine is een Rust-kern onder AGPL-3.0 (bron en revisie: `src-tauri/crates/open-fem-3d/Cargo.toml`). De solverlaag mag openbaar worden aangeboden onder AGPL.

## Doelen

- Een gebruiker kan een beschikbare solver kiezen en de keuze blijft bewaard.
- `automatic` selecteert een engine op basis van elementfamilie, dimensie en analysetype.
- Een handmatig gekozen engine wordt vooraf op capaciteiten gecontroleerd.
- De 2D- en 3D-werkruimten kennen geen leveranciersspecifieke invoertypen.
- Latere plaat- en volume-engines passen achter hetzelfde contract.
- Een resultaat vermeldt altijd de gevraagde en werkelijk gebruikte engine, versie en diagnostiek.

## Grenzen

De eerste wijziging maakt de instelling, het neutrale contract en de router beschikbaar. De bestaande 2D-berekening blijft via een adapter bereikbaar. De externe kern wordt als engine geregistreerd zodra de uitvoerbare adapter is meegebouwd; een engine die niet beschikbaar is verschijnt niet als bruikbare handmatige keuze.

## Contract

```text
SolverPreference
  automatic
  open-fem-legacy
  open-fem-3d

AnalysisRequest
  schemaVersion
  dimension
  analysisKind
  elementFamilies
  model
  settings

SolverDescriptor
  id, name, version, licence, availability
  dimensions, analyses, elementFamilies

AnalysisResult
  schemaVersion
  requestedSolver
  resolvedSolver
  provenance
  diagnostics
  payload
```

`SolverRegistry.resolve()` filtert eerst op beschikbaarheid en capaciteiten. Bij een handmatige keuze levert een mismatch een duidelijke fout op. In de automatische stand kiest de router de engine met de hoogste prioriteit voor alle gevraagde capaciteiten.

## Instellingen

De instellingen krijgen een tab **Rekenen**. Daar staat:

- solverkeuze;
- licentie en beschikbaarheidsstatus van de geselecteerde engine;
- korte uitleg over automatische selectie;
- een overzicht van ondersteunde dimensies, analysetypen en elementfamilies.

Alle teksten worden opgenomen in Nederlands, Engels, Duits en Frans.

## Scheiding van engines

De Open FEM-modeltypen blijven eigenaar van de data. Een engine-adapter zet het neutrale verzoek om naar het schema van een concrete solver. Hierdoor lekken kerntypen niet in projectbestanden of React-componenten.

Voor gemengde frame-, plaat- en volumemodellen kiest de router alleen een engine die de volledige combinatie gekoppeld kan assembleren. Twee onafhankelijke oplossingen mogen niet achteraf worden samengevoegd alsof zij één evenwichtstoestand vormen.

## Licentie

De externe kern is AGPL-3.0. De adapter registreert deze licentie zichtbaar. De solverbron wordt reproduceerbaar aan een vaste upstream-commit gekoppeld en de distributie krijgt de vereiste bron- en licentieverwijzingen. De app is daarom AGPL-3.0-or-later; de normtoetsingsbibliotheken blijven LGPL-3.0-or-later.
