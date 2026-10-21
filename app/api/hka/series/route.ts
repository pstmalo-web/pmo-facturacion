// GET /api/hka/series — vistazo a las series fiscales en el ambiente activo:
// lista los documentos de los últimos 7 días (el máximo que permite el
// servicio) del punto del PMO y del punto de Dfactura. En DEMO lo esperado es
// «sin documentos» en ambos — el ambiente nace vacío; la consulta que importa
// de verdad es la de PRODUCCIÓN antes de la primera emisión real, para
// confirmar que el punto 002 está limpio y ver por dónde va la serie manual.
//
// Nota del servicio: throttle de 30 s entre consultas de ListaDocumentos
// (código 203). Se consulta secuencial y, si la segunda rebota por throttle,
// se dice — recargar la página medio minuto después la completa.
import { NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { esGestorServidor } from "@/lib/perfil-servidor";
import { listaDocumentos, ErrorHka } from "@/lib/hka/cliente";
import { ambienteHka, hkaConfigurado, serieDelPmo } from "@/lib/facturas/emitir-servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PUNTO_DFACTURA = "001";

function fechaISO(diasAtras: number): string {
  const d = new Date(Date.now() - diasAtras * 24 * 3600 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Panama" }).format(d);
}

export async function GET() {
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

  const serie = serieDelPmo();
  const desde = fechaISO(6);
  const hasta = fechaISO(0);

  async function consultar(punto: string) {
    try {
      const r = await listaDocumentos(punto, desde, hasta);
      if (r.throttle) {
        return { punto, estado: "throttle", nota: "HKA pide 30 s entre consultas — recarga en medio minuto." };
      }
      if (r.sinResultados) {
        return { punto, estado: "sin_documentos", total: 0, documentos: [] };
      }
      return { punto, estado: "ok", total: r.total, documentos: r.documentos.slice(0, 20) };
    } catch (e) {
      return {
        punto,
        estado: "error",
        nota: e instanceof ErrorHka ? `${e.codigo}: ${e.message}` : String(e),
      };
    }
  }

  const pmo = await consultar(serie.punto);
  const dfactura = await consultar(PUNTO_DFACTURA);

  return NextResponse.json({
    ambiente: ambienteHka(),
    rango: { desde, hasta },
    serie_pmo: pmo,
    serie_dfactura: dfactura,
    nota:
      "En demo ambas series nacen vacías. Esta misma consulta corre de nuevo en PRODUCCIÓN antes de la primera emisión real, para confirmar el punto limpio.",
  });
}
