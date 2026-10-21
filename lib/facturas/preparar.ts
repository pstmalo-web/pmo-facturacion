// Preparación PURA del formulario de facturar: emparejar la institución del
// snapshot con su entidad fiscal, precargar los renglones desde la cotización
// y resolver el correo del acto. Sin Supabase y sin React: se prueba con
// vitest igual que lib/calc.ts.
//
// POR QUÉ EL EMPAREJADO ES POR ALIAS Y NORMALIZADO, NUNCA POR LIKE:
// `cliente_nombre` es un snapshot de texto sucio — tres escrituras de ARAP,
// personas en el campo de la entidad y hasta un U+2060 invisible (migraciones
// 068/069/070). La tabla de alias (084) es la lista curada de equivalencias;
// aquí solo se normaliza lo justo (mayúsculas, tildes, espacios, invisibles)
// para que "Meduca " encuentre "MEDUCA". Si no hay coincidencia se devuelve
// null y el gestor elige a mano: facturarle al organismo equivocado es peor
// que un clic de más.
import type { CotizacionItem } from "@/lib/types";
import type { EntidadAlias, EntidadFiscal } from "@/lib/facturas/tipos";

/** Renglón editable del formulario de facturar (nace de la cotización). */
export interface RenglonFormulario {
  incluir: boolean;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  itbms_exento: boolean;
  /** Familia CPBS de 4 dígitos; vacío hasta que el gestor la asigne. */
  cpbs: string;
  unidad_medida: string;
  renglon_numero: number | null;
}

/** Mayúsculas, sin tildes, sin invisibles, espacios colapsados. */
export function normalizarNombre(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Empareja el `cliente_nombre` del snapshot con su entidad fiscal: primero por
 * alias (la lista curada), luego por nombre/siglas/razón social exactos.
 */
export function emparejarEntidad(
  clienteNombre: string | null | undefined,
  entidades: EntidadFiscal[],
  alias: EntidadAlias[]
): EntidadFiscal | null {
  if (!clienteNombre) return null;
  const buscado = normalizarNombre(clienteNombre);
  if (!buscado) return null;

  const porAlias = alias.find((a) => normalizarNombre(a.alias) === buscado);
  if (porAlias) {
    return entidades.find((e) => e.id === porAlias.entidad_id) ?? null;
  }
  return (
    entidades.find(
      (e) =>
        normalizarNombre(e.nombre) === buscado ||
        (e.siglas && normalizarNombre(e.siglas) === buscado) ||
        normalizarNombre(e.razon_social) === buscado
    ) ?? null
  );
}

/** Filtra entidades por texto (nombre, siglas, razón social o RUC). */
export function filtrarEntidades(
  texto: string,
  entidades: EntidadFiscal[]
): EntidadFiscal[] {
  const q = normalizarNombre(texto);
  if (!q) return entidades;
  return entidades.filter(
    (e) =>
      normalizarNombre(e.nombre).includes(q) ||
      (e.siglas && normalizarNombre(e.siglas).includes(q)) ||
      normalizarNombre(e.razon_social).includes(q) ||
      e.ruc.toUpperCase().includes(q)
  );
}

/**
 * El detalle del artículo que la factura DEBE llevar (Paul, 2026-08-13: "es
 * importante agregar casa/marca productora y país de origen en la descripción
 * de los artículos"). La cotización ya lo trae: toda descripción nueva parte
 * de PLANTILLA_DESCRIPCION (Marca / Casa Productora / País de Origen), así que
 * aquí se aplanan sus líneas en una sola, descartando las de la plantilla que
 * quedaron sin llenar — "Marca:" a secas en la factura es ruido, no dato.
 */
export function detalleArticulo(descripcion: string | null | undefined): string {
  if (!descripcion) return "";
  return descripcion
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^(marca|casa productora|pa[ií]s de origen)\s*:\s*$/i.test(l))
    .join(" · ");
}

/**
 * Renglones del formulario desde los items de la cotización, en su orden.
 * La descripción es el NOMBRE del renglón (lo vendido) seguido del detalle
 * del artículo (marca, casa productora, país de origen — lo que la
 * descripción de la cotización traiga).
 */
