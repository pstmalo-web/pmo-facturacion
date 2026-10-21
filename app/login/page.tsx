"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { Boton } from "@/components/ui/Boton";

// Login mínimo por correo y contraseña contra el Supabase LOCAL de este repo.
// Los usuarios de prueba están en supabase/seed.sql.
function FormularioLogin() {
  const router = useRouter();
  const destino = useSearchParams().get("destino") ?? "/facturacion";
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEntrando(true);
    setError(null);
    const { error } = await crearClienteNavegador().auth.signInWithPassword({
      email,
      password: clave,
    });
    setEntrando(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace(destino.startsWith("/") && !destino.startsWith("//") ? destino : "/facturacion");
    router.refresh();
  }

  return (
    <form
      onSubmit={entrar}
      className="w-full max-w-sm space-y-4 rounded-xl border border-fuerte bg-white p-6 shadow-sm"
    >
      <h1 className="text-lg font-semibold text-ink">PMO · Facturación</h1>
      <label className="block text-sm">
        <span className="mb-1 block text-muted">Correo</span>
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-fuerte bg-transparent px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-muted">Contraseña</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          className="w-full rounded-lg border border-fuerte bg-transparent px-3 py-2"
        />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Boton type="submit" disabled={entrando} className="w-full justify-center">
        {entrando ? "Entrando…" : "Entrar"}
      </Boton>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Suspense>
        <FormularioLogin />
      </Suspense>
    </main>
  );
}
