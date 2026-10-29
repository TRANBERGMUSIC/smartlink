# Vektor → laser (fanen "Vektor")

Tekst og tegninger bliver til laserpunkter, som sendes til én af flere output-backends. Preview viser **præcis** den punktliste der sendes eller eksporteres (efter optimering og int16-kvantisering).

```
design (lag, frames)  →  laser_frame.optimize()  →  quantize() int16  →  backend
 tekst / linje / firkant /   NN-sortering, blanking,     −1…1 → −32768…32767     SD-kort (.ild) · DMX · Ether Dream
 cirkel / frihånd            ankre, hjørne-dwell,        + intensitets-master    Helios · IDN · ShowNET-SDK
                             interpolation, budget
```

## Moduler

| Fil | Indhold | Test |
|---|---|---|
| `src/laser_frame.js` | single-stroke font (A–Z, 0–9, ÆØÅ, tegn), cirkel/bue/firkant/bézier, optimering, sikkerhed, kvantisering, `clipZone` | `test/laser_frame.test.js` |
| `src/ilda_io.js` | ILDA writer (format 4 og 5) og reader (0, 1, 2, 4, 5) | `test/ilda_io.test.js` |
| `src/backends/` | Ether Dream, Helios, IDN (stub), ShowNET-SDK (stub) – main-processen | `test/backends.test.js` |
| `src/vector.js` | fanen: tegneflade, lag, frames, preview, SD-pakke, live | – |

`npm test` kører alle tests. Læg en fil gemt fra Showeditor i `test/fixtures/` (fx `test/fixtures/showeditor.ild`), så testes det også at den kan læses.

## Optimering (Optimering-panelet)

- **NN-sortering**: stierne tegnes i nærmeste-nabo-rækkefølge, og åbne stier må vendes.
- **Blanket rejse** mellem stier med samme maks-trin, så scanneren når frem, før der tændes.
- **Ankre**: N blanke + N tændte punkter i start og slut (standard 3).
- **Hjørne-dwell**: ekstra punkter i hjørner, flere jo skarpere vinklen er (fra 30°).
- **Interpolation**: maks trin = 1,5 % af feltet (standard).
- **Punktbudget** = pps / fps. Ved for mange punkter forenkles der først (større trin), derefter sænkes fps. Begge dele står i statuslinjen.
- **Scanvinkel-derate**: store billeder får lavere effektiv pps. Laseren klarer 40 kpps ved 8°, men har 40° fuldt felt.
- Første og sidste punkt er altid blanket.

## Sikkerhed

- En frame med under 4 synlige punkter, eller mindre end "mindste størrelse", sendes ikke. I stedet sendes blanke punkter, så der aldrig står en statisk stråle.
- Intensitets-master skalerer alle farver.
- **Stop** lukker en software-shutter og sender blanke frames, før backend'en lukkes.
- Watchdog i backend'en: kommer der ingen frames fra appen i 0,5 s, blankes outputtet.
- Mistet forbindelse til DAC'en stopper output og vises med rødt.
- Blackout-knappen stopper også vektor-output.
- Ved live via DAC klippes punkter uden for den gemte projektionszone og under sikkerhedslinjen væk (blankes), fordi laserens egen zone ikke virker på ILDA-indgangen.

## Rute 1 – SD-kort (virker i dag, ingen ekstra hardware)

1. Design i fanen Vektor. Vælg **Kanal 2 =** (slot 1–255) og navn, og tryk **Læg i pakke**. Gentag for flere designs.
2. Tryk **Eksportér til SD**. Vælg en mappe, og den får `NNN.ild`-filer (format 5, flere frames = animation) og `SD-oversigt.csv` med kanal 2 og kanal 3 (fps) for hver fil. Filerne lægges også i appens mønstermappe, så LIVE kan vise dem.
3. Upload filerne til laserens SD-kort med **ShowNET Admin Tool** (eller kopiér dem direkte til kortet), og genstart laseren.
4. Afspil med ▶ i tabellen. Den sætter kanal 2 til slot-nummeret via den eksisterende DMX/Art-Net-mapping.

