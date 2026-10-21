// Chequeo de rol del lado del servidor, para rutas API que no deben
// depender solo de lo que la UI muestra u oculta.
import type { SupabaseClient } from "@supabase/supabase-js";

/** true si el usuario de la sesión tiene rol admin en la tabla perfiles. */
export async function esAdminServidor(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("perfiles")
    .select("rol")
    .eq("id", userId)
    .single();
  return data?.rol === "admin";
}

/** true si es admin o pm — espejo TS de `es_gestor()` (017). */
export async function esGestorServidor(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("perfiles")
    .select("rol")
    .eq("id", userId)
    .single();
  return data?.rol === "admin" || data?.rol === "pm";
}
