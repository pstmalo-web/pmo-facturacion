// Cliente REST de The Factory HKA — SOLO SERVIDOR (lee credenciales de env).
//
// Ambientes (mismos métodos y contratos):
//   demo       https://demointegracion.thefactoryhka.com.pa/api/{Metodo}
//   produccion https://integracion.thefactoryhka.com.pa/api/{Metodo}
// Credenciales por RUC y POR AMBIENTE; nada de demo migra a producción.
//
// Autenticación: POST /api/Autenticacion {usuario, clave} → JWT (~24 h, la
// respuesta trae `expiracion`). El resto de métodos lo llevan como
// `Authorization: Bearer` Y como header literal `token` — la colección
// Postman oficial usa ambos y el 101 con token fresco se cura con el segundo.
//
// Particularidades del servicio que este cliente absorbe para que las rutas
// no las carguen:
// - Casing inconsistente entre métodos (codigo/Codigo, archivo/Archivo):
//   `campo()` busca sin distinguir mayúsculas.
// - Código 101 (token inválido): se renueva el token y se reintenta UNA vez.
// - Código 102 en Enviar = DOCUMENTO DUPLICADO: el número fiscal ya entró.
//   No es un error de red — el llamador debe consultar EstadoDocumento.
// - Timeouts explícitos: emitir no puede colgar una ruta serverless.
import type { SerieDocumento } from "@/lib/hka/tipos";

const BASES = {
  demo: "https://demointegracion.thefactoryhka.com.pa",
  produccion: "https://integracion.thefactoryhka.com.pa",
} as const;

export type AmbienteHka = keyof typeof BASES;

export class ErrorHka extends Error {
  constructor(
    public codigo: string,
    mensaje: string,
    public detalle?: unknown
  ) {
    super(mensaje);
    this.name = "ErrorHka";
  }
}

/** El número fiscal ya existe en HKA: verificar con EstadoDocumento. */
export function esDocumentoDuplicado(e: unknown): boolean {
  return e instanceof ErrorHka && e.codigo === "102";
}

function configHka(): {
  base: string;
  usuario: string;
  clave: string;
  ambiente: AmbienteHka;
} {
  // trim() en todo: las credenciales entran por el prompt interactivo de
  // `vercel env add` o por el dashboard, y un espacio o salto de línea colado
  // al pegar produce exactamente el mismo «Usuario y/o clave inválidos» que
  // una clave equivocada — indistinguible desde afuera.
  const ambiente = (process.env.HKA_AMBIENTE ?? "demo").trim() as AmbienteHka;
  if (!(ambiente in BASES)) {
    throw new ErrorHka(
      "config",
      `HKA_AMBIENTE debe ser "demo" o "produccion" (llegó "${ambiente}").`
    );
  }
  const usuario = process.env.HKA_USUARIO?.trim();
  const clave = process.env.HKA_CLAVE?.trim();
  if (!usuario || !clave) {
    throw new ErrorHka(
      "config",
      "Faltan HKA_USUARIO y/o HKA_CLAVE en el entorno. En Vercel, una variable nueva solo aplica en el SIGUIENTE deploy."
    );
  }
  return { base: BASES[ambiente], usuario, clave, ambiente };
}

/** Búsqueda de campo tolerante al casing (codigo vs Codigo, según método). */
function campo(obj: unknown, nombre: string): unknown {
  if (obj === null || typeof obj !== "object") return undefined;
  const buscado = nombre.toLowerCase();
  for (const [clave, valor] of Object.entries(obj as Record<string, unknown>)) {
    if (clave.toLowerCase() === buscado) return valor;
  }
  return undefined;
}

function campoTexto(obj: unknown, nombre: string): string | undefined {
  const v = campo(obj, nombre);
  if (v === undefined || v === null) return undefined;
  return String(v);
}

function mensajeDe(cuerpo: unknown): string {
  return (
    campoTexto(cuerpo, "mensaje") ??
    campoTexto(cuerpo, "resultado") ??
    "sin mensaje del servicio"
  );
}

// Cache del JWT a nivel de módulo: sobrevive entre requests de una misma
// lambda caliente y se renueva 60 s antes de expirar.
let tokenCache: { token: string; expiraMs: number } | null = null;

