import { describe, expect, it } from "vitest";
import { calcularTotales } from "@/lib/calc";
import {
  armarDocumento,
  ErrorFacturaInvalida,
  fechaEmisionPanama,
  podar,
  retencionItbms50,
} from "@/lib/hka/documento";
import { ITEMS_EST0536 } from "@/lib/pruebas/caso-est0536";
import type { DatosFacturaHka, RenglonFactura } from "@/lib/hka/tipos";

// Receptor del ejemplo oficial de la wiki (factura_a_cliente_gobierno).
const MEDUCA = {
  tipoClienteFE: "03" as const,
  tipoContribuyente: "2" as const,
  ruc: "8-NT-1-13656",
  dv: "43",
  razonSocial: "MINISTERIO DE EDUCACIÓN",
  direccion: "Cárdenas, Ciudad de Panamá",
  codigoUbicacion: "8-8-14",
  provincia: "PANAMA",
  distrito: "PANAMÁ",
  corregimiento: "ANCON",
  correo: "compras@meduca.gob.pa",
};

function datosBase(items: RenglonFactura[]): DatosFacturaHka {
  return {
    sucursal: "0000",
    puntoFacturacion: "002",
    numeroDocumento: 123,
    fechaEmision: new Date("2026-08-13T15:30:00Z"),
    receptor: MEDUCA,
    items,
    retenerItbms50: true,
    numeroOrdenCompra: "4600089999",
  };
}

const RENGLONES: RenglonFactura[] = [
  {
    descripcion: "Cámara IP domo 4MP",
    precio_unitario: 100,
    cantidad: 2,
    itbms_exento: false,
    cpbsAbrev: "46",
    cpbs: "4617",
    unidadMedida: "und",
  },
  {
    descripcion: "Libro técnico (exento)",
    precio_unitario: 50,
    cantidad: 1,
    itbms_exento: true,
    cpbsAbrev: "55",
    cpbs: "5510",
    unidadMedida: "und",
  },
];

