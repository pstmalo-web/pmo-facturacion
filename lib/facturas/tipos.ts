// Tipos y catálogos de la factura electrónica (migración 083).
// El catálogo de estados sigue el patrón de ESTADOS en lib/types.ts: un solo
// lugar con valor + etiqueta + tinte; chips y paneles derivan de aquí.

export type EstadoFactura =
  | "borrador"
  | "emitiendo"
  | "autorizada"
  | "rechazada"
  | "anulada";

export const ESTADOS_FACTURA: { valor: EstadoFactura; etiqueta: string; hex: string }[] = [
  { valor: "borrador", etiqueta: "Borrador", hex: "#a8a69f" },
  { valor: "emitiendo", etiqueta: "Emitiendo…", hex: "#5e7f9b" },
  { valor: "autorizada", etiqueta: "Autorizada", hex: "#6b8e5a" },
  { valor: "rechazada", etiqueta: "Rechazada", hex: "#b83a4b" },
  { valor: "anulada", etiqueta: "Anulada", hex: "#8a6e9e" },
];

export const HEX_ESTADO_FACTURA = Object.fromEntries(
  ESTADOS_FACTURA.map((e) => [e.valor, e.hex])
) as Record<EstadoFactura, string>;

export const ETIQUETA_ESTADO_FACTURA = Object.fromEntries(
  ESTADOS_FACTURA.map((e) => [e.valor, e.etiqueta])
) as Record<EstadoFactura, string>;

export interface Factura {
  id: string;
  proyecto_id: string | null;
  cotizacion_id: string | null;
  entidad_id: string | null;
  sucursal: string;
  punto_facturacion: string;
  tipo_documento: string;
  numero_documento: number | null;
  /** 'demo' = ensayo sin valor fiscal (borrable); 'produccion' = real (085). */
  ambiente: "demo" | "produccion";
  estado: EstadoFactura;
  receptor: Record<string, unknown>;
  total_neto: number;
  total_itbms: number;
  total: number;
  retencion_aplicada: boolean;
  retencion_monto: number | null;
  forma_pago: string;
  tiempo_pago: string;
  correos: string[];
  fecha_emision: string | null;
  cufe: string | null;
  qr_url: string | null;
  protocolo_autorizacion: string | null;
  mensaje_error: string | null;
  payload: Record<string, unknown> | null;
  respuesta: Record<string, unknown> | null;
  pdf_path: string | null;
  xml_path: string | null;
  motivo_anulacion: string | null;
  anulada_en: string | null;
  created_at?: string;
}

export interface FacturaItemDb {
  id: string;
  factura_id: string;
  orden: number;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  itbms_exento: boolean;
  valor_itbms: number;
  cpbs_abrev: string | null;
  cpbs: string | null;
  unidad_medida: string;
  unidad_medida_cpbs: string | null;
  renglon_numero: number | null;
}

export interface EntidadFiscal {
  id: string;
  nombre: string;
  siglas: string | null;
  tipo_ruc: "1" | "2";
  ruc: string;
  dv: string;
  razon_social: string;
  direccion: string;
  codigo_ubicacion: string | null;
  provincia: string | null;
  distrito: string | null;
  corregimiento: string | null;
  correo: string | null;
  telefono: string | null;
  verificado_en: string | null;
  afiliado_fe: boolean | null;
  notas: string;
}

export interface EntidadAlias {
  entidad_id: string;
  alias: string;
}

/** Número fiscal como lo imprime la DGI: 10 dígitos con ceros. */
export function numeroFiscal(n: number | null): string {
  return n == null ? "—" : String(n).padStart(10, "0");
}
