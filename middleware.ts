import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_KEY } from "@/lib/supabase/config";

// En el PMO este middleware manda al login a quien no tiene sesión. En este
// repo NO hay login: la sesión se abre sola con el usuario de prueba de
// .env.local (`FACTURACION_USUARIO_DEV`), porque las rutas del módulo sí
// necesitan un usuario real para RLS y para `esGestorServidor`.
// Cambiar ese usuario en .env.local (admin ↔ auditor) cambia la sesión en el
// siguiente request. Solo en desarrollo: este repo no se despliega.
export async function middleware(request: NextRequest) {
  let respuesta = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          respuesta = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            respuesta.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = process.env.FACTURACION_USUARIO_DEV;
  const clave = process.env.FACTURACION_CLAVE_DEV;
  const enDesarrollo = process.env.NODE_ENV !== "production";

  if (enDesarrollo && email && clave && user?.email !== email) {
    // signInWithPassword escribe las cookies por setAll: las del request
    // (para que la página o la API de ESTE mismo request ya vean la sesión)
    // y las de la respuesta (para los siguientes).
    const { error } = await supabase.auth.signInWithPassword({ email, password: clave });
    if (error) {
      return new NextResponse(
        `No se pudo abrir la sesión de prueba con ${email}: ${error.message}. ` +
          "¿Está corriendo `npx supabase start` y coincide .env.local con supabase/seed.sql?",
        { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }
  }

  return respuesta;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|site.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
