"use client";

// Datos de facturas de UN proyecto, para el popup del board. Deliberadamente
// más simple que useProyectosData: la lista es corta (0–3 facturas por
// proyecto), se carga al abrir el popup y se refresca tras cada acción — sin
// realtime ni escrituras optimistas, porque aquí cada escritura pasa por el
// API de emisión y la verdad la tiene el servidor.
import { useCallback, useEffect, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/client";
import type { Factura } from "@/lib/facturas/tipos";

export function useFacturasProyecto(proyectoId: string) {
  const [facturas, setFacturas] = useState<Factura[] | null>(null);
  const supabase = crearClienteNavegador();

  const refrescar = useCallback(async () => {
    const { data, error } = await supabase
      .from("facturas")
      .select("*")
      .eq("proyecto_id", proyectoId)
      .order("created_at", { ascending: false });
    if (!error) setFacturas((data as Factura[]) ?? []);
  }, [supabase, proyectoId]);

  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  return { facturas, refrescar };
}

/**
 * TODAS las facturas, para la pestaña `/facturacion`. Trae de una sola
 * consulta el nombre de la entidad receptora y el del proyecto: la tabla los
 * enseña en cada fila y pedirlos aparte convertiría el listado en N+1
 * consultas para una lista que cabe en una pantalla.
 *
 * Mismo espíritu que `useFacturasProyecto`: sin realtime ni escrituras
 * optimistas —cada escritura pasa por el API de emisión y la verdad la tiene
 * el servidor—, solo que aquí `cargando` sí se distingue de "cargó vacío",
 * porque una pestaña entera en blanco necesita decir cuál de las dos es.
 *
 * Quién ve qué NO se decide aquí: lo hace la RLS de la 083 (`equipo lee
 * facturas`), que ya deja mirar a auditor y cofounder. Este hook no filtra
 * por rol y no debe hacerlo: sería una tercera copia de la regla.
 */
export interface FacturaListada extends Factura {
  entidad: { nombre: string; siglas: string | null } | null;
  proyecto: { nombre: string; numero_acto: string | null } | null;
}

export function useFacturasTodas(activo = true) {
  const [facturas, setFacturas] = useState<FacturaListada[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supabase = crearClienteNavegador();

  const refrescar = useCallback(async () => {
    // `activo` en false = la guarda de la página ya decidió expulsar a quien
    // mira. No es seguridad (de eso vive la RLS): es no disparar una consulta
    // cuyo resultado se va a tirar mientras el router redirige.
    if (!activo) return;
    const { data, error } = await supabase
      .from("facturas")
      .select(
        "*, entidad:entidades_fiscales(nombre, siglas), proyecto:proyectos(nombre, numero_acto)"
      )
      .order("created_at", { ascending: false });
    if (error) {
      // Se conserva lo ya cargado: un fallo de red no debe vaciar la tabla que
      // el usuario está mirando.
      setError(error.message);
      return;
    }
    setError(null);
    setFacturas((data as unknown as FacturaListada[]) ?? []);
  }, [supabase, activo]);

  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  return {
    facturas,
    error,
    cargando: activo && facturas === null && !error,
    refrescar,
  };
}

/**
 * Signed URL (15 min) de un archivo del bucket privado `facturas`, con el
 * nombre de descarga correcto. Se usa con `descargarComo` (lib/descargas.ts),
 * nunca con un <a download> directo (el nombre llega percent-encoded).
 */
export async function urlArchivoFactura(
  path: string,
  nombreDescarga: string
): Promise<string | null> {
  const supabase = crearClienteNavegador();
  const { data, error } = await supabase.storage
    .from("facturas")
    .createSignedUrl(path, 15 * 60, { download: nombreDescarga });
  return error ? null : data.signedUrl;
}
