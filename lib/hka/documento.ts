// Armador del JSON de `Enviar` (factura electrónica, The Factory HKA).
//
// Librería PURA, como lib/documentos/: sin Next, sin env, ejecutable desde
// tsx y vitest. El cliente HTTP vive aparte en lib/hka/cliente.ts.
//
// LA REGLA QUE NO SE NEGOCIA: los montos salen de `calcularTotales` /
// `itbmsLinea` / `totalLinea` (lib/calc.ts), jamás se recalculan aquí. HKA
// exige coherencia aritmética exacta (un descuadre es error 109) y una
// tercera cuenta del ITBMS conviviendo con la del PDF y la del portal es
// exactamente cómo un centavo divergente (el caso EST0631) rebota una
// factura o deja el CAFE diciendo algo distinto de la cotización firmada.
//
// Reglas del servicio que este armador encarna (wiki felwiki + helpdesk):
// - Montos como STRING con punto decimal y 2 decimales.
// - Campos que no aplican se OMITEN del JSON — nunca "" ni null (podar()).
// - numeroDocumentoFiscal a 10 dígitos y punto de facturación a 3, con ceros.
// - fechaEmision en hora de Panamá con huso explícito -05:00 (sin DST).
// - totalMontoGravado es la SUMA DE IMPUESTOS (nombre engañoso de la ficha),
//   no la base gravable.
// - Receptor gobierno (tipoClienteFE 03): RUC+DV+razón social+dirección+
//   ubicación obligatorios y CPBS por renglón — el rechazo típico documentado.
import {
  calcularTotales,
  itbmsLinea,
  totalLinea,
  type LineaCalculable,
} from "@/lib/calc";
import type { DatosFacturaHka, RenglonFactura } from "@/lib/hka/tipos";

export class ErrorFacturaInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorFacturaInvalida";
  }
}

/** Resumen en números (no strings) para persistir en la fila de `facturas`. */
export interface ResumenFactura {
  totalNeto: number;
  totalItbms: number;
  total: number;
  retencionMonto: number | null;
}

export interface DocumentoArmado {
  /** El objeto que viaja como {"documento": ...} en POST /api/Enviar. */
  documento: Record<string, unknown>;
  resumen: ResumenFactura;
}

/** "1234.5" → "1234.50". Todos los montos del JSON viajan así. */
function m2(n: number): string {
  return n.toFixed(2);
}

/** Mitad del ITBMS redondeada a 2 decimales (retención del Estado). */
export function retencionItbms50(totalItbms: number): number {
  return Math.round((totalItbms / 2) * 100) / 100;
}

/** Fecha-hora del instante en Panamá con huso fijo (Panamá no tiene DST). */
export function fechaEmisionPanama(instante: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Panama",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instante);
  const v = (tipo: string) =>
    partes.find((p) => p.type === tipo)?.value ?? "00";
  // en-CA con hour12:false puede dar "24" a medianoche.
  const hora = v("hour") === "24" ? "00" : v("hour");
  return `${v("year")}-${v("month")}-${v("day")}T${hora}:${v("minute")}:${v("second")}-05:00`;
}

/** Solo la fecha (YYYY-MM-DD) de un instante, en el calendario de Panamá. */
function fechaPanama(instante: Date): string {
  return fechaEmisionPanama(instante).slice(0, 10);
}

/**
 * Quita del objeto todo lo que el servicio prohíbe mandar vacío: undefined,
 * null, "" y listas vacías. Regla explícita del manual — una etiqueta vacía
 * rechaza el documento.
 */
export function podar(valor: unknown): unknown {
  if (Array.isArray(valor)) {
    const lista = valor.map(podar).filter((v) => v !== undefined);
    return lista.length === 0 ? undefined : lista;
  }
  if (valor !== null && typeof valor === "object") {
    const limpio: Record<string, unknown> = {};
    for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
      const podado = podar(v);
      if (podado !== undefined) limpio[clave] = podado;
    }
    return Object.keys(limpio).length === 0 ? undefined : limpio;
  }
  if (valor === undefined || valor === null || valor === "") return undefined;
  return valor;
}

