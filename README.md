# Midi to Guitar Chords

En webbapp som läser in en MIDI-fil och omvandlar den till gitarrackord med notbild och greppdiagram. Körs helt i webbläsaren – ingen server behövs.

## Användning

1. Öppna `song_notation_app.html` i en webbläsare.
2. Dra en `.mid`/`.midi`-fil till uppladdningsytan, eller klicka för att välja fil.
3. Appen analyserar MIDI-datan och visar ackorden som en notrad med gitarrgreppdiagram.
4. Klicka på ett greppdiagram för att byta till alternativa grepp.
5. Klicka på ett ackordnamn i notbilden för att byta ut ackordet helt.
6. Ange en låttitel och spara notationen som PDF.

## Funktioner

- **MIDI-tolkning** – Läser format 0 och 1, hanterar running status och VLQ-delta-tider.
- **Ackorddetektering** – Grupperar noter per taktslag och matchar mot 23 ackordmallar. Använder [TonalJS](https://github.com/tonaljs/tonal) om tillgängligt, annars intern poängbaserad matchning.
- **Notbild på canvas** – Visar diskant- och basklav med noter, ackordnamn och greppdiagram i en skalbar canvas med DPI-korrekt rendering.
- **Alternativa grepp** – Klicka ett greppdiagram för att välja bland alla positioner från [chords-db](https://github.com/tombatossals/chords-db).
- **Ackordväljare** – Välj grundton, ackordtyp, spänningar och baston manuellt för att ersätta ett ackord.
- **PDF-export** – Sparar hela notbilden som en PDF via webbläsarens utskriftsdialog.

## Beroenden (CDN)

Laddas automatiskt vid start – inga installationssteg krävs.

| Bibliotek | Syfte |
|---|---|
| `@tombatossals/chords-db` | Databas med gitarrgrepppositioner |
| `tonal` | Musikteorianalys och ackorddetektering |

## Exempelfiler

- `chordtest.midi` – Enkel fil för att testa ackorddetekteringen.
- `fireworks.midi` – Mer komplex fil för att testa flerstämmig tolkning.

## Teknisk översikt

```
song_notation_app.html
├── MIDI-parser       parseMIDI()      – Binär byte-för-byte-tolkning
├── Ackordanalys      buildChords()    – Grupering + bestChordMatch()
├── Canvasritning     render()         – Notrad, klavar, greppdiagram
├── Greppmodal        openModal()      – Alternativa positioner
└── Ackordväljare     openPicker()     – Manuellt byte av ackord
```

Hela applikationen är en enda HTML-fil utan byggsteg.
