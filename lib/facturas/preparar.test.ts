import { describe, expect, it } from "vitest";
import {
  correoDelActo,
  detalleArticulo,
  direccionDelActo,
  emparejarEntidad,
  filtrarEntidades,
  normalizarNombre,
  renglonVacio,
  renglonesDesdeCotizacion,
  veredictoDv,
} from "@/lib/facturas/preparar";
import type { EntidadFiscal } from "@/lib/facturas/tipos";

const ENTIDADES: EntidadFiscal[] = [
  {
    id: "e1",
    nombre: "MEDUCA",
    siglas: "MEDUCA",
    tipo_ruc: "2",
    ruc: "8-NT-1-13656",
    dv: "43",
    razon_social: "MINISTERIO DE EDUCACION",
    direccion: "",
    codigo_ubicacion: null,
    provincia: null,
    distrito: null,
    corregimiento: null,
    correo: null,
    telefono: null,
    verificado_en: null,
    afiliado_fe: null,
    notas: "",
  },
  {
    id: "e2",
    nombre: "CSS",
    siglas: "CSS",
    tipo_ruc: "2",
    ruc: "8-NT-1-12542",
    dv: "21",
    razon_social: "CAJA DE SEGURO SOCIAL",
    direccion: "",
    codigo_ubicacion: null,
    provincia: null,
    distrito: null,
    corregimiento: null,
    correo: null,
    telefono: null,
    verificado_en: null,
    afiliado_fe: null,
    notas: "",
  },
];

const ALIAS = [
  { entidad_id: "e1", alias: "MINISTERIO DE EDUCACION" },
  { entidad_id: "e2", alias: "CSS SECCION DE INGRESOS" },
];

describe("normalizarNombre", () => {
  it("iguala mayúsculas, tildes y espacios repetidos", () => {
    expect(normalizarNombre("  Ministerio   de Educación ")).toBe(
      "MINISTERIO DE EDUCACION"
    );
  });

  it("quita el U+2060 invisible que ya se coló una vez en producción", () => {
    expect(normalizarNombre("MEDUCA⁠")).toBe("MEDUCA");
  });
});

describe("emparejarEntidad", () => {
  it("encuentra por alias curado, no por parecido", () => {
    expect(emparejarEntidad("ministerio de educación", ENTIDADES, ALIAS)?.id).toBe("e1");
    expect(emparejarEntidad("CSS SECCION DE INGRESOS", ENTIDADES, ALIAS)?.id).toBe("e2");
  });

  it("cae al nombre/siglas exactos cuando no hay alias", () => {
    expect(emparejarEntidad("Meduca", ENTIDADES, [])?.id).toBe("e1");
  });

  it("sin coincidencia EXACTA devuelve null — deducir es facturar mal", () => {
    expect(emparejarEntidad("MINISTERIO DE EDUC.", ENTIDADES, ALIAS)).toBeNull();
    expect(emparejarEntidad(null, ENTIDADES, ALIAS)).toBeNull();
  });
});

describe("filtrarEntidades", () => {
  it("busca por nombre, razón social o RUC", () => {
    expect(filtrarEntidades("seguro", ENTIDADES)).toHaveLength(1);
    expect(filtrarEntidades("13656", ENTIDADES)[0]?.id).toBe("e1");
    expect(filtrarEntidades("", ENTIDADES)).toHaveLength(2);
  });
});

describe("detalleArticulo", () => {
  it("aplana la plantilla de la cotización en una línea", () => {
    expect(
      detalleArticulo("Marca: Starlink\nCasa Productora: SpaceX\nPaís de Origen: Estados Unidos")
    ).toBe("Marca: Starlink · Casa Productora: SpaceX · País de Origen: Estados Unidos");
  });

  it("descarta las líneas de la plantilla que quedaron sin llenar", () => {
    expect(detalleArticulo("Marca: Dell\nCasa Productora: \nPaís de Origen:")).toBe("Marca: Dell");
    expect(detalleArticulo("Marca: \nCasa Productora: \nPaís de Origen: ")).toBe("");
    expect(detalleArticulo(null)).toBe("");
  });
});