function validar(datos: DatosFacturaHka): void {
  const { receptor, items } = datos;

  if (!/^\d{3}$/.test(datos.puntoFacturacion) || datos.puntoFacturacion === "000") {
    throw new ErrorFacturaInvalida(
      `El punto de facturación debe ser de 3 dígitos y nunca "000" (llegó "${datos.puntoFacturacion}").`
    );
  }
  if (
    !Number.isInteger(datos.numeroDocumento) ||
    datos.numeroDocumento < 1 ||
    datos.numeroDocumento > 9999999999
  ) {
    throw new ErrorFacturaInvalida(
      `El número de documento fiscal debe estar entre 1 y 9999999999 (llegó ${datos.numeroDocumento}).`
    );
  }
  if (items.length === 0) {
    throw new ErrorFacturaInvalida("La factura no tiene renglones.");
  }

  const esGobiernoOContribuyente =
    receptor.tipoClienteFE === "01" || receptor.tipoClienteFE === "03";
  if (esGobiernoOContribuyente) {
    if (!receptor.ruc || !receptor.dv) {
      throw new ErrorFacturaInvalida(
        "El receptor gobierno/contribuyente necesita RUC y DV válidos (verifícalos con ConsultaRucDv)."
      );
    }
    if (!receptor.razonSocial) {
      throw new ErrorFacturaInvalida("Falta la razón social del receptor.");
    }
    if (!receptor.direccion || receptor.direccion.length < 5) {
      throw new ErrorFacturaInvalida(
        "La dirección del receptor es obligatoria (mínimo 5 caracteres)."
      );
    }
    if (
      !receptor.codigoUbicacion ||
      !receptor.provincia ||
      !receptor.distrito ||
      !receptor.corregimiento
    ) {
      throw new ErrorFacturaInvalida(
        "Falta la ubicación del receptor (código y textos exactos del catálogo DGI)."
      );
    }
  }

  for (const [i, item] of items.entries()) {
    if (!item.descripcion || item.descripcion.trim().length < 2) {
      throw new ErrorFacturaInvalida(
        `El renglón ${i + 1} necesita una descripción de al menos 2 caracteres.`
      );
    }
    if (receptor.tipoClienteFE === "03" && (!item.cpbsAbrev || !item.cpbs)) {
      throw new ErrorFacturaInvalida(
        `El renglón ${i + 1} ("${item.descripcion.slice(0, 40)}…") no tiene códigos CPBS: ` +
          "con receptor gobierno son obligatorios y su ausencia es la causa de rechazo más común."
      );
    }
  }
}

function armarItem(item: RenglonFactura): Record<string, unknown> {
  const linea: LineaCalculable = item;
  const precioItem = totalLinea(linea);
  const valorItbms = itbmsLinea(linea);
  const unidad = item.unidadMedida ?? "und";

  return {
    descripcion: item.descripcion.slice(0, 500),
    cantidad: m2(item.cantidad),
    unidadMedida: unidad,
    codigoCPBSAbrev: item.cpbsAbrev,
    codigoCPBS: item.cpbs,
    unidadMedidaCPBS:
      item.cpbsAbrev || item.cpbs ? (item.unidadMedidaCpbs ?? unidad) : undefined,
    precioUnitario: m2(item.precio_unitario),
    precioItem: m2(precioItem),
    // valorTotal del ítem INCLUYE sus impuestos (regla de la ficha).
    valorTotal: m2(precioItem + valorItbms),
    tasaITBMS: item.itbms_exento ? "00" : "01",
    valorITBMS: m2(valorItbms),
  };
}

/**
 * Arma el documento de `Enviar` a partir de los datos del PMO.
 *
 * OJO emisor: el RUC de ERMA NO viaja en el JSON — lo determinan las
 * credenciales y la sucursal/punto configurados en Dfactura.
 */
