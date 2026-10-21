"use client";

// Sistema de toasts con acción opcional ("Deshacer"). Reemplaza los alert().
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

export type Toast = {
  id: number;
  mensaje: string;
  tipo: "ok" | "error";
  accion?: { etiqueta: string; onClick: () => void };
  duracionMs?: number;
};

type ToastCtx = {
  /** Muestra un toast y devuelve una función para cerrarlo antes de tiempo. */
  mostrar: (t: Omit<Toast, "id">) => () => void;
  error: (mensaje: string) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast requiere <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const siguiente = useRef(1);

  const cerrar = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const mostrar = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = siguiente.current++;
      setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
      const ms = t.duracionMs ?? (t.accion ? 8000 : 5000);
      const timer = setTimeout(() => cerrar(id), ms);
      return () => {
        clearTimeout(timer);
        cerrar(id);
      };
    },
    [cerrar]
  );

  const error = useCallback((mensaje: string) => void mostrar({ mensaje, tipo: "error" }), [mostrar]);

  return (
    <Ctx.Provider value={{ mostrar, error }}>
      {children}
      {/* En móvil suben a bottom-24 para no tapar la BarraLote. */}
      <div className="pointer-events-none fixed bottom-24 left-4 z-[70] flex w-[min(92vw,24rem)] flex-col gap-2 sm:bottom-4" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex animate-[subir_200ms_ease-out] items-center gap-3 rounded-xl border border-ink/10 bg-chrome px-4 py-3 text-sm text-white shadow-lg"
          >
            {/* red-400/green-400 son literales y NO siguen el flip de tema,
                pero aquí es correcto: el toast va sobre `bg-chrome`, que es
                superficie OSCURA en los dos modos (globals.css la fija en
                #0e0e0c bajo .dark). Un `dark:` aquí los estropearía. */}
            {t.tipo === "error" ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" aria-hidden />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-400" aria-hidden />
            )}
            <span className="min-w-0 flex-1">{t.mensaje}</span>
            {t.accion && (
              <button
                onClick={() => {
                  t.accion!.onClick();
                  cerrar(t.id);
                }}
                className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-semibold hover:bg-white/25"
              >
                {t.accion.etiqueta}
              </button>
            )}
            {/* La atenuación va por `opacity`, NO por `text-white/60
                hover:text-white`: los overrides de globals.css apuntan a la
                clase BASE, así que `hover:text-white` no los hereda y resolvía
                contra el white FLIPADO (#252523) — la X desaparecía sobre el
                toast justo al pasarle el ratón, que es cuando hace falta.
                Con el color en la clase plana y la opacidad en la variante,
                funciona igual en los dos modos. */}
            <button
              onClick={() => cerrar(t.id)}
              className="flex h-9 w-9 shrink-0 items-center justify-center text-white opacity-60 transition-opacity hover:opacity-100"
              aria-label="Cerrar aviso"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