describe("renglonesDesdeCotizacion", () => {
  it("la descripción es el nombre + marca/casa/país de la cotización", () => {
    const r = renglonesDesdeCotizacion([
      {
        nombre: "Cámara IP",
        descripcion: "Marca: Hikvision\nCasa Productora: Hikvision\nPaís de Origen: China",
        precio_unitario: 100,
        cantidad: 2,
        itbms_exento: false,
        renglon_numero: 3,
      },
    ]);
    expect(r).toEqual([
      {
        incluir: true,
        descripcion:
          "Cámara IP — Marca: Hikvision · Casa Productora: Hikvision · País de Origen: China",
        cantidad: 2,
        precio_unitario: 100,
        itbms_exento: false,
        cpbs: "",
        unidad_medida: "und",
        renglon_numero: 3,
      },
    ]);
  });

  it("sin detalle queda el nombre solo, y un nombre corto cae al detalle", () => {
    const r = renglonesDesdeCotizacion([
      {
        nombre: "Cámara IP",
        descripcion: "Marca: \nCasa Productora: \nPaís de Origen: ",
        precio_unitario: 100,
        cantidad: 1,
        itbms_exento: false,
        renglon_numero: null,
      },
      {
        nombre: "X",
        descripcion: "Servicio de instalación",
        precio_unitario: 10,
        cantidad: 1,
        itbms_exento: false,
        renglon_numero: null,
      },
    ]);
    expect(r[0].descripcion).toBe("Cámara IP");
    expect(r[1].descripcion).toBe("Servicio de instalación");
  });

  it("recorta a los 500 caracteres que admite HKA", () => {
    const r = renglonesDesdeCotizacion([
      {
        nombre: "Renglón con especificación kilométrica",
        descripcion: "Marca: " + "x".repeat(600),
        precio_unitario: 1,
        cantidad: 1,
        itbms_exento: false,
        renglon_numero: null,
      },
    ]);
    expect(r[0].descripcion).toHaveLength(500);
  });
});

describe("direccionDelActo", () => {
  it("prefiere el snapshot de la cotización y cae a la del pliego", () => {
    expect(
      direccionDelActo({
        cliente_direccion: "Cárdenas, Ciudad de Panamá",
        datos_pliego: { entidad: { direccion: "Otra" } },
      })
    ).toBe("Cárdenas, Ciudad de Panamá");
    expect(
      direccionDelActo({
        cliente_direccion: "  ",
        datos_pliego: { entidad: { direccion: "Vía España, edificio 24" } },
      })
    ).toBe("Vía España, edificio 24");
    expect(direccionDelActo({})).toBeNull();
  });

  it("recorta a los 100 caracteres que admite HKA", () => {
    expect(direccionDelActo({ cliente_direccion: "x".repeat(150) })).toHaveLength(100);
  });
});

describe("correoDelActo", () => {
  it("prefiere el correo del snapshot y cae al del pliego", () => {
    expect(
      correoDelActo({ cliente_contacto_email: "compras@meduca.gob.pa" })
    ).toBe("compras@meduca.gob.pa");
    expect(
      correoDelActo({
        cliente_contacto_email: " ",
        datos_pliego: { contacto: { correo: "acto@css.gob.pa" } },
      })
    ).toBe("acto@css.gob.pa");
    expect(correoDelActo({})).toBeNull();
  });
});

/**
 * El arbitraje del DV lo consultan DOS rutas (la verificación masiva del
 * directorio y el alta de una entidad desde la pestaña), así que el criterio
 * se fija aquí una sola vez. Lo que se prueba no es aritmética: es que un
 * veredicto NUNCA sea "coincide" por accidente, porque de ese sí sale una
 * factura rechazada por la DGI.
 */
describe("veredictoDv", () => {
  it("el relleno a dos dígitos no es una discrepancia", () => {
    // La fuente escribe "5" donde la DGI escribe "05": mismo dígito.
    expect(veredictoDv("5", "05")).toBe("coincide");
    expect(veredictoDv("05", "5")).toBe("coincide");
    expect(veredictoDv("43", "43")).toBe("coincide");
  });

  it("05 y 50 NO son lo mismo — es el caso del Tribunal Electoral", () => {
    expect(veredictoDv("05", "50")).toBe("dv_distinto");
  });

  it("sin respuesta de la DGI no se da nada por bueno", () => {
    expect(veredictoDv("43", null)).toBe("sin_respuesta");
    expect(veredictoDv("43", "   ")).toBe("sin_respuesta");
  });

  it("sin DV nuestro, la DGI no confirma nada: hay que teclearlo", () => {
    // "dv_distinto" y no "coincide": el alta con el campo en blanco tiene que
    // obligar a una decisión humana, no adoptar en silencio lo que llegó.
    expect(veredictoDv(null, "43")).toBe("dv_distinto");
    expect(veredictoDv("", "43")).toBe("dv_distinto");
  });

  it("no devuelve DV, solo veredicto", () => {
    // Blindaje de la regla de la casa: si algún día esto empezara a devolver
    // el DV "bueno", corregir solo estaría a un renglón de distancia.
    expect(typeof veredictoDv("1", "2")).toBe("string");
  });
});

describe("renglonVacio", () => {
  it("nace incluido, con unidad und y SIN CPBS", () => {
    const r = renglonVacio();
    expect(r.incluir).toBe(true);
    expect(r.unidad_medida).toBe("und");
    expect(r.cantidad).toBe(1);
    // El CPBS vacío es la decisión: adivinar la familia del bien es la causa
    // nº 1 de rechazo con receptor gobierno.
    expect(r.cpbs).toBe("");
    expect(r.renglon_numero).toBeNull();
  });

  it("cada llamada devuelve un renglón NUEVO", () => {
    // Compartir el objeto haría que editar un renglón editara todos.
    const a = renglonVacio();
    const b = renglonVacio();
    a.descripcion = "Servicio de capacitación";
    expect(b.descripcion).toBe("");
  });
});
