"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { esRolSoloLectura, type Perfil } from "@/lib/perfil";

interface ContextoPerfil {
  perfil: Perfil | null;
  cargando: boolean;
  esAdmin: boolean;
  /** Admin o PM: gestiona proyectos, borra cotizaciones, importa Excels. */
  esGestor: boolean;
  /** Rol auditor específicamente (hoy sin tratos propios en la UI). */
  esAuditor: boolean;
  /** Co-Founder: solo lectura + bienvenida de gerencia en el Dashboard. */
  esCofounder: boolean;
  /** Auditor O Co-Founder: ven absolutamente todo, no interactúan con nada.
   *  Es el gate que la UI usa para esconder controles de escritura. */
  soloLectura: boolean;
  /**
   * Mensaje si la carga del perfil falló. Mientras esté puesto, `esAdmin` y
   * `esGestor` son "no sabemos", no "no tiene permiso": quien decida esconder
   * algo por rol debería mirarlo antes de dar el false por bueno.
   */
  error: string | null;
  recargar: () => Promise<void>;
}

const Contexto = createContext<ContextoPerfil>({
  perfil: null,
  cargando: true,
  esAdmin: false,
  esGestor: false,
  esAuditor: false,
  esCofounder: false,
  soloLectura: false,
  error: null,
  recargar: async () => {},
});

/** Perfil del usuario autenticado, cargado una sola vez para toda la app. */
export function PerfilProvider({ children }: { children: React.ReactNode }) {
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reintentando, setReintentando] = useState(false);

  const recargar = useCallback(async () => {
    const supabase = crearClienteNavegador();
    const {
      data: { user },
      error: errorSesion,
    } = await supabase.auth.getUser();
    // No tener sesión NO es un fallo (getUser responde AuthSessionMissingError).
    // Los demás errores (red caída, 500) sí significan "no sabemos quién eres".
    if (errorSesion && errorSesion.name !== "AuthSessionMissingError") {
      setError("No pudimos verificar tu sesión");
      setCargando(false);
      return;
    }
    if (!user) {
      setPerfil(null);
      setError(null);
      setCargando(false);
      return;
    }
    const { data, error: errorPerfil } = await supabase
      .from("perfiles")
      .select("*")
      .eq("id", user.id)
      .single();
    // Sin fila de perfil no hay rol, y sin rol esGestor cae a false: la app
    // escondería los botones como si al usuario le hubieran quitado permisos.
    // Se conserva el perfil anterior (un
    // recargar() fallido no debe degradar al que ya funcionaba) y se avisa.
    if (errorPerfil) {
      setError("No pudimos cargar tus permisos");
      setCargando(false);
      return;
    }
    setPerfil((data as Perfil) ?? null);
    setError(null);
    setCargando(false);
  }, []);

  // `cargando` a propósito no se toca aquí: el reintento no debe devolver toda
  // la app a su estado de carga, así que el botón lleva su propio indicador.
  async function reintentar() {
    setReintentando(true);
    await recargar();
    setReintentando(false);
  }

  useEffect(() => {
    recargar();
  }, [recargar]);

  return (
    <Contexto.Provider
      value={{
        perfil,
        cargando,
        esAdmin: perfil?.rol === "admin",
        esGestor: perfil?.rol === "admin" || perfil?.rol === "pm",
        esAuditor: perfil?.rol === "auditor",
        esCofounder: perfil?.rol === "cofounder",
        soloLectura: !!perfil && esRolSoloLectura(perfil.rol),
        error,
        recargar,
      }}
    >
      {/* Franja y no modal: un fallo del perfil solo afecta a qué botones se
          ven, no debe bloquear la app. */}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
        >
          <span>
            {error}. Puede que la app te esté escondiendo opciones que sí tienes.
          </span>
          <button
            type="button"
            onClick={reintentar}
            disabled={reintentando}
            className="rounded border border-amber-400 px-2 py-0.5 text-xs font-semibold hover:bg-amber-100 disabled:opacity-60 dark:border-amber-700 dark:hover:bg-amber-900"
          >
            {reintentando ? "Reintentando…" : "Reintentar"}
          </button>
        </div>
      )}
      {children}
    </Contexto.Provider>
  );
}

export function usePerfil(): ContextoPerfil {
  return useContext(Contexto);
}
