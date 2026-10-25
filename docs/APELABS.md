# Lys: Ape Labs Neon Tube PIX (fanen "Lys")

Opsætningen er 6 rør på 2 etager med 3 rør hver, og alle styres via ÉN Ape Labs CONNECT. Etage 1 er rør 1–3, og etage 2 er rør 4–6. Hver etage kan styres for sig, eller begge samlet. Der kan styres fra appen, fra Wolfmix og fra to telefoner.

## Hardwarefakta, som designet bygger på

- CONNECT kører i én mode ad gangen: APP-mode (Bluetooth), DMX-transmitter eller DMX-receiver. I DMX-mode er CONNECT-appen låst.
- Én CONNECT sender ét univers til én Ape-gruppe. Derfor ligger begge etager i **gruppe 1** i SHOW-mode og adskilles på **DMX-adresse**.
- Antal kanaler pr. univers:

  | Mode | Kanaler i alt (6 rør) | Passer i ét univers (512)? |
  |---|---|---|
  | 64ch | 384 | ✔ (standard) |
  | 32ch | 192 | ✔ |
  | 7ch | 42 | ✔ |
  | 128ch | 768 | ✗ – afvises |

- Adresser ved 64ch: etage 1 = 1, 65, 129 og etage 2 = 193, 257, 321. Ved 7ch: 1, 8, 15 og 22, 29, 36.
- CONNECT sender intet tilbage, hverken batteri, link- eller DMX-status. Appen går derfor ud fra det, du vælger og bekræfter.

## To modes

### SHOW (CONNECT som DMX-transmitter, gruppe 1)

| Topologi | Signalvej | Hvordan appen styrer rørene |
|---|---|---|
| **A** (i dag) | Wolfmix XLR → CONNECT DMX IN | Indirekte: MIDI til Wolfmix. Gruppe A = etage 1, gruppe B = etage 2. Brightness sendes som CC til gruppedimmeren, farver som noter til Wolfmix-presets. |
| **B** | Wolfmix → Art-Net-node med DMX-IN → SmartLink → Art-Net-node → CONNECT | Merge af Wolfmix og appen. Ejerskab vælges pr. etage: Wolfmix ejer, App ejer eller Merge (HTP på farve og dimmer, LTP på strobe og musik). |
| **C** | SmartLink → Art-Net-node → CONNECT | Appen styrer alt. |

- DMX sendes kun i SHOW, og kun i topologi B og C, når "Send DMX" er slået til. Det sendes med 40 Hz på det univers, du vælger (laseren bruger univers 0).
- USB-DMX-bokse understøttes ikke endnu, fordi de kræver en driver. En Art-Net-node med XLR virker med det samme.

### LOUNGE (CONNECT i app-mode)

- Signalvejen er SmartLink → MIDI → CONNECT-appen → CONNECT → rør. CONNECT-appen kører på én tablet eller telefon.
  - Udgangen kan være Bluetooth-MIDI eller USB-MIDI til den enhed, der kører CONNECT-appen.
  - Kører CONNECT-appen på samme Mac, bruges IAC-driveren som udgang.
- Etagerne er her Ape-gruppe 1 og 2. Når du skifter mode, viser appen en checkliste og trinlisten til CONNECT-appen.
- Wolfmix kan ikke styre rørene i LOUNGE. Det vises tydeligt i appen.
- **MIDI-bro:** Hver CONNECT-handling får sin egen MIDI-besked, standard CC på kanal 16.
  - Bind-guiden sender beskederne én ad gangen, mens du trykker Learn i CONNECT-appen.
  - Tabellen kan eksporteres og importeres.
  - Brightness og Speed bruger selve CC-værdien.

## Hvad fanen kan

| Del | Indhold |
|---|---|
| **Kontrol** | Vælg etage 1, 2 eller begge (shift-klik for flere). Farver i mapper med drag-and-drop (højreklik for at redigere), RGB+WW-mixer, lysstyrke, speed, blackout og strobe (hold eller til/fra), pixel-effekter (Sparkle/Sweep/Cascade/Wave) og MusikMode. |
| **Programmer** | Op til 4 trin. Hvert trin er en farve eller blackout med fade- og hold-tid. Speed skalerer tiden. |
| **Scener** | Et snapshot pr. etage. Recall rører kun de etager, scenen er gemt med. |
| **Rør & patch** | Navn, etage, rækkefølge og vend pr. rør, samt DMX-mode og adresser. Kan eksportere trinliste til CONNECT-appen (SHOW og LOUNGE), Wolfmix-patchliste og Fixture Builder-opskrift. |
| **MIDI-bro** | Bindingstabel og bind-guide til CONNECT-appen, plus Wolfmix-mål for topologi A. |
| **Telefoner** | Ét link og en QR-kode pr. rolle (Etage 1 / Etage 2 / Alle) og "Lås etage til Wolfmix". |

Om enkelte funktioner:

- I 64ch er der ingen dimmer- eller strobe-kanal, så appen ganger dimmeren ind og laver strobe i software. Strobe-tiden følger Ape Labs' tabel.
- MusikMode "Lights" (lampens mikrofon) findes kun i 7ch. Til "CONNECT"-beat bruger appen sin egen beat i stedet (samme BPM som laseren), og det er tydeligt markeret.
- Følgende kan kun gøres i CONNECT-appen: pairing, service-mode, firmware, flicker-free, powersave, tyverialarm, cloud-sync, ekstern strøm og radar.

## Telefoner

- Rollen ligger i telefonens nøgle. Serveren sætter `_role`, så telefonen kan ikke selv vælge den.
- En etage-telefon kan kun styre sin egen etage og aldrig laseren.
- Sidste kommando vinder pr. etage. Det vises, hvem der ændrede sidst (app, f1, f2, all eller wolfmix).
- En etage, der er låst til Wolfmix, er read-only på telefonen.

## Wolfmix

Fanen Wolfmix har handlinger under "Lys (Ape Labs)":

- pr. etage og samlet: hold blackout, blackout til/fra, hold strobe, næste farve, næste effekt, lysstyrke og speed
- scene 1–8

## Filer

| Fil | Indhold |
|---|---|
| `src/ape_core.js` | Kernen som rene funktioner: fixture, strobe-tabel, adresseplan og eksport, program, scener, pixel-fx, render, merge, MIDI-bro, roller og mode. |
| `test/ape.test.js` | 27 tests: kanal-generatorer, adresseplan (afviser 768), strobe-tabel (monoton og round-trip), fade, scene-recall, merge, golden frame, MIDI-bindinger og roller. |
| `src/ape.js` | Fanen, DMX-loopet, MIDI ud og telefon-kommandoer. |
| `src/ape-remote.html` | Mobilsiden til telefonerne. |
