(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 680px)');
  const menu = $('.lv-menu'), nav = $('#lv-mobile-nav');
  function setMenu(open) {
    if (!menu || !nav) return;
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    nav.hidden = !open;
  }
  function syncMenu() { if (menu) menu.hidden = !mobile.matches; setMenu(false); }
  if (menu && nav) {
    syncMenu(); mobile.addEventListener('change', syncMenu);
    menu.addEventListener('click', () => setMenu(nav.hidden));
    nav.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !nav.hidden) { setMenu(false); menu.focus(); } });
  }
  const dock = $('.lv-dock'), actions = $('#lv-primary-actions');
  if ('IntersectionObserver' in window) {
    const reveal = new IntersectionObserver(entries => {
      entries.forEach(({target,isIntersecting}) => {
        if (isIntersecting) { if (!reduced.matches) target.classList.add('lv-revealed'); reveal.unobserve(target); }
      });
    }, { threshold: .12 });
    $$('[data-reveal]').forEach(el => reveal.observe(el));
    if (dock && actions) {
      new IntersectionObserver(([entry]) => {
        dock.hidden = entry.isIntersecting || entry.boundingClientRect.bottom >= 72;
      }, { rootMargin: '-72px 0px 0px 0px', threshold: 0 }).observe(actions);
    }
  }
  const list = $('#lv-trending'), controls = $('.lv-trend-controls');
  if (!list) return;
  function watchImage(img) {
    const fail = () => img.classList.add('is-broken');
    img.addEventListener('error', fail, {once:true});
    if (img.complete && !img.naturalWidth) fail();
  }
  $$('img', list).forEach(watchImage);
  function updateControls() {
    if (!controls) return;
    const max = list.scrollWidth - list.clientWidth;
    controls.hidden = max <= 2;
    $('[data-trend="prev"]', controls).disabled = list.scrollLeft <= 2;
    $('[data-trend="next"]', controls).disabled = list.scrollLeft >= max - 2;
  }
  if (controls) {
    controls.addEventListener('click', e => {
      const btn = e.target.closest('[data-trend]'); if (!btn) return;
      const width = list.firstElementChild?.getBoundingClientRect().width || list.clientWidth;
      list.scrollBy({left:(btn.dataset.trend === 'next' ? 1 : -1)*(width+12), behavior:reduced.matches?'instant':'smooth'});
    });
    list.addEventListener('scroll', updateControls, {passive:true});
    window.addEventListener('resize', updateControls, {passive:true});
    updateControls();
  }
  const number = new Intl.NumberFormat('es', {notation:'compact', maximumFractionDigits:1});
  function card(item, index) {
    const li = document.createElement('li'), link = document.createElement('a');
    link.className='lv-project'; link.href='/public/biblioteca.html?id='+item._id;
    const imgBox=document.createElement('div'); imgBox.className='lv-project-img';
    const badge=document.createElement('span'); badge.setAttribute('aria-hidden','true'); badge.textContent='LV / '+String(index+1).padStart(2,'0');
    const img=document.createElement('img'); img.alt=''; img.loading='lazy'; img.decoding='async'; img.width=320;img.height=180; img.src=item.image; watchImage(img); imgBox.append(badge,img);
    const copy=document.createElement('div'); copy.className='lv-project-copy';
    const tag=document.createElement('small'); tag.textContent=typeof item.category==='string' && item.category.trim() ? item.category.toUpperCase().slice(0,40) : 'PROYECTO DE LA COMUNIDAD';
    const title=document.createElement('h3'); title.textContent=item.title;
    const cta=document.createElement('span'); cta.textContent='Ver proyecto ↗';
    if (typeof item.descargasEfectivas==='number' && Number.isFinite(item.descargasEfectivas) && item.descargasEfectivas>0) { const stats=document.createElement('small'); stats.textContent=number.format(item.descargasEfectivas)+' descargas'; copy.append(tag,title,stats,cta); } else copy.append(tag,title,cta);
    link.append(imgBox,copy);li.append(link);return li;
  }
  async function loadPopular() {
    const controller = new AbortController(), timeout = setTimeout(()=>controller.abort(),5000);
    try {
      const response=await fetch('https://upgames-production.up.railway.app/items',{signal:controller.signal});
      if(!response.ok)return;
      const items=await response.json(); if(!Array.isArray(items))return;
      const popular=items.filter(item=>/^[a-f\d]{24}$/i.test(item?._id)&&item.category!=='Video'&&typeof item.title==='string'&&item.title.trim()&&typeof item.image==='string'&&item.image.startsWith('https://')).sort((a,b)=>(b.descargasEfectivas||0)-(a.descargasEfectivas||0)||(b.likesCount||0)-(a.likesCount||0)).slice(0,5);
      if(popular.length<5||list.matches(':hover,:focus-within')||list.scrollLeft>2)return;
      list.replaceChildren(...popular.map(card));updateControls();
    } catch (_) { /* Static real catalog links are the fallback. */ } finally { clearTimeout(timeout); }
  }
  loadPopular();
})();
