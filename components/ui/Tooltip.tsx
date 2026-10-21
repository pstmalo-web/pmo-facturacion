"use client";

// Tooltip propio: aparición rápida, estilizado (reemplaza title= nativo).
export function Tooltip({
  texto,
  children,
  lado = "arriba",
  className = "",
}: {
  texto: string;
  children: React.ReactNode;
  lado?: "arriba" | "abajo";
  className?: string;
}) {
  return (
    <span className={`group/tip relative inline-flex ${className}`}>
      {children}
      {/* OCULTO CON `hidden`, NO CON `opacity-0`, y no es cosmética: en
          `opacity-0` el globo se sigue maquetando, y como va centrado en el
          disparador (`left-1/2 -translate-x-1/2`) y sin cortes de línea
          (`whitespace-nowrap`), uno largo se sale por el borde y AGRANDA EL
          ÁREA DE SCROLL DE LA PÁGINA. Medido en el editor a 375px: 118px de
          scroll horizontal sin nada visible que lo explicara, con el globo
          «Ver 2026-0-30-01-08-CL-005352 en PanamaCompra» llegando a x=479.
          Ni `invisible` sirve: `visibility:hidden` también ocupa área.
          Se pierde el fundido de 150ms —`display` no se puede transicionar—,
          que es justo lo que este componente prometía en su cabecera:
          aparición rápida. */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-1/2 z-50 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-chrome px-2 py-1 text-[11px] font-medium text-white shadow-lg group-hover/tip:block group-focus-within/tip:block ${
          lado === "arriba" ? "bottom-full mb-1.5" : "top-full mt-1.5"
        }`}
      >
        {texto}
      </span>
    </span>
  );
}
