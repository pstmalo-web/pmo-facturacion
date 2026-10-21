"use client";

// La pestaña de facturación: TODAS las facturas electrónicas del PMO en un
// solo sitio, con sus KPIs del mes y el camino para emitir una nueva.
//
// QUIÉN ENTRA (F0 del plan, decisión de Paul del 2026-08-18): todos menos el
// Cotizador. Auditor y Co-Founder MIRAN —es su razón de existir— y no ven ni
// un botón de acción; emitir, anular y reintentar son del gestor. Son dos
// permisos distintos y por eso son dos predicados (lib/perfil.ts):
// `puedeVerFacturacion` abre la puerta, `puedeEmitirFacturas` da los botones.
// La misma regla se lee en el menú (MenuPrincipal.tsx) — si las dos copias
// discrepan, alguien queda rebotando entre una pestaña visible y una ruta que
// lo expulsa.
//
// NADA de esto sustituye a la RLS: la migración 083 ya dice "equipo lee,
// gestor escribe" y el candado protege lo autorizado. Aquí solo se esconde lo
// que la base rechazaría, en vez de ofrecer botones que solo saben fallar.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Building2,
  ChevronDown,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { usePerfil } from "@/components/PerfilProvider";
import { puedeEmitirFacturas, puedeVerFacturacion } from "@/lib/perfil";
import { crearClienteNavegador } from "@/lib/supabase/client";
import {
  useFacturasTodas,
  type FacturaListada,
} from "@/lib/facturas/useFacturasData";
import {
  ESTADOS_FACTURA,
  type EntidadFiscal,
  type EstadoFactura,
} from "@/lib/facturas/tipos";
import { filtrarEntidades } from "@/lib/facturas/preparar";
import { PanelFacturas } from "@/components/facturacion/PanelFacturas";
import {
  FormularioFactura,
  type ProyectoFacturable,
} from "@/components/facturacion/FormularioFactura";
import { FormularioEntidad } from "@/components/facturacion/FormularioEntidad";
import { TituloSeccion } from "@/components/ui/TituloSeccion";
import { Boton } from "@/components/ui/Boton";
import { monedaContable } from "@/lib/format";

/** Estado de la integración, tal como lo responde GET /api/hka/folios. */
interface EstadoHka {
  configurado: boolean;
  ambiente?: string;
  disponiblesCiclo?: number | null;
  error?: string;
}

/** Proyecto del selector de "Nueva factura": lo mínimo para abrir el formulario
 *  (que solo mira id, cotización y O/C) más lo necesario para reconocerlo. */
type ProyectoDelSelector = ProyectoFacturable & {
  nombre: string;
  cliente: string | null;
  numero_acto: string | null;
};

/** Hoy en Panamá, YYYY-MM-DD. La zona importa: `new Date().toISOString()`
 *  adelanta el día a partir de las 19:00 locales y el "mes actual" del KPI
 *  cambiaría una tarde antes de tiempo. */
function hoyPanama(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Panama" }).format(
    new Date()
  );
}

/** La fecha por la que se ordena y se filtra una factura: la de emisión si ya
 *  se emitió, si no la de creación (un borrador o un rechazo también tienen
 *  que caer en algún día para que los filtros no los desaparezcan). */
function fechaDe(f: FacturaListada): string {
  return (f.fecha_emision ?? f.created_at ?? "").slice(0, 10);
}

function nombreEntidad(f: FacturaListada): string {
  if (f.entidad) return f.entidad.siglas || f.entidad.nombre;
  // Sin entidad ligada (se borró), el snapshot del receptor guarda la razón
  // social con la que se facturó: lo facturado queda como se facturó.
  const razon = (f.receptor as { razonSocial?: string } | null)?.razonSocial;
  return razon || "—";
}

