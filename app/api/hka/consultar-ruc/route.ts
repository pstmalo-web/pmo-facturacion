// POST /api/hka/consultar-ruc — le pregunta a la DGI (vía ConsultaRucDv de
// HKA) el DV y la razón social de UN RUC. Es la versión de a uno de
// /api/hka/verificar-rucs, y existe para el alta de entidades fiscales dentro
// de la pestaña de facturación: teclear un RUC a mano sin arbitraje es la
// receta para el rechazo 109 con receptor gobierno.
//
// LA REGLA DE LA CASA NO CAMBIA AQUÍ: esta ruta solo REPORTA. No escribe en
// `entidades_fiscales` ni corrige un DV — el veredicto se le enseña a un
// humano y es él quien decide si adopta lo que dice la DGI. Deducir un RUC
// estatal es inventarlo.
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { crearClienteServidor } from "@/lib/supabase/server";
import { esGestorServidor } from "@/lib/perfil-servidor";
import { consultarRucDv, ErrorHka } from "@/lib/hka/cliente";
import { hkaConfigurado } from "@/lib/facturas/emitir-servidor";
import { veredictoDv } from "@/lib/facturas/preparar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const esquema = z.object({
  tipo_ruc: z.enum(["1", "2"]).default("2"),
  ruc: z.string().trim().min(3).max(40),
  /** El DV que tenemos (o el que se acaba de teclear), para el veredicto. */
  dv: z.string().trim().max(2).nullable().default(null),
});

export async function POST(req: Request) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esGestorServidor(supabase, user.id))) {
    return NextResponse.json(
      { error: "Solo Admin o PM consultan el directorio fiscal." },
      { status: 403 }
    );
  }
  if (!hkaConfigurado()) {
    return NextResponse.json(
      { error: "Faltan las credenciales del API de HKA: no se puede consultar la DGI." },
      { status: 503 }
    );
  }

  let entrada;
  try {
    entrada = esquema.parse(await req.json());
  } catch (e) {
    const mensaje =
      e instanceof ZodError ? (e.issues[0]?.message ?? "Datos inválidos.") : "No se pudo leer la consulta.";
    return NextResponse.json({ error: mensaje }, { status: 400 });
  }

  try {
    const info = await consultarRucDv(entrada.tipo_ruc, entrada.ruc);
    const dvDgi = info.dv?.trim() || null;
    return NextResponse.json({
      ruc: entrada.ruc,
      dv_dgi: dvDgi,
      razon_dgi: info.razonSocial,
      afiliado_fe: info.afiliadoFe,
      veredicto: veredictoDv(entrada.dv, dvDgi),
    });
  } catch (e) {
    const mensaje = e instanceof ErrorHka ? e.message : "No se pudo consultar el RUC.";
    return NextResponse.json({ error: mensaje }, { status: 502 });
  }
}
