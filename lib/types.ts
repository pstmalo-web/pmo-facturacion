// Tipos compartidos del PMO, recortados a lo que usa facturación.

/** Un renglón de cotización, tal como lo lee el formulario de la factura. */
export interface CotizacionItem {
  id: string;
  cotizacion_id: string;
  orden: number;
  nombre: string;
  descripcion: string | null;
  precio_unitario: number;
  cantidad: number;
  itbms_exento: boolean;
  /**
   * Renglón del pliego al que corresponde la línea. NULL en las líneas
   * escritas a mano.
   */
  renglon_numero: number | null;
}
