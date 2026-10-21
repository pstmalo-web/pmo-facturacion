"use client";

// Alta y edición de una entidad fiscal (el directorio que la 084 sembró con
// 85 instituciones). Vive dentro de la pestaña de facturación porque es donde
// duele su ausencia: la factura libre no nace de ningún acto, así que si el
// receptor no está en el directorio no hay de dónde sacarlo.
//
// LA REGLA QUE MANDA AQUÍ: el RUC y el DV de una entidad del Estado NUNCA se
// deducen ni se corrigen solos. `ConsultaRucDv` de la DGI arbitra —esta
// pantalla la llama de a uno con el botón «Consultar en la DGI»— y la decisión
// la toma un humano con el veredicto delante. Por eso el DV de la DGI se
// ofrece con un botón que hay que apretar, y nunca se escribe en el campo por
// su cuenta: un DV equivocado no rompe nada aquí, rompe la factura, y para
// entonces ya consumió un número fiscal.
//
// `verificado_en` se estampa SOLO si la última consulta dijo "coincide" sobre
// el RUC y el DV que están escritos en este momento; tocar cualquiera de los
// dos después de consultar invalida la verificación (`consultado`).
import { useMemo, useState } from "react";
import { BadgeCheck, CircleAlert, Loader2, Search } from "lucide-react";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { buscarUbicacion, ubicacionesDgi } from "@/lib/hka/catalogos";
import type { EntidadFiscal } from "@/lib/facturas/tipos";
import type { VeredictoDv } from "@/lib/facturas/preparar";
import { Boton } from "@/components/ui/Boton";
import { useToast } from "@/components/ui/Toast";

interface RespuestaDgi {
  dv_dgi: string | null;
  razon_dgi: string | null;
  afiliado_fe: boolean | null;
  veredicto: VeredictoDv;
}

