// IDN (ILDA Digital Network, åben ILDA-standard, UDP 7255) – STUB.
// Interfacet er på plads, så en IDN-modtager (fx et IDN-til-ILDA-interface) kan tilføjes senere efter den officielle IDN-Stream-spec.
'use strict';
function create(onStatus) {
  const msg = 'IDN er ikke implementeret endnu – brug SD-kort eller Ether Dream';
  return {
    id: 'idn',
    discover: async () => [{ id: '', name: msg, error: true }],
    open: async () => { throw new Error(msg); },
    writeFrame: () => {}, setShutter: () => {}, close: () => onStatus && onStatus({ backend: 'idn', state: 'closed' }),
  };
}
module.exports = { create };
