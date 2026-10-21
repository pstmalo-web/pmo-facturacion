// Tipos del documento electrónico de The Factory HKA (PAC de la DGI).
//
// El diccionario autoritativo de campos es la wiki SOAP
// (felwiki.thefactoryhka.com.pa/enviar) — el API REST del helpdesk es el
// mismo modelo en JSON. Los catálogos completos viven en el PDF de anexos
// técnicos; aquí solo están los valores que ERMA usa de verdad.
import type { LineaCalculable } from "@/lib/calc";

/** 01 contribuyente · 02 consumidor final · 03 GOBIERNO · 04 extranjero. */
export type TipoClienteFE = "01" | "02" | "03" | "04";

/** 01 factura interna · 04 NC referente a FE · 06 NC genérica. */
export type TipoDocumentoFiscal = "01" | "04" | "06";

/** 01 crédito · 02 efectivo · 03 TC · 04 TD · 08 transferencia · 09 cheque. */
export type FormaPagoFiscal = "01" | "02" | "03" | "04" | "08" | "09";

export interface ReceptorFactura {
  tipoClienteFE: TipoClienteFE;
  /** "1" natural, "2" jurídico. Las entidades del Estado son jurídicas. */
  tipoContribuyente: "1" | "2";
  /** Formato estatal, ej. "8-NT-1-13656". */
  ruc: string;
  /** Obligatorio y VÁLIDO con tipoClienteFE 01/03 (algoritmo DGI). */
  dv: string;
  razonSocial: string;
  /** 5..100 caracteres — obligatoria con gobierno. */
  direccion: string;
  /** "provincia-distrito-corregimiento" del catálogo DGI, ej. "8-8-14". */
  codigoUbicacion: string;
  /** Textos EXACTOS del catálogo unificado (tildes incluidas). */
  provincia: string;
  distrito: string;
  corregimiento: string;
  correo?: string;
  telefono?: string;
}

export interface RenglonFactura extends LineaCalculable {
  /** 2..500 caracteres. */
  descripcion: string;
  /** Tabla 3 del anexo (nombre exacto, ej. "und"). */
  unidadMedida?: string;
  /** Segmento CPBS (2 dígitos) — OBLIGATORIO con receptor gobierno. */
  cpbsAbrev?: string;
  /** Segmento+familia CPBS (4 dígitos) — OBLIGATORIO con receptor gobierno. */
  cpbs?: string;
  /** Defecto: la misma `unidadMedida`. */
  unidadMedidaCpbs?: string;
  renglonNumero?: number | null;
}

export interface DatosFacturaHka {
  /** "0000" = casa matriz. */
  sucursal: string;
  /** 3 dígitos, nunca "000". La serie del PMO, distinta de la de Dfactura. */
  puntoFacturacion: string;
  /** Correlativo de la serie (1..9999999999), lo asigna `siguiente_numero_fiscal`. */
  numeroDocumento: number;
  /** Defecto "01" (factura de operación interna). */
  tipoDocumento?: TipoDocumentoFiscal;
  fechaEmision: Date;
  receptor: ReceptorFactura;
  items: RenglonFactura[];
  /**
   * Retención del 50 % del ITBMS por venta al Estado (codigoRetencion "2").
   * Decisión de Paul 2026-08-13: siempre que se le vende al Estado.
   */
  retenerItbms50: boolean;
  /** Defecto "01" (crédito): así se cobra al Estado. */
  formaPago?: FormaPagoFiscal;
  /**
   * Términos de pago: las cuotas del crédito (Paul trabaja a crédito, decisión
   * 2026-08-18). Deben sumar EXACTO el total de la factura. Si no vienen, se
   * arma una cuota única a `diasCredito` días.
   */
  cuotas?: CuotaPago[];
  /** Días calendario para la cuota única por defecto. Defecto 30. */
  diasCredito?: number;
  /** Nº de O/C de PanamaCompra → pedidoComercialGlobal. */
  numeroOrdenCompra?: string;
  /** Texto libre (hasta 5000) que viaja en informacionInteres. */
  informacionInteres?: string;
}

/** Una cuota del pago a plazo (listaPagoPlazo). */
export interface CuotaPago {
  /** Fecha de vencimiento, YYYY-MM-DD (el armador le pone la hora y el huso). */
  vence: string;
  monto: number;
}

/** Serie que identifica un documento ante HKA (Estado/Anulación/Descarga). */
export interface SerieDocumento {
  sucursal: string;
  puntoFacturacion: string;
  tipoDocumento: string;
  numeroDocumento: number;
  /** Defecto "01" (autorización previa normal). */
  tipoEmision?: string;
}
