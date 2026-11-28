/* Discovery 02: progressive enhancement; never replaces the existing search or navigation handlers. */
(() => {
  'use strict';
  const body = document.body, header = document.getElementById('app-header');
  const nav = document.getElementById('bottom-nav'), main = document.getElementById('main-view');
  const search = header?.querySelector('.search-bar:not(.editorial-search)');
  const input = document.getElementById('buscador');
  if (!body || !header || !nav || !main || !search || !input || document.getElementById('lv-search-toggle')) return;
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.id = 'lv-search-toggle'; toggle.className = 'lv-search-toggle';
  toggle.setAttribute('aria-label','Abrir búsqueda'); toggle.setAttribute('aria-expanded','false');
  search.id ||= 'lv-library-search'; toggle.setAttribute('aria-controls',search.id);
  toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.3 4.3"/></svg>';
  header.insertBefore(toggle, header.querySelector('.hdr-actions'));
  const intro = document.createElement('div'); intro.className = 'lv-home-intro';
  intro.innerHTML = '<div><div class="lv-eyebrow">Lurveta / Explorar</div><p class="lv-intro-title">Tu próximo<br>descubrimiento.</p></div><span class="lv-intro-mark" aria-hidden="true">01 /<br> DISCOVER</span>';
  const row = document.getElementById('category-row'); if (row) main.insertBefore(intro,row);
  body.classList.add('lv-discovery');
  let opened=false, last=Math.max(0,scrollY), delta=0, frame=0;
  const isHome = () => !body.dataset.tab || body.dataset.tab === 'main';
  const showChrome = () => { body.classList.remove('lv-chrome-hidden'); };
  function setSearch(open, focus=false) {
    opened=!!open && isHome(); body.classList.toggle('lv-search-open',opened);
    toggle.setAttribute('aria-expanded',String(opened)); toggle.setAttribute('aria-label',opened?'Cerrar búsqueda':'Abrir búsqueda');
    // visibility:hidden also keeps hidden descendants out of sequential keyboard focus.
    if (opened) { showChrome(); if(focus) requestAnimationFrame(()=>input.focus({preventScroll:true})); }
    else if (search.contains(document.activeElement)) { document.activeElement.blur(); if(focus) toggle.focus({preventScroll:true}); }
  }
  toggle.addEventListener('click',()=>setSearch(!opened,true));
  document.addEventListener('keydown', e=>{ if(e.key==='Escape' && opened) { e.preventDefault(); setSearch(false,true); } });
  document.addEventListener('pointerdown',e=>{ if(opened && !search.contains(e.target) && !toggle.contains(e.target)) setSearch(false); });
  function syncTab() { body.classList.toggle('lv-home',isHome()); setSearch(false); showChrome(); last=Math.max(0,scrollY);delta=0; }
  window.addEventListener('ug:tab',syncTab); syncTab();
  // Keep modal/radial and keyboard navigation reachable. A deliberate scroll closes search.
  function protectedUI() { return body.classList.contains('nx-open') || document.querySelector('#detail-sheet.open') || (document.activeElement !== input && document.activeElement?.matches(':focus-visible') && (header.contains(document.activeElement) || nav.contains(document.activeElement))); }
  function onScroll(){
    frame=0; const y=Math.max(0,scrollY), d=y-last; last=y;
    if(!isHome()) {showChrome();return;}
    if(y<25){delta=0;showChrome();return;}
    if(Math.abs(d)<1)return;
    if(protectedUI()){delta=0;showChrome();return;}
    delta=(Math.sign(d)===Math.sign(delta)?delta:0)+d;
    if(delta>42){ if(opened)setSearch(false); body.classList.add('lv-chrome-hidden');delta=0; }
    if(delta<-22){showChrome();delta=0;}
  }
  window.addEventListener('scroll',()=>{if(!frame)frame=requestAnimationFrame(onScroll);},{passive:true});
  // Tab changes, search keyboard, and back-to-top are explicit ways to restore the controls.
  document.addEventListener('focusin',e=>{if(header.contains(e.target)||nav.contains(e.target))showChrome();});
  window.addEventListener('pageshow',()=>{showChrome();last=Math.max(0,scrollY);delta=0;});
})();
