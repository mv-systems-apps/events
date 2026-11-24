# Events

Een editor voor het eventsbestand in de werkmap, met de configuratie in `events.json`.
Hobbyproject, gebouwd voor eigen gebruik. De afspraken die voor alle apps gelden, staan in
de repo apps-basis (`conventies.md`).

**Openen:** https://mv-systems-apps.github.io/events/

## Snelkoppelingen

Lang drukken op het icoon van de app toont deze opdrachten, als de app echt is
geïnstalleerd. Op Android is dat een installatie via Chrome: de app staat dan ook in de
lijst met apps. Edge op Android maakt een snelkoppeling naar de pagina (een icoon met het
Edge-logo) en toont de opdrachten dan niet; dat ligt aan Edge, niet aan de app.
Trends en Events werken het best in Edge.

Werkt lang drukken niet, maak dan per opdracht een eigen icoon met het adres, bijvoorbeeld
met MacroDroid (een macro die de website opent, met een snelkoppeling op het beginscherm)
of in Niagara:

| Opdracht | Adres |
|---|---|
| Vandaag | `https://mv-systems-apps.github.io/events/events.html?snel=dag` |
| Deze week | `https://mv-systems-apps.github.io/events/events.html?snel=week` |
| Nieuw event | `https://mv-systems-apps.github.io/events/events.html?snel=nieuw` |
| Zoeken | `https://mv-systems-apps.github.io/events/events.html?snel=zoeken` |

Zo'n adres kan in het losse venster van de app openen of in een gewoon browsertabblad; de
opdracht werkt in beide, met dezelfde gegevens. De app haalt `?snel=…` na het uitvoeren uit
het adres, zodat herladen de opdracht niet herhaalt.
