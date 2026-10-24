// wolfmidi.js – Wolfmix W1 MK3 → MIDI → SmartLink. Rene funktioner (ingen DOM): tolkning af MIDI-bytes,
// knap-tilstand for CC, datamodel (signals/bindings) og import fra "Wolfmix Monitor". Testes i test/wolfmidi.test.js.
// Signal-id'er er de samme som Wolfmix Monitor bruger: note:<kanal>:<nr>, cc:<kanal>:<nr>, pc:<kanal>:<nr> (kanal 1–16).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WolfMidi = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TYPES = { note: 'note', cc: 'cc', pc: 'pc' };

  // rå bytes → { id, type, channel, number, event: 'press'|'release'|'change', value } eller null
  function parse(bytes) {
    const st = bytes[0] | 0, d1 = (bytes[1] | 0) & 0x7f, d2 = (bytes[2] | 0) & 0x7f;
    if (st >= 0xf0) return null; // clock 0xF8, active sensing 0xFE og alt andet system-realtime/common ignoreres
    const kind = st & 0xf0, channel = (st & 0x0f) + 1;
    const mk = (type, number, event, value) => ({ id: `${type}:${channel}:${number}`, type, channel, number, event, value });
    if (kind === 0x90) return d2 > 0 ? mk('note', d1, 'press', d2) : mk('note', d1, 'release', 0);
    if (kind === 0x80) return mk('note', d1, 'release', 0);
    if (kind === 0xb0) return mk('cc', d1, 'change', d2);
    if (kind === 0xc0) return mk('pc', d1, 'press', 127);
    return null;
  }
  function parseId(id) { const m = /^(note|cc|pc):(\d{1,2}):(\d{1,3})$/.exec(String(id)); return m ? { type: m[1], channel: +m[2], number: +m[3] } : null; }
  function toBytes(type, channel, number, value) { // til "Simulér signal" og sendNote
    const ch = (Math.max(1, Math.min(16, channel | 0)) - 1), n = number & 0x7f, v = value & 0x7f;
    if (type === 'note') return v > 0 ? [0x90 | ch, n, v] : [0x80 | ch, n, 0];
    if (type === 'cc') return [0xb0 | ch, n, v];
    if (type === 'pc') return [0xc0 | ch, n];
    return null;
  }

  function newState() { return { signals: {}, bindings: {}, active: true }; }
  // CC som knap: press når værdien krydser op over tærsklen, release når den krydser ned under (tilstand pr. signal)
  function ccEdges(ccState, id, value, threshold = 64) {
    const was = !!ccState[id], now = value >= threshold; ccState[id] = now;
    return now && !was ? 'press' : !now && was ? 'release' : null;
  }
  // registrér et signal i datamodellen (navn bevares), returnerer true hvis det er nyt
  function record(state, ev, when) {
    const s = state.signals[ev.id], isNew = !s;
    const rec = s || (state.signals[ev.id] = { name: '', type: ev.type, channel: ev.channel, number: ev.number, lastValue: 0, count: 0, lastSeen: null });
    rec.lastValue = ev.value; rec.count = (rec.count | 0) + 1; rec.lastSeen = when || new Date().toISOString().slice(0, 19);
    return isNew;
  }
  // én MIDI-besked → liste af handlinger der skal køres: [{ action, value? }]
  function dispatch(state, ccState, ev) {
    const b = state.bindings[ev.id]; if (!b) return [];
    const out = [];
    if (ev.type === 'cc') {
      if (b.onChange) out.push({ action: b.onChange, value: ev.value / 127, slot: 'onChange' });
      const edge = ccEdges(ccState, ev.id, ev.value, b.threshold ?? 64);
      if (edge === 'press' && b.onPress) out.push({ action: b.onPress, slot: 'onPress' });
      if (edge === 'release' && b.onRelease) out.push({ action: b.onRelease, slot: 'onRelease' });
    } else {
      if (ev.event === 'press' && b.onPress) out.push({ action: b.onPress, slot: 'onPress' });
      if (ev.event === 'release' && b.onRelease) out.push({ action: b.onRelease, slot: 'onRelease' });
      if (ev.event === 'press' && b.onChange) out.push({ action: b.onChange, value: ev.value / 127, slot: 'onChange' }); // fx anslagsstyrke → dimmer
    }
    return out;
  }
  function bind(state, id, slot, action) {
    const b = state.bindings[id] || (state.bindings[id] = { onPress: null, onRelease: null, onChange: null, threshold: 64 });
    b[slot] = action || null; return b;
  }
  // Lær: kan denne hændelse bruges til handlingen? trigger → tryk (eller CC der krydser op), continuous → ændring
  function learnSlot(kind, ev) {
    if (kind === 'continuous') return ev.type === 'cc' || ev.type === 'note' ? 'onChange' : null;
    if (ev.type === 'cc') return ev.value >= 64 ? 'onPress' : null;
    return ev.event === 'press' ? 'onPress' : null;
  }
  // import fra Wolfmix Monitor: triggers.json {id:{label}} og signals.json {id:{type,channel,number,last_value,count,last_seen}}
  function importMonitor(state, triggers, signals) {
    let names = 0, sigs = 0;
    const ensure = (id, src) => {
      const p = parseId(id); if (!p) return null;
      return state.signals[id] || (state.signals[id] = { name: '', type: (src && src.type) || p.type, channel: (src && +src.channel) || p.channel, number: (src && src.number != null ? +src.number : p.number), lastValue: 0, count: 0, lastSeen: null });
    };
    for (const [id, s] of Object.entries(signals || {})) { const r = ensure(id, s); if (!r) continue; sigs++; if (s.last_value != null) r.lastValue = +s.last_value; if (s.count != null) r.count = Math.max(r.count | 0, +s.count | 0); if (s.last_seen) r.lastSeen = String(s.last_seen); }
    for (const [id, tr] of Object.entries(triggers || {})) { const r = ensure(id); if (!r || !tr || !tr.label) continue; r.name = String(tr.label); names++; }
    return { names, signals: sigs };
  }
  function sanitize(obj) { const s = newState(); if (obj && typeof obj === 'object') { if (obj.signals && typeof obj.signals === 'object') s.signals = obj.signals; if (obj.bindings && typeof obj.bindings === 'object') s.bindings = obj.bindings; if (obj.active === false) s.active = false; } return s; }
  return { TYPES, parse, parseId, toBytes, newState, ccEdges, record, dispatch, bind, learnSlot, importMonitor, sanitize };
});