async function obtenerToken(forzar = false): Promise<string> {
  if (!forzar && tokenCache && Date.now() < tokenCache.expiraMs - 60_000) {
    return tokenCache.token;
  }
  const { base, usuario, clave } = configHka();
  const res = await fetch(`${base}/api/Autenticacion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario, clave }),
    signal: AbortSignal.timeout(25_000),
    cache: "no-store",
  });
  const cuerpo = await res.json().catch(() => null);
  const token = campoTexto(cuerpo, "token");
  if (!res.ok || !token) {
    throw new ErrorHka(
      campoTexto(cuerpo, "codigo") ?? String(res.status),
      `HKA no entregó token: ${mensajeDe(cuerpo)}`,
      cuerpo
    );
  }
  const expiracion = campoTexto(cuerpo, "expiracion");
  const expiraMs = expiracion ? Date.parse(expiracion) : NaN;
  tokenCache = {
    token,
    expiraMs: Number.isNaN(expiraMs) ? Date.now() + 20 * 3600_000 : expiraMs,
  };
  return token;
}

async function llamarHka(
  metodo: string,
  body?: unknown,
  reintento = false
): Promise<Record<string, unknown>> {
  const { base } = configHka();
  const token = await obtenerToken(reintento);
  const res = await fetch(`${base}/api/${metodo}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  const cuerpo = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!cuerpo) {
    throw new ErrorHka(
      String(res.status),
      `HKA respondió ${res.status} sin JSON en ${metodo}.`
    );
  }
  if (campoTexto(cuerpo, "codigo") === "101" && !reintento) {
    tokenCache = null;
    return llamarHka(metodo, body, true);
  }
  return cuerpo;
}

function serieParaHka(serie: SerieDocumento): Record<string, string> {
  return {
    codigoSucursalEmisor: serie.sucursal,
    numeroDocumentoFiscal: String(serie.numeroDocumento).padStart(10, "0"),
    puntoFacturacionFiscal: serie.puntoFacturacion,
    tipoDocumento: serie.tipoDocumento,
    tipoEmision: serie.tipoEmision ?? "01",
  };
}

export interface RespuestaEnvio {
  cufe: string;
  qr: string | null;
  protocolo: string | null;
  fechaRecepcion: string | null;
  cruda: Record<string, unknown>;
}

/** Emite el documento. SÍNCRONO: la respuesta ya trae el CUFE autorizado. */
export async function enviarDocumento(
  documento: Record<string, unknown>
): Promise<RespuestaEnvio> {
  const cuerpo = await llamarHka("Enviar", { documento });
  const cufe = campoTexto(cuerpo, "cufe");
  if (!cufe) {
    throw new ErrorHka(
      campoTexto(cuerpo, "codigo") ?? "?",
      `HKA rechazó el documento: ${mensajeDe(cuerpo)}`,
      cuerpo
    );
  }
  return {
    cufe,
    qr: campoTexto(cuerpo, "qr") ?? null,
    protocolo: campoTexto(cuerpo, "nroProtocoloAutorizacion") ?? null,
    fechaRecepcion: campoTexto(cuerpo, "fechaRecepcionDGI") ?? null,
    cruda: cuerpo,
  };
}

/** Descarga el CAFE (PDF) o el XML firmado; el servicio los manda en base64. */
export async function descargarArchivo(
  cufe: string,
  tipo: "PDF" | "XML"
): Promise<Uint8Array> {
  const cuerpo = await llamarHka("Descarga", { cufe, tipoArchivo: tipo });
  const base64 = campoTexto(cuerpo, "archivo");
  if (!base64) {
    throw new ErrorHka(
      campoTexto(cuerpo, "codigo") ?? "?",
      `HKA no entregó el ${tipo}: ${mensajeDe(cuerpo)}`,
      cuerpo
    );
  }
  return new Uint8Array(Buffer.from(base64, "base64"));
}

export interface EstadoDocumentoHka {
  estatus: string | null;
  cufe: string | null;
  protocolo: string | null;
  mensaje: string | null;
  cruda: Record<string, unknown>;
}

/** Consulta el estatus por número de documento (no por CUFE). */
export async function estadoDocumento(
  serie: SerieDocumento
): Promise<EstadoDocumentoHka> {
  const cuerpo = await llamarHka("EstadoDocumento", serieParaHka(serie));
  return {
    estatus: campoTexto(cuerpo, "estatusDocumento") ?? null,
    cufe: campoTexto(cuerpo, "cufe") ?? null,
    protocolo: campoTexto(cuerpo, "numeroProtocoloAutorizacion") ?? null,
    mensaje: campoTexto(cuerpo, "mensajeDocumento") ?? null,
    cruda: cuerpo,
  };
}

/**
 * Anula un documento autorizado. Solo dentro de 7 días continuos y solo si
 * no hubo operación real; después corresponde Nota de Crédito (≤180 días).
 */
