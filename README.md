# SmartLink

Mac-app til at styre en Laserworld DS-3000RGB MK5 (ShowNET) over Art-Net – uden Showcontroller og dongle.

- Hver ændring på `main` bygges automatisk til `SmartLink-Mac.zip` (se *Releases*).
- Appen tjekker selv efter nye versioner (Indstillinger → Opdateringer).

Udvikling: `npm install` → `npm start`. Byg: `npm run dist`.

## Vektor → laser

Tekst/tegninger til laser med SD-kort-eksport og DAC-backends: se [docs/LASER_PIPELINE.md](docs/LASER_PIPELINE.md). ShowNET-mappingen er beskrevet i [docs/SHOWNET.md](docs/SHOWNET.md).
