"use client";

import { useRouter } from "next/navigation";
import { PerfilProvider, usePerfil } from "@/components/PerfilProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { nombreCompleto } from "@/lib/perfil";

// En el PMO aquí van el menú de pestañas, el chat del equipo y la jornada.
// Este repo solo tiene Facturación, así que la cabecera es una franja mínima:
// no la conviertas en un menú, el módulo vuelve al PMO sin ella.
function Cabecera() {
  const { perfil } = usePerfil();
  const router = useRouter();

  async function salir() {
    await crearClienteNavegador().auth.signOut();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-40 bg-chrome text-white">
      <div className="mx-auto flex h-12 w-full max-w-[1800px] items-center justify-between px-4 lg:px-6 xl:px-8">
        <span className="text-sm font-semibold tracking-wide">PMO · Facturación</span>
        <div className="flex items-center gap-3 text-xs">
          {perfil && (
            <span className="opacity-80">
              {nombreCompleto(perfil)} · {perfil.rol}
            </span>
          )}
          <button
            type="button"
            onClick={salir}
            className="rounded border border-white/30 px-2 py-1 hover:bg-white/10"
          >
            Salir
          </button>
        </div>
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
