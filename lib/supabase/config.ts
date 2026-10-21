// URL y publishable key del proyecto de Supabase. Ambas son públicas por
// diseño (viajan en el bundle del navegador); la seguridad la aporta RLS.
// En Vercel viven en las env vars del proyecto (la integración Supabase
// inyecta además SUPABASE_URL, POSTGRES_* y otras que la app no usa);
// en local salen de .env.local (`vercel env pull .env.local` las trae).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "En local: definirlas en .env.local; en Vercel: Settings → Environment Variables."
  );
}

export const SUPABASE_URL = url;
export const SUPABASE_KEY = key;
