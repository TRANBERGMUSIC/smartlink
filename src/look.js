/* SmartLink · udseende: "apple" (CENTRA-stil, standard) eller "terminal" (5.9). Sættes før siden tegnes, så der ikke blinker. */
'use strict';
(() => {
  const KEY = 'ls.look', get = () => { try { return localStorage.getItem(KEY) || 'apple'; } catch (e) { return 'apple'; } };
  const apply = (v) => { document.documentElement.classList.toggle('th-apple', v === 'apple'); document.documentElement.classList.toggle('th-terminal', v !== 'apple');
    document.querySelectorAll('#lookSeg button').forEach((b) => b.classList.toggle('active', b.dataset.look === v)); };
  apply(get());
  window.slSetLook = (v) => { try { localStorage.setItem(KEY, v); } catch (e) {} apply(v); requestAnimationFrame(() => window.dispatchEvent(new Event('resize'))); };
  document.addEventListener('DOMContentLoaded', () => { apply(get()); document.querySelectorAll('#lookSeg button').forEach((b) => { b.onclick = () => window.slSetLook(b.dataset.look); }); });
})();
