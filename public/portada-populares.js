(() => {
  const sección = document.querySelector('.ug-populares');
  const pista = sección.querySelector('.ug-populares-pista');
  const lista = pista.querySelector('ul');
  const botón = sección.querySelector('.ug-populares-pausa');
  const reducir = matchMedia('(prefers-reduced-motion: reduce)');
  let detenido = false;
  const actualizarMovimiento = () => {
    pista.classList.toggle('en-movimiento', !reducir.matches);
    pista.classList.toggle('en-pausa', detenido);
    botón.hidden = reducir.matches;
    botón.textContent = detenido ? 'Reanudar movimiento' : 'Detener movimiento';
  };
  botón.addEventListener('click', () => { detenido = !detenido; actualizarMovimiento(); });
  reducir.addEventListener('change', actualizarMovimiento);

  function duplicar() {
    pista.querySelector('[aria-hidden]')?.remove();
    const copia = lista.cloneNode(true);
    copia.setAttribute('aria-hidden', 'true');
    copia.querySelectorAll('a').forEach(enlace => { enlace.tabIndex = -1; });
    pista.append(copia);
    actualizarMovimiento();
  }
  duplicar();

  async function actualizar() {
    const respuesta = await fetch('https://upgames-production.up.railway.app/items', { signal: AbortSignal.timeout(5000) });
    if (!respuesta.ok) return;
    const items = await respuesta.json();
    if (!Array.isArray(items)) return;
    const populares = items.filter(item => /^[a-f\d]{24}$/i.test(item?._id) &&
      item.category !== 'Video' && typeof item.title === 'string' && item.title.trim() &&
      typeof item.image === 'string' && item.image.startsWith('https://'))
      .sort((a, b) => (b.descargasEfectivas || 0) - (a.descargasEfectivas || 0) ||
        (b.likesCount || 0) - (a.likesCount || 0)).slice(0, 5);
    if (populares.length < 5 || sección.matches(':hover, :focus-within')) return;
    const tarjetas = populares.map(item => {
      const tarjeta = document.createElement('li');
      const enlace = document.createElement('a');
      const imagen = document.createElement('img');
      const título = document.createElement('span');
      enlace.href = '/public/biblioteca.html?id=' + item._id;
      imagen.src = item.image;
      imagen.alt = '';
      imagen.loading = 'lazy';
      título.textContent = item.title;
      enlace.append(imagen, título);
      tarjeta.append(enlace);
      return tarjeta;
    });
    lista.replaceChildren(...tarjetas);
    duplicar();
  }
  actualizar().catch(() => {}); // El HTML inicial conserva las publicaciones si falla la red.
})();
