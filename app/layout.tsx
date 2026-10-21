import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Facturación · PMO", template: "%s · PMO" },
  description: "Módulo de facturación electrónica del PMO de ERMA Aegis (repo aislado)",
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

// Mismo script de tema que el PMO: claro por defecto, oscuro solo si se pidió.
// `.dark` alimenta las variantes `dark:` y `data-theme` los tokens de marca.
const scriptTema = `try{var t=localStorage.getItem('tema');var d=document.documentElement;if(t==='oscuro'){d.classList.add('dark');d.setAttribute('data-theme','dark');}else{d.classList.remove('dark');d.removeAttribute('data-theme');}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: scriptTema }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
