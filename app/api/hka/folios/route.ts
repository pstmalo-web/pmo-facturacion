// GET /api/hka/folios — dos preguntas en una: ¿está configurada la
// integración? y ¿cuántos folios quedan? El formulario de facturar lo usa
// para habilitar (o no) el botón Emitir, así que responder
// `configurado:false` es un estado NORMAL mientras llegan las credenciales,
// no un error.
import { NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { foliosRestantes, ErrorHka } from "@/lib/hka/cliente";
import { ambienteHka, hkaConfigurado } from "@/lib/facturas/emitir-servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!hkaConfigurado()) {
    return NextResponse.json({ configurado: false });
  }
  try {
    const folios = await foliosRestantes();
    return NextResponse.json({
      configurado: true,
      ambiente: ambienteHka(),
      disponiblesCiclo: folios.disponiblesCiclo,
      totalesDisponibles: folios.totalesDisponibles,
    });
  } catch (e) {
    const mensaje = e instanceof ErrorHka ? e.message : "No se pudo consultar los folios.";
    return NextResponse.json({ configurado: true, error: mensaje }, { status: 502 });
  }
}
