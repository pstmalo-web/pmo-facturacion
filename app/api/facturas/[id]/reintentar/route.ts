// POST /api/facturas/[id]/reintentar — vuelve a emitir una factura rechazada
// (o una 'emitiendo' que quedó sin confirmación) CON EL MISMO número fiscal.
// La entidad se relee fresca: corregir sus datos y reintentar es el camino de
// arreglo. Si el intento anterior sí entró en HKA, el 102 se resuelve solo
// consultando EstadoDocumento (ver emitir-servidor).
import { NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { esGestorServidor } from "@/lib/perfil-servidor";
import { emitirFactura, hkaConfigurado } from "@/lib/facturas/emitir-servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esGestorServidor(supabase, user.id))) {
    return NextResponse.json({ error: "Solo Admin o PM pueden facturar." }, { status: 403 });
  }
  if (!hkaConfigurado()) {
    return NextResponse.json(
      { error: "Faltan las credenciales del API de HKA en el entorno." },
      { status: 503 }
    );
  }

  const resultado = await emitirFactura(supabase, id);
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 502 });
  }
  return NextResponse.json({ factura_id: id, aviso: resultado.aviso ?? null });
}
