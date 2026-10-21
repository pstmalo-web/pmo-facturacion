"use client";

// Facturar: el formulario nace de la cotización ligada (renglones,
// institución, correo del acto) y de la entidad fiscal emparejada por alias.
//
// DOS CAMINOS, UN FORMULARIO. Con proyecto es lo de siempre. SIN proyecto es
// la FACTURA LIBRE (F2, decisión de Paul del 2026-08-18): no todo lo que se
// cobra pasó por el board, así que los renglones se teclean a mano y la
// entidad se elige del directorio. Lo que la DGI exige —entidad con RUC+DV,
// ubicación del catálogo, CPBS por renglón, cuotas que cuadren— es idéntico
// en los dos casos, y por eso es el MISMO componente y no un primo: dos
// copias de este formulario divergirían justo en la validación fiscal.
// Clon conceptual de FormularioOC, con las tres cosas que la DGI exige y el
// PMO no tenía: la entidad con RUC+DV, la ubicación EXACTA del catálogo y el
// CPBS por renglón (la causa nº 1 de rechazo con receptor gobierno).
//
// Decisiones de Paul (2026-08-13) encarnadas aquí:
// - Control manual: emitir NO toca fecha_factura ni gestión de cobros.
// - Retención del 50 % del ITBMS encendida por defecto (venta al Estado).
// - El correo se precarga con el de la cotización (el publicado en el acto) y
//   admite uno adicional.
// Sin credenciales configuradas (GET /api/hka/folios → configurado:false) el
// formulario se puede dejar LISTO pero Emitir queda deshabilitado.
//
// VIVE EN components/facturacion/ (y no en proyectos/components/) desde que la
// pestaña /facturacion existe: el MISMO formulario se abre desde el popup del
// board y desde el botón «Nueva factura» de la pestaña. Su contrato con el
// popup NO cambió en la mudanza —{p, onCerrar, onEmitida}, con el proyecto
// completo— porque el camino "facturar este proyecto" es idéntico desde los
// dos sitios; la factura LIBRE (sin proyecto) es otro camino y va aparte.
import { useEffect, useMemo, useState } from "react";
import { CircleAlert, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { registrarUso } from "@/lib/analitica";
import type { ProyectoFull } from "@/lib/proyectos/useProyectosData";
import type { CotizacionItem } from "@/lib/types";
import { calcularTotales } from "@/lib/calc";
import { retencionItbms50 } from "@/lib/hka/documento";
import { buscarUbicacion, FAMILIAS_CPBS, familiaCpbs, ubicacionesDgi } from "@/lib/hka/catalogos";
import type { EntidadAlias, EntidadFiscal } from "@/lib/facturas/tipos";
import {
  correoDelActo,
  direccionDelActo,
  emparejarEntidad,
  filtrarEntidades,
  renglonVacio,
  renglonesDesdeCotizacion,
  type RenglonFormulario,
} from "@/lib/facturas/preparar";
import { monedaContable } from "@/lib/format";
import { FormularioEntidad } from "@/components/facturacion/FormularioEntidad";
import { Boton } from "@/components/ui/Boton";
import { useToast } from "@/components/ui/Toast";

interface EstadoHka {
  configurado: boolean;
  ambiente?: string;
  disponiblesCiclo?: number | null;
}

/** Hoy en Panamá + N días, en YYYY-MM-DD (para el vencimiento por defecto). */
function fechaPanamaMas(dias: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Panama" }).format(
    new Date(Date.now() + dias * 24 * 3600 * 1000)
  );
}

/**
 * Lo ÚNICO que este formulario necesita de un proyecto: su id, la cotización
 * ligada (de donde salen los renglones y el correo del acto) y el número de
 * O/C que viaja como pedido comercial.
 *
 * Se declara así —y no `ProyectoFull`— para que la pestaña /facturacion pueda
 * abrir el formulario con lo que trae su selector, sin cargar tareas, archivos
 * y resumen que aquí nadie mira. El popup del board NO cambia: un
 * `ProyectoFull` satisface este tipo, así que su llamada quedó igual.
 */
