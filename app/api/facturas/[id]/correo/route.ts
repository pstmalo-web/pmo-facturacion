// POST /api/facturas/[id]/correo — reenvía el CAFE+XML por correo vía HKA
// (p. ej. el correo adicional que el cliente facilita después de emitir).
// Los destinatarios usados se acumulan en `facturas.correos` como registro.
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { crearClienteServidor } from "@/lib/supabase/server";
import { esGestorServidor } from "@/lib/perfil-servidor";
import { hkaConfigurado } from "@/lib/facturas/emitir-servidor";
import { envioCorreo, ErrorHka } from "@/lib/hka/cliente";
import type { Factura } from "@/lib/facturas/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const esquema = z.object({
  correos: z.array(z.string().trim().email()).min(1).max(5),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esGestorServidor(supabase, user.id))) {
    return NextResponse.json({ error: "Solo Admin o PM pueden reenviar facturas." }, { status: 403 });
  }
  if (!hkaConfigurado()) {
    return NextResponse.json(
      { error: "Faltan las credenciales del API de HKA en el entorno." },
      { status: 503 }
    );
  }

  let correos: string[];
  try {
    correos = esquema.parse(await req.json()).correos;
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
  if (factura.estado !== "autorizada" || !factura.cufe) {
    return NextResponse.json(
      { error: "Solo una factura autorizada (con CUFE) se puede enviar por correo." },
      { status: 409 }
    );
  }

  try {
    await envioCorreo(factura.cufe, correos);
  } catch (e) {
    const mensaje = e instanceof ErrorHka ? e.message : "No se pudo enviar el correo.";
    return NextResponse.json({ error: mensaje }, { status: 502 });
  }

  const acumulados = Array.from(new Set([...factura.correos, ...correos]));
  await supabase
    .from("facturas")
    .update({ correos: acumulados, updated_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ factura_id: id, correos: acumulados });
}
