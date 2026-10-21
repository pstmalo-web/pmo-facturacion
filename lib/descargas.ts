// Descargas del navegador con el nombre EXACTO que decidimos nosotros.
//
// El atributo `download` de un <a> solo se respeta si el href es del mismo
// origen: con una signed URL de Supabase manda el Content-Disposition del
// servidor, y Storage lo emite percent-encoded
// (`filename=Garant%C3%ADa%20-%20acto.pdf`), que es como el archivo llegaba
// al disco llamándose "Garant%C3%ADa - ….pdf" (Paul, 2026-08-06).
//
// La salida: bajar el archivo a un blob de nuestro propio origen y descargar
// ese blob, donde `download` sí manda. Storage responde con
// `access-control-allow-origin: *`, así que el fetch cruzado está permitido.

/** Descarga `url` guardándola como `nombre`. Devuelve false si no se pudo. */
export async function descargarComo(url: string, nombre: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    guardarBlob(objectUrl, nombre);
    // Safari necesita la URL viva hasta que la descarga arranque.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Abre en pestaña nueva una URL que primero hay que resolver (p. ej. firmar
 * contra Storage). La ventana se abre ANTES del await: Safari/iOS bloquea los
 * window.open que no son síncronos con el clic. Si la URL no llega (null), la
 * pestaña en blanco se cierra — el toast de error es asunto del resolvedor.
 */
export async function abrirEnPestanaNueva(obtenerUrl: () => Promise<string | null>): Promise<void> {
  const w = window.open("about:blank", "_blank");
  const u = await obtenerUrl();
  if (!u) {
    w?.close();
    return;
  }
  if (w) w.location.href = u;
  else window.location.href = u;
}

/** Dispara la descarga de una URL ya local (blob:) con el nombre dado. */
export function guardarBlob(objectUrl: string, nombre: string): void {
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
