// ShowNET live over LAN – ADAPTER-STUB til Laserworlds officielle SDK.
// ShowNET-protokollen er IKKE åben, og den bliver ikke reverse-engineeret her. Live-billeder over netværket kræver
// SDK'et fra https://www.laser-interface.com/en/sdk (kontakt Laserworld / Showtacle for adgang og licens).
// Nøgler/licens ligger UDEN FOR repoet:  ~/.smartlink/shownet-sdk.json   fx { "lib": "/sti/til/sdk-bibliotek", "key": "…" }
// Når SDK'et er på plads, implementeres open/writeFrame/… her med SDK'ets egne kald – resten af appen er allerede klar.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const CFG = path.join(os.homedir(), '.smartlink', 'shownet-sdk.json');

function config() { try { return JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch (_) { return null; } }
function create(onStatus) {
  const need = () => { const c = config(); return !c ? 'ShowNET-SDK mangler: få adgang via laser-interface.com/en/sdk og læg nøglen i ' + CFG : !c.lib || !fs.existsSync(c.lib) ? 'ShowNET-SDK-biblioteket blev ikke fundet (sæt "lib" i ' + CFG + ')' : 'ShowNET-SDK fundet, men adapteren er ikke skrevet endnu'; };
  return {
    id: 'shownet_sdk', configPath: CFG,
    discover: async () => [{ id: '', name: need(), error: true }],
    open: async () => { throw new Error(need()); },
    writeFrame: () => {}, setShutter: () => {}, close: () => onStatus && onStatus({ backend: 'shownet_sdk', state: 'closed' }),
  };
}
module.exports = { create, config, CFG };