describe("armarDocumento", () => {
  const { documento, resumen } = armarDocumento(datosBase(RENGLONES));
  const trans = documento.datosTransaccion as Record<string, unknown>;
  const totales = documento.totalesSubTotales as Record<string, unknown>;
  const items = documento.listaItems as Record<string, unknown>[];

  it("los totales SON los de calcularTotales, nunca otra cuenta", () => {
    const esperado = calcularTotales(RENGLONES);
    expect(esperado).toEqual({ parcial: 250, itbms: 14, total: 264 });
    expect(totales.totalPrecioNeto).toBe("250.00");
    expect(totales.totalITBMS).toBe("14.00");
    expect(totales.totalFactura).toBe("264.00");
    expect(resumen).toEqual({
      totalNeto: 250,
      totalItbms: 14,
      total: 264,
      retencionMonto: 7,
    });
  });

  it("totalMontoGravado es la SUMA DE IMPUESTOS (nombre engañoso), no la base", () => {
    expect(totales.totalMontoGravado).toBe(totales.totalITBMS);
  });

  it("el ITBMS viaja renglón a renglón como monto, y el exento en 0.00", () => {
    expect(items[0].tasaITBMS).toBe("01");
    expect(items[0].valorITBMS).toBe("14.00");
    expect(items[0].precioItem).toBe("200.00");
    expect(items[0].valorTotal).toBe("214.00"); // incluye su impuesto
    expect(items[1].tasaITBMS).toBe("00");
    expect(items[1].valorITBMS).toBe("0.00");
    expect(items[1].valorTotal).toBe("50.00");
  });

  it("totalTodosItems cuadra con la suma de valorTotal por ítem", () => {
    const suma = items.reduce((s, it) => s + Number(it.valorTotal), 0);
    expect(Number(totales.totalTodosItems)).toBeCloseTo(suma, 2);
  });

  it("la retención al Estado es el 50 % del ITBMS", () => {
    expect(totales.retencion).toEqual({
      codigoRetencion: "2",
      montoRetencion: "7.00",
    });
    expect(retencionItbms50(14)).toBe(7);
    expect(retencionItbms50(0.07)).toBe(0.04); // redondeo a 2 decimales
  });

  it("número fiscal a 10 dígitos, punto a 3, y la serie del documento", () => {
    expect(trans.numeroDocumentoFiscal).toBe("0000000123");
    expect(trans.puntoFacturacionFiscal).toBe("002");
    expect(documento.codigoSucursalEmisor).toBe("0000");
    expect(trans.tipoDocumento).toBe("01");
  });

  it("la fecha de emisión va en hora de Panamá con -05:00", () => {
    // 15:30Z = 10:30 en Panamá.
    expect(trans.fechaEmision).toBe("2026-08-13T10:30:00-05:00");
  });

  it("el receptor gobierno viaja completo, con país PA", () => {
    const cliente = (trans as { cliente: Record<string, unknown> }).cliente;
    expect(cliente.tipoClienteFE).toBe("03");
    expect(cliente.numeroRUC).toBe("8-NT-1-13656");
    expect(cliente.digitoVerificadorRUC).toBe("43");
    expect(cliente.codigoUbicacion).toBe("8-8-14");
    expect(cliente.pais).toBe("PA");
  });

  it("la O/C de PanamaCompra viaja en pedidoComercialGlobal", () => {
    expect(documento.pedidoComercialGlobal).toEqual({
      nroPedidoCompraGlobal: "4600089999",
    });
  });

  it("el pago del Estado es a plazo: cuota única que cuadra con el total", () => {
    expect(totales.tiempoPago).toBe("2");
    expect(totales.listaFormaPago).toEqual([
      { formaPagoFact: "01", valorCuotaPagada: "264.00" },
    ]);
    const plazo = (totales.listaPagoPlazo as Record<string, unknown>[])[0];
    expect(plazo.valorCuota).toBe("264.00");
    // Reglas validadas en demo (2026-08-18): fechaVenceCuota exige el formato
    // COMPLETO con hora y huso, e infoPagoCuota es OBLIGATORIO con longitud
    // mínima aunque la ficha lo pinte opcional.
    expect(plazo.fechaVenceCuota).toBe("2026-09-12T00:00:00-05:00"); // 30 días
    expect(plazo.infoPagoCuota).toBe("Cuota 1 de 1 - vence 2026-09-12");
  });

  it("las cuotas del formulario mandan sobre el defecto y cuadran al centavo", () => {
    const { documento: doc } = armarDocumento({
      ...datosBase(RENGLONES),
      cuotas: [
        { vence: "2026-10-01", monto: 100 },
        { vence: "2026-11-01", monto: 164 },
      ],
    });
    const plazos = (doc.totalesSubTotales as Record<string, unknown>)
      .listaPagoPlazo as Record<string, unknown>[];
    expect(plazos).toEqual([
      {
        fechaVenceCuota: "2026-10-01T00:00:00-05:00",
        valorCuota: "100.00",
        infoPagoCuota: "Cuota 1 de 2 - vence 2026-10-01",
      },
      {
        fechaVenceCuota: "2026-11-01T00:00:00-05:00",
        valorCuota: "164.00",
        infoPagoCuota: "Cuota 2 de 2 - vence 2026-11-01",
      },
    ]);
  });

  it("cuotas que no suman el total no salen del PMO", () => {
    expect(() =>
      armarDocumento({
        ...datosBase(RENGLONES),
        cuotas: [{ vence: "2026-10-01", monto: 100 }],
      })
    ).toThrow(/cuadrar al centavo/);
    expect(() =>
      armarDocumento({
        ...datosBase(RENGLONES),
        cuotas: [{ vence: "01/10/2026", monto: 264 }],
      })
    ).toThrow(/AAAA-MM-DD/);
  });

  it("no viaja NINGÚN campo vacío (regla del manual: se omite, no se manda)", () => {
    const json = JSON.stringify(documento);
    expect(json).not.toContain(":null");
    expect(json).not.toContain(':""');
    expect(json).not.toContain(":[]");
  });

  it("el emisor NO viaja en el JSON: lo determinan las credenciales", () => {
    const json = JSON.stringify(documento).toLowerCase();
    expect(json).not.toContain("erma");
    expect(json).not.toContain("emisorruc");
  });
});

