/* ═══════════════════════════════════════════════════════════════
   Lurveta · Temas visuales
   ───────────────────────────────────────────────────────────────
   Se carga en <head>, ANTES de pintar, para que no parpadee:
     • <html data-tema="cyber"> por defecto (localStorage 'ug_tema').
     • El tema cyber carga sus fuentes (Orbitron, Space Grotesk, JetBrains
       Mono) y una capa de líneas de escaneo.
     • window.UGTema.set('cyber' | 'clasico') cambia de tema y avisa con el
       evento 'ug:tema' (para la música de fondo y los temas que se
       compren con UpCoins más adelante).
     • En la biblioteca añade "Tema" al menú rápido (orbe del encabezado).
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const TEMAS = { cyber: 'Cyber (neón)', clasico: 'Clásico' };
  const leer = () => { try { const t = localStorage.getItem('ug_tema'); return TEMAS[t] ? t : 'cyber'; } catch (_) { return 'cyber'; } };
  const html = document.documentElement;

  function fuentes() {
    if (document.getElementById('cb-fuentes')) return;
    const l = document.createElement('link');
    l.id = 'cb-fuentes'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800;900&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap';
    document.head.appendChild(l);
  }
  function escaneo(on) {
    let s = document.getElementById('cb-scan');
    if (on && !s && document.body) { s = document.createElement('div'); s.id = 'cb-scan'; s.className = 'cb-scan'; s.setAttribute('aria-hidden', 'true'); document.body.appendChild(s); }
    if (!on && s) s.remove();
  }
  function aplicar(t) {
    html.dataset.tema = t;
    if (t === 'cyber') fuentes();
    escaneo(t === 'cyber');
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'cyber' ? '#05030D' : '#0A0B0F');
  }
  function set(t) {
    if (!TEMAS[t]) return;
    try { localStorage.setItem('ug_tema', t); } catch (_) {}
    aplicar(t);
    window.dispatchEvent(new CustomEvent('ug:tema', { detail: t }));
  }

  // Modo claro / oscuro de las tarjetas y la ficha (independiente del tema cyber/clásico).
  // <html data-modo="oscuro|claro">, localStorage 'ug_modo'. Lo usa lurveta-cards.css.
  const MODOS = { oscuro: 'Oscuro', claro: 'Claro' };
  const leerModo = () => { try { const m = localStorage.getItem('ug_modo'); return MODOS[m] ? m : 'oscuro'; } catch (_) { return 'oscuro'; } };
  function setModo(m) {
    if (!MODOS[m]) return;
    try { localStorage.setItem('ug_modo', m); } catch (_) {}
    html.dataset.modo = m;
    window.dispatchEvent(new CustomEvent('ug:modo', { detail: m }));
  }

  aplicar(leer());
  html.dataset.modo = leerModo();
  document.addEventListener('DOMContentLoaded', () => {
    escaneo(html.dataset.tema === 'cyber');
    // Botón en el menú rápido de la biblioteca (si existe); si no, en Ajustes del perfil
    const radial = document.querySelector('#hdr-radial .ugr-items'), ajustes = document.getElementById('pf-menu-aj');
    if (!radial && ajustes && !document.getElementById('ug-tema-btn')) {
      const b = document.createElement('button');
      b.id = 'ug-tema-btn'; b.type = 'button'; b.setAttribute('role', 'menuitem');
      const pintar = () => { const c = html.dataset.tema === 'cyber'; b.innerHTML = `<ion-icon name="${c ? 'contrast-outline' : 'flash-outline'}"></ion-icon><span><b>${c ? 'Tema clásico' : 'Tema cyber'}</b><small>Cambia el estilo de Lurveta</small></span>`; };
      pintar();
      b.addEventListener('click', () => {
        window.pfMenuCerrar?.();
        set(html.dataset.tema === 'cyber' ? 'clasico' : 'cyber'); pintar();
        try { window.toast?.(html.dataset.tema === 'cyber' ? '⚡ Tema Cyber activado' : '🌙 Tema clásico activado'); } catch (_) {}
      });
      ajustes.insertBefore(b, ajustes.querySelector('.peligro'));
    }
    if (radial && !document.getElementById('ug-tema-btn')) {
      const b = document.createElement('button');
      b.id = 'ug-tema-btn'; b.type = 'button'; b.className = 'ugr-item ug-tema-btn'; b.setAttribute('role', 'menuitem');
      const pintar = () => { const c = html.dataset.tema === 'cyber'; b.setAttribute('aria-label', c ? 'Cambiar al tema clásico' : 'Cambiar al tema cyber'); b.innerHTML = `<span class="ugr-bub"><ion-icon name="${c ? 'contrast-outline' : 'flash-outline'}"></ion-icon></span><span class="ugr-lbl">${c ? 'Clásico' : 'Cyber'}</span>`; };
      pintar();
      b.addEventListener('click', e => {
        e.stopPropagation(); window.UGR?.cerrar?.();
        set(html.dataset.tema === 'cyber' ? 'clasico' : 'cyber'); pintar();
        try { window.toast?.(html.dataset.tema === 'cyber' ? '⚡ Tema Cyber activado' : '🌙 Tema clásico activado'); } catch (_) {}
      });
      radial.appendChild(b);
    }
    // Interruptor claro/oscuro: junto al «01 / DISCOVER» del inicio (lo crea lurveta-liquid.js,
    // que es defer y ya corrió). Si la portada Discovery no está, va al menú rápido.
    if (!document.getElementById('ug-modo-btn')) {
      const intro = document.querySelector('.lv-home-intro'), marca = intro?.querySelector('.lv-intro-mark');
      const enIntro = !!(intro && marca);
      if (enIntro || radial) {
        const b = document.createElement('button');
        b.id = 'ug-modo-btn'; b.type = 'button';
        b.className = enIntro ? 'ug-modo-btn' : 'ugr-item ug-modo-btn';
        if (!enIntro) b.setAttribute('role', 'menuitem');
        const pintar = () => {
          const claro = html.dataset.modo === 'claro', ico = claro ? 'moon-outline' : 'sunny-outline';
          b.setAttribute('aria-label', claro ? 'Cambiar al modo oscuro' : 'Cambiar al modo claro');
          b.innerHTML = enIntro ? `<ion-icon name="${ico}" aria-hidden="true"></ion-icon>` : `<span class="ugr-bub"><ion-icon name="${ico}"></ion-icon></span><span class="ugr-lbl">${claro ? 'Oscuro' : 'Claro'}</span>`;
        };
        pintar();
        b.addEventListener('click', e => {
          e.stopPropagation(); if (!enIntro) window.UGR?.cerrar?.();
          setModo(html.dataset.modo === 'claro' ? 'oscuro' : 'claro'); pintar();
          try { window.toast?.(html.dataset.modo === 'claro' ? '☀️ Modo claro activado' : '🌙 Modo oscuro activado'); } catch (_) {}
        });
        if (enIntro) {
          const lado = document.createElement('div'); lado.className = 'lv-intro-side';
          marca.replaceWith(lado); lado.append(marca, b);
        } else radial.appendChild(b);
      }
    }
  });
  window.UGTema = { set, get: () => html.dataset.tema, TEMAS, setModo, getModo: () => html.dataset.modo, MODOS };
})();