export async function anularDocumento(
  motivo: string,
  serie: SerieDocumento
): Promise<Record<string, unknown>> {
  const cuerpo = await llamarHka("Anulacion", {
    motivoAnulacion: motivo,
    datosDocumento: serieParaHka(serie),
  });
  const codigo = campoTexto(cuerpo, "codigo");
  if (codigo !== "200" && codigo !== "0") {
    throw new ErrorHka(
      codigo ?? "?",
      `HKA no anuló el documento: ${mensajeDe(cuerpo)}`,
      cuerpo
    );
  }
  return cuerpo;
}

export interface FoliosHka {
  disponiblesCiclo: number | null;
  totalesDisponibles: number | null;
  cruda: Record<string, unknown>;
}

/** Folios restantes de la licencia (cada emisión consume uno). */
export async function foliosRestantes(): Promise<FoliosHka> {
  const cuerpo = await llamarHka("FoliosRestantes");
  const num = (nombre: string) => {
    const v = campoTexto(cuerpo, nombre);
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    disponiblesCiclo: num("foliosDisponibleCiclo") ?? num("foliosDisponiblesCiclo"),
    totalesDisponibles: num("foliosTotalesDisponibles"),
    cruda: cuerpo,
  };
}

/** Envía el CAFE + XML por correo a los destinatarios. */
export async function envioCorreo(
  cufe: string,
  correos: string[]
): Promise<Record<string, unknown>> {
  const cuerpo = await llamarHka("EnvioCorreo", { cufe, correos });
  const codigo = campoTexto(cuerpo, "codigo");
  if (codigo !== "0" && codigo !== "200") {
    throw new ErrorHka(
      codigo ?? "?",
      `HKA no envió el correo: ${mensajeDe(cuerpo)}`,
      cuerpo
    );
  }
  return cuerpo;
}

export interface DocumentoListado {
  numero: string | null;
  fechaEmision: string | null;
  cufe: string | null;
  estatus: string | null;
  tipoDocumento: string | null;
}

export interface ListadoDocumentos {
  codigo: string | null;
  mensaje: string | null;
  total: number | null;
  documentos: DocumentoListado[];
  /** true cuando HKA contesta 102: la serie no tiene documentos en el rango. */
  sinResultados: boolean;
  /** true cuando HKA contesta 203: throttle de 30 s entre consultas. */
  throttle: boolean;
}

/**
 * Documentos emitidos de una serie (sucursal+punto+tipo) en un rango de
 * fechas. Reglas del servicio: rango máximo de 7 días calendario, fechaFin
 * obligatoria, y un throttle de 30 s entre consultas (código 203).
 */
export async function listaDocumentos(
  punto: string,
  desde: string,
  hasta: string,
  tipoDocumento = "01",
  sucursal = "0000"
): Promise<ListadoDocumentos> {
  const cuerpo = await llamarHka("ListaDocumentos", {
    codigoSucursal: sucursal,
    ptoFacturacion: punto,
    tipoDocumento,
    fechaInicio: desde,
    fechaFin: hasta,
    paginaActual: 1,
  });
  const codigo = campoTexto(cuerpo, "codigo") ?? null;
  const lista = campo(cuerpo, "documentos");
  const documentos = Array.isArray(lista)
    ? lista.map((d) => ({
        numero: campoTexto(d, "numeroDocumentoFiscal") ?? null,
        fechaEmision: campoTexto(d, "fechaEmisionDocumento") ?? null,
        cufe: campoTexto(d, "cufe") ?? null,
        estatus: campoTexto(d, "estatusDocumento") ?? null,
        tipoDocumento: campoTexto(d, "tipoDocumento") ?? null,
      }))
    : [];
  const totalTexto = campoTexto(cuerpo, "total");
  return {
    codigo,
    mensaje: campoTexto(cuerpo, "mensaje") ?? null,
    total: totalTexto != null && Number.isFinite(Number(totalTexto)) ? Number(totalTexto) : null,
    documentos,
    sinResultados: codigo === "102",
    throttle: codigo === "203",
  };
}

export interface InfoRuc {
  dv: string | null;
  razonSocial: string | null;
  afiliadoFe: boolean | null;
  cruda: Record<string, unknown>;
}

/** Consulta el DV y la razón social de un RUC contra la DGI. */
export async function consultarRucDv(
  tipoRuc: "1" | "2",
  ruc: string
): Promise<InfoRuc> {
  const cuerpo = await llamarHka("ConsultaRucDv", { tipoRuc, ruc });
  const info = campo(cuerpo, "infoRuc");
  const afiliado = campoTexto(info, "afiliadoFE");
  return {
    dv: campoTexto(info, "dv") ?? null,
    razonSocial: campoTexto(info, "razonSocial") ?? null,
    afiliadoFe:
      afiliado === undefined ? null : afiliado.toLowerCase() === "true",
    cruda: cuerpo,
  };
}
