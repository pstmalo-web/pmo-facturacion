// Caso real de verificación del MVP: la cotización EST0536 (Unicrese).
// Único dueño del oráculo de totales — lo consumen lib/calc.test.ts y
// scripts/prueba-pdf.tsx.
import type { CotizacionItem } from "@/lib/types";

export const ITEMS_EST0536: CotizacionItem[] = [
  {
    id: "1",
    cotizacion_id: "test",
    orden: 0,
    nombre: "Camisa U-Trail - M/C - Para Dama y Caballero",
    descripcion:
      "Marca: U-Trail\nCasa Productora: Unicrese\nPaís de Origen: Panamá\nGarantía: 1 año de garantía para todos los bienes, por desperfectos de fabrica, o servicios; según lo dispuesto en el Capítulo XI ART. 86 del Decreto 439 de la Ley 22.",
    precio_unitario: 24.0,
    cantidad: 100,
    itbms_exento: false,
    // Irrelevante para el oráculo (aquí solo se verifican totales).
    renglon_numero: null,
  },
  {
    id: "2",
    cotizacion_id: "test",
    orden: 1,
    nombre: "Pantalón U-Trail - Para Dama y Caballero",
    descripcion:
      "Marca: U-Trail\nCasa Productora: Unicrese\nPaís de Origen: Panamá\nGarantía: 1 año de garantía para todos los bienes, por desperfectos de fabrica, o servicios; según lo dispuesto en el Capítulo XI ART. 86 del Decreto 439 de la Ley 22.",
    precio_unitario: 17.0,
    cantidad: 100,
    itbms_exento: false,
    // Irrelevante para el oráculo (aquí solo se verifican totales).
    renglon_numero: null,
  },
];

export const TOTALES_EST0536 = { parcial: 4100, itbms: 287, total: 4387 };