Punktbudgettet bruger SD-afspilningens scan speed (Indstillinger → kpps, i dag 20 kpps). Preview afspiller med den fps, kanal 3 giver.

## Rute 2 – Live via DAC (klar, men utestet)

En **DAC** er en lille boks, der laver computerens punkter om til ILDA-signal. Den sættes i laserens ILDA-indgang, og laseren skal stå i ILDA-mode.

- **Ether Dream** (netværk): bruger den åbne protokol (UDP 7654 discovery, TCP 7765). Tryk Find, vælg enheden og tryk **Send live**.
- **Helios** (USB): bruger det officielle SDK fra github.com/Grix/helios_dac.
  1. Kør `npm install koffi`.
  2. Læg `HeliosDacAPI.dll`, `libHeliosDacAPI.dylib` eller `.so` i `~/.smartlink/helios/`, eller angiv stien i `~/.smartlink/helios.json`: `{"lib": "…"}`.
- **IDN**: stub. Interfacet er klar til en implementering efter ILDA's IDN-Stream-spec.

Spejl X/Y findes kun her, fordi DAC-vejen går uden om laserens egne indstillinger.

## Rute 3 – ShowNET live over LAN (kræver SDK)

ShowNET's netværksprotokol er **ikke åben**, og den bliver ikke reverse-engineeret. Backend'en `shownet_sdk` er en stub med samme interface.

1. Søg om adgang til Laserworld/Showtacle SDK'et på https://www.laser-interface.com/en/sdk.
2. Læg licens og nøgler **uden for repoet** i `~/.smartlink/shownet-sdk.json`: `{ "lib": "/sti/til/sdk", "key": "…" }`.
3. Implementér `open/writeFrame/setShutter/close/discover` i `src/backends/shownet_sdk.js` med SDK'ets egne kald.

## Backend-interface

```
discover() → [{ id, name, … }]
open(opts)
writeFrame(points, pps)     // points: [{ x, y (int16), r, g, b (0–255), blank }]
setShutter(open: bool)
close()
```

Rendereren taler med backends via IPC: `out-discover`, `out-open`, `out-frame`, `out-shutter`, `out-close` og hændelsen `out-status` (`open`, `lost`, `estop`, `closed`). SD-pakken bruger `save-sd-package`.

## ILDA-format (som skrevet)

Filen er big-endian. Hver frame har en header på 32 bytes:

| Bytes | Indhold |
|---|---|
| 0–3 | `ILDA` |
| 4–6 | 0 |
| 7 | Formatkode |
| 8–15 | Navn |
| 16–23 | Firma |
| 24–25 | Antal records |
| 26–27 | Frame-nr |
| 28–29 | Antal frames |
| 30 | Projektor |
| 31 | 0 |

Records:

- **Format 5**: x, y (int16), status, B, G, R (8 bytes).
- **Format 4**: samme med z efter y (10 bytes).
- **Status**: 0x80 = sidste punkt, 0x40 = blank.

Filen slutter med en header med 0 records.

## Stråle-effekter (fanen "Effekter") og kombinerede mønstre

- `src/beams_core.js` laver beam-effekter som Vektor-dokumenter: Vifte, Sweep, Kryds, Bølge, Kegle, Jagt, Kaos (stråler = punkter med `dwell`) og Flade, Net (scannede linjer = lysflader). Farver: regnbue, flydende, to farver, én farve, hvid.
- Effekterne går gennem samme `optimize` → ILDA → SD-pakke som Vektor. "Lav hele sættet" lægger 9 effekter × 3 farver i pakken fra det valgte slot (numre, der allerede er mønstre på laseren, springes over).
- Previewet "I luften" er en simulering af strålerne i røg. "Punkter" viser selve punkterne i feltet.
- I Vektor kan værktøjet **Mønster** lægge laserens eksisterende mønstre (fra mønstermappen) ind med plads, størrelse og drejning. Flere mønstre kan kombineres til ét nyt, og animerede mønstre kører med.
- Stråler skal være over publikum. Brug laserens sikkerhedszone, og kør med hazer.
