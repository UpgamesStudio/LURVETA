// Los anuncios se ejecutan en un marco con origen opaco, separado de la sesión.
window.ugMarcoAnuncio = function (slot, ancho, alto) {
    const marco = document.createElement('iframe');
    marco.title = 'Publicidad';
    marco.src = '/public/anuncio-aislado.html?slot=' + encodeURIComponent(slot);
    marco.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
    marco.referrerPolicy = 'no-referrer';
    marco.width = ancho;
    marco.height = alto;
    marco.style.border = '0';
    marco.style.maxWidth = '100%';
    return marco;
};