export default function VistaFacturacion() {
  const { perfil, cargando: cargandoPerfil } = usePerfil();
  const router = useRouter();

  // Sin perfil (aún cargando, o falló la lectura) NO se bloquea: el
  // PerfilProvider deja los flags en false como "no sabemos", no como "no
  // tiene permiso", y expulsar por un fallo de red sería castigar al usuario
  // por un error nuestro. Mismo criterio que la guarda del Dashboard.
  const bloqueado = !cargandoPerfil && !!perfil && !puedeVerFacturacion(perfil.rol);
  useEffect(() => {
    if (bloqueado) router.replace("/cotizaciones");
  }, [bloqueado, router]);
  const puedeEmitir = !!perfil && puedeEmitirFacturas(perfil.rol);

  const { facturas, error, cargando, refrescar } = useFacturasTodas(!bloqueado);
  const [hka, setHka] = useState<EstadoHka | null>(null);
  useEffect(() => {
    if (bloqueado) return;
    let vivo = true;
    fetch("/api/hka/folios")
      .then((r) => r.json())
      .then((j: EstadoHka) => vivo && setHka(j))
      .catch(() => vivo && setHka({ configurado: false }));
    return () => {
      vivo = false;
    };
  }, [bloqueado]);

  // ---------------------------------------------------------------- filtros
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<EstadoFactura | "todos">("todos");
  const [ambiente, setAmbiente] = useState<"demo" | "produccion" | "todos">("todos");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const hayFiltro =
    texto.trim() !== "" || estado !== "todos" || ambiente !== "todos" || desde !== "" || hasta !== "";
  const limpiarFiltros = useCallback(() => {
    setTexto("");
    setEstado("todos");
    setAmbiente("todos");
    setDesde("");
    setHasta("");
  }, []);

  const visibles = useMemo(() => {
    if (!facturas) return [];
    const q = texto.trim().toLowerCase();
    return facturas.filter((f) => {
      if (estado !== "todos" && f.estado !== estado) return false;
      if (ambiente !== "todos" && f.ambiente !== ambiente) return false;
      const fecha = fechaDe(f);
      if (desde && fecha < desde) return false;
      if (hasta && fecha > hasta) return false;
      if (!q) return true;
      // Se busca por lo que uno tiene a mano cuando busca una factura: el
      // número que le dictaron, la institución, el proyecto o el CUFE de un
      // correo. El número va sin ceros y con ellos (04 encuentra la 0000000004).
      const heno = [
        f.numero_documento == null ? "" : String(f.numero_documento),
        f.numero_documento == null ? "" : String(f.numero_documento).padStart(10, "0"),
        nombreEntidad(f),
        f.entidad?.nombre ?? "",
        f.proyecto?.nombre ?? "",
        f.proyecto?.numero_acto ?? "",
        f.cufe ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return heno.includes(q);
    });
  }, [facturas, texto, estado, ambiente, desde, hasta]);

  // ------------------------------------------------------------------- KPIs
  // Se cuenta el AMBIENTE ACTIVO de la integración, no todo lo que hay en la
  // tabla: mientras HKA esté en demo, las cifras del mes son las de los
  // ensayos —y el rótulo lo dice—; el día que se pase a producción el mismo
  // bloque empieza a contar lo real sin mezclar una cosa con la otra. Los
  // folios que se enseñan al lado son de ese mismo ambiente.
  const ambienteActivo = (hka?.ambiente ?? "demo").trim();
  const kpis = useMemo(() => {
    const mes = hoyPanama().slice(0, 7);
    // Solo AUTORIZADAS: una anulada dejó de existir para la DGI y un rechazo
    // nunca existió; sumarlos inflaría el mes con documentos que no cobran.
    const delMes = (facturas ?? []).filter(
      (f) =>
        f.ambiente === ambienteActivo &&
        f.estado === "autorizada" &&
        fechaDe(f).startsWith(mes)
    );
    return {
      emitidas: delMes.length,
      monto: delMes.reduce((s, f) => s + Number(f.total), 0),
      retenido: delMes.reduce((s, f) => s + Number(f.retencion_monto ?? 0), 0),
    };
  }, [facturas, ambienteActivo]);

  // -------------------------------------------------- emisión (nueva factura)
  // `camino` es cuál de los dos se está usando: "proyecto" pide elegir uno,
  // "libre" abre el formulario en blanco (F2). Null = el panel está cerrado.
  const [camino, setCamino] = useState<"proyecto" | "libre" | null>(null);
  const emitiendo = camino !== null;
  const [proyectos, setProyectos] = useState<ProyectoDelSelector[] | null>(null);
  const [busquedaProyecto, setBusquedaProyecto] = useState("");
  const [elegido, setElegido] = useState<ProyectoDelSelector | null>(null);

  useEffect(() => {
    // Los proyectos del selector se cargan al abrir el panel, no al entrar a
    // la pestaña: la mayoría de las visitas es a mirar el listado. La factura
    // libre no los necesita nunca.
    if (camino !== "proyecto" || proyectos) return;
    const supabase = crearClienteNavegador();
    void supabase
      .from("proyectos")
      .select("id, nombre, cliente, numero_acto, cotizacion_id, numero_oc")
      .not("cotizacion_id", "is", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(300)
      .then(({ data }) => setProyectos((data as ProyectoDelSelector[]) ?? []));
  }, [camino, proyectos]);

  const proyectosVisibles = useMemo(() => {
    const q = busquedaProyecto.trim().toLowerCase();
    const lista = proyectos ?? [];
    if (!q) return lista.slice(0, 40);
    return lista
      .filter((p) =>
        `${p.nombre} ${p.cliente ?? ""} ${p.numero_acto ?? ""}`.toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [proyectos, busquedaProyecto]);

  // ------------------------------------------------- directorio fiscal (F2)
  // El directorio se pliega por defecto: es el respaldo de la facturación, no
  // lo que se viene a mirar. Se carga al abrirlo, no al entrar a la pestaña.
  const [directorio, setDirectorio] = useState(false);
  const [entidades, setEntidades] = useState<EntidadFiscal[] | null>(null);
  const [busquedaEntidad, setBusquedaEntidad] = useState("");
  /** undefined = nadie se edita · null = alta · entidad = edición de esa. */
  const [editando, setEditando] = useState<EntidadFiscal | null | undefined>(undefined);

  useEffect(() => {
    if (!directorio || entidades) return;
    const supabase = crearClienteNavegador();
    void supabase
      .from("entidades_fiscales")
      .select("*")
      .order("nombre")
      .then(({ data }) => setEntidades((data as EntidadFiscal[]) ?? []));
  }, [directorio, entidades]);

  const entidadesVisibles = useMemo(
    () => filtrarEntidades(busquedaEntidad, entidades ?? []).slice(0, 60),
    [entidades, busquedaEntidad]
  );

  function guardadaEntidad(e: EntidadFiscal) {
    setEntidades((prev) =>
      [...(prev ?? []).filter((x) => x.id !== e.id), e].sort((a, b) =>
        a.nombre.localeCompare(b.nombre, "es")
      )
    );
    setEditando(undefined);
  }

  function cerrarEmision() {
    setCamino(null);
    setElegido(null);
    setBusquedaProyecto("");
  }

  if (bloqueado) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Facturación</h1>
          <p className="mt-1 text-sm text-ink/70">
            Facturas electrónicas emitidas desde el PMO (serie 0000-002) —{" "}
            <span className="font-medium text-ink">
              {facturas?.length ?? 0} en total
            </span>
            {hka && !hka.configurado && (
              <>
                {" "}· <span className="font-medium text-ink">sin credenciales de HKA</span>
              </>
            )}
            {hka?.configurado && ambienteActivo !== "produccion" && (
              <>
                {" "}·{" "}
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                  AMBIENTE DEMO
                </span>
              </>
            )}
          </p>
        </div>
        {puedeEmitir && !emitiendo && (
          <div className="flex flex-wrap items-center gap-2">
            <Boton onClick={() => setCamino("proyecto")}>
              <Plus className="h-4 w-4" aria-hidden /> Facturar un proyecto
            </Boton>
            {/* El segundo camino (F2): cobrar algo que nunca pasó por el
                board — un servicio suelto, una reposición, una nota de cobro. */}
            <Boton variante="secundario" onClick={() => setCamino("libre")}>
              <Plus className="h-4 w-4" aria-hidden /> Factura libre
            </Boton>
          </div>
        )}
      </header>

      {/* KPIs del mes. Viven SOLO aquí (decisión de F0): el Dashboard no se
          toca mientras las únicas cifras sean ensayos de demo, y la cuenta se
          hace en el cliente sobre esta misma tabla —es chica— en vez de pagar
          la cirugía de kpis_dashboard por cuatro números. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          etiqueta={`Emitidas este mes${ambienteActivo === "produccion" ? "" : " (demo)"}`}
          valor={String(kpis.emitidas)}
        />
        <Kpi etiqueta="Monto facturado" valor={monedaContable(kpis.monto)} />
        <Kpi
          etiqueta="Retenido (50 % ITBMS)"
          valor={monedaContable(kpis.retenido)}
          nota="Lo que la entidad retiene y no entra en el cobro"
        />
        <Kpi
          etiqueta="Folios del ciclo"
          valor={
            hka == null
              ? "…"
              : !hka.configurado
                ? "—"
                : hka.disponiblesCiclo == null
                  ? "?"
                  : hka.disponiblesCiclo.toLocaleString("es-PA")
          }
          nota={hka?.error ?? (hka?.configurado === false ? "HKA sin configurar" : undefined)}
        />
      </section>

      {emitiendo && (
        <section className="rounded-2xl border border-clay/30 bg-white p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <TituloSeccion
              icono={FileText}
              nivel="h2"
              titulo={
                camino === "libre"
                  ? "Factura libre"
                  : elegido
                    ? `Facturar: ${elegido.nombre}`
                    : "¿Qué proyecto se factura?"
              }
              descripcion={
                camino === "libre"
                  ? "Sin proyecto: los renglones se teclean y la entidad sale del directorio fiscal."
                  : elegido
                    ? undefined
                    : "Un proyecto con cotización: de ahí salen los renglones, la institución y el correo del acto."
              }
            />
            <button
              onClick={cerrarEmision}
              className="shrink-0 rounded-lg p-1 text-ink/60 hover:bg-cream hover:text-ink"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {/* El MISMO formulario en los dos caminos: sin `p` se abre en modo
              libre. Lo que la DGI exige es idéntico, y dos formularios
              divergirían justo en la validación fiscal. */}
          {camino === "libre" || elegido ? (
            <FormularioFactura
              p={elegido}
              onCerrar={() => setElegido(null)}
              onEmitida={() => {
                void refrescar();
                cerrarEmision();
              }}
            />
          ) : (
            <>
              <div className="relative mb-2">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40"
                  aria-hidden
                />
                <input
                  value={busquedaProyecto}
                  onChange={(e) => setBusquedaProyecto(e.target.value)}
                  placeholder="Buscar proyecto por nombre, institución o número de acto"
                  aria-label="Buscar proyecto"
                  className="w-full rounded-lg border border-ink/15 py-2 pl-9 pr-3 text-sm text-ink outline-none focus:border-clay"
                  autoFocus
                />
              </div>
              {proyectos == null ? (
                <p className="flex items-center gap-2 py-4 text-sm text-ink/60">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando proyectos…
                </p>
              ) : proyectosVisibles.length === 0 ? (
                <p className="py-4 text-sm text-ink/60">
                  Ningún proyecto con cotización coincide con la búsqueda.
                </p>
              ) : (
                <ul className="max-h-72 space-y-1 overflow-y-auto">
                  {proyectosVisibles.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => setElegido(p)}
                        className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-cream"
                      >
                        <span className="font-medium text-ink">{p.nombre}</span>
                        <span className="block text-xs text-ink/60">
                          {[p.cliente, p.numero_acto].filter(Boolean).join(" · ") || "Sin acto"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-ink/10 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40"
              aria-hidden
            />
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Número, entidad, proyecto o CUFE"
              aria-label="Buscar factura"
              className="w-full rounded-lg border border-ink/15 py-2 pl-9 pr-3 text-sm text-ink outline-none focus:border-clay"
            />
          </div>
          <label className="text-xs text-ink/60">
            <span className="mb-0.5 block">Estado</span>
            <select
              value={estado}
              onChange={(e) => setEstado(e.target.value as EstadoFactura | "todos")}
              className="rounded-lg border border-ink/15 px-2 py-2 text-sm text-ink outline-none focus:border-clay"
            >
              <option value="todos">Todos</option>
              {ESTADOS_FACTURA.map((e) => (
                <option key={e.valor} value={e.valor}>
                  {e.etiqueta}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink/60">
            <span className="mb-0.5 block">Ambiente</span>
            <select
              value={ambiente}
              onChange={(e) => setAmbiente(e.target.value as "demo" | "produccion" | "todos")}
              className="rounded-lg border border-ink/15 px-2 py-2 text-sm text-ink outline-none focus:border-clay"
            >
              <option value="todos">Todos</option>
              <option value="produccion">Producción</option>
              <option value="demo">Demo (ensayos)</option>
            </select>
          </label>
          <label className="text-xs text-ink/60">
            <span className="mb-0.5 block">Desde</span>
            <input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded-lg border border-ink/15 px-2 py-2 text-sm text-ink outline-none focus:border-clay"
            />
          </label>
          <label className="text-xs text-ink/60">
            <span className="mb-0.5 block">Hasta</span>
            <input
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded-lg border border-ink/15 px-2 py-2 text-sm text-ink outline-none focus:border-clay"
            />
          </label>
          {hayFiltro && (
            <button
              onClick={limpiarFiltros}
              className="inline-flex items-center gap-1 py-2 text-xs text-clay hover:underline"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Limpiar
            </button>
          )}
        </div>

        {error && (
          <p className="mb-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
            No se pudo leer el listado: {error}
          </p>
        )}

        {cargando ? (
          <p className="flex items-center gap-2 py-6 text-sm text-ink/60">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando facturas…
          </p>
        ) : visibles.length === 0 ? (
          // Se distingue "no hay ninguna" de "ninguna pasa el filtro": con la
          // segunda, el usuario tiene algo que deshacer y hay que decírselo.
          <p className="py-6 text-sm text-ink/60">
            {hayFiltro
              ? "Ninguna factura coincide con estos filtros."
              : "Todavía no se ha emitido ninguna factura desde el PMO."}
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-ink/60">
              {visibles.length === facturas?.length
                ? `${visibles.length} facturas`
                : `${visibles.length} de ${facturas?.length ?? 0} facturas`}
            </p>
            <PanelFacturas
              facturas={visibles}
              refrescar={refrescar}
              puedeEditar={puedeEmitir}
              titulo={null}
              contexto={(f) => {
                const l = f as FacturaListada;
                return (
                  <p className="truncate text-[13px] font-semibold text-ink">
                    {nombreEntidad(l)}
                    {l.proyecto && (
                      <span className="font-normal text-ink/60">
                        {" "}· {l.proyecto.numero_acto ?? l.proyecto.nombre}
                      </span>
                    )}
                  </p>
                );
              }}
            />
          </>
        )}
      </section>

      {/* ----------------------- Directorio fiscal (F2) -------------------- */}
      <section className="rounded-2xl border border-ink/10 bg-white p-4">
        <button
          onClick={() => setDirectorio((v) => !v)}
          aria-expanded={directorio}
          className="flex w-full items-start gap-3 text-left"
        >
          <TituloSeccion
            icono={Building2}
            titulo="Directorio fiscal"
            descripcion="A quién se le puede facturar: RUC, DV y ubicación DGI de cada institución."
          >
            {entidades && (
              <span className="text-xs text-ink/60">{entidades.length} entidades</span>
            )}
          </TituloSeccion>
          <ChevronDown
            className={`mt-1 h-4 w-4 shrink-0 text-ink/50 transition-transform ${directorio ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>

        {directorio && (
          <div className="mt-3">
            {editando !== undefined ? (
              <FormularioEntidad
                entidad={editando}
                onCerrar={() => setEditando(undefined)}
                onGuardada={guardadaEntidad}
              />
            ) : (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[220px] flex-1">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40"
                      aria-hidden
                    />
                    <input
                      value={busquedaEntidad}
                      onChange={(e) => setBusquedaEntidad(e.target.value)}
                      placeholder="Buscar por nombre, sigla o RUC"
                      aria-label="Buscar entidad fiscal"
                      className="w-full rounded-lg border border-ink/15 py-2 pl-9 pr-3 text-sm text-ink outline-none focus:border-clay"
                    />
                  </div>
                  {puedeEmitir && (
                    <Boton variante="secundario" tamano="sm" onClick={() => setEditando(null)}>
                      <Plus className="h-4 w-4" aria-hidden /> Nueva entidad
                    </Boton>
                  )}
                </div>

                {entidades == null ? (
                  <p className="flex items-center gap-2 py-4 text-sm text-ink/60">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando el directorio…
                  </p>
                ) : entidadesVisibles.length === 0 ? (
                  <p className="py-4 text-sm text-ink/60">Ninguna entidad coincide.</p>
                ) : (
                  <ul className="max-h-96 divide-y divide-ink/5 overflow-y-auto">
                    {entidadesVisibles.map((e) => (
                      <li
                        key={e.id}
                        className="flex items-start justify-between gap-3 py-1.5 text-[13px]"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">
                            {e.nombre}
                            {/* Verificada contra ConsultaRucDv: el sello dice
                                que el DV lo confirmó la DGI, no nosotros. */}
                            {e.verificado_en && (
                              <BadgeCheck
                                className="ml-1 inline h-3.5 w-3.5 text-green-700 dark:text-green-400"
                                aria-label="RUC verificado con la DGI"
                              />
                            )}
                          </p>
                          <p className="truncate font-mono text-xs text-ink/60">
                            {e.ruc} DV {e.dv}
                            {e.codigo_ubicacion && <> · {e.codigo_ubicacion}</>}
                          </p>
                          {/verificar|no facturar/i.test(e.notas) && (
                            <p className="text-xs text-amber-700 dark:text-amber-400">⚠ {e.notas}</p>
                          )}
                        </div>
                        {puedeEmitir && (
                          <button
                            onClick={() => setEditando(e)}
                            aria-label={`Editar ${e.nombre}`}
                            className="shrink-0 rounded-lg p-1 text-ink/50 hover:bg-cream hover:text-ink"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Kpi({
  etiqueta,
  valor,
  nota,
}: {
  etiqueta: string;
  valor: string;
  nota?: string;
}) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/60">
        {etiqueta}
      </p>
      <p className="mt-0.5 font-mono text-xl font-bold text-ink">{valor}</p>
      {nota && <p className="mt-0.5 text-[11px] text-ink/50">{nota}</p>}
    </div>
  );
}
