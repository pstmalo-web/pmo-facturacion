export interface LineaCalculable {
  precio_unitario: number;
  cantidad: number;
  itbms_exento: boolean;
}

export const TASA_ITBMS = 0.07;

export function totalLinea(item: LineaCalculable): number {
  return redondear(item.precio_unitario * item.cantidad);
}

/**
 * ITBMS de UN renglón, redondeado a 2 decimales. Exento = 0.
 *
 * Existe porque **así lo modela PanamaCompra** (verificado el 2026-08-09 contra
 * cinco actos abiertos, ocho renglones): cada renglón del portal viaja con
 * `precio`, `cantidad` e `itbms` propios, donde el `itbms` es un MONTO igual a
 * `precio × cantidad × 0.07`, y el total del renglón es
 * `precioReferencia = precio × cantidad + itbms`. Cuando alguien sube nuestra
 * propuesta, el portal recalcula con esa aritmética, renglón por renglón.
 *
 * Es también la cifra que el PDF y el editor ya pintaban en su columna de
 * ITBMS —solo que sin redondear y sin pasar por aquí—, así que la columna podía
 * no sumar el ITBMS del pie de su propia hoja.
 */
export function itbmsLinea(item: LineaCalculable): number {
  if (item.itbms_exento) return 0;
  return redondear(totalLinea(item) * TASA_ITBMS);
}

/**
 * Totales de la cotización.
 *
 * **El ITBMS se suma renglón a renglón, no se calcula una vez sobre la base
 * gravada** (cambio del 2026-08-09, decisión de Paul). Redondear al final da un
 * número distinto que sumar redondeos, y el que manda es el del portal: es
 * quien recalcula el total contra el que se compite. La diferencia es de un
 * centavo y rarísima —1 de las 323 cotizaciones vivas el día del cambio, la
 * EST0631: 291.09 pasa a 291.08—, pero dos cuentas conviviendo es exactamente
 * cómo el PDF firmado y el portal acaban diciendo cosas distintas.
 *
 * OJO: el espejo de esta función en SQL es el CTE `totales` de la RPC
 * `kpis_dashboard` (migración 076). Si se toca una, se toca la otra, o el
 * Dashboard y la lista de Cotizaciones pintan totales distintos de los mismos
 * renglones.
 */
export function calcularTotales(items: LineaCalculable[]) {
  const parcial = redondear(items.reduce((s, it) => s + totalLinea(it), 0));
  const itbms = redondear(items.reduce((s, it) => s + itbmsLinea(it), 0));
  const total = redondear(parcial + itbms);
  return { parcial, itbms, total };
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface LineaCosteable extends LineaCalculable {
  /** NULL = costo no capturado. NUNCA 0 (ver `Articulo.costo_unitario`). */
  costo_unitario?: number | null;
}

/**
 * Margen de la cotización, para los canales donde no hay techo publicado
 * (Gobierno y Privado, migración 063): ahí no se compite contra el precio de
 * referencia de la entidad sino contra nuestro propio piso, y el margen es el
 * único dato que dice si el precio se sostiene.
 *
 * Tres reglas, cada una una forma de no mentir:
 *
 * 1. **Se mide sobre el PARCIAL, nunca sobre el total.** El ITBMS no es
 *    ingreso: se cobra y se entrega. Meterlo en el margen lo infla ~7 % sobre
 *    plata que nunca fue nuestra. Es la misma trampa que `brechaSobreReferencia`
 *    evita al revés (ahí la referencia SÍ trae ITBMS y hay que comparar con el
 *    total) — la diferencia está en qué es cada cifra, no en el gusto.
 * 2. **Sin ningún costo capturado devuelve `null`, no cero.** Un costo de 0
 *    diría "margen del 100 %", que es la lectura más halagadora y más falsa
 *    posible. NULL obliga a la UI a decir "sin costo".
 * 3. **La cobertura viaja con la cifra.** Si 3 de 10 renglones tienen costo, el
 *    margen que sale NO es el de la cotización, y quien lo lea tiene que
 *    saberlo. Por eso `cubiertos`/`renglones` van en la respuesta en vez de
 *    quedarse en un promedio silencioso.
 */
export function calcularMargen(items: LineaCosteable[]): {
  /** Costo de los renglones que SÍ tienen costo capturado. */
  costo: number;
  /** Ingreso (sin ITBMS) de esos mismos renglones, no de la cotización entera. */
  ingreso: number;
  /** Ingreso − costo, en dólares. */
  margen: number;
  /** Margen sobre el ingreso, en %. */
  porcentaje: number;
  cubiertos: number;
  renglones: number;
} | null {
  const conCosto = items.filter(
    (i) => i.costo_unitario !== null && i.costo_unitario !== undefined
  );
  if (conCosto.length === 0) return null;

  const costo = redondear(
    conCosto.reduce((s, i) => s + (i.costo_unitario ?? 0) * i.cantidad, 0)
  );
  const ingreso = redondear(conCosto.reduce((s, i) => s + totalLinea(i), 0));
  const margen = redondear(ingreso - costo);
  // Un ingreso de 0 con costo encima no tiene porcentaje que signifique algo
  // (sería infinito): se reporta 0 y el lector ve el margen negativo en dólares.
  const porcentaje = ingreso === 0 ? 0 : redondear((margen / ingreso) * 100);

  return {
    costo,
    ingreso,
    margen,
    porcentaje,
    cubiertos: conCosto.length,
    renglones: items.length,
  };
}
