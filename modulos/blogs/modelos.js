/**
 * Lurveta Blogs · modelos
 *
 * Blog       → el sitio de un creador (dirección, tema, ajustes, dominio propio).
 * Entrada    → una entrada o una página fija; el contenido son bloques (JSON), no HTML.
 * BlogVista  → visitas por día de cada blog (para las estadísticas del panel).
 * BlogReporte→ reportes de los visitantes.
 *
 * El campo `usuario` se llama así a propósito: al cambiar de nombre de usuario,
 * rutas/perfil.js actualiza solo todos los modelos que lo tienen.
 */
'use strict';

module.exports = function modelos(mongoose) {
    if (mongoose.models.Blog) return { BlogMensaje: mongoose.models.BlogMensaje, Blog: mongoose.models.Blog, Entrada: mongoose.models.Entrada, BlogVista: mongoose.models.BlogVista, BlogReporte: mongoose.models.BlogReporte, BlogInteraccion: mongoose.models.BlogInteraccion };

    const BlogSchema = new mongoose.Schema({
        usuario:     { type: String, required: true, index: true },
        direccion:   { type: String, required: true, unique: true },   // upgames…/b/<direccion>
        titulo:      { type: String, required: true, maxlength: 140 },
        descripcion: { type: String, default: '', maxlength: 300 },
        tema:        { type: String, default: 'neon' },
        ajustes:     { type: mongoose.Schema.Types.Mixed, default: {} },   // acento, fuente, portada, logo, idioma, gadgets, enlaces
        visibilidad: { type: String, enum: ['publico', 'oculto'], default: 'publico' },   // oculto: solo con el enlace, sin buscadores
        estado:      { type: String, enum: ['activo', 'revision', 'suspendido'], default: 'activo' },
        reportes:    { type: Number, default: 0 },
        sinMarca:    { type: Boolean, default: false },
        // Aceptación expresa de los Términos de Lurveta Blogs al crear el blog (prueba de que el creador asumió la responsabilidad)
        terminos:    { version: { type: String, default: '' }, fecha: { type: Date, default: null }, ip: { type: String, default: '' } },   // Premium: sin «Hecho con Lurveta»
        vistas:      { type: Number, default: 0 },
        // Monetización opcional: el creador decide si su blog lleva publicidad de Lurveta
        monetizar:   { type: Boolean, default: false },
        // «Mis secciones»: bloques guardados por el creador para reutilizar en cualquier página (máx. 30)
        secciones:   { type: [{ nombre: String, bloque: mongoose.Schema.Types.Mixed, fecha: Date }], default: [] },
        ingresos:    { type: Number, default: 0 },   // US$ ganados con los anuncios del blog
        anunciosVistos: { type: Number, default: 0 },
        descargasGeneradas: { type: Number, default: 0 },   // descargas pagadas que llegaron desde sus entradas
        ingresosDescargas:  { type: Number, default: 0 },   // US$ ganados por esas descargas
        motivoEstado: { type: String, default: '' },   // nota del equipo al suspender
        dominio: {
            nombre:       { type: String, default: '' },
            token:        { type: String, default: '' },
            verificado:   { type: Boolean, default: false },
            verificadoEn: { type: Date, default: null },
        },
    }, { timestamps: true, minimize: false });
    BlogSchema.index({ 'dominio.nombre': 1 });

    const EntradaSchema = new mongoose.Schema({
        blog:      { type: mongoose.Schema.Types.ObjectId, ref: 'Blog', required: true },
        usuario:   { type: String, required: true },
        tipo:      { type: String, enum: ['entrada', 'pagina', 'nota', 'republicacion'], default: 'entrada' },
        titulo:    { type: String, required() { return ['entrada', 'pagina'].includes(this.tipo); }, default: '', maxlength: 140 },
        slug:      { type: String, required: true },
        bloques:   { type: [mongoose.Schema.Types.Mixed], default: [] },
        etiquetas: { type: [String], default: [] },
        etiquetasSlug: { type: [String], default: [] },
        portada:   { type: String, default: '' },
        resumen:   { type: String, default: '', maxlength: 300 },
        estado:    { type: String, enum: ['borrador', 'publicada', 'programada'], default: 'borrador' },
        publicadaEn: { type: Date, default: null },
        destacada: { type: Boolean, default: false },
        vistas:    { type: Number, default: 0 },
        avisada:   { type: Boolean, default: false },   // ya se avisó a los seguidores del creador
        alcance:   { type: String, enum: ['comunidad', 'sitio'], default: 'comunidad' },
        original:  { type: mongoose.Schema.Types.ObjectId, ref: 'Entrada' },
        huella:    String,
        enlace:    { url: String, titulo: String, descripcion: String, imagen: String },
        tituloSeo: { type: String, default: '', maxlength: 90 },    // título para Google y redes (si no, el título)
        noindex:   { type: Boolean, default: false },               // pedir a Google que no la muestre
        // Historial: estados anteriores (máx. 15) para volver atrás
        versiones: { type: [{ _id: false, fecha: Date, creada: Date, titulo: String, estado: String, bloques: [mongoose.Schema.Types.Mixed] }], default: [] },   // fecha: de cuándo es ese contenido · creada: cuándo se guardó la versión
    }, { timestamps: true });
    EntradaSchema.index({ blog: 1, tipo: 1, slug: 1 }, { unique: true });
    EntradaSchema.index({ blog: 1, estado: 1, publicadaEn: -1 });
    EntradaSchema.index({ blog: 1, etiquetasSlug: 1 });
    EntradaSchema.index({ publicadaEn: -1, _id: -1 });
    EntradaSchema.index({ vistas: -1, _id: -1 });   // feed por relevancia: las más leídas de la ventana
    EntradaSchema.index({ original: 1 });
    EntradaSchema.index({ usuario: 1, original: 1 }, { unique: true, partialFilterExpression: { tipo: 'republicacion' } });
    EntradaSchema.index({ blog: 1, huella: 1 }, { unique: true, partialFilterExpression: { tipo: 'nota' } });

    const BlogInteraccionSchema = new mongoose.Schema({
        usuario: { type: String, required: true },
        tipo: { type: String, required: true, enum: ['gusta', 'guardar', 'seguir', 'silenciar'] },
        objetivo: { type: mongoose.Schema.Types.ObjectId, required: true },
        frecuencia: { type: String, enum: ['cada-articulo', 'sin-avisos'], default: 'cada-articulo' },
    }, { timestamps: true });
    BlogInteraccionSchema.index({ usuario: 1, tipo: 1, objetivo: 1 }, { unique: true });
    BlogInteraccionSchema.index({ objetivo: 1, tipo: 1, frecuencia: 1 });

    const BlogVistaSchema = new mongoose.Schema({ blog: { type: mongoose.Schema.Types.ObjectId, required: true }, dia: { type: String, required: true }, n: { type: Number, default: 0 }, a: { type: Number, default: 0 }, g: { type: Number, default: 0 }, d: { type: Number, default: 0 }, gd: { type: Number, default: 0 },
        u: { type: Number, default: 0 }, mo: { type: Number, default: 0 }, pc: { type: Number, default: 0 },   // visitantes (aprox.) · visitas desde móvil · desde computador
        rd: { type: Number, default: 0 }, rb: { type: Number, default: 0 }, rs: { type: Number, default: 0 }, ru: { type: Number, default: 0 }, ro: { type: Number, default: 0 },   // de dónde llegan: directo · buscadores · redes · Lurveta · otros sitios
        cw: { type: Number, default: 0 }, cr: { type: Number, default: 0 }, cb: { type: Number, default: 0 }, fm: { type: Number, default: 0 }, pe: { type: Number, default: 0 } });   // clics a WhatsApp · a redes · a botones · formularios recibidos · pedidos
    // n visitas · a anuncios vistos · g ganancia US$ · d descargas atribuidas · gd ganancia US$ por ellas
    BlogVistaSchema.index({ blog: 1, dia: 1 }, { unique: true });

    const BlogReporteSchema = new mongoose.Schema({
        blog: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
        usuario: String, publicacion: mongoose.Schema.Types.ObjectId, motivo: String, detalle: String, ip: String,
    }, { timestamps: true });
    BlogReporteSchema.index({ usuario: 1, publicacion: 1 }, { unique: true, partialFilterExpression: { publicacion: { $type: 'objectId' } } });

    // Lo que mandan los visitantes desde el blog: mensajes del formulario de contacto y pedidos del catálogo
    const BlogMensajeSchema = new mongoose.Schema({
        blog: { type: mongoose.Schema.Types.ObjectId, required: true }, entrada: mongoose.Schema.Types.ObjectId,
        tipo: { type: String, enum: ['mensaje', 'pedido'], default: 'mensaje' },
        nombre: String, email: String, telefono: String, texto: String,
        items: [{ _id: false, nombre: String, cantidad: Number, precio: Number }], total: Number, moneda: String,
        leido: { type: Boolean, default: false }, ip: String,
    }, { timestamps: true });
    BlogMensajeSchema.index({ blog: 1, createdAt: -1 });

    return {
        BlogInteraccion: mongoose.model('BlogInteraccion', BlogInteraccionSchema),
        BlogMensaje: mongoose.model('BlogMensaje', BlogMensajeSchema),
        Blog: mongoose.model('Blog', BlogSchema),
        Entrada: mongoose.model('Entrada', EntradaSchema),
        BlogVista: mongoose.model('BlogVista', BlogVistaSchema),
        BlogReporte: mongoose.model('BlogReporte', BlogReporteSchema),
    };
};
