// POST /api/facturas — crea la factura (snapshot de renglones + número fiscal
// de la serie del PMO) y la emite contra HKA en la misma llamada.
//
// El orden de los pasos es el del blindaje, no el de la comodidad:
// 1. gate de gestor (decisión de Paul 2026-08-13: facturan Admin y PM);
// 2. los datos del receptor se guardan EN LA ENTIDAD (así el próximo acto a
//    la misma institución ya los encuentra);
// 3. la fila nace en 'borrador' con sus renglones ANTES de pedir número;
// 4. el número fiscal sale de `siguiente_numero_fiscal()` (atómico, jamás del
//    cliente) y se queda con la fila — un reintento reusa el mismo;
// 5. `emitirFactura` hace el resto y deja rastro en cada paso.
//
// La emisión completa (Enviar + 2 descargas + subidas) tarda: maxDuration 60.
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { crearClienteServidor } from "@/lib/supabase/server";
import { esGestorServidor } from "@/lib/perfil-servidor";
import { FACTURACION_ACTIVA } from "@/lib/perfil";
import { esquemaEmitirFactura } from "@/lib/validaciones/factura";
import { calcularTotales, itbmsLinea } from "@/lib/calc";
import { retencionItbms50 } from "@/lib/hka/documento";
import { ambienteHka, emitirFactura, hkaConfigurado, serieDelPmo } from "@/lib/facturas/emitir-servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esGestorServidor(supabase, user.id))) {
    return NextResponse.json({ error: "Solo Admin o PM pueden facturar." }, { status: 403 });
  }
  // Interruptor general (lib/perfil): con el módulo apagado no se emite ni
  // desde una pestaña vieja que siga abierta con el formulario en pantalla.
  if (!FACTURACION_ACTIVA) {
    return NextResponse.json(
      { error: "El módulo de facturación está desactivado temporalmente." },
      { status: 503 }
    );
  }
  if (!hkaConfigurado()) {
    return NextResponse.json(
      { error: "Faltan las credenciales del API de HKA (HKA_USUARIO/HKA_CLAVE/HKA_PUNTO). En Vercel aplican en el siguiente deploy." },
      { status: 503 }
    );
  }

  let entrada;
  try {
    entrada = esquemaEmitirFactura.parse(await req.json());
  } catch (e) {
    const mensaje =
      e instanceof ZodError ? (e.issues[0]?.message ?? "Datos inválidos.") : "No se pudo leer el formulario.";
    return NextResponse.json({ error: mensaje }, { status: 400 });
  }

  // Los datos del receptor viven en la entidad: el formulario los completa y
  // aquí se persisten para el próximo acto de la misma institución.
  const { data: entidadActualizada, error: errorEntidad } = await supabase
    .from("entidades_fiscales")
    .update({
      direccion: entrada.entidad.direccion,
      codigo_ubicacion: entrada.entidad.codigo_ubicacion,
      provincia: entrada.entidad.provincia,
      distrito: entrada.entidad.distrito,
      corregimiento: entrada.entidad.corregimiento,
      correo: entrada.entidad.correo || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", entrada.entidad_id)
    .select("id");
  if (errorEntidad || !entidadActualizada?.length) {
    return NextResponse.json(
      { error: `No se pudo actualizar la entidad fiscal: ${errorEntidad?.message ?? "no existe"}` },
      { status: 404 }
    );
  }

  const totales = calcularTotales(entrada.items);
  const retencion = entrada.retener ? retencionItbms50(totales.itbms) : null;
  const serie = serieDelPmo();
  const ambiente = ambienteHka();

  const { data: factura, error: errorFactura } = await supabase
    .from("facturas")
    .insert({
      proyecto_id: entrada.proyecto_id,
      cotizacion_id: entrada.cotizacion_id ?? null,
      entidad_id: entrada.entidad_id,
      sucursal: serie.sucursal,
      punto_facturacion: serie.punto,
      tipo_documento: "01",
      // La marca de ambiente viaja con la fila (085): las demo son ensayos
      // borrables; solo las de producción quedan blindadas por el candado.
      ambiente,
      estado: "borrador",
      receptor: entrada.orden_compra ? { orden_compra: entrada.orden_compra } : {},
      total_neto: totales.parcial,
      total_itbms: totales.itbms,
      total: totales.total,
      retencion_aplicada: entrada.retener,
      retencion_monto: retencion,
      forma_pago: entrada.forma_pago,
      tiempo_pago: "2",
      correos: entrada.correos,
      creada_por: user.id,
    })
    .select("id")
    .single();
  if (errorFactura || !factura) {
    return NextResponse.json(
      { error: `No se pudo crear la factura: ${errorFactura?.message ?? "sin detalle"}` },
      { status: 500 }
    );
  }

  const { error: errorItems } = await supabase.from("factura_items").insert(
    entrada.items.map((it, i) => ({
      factura_id: factura.id,
      orden: i,
      descripcion: it.descripcion,
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
      itbms_exento: it.itbms_exento,
      valor_itbms: itbmsLinea(it),
      cpbs_abrev: it.cpbs.slice(0, 2),
      cpbs: it.cpbs,
      unidad_medida: it.unidad_medida,
      unidad_medida_cpbs: it.unidad_medida,
      renglon_numero: it.renglon_numero ?? null,
    }))
  );
  if (errorItems) {
    return NextResponse.json(
      { error: `No se pudieron guardar los renglones: ${errorItems.message}` },
      { status: 500 }
    );
  }

  const { data: numero, error: errorNumero } = await supabase.rpc("siguiente_numero_fiscal", {
    // El correlativo corre por ambiente (096): los ensayos de demo no se
    // comen números de la serie fiscal real.
    p_ambiente: ambiente,
    p_sucursal: serie.sucursal,
    p_punto: serie.punto,
    p_tipo: "01",
  });
  if (errorNumero || numero == null) {
    return NextResponse.json(
      { error: `No se pudo asignar el número fiscal: ${errorNumero?.message ?? "sin detalle"}` },
      { status: 500 }
    );
  }
  await supabase.from("facturas").update({ numero_documento: numero }).eq("id", factura.id);

  const resultado = await emitirFactura(supabase, factura.id, {
    cuotas: entrada.cuotas,
  });
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error, factura_id: factura.id }, { status: 502 });
  }
  return NextResponse.json({ factura_id: factura.id, aviso: resultado.aviso ?? null });
}
