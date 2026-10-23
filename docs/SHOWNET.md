# ShowNET-mapping i SmartLink

Alt hvad der går til laseren laves i `src/shownet.js` (rene funktioner, ingen DOM). Testene ligger i `test/shownet.test.js` og køres med `npm test`.

- `encode(state, profile, mode)` → DMX-frame (34 kanaler i Pro, 19 i DJ, heltal 0–255)
- `decode(frame, profile, mode)` → hvad laseren faktisk gør: position `x, y` (−1…1 af feltet), størrelse X/Y, rotation, fps, inversion, `visible`
- `transformPoint(px, py, decoded, profile)` → et ILDA-punkt gennem firmwarens kæde (se nedenfor)
- `decode(encode(s)) == s` inden for kvantisering (position 1/4096, størrelse 1/255) er testet.

**Én sandhedskilde:** DMX-loopet (`startSending`, `cfg.rate` Hz, maks ~44 Hz) laver en frame, gemmer den (`captureFrame`) og sender den. LIVE tegner KUN fra `decode(sidst sendte frame)`, og ILDA-animationer afspilles med den fps kanal 3 giver.

## Professional Mode (34 kanaler) – standard

| Kanal | Funktion |
|---|---|
| 1 | Intensitet (0 = slukket, 1–255) |
| 2 | Mønster (0 = blackout, N = N.ild) |
| 3 | Framerate: 0–127 = 0→50 fps, 128 = 50 fps, 129–255 = 50→100 fps |
| 4 / 5 | Position X coarse/fine (0 = venstre, 128 = midt, 255 = højre) |
| 6 / 7 | Position Y coarse/fine (0 = bund, 128 = midt, 255 = top) |
| 8 / 9 | Rotation coarse/fine (128 = 0°) |
| 10 / 11 | Størrelse X / Y (0 = MAKS, 255 = mindst – inverteret) |
| 12 | Inversion: 0–63 ingen, 64–127 X, 128–191 Y, 192–255 X+Y |
| 13 | Farve: 0–15 original, 16–207 fast, 208–223 hvid halv, 224–239 hvid fuld, 240–255 RGB fra 14–16 |
| 14–16 | R, G, B |
| 17 | Strobe (0–15 ingen) |
| 18 | Scan speed (0–15 default) |
| 19 | Sikkerhedszone: 0–63 bund, 64–127 top, 128–191 venstre, 192–255 højre. Målt: laserens bund-område (0–63) ligger fysisk i toppen, så appen bruger 64–127 til en zone nedefra; højere værdi = større zone |
| 20 | Lys i zonen: 0 = fuld, 255 = intet |
| 21–23 | Farvebalance R/G/B: **0 = maksimum, 255 = intet lys** |
| 24–25 | Setup/Save – sendes altid 0 |
| 26–29 | Geometrisk korrektion (128) |
| 30–34 | Reserveret – sendes 0 |

Position: `pos16 = coarse·256 + fine`, `u = (pos16 − 32768) / 32768`, kvantiseret til 4096 trin (16 DMX-trin pr. scanner-trin).

## DJ Mode (19 kanaler)

| Kanal | Funktion |
|---|---|
| 1 / 2 | Intensitet / mønster |
| 3 | Framerate: 0–15 = 50 fps, 16–255 = 0→100 fps |
| 4 | Størrelse: 0–127 X+Y sammen (0 = fuld), 128–191 kun X, 192–255 kun Y |
| 5 | Auto size (0) |
| 6 | Rotation: 0–192 manuel, 193–224 auto mod uret, 225–255 auto med uret |
| 7 / 8 | Position X coarse/fine ("0 = midt") |
| 9 / 10 | Position Y coarse/fine |
| 11–12 | Farveeffekter (0 = original) |
| 13 | Strobe |
| 14 | Operation mode – SKAL være 0 (20+ = auto-bevægelse) |
| 15 | Scan speed |
| 16 / 17 | Sikkerhedszone størrelse / intensitet |
| 18 / 19 | Blanking / blankshift |

DJ-position er ikke dokumenteret ud over "0 = midt". Profilen vælger model, og kalibreringen afgør den: `s` (fortegn + udslag), `h1` (wrap/signed), `h2` (ensidig), `u` (128 = midt). `posGainX/Y` er hvor stor en del af feltet fuldt signal flytter.

## Transformationskæden (i firmwarens rækkefølge)

1. ILDA-punkt (−1…1)
2. skalér om ILDA-origo (størrelse X/Y fra kurven)
3. rotér om origo
4. læg position til
5. inversion (spejler også positionen)
6. klem (`clamp`) eller klip (`clip`) til ±1 – afgøres i kalibreringen
7. gemt projektionszone (venstre/højre/bund/top som brøk af feltet)
8. sikkerhedszone
9. fysisk vinkel: `vinkel = u · scanvinkel/2`, afstand på væg: `D · tan(vinkel)`

Skalering og rotation sker om ILDA-origo, ikke om mønstrets egen midte. Appen kompenserer selv (`patCenterFix`), så mønstrets midte lander dér hvor du placerer det.

## Laserprofil

Gemmes i indstillingerne og som `~/Desktop/SmartLink/laser-profile.json` (knap i kalibreringens trin 7). Testene læser filen og tjekker at previewet matcher målingerne.

Felter: `model, mode, scanDegX/Y, throwM, posModel, signX/Y, posGainX/Y, sizeCurve {pro, dj}, dmxMinVisible {pro, dj}, rotDegPerStep, rotSign, clipMode, zone {l, r, b, t}, measurements`.

## Kalibrering (Værktøjer → 📏 Kalibrering (ShowNET))

1. Grundbillede: kanal 1 = 200, et mønster der fylder hele feltet, effekter 0, fuld størrelse, midt.
2. Mål bredde W, højde H og afstand D → scanvinkel.
3. Position: send coarse-værdierne, mål midtpunktet i cm → model, fortegn og udslag.
4. Størrelse: send værdierne, mål bredden (eller "slukket") → kurve og mindste synlige størrelse.
5. Rotation: send værdierne, mål vinklen → grader pr. trin og retning.
6. Klipning: klemmes eller klippes mønstret ved kanten?
7. Gemt projektionszone og afstand → gem profil-fil.

Sliderens 0–100 % går fra mindste synlige størrelse til fuld størrelse; en værdi under minimum kan ikke sendes, og LIVE viser en rød kant hvis laseren slukker pga. minimumsstørrelsen.
