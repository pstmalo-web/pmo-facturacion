// Cuerpo del POST /api/facturas. La validación fiscal profunda (CPBS
// obligatorio con gobierno, DV, ubicación, coherencia aritmética) vive en
// `armarDocumento` (lib/hka/documento.ts); aquí solo se valida la FORMA del
// cuerpo para que la ruta no arme nada con basura.
import { z } from "zod";

export const esquemaRenglonFactura = z.object({
  descripcion: z.string().trim().min(2).max(500),
  cantidad: z.number().positive(),
  precio_unitario: z.number().min(0),
  itbms_exento: z.boolean(),
  /** Familia CPBS de 4 dígitos (el segmento son sus 2 primeros). */
  cpbs: z.string().regex(/^\d{4}$/, "El CPBS es la familia de 4 dígitos."),
  unidad_medida: z.string().trim().min(1).max(20).default("und"),
  renglon_numero: z.number().int().nullable().optional(),
});

export const esquemaEmitirFactura = z.object({
  /**
   * NULLABLE desde la factura LIBRE (F2 del módulo, decisión de Paul del
   * 2026-08-18): no todo lo que se cobra pasó por el board. La columna ya
   * nacía nullable en la 083; lo que exigía un proyecto era este esquema.
   *
   * Se relaja SOLO esto: los renglones, la entidad y la ubicación se validan
   * exactamente igual, porque a la DGI le da lo mismo de dónde salió la
   * factura. Sin proyecto no hay expediente donde archivar el CAFE, y de eso
   * ya se encarga `registrarEnExpediente` (se salta cuando no hay proyecto).
   */
  proyecto_id: z.string().uuid().nullable().default(null),
  cotizacion_id: z.string().uuid().nullable().optional(),
  entidad_id: z.string().uuid(),
  /** Datos del receptor que se guardan de vuelta en la entidad fiscal. */
  entidad: z.object({
    direccion: z.string().trim().min(5).max(100),
    codigo_ubicacion: z
      .string()
      .regex(/^\d+-\d+-\d+$/, "La ubicación es el código provincia-distrito-corregimiento."),
    provincia: z.string().trim().min(1),
    distrito: z.string().trim().min(1),
    corregimiento: z.string().trim().min(1),
    correo: z.string().trim().email().optional().or(z.literal("")),
  }),
  items: z.array(esquemaRenglonFactura).min(1, "La factura necesita al menos un renglón."),
  correos: z.array(z.string().trim().email()).max(5).default([]),
  retener: z.boolean().default(true),
  forma_pago: z.enum(["01", "02", "08", "09"]).default("01"),
  /** Términos de pago: cuotas que deben sumar el total (el armador lo valida). */
  cuotas: z
    .array(
      z.object({
        vence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La cuota necesita fecha AAAA-MM-DD."),
        monto: z.number().positive(),
      })
    )
    .min(1)
    .max(12)
    .optional(),
  dias_credito: z.number().int().min(0).max(180).default(30),
  orden_compra: z.string().trim().max(50).nullable().optional(),
});

export type EmitirFacturaEntrada = z.infer<typeof esquemaEmitirFactura>;
