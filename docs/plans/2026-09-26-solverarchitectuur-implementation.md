# Solverarchitectuur — implementatieplan

## Stap 1 — contract en register

- Voeg neutrale TypeScript-typen toe voor voorkeuren, capaciteiten, descriptors en requests.
- Implementeer een deterministisch solverregister en capability-router.
- Registreer de bestaande Open FEM 2D-engine en een descriptor voor de externe 3D-kern met gecontroleerde beschikbaarheid.
- Test automatische selectie, handmatige selectie en foutmeldingen bij ongeschikte engines.

## Stap 2 — bewaarde instelling

- Voeg `solverPreference` toe aan de bestaande preferences-store.
- Voeg de tab **Rekenen** en de solverkeuze toe aan het instellingenscherm.
- Toon alleen geregistreerde engines en maak onbeschikbare engines herkenbaar.
- Voeg vertalingen toe voor Nederlands, Engels, Duits en Frans.

## Stap 3 — app-integratie

- Laad de voorkeur bij het opstarten.
- Geef de instelling door aan de analyse-aanroep en statusweergave.
- Houd `automatic` als veilige standaard voor bestaande installaties.

## Stap 4 — Rust-grens

- Voeg een Tauri-commandocontract toe dat engines en capaciteiten kan opvragen.
- Houd de externe kern achter een adapter met een geversioneerd JSON-contract.
- Pin de geteste upstream-commit en lever bron- en licentieverwijzingen mee.

## Stap 5 — verificatie

- Draai de TypeScript-build en relevante tests.
- Draai de Rust-workspacecontroles voor gewijzigde crates.
- Controleer de instellingen visueel in de actieve ontwikkelbuild.
- Leg resterende beperkingen vast, met name ontbrekende 3D-materiaal- en doorsnede-invoer vóór een echte solve-opdracht.
