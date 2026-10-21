import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_KEY } from "@/lib/supabase/config";

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

  const esLogin = request.nextUrl.pathname.startsWith("/login");


  if (!user && !esLogin) {
    // A dónde iba: sin esto, entrar por un enlace a una cotización concreta
    // terminaba siempre en el Dashboard. Solo rutas internas (una URL
    // absoluta o "//host" aquí sería una redirección abierta).
    const destino = request.nextUrl.pathname + request.nextUrl.search;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // clone() conserva la query de la ruta original, que ya viaja dentro de
    // `destino`: sin limpiarla, /cotizaciones?estado=x redirigía a
    // /login?estado=x&destino=…
    url.search = "";
    if (destino !== "/" && !destino.startsWith("//")) {
      url.searchParams.set("destino", destino);
    }
    return NextResponse.redirect(url);
  }

  if (user && esLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return respuesta;
}

export const config = {
  matcher: [
    // site.webmanifest va excluido: el navegador lo pide sin sesión y un 307
    // al login deja el favicon de Android/instalación sin definir.
    "/((?!_next/static|_next/image|favicon.ico|site.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
