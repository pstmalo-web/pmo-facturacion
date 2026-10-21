"use client";

import { PerfilProvider, usePerfil } from "@/components/PerfilProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { nombreCompleto } from "@/lib/perfil";

// En el PMO aquí van el menú de pestañas, el chat del equipo y la jornada.
// Este repo solo tiene Facturación, así que la cabecera es una franja mínima:
// no la conviertas en un menú, el módulo vuelve al PMO sin ella.
// No hay «Salir»: la sesión la abre sola el middleware con el usuario de
// .env.local, y cambiar de rol es cambiar ese usuario.
function Cabecera() {
  const { perfil } = usePerfil();

  return (
    <header className="sticky top-0 z-40 bg-chrome text-white">
      <div className="mx-auto flex h-12 w-full max-w-[1800px] items-center justify-between px-4 lg:px-6 xl:px-8">
        <span className="text-sm font-semibold tracking-wide">PMO · Facturación</span>
        {perfil && (
          <span className="text-xs opacity-80">
            {nombreCompleto(perfil)} · {perfil.rol}
          </span>
        )}
      </div>
    </header>
  );
}

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <PerfilProvider>
      <div className="min-h-screen">
        <Cabecera />
        <ToastProvider>
          <main
            id="contenido"
            tabIndex={-1}
            className="mx-auto w-full max-w-[1800px] px-4 py-6 lg:px-6 xl:px-8"
          >
            {children}
          </main>
        </ToastProvider>
      </div>
    </PerfilProvider>
  );
}
