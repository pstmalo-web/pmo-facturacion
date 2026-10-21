import type { CSSProperties } from "react";

/** Chip de color del PMO: fondo y borde mezclados con el tono, texto legible. */
export function estiloChip(hex: string): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${hex} 40%, transparent)`,
    color: `color-mix(in srgb, ${hex} 40%, var(--color-ink))`,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hex} 60%, transparent)`,
  };
}
