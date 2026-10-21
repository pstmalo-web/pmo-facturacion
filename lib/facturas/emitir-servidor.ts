// Coreografía de emisión — SOLO SERVIDOR (usa lib/hka/cliente y sus env).
//
// El orden importa y cada paso deja rastro ANTES de dar el siguiente (patrón
// de biblioteca/chat: la fila se escribe antes de llamar al servicio):
//
//   armar documento (valida TODO)  →  payload + 'emitiendo' en la fila
//   →  Enviar (síncrono, devuelve CUFE)  →  'autorizada' + cufe/qr/protocolo
//   →  descargar CAFE y XML al bucket `facturas`
//   →  copia del CAFE al expediente (proyecto_archivos, tipo 'factura')
//   →  correo al receptor (mejor esfuerzo: su fallo NO deshace nada)
//
// Los tres finales posibles y qué significan:
// - 'autorizada': la DGI autorizó; la fila queda blindada por el trigger 083.
// - 'rechazada': HKA contestó con error → mensaje_error + respuesta cruda.
//   Se reintenta CON EL MISMO número (arreglando antes los datos de la
//   entidad, que se releen frescos en cada intento).
// - 'emitiendo' con mensaje_error: el request murió SIN respuesta — no se
//   sabe si entró. El reintento manda el mismo número: si ya estaba, HKA
//   contesta 102 (duplicado) y aquí se recupera consultando EstadoDocumento.
import type { SupabaseClient } from "@supabase/supabase-js";
import { armarDocumento } from "@/lib/hka/documento";
import {
  anularDocumento,
  descargarArchivo,
  enviarDocumento,
  envioCorreo,
  ErrorHka,
  esDocumentoDuplicado,
  estadoDocumento,
} from "@/lib/hka/cliente";
import type { CuotaPago, ReceptorFactura, RenglonFactura, SerieDocumento } from "@/lib/hka/tipos";
import {
  numeroFiscal,
  type EntidadFiscal,
  type Factura,
  type FacturaItemDb,
} from "@/lib/facturas/tipos";

/**
 * El ambiente de HKA configurado. Defecto "demo": si la variable faltara, el
 * error cae del lado de las pruebas y no del de emitir un documento fiscal
 * real por descuido. `trim()` porque las variables entran pegadas a mano.
 */
export function ambienteHka(): "demo" | "produccion" {
  const v = (process.env.HKA_AMBIENTE ?? "demo").trim();
  if (v === "demo" || v === "produccion") return v;
  // Un valor raro NO se redondea a "demo" en silencio: la fila quedaría
  // marcada como ensayo borrable mientras las credenciales apuntan a saber
  // dónde. Se rompe con el mismo mensaje que da lib/hka/cliente.
  throw new ErrorHka(
    "config",
    `HKA_AMBIENTE debe ser "demo" o "produccion" (llegó "${v}").`
  );
}

/** ¿Están las credenciales y la serie del PMO en el entorno? */
export function hkaConfigurado(): boolean {
  return Boolean(process.env.HKA_USUARIO && process.env.HKA_CLAVE && process.env.HKA_PUNTO);
}

/** La serie fiscal del PMO (el punto 002; Dfactura a mano usa el 001). */
export function serieDelPmo(): { sucursal: string; punto: string } {
  const punto = process.env.HKA_PUNTO?.trim();
  if (!punto) {
    throw new ErrorHka(
      "config",
      "Falta HKA_PUNTO en el entorno: la serie del PMO aún no está definida."
    );
  }
  return { sucursal: process.env.HKA_SUCURSAL?.trim() || "0000", punto };
}

function serieDe(f: Factura): SerieDocumento {
  return {
    sucursal: f.sucursal,
    puntoFacturacion: f.punto_facturacion,
    tipoDocumento: f.tipo_documento,
    numeroDocumento: f.numero_documento ?? 0,
  };
}

