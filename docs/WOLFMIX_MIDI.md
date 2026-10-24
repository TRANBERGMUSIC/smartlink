# Wolfmix → SmartLink (MIDI)

Fanen **Wolfmix** lytter efter MIDI fra Wolfmix W1 MK3 og kører SmartLinks egne funktioner, når der trykkes på en knap. Der bruges ingen tastaturgenveje.

Kæden er: Wolfmix USB-A → ESI MIDIMATE eX → MIDI-kabel → Nektar MIDIFLEX 4 (In 1–2) → Mac via USB.

## Filer

| Fil | Indhold |
|---|---|
| `src/wolfmidi.js` | Tolker MIDI-bytes til signal og hændelse, holder knap-tilstand for CC, datamodellen og import fra Wolfmix Monitor. Indeholder ingen DOM-kode. |
| `test/wolfmidi.test.js` | Tests for tolkning, CC som knap, dispatch, Lær og import. Køres med `npm test`. |
| `src/actions.js` | Handlingsregistret `SL_ACTIONS`. Det er det eneste sted, hvor appens funktioner er samlet som handlinger. Handlingerne kalder de eksisterende funktioner, og de trinløse går gennem `wmRun` i app.js, så logikken ikke findes to steder. |
| `src/wolfpage.js` | Siden. Den bruger Web MIDI med hot-plug via `onstatechange` og gemmer i `localStorage` under nøglen `ls.wolfMidi`. |
| `src/main.js` | Giver MIDI-tilladelse (ikke sysex) og har IPC'en `wolfmon-import`, som læser `~/Library/Application Support/WolfmixMonitor/*.json`. |

## Signaler

Signal-id'erne er de samme som i Wolfmix Monitor. Kanal skrives 1–16.

| Signal-id | Hændelse |
|---|---|
| `note:<kanal>:<nr>` | Note On giver tryk. Note Off eller hastighed 0 giver slip. |
| `cc:<kanal>:<nr>` | Ændring (0–127, sendes videre som 0–1). CC'en kan også bruges som knap: over tærsklen (standard 64) er tryk, under er slip. |
| `pc:<kanal>:<nr>` | Tryk. |

MIDI Clock og Active Sensing ignoreres.

## Sikkerhed

**"Tænd laser"** viser stadig appens bekræftelse. Sluk og Tænd/sluk virker med det samme.

## SmartLink → Wolfmix (forberedt)

`sendNote(kanal, note, hastighed)` sender til MIDIFLEX-udgangen. Handlingen "Start Wolfmix-preset" sender den note, der står i `wmiState.out` (standard kanal 1, note 0).

Det kræver et kabel fra MIDIFLEX **Out 3** til MIDIMATE **IN** og en MIDI-mapping med In/Ch på Wolfmix. Der er ikke lavet en brugerflade til det endnu.

## Test

1. Åbn Wolfmix-fanen. Uden enhed vises de tre opkoblingstrin.
2. Klik **Simulér signal** og send Note, kanal 1, nr. 36. Der dukker en række op, som blinker.
3. Giv rækken et navn, og vælg fx "Næste mønster" under **Ved tryk**. Send igen, og mønstret skifter.
4. Vælg en funktion ved **Lær:**, og klik **Lær**. Tryk så på en knap på Wolfmix. Esc afbryder.
5. Genstart SmartLink. Navne og funktioner er der stadig.
6. Tag MIDIFLEX ud og sæt den i igen. Signalerne virker uden genstart.
