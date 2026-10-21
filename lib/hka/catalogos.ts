// Catálogos DGI que el documento electrónico exige citar TEXTUALMENTE,
// extraídos del PDF de anexos técnicos de HKA el 2026-08-13
// (felwiki.thefactoryhka.com.pa/lib/exe/fetch.php?media=anexos_tecnico-hka.pdf):
//
// - Ubicaciones: el "Catálogo unificado de Provincias, Distritos y
//   Corregimientos" (código compuesto "provincia-distrito-corregimiento").
//   Las filas "INVALIDO" (X-0-0 / X-Y-0) son parte literal del catálogo —
//   marcan los niveles sin corregimiento — y los accesores las excluyen.
//   OJO: el catálogo escribe "PANAMA" sin tilde; se cita tal cual.
// - CPBS: Codificación Panameña de Bienes y Servicios (Tabla 4), segmento
//   (2 dígitos) y familia (4). Obligatoria por renglón con receptor gobierno.
import CPBS from "@/lib/hka/datos/cpbs.json";
import UBICACIONES from "@/lib/hka/datos/ubicaciones-dgi.json";

export interface UbicacionDgi {
  codigo: string;
  provincia: string;
  distrito: string;
  corregimiento: string;
}

export interface SegmentoCpbs {
  codigo: string;
  nombre: string;
}

export interface FamiliaCpbs {
  codigo: string;
  segmento: string;
  nombre: string;
}

const TODAS = UBICACIONES as UbicacionDgi[];

/** Solo los corregimientos reales (sin las filas INVALIDO del catálogo). */
export function ubicacionesDgi(): UbicacionDgi[] {
  return TODAS.filter((u) => u.corregimiento !== "INVALIDO");
}

/** La fila exacta de un código "P-D-C", o null si no existe en el catálogo. */
export function buscarUbicacion(codigo: string): UbicacionDgi | null {
  const fila = TODAS.find(
    (u) => u.codigo === codigo && u.corregimiento !== "INVALIDO"
  );
  return fila ?? null;
}

export const SEGMENTOS_CPBS = (CPBS as {
  segmentos: SegmentoCpbs[];
  familias: FamiliaCpbs[];
}).segmentos;

export const FAMILIAS_CPBS = (CPBS as {
  segmentos: SegmentoCpbs[];
  familias: FamiliaCpbs[];
}).familias;

/** La familia CPBS de 4 dígitos (con su segmento), o null si no existe. */
export function familiaCpbs(codigo: string): FamiliaCpbs | null {
  return FAMILIAS_CPBS.find((f) => f.codigo === codigo) ?? null;
}
