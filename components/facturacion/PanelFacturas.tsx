"use client";

// Las facturas electrónicas del proyecto, dentro del popup: estado, número
// fiscal, CUFE y las acciones que HKA permite en cada estado. Se pinta solo
// cuando hay facturas — un proyecto sin facturar no carga con una sección
// vacía más.
//
// La anulación pide motivo inline (nada de prompt()) y solo existe sobre una
// autorizada; HKA la rechaza pasados 7 días — aquí no se duplica el
// calendario, se muestra el mensaje del servicio tal cual.
//
// VIVE EN components/facturacion/ desde que la pestaña /facturacion existe: la
// misma tarjeta con las mismas acciones se pinta bajo el popup del board y en
// el listado de la pestaña. Su contrato NO cambió en la mudanza
// —{facturas, refrescar, puedeEditar}—; `puedeEditar` sigue siendo el gestor,
// que en la pestaña es `puedeEmitirFacturas` (auditor y cofounder ven las
// tarjetas sin un solo botón de acción).
import { useState } from "react";
import { Ban, Download, ExternalLink, Loader2, Mail, RefreshCw, Trash2 } from "lucide-react";
import { crearClienteNavegador } from "@/lib/supabase/client";
import {
  ETIQUETA_ESTADO_FACTURA,
  HEX_ESTADO_FACTURA,
  numeroFiscal,
  type Factura,
} from "@/lib/facturas/tipos";
import { urlArchivoFactura } from "@/lib/facturas/useFacturasData";
import { estiloChip } from "@/lib/proyectos/constantes";
import { abrirEnPestanaNueva, descargarComo } from "@/lib/descargas";
import { fechaPunto, monedaContable } from "@/lib/format";
import { BotonCopiar } from "@/components/ui/BotonCopiar";
import { useToast } from "@/components/ui/Toast";