export function armarDocumento(datos: DatosFacturaHka): DocumentoArmado {
  validar(datos);

  const totales = calcularTotales(datos.items);
  const retencionMonto = datos.retenerItbms50
    ? retencionItbms50(totales.itbms)
    : null;

  const formaPago = datos.formaPago ?? "01";

  // TÉRMINOS DE PAGO. Las cuotas vienen del formulario (Paul trabaja a
  // crédito y fija sus plazos); sin cuotas explícitas se arma una única a
  // `diasCredito` días. Regla del servicio validada en demo el 2026-08-18:
  // fechaVenceCuota exige el formato COMPLETO con hora y huso
  // (AAAA-MM-DDThh:mm:ss-05:00) — la fecha sola rebota con error de campo.
  let cuotas = datos.cuotas;
  if (!cuotas || cuotas.length === 0) {
    const vencimiento = new Date(
      datos.fechaEmision.getTime() + (datos.diasCredito ?? 30) * 24 * 3600 * 1000
    );
    cuotas = [{ vence: fechaPanama(vencimiento), monto: totales.total }];
  }
  for (const [i, c] of cuotas.entries()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.vence)) {
      throw new ErrorFacturaInvalida(
        `La cuota ${i + 1} necesita fecha de vencimiento (AAAA-MM-DD); llegó "${c.vence}".`
      );
    }
  }
  const sumaCuotas = cuotas.reduce((s, c) => s + c.monto, 0);
  if (Math.abs(sumaCuotas - totales.total) >= 0.005) {
    throw new ErrorFacturaInvalida(
      `Las cuotas suman ${m2(sumaCuotas)} pero el total de la factura es ${m2(totales.total)}: deben cuadrar al centavo.`
    );
  }

  // CUADRE DEL PAGO (validado contra el ejemplo oficial /factura_con_retencion):
  // la forma de pago y el valor recibido viajan por el TOTAL completo; la
  // retención (codigoRetencion "2" = venta al Estado, 50 % del ITBMS) se
  // declara en su bloque propio y NO descuenta nada.
  const cuota = m2(totales.total);

  const documento = {
    codigoSucursalEmisor: datos.sucursal,
    tipoSucursal: "1",
    datosTransaccion: {
      tipoEmision: "01",
      tipoDocumento: datos.tipoDocumento ?? "01",
      numeroDocumentoFiscal: String(datos.numeroDocumento).padStart(10, "0"),
      puntoFacturacionFiscal: datos.puntoFacturacion,
      fechaEmision: fechaEmisionPanama(datos.fechaEmision),
      naturalezaOperacion: "01",
      tipoOperacion: "1",
      destinoOperacion: "1",
      formatoCAFE: "3",
      entregaCAFE: "3",
      envioContenedor: "1",
      procesoGeneracion: "1",
      tipoVenta: "1",
      informacionInteres: datos.informacionInteres,
      cliente: {
        tipoClienteFE: datos.receptor.tipoClienteFE,
        tipoContribuyente: datos.receptor.tipoContribuyente,
        numeroRUC: datos.receptor.ruc,
        digitoVerificadorRUC: datos.receptor.dv,
        razonSocial: datos.receptor.razonSocial,
        direccion: datos.receptor.direccion.slice(0, 100),
        codigoUbicacion: datos.receptor.codigoUbicacion,
        provincia: datos.receptor.provincia,
        distrito: datos.receptor.distrito,
        corregimiento: datos.receptor.corregimiento,
        correoElectronico1: datos.receptor.correo,
        telefono1: datos.receptor.telefono,
        pais: "PA",
      },
    },
    listaItems: datos.items.map(armarItem),
    totalesSubTotales: {
      totalPrecioNeto: m2(totales.parcial),
      totalITBMS: m2(totales.itbms),
      // Nombre engañoso de la ficha: es la SUMA DE IMPUESTOS, no la base.
      totalMontoGravado: m2(totales.itbms),
      totalFactura: m2(totales.total),
      totalValorRecibido: cuota,
      tiempoPago: "2",
      nroItems: String(datos.items.length),
      totalTodosItems: m2(totales.total),
      listaFormaPago: [
        { formaPagoFact: formaPago, valorCuotaPagada: cuota },
      ],
      listaPagoPlazo: cuotas.map((c, i) => ({
        fechaVenceCuota: `${c.vence}T00:00:00-05:00`,
        valorCuota: m2(c.monto),
        // Obligatorio con longitud mínima (rechazo demo 2026-08-18): el
        // ejemplo oficial manda un texto libre («Cuota automatica de sistema»).
        infoPagoCuota: `Cuota ${i + 1} de ${cuotas!.length} - vence ${c.vence}`,
      })),
      retencion: retencionMonto
        ? { codigoRetencion: "2", montoRetencion: m2(retencionMonto) }
        : undefined,
    },
    pedidoComercialGlobal: datos.numeroOrdenCompra
      ? { nroPedidoCompraGlobal: datos.numeroOrdenCompra }
      : undefined,
  };

  return {
    documento: podar(documento) as Record<string, unknown>,
    resumen: {
      totalNeto: totales.parcial,
      totalItbms: totales.itbms,
      total: totales.total,
      retencionMonto,
    },
  };
}
