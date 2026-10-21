import { describe, expect, it } from "vitest";
import {
  buscarUbicacion,
  FAMILIAS_CPBS,
  familiaCpbs,
  SEGMENTOS_CPBS,
  ubicacionesDgi,
} from "@/lib/hka/catalogos";

describe("catálogo de ubicaciones DGI", () => {
  it("trae los 647 corregimientos reales, sin las filas INVALIDO", () => {
    const reales = ubicacionesDgi();
    expect(reales).toHaveLength(647);
    expect(reales.some((u) => u.corregimiento === "INVALIDO")).toBe(false);
  });

  it("resuelve el código del ejemplo oficial (8-8-14 = ANCON)", () => {
    // El catálogo escribe "PANAMA" sin tilde — se cita textual, no se corrige.
    expect(buscarUbicacion("8-8-14")).toEqual({
      codigo: "8-8-14",
      provincia: "PANAMA",
      distrito: "PANAMA",
      corregimiento: "ANCON",
    });
  });

  it("un código de nivel INVALIDO o inexistente devuelve null", () => {
    expect(buscarUbicacion("8-8-0")).toBeNull();
    expect(buscarUbicacion("99-99-99")).toBeNull();
  });
});

describe("catálogo CPBS", () => {
  it("trae los 56 segmentos y las 421 familias del anexo", () => {
    expect(SEGMENTOS_CPBS).toHaveLength(56);
    expect(FAMILIAS_CPBS).toHaveLength(421);
  });

  it("cada familia cuelga de un segmento existente", () => {
    const segmentos = new Set(SEGMENTOS_CPBS.map((s) => s.codigo));
    for (const familia of FAMILIAS_CPBS) {
      expect(segmentos.has(familia.segmento)).toBe(true);
      expect(familia.codigo.startsWith(familia.segmento)).toBe(true);
    }
  });

  it("resuelve la familia del ejemplo oficial de gobierno (7210)", () => {
    const familia = familiaCpbs("7210");
    expect(familia?.segmento).toBe("72");
    expect(familiaCpbs("0000")).toBeNull();
  });
});
