/* ═══════════════════════════════════════════════════════════════
   UpGames · Acortador de anuncios (Cuty.io)

   El enlace final de una descarga pasa por Cuty (anuncios que pagan a
   UpGames) salvo con Premium o cuando viene de un blog sin monetizar.
   Genera el mismo enlace que su script de página completa (cdn.cuty.io/fps.js:
   https://cuty.io/fps?token=…&data=base64(rot13(url))), pero solo para el
   botón de descarga, sin cargar un script de terceros que reescriba la página.
   Lo usan puente.html (window.UGCuty) y el servidor (require()).
   ═══════════════════════════════════════════════════════════════ */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else raiz.UGCuty = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TOKEN = '8e33fae42bd0348823959f775';
  // Nunca se acortan enlaces de UpGames (descargas oficiales, la propia web) ni los que ya son de Cuty
  const PROPIOS = /(^|\.)(upgames\.games|up\.railway\.app|cuty\.io|cuttty\.com)$/i;

  const rot13 = s => s.replace(/[a-z]/gi, c => String.fromCharCode(c.charCodeAt(0) + (c.toLowerCase() < 'n' ? 13 : -13)));
  const base64 = s => typeof btoa === 'function'
    ? btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    : Buffer.from(s, 'utf8').toString('base64');

  /** ¿Se puede acortar? Solo enlaces http(s) válidos que no son de UpGames ni de Cuty. */
  function aplica(url) {
    try { const u = new URL(url); return /^https?:$/.test(u.protocol) && !PROPIOS.test(u.hostname); } catch (_) { return false; }
  }
  /** Enlace con anuncios de Cuty, o el mismo enlace si no aplica. */
  function enlace(url) {
    return aplica(url) ? `https://cuty.io/fps?token=${TOKEN}&data=${base64(rot13(String(url)))}` : url;
  }
  return { TOKEN, aplica, enlace, rot13 };
});