export function renglonesDesdeCotizacion(
  items: Pick<
    CotizacionItem,
    "nombre" | "descripcion" | "precio_unitario" | "cantidad" | "itbms_exento" | "renglon_numero"
  >[]
): RenglonFormulario[] {
  return items.map((it) => {
    const nombre = it.nombre.trim();
    const detalle = detalleArticulo(it.descripcion);
    const desc =
      nombre.length >= 2
        ? detalle
          ? `${nombre} — ${detalle}`
          : nombre
        : detalle || nombre;
    return {
      incluir: true,
      descripcion: desc.slice(0, 500),
      cantidad: it.cantidad,
      precio_unitario: it.precio_unitario,
      itbms_exento: it.itbms_exento,
      cpbs: "",
      unidad_medida: "und",
      renglon_numero: it.renglon_numero ?? null,
    };
  });
}

/** Veredicto de una consulta ConsultaRucDv sobre un DV que tenemos escrito. */
export type VeredictoDv = "coincide" | "dv_distinto" | "sin_respuesta";

/**
 * ¿Lo que dice la DGI coincide con el DV que tenemos? Se compara con AMBOS
 * lados rellenados a dos dígitos porque la fuente escribe "5" donde la DGI
 * escribe "05" y son el mismo dígito verificador — el conflicto real (el
 * 05/50 del Tribunal Electoral) es otra cosa y así no se confunden.
 *
 * Devuelve un veredicto, NUNCA un DV corregido: la regla de la casa es que el
 * RUC estatal no se deduce ni se arregla solo. Vive aquí, en lo puro, porque
 * lo consultan dos rutas —la verificación masiva del directorio y el alta de
 * una entidad— y dos copias de un criterio de identidad fiscal terminan
 * discrepando justo en el caso raro.
 */
export function veredictoDv(
  dvNuestro: string | null | undefined,
  dvDgi: string | null | undefined
): VeredictoDv {
  const dgi = dvDgi?.trim();
  if (!dgi) return "sin_respuesta";
  const nuestro = dvNuestro?.trim();
  if (!nuestro) return "dv_distinto";
  return dgi.padStart(2, "0") === nuestro.padStart(2, "0") ? "coincide" : "dv_distinto";
}

/**
 * Renglón en blanco de la factura LIBRE (F2). Nace incluido y con "und" —los
 * dos valores que evitan un clic en el 90 % de los casos— y con el CPBS
 * VACÍO a propósito: adivinar la familia del bien es exactamente lo que
 * provoca el rechazo con receptor gobierno, así que lo teclea un humano.
 */
export function renglonVacio(): RenglonFormulario {
  return {
    incluir: true,
    descripcion: "",
    cantidad: 1,
    precio_unitario: 0,
    itbms_exento: false,
    cpbs: "",
    unidad_medida: "und",
    renglon_numero: null,
  };
}

/**
 * El correo al que se envía la factura (decisión de Paul 2026-08-13): el de la
 * cotización — el que estaba publicado en el acto —, con caída al contacto del
 * pliego si el snapshot no lo tiene.
 */
export function correoDelActo(cot: {
  cliente_contacto_email?: string | null;
  datos_pliego?: { contacto?: { correo?: string | null } | null } | null;
}): string | null {
  const directo = cot.cliente_contacto_email?.trim();
  if (directo) return directo;
  const delPliego = cot.datos_pliego?.contacto?.correo?.trim();
  return delPliego || null;
}

/**
 * La dirección del receptor (Paul, 2026-08-13: "es la que aparece en el acto y
 * en mi cotización"): el snapshot `cliente_direccion`, con caída a la dirección
 * de la entidad publicada en el pliego. Recortada a los 100 caracteres que
 * admite el campo de HKA.
 */
export function direccionDelActo(cot: {
  cliente_direccion?: string | null;
  datos_pliego?: { entidad?: { direccion?: string | null } | null } | null;
}): string | null {
  const directa = cot.cliente_direccion?.trim();
  const delPliego = cot.datos_pliego?.entidad?.direccion?.trim();
  const eleccion = directa || delPliego || null;
  return eleccion ? eleccion.slice(0, 100) : null;
}
