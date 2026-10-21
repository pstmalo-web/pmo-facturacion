import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config";

// Singleton: un solo cliente por pestaña. Evita instancias redundantes
// (páginas lo llaman inline en callbacks) y comparte el pool de realtime.
let cliente: SupabaseClient | undefined;

export function crearClienteNavegador(): SupabaseClient {
  return (cliente ??= createBrowserClient(SUPABASE_URL, SUPABASE_KEY, {
    // Habilita la API de passkeys (WebAuthn). Es experimental en supabase-js;
    // si los passkeys no están activados en el proyecto, los métodos fallan
    // con un error descriptivo en lugar de romper el login por contraseña.
    auth: { experimental: { passkey: true } },
  }));
}
