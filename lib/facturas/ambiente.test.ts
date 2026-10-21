// El ambiente de HKA decide DOS cosas irreversibles: contra qué servidor se
// emite y con qué marca queda la fila (085 — solo las demo se borran). Un
// valor mal escrito no puede resolverse en silencio hacia ninguno de los dos
// lados, así que la única salida válida es romper.
import { describe, expect, it, afterEach } from "vitest";
import { ambienteHka } from "./emitir-servidor";

const original = process.env.HKA_AMBIENTE;

afterEach(() => {
  if (original === undefined) delete process.env.HKA_AMBIENTE;
  else process.env.HKA_AMBIENTE = original;
});

describe("ambienteHka", () => {
  it("sin variable, el defecto es demo: el error cae del lado de las pruebas", () => {
    delete process.env.HKA_AMBIENTE;
    expect(ambienteHka()).toBe("demo");
  });

  it("reconoce los dos ambientes válidos", () => {
    process.env.HKA_AMBIENTE = "demo";
    expect(ambienteHka()).toBe("demo");
    process.env.HKA_AMBIENTE = "produccion";
    expect(ambienteHka()).toBe("produccion");
  });

  it("tolera los espacios del copy-paste", () => {
    process.env.HKA_AMBIENTE = "  produccion \n";
    expect(ambienteHka()).toBe("produccion");
  });

  it("rompe con un valor desconocido en vez de redondear a demo", () => {
    // "production" en inglés es el typo natural, y redondearlo a demo
    // marcaría como ensayo borrable una fila emitida vaya a saber dónde.
    process.env.HKA_AMBIENTE = "production";
    expect(() => ambienteHka()).toThrow(/demo/);
    process.env.HKA_AMBIENTE = "";
    expect(() => ambienteHka()).toThrow();
  });
});