/**
 * Las cuotas del intento anterior, derivadas del payload guardado. Así el
 * reintento no necesita columna propia y respeta los plazos que el gestor
 * fijó la primera vez (undefined = que el armador ponga la cuota por defecto).
 */
export function cuotasDe(payload: unknown): CuotaPago[] | undefined {
  try {
    const lista = (payload as {
      totalesSubTotales?: { listaPagoPlazo?: { fechaVenceCuota?: string; valorCuota?: string }[] };
    })?.totalesSubTotales?.listaPagoPlazo;
    if (!Array.isArray(lista) || lista.length === 0) return undefined;
    const cuotas = lista.map((c) => ({
      vence: String(c.fechaVenceCuota ?? "").slice(0, 10),
      monto: Number(c.valorCuota),
    }));
    return cuotas.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.vence) && Number.isFinite(c.monto))
      ? cuotas
      : undefined;
  } catch {
    return undefined;
  }
}

function receptorDe(entidad: EntidadFiscal): ReceptorFactura {
  return {
    tipoClienteFE: "03",
    tipoContribuyente: entidad.tipo_ruc === "1" ? "1" : "2",
    ruc: entidad.ruc,
    dv: entidad.dv,
    razonSocial: entidad.razon_social,
    direccion: entidad.direccion,
    codigoUbicacion: entidad.codigo_ubicacion ?? "",
    provincia: entidad.provincia ?? "",
    distrito: entidad.distrito ?? "",
    corregimiento: entidad.corregimiento ?? "",
    correo: entidad.correo ?? undefined,
    telefono: entidad.telefono ?? undefined,
  };
}

function renglonesDe(items: FacturaItemDb[]): RenglonFactura[] {
  return items.map((it) => ({
    descripcion: it.descripcion,
    precio_unitario: it.precio_unitario,
    cantidad: it.cantidad,
    itbms_exento: it.itbms_exento,
    cpbsAbrev: it.cpbs_abrev ?? undefined,
    cpbs: it.cpbs ?? undefined,
    unidadMedida: it.unidad_medida,
    unidadMedidaCpbs: it.unidad_medida_cpbs ?? undefined,
    renglonNumero: it.renglon_numero,
  }));
}

export interface ResultadoEmision {
  ok: boolean;
  /** Mensaje de error legible cuando ok=false. */
  error?: string;
  /** Aviso no fatal (p. ej. el correo no salió) cuando ok=true. */
  aviso?: string;
}

