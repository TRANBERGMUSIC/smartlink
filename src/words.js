/* LightLink – ord fra sangen (lokal tale-til-tekst med Whisper via transformers.js).
 * Kører helt på Mac'en. Første gang hentes modellen fra internettet (ca. 75–250 MB) og gemmes lokalt.
 */
'use strict';
let _tf = null, _pipe = null, _pipeId = null;
async function loadTransformers() {
  if (_tf) return _tf;
  _tf = await import('../node_modules/@huggingface/transformers/dist/transformers.min.js');
  _tf.env.allowLocalModels = false;
  _tf.env.backends.onnx.wasm.wasmPaths = new URL('../node_modules/@huggingface/transformers/dist/', location.href).href;
  return _tf;
}
// quality: 'fast' (whisper-base, god til engelsk) · 'good' (whisper-small, bedre til dansk)
async function getPipeline(quality, onProgress) {
  const id = quality === 'good' ? 'onnx-community/whisper-small' : 'onnx-community/whisper-base';
  if (_pipe && _pipeId === id) return _pipe;
  const tf = await loadTransformers();
  _pipe = await tf.pipeline('automatic-speech-recognition', id, {
    dtype: 'q8', device: 'wasm',
    progress_callback: (p) => { if (onProgress && p.status === 'progress') onProgress(p.progress / 100, p.file); },
  });
  _pipeId = id; return _pipe;
}
async function to16k(audioBuffer) {
  const len = Math.ceil(audioBuffer.duration * 16000);
  const oc = new OfflineAudioContext(1, len, 16000);
  const src = oc.createBufferSource(); src.buffer = audioBuffer; src.connect(oc.destination); src.start();
  const out = await oc.startRendering();
  return out.getChannelData(0);
}
// → [{ text, t (start s), end }]
async function transcribeWords(audioBuffer, { lang = 'da', quality = 'good', onProgress } = {}) {
  const pipe = await getPipeline(quality, onProgress);
  const pcm = await to16k(audioBuffer);
  if (onProgress) onProgress(1, 'transcribe');
  const res = await pipe(pcm, { language: lang, task: 'transcribe', return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
  const chunks = (res.chunks || []).filter((c) => c.timestamp && c.timestamp[0] != null);
  return chunks.map((c) => ({ text: c.text.trim().replace(/^[\s,.!?"'…-]+|[\s,.!?"'…-]+$/g, ''), t: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.4 })).filter((w) => w.text.length >= 2);
}
// vælg de ord der skal på laseren: ikke for tæt, helst korte/stærke ord, max N, mindst 4 s imellem
function pickKeyWords(words, max = 12) {
  const stop = new Set(['og', 'at', 'det', 'en', 'et', 'jeg', 'du', 'de', 'er', 'på', 'til', 'med', 'for', 'som', 'den', 'the', 'and', 'you', 'to', 'of', 'in', 'it', 'is', 'my', 'me', 'we', 'on', 'a', 'i', 'that', 'this', 'your', 'så', 'kan', 'der', 'har', 'ik', 'ikke', 'men', 'om', 'af', 'da', 'var', 'min', 'dig', 'mig', 'nu', 'oh', 'yeah', 'uh', 'ah']);
  const freq = {}; for (const w of words) { const k = w.text.toLowerCase(); freq[k] = (freq[k] || 0) + 1; }
  const scored = words.filter((w) => !stop.has(w.text.toLowerCase()) && w.text.length <= 10 && /^[\p{L}\p{N}' -]+$/u.test(w.text))
    .map((w) => ({ ...w, score: Math.min(freq[w.text.toLowerCase()], 4) * 2 + Math.min(w.text.length, 7) }))
    .sort((a, b) => b.score - a.score);
  const out = [];
  for (const w of scored) { if (out.length >= max) break; if (out.every((o) => Math.abs(o.t - w.t) > 4)) out.push(w); }
  return out.sort((a, b) => a.t - b.t);
}
