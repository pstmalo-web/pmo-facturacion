// GET /api/hka/verificar-rucs — verifica el directorio fiscal completo contra
// la DGI vía ConsultaRucDv de HKA: las 85 entidades sembradas por la 084 MÁS
// los casos que quedaron en cuarentena (Tribunal Electoral con DV 05/50 en
// conflicto, Patronato con RUC de prefijo J en la fuente).
//
// Por defecto SOLO REPORTA. Con ?aplicar=1 estampa `verificado_en` y
// `afiliado_fe` en las entidades cuyo DV COINCIDE con la DGI — jamás corrige
// un DV solo: la regla de la casa es que el RUC estatal nunca se deduce, y un
// DV distinto se revisa a mano con el reporte en la pantalla.
import { NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { esGestorServidor } from "@/lib/perfil-servidor";
import { consultarRucDv } from "@/lib/hka/cliente";
import { ambienteHka, hkaConfigurado } from "@/lib/facturas/emitir-servidor";
import { veredictoDv } from "@/lib/facturas/preparar";
import type { EntidadFiscal } from "@/lib/facturas/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Los RUC plausibles de la lista de EXCLUIDAS de la migración 084: se
// consultan para resolverlos, no están en la tabla todavía.
const PENDIENTES: { nombre: string; tipoRuc: "1" | "2"; ruc: string }[] = [
  // DV en conflicto en la fuente (05 vs 50) — la DGI arbitra.
  { nombre: "TRIBUNAL ELECTORAL (¿o ESC. PEDRO J. AMEGLIO?)", tipoRuc: "2", ruc: "8-NT-1-22686" },
  // La fuente traía J8-NT-1-2384; sin el prefijo de errata:
  { nombre: "PATRONATO HOSPITAL SANTO TOMAS", tipoRuc: "2", ruc: "8-NT-1-2384" },
];

interface Resultado {
  nombre: string;
  ruc: string;
  dv_nuestro: string | null;
  dv_dgi: string | null;
  razon_dgi: string | null;
  afiliado_fe: boolean | null;
  veredicto: "coincide" | "dv_distinto" | "sin_respuesta";
}

async function verificar(
  nombre: string,
  tipoRuc: "1" | "2",
  ruc: string,
  dvNuestro: string | null
): Promise<Resultado> {
  try {
    const info = await consultarRucDv(tipoRuc, ruc);
    const dvDgi = info.dv?.trim() || null;
    return {
      nombre,
      ruc,
      dv_nuestro: dvNuestro,
      dv_dgi: dvDgi,
      razon_dgi: info.razonSocial,
      afiliado_fe: info.afiliadoFe,
      // El criterio vive en lib/facturas/preparar.ts: lo comparte con el alta
      // de una entidad desde la pestaña de facturación.
      veredicto: veredictoDv(dvNuestro, dvDgi),
    };
  } catch (e) {
    return {
      nombre,
      ruc,
      dv_nuestro: dvNuestro,
      dv_dgi: null,
      razon_dgi: e instanceof Error ? e.message : String(e),
      afiliado_fe: null,
      veredicto: "sin_respuesta",
    };
  }
}

/** Piscina simple: N consultas a la vez, en orden. */
async function enLotes<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(items.length);
  let i = 0;
  async function obrero() {
    while (i < items.length) {
      const propio = i++;
      resultados[propio] = await fn(items[propio]);
    }
  }
  await Promise.all(Array.from({ length: n }, obrero));
  return resultados;
}

export async function GET(req: Request) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esGestorServidor(supabase, user.id))) {
    return NextResponse.json({ error: "Solo Admin o PM." }, { status: 403 });
  }
  if (!hkaConfigurado()) {
    return NextResponse.json({ error: "Faltan las credenciales de HKA." }, { status: 503 });
  }
  const aplicar = new URL(req.url).searchParams.get("aplicar") === "1";

  const { data: entidades } = await supabase
    .from("entidades_fiscales")
    .select("*")
    .order("nombre")
    .returns<EntidadFiscal[]>();
  if (!entidades) return NextResponse.json({ error: "No se pudo leer el directorio." }, { status: 500 });

  const delDirectorio = await enLotes(entidades, 4, (e) =>
    verificar(e.nombre, e.tipo_ruc, e.ruc, e.dv)
  );
  const pendientes = await enLotes(PENDIENTES, 2, (p) =>
    verificar(p.nombre, p.tipoRuc, p.ruc, null)
  );

  let estampadas = 0;
  if (aplicar) {
    const ahora = new Date().toISOString();
    for (const [i, r] of delDirectorio.entries()) {
      if (r.veredicto !== "coincide") continue;
      const { error } = await supabase
        .from("entidades_fiscales")
        .update({ verificado_en: ahora, afiliado_fe: r.afiliado_fe, updated_at: ahora })
        .eq("id", entidades[i].id);
      if (!error) estampadas++;
    }
  }

  const resumen = {
    coinciden: delDirectorio.filter((r) => r.veredicto === "coincide").length,
    dv_distinto: delDirectorio.filter((r) => r.veredicto === "dv_distinto").length,
    sin_respuesta: delDirectorio.filter((r) => r.veredicto === "sin_respuesta").length,
  };

  return NextResponse.json({
    ambiente: ambienteHka(),
    modo: aplicar ? "aplicar (estampa verificado_en en las que coinciden)" : "solo reporte (agrega ?aplicar=1 para estampar)",
    resumen,
    estampadas: aplicar ? estampadas : undefined,
    revisar_a_mano: delDirectorio.filter((r) => r.veredicto !== "coincide"),
    cuarentena: pendientes,
  });
}
