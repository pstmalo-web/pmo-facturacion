import type { Metadata } from "next";

// La vista es un componente de cliente ("use client") y desde ahí Next no deja
// exportar `metadata`: sin este layout de servidor la pestaña del navegador
// mostraría el título genérico de la app estando en Facturación. Mismo molde
// que app/(app)/proyectos/layout.tsx, y por lo mismo NO envuelve nada: el
// contenedor centrado lo pone el layout del grupo (app).
export const metadata: Metadata = { title: "Facturación" };

export default function FacturacionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
