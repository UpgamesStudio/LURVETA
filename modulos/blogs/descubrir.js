/**
 * NEW · descubrir entradas de los blogs de la comunidad (estilo lector editorial).
 *
 * Funciones puras: reciben las entradas ya resumidas (tarjetas) y arman las secciones.
 *   nexus       Recomendado por Nexus: popularidad + conversación + novedad, y el mismo
 *               10 % de impulso por Premium del autor que usa el feed principal (upgames-ranking.js)
 *   destacadas  de creadores con Premium vigente (Premium incluye «más visibilidad»)
 *   siguiendo   de los creadores que sigue quien mira (solo con sesión)
 *   populares   más leídas de los últimos 30 días
 *   recientes   lo último publicado
 * Un mismo blog no llena una sección (tope por blog) y lo que ya sale en «nexus» no se
 * repite en «destacadas» ni en «populares».
 */
'use strict';

const DIA = 864e5;
const PREMIUM = 0.10;

function puntaje(e, { ahora, maxVistas, maxCom }) {
    const pop = maxVistas > 0 ? Math.log1p(e.vistas || 0) / Math.log1p(maxVistas) : 0;
    const conv = maxCom > 0 ? Math.log1p(e.comentarios || 0) / Math.log1p(maxCom) : 0;
    const edad = Math.max(0, (ahora - new Date(e.fecha || 0)) / DIA);
    const nov = Math.pow(0.5, edad / 10);   // vida media de 10 días
    return (e.premium ? PREMIUM : 0) + (1 - PREMIUM) * (0.45 * pop + 0.20 * conv + 0.35 * nov);
}

/** Toma de `lista` (ya ordenada) hasta `n`, con máximo `porBlog` por blog y saltando `excluir`. */
function tomar(lista, n, porBlog, excluir = new Set()) {
    const cuenta = new Map(), out = [];
    for (const e of lista) {
        if (out.length >= n) break;
        if (excluir.has(e.id)) continue;
        const k = cuenta.get(e.blogId) || 0;
        if (k >= porBlog) continue;
        cuenta.set(e.blogId, k + 1);
        out.push(e);
    }
    return out;
}

function armar(entradas, { ahora = Date.now(), siguiendo = [] } = {}) {
    const recientes = [...entradas].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const maxVistas = Math.max(0, ...entradas.map(e => e.vistas || 0));
    const maxCom = Math.max(0, ...entradas.map(e => e.comentarios || 0));
    const conPuntaje = entradas.map(e => ({ e, p: puntaje(e, { ahora, maxVistas, maxCom }) })).sort((a, b) => b.p - a.p).map(x => x.e);

    const nexus = tomar(conPuntaje, 6, 2);
    const yaNexus = new Set(nexus.map(e => e.id));
    const destacadas = tomar(recientes.filter(e => e.premium), 6, 2, yaNexus);
    const sigo = new Set(siguiendo);
    const deSeguidos = sigo.size ? tomar(recientes.filter(e => sigo.has(e.usuario)), 12, 4) : [];
    const mes = ahora - 30 * DIA;
    const populares = tomar(entradas.filter(e => new Date(e.fecha) >= mes && (e.vistas || 0) > 0).sort((a, b) => (b.vistas || 0) - (a.vistas || 0)), 12, 3, yaNexus);
    return { nexus, destacadas, siguiendo: deSeguidos, populares, recientes: tomar(recientes, 24, 3) };
}

module.exports = { armar, puntaje, tomar };

/** Valor de una entrada en las vistas ordenadas por relevancia. `n` = normalización fija (maxVistas, maxCom),
 *  la misma en todas las páginas de un mismo recorrido para que el cursor por valor sea estable. */
function valorFeed(e, { vista, ahora, n, seguidos = new Set(), temas = new Set() }) {
    const interaccion = Math.log1p((e.gusta || 0) + (e.republicaciones || 0));
    if (vista === 'populares') return Math.log1p(e.vistas || 0) + Math.log1p(e.comentarios || 0) + interaccion;
    const relevancia = (e.temas || []).some(t => temas.has(t)) ? 0.12 : 0;
    const afinidad = seguidos.has(e.usuario) ? 0.08 : 0;
    const calidad = e.resumen && e.etiquetas?.length ? 0.025 : 0;
    return puntaje(e, { ahora, ...n }) + Math.min(0.15, interaccion * 0.035) + relevancia + afinidad + calidad;
}

/** Ordena por valor y devuelve [{ e, valor }]. El orden es estable: los empates quedan como venían
 *  (el feed entrega la lista ya ordenada por id para que el orden total sea valor ↓, id ↓). */
function rankear(entradas, { vista, ahora = Date.now(), siguiendo = [], intereses = [], n } = {}) {
    const norma = n || { maxVistas: Math.max(0, ...entradas.map(e => e.vistas || 0)), maxCom: Math.max(0, ...entradas.map(e => e.comentarios || 0)) };
    const ctx = { vista, ahora, n: norma, seguidos: new Set(siguiendo), temas: new Set(intereses) };
    return entradas.map(e => ({ e, valor: valorFeed(e, ctx) })).sort((a, b) => b.valor - a.valor);
}

/** Alterna autores dentro de una página cuando es posible (sin cambiar qué entradas salen). */
function alternarAutores(lista) {
    const resto = [...lista], orden = [];
    while (resto.length) {
        const distinto = resto.findIndex(e => e.usuario !== orden.at(-1)?.usuario);
        orden.push(resto.splice(Math.max(0, distinto), 1)[0]);
    }
    return orden;
}

// Ordena un lote por relevancia y alterna autores cuando es posible.
function ordenarFeed(entradas, { ahora = Date.now(), vista, siguiendo = [], intereses = [] } = {}) {
    if (vista === 'recientes' || vista === 'siguiendo' || vista === 'guardados' || vista === 'perfil') return entradas;
    return alternarAutores(rankear(entradas, { vista, ahora, siguiendo, intereses }).map(x => x.e));
}

module.exports.ordenarFeed = ordenarFeed;
module.exports.rankear = rankear;
module.exports.alternarAutores = alternarAutores;
