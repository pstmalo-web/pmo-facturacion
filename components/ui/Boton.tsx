"use client";

// Botón compartido. Nace de un recuento: ~17 botones primarios con ~13 firmas
// distintas y el secundario copiado literal en los cuatro modales. Aquí se
// congela la firma ganadora (la de Foro / Detalle de proyecto / Detalle de
// tarea, 5 usos) para no seguir inventando una por sitio.
import type { ComponentProps } from "react";

type Variante = "primario" | "secundario" | "fantasma" | "peligro";
type Tamano = "sm" | "md";

// Geometría común. `min-h` en cada tamaño porque el padding solo no llega al
// objetivo táctil, y `disabled:cursor-not-allowed` para que el cursor avise
// antes del clic.
// El anillo de foco va aquí y es SIEMPRE `ring-clay/50`, incluso en el botón
// destructivo: `outline-none` mata el contorno nativo, y globals.css solo
// remapea esa clase (--foco + 2px de separación). Otro anillo se quedaría con
// el color crudo, pegado al botón y casi invisible sobre la tarjeta — que es
// justo el fallo que ese remapeo vino a arreglar.
const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-clay/50 disabled:cursor-not-allowed disabled:opacity-40";

const TAMANOS: Record<Tamano, string> = {
  sm: "min-h-8 px-3 py-1.5 text-[13px]",
  md: "min-h-9 px-4 py-1.5 text-sm",
};

const VARIANTES: Record<Variante, string> = {
  // Paleta 2026: primario vino con hover vino-dark (los dos son roles de
  // erma-tokens.css y se invierten solos en oscuro), secundario con el borde
  // fuerte sobre transparente, destructivo en vino-dark — brief §3.1.7.
  primario: "bg-clay font-semibold text-white hover:bg-clay-dark",
  secundario: "border border-fuerte font-medium text-ink/70 hover:bg-ink/5",
  fantasma: "font-medium text-ink/70 hover:bg-ink/5",
  peligro: "bg-clay-dark font-semibold text-white hover:opacity-90",
};

// `ComponentProps<"button">` y no `ButtonHTMLAttributes`: así entran también
// `ref` (en React 19 es una prop normal) y `children` sin declararlos aparte,
// y el resto —type, disabled, onClick, aria-*— se propaga tal cual.
export function Boton({
  variante = "primario",
  tamano = "md",
  className = "",
  type = "button",
  children,
  ...props
}: ComponentProps<"button"> & {
  variante?: Variante;
  tamano?: Tamano;
}) {
  // `type="button"` por defecto: casi todos viven dentro de formularios o
  // modales donde el submit implícito del navegador sobra. Se puede pisar.
  return (
    <button type={type} className={`${BASE} ${TAMANOS[tamano]} ${VARIANTES[variante]} ${className}`} {...props}>
      {children}
    </button>
  );
}
