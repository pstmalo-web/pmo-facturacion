// POST /api/facturas/[id]/archivos — vuelve a jalar de HKA el CAFE (PDF) y el
// XML de una factura AUTORIZADA cuya descarga falló en el momento de emitir.
// El documento ya existe en la DGI: bajarlo de nuevo es idempotente (upsert al
// bucket y el expediente no duplica la pieza).
import { NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { esGestorServidor } from "@/lib/perfil-servidor";
import { descargarArchivosFactura, hkaConfigurado } from "@/lib/facturas/emitir-servidor";
import type { Factura } from "@/lib/facturas/tipos";

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
    return NextResponse.json({ error: "Solo Admin o PM pueden traer los archivos." }, { status: 403 });
  }
  if (!hkaConfigurado()) {
    return NextResponse.json(
      { error: "Faltan las credenciales del API de HKA en el entorno." },
      { status: 503 }
    );
  }

  const { data: factura } = await supabase
    .from("facturas")
    .select("*")
    .eq("id", id)
    .single<Factura>();
  if (!factura) return NextResponse.json({ error: "La factura no existe." }, { status: 404 });
  if (factura.estado !== "autorizada" || !factura.cufe) {
    return NextResponse.json(
      { error: "Solo una factura autorizada (con CUFE) tiene archivos que traer." },
      { status: 409 }
    );
  }

  const aviso = await descargarArchivosFactura(supabase, factura, factura.cufe);

  const { data: refrescada } = await supabase
    .from("facturas")
    .select("pdf_path, xml_path")
    .eq("id", id)
    .single();
  if (!refrescada?.pdf_path) {
    return NextResponse.json(
      { error: aviso ?? "HKA no entregó el CAFE. Intenta de nuevo en un momento." },
      { status: 502 }
    );
  }
  return NextResponse.json({ factura_id: id, aviso: aviso ?? null });
}