export function FormularioEntidad({
  entidad,
  onCerrar,
  onGuardada,
}: {
  /** Sin entidad = alta. Con entidad = edición de esa fila. */
  entidad?: EntidadFiscal | null;
  onCerrar: () => void;
  onGuardada: (e: EntidadFiscal) => void;
}) {
  const toast = useToast();
  const [nombre, setNombre] = useState(entidad?.nombre ?? "");
  const [siglas, setSiglas] = useState(entidad?.siglas ?? "");
  const [tipoRuc, setTipoRuc] = useState<"1" | "2">(entidad?.tipo_ruc ?? "2");
  const [ruc, setRuc] = useState(entidad?.ruc ?? "");
  const [dv, setDv] = useState(entidad?.dv ?? "");
  const [razonSocial, setRazonSocial] = useState(entidad?.razon_social ?? "");
  const [direccion, setDireccion] = useState(entidad?.direccion ?? "");
  const [ubicacion, setUbicacion] = useState(entidad?.codigo_ubicacion ?? "");
  const [correo, setCorreo] = useState(entidad?.correo ?? "");
  const [telefono, setTelefono] = useState(entidad?.telefono ?? "");

  const [consultando, setConsultando] = useState(false);
  const [dgi, setDgi] = useState<RespuestaDgi | null>(null);
  // Sobre QUÉ ruc+dv se hizo la última consulta: si cambian, lo que dijo la
  // DGI dejó de referirse a lo que hay escrito.
  const [consultado, setConsultado] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clave = `${ruc.trim()}|${dv.trim()}`;
  const vigente = dgi && consultado === clave ? dgi : null;
  const ubicacionResuelta = useMemo(() => buscarUbicacion(ubicacion.trim()), [ubicacion]);

  const listaParaGuardar =
    nombre.trim().length >= 2 &&
    ruc.trim().length >= 3 &&
    /^\d{1,2}$/.test(dv.trim()) &&
    razonSocial.trim().length >= 2;

  async function consultarDgi() {
    setConsultando(true);
    setError(null);
    const res = await fetch("/api/hka/consultar-ruc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo_ruc: tipoRuc, ruc: ruc.trim(), dv: dv.trim() || null }),
    });
    const cuerpo = await res.json().catch(() => ({}));
    setConsultando(false);
    if (!res.ok) {
      setDgi(null);
      setConsultado(null);
      setError(cuerpo.error ?? "No se pudo consultar la DGI.");
      return;
    }
    setDgi(cuerpo as RespuestaDgi);
    setConsultado(clave);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    const supabase = crearClienteNavegador();
    const fila = {
      nombre: nombre.trim(),
      siglas: siglas.trim() || null,
      tipo_ruc: tipoRuc,
      ruc: ruc.trim(),
      dv: dv.trim(),
      razon_social: razonSocial.trim(),
      direccion: direccion.trim(),
      codigo_ubicacion: ubicacionResuelta?.codigo ?? null,
      provincia: ubicacionResuelta?.provincia ?? null,
      distrito: ubicacionResuelta?.distrito ?? null,
      corregimiento: ubicacionResuelta?.corregimiento ?? null,
      correo: correo.trim() || null,
      telefono: telefono.trim() || null,
      // Solo la coincidencia estampa la verificación. Un "dv_distinto" que se
      // guarda igual (porque el humano decidió que su dato es el bueno) queda
      // SIN verificar, que es exactamente lo que es.
      ...(vigente?.veredicto === "coincide"
        ? { verificado_en: new Date().toISOString(), afiliado_fe: vigente.afiliado_fe }
        : {}),
      updated_at: new Date().toISOString(),
    };

    const consulta = entidad
      ? supabase.from("entidades_fiscales").update(fila).eq("id", entidad.id).select("*").single()
      : supabase.from("entidades_fiscales").insert(fila).select("*").single();
    const { data, error: errorBd } = await consulta;
    setGuardando(false);
    if (errorBd || !data) {
      setError(
        errorBd?.code === "23505"
          ? "Ya hay una entidad con ese RUC en el directorio."
          : (errorBd?.message ?? "No se pudo guardar la entidad.")
      );
      return;
    }
    toast.mostrar({
      tipo: "ok",
      mensaje: entidad ? "Entidad actualizada." : "Entidad agregada al directorio.",
    });
    onGuardada(data as EntidadFiscal);
  }

  const inputCls =
    "w-full rounded-lg border border-ink/15 px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-clay";

  return (
    <section className="min-w-0 animate-[aparecer_150ms_ease-out] space-y-3 rounded-xl border border-clay/30 bg-white p-3.5">
      <h3 className="text-[13px] font-bold text-ink">
        {entidad ? `Editar ${entidad.nombre}` : "Nueva entidad fiscal"}
      </h3>

      <div className="grid grid-cols-2 gap-2.5">
        <Campo etiqueta="Nombre interno">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Como lo escribe el equipo (MEDUCA)"
            aria-label="Nombre interno"
            className={inputCls}
            autoFocus
          />
        </Campo>
        <Campo etiqueta="Siglas (opcional)">
          <input
            value={siglas}
            onChange={(e) => setSiglas(e.target.value)}
            aria-label="Siglas"
            className={inputCls}
          />
        </Campo>
        <Campo etiqueta="Tipo de RUC">
          <select
            value={tipoRuc}
            onChange={(e) => setTipoRuc(e.target.value as "1" | "2")}
            aria-label="Tipo de RUC"
            className={inputCls}
          >
            <option value="2">Jurídico (las entidades del Estado)</option>
            <option value="1">Natural</option>
          </select>
        </Campo>
        <Campo etiqueta="RUC">
          <input
            value={ruc}
            onChange={(e) => setRuc(e.target.value)}
            placeholder="8-NT-1-13656"
            aria-label="RUC"
            className={`${inputCls} font-mono`}
          />
        </Campo>
        <Campo etiqueta="DV">
          <input
            value={dv}
            onChange={(e) => setDv(e.target.value.replace(/\D/g, "").slice(0, 2))}
            inputMode="numeric"
            placeholder="43"
            aria-label="Dígito verificador"
            className={`${inputCls} font-mono`}
          />
        </Campo>
        <Campo etiqueta="Razón social (como la registra la DGI)">
          <input
            value={razonSocial}
            onChange={(e) => setRazonSocial(e.target.value)}
            aria-label="Razón social"
            className={inputCls}
          />
        </Campo>
      </div>

      {/* ------------------------ Arbitraje de la DGI --------------------- */}
      <div className="rounded-lg border border-ink/10 bg-cream px-2.5 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink/70">
            El RUC y el DV los arbitra la DGI, no nosotros.
          </p>
          <button
            onClick={() => void consultarDgi()}
            disabled={consultando || ruc.trim().length < 3}
            className="inline-flex items-center gap-1 text-xs font-semibold text-clay hover:underline disabled:opacity-40"
          >
            {consultando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Search className="h-3.5 w-3.5" aria-hidden />
            )}
            Consultar en la DGI
          </button>
        </div>

        {vigente && (
          <div className="mt-1.5 text-xs">
            {vigente.veredicto === "coincide" && (
              <p className="flex items-start gap-1.5 text-green-800 dark:text-green-400">
                <BadgeCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  La DGI confirma el DV {vigente.dv_dgi}
                  {vigente.razon_dgi && <> — «{vigente.razon_dgi}»</>}
                  {vigente.afiliado_fe === false && " · aún no afiliada a factura electrónica"}
                </span>
              </p>
            )}
            {vigente.veredicto === "dv_distinto" && (
              <div className="flex flex-wrap items-center gap-2 text-amber-800 dark:text-amber-300">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  La DGI dice DV <strong className="font-mono">{vigente.dv_dgi}</strong>
                  {dv.trim() && <> y aquí está escrito {dv.trim()}</>}
                  {vigente.razon_dgi && <> — «{vigente.razon_dgi}»</>}
                </span>
                {vigente.dv_dgi && (
                  <button
                    onClick={() => setDv(vigente.dv_dgi!)}
                    className="font-semibold text-clay hover:underline"
                  >
                    Usar el DV de la DGI
                  </button>
                )}
                {vigente.razon_dgi && vigente.razon_dgi !== razonSocial.trim() && (
                  <button
                    onClick={() => setRazonSocial(vigente.razon_dgi!)}
                    className="font-semibold text-clay hover:underline"
                  >
                    Usar su razón social
                  </button>
                )}
              </div>
            )}
            {vigente.veredicto === "sin_respuesta" && (
              <p className="text-ink/60">
                La DGI no devolvió DV para ese RUC. Se puede guardar igual, pero queda sin
                verificar — y una factura a gobierno con RUC inválido rebota.
              </p>
            )}
          </div>
        )}
        {dgi && !vigente && (
          <p className="mt-1.5 text-xs text-ink/60">
            El RUC o el DV cambiaron después de consultar: hay que volver a preguntarle a la DGI.
          </p>
        )}
      </div>

      {/* --------------------- Datos del documento fiscal ------------------ */}
      <div className="grid grid-cols-2 gap-2.5">
        <Campo etiqueta="Dirección">
          <input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            maxLength={100}
            aria-label="Dirección"
            className={inputCls}
          />
        </Campo>
        <Campo etiqueta="Ubicación DGI (prov-dist-corr)">
          <input
            value={ubicacion}
            onChange={(e) => setUbicacion(e.target.value)}
            list="ubicaciones-dgi-entidad"
            placeholder="Ej. 8-8-14"
            aria-label="Código de ubicación DGI"
            className={inputCls}
          />
          <p className="mt-0.5 text-xs text-ink/60">
            {ubicacionResuelta
              ? `${ubicacionResuelta.provincia} / ${ubicacionResuelta.distrito} / ${ubicacionResuelta.corregimiento}`
              : ubicacion.trim()
                ? "Código fuera del catálogo DGI"
                : "Se puede completar al facturar"}
          </p>
        </Campo>
        <Campo etiqueta="Correo">
          <input
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            type="email"
            aria-label="Correo de la entidad"
            className={inputCls}
          />
        </Campo>
        <Campo etiqueta="Teléfono (opcional)">
          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            aria-label="Teléfono"
            className={inputCls}
          />
        </Campo>
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
        <Boton tamano="sm" onClick={() => void guardar()} disabled={!listaParaGuardar || guardando}>
          {guardando ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Guardando…
            </>
          ) : entidad ? (
            "Guardar cambios"
          ) : (
            "Agregar al directorio"
          )}
        </Boton>
      </div>

      <datalist id="ubicaciones-dgi-entidad">
        {ubicacionesDgi().map((u) => (
          <option key={u.codigo} value={u.codigo}>
            {`${u.provincia} / ${u.distrito} / ${u.corregimiento}`}
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
