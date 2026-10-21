// En el PMO, `ProyectoFull` es el proyecto completo del board (tareas,
// archivos, resumen, cobros…). Facturación solo lee estas columnas, así que
// aquí el tipo se queda en ellas. No añadirle campos: lo que el módulo
// necesite de un proyecto debe salir de este mismo puñado.

export interface ProyectoFull {
  id: string;
  nombre: string;
  cliente: string | null;
  numero_acto: string | null;
  cotizacion_id: string | null;
  numero_oc?: string | null;
}