describe("armarDocumento · el caso real EST0536", () => {
  const renglones: RenglonFactura[] = ITEMS_EST0536.map((it, i) => ({
    ...it,
    descripcion: `Renglón ${i + 1} del acto`,
    cpbsAbrev: "46",
    cpbs: "4617",
  }));
  const { documento, resumen } = armarDocumento(datosBase(renglones));
  const totales = documento.totalesSubTotales as Record<string, unknown>;

  it("reproduce los totales del caso golden (parcial 4100, ITBMS 287)", () => {
    expect(totales.totalPrecioNeto).toBe("4100.00");
    expect(totales.totalITBMS).toBe("287.00");
    expect(totales.totalFactura).toBe("4387.00");
    expect(resumen.retencionMonto).toBe(143.5);
    expect((totales.retencion as Record<string, unknown>).montoRetencion).toBe(
      "143.50"
    );
  });

  it("nroItems dice cuántos renglones van", () => {
    expect(totales.nroItems).toBe(String(ITEMS_EST0536.length));
  });
});

describe("armarDocumento · validaciones que salvan un rechazo", () => {
  it("rechaza el punto de facturación 000 o mal formado", () => {
    expect(() =>
      armarDocumento({ ...datosBase(RENGLONES), puntoFacturacion: "000" })
    ).toThrow(ErrorFacturaInvalida);
    expect(() =>
      armarDocumento({ ...datosBase(RENGLONES), puntoFacturacion: "2" })
    ).toThrow(ErrorFacturaInvalida);
  });

  it("rechaza un número fiscal fuera de 1..9999999999", () => {
    expect(() =>
      armarDocumento({ ...datosBase(RENGLONES), numeroDocumento: 0 })
    ).toThrow(ErrorFacturaInvalida);
    expect(() =>
      armarDocumento({ ...datosBase(RENGLONES), numeroDocumento: 10000000000 })
    ).toThrow(ErrorFacturaInvalida);
  });

  it("gobierno sin CPBS en un renglón: el rechazo típico, atajado aquí", () => {
    const sinCpbs = RENGLONES.map((r) => ({ ...r, cpbs: undefined }));
    expect(() => armarDocumento(datosBase(sinCpbs))).toThrow(/CPBS/);
  });

  it("gobierno sin DV o sin ubicación no sale del PMO", () => {
    expect(() =>
      armarDocumento({
        ...datosBase(RENGLONES),
        receptor: { ...MEDUCA, dv: "" },
      })
    ).toThrow(ErrorFacturaInvalida);
    expect(() =>
      armarDocumento({
        ...datosBase(RENGLONES),
        receptor: { ...MEDUCA, codigoUbicacion: "" },
      })
    ).toThrow(/ubicación/);
  });

  it("sin renglones no hay factura", () => {
    expect(() => armarDocumento(datosBase([]))).toThrow(/renglones/);
  });
});

describe("fechaEmisionPanama", () => {
  it("convierte un instante UTC al calendario de Panamá", () => {
    // 02:00Z del día 14 = 21:00 del día 13 en Panamá.
    expect(fechaEmisionPanama(new Date("2026-08-14T02:00:00Z"))).toBe(
      "2026-08-13T21:00:00-05:00"
    );
  });

  it("la medianoche no sale como hora 24", () => {
    expect(fechaEmisionPanama(new Date("2026-08-14T05:00:00Z"))).toBe(
      "2026-08-14T00:00:00-05:00"
    );
  });
});

describe("podar", () => {
  it("quita null, vacíos y listas vacías, a cualquier profundidad", () => {
    expect(
      podar({
        a: "x",
        b: "",
        c: null,
        d: undefined,
        e: [],
        f: { g: "", h: null },
        i: { j: "y" },
        k: [{ l: "" }, { m: "z" }],
      })
    ).toEqual({ a: "x", i: { j: "y" }, k: [{ m: "z" }] });
  });

  it("respeta el cero y el false (son valores, no vacíos)", () => {
    expect(podar({ a: 0, b: false })).toEqual({ a: 0, b: false });
  });
});