export async function emitirFactura(
  supabase: SupabaseClient,
  facturaId: string,
  opciones?: { cuotas?: CuotaPago[] }
): Promise<ResultadoEmision> {
  const { data: factura } = await supabase
    .from("facturas")
    .select("*")
    .eq("id", facturaId)
    .single<Factura>();
  if (!factura) return { ok: false, error: "La factura no existe." };
  if (!["borrador", "rechazada", "emitiendo"].includes(factura.estado)) {
    return { ok: false, error: `Una factura ${factura.estado} no se puede emitir.` };
  }
  if (factura.numero_documento == null) {
    return { ok: false, error: "La factura no tiene número fiscal asignado." };
  }
  if (!factura.entidad_id) {
    return { ok: false, error: "La factura no tiene entidad fiscal receptora." };
  }

  const [{ data: items }, { data: entidad }] = await Promise.all([
    supabase
      .from("factura_items")
      .select("*")
      .eq("factura_id", facturaId)
      .order("orden")
      .returns<FacturaItemDb[]>(),
    supabase
      .from("entidades_fiscales")
      .select("*")
      .eq("id", factura.entidad_id)
      .single<EntidadFiscal>(),
  ]);
  if (!items || items.length === 0) return { ok: false, error: "La factura no tiene renglones." };
  if (!entidad) return { ok: false, error: "La entidad fiscal receptora no existe." };

  // La entidad se relee FRESCA en cada intento: corregirla y reintentar es el
  // camino de arreglo de un rechazo, con el mismo número fiscal.
  const receptor = receptorDe(entidad);
  const armado = armarDocumento({
    sucursal: factura.sucursal,
    puntoFacturacion: factura.punto_facturacion,
    numeroDocumento: factura.numero_documento,
    tipoDocumento: factura.tipo_documento as "01",
    fechaEmision: new Date(),
    receptor,
    items: renglonesDe(items),
    retenerItbms50: factura.retencion_aplicada,
    formaPago: factura.forma_pago as "01",
    cuotas: opciones?.cuotas ?? cuotasDe(factura.payload),
    numeroOrdenCompra: (factura.receptor as { orden_compra?: string })?.orden_compra,
  });

  await supabase
    .from("facturas")
    .update({
      payload: armado.documento,
      receptor: { ...receptor, orden_compra: (factura.receptor as { orden_compra?: string })?.orden_compra },
      estado: "emitiendo",
      mensaje_error: null,
      fecha_emision: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", facturaId);

  let cufe: string;
  let cruda: Record<string, unknown>;
  try {
    const respuesta = await enviarDocumento(armado.documento);
    cufe = respuesta.cufe;
    cruda = respuesta.cruda;
    await supabase
      .from("facturas")
      .update({
        estado: "autorizada",
        cufe,
        qr_url: respuesta.qr,
        protocolo_autorizacion: respuesta.protocolo,
        respuesta: cruda,
        updated_at: new Date().toISOString(),
      })
      .eq("id", facturaId);
  } catch (e) {
    if (esDocumentoDuplicado(e)) {
      // El número ya entró en un intento anterior sin confirmación: la verdad
      // la tiene EstadoDocumento. Si está autorizada, se recupera; si no, se
      // reporta tal cual.
      try {
        const estado = await estadoDocumento(serieDe(factura));
        if (estado.estatus?.toLowerCase().includes("autorizada") && estado.cufe) {
          cufe = estado.cufe;
          cruda = estado.cruda;
          await supabase
            .from("facturas")
            .update({
              estado: "autorizada",
              cufe,
              protocolo_autorizacion: estado.protocolo,
              respuesta: cruda,
              mensaje_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", facturaId);
        } else {
          await supabase
            .from("facturas")
            .update({
              estado: "rechazada",
              mensaje_error: `HKA reporta el número como existente pero no autorizado: ${estado.mensaje ?? estado.estatus ?? "sin detalle"}`,
              respuesta: estado.cruda,
              updated_at: new Date().toISOString(),
            })
            .eq("id", facturaId);
          return { ok: false, error: "El número fiscal ya existe en HKA y no está autorizado. Revisa el detalle." };
        }
      } catch (e2) {
        await supabase
          .from("facturas")
          .update({ mensaje_error: mensajeDe(e2), updated_at: new Date().toISOString() })
          .eq("id", facturaId);
        return { ok: false, error: `Documento duplicado y no se pudo consultar su estado: ${mensajeDe(e2)}` };
      }
    } else if (e instanceof ErrorHka) {
      await supabase
        .from("facturas")
        .update({
          estado: "rechazada",
          mensaje_error: e.message,
          respuesta: (e.detalle as Record<string, unknown>) ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", facturaId);
      return { ok: false, error: e.message };
    } else {
      // Sin respuesta del servicio: no se sabe si entró. La fila queda en
      // 'emitiendo' y el reintento resuelve por la vía del 102.
      await supabase
        .from("facturas")
        .update({
          mensaje_error: `Sin confirmación de HKA (${mensajeDe(e)}). Reintenta: si el documento entró, se recupera solo.`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", facturaId);
      return { ok: false, error: `Sin confirmación de HKA: ${mensajeDe(e)}. Reintenta en un momento.` };
    }
  }

  let aviso = await descargarArchivosFactura(supabase, factura, cufe);

  // Correo al receptor (decisión de Paul: el correo del acto + adicionales).
  if (factura.correos.length > 0) {
    try {
      await envioCorreo(cufe, factura.correos);
    } catch (e) {
      aviso = aviso ?? `La factura quedó autorizada pero el correo no salió: ${mensajeDe(e)}`;
    }
  }

  return { ok: true, aviso };
}

/**
 * El "pull" de los documentos emitidos: baja de HKA el CAFE (PDF) y el XML
 * firmado, los guarda en el bucket fiscal `facturas` y registra el CAFE en el
 * expediente del proyecto. Corre solo al final de cada emisión y también a
 * demanda (POST /api/facturas/[id]/archivos) cuando una descarga falló en su
 * momento — que una descarga falle NO des-autoriza nada: el documento ya
 * existe en la DGI y se puede volver a bajar cuando sea.
 * Devuelve un aviso legible si algo quedó pendiente, undefined si todo bajó.
 */
export async function descargarArchivosFactura(
  supabase: SupabaseClient,
  factura: Factura,
  cufe: string
): Promise<string | undefined> {
  const numero = numeroFiscal(factura.numero_documento);
  let aviso: string | undefined;

  try {
    const pdf = await descargarArchivo(cufe, "PDF");
    const pdfPath = `${factura.id}/Factura ${numero}.pdf`;
    const { error } = await supabase.storage
      .from("facturas")
      .upload(pdfPath, Buffer.from(pdf), { contentType: "application/pdf", upsert: true });
    if (!error) {
      await supabase.from("facturas").update({ pdf_path: pdfPath }).eq("id", factura.id);
      // El expediente del proyecto es de documentos REALES: un CAFE de demo
      // se queda en el panel de facturas y no ensucia el legajo (085).
      if (factura.ambiente !== "demo") {
        await registrarEnExpediente(supabase, factura, numero, pdf);
      }
    }
  } catch (e) {
    aviso = `La factura quedó autorizada pero el CAFE no bajó todavía: ${mensajeDe(e)}`;
  }
  try {
    const xml = await descargarArchivo(cufe, "XML");
    const xmlPath = `${factura.id}/Factura ${numero}.xml`;
    const { error } = await supabase.storage
      .from("facturas")
      .upload(xmlPath, Buffer.from(xml), { contentType: "application/xml", upsert: true });
    if (!error) {
      await supabase.from("facturas").update({ xml_path: xmlPath }).eq("id", factura.id);
    }
  } catch (e) {
    aviso = aviso ?? `La factura quedó autorizada pero el XML no bajó todavía: ${mensajeDe(e)}`;
  }
  return aviso;
}

/** Copia del CAFE al expediente del proyecto como pieza 'factura' (084). */
async function registrarEnExpediente(
  supabase: SupabaseClient,
  factura: Factura,
  numero: string,
  pdf: Uint8Array
): Promise<void> {
  if (!factura.proyecto_id) return;
  const nombre = `Factura ${numero}.pdf`;
  const { data: existentes } = await supabase
    .from("proyecto_archivos")
    .select("id, nombre")
    .eq("proyecto_id", factura.proyecto_id);
  if (existentes?.some((a) => a.nombre === nombre)) return; // reintento: ya está
  const path = `${factura.proyecto_id}/${crypto.randomUUID()}-${nombre}`;
  const { error } = await supabase.storage
    .from("proyecto-archivos")
    .upload(path, Buffer.from(pdf), { contentType: "application/pdf" });
  if (error) return;
  await supabase.from("proyecto_archivos").insert({
    proyecto_id: factura.proyecto_id,
    nombre,
    url: path,
    tipo: "factura",
    orden: existentes?.length ?? 0,
  });
}

/** Anula en HKA y refleja el estado; el trigger 083 permite esta transición. */
export async function anularFactura(
  supabase: SupabaseClient,
  factura: Factura,
  motivo: string
): Promise<ResultadoEmision> {
  try {
    await anularDocumento(motivo, serieDe(factura));
  } catch (e) {
    return { ok: false, error: mensajeDe(e) };
  }
  await supabase
    .from("facturas")
    .update({
      estado: "anulada",
      motivo_anulacion: motivo,
      anulada_en: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", factura.id);
  return { ok: true };
}

function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