export type ProyectoFacturable = Pick<
  ProyectoFull,
  "id" | "cotizacion_id" | "numero_oc"
>;

export function FormularioFactura({
  p,
  onCerrar,
  onEmitida,
}: {
  /** Sin proyecto = factura LIBRE: renglones a mano y entidad del directorio. */
  p?: ProyectoFacturable | null;
  onCerrar: () => void;
  onEmitida: () => void;
}) {
  const toast = useToast();
  const supabase = crearClienteNavegador();

  const [cargando, setCargando] = useState(true);
  const [hka, setHka] = useState<EstadoHka | null>(null);
  const [entidades, setEntidades] = useState<EntidadFiscal[]>([]);
  const [entidadId, setEntidadId] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [buscando, setBuscando] = useState(false);

  const [direccion, setDireccion] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [correo, setCorreo] = useState("");
  const [correoAdicional, setCorreoAdicional] = useState("");

  const [renglones, setRenglones] = useState<RenglonFormulario[]>([]);
  const [retener, setRetener] = useState(true);
  const [formaPago, setFormaPago] = useState<"01" | "02" | "08" | "09">("01");
  // Términos de pago (Paul trabaja a crédito y fija sus plazos): con UNA sola
  // cuota el monto es SIEMPRE el total (no se teclea); con varias, cada monto
  // es manual y Emitir exige que cuadren al centavo.
  const [cuotas, setCuotas] = useState<{ vence: string; monto: string }[]>(() => [
    { vence: fechaPanamaMas(30), monto: "" },
  ]);
  const [emitiendo, setEmitiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Alta de entidad SIN salir de la factura: en la libre es lo normal —el
  // receptor no viene de ningún acto—, y obligar a ir al directorio y volver
  // perdería lo tecleado.
  const [creandoEntidad, setCreandoEntidad] = useState(false);

  // ------------------------------- Carga --------------------------------
  useEffect(() => {
    let vivo = true;
    async function cargar() {
      const [cot, items, ents, als, folios] = await Promise.all([
        p?.cotizacion_id
          ? supabase
              .from("cotizaciones")
              .select("id, numero, cliente_nombre, cliente_direccion, cliente_contacto_email, datos_pliego")
              .eq("id", p.cotizacion_id)
              .single()
          : Promise.resolve({ data: null }),
        p?.cotizacion_id
          ? supabase
              .from("cotizacion_items")
              .select("nombre, descripcion, precio_unitario, cantidad, itbms_exento, renglon_numero")
              .eq("cotizacion_id", p.cotizacion_id)
              .order("orden")
          : Promise.resolve({ data: [] }),
        supabase.from("entidades_fiscales").select("*").order("nombre"),
        supabase.from("entidades_fiscales_alias").select("entidad_id, alias"),
        fetch("/api/hka/folios").then((r) => r.json()).catch(() => ({ configurado: false })),
      ]);
      if (!vivo) return;

      const listaEntidades = (ents.data as EntidadFiscal[]) ?? [];
      const listaAlias = (als.data as EntidadAlias[]) ?? [];
      setEntidades(listaEntidades);
      setHka(folios as EstadoHka);
      // La factura libre arranca con UN renglón en blanco: una lista vacía
      // con un botón de agregar es un paso de más para el caso normal.
      const deLaCotizacion = renglonesDesdeCotizacion(
        ((items.data as Pick<CotizacionItem, "nombre" | "descripcion" | "precio_unitario" | "cantidad" | "itbms_exento" | "renglon_numero">[]) ?? [])
      );
      setRenglones(deLaCotizacion.length > 0 ? deLaCotizacion : [renglonVacio()]);

      const datosCot = cot.data as {
        cliente_nombre?: string | null;
        cliente_direccion?: string | null;
        cliente_contacto_email?: string | null;
        datos_pliego?: {
          contacto?: { correo?: string | null } | null;
          entidad?: { direccion?: string | null } | null;
        } | null;
      } | null;
      const emparejada = emparejarEntidad(datosCot?.cliente_nombre, listaEntidades, listaAlias);
      if (emparejada) elegirEntidad(emparejada);
      // En DEMO el correo NO se precarga: HKA sí manda el email, y un ensayo
      // no puede aterrizar en la bandeja real del contacto de la entidad.
      const esDemo = (folios as EstadoHka)?.configurado && (folios as EstadoHka)?.ambiente === "demo";
      const correoActo = datosCot ? correoDelActo(datosCot) : null;
      if (correoActo && !esDemo) setCorreo((prev) => prev || correoActo);
      // La dirección "es la que aparece en el acto y en mi cotización" (Paul):
      // la de la entidad (si ya facturamos antes) manda; si no, la del acto.
      const direccionActo = datosCot ? direccionDelActo(datosCot) : null;
      if (direccionActo) setDireccion((prev) => prev || direccionActo);
      setCargando(false);
    }
    void cargar();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.cotizacion_id]);

  function elegirEntidad(e: EntidadFiscal) {
    setEntidadId(e.id);
    setCreandoEntidad(false);
    setBuscando(false);
    setBusqueda("");
    setDireccion((prev) => prev || e.direccion || "");
    setUbicacion((prev) => prev || e.codigo_ubicacion || "");
    if (e.correo) setCorreo((prev) => prev || e.correo!);
  }

  const entidad = entidades.find((e) => e.id === entidadId) ?? null;
  const ubicacionResuelta = useMemo(() => buscarUbicacion(ubicacion.trim()), [ubicacion]);
  const incluidos = renglones.filter((r) => r.incluir);
  const totales = calcularTotales(incluidos);
  const retencion = retener ? retencionItbms50(totales.itbms) : 0;

  const sinCpbs = incluidos.filter((r) => !/^\d{4}$/.test(r.cpbs)).length;
  const sumaCuotas =
    cuotas.length === 1
      ? totales.total
      : Math.round(cuotas.reduce((s, c) => s + (Number(c.monto) || 0), 0) * 100) / 100;
  const cuotasCuadran = Math.abs(sumaCuotas - totales.total) < 0.005;
  const cuotasConFecha = cuotas.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.vence));
  // Un renglón sin descripción rebota en zod (mín. 2) DESPUÉS de haber
  // consumido un número fiscal: se atrapa aquí, que es donde no cuesta nada.
  const sinDescripcion = incluidos.filter((r) => r.descripcion.trim().length < 2).length;
  const listaParaEmitir =
    !!entidad &&
    sinDescripcion === 0 &&
    direccion.trim().length >= 5 &&
    !!ubicacionResuelta &&
    incluidos.length > 0 &&
    sinCpbs === 0 &&
    cuotasCuadran &&
    cuotasConFecha;

  // ------------------------------- Emitir -------------------------------
  async function emitir() {
    if (!entidad || !ubicacionResuelta) return;
    registrarUso("factura_emitir");
    setEmitiendo(true);
    setError(null);
    const correos = [correo.trim(), correoAdicional.trim()].filter(Boolean);
    const res = await fetch("/api/facturas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proyecto_id: p?.id ?? null,
        cotizacion_id: p?.cotizacion_id ?? null,
        entidad_id: entidad.id,
        entidad: {
          direccion: direccion.trim(),
          codigo_ubicacion: ubicacionResuelta.codigo,
          provincia: ubicacionResuelta.provincia,
          distrito: ubicacionResuelta.distrito,
          corregimiento: ubicacionResuelta.corregimiento,
          correo: correo.trim(),
        },
        items: incluidos.map((r) => ({
          descripcion: r.descripcion,
          cantidad: r.cantidad,
          precio_unitario: r.precio_unitario,
          itbms_exento: r.itbms_exento,
          cpbs: r.cpbs,
          unidad_medida: r.unidad_medida || "und",
          renglon_numero: r.renglon_numero,
        })),
        correos,
        retener,
        forma_pago: formaPago,
        cuotas: cuotas.map((c) => ({
          vence: c.vence,
          monto: cuotas.length === 1 ? totales.total : Number(c.monto) || 0,
        })),
        orden_compra: p?.numero_oc ?? null,
      }),
    });
    const cuerpo = await res.json().catch(() => ({}));
    setEmitiendo(false);
    onEmitida();
    if (res.ok) {
      toast.mostrar({ tipo: "ok", mensaje: cuerpo.aviso ?? "Factura autorizada por la DGI." });
      onCerrar();
    } else {
      setError(cuerpo.error ?? "No se pudo emitir la factura.");
      toast.error(cuerpo.error ?? "No se pudo emitir la factura.");
    }
  }

  function campoRenglon(i: number, c: Partial<RenglonFormulario>) {
    setRenglones((prev) => prev.map((r, j) => (j === i ? { ...r, ...c } : r)));
  }

  const inputCls =
    "w-full rounded-lg border border-ink/15 px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-clay";

  if (cargando) {
    return (
      <section className="flex items-center gap-2 rounded-xl border border-clay/30 bg-white p-3.5 text-[13px] text-ink/60">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Preparando la factura…
      </section>
    );
  }

  return (
    <section className="min-w-0 animate-[aparecer_150ms_ease-out] space-y-3 rounded-xl border border-clay/30 bg-white p-3.5">
      <h3 className="text-[13px] font-bold text-ink">
        {p ? "Facturar este proyecto" : "Factura libre (sin proyecto)"}
      </h3>

      {hka && !hka.configurado && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-100 px-2.5 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Esperando las credenciales del API de HKA. Puedes dejar todo listo; el botón Emitir se
          habilita cuando estén en Vercel.
        </p>
      )}
      {hka?.configurado && hka.ambiente === "demo" && (
        <p className="rounded-lg bg-blue-100 px-2.5 py-1.5 text-xs text-blue-900 dark:bg-blue-950 dark:text-blue-200">
          Ambiente DEMO de HKA: la factura no tiene valor fiscal. El correo del acto NO se precarga
          — si quieres probar el envío, usa un correo tuyo.
        </p>
      )}

      {/* ------------------------- Entidad receptora ---------------------- */}
      <div>
        <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink/60">
          Entidad receptora
        </p>
        {creandoEntidad ? (
          <FormularioEntidad
            onCerrar={() => setCreandoEntidad(false)}
            onGuardada={(nueva) => {
              setEntidades((prev) =>
                [...prev.filter((x) => x.id !== nueva.id), nueva].sort((a, b) =>
                  a.nombre.localeCompare(b.nombre, "es")
                )
              );
              elegirEntidad(nueva);
            }}
          />
        ) : entidad && !buscando ? (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-ink/15 bg-cream px-2.5 py-2">
            <div className="min-w-0 text-[13px]">
              <p className="font-semibold text-ink">{entidad.nombre}</p>
              <p className="font-mono text-xs text-ink/70">
                RUC {entidad.ruc} DV {entidad.dv}
              </p>
              {/verificar/i.test(entidad.notas) && (
                <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">⚠ {entidad.notas}</p>
              )}
            </div>
            <button
              className="shrink-0 text-xs text-clay hover:underline"
              onClick={() => setBuscando(true)}
            >
              Cambiar
            </button>
          </div>
        ) : (
          <div>
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre, sigla o RUC…"
              aria-label="Buscar entidad fiscal"
              className={inputCls}
              autoFocus={buscando}
            />
            <div className="mt-1 max-h-36 overflow-y-auto rounded-lg border border-ink/10">
              {filtrarEntidades(busqueda, entidades)
                .slice(0, 8)
                .map((e) => (
                  <button
                    key={e.id}
                    onClick={() => elegirEntidad(e)}
                    className="flex w-full items-baseline justify-between gap-2 px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-clay/10"
                  >
                    <span className="min-w-0 truncate text-ink">{e.nombre}</span>
                    <span className="shrink-0 font-mono text-xs text-ink/60">
                      {e.ruc} DV {e.dv}
                    </span>
                  </button>
                ))}
              {filtrarEntidades(busqueda, entidades).length === 0 && (
                <p className="px-2.5 py-2 text-xs text-ink/60">
                  Ninguna entidad del directorio coincide.
                </p>
              )}
            </div>
            {/* El receptor que no está en el directorio se da de alta aquí
                mismo: mandar al usuario a otra pantalla le costaría lo que
                lleve tecleado de la factura. */}
            <button
              onClick={() => setCreandoEntidad(true)}
              className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-clay hover:underline"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> Nueva entidad fiscal
            </button>
          </div>
        )}
      </div>

      {/* ------------------- Datos que exige la DGI ----------------------- */}
      <div className="grid grid-cols-2 gap-2.5">
        <Campo etiqueta="Dirección de la entidad">
          <input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            maxLength={100}
            placeholder="Mín. 5 caracteres"
            aria-label="Dirección de la entidad"
            className={inputCls}
          />
        </Campo>
        <Campo etiqueta="Ubicación DGI (prov-dist-corr)">
          <input
            value={ubicacion}
            onChange={(e) => setUbicacion(e.target.value)}
            list="ubicaciones-dgi"
            placeholder="Ej. 8-8-14"
            aria-label="Código de ubicación DGI"
            className={inputCls}
          />
          <p className="mt-0.5 text-xs text-ink/60">
            {ubicacionResuelta
              ? `${ubicacionResuelta.provincia} / ${ubicacionResuelta.distrito} / ${ubicacionResuelta.corregimiento}`
              : ubicacion.trim()
                ? "Código fuera del catálogo DGI"
                : "Obligatoria con receptor gobierno"}
          </p>
        </Campo>
        <Campo etiqueta="Correo del acto">
          <input
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            type="email"
            placeholder="El publicado en el acto"
            aria-label="Correo del receptor"
            className={inputCls}
          />
        </Campo>
        <Campo etiqueta="Correo adicional (opcional)">
          <input
            value={correoAdicional}
            onChange={(e) => setCorreoAdicional(e.target.value)}
            type="email"
            placeholder="Si el cliente facilita otro"
            aria-label="Correo adicional"
            className={inputCls}
          />
        </Campo>
      </div>

      {/* --------------------------- Renglones ---------------------------- */}
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink/60">
          {p ? "Renglones (de la cotización)" : "Renglones (a mano)"}
        </p>
        {renglones.length === 0 && (
          <p className="rounded-lg border border-dashed border-ink/15 px-2.5 py-3 text-center text-xs text-ink/60">
            {p ? "La cotización ligada no tiene renglones." : "Agrega el primer renglón."}
          </p>
        )}
        <div className="space-y-1.5">
          {renglones.map((r, i) => (
            <div
              key={i}
              className={`rounded-lg border px-2.5 py-2 ${r.incluir ? "border-ink/10" : "border-ink/10 opacity-50"}`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={r.incluir}
                  onChange={(e) => campoRenglon(i, { incluir: e.target.checked })}
                  aria-label={`Incluir el renglón ${i + 1}`}
                  className="h-4 w-4 shrink-0 accent-clay"
                />
                <input
                  value={r.descripcion}
                  onChange={(e) => campoRenglon(i, { descripcion: e.target.value })}
                  placeholder={p ? undefined : "Qué se cobra"}
                  aria-label={`Descripción del renglón ${i + 1}`}
                  className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-[13px] text-ink outline-none hover:border-ink/15 focus:border-clay"
                />
                {/* Quitar existe SOLO en la libre: con proyecto, los renglones
                    son los de la cotización y para dejar uno fuera está la
                    casilla —borrarlo escondería lo que no se facturó. */}
                {!p && renglones.length > 1 && (
                  <button
                    onClick={() => setRenglones((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Quitar el renglón ${i + 1}`}
                    className="shrink-0 text-ink/50 hover:text-red-700 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </div>
              {r.incluir && (
                <div className="mt-1.5 space-y-1.5 pl-6 text-xs">
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3.5rem_auto] items-end gap-1.5">
                    <label className="block min-w-0">
                      <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink/60">Cant.</span>
                      <input
                        value={String(r.cantidad)}
                        onChange={(e) => campoRenglon(i, { cantidad: Number(e.target.value) || 0 })}
                        inputMode="decimal"
                        aria-label="Cantidad"
                        className="w-full min-w-0 rounded border border-ink/15 px-1.5 py-1 text-ink outline-none focus:border-clay"
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink/60">Precio unit.</span>
                      <input
                        value={String(r.precio_unitario)}
                        onChange={(e) => campoRenglon(i, { precio_unitario: Number(e.target.value) || 0 })}
                        inputMode="decimal"
                        aria-label="Precio unitario"
                        className="w-full min-w-0 rounded border border-ink/15 px-1.5 py-1 text-right text-ink outline-none focus:border-clay"
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink/60">Unidad</span>
                      <input
                        value={r.unidad_medida}
                        onChange={(e) => campoRenglon(i, { unidad_medida: e.target.value })}
                        aria-label="Unidad de medida"
                        className="w-full min-w-0 rounded border border-ink/15 px-1.5 py-1 text-ink outline-none focus:border-clay"
                      />
                    </label>
                    <label className="flex items-center gap-1 pb-1.5 text-ink/70">
                      <input
                        type="checkbox"
                        checked={r.itbms_exento}
                        onChange={(e) => campoRenglon(i, { itbms_exento: e.target.checked })}
                        className="h-3.5 w-3.5 accent-clay"
                      />
                      exento
                    </label>
                  </div>
                  <div>
                    <input
                      value={r.cpbs}
                      onChange={(e) => campoRenglon(i, { cpbs: e.target.value.trim() })}
                      list="cpbs-familias"
                      placeholder="CPBS — familia de 4 dígitos"
                      aria-label="Familia CPBS"
                      className={`w-full min-w-0 rounded border px-1.5 py-1 font-mono text-ink outline-none focus:border-clay ${/^\d{4}$/.test(r.cpbs) ? "border-ink/15" : "border-amber-500"}`}
                    />
                    <p className="mt-0.5 text-[11px] text-ink/60">
                      {/^\d{4}$/.test(r.cpbs)
                        ? (familiaCpbs(r.cpbs)?.nombre ?? "Código fuera del catálogo CPBS")
                        : "Obligatorio con receptor gobierno"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {!p && (
          <button
            onClick={() => setRenglones((prev) => [...prev, renglonVacio()])}
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-clay hover:underline"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Agregar renglón
          </button>
        )}
        {sinDescripcion > 0 && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            {sinDescripcion} renglón{sinDescripcion === 1 ? "" : "es"} sin descripción — es lo que
            el cliente lee en el CAFE.
          </p>
        )}
        {sinCpbs > 0 && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            {sinCpbs} renglón{sinCpbs === 1 ? "" : "es"} sin CPBS — obligatorio con gobierno, es la
            causa nº 1 de rechazo.
          </p>
        )}
      </div>

      {/* ----------------------- Pago y retención ------------------------- */}
      <div className="grid grid-cols-2 gap-2.5">
        <Campo etiqueta="Forma de pago">
          <select
            value={formaPago}
            onChange={(e) => setFormaPago(e.target.value as typeof formaPago)}
            aria-label="Forma de pago"
            className={inputCls}
          >
            <option value="01">Crédito</option>
            <option value="08">Transferencia</option>
            <option value="09">Cheque</option>
            <option value="02">Efectivo</option>
          </select>
        </Campo>
        <Campo etiqueta="Retención 50 % ITBMS">
          <label className="flex min-h-[34px] items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={retener}
              onChange={(e) => setRetener(e.target.checked)}
              className="h-4 w-4 accent-clay"
            />
            Venta al Estado
          </label>
        </Campo>
      </div>

      {/* --------------------- Términos de pago (cuotas) ------------------- */}
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink/60">
          Términos de pago
        </p>
        <div className="space-y-1.5">
          {cuotas.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-14 shrink-0 text-xs text-ink/60">
                Cuota {i + 1}
              </span>
              <input
                type="date"
                value={c.vence}
                onChange={(e) =>
                  setCuotas((prev) => prev.map((x, j) => (j === i ? { ...x, vence: e.target.value } : x)))
                }
                aria-label={`Vencimiento de la cuota ${i + 1}`}
                className="min-w-0 flex-1 rounded-lg border border-ink/15 px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-clay"
              />
              <input
                value={cuotas.length === 1 ? monedaContable(totales.total) : c.monto}
                onChange={(e) =>
                  setCuotas((prev) => prev.map((x, j) => (j === i ? { ...x, monto: e.target.value } : x)))
                }
                disabled={cuotas.length === 1}
                inputMode="decimal"
                placeholder="Monto"
                aria-label={`Monto de la cuota ${i + 1}`}
                className="w-28 shrink-0 rounded-lg border border-ink/15 px-2.5 py-1.5 text-right font-mono text-[13px] text-ink outline-none focus:border-clay disabled:bg-cream disabled:text-ink/70"
              />
              {cuotas.length > 1 && (
                <button
                  onClick={() => setCuotas((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`Quitar la cuota ${i + 1}`}
                  className="shrink-0 text-xs text-ink/60 hover:text-clay"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-1 flex items-center justify-between">
          <button
            onClick={() =>
              setCuotas((prev) => [...prev, { vence: fechaPanamaMas(30 * (prev.length + 1)), monto: "" }])
            }
            className="text-xs text-clay hover:underline"
          >
            + Agregar cuota
          </button>
          {cuotas.length > 1 && (
            <span className={`text-xs ${cuotasCuadran ? "text-ink/60" : "text-amber-700 dark:text-amber-400"}`}>
              Σ cuotas {monedaContable(sumaCuotas)} / total {monedaContable(totales.total)}
              {!cuotasCuadran && " — deben cuadrar al centavo"}
            </span>
          )}
        </div>
      </div>

      {/* --------------------------- Totales ------------------------------ */}
      <div className="rounded-lg bg-cream px-3 py-2 text-[13px]">
        <div className="flex justify-between text-ink/70">
          <span>Parcial</span>
          <span className="font-mono">{monedaContable(totales.parcial)}</span>
        </div>
        <div className="flex justify-between text-ink/70">
          <span>ITBMS (renglón a renglón)</span>
          <span className="font-mono">{monedaContable(totales.itbms)}</span>
        </div>
        <div className="flex justify-between font-semibold text-ink">
          <span>Total factura</span>
          <span className="font-mono">{monedaContable(totales.total)}</span>
        </div>
        {retener && (
          <div className="mt-0.5 flex justify-between border-t border-ink/10 pt-0.5 text-xs text-ink/60">
            <span>Retención 50 % ITBMS (la retiene la entidad)</span>
            <span className="font-mono">−{monedaContable(retencion)}</span>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-100 px-2.5 py-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Boton variante="secundario" tamano="sm" onClick={onCerrar}>
          Cancelar
        </Boton>
        <Boton
          tamano="sm"
          onClick={() => void emitir()}
          disabled={!listaParaEmitir || emitiendo || !hka?.configurado}
        >
          {emitiendo ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Emitiendo…
            </>
          ) : (
            <>
              <Send className="h-4 w-4" aria-hidden /> Emitir factura
            </>
          )}
        </Boton>
      </div>

      {/* Catálogos DGI para los datalist (una sola vez por formulario). */}
      <datalist id="ubicaciones-dgi">
        {ubicacionesDgi().map((u) => (
          <option key={u.codigo} value={u.codigo}>
            {`${u.provincia} / ${u.distrito} / ${u.corregimiento}`}
          </option>
        ))}
      </datalist>
      <datalist id="cpbs-familias">
        {FAMILIAS_CPBS.map((f) => (
          <option key={f.codigo} value={f.codigo}>
            {f.nombre}
          </option>
        ))}
      </datalist>
    </section>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-ink/60">
        {etiqueta}
      </span>
      {children}
    </label>
  );
}
