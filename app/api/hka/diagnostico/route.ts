// GET /api/hka/diagnostico — troubleshooting de credenciales: intenta la
// AUTENTICACIÓN (solo eso, jamás emite nada) contra los DOS ambientes de HKA
// y reporta cuál acepta. Existe porque «Usuario y/o clave inválidos» no
// distingue entre tres causas distintas: clave mal pegada, credenciales del
// portal (no del API), o credenciales del OTRO ambiente — y HKA emite
// credenciales por RUC y POR AMBIENTE.
//
// Nunca devuelve las credenciales ni el token: solo su FORMA (largo, clases de
// caracteres, marcadores estructurales) y el veredicto por ambiente. Solo
// gestores.
//
// Por qué la forma y no solo el largo: `trim()` recorta whitespace según la
// especificación de JS, y eso deja pasar justo lo que se cuela al pegar una
// credencial desde un PDF o un correo — comillas literales, caracteres de
// ancho cero (U+200B, U+200C/D, guion suave U+00AD), guiones tipográficos
// (– —), comillas curvas, homoglifos cirílicos, y saltos de línea INTERNOS
// (trim solo mira los extremos). Un reporte de «largo 19, sin espacios en los
// extremos» es compatible con todas esas corrupciones.
import { NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { esGestorServidor } from "@/lib/perfil-servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// OJO con leer este caso como «la clave está mal». Verificado contra el
// servicio (2026-08-18): un usuario que NO EXISTE en el ambiente devuelve
// exactamente `{"codigo":"201","mensaje":"Usuario y/o clave inválidos"}`, el
// mismo cuerpo que una clave equivocada. Y el 201 del catálogo oficial de HKA
// no es «credenciales inválidas» sino el genérico «Error al procesar
// solicitud». La respuesta NO distingue entre clave mala, usuario inexistente
// y usuario deshabilitado — así que este veredicto no puede afirmar cuál es.
const SIN_AMBIENTE =
  "Ningún ambiente las acepta. HKA responde igual ante una clave equivocada que ante un usuario que no existe, así que esto NO prueba que la clave esté mal: es igual de compatible con que el usuario de API REST de producción todavía no exista. Las credenciales del portal Dfactura y las del API son emisiones SEPARADAS, y la del API se emite solo a pedido. Responder el ticket con este resultado y pedir que confirmen si existe usuario de integración REST para el RUC en producción.";

const BASES = {
  demo: "https://demointegracion.thefactoryhka.com.pa",
  produccion: "https://integracion.thefactoryhka.com.pa",
} as const;

type Intento = {
  autentica: boolean;
  /** Código del CUERPO de HKA (101, 102, 201, 203...). null si no vino. */
  codigo: string | null;
  /** Status HTTP, aparte. Un 201 de negocio y un 201 Created son cosas
   *  opuestas y antes se colapsaban en el mismo campo string. */
  http: number | null;
  mensaje: string | null;
};

async function probarAutenticacion(
  base: string,
  usuario: string,
  clave: string
): Promise<Intento> {
  try {
    const res = await fetch(`${base}/api/Autenticacion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, clave }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const cuerpo = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const busca = (nombre: string) => {
      if (!cuerpo) return null;
      const clave2 = Object.keys(cuerpo).find((k) => k.toLowerCase() === nombre);
      return clave2 != null ? String(cuerpo[clave2]) : null;
    };
    return {
      autentica: Boolean(busca("token")),
      codigo: busca("codigo"),
      http: res.status,
      mensaje: busca("mensaje"),
    };
  } catch (e) {
    return {
      autentica: false,
      codigo: null,
      http: null,
      mensaje: e instanceof Error ? e.message : "sin respuesta",
    };
  }
}

/**
 * La FORMA de un valor secreto, sin revelarlo. Todo lo que sale de aquí es
 * seguro de pegar en un ticket de soporte.
 */
function forma(crudo: string) {
  const v = crudo.trim();
  const codepoints = [...v];
  const noAscii = [...new Set(
    codepoints
      .filter((c) => {
        const n = c.codePointAt(0)!;
        return n < 0x20 || n > 0x7e;
      })
      .map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`)
  )];
  return {
    largo: crudo.length,
    largo_recortado: v.length,
    espacios_en_extremos: crudo !== v,
    espacios_internos: /\s/.test(v),
    comillas_literales: /^["']|["']$/.test(v),
    // Ancho cero, homoglifos, guiones tipográficos: invisibles al ojo y al
    // largo, mortales para el servicio.
    no_ascii: noAscii,
    fuera_del_juego_esperado: codepoints.filter((c) => !/[A-Za-z0-9_.@-]/.test(c)).length,
    nfc_difiere: v !== v.normalize("NFC"),
  };
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

  const usuarioCrudo = process.env.HKA_USUARIO ?? "";
  const claveCruda = process.env.HKA_CLAVE ?? "";
  if (!usuarioCrudo || !claveCruda) {
    return NextResponse.json({ error: "Faltan HKA_USUARIO y/o HKA_CLAVE en el entorno." }, { status: 503 });
  }
  const usuario = usuarioCrudo.trim();
  const clave = claveCruda.trim();

  const [demo, produccion] = await Promise.all([
    probarAutenticacion(BASES.demo, usuario, clave),
    probarAutenticacion(BASES.produccion, usuario, clave),
  ]);

  // Prueba de control, OPT-IN con ?control=1: autenticar en producción con una
  // clave deliberadamente falsa. Si HKA contesta EXACTAMENTE lo mismo que con
  // la nuestra, queda probado que ese código es su respuesta genérica de
  // credencial mala — o sea que sí está evaluando nuestro valor y lo rechaza,
  // y no que nos esté contestando otra cosa que solo se le parece.
  //
  // No corre por defecto porque suma un intento fallido más por llamada y no
  // sabemos si HKA bloquea cuentas por reintentos.
  const control = new URL(req.url).searchParams.get("control") === "1"
    ? await probarAutenticacion(BASES.produccion, usuario, "clave-deliberadamente-falsa")
    : null;

  // El veredicto se lee CONTRA el ambiente configurado: las mismas dos
  // respuestas de HKA significan cosas distintas según dónde crea estar la
  // app. Se lee crudo (sin ambienteHka()) a propósito: esta ruta existe para
  // diagnosticar entornos mal puestos, así que no puede romperse con ellos.
  const ambienteConfigurado = (process.env.HKA_AMBIENTE ?? "demo").trim();
  const enProduccion = ambienteConfigurado === "produccion";

  const veredicto = enProduccion
    ? produccion.autentica
      ? "Las credenciales AUTENTICAN en PRODUCCIÓN y el ambiente configurado es producción: la integración está en vivo. A partir de aquí cada emisión es un documento fiscal REAL ante la DGI."
      : demo.autentica
        ? "Desajuste: las credenciales son de DEMO pero HKA_AMBIENTE=produccion. Toda emisión va a rebotar. Poner las credenciales de producción o devolver HKA_AMBIENTE a demo."
        : SIN_AMBIENTE
    : demo.autentica
      ? "Las credenciales AUTENTICAN en DEMO: todo listo para las pruebas."
      : produccion.autentica
        ? "Desajuste: las credenciales son de PRODUCCIÓN y HKA_AMBIENTE sigue en demo. Toda emisión va a rebotar. Si esto es el paso a producción, cambiar HKA_AMBIENTE=produccion y redesplegar — desde ese momento cada factura es real."
        : SIN_AMBIENTE;

  return NextResponse.json({
    ambiente_configurado: ambienteConfigurado,
    usuario: {
      ...forma(usuarioCrudo),
      // El marcador que distingue al usuario de WEB SERVICE del de portal
      // Dfactura. Los de demo que sí autentican lo llevan.
      sufijo_ws_tfhka: usuario.endsWith("_ws_tfhka"),
      // Vista enmascarada: permite confirmar identidad con soporte por
      // teléfono sin dictar la credencial. El usuario no es el secreto; la
      // clave sí, y de ella NO sale ninguna vista ni huella.
      enmascarado:
        usuario.length > 6
          ? `${usuario.slice(0, 3)}${"·".repeat(usuario.length - 6)}${usuario.slice(-3)}`
          : "·".repeat(usuario.length),
    },
    // De la clave solo su forma. Deliberadamente SIN huella hash: una clave de
    // 10 caracteres se rompe a fuerza bruta contra un hash, y este reporte
    // está hecho para pegarse en un ticket de soporte.
    clave: forma(claveCruda),
    demo,
    produccion,
    control,
    veredicto,
  });
}
