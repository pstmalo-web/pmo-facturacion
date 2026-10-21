// Roles del PMO, recortados a lo que el módulo de facturación necesita.
//
// En el PMO real este archivo trae los predicados de todas las pestañas; aquí
// solo quedan los de facturación. Las firmas son IDÉNTICAS a las del PMO: el
// código del módulo se copia de vuelta tal cual, así que no cambiarlas.

export type Rol = "admin" | "pm" | "cotizador" | "auditor" | "cofounder";

export interface Perfil {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: Rol;
  foto_url: string | null;
}

export const ROLES: Rol[] = ["admin", "pm", "cotizador", "auditor", "cofounder"];

/** Auditor y Co-Founder: ven todo, no escriben nada. */
export function esRolSoloLectura(rol: Rol): boolean {
  return rol === "auditor" || rol === "cofounder";
}

/**
 * Interruptor del módulo. En el PMO real está APAGADO (false) hasta el pase a
 * producción; en este repo va encendido para poder trabajar.
 */
export const FACTURACION_ACTIVA = true;

/** ¿Entra a `/facturacion`? Todos menos el Cotizador. */
export function puedeVerFacturacion(rol: Rol): boolean {
  return FACTURACION_ACTIVA && rolVeFacturacion(rol);
}

export function rolVeFacturacion(rol: Rol): boolean {
  return rol !== "cotizador";
}

/** ¿Emite, anula, reenvía o borra? Solo Admin y PM. */
export function puedeEmitirFacturas(rol: Rol): boolean {
  return FACTURACION_ACTIVA && rolEmiteFacturas(rol);
}

export function rolEmiteFacturas(rol: Rol): boolean {
  return rol === "admin" || rol === "pm";
}

export function nombreCompleto(p: Perfil): string {
  const nombre = `${p.nombre} ${p.apellido}`.trim();
  return nombre || p.email;
}
