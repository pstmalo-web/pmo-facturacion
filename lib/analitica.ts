// En el PMO esto manda el nombre del evento a Vercel Analytics. Aquí no mide
// nada: solo conserva la firma para que el módulo compile igual.

export const EVENTOS_USO = ["factura_emitir"] as const;

export type EventoUso = (typeof EVENTOS_USO)[number];

/** Registra un evento de uso. Nunca lanza y no lleva datos, solo el nombre. */
export function registrarUso(_evento: EventoUso): void {}
