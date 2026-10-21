"use client";

// Botón de copiar al portapapeles: un click copia y confirma en el sitio.
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Tooltip } from "./Tooltip";

export function BotonCopiar({
  texto,
  etiqueta = "Copiar",
  className = "",
  tam = "h-3.5 w-3.5",
  compacto = false,
}: {
  texto: string;
  /** Qué se copia, para el tooltip y el lector de pantalla ("Copiar número de acto"). */
  etiqueta?: string;
  className?: string;
  tam?: string;
  /** 24 px en vez de 32: para la línea del acto en una fila de tabla, donde
   *  el botón de 32 sobre un texto de 16 ponía el suelo de la fila. Se opera
   *  con ratón (la tabla solo se monta desde 640 px). */
  compacto?: boolean;
}) {
  const [copiado, setCopiado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function copiar() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto);
      } else {
        // Respaldo para contextos sin Clipboard API (http, navegadores viejos).
        const ta = document.createElement("textarea");
        ta.value = texto;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiado(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Si el navegador bloquea el portapapeles, dejamos el número seleccionable.
    }
  }

  return (
    <Tooltip texto={copiado ? "¡Copiado!" : etiqueta}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          void copiar();
        }}
        aria-label={copiado ? "Copiado" : etiqueta}
        // green-600 es literal (no sigue el flip): sobre la superficie oscura
        // se apaga, y el destello verde ES la confirmación de que copió.
        // El reposo va a /60 como los demás botones-icono (EnlacePanamaCompra):
        // a /50 el icono se perdía sobre la fila.
        className={`flex ${compacto ? "min-h-6 min-w-6" : "min-h-8 min-w-8"} items-center justify-center rounded-lg transition-colors ${
          copiado ? "text-green-600 dark:text-green-400" : "text-ink/60 hover:bg-ink/10 hover:text-ink"
        } focus-visible:ring-2 focus-visible:ring-clay/50 focus-visible:outline-none ${className}`}
      >
        {copiado ? <Check className={tam} aria-hidden /> : <Copy className={tam} aria-hidden />}
      </button>
    </Tooltip>
  );
}