export function PanelFacturas({
  facturas,
  refrescar,
  puedeEditar,
  titulo = "Facturas electrónicas",
  contexto,
}: {
  facturas: Factura[] | null;
  refrescar: () => Promise<void>;
  puedeEditar: boolean;
  /** `null` en /facturacion: allí el título de la pantalla ya lo dice, y un
   *  rótulo repetido encima de la lista solo gasta renglón. */
  titulo?: string | null;
  /** Línea de contexto sobre cada tarjeta. En el popup del board SOBRA —todas
   *  las facturas son de ese proyecto y de esa entidad—, pero en el listado
   *  general es lo primero que hay que leer para saber de quién es cada una.
   *  Se pasa como función y no como columna para que el panel siga sin saber
   *  nada de entidades ni de proyectos: quien lo usa decide qué contar. */
  contexto?: (f: Factura) => React.ReactNode;
}) {
  const toast = useToast();
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  if (!facturas || facturas.length === 0) return null;

  async function llamar(url: string, cuerpo?: unknown): Promise<boolean> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "La operación falló.");
      return false;
    }
    if (json.aviso) toast.mostrar({ tipo: "ok", mensaje: json.aviso });
    return true;
  }

  async function reintentar(f: Factura) {
    setOcupada(f.id);
    const ok = await llamar(`/api/facturas/${f.id}/reintentar`);
    setOcupada(null);
    await refrescar();
    if (ok) toast.mostrar({ tipo: "ok", mensaje: "Factura autorizada por la DGI." });
  }

  async function borrarPrueba(f: Factura) {
    // Solo existe para facturas DEMO: el trigger de la 085 rechaza borrar
    // cualquier cosa de producción, así que esto no puede tocar una real.
    setOcupada(f.id);
    const supabase = crearClienteNavegador();
    const rutas = [f.pdf_path, f.xml_path].filter((p): p is string => !!p);
    if (rutas.length > 0) await supabase.storage.from("facturas").remove(rutas);
    const { data, error } = await supabase.from("facturas").delete().eq("id", f.id).select("id");
    setOcupada(null);
    if (error || !data?.length) {
      toast.error(`No se pudo borrar: ${error?.message ?? "el candado la protegió"}`);
      return;
    }
    await refrescar();
    toast.mostrar({ tipo: "ok", mensaje: "Factura de prueba borrada." });
  }

  async function traerArchivos(f: Factura) {
    setOcupada(f.id);
    const ok = await llamar(`/api/facturas/${f.id}/archivos`);
    setOcupada(null);
    await refrescar();
    if (ok) toast.mostrar({ tipo: "ok", mensaje: "CAFE y XML descargados de HKA." });
  }

  async function anular(f: Factura) {
    setOcupada(f.id);
    const ok = await llamar(`/api/facturas/${f.id}/anular`, { motivo: motivo.trim() });
    setOcupada(null);
    setAnulando(null);
    setMotivo("");
    await refrescar();
    if (ok) toast.mostrar({ tipo: "ok", mensaje: "Factura anulada." });
  }

  async function descargar(f: Factura, tipo: "pdf" | "xml") {
    const path = tipo === "pdf" ? f.pdf_path : f.xml_path;
    if (!path) return;
    const nombre = `Factura ${numeroFiscal(f.numero_documento)}.${tipo}`;
    const url = await urlArchivoFactura(path, nombre);
    if (!url) {
      toast.error("No se pudo firmar la descarga.");
      return;
    }
    if (!(await descargarComo(url, nombre))) toast.error("No se pudo descargar el archivo.");
  }

  return (
    <section aria-label="Facturas electrónicas">
      {titulo && (
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink/60">
          {titulo}
        </p>
      )}
      <div className="space-y-1.5">
        {facturas.map((f) => (
          <article key={f.id} className="rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-[13px]">
            {contexto && <div className="mb-1 min-w-0">{contexto(f)}</div>}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={estiloChip(HEX_ESTADO_FACTURA[f.estado])}
              >
                {ETIQUETA_ESTADO_FACTURA[f.estado]}
              </span>
              {f.ambiente === "demo" && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                  DEMO
                </span>
              )}
              <span className="font-mono font-semibold text-ink">Nº {numeroFiscal(f.numero_documento)}</span>
              <span className="font-mono text-ink/70">{monedaContable(f.total)}</span>
              {f.fecha_emision && (
                <span className="text-xs text-ink/60">{fechaPunto(f.fecha_emision.slice(0, 10))}</span>
              )}
              {ocupada === f.id && <Loader2 className="h-4 w-4 animate-spin text-ink/60" aria-hidden />}
            </div>

            {f.cufe && (
              <p className="mt-1 flex items-center gap-1 text-xs text-ink/60">
                CUFE <span className="truncate font-mono">{f.cufe.slice(0, 24)}…</span>
                <BotonCopiar texto={f.cufe} etiqueta="Copiar CUFE" tam="h-3.5 w-3.5" />
              </p>
            )}
            {f.mensaje_error && (f.estado === "rechazada" || f.estado === "emitiendo") && (
              <p className="mt-1 rounded-lg bg-red-100 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
                {f.mensaje_error}
              </p>
            )}
            {f.estado === "anulada" && f.motivo_anulacion && (
              <p className="mt-1 text-xs text-ink/60">Motivo: {f.motivo_anulacion}</p>
            )}
            {f.retencion_aplicada && f.retencion_monto != null && f.estado === "autorizada" && (
              <p className="mt-0.5 text-xs text-ink/60">
                Retención 50 % ITBMS: {monedaContable(f.retencion_monto)} — neto a cobrar{" "}
                {monedaContable(Math.round((f.total - f.retencion_monto) * 100) / 100)}
              </p>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {f.pdf_path && (
                <button className="inline-flex items-center gap-1 text-clay hover:underline" onClick={() => void descargar(f, "pdf")}>
                  <Download className="h-3.5 w-3.5" aria-hidden /> CAFE (PDF)
                </button>
              )}
              {f.xml_path && (
                <button className="inline-flex items-center gap-1 text-clay hover:underline" onClick={() => void descargar(f, "xml")}>
                  <Download className="h-3.5 w-3.5" aria-hidden /> XML
                </button>
              )}
              {f.qr_url && (
                <button
                  className="inline-flex items-center gap-1 text-clay hover:underline"
                  onClick={() => void abrirEnPestanaNueva(async () => f.qr_url)}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Ver en la DGI
                </button>
              )}
              {puedeEditar && (f.estado === "rechazada" || (f.estado === "emitiendo" && f.mensaje_error)) && (
                <button
                  className="inline-flex items-center gap-1 text-clay hover:underline"
                  onClick={() => void reintentar(f)}
                  disabled={ocupada === f.id}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Reintentar
                </button>
              )}
              {puedeEditar && f.estado === "autorizada" && !f.pdf_path && (
                <button
                  className="inline-flex items-center gap-1 text-clay hover:underline"
                  onClick={() => void traerArchivos(f)}
                  disabled={ocupada === f.id}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Traer CAFE de HKA
                </button>
              )}
              {puedeEditar && f.ambiente === "demo" && (
                <button
                  className="inline-flex items-center gap-1 text-ink/60 hover:underline"
                  onClick={() => void borrarPrueba(f)}
                  disabled={ocupada === f.id}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden /> Borrar prueba
                </button>
              )}
              {puedeEditar && f.estado === "autorizada" && anulando !== f.id && (
                <button
                  className="inline-flex items-center gap-1 text-red-700 hover:underline dark:text-red-400"
                  onClick={() => setAnulando(f.id)}
                >
                  <Ban className="h-3.5 w-3.5" aria-hidden /> Anular
                </button>
              )}
              {puedeEditar && f.estado === "autorizada" && f.correos.length > 0 && (
                <span className="inline-flex items-center gap-1 text-ink/60">
                  <Mail className="h-3.5 w-3.5" aria-hidden /> {f.correos.join(", ")}
                </span>
              )}
            </div>

            {anulando === f.id && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Motivo de la anulación (≥5 caracteres)"
                  aria-label="Motivo de la anulación"
                  className="min-w-0 flex-1 rounded-lg border border-ink/15 px-2.5 py-1.5 text-xs text-ink outline-none focus:border-clay"
                  autoFocus
                />
                <button
                  className="shrink-0 text-xs font-semibold text-red-700 hover:underline disabled:opacity-40 dark:text-red-400"
                  disabled={motivo.trim().length < 5 || ocupada === f.id}
                  onClick={() => void anular(f)}
                >
                  Confirmar
                </button>
                <button
                  className="shrink-0 text-xs text-ink/60 hover:underline"
                  onClick={() => {
                    setAnulando(null);
                    setMotivo("");
                  }}
                >
                  Cancelar
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
