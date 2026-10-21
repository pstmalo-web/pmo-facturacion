// POST /api/facturas/[id]/anular — anulación fiscal vía HKA. Solo aplica
// dentro de 7 días continuos desde la emisión y si no hubo operación real;
// pasado el plazo HKA la rechaza y el camino es la Nota de Crédito (≤180
// días). El plazo lo arbitra HKA: aquí no se duplica el calendario.
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { crearClienteServidor } from "@/lib/supabase/server";
import { esGestorServidor } from "@/lib/perfil-servidor";
import { anularFactura, hkaConfigurado } from "@/lib/facturas/emitir-servidor";
import type { Factura } from "@/lib/facturas/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const esquema = z.object({
  motivo: z.string().trim().min(5, "El motivo de anulación necesita al menos 5 caracteres.").max(300),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esGestorServidor(supabase, user.id))) {
    return NextResponse.json({ error: "Solo Admin o PM pueden anular facturas." }, { status: 403 });
  }
  if (!hkaConfigurado()) {
    return NextResponse.json(
      { error: "Faltan las credenciales del API de HKA en el entorno." },
      { status: 503 }
    );
  }

  let motivo: string;
  try {
    motivo = esquema.parse(await req.json()).motivo;
  } catch (e) {
    const mensaje = e instanceof ZodError ? (e.issues[0]?.message ?? "Datos inválidos.") : "Cuerpo inválido.";
    return NextResponse.json({ error: mensaje }, { status: 400 });
  }

  const { data: factura } = await supabase
    .from("facturas")
    .select("*")
    .eq("id", id)
    .single<Factura>();
  if (!factura) return NextResponse.json({ error: "La factura no existe." }, { status: 404 });
  if (factura.estado !== "autorizada") {
    return NextResponse.json(
      { error: `Solo una factura autorizada se anula (esta está ${factura.estado}).` },
      { status: 409 }
    );
  }

  const resultado = await anularFactura(supabase, factura, motivo);
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 502 });
  }
  return NextResponse.json({ factura_id: id });
}
