(function () {
  'use strict';

// Mismo subidor que el resto de Lurveta (preset público de Cloudinary); la firma del servidor queda de respaldo
const CLD_NUBE = 'dd4w2plxn', CLD_PRESET = 'upgames_videos';
async function enviarCloudinary(nube, campos, archivo) {
  const fd = new FormData();
  fd.append('file', archivo);
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  let r;
  try { r = await fetch(`https://api.cloudinary.com/v1_1/${nube}/image/upload`, { method: 'POST', body: fd }); } catch (_) { throw new Error('Sin conexión. Revisa tu internet e inténtalo de nuevo.'); }
  const d = await r.json().catch(() => null);
  if (d?.secure_url) return d.secure_url;
  throw new Error(d?.error?.message ? `No se pudo subir la imagen: ${d.error.message}` : 'No se pudo subir la imagen. Inténtalo de nuevo.');
}
async function subirImagen(archivo, firmar) {
  // Algunas galerías de Android entregan la foto sin tipo (o HEIC): se mira también la extensión
  const esImagen = archivo.type.startsWith('image/') || (!archivo.type && /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(archivo.name));
  if (!esImagen) throw new Error('Ese archivo no es una imagen.');
  if (archivo.size > 20 * 1024 * 1024) throw new Error('La imagen pesa más de 20 MB. Elige una más ligera.');
  try { return await enviarCloudinary(CLD_NUBE, { upload_preset: CLD_PRESET, folder: 'covers' }, archivo); }
  catch (e) {
    if (/conexión/.test(e.message)) throw e;
    const f = await firmar();
    return enviarCloudinary(f.cloud_name, { api_key: f.api_key, timestamp: f.timestamp, signature: f.signature, folder: f.folder }, archivo);
  }
}

  window.UGBlogSubirImagen = subirImagen;
})();
