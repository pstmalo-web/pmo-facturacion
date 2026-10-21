// La cabecera de una sección plegable: icono en pastilla, título y —si hace
// falta— una línea de descripción debajo.
//
// POR QUÉ EXISTE: en /biblioteca cada sección traía su título en negrita y,
// PEGADA AL LADO, su descripción en gris — un solo renglón corrido. En una
// pantalla ancha ese renglón mide más de mil píxeles, así que las secciones se
// leían como renglones idénticos de texto seguido y no había dónde apoyar la
// vista. Aquí el título va en su línea, la descripción debajo con ancho de
// lectura, y el icono en pastilla le da a cada sección un ancla que se
// reconoce sin leerla.
//
// Vive en components/ui porque lo comparten DOS pantallas con el mismo
// problema: /biblioteca (cinco secciones) y Comercial (tres). Escrito dos
// veces, las dos copias divergen y el título de una sección deja de parecerse
// al de la de al lado sin que nadie lo decida.
//
// DOS VARIANTES, y la diferencia es HTML válido, no estética:
//  · por defecto todo son <span>, porque en /biblioteca y en Comercial estas
//    cabeceras van DENTRO del <button> que pliega la sección y un <div> ahí es
//    inválido;
//  · con `nivel="h2"` el envoltorio es <div> y el título un <h2> de verdad.
//    Lo usa el editor de cotizaciones, donde los bloques son secciones de un
//    formulario y su título ya era un encabezado del documento: degradarlo a
//    <span> le quitaría a un lector de pantalla el índice de la página.

import type { LucideIcon } from "lucide-react";

export function TituloSeccion({
  icono: Icono,
  titulo,
  descripcion,
  nivel,
  children,
}: {
  icono: LucideIcon;
  titulo: string;
  /** Opcional: en pantallas con presupuesto vertical apretado (Comercial tiene
   *  cuatro bloques antes de la primera fila) una sección que se explica sola
   *  no gana nada con una segunda línea. */
  descripcion?: string;
  /** "h2" cuando la cabecera NO va dentro de un botón y el título es un
   *  encabezado real del documento. */
  nivel?: "h2";
  /** Se pinta al lado del título: contadores, avisos de vencimiento… */
  children?: React.ReactNode;
}) {
  const Caja = nivel ? "div" : "span";
  const Titulo = nivel ?? "span";
  return (
    <Caja className="flex min-w-0 flex-1 items-start gap-3">
      <span
        className="mt-px flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-clay/10 text-clay"
        aria-hidden
      >
        <Icono className="h-[18px] w-[18px]" />
      </span>
      <Caja className="min-w-0 flex-1">
        <Caja className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Titulo className="text-[15px] font-semibold text-ink">
            {titulo}
          </Titulo>
          {children}
        </Caja>
        {descripcion && (
          // `text-pretty` porque estas descripciones caen justo en dos líneas y
          // sin él la segunda quedaba con dos palabras huérfanas.
          <span className="mt-1 block max-w-[80ch] text-pretty text-[13px] leading-relaxed text-ink/70">
            {descripcion}
          </span>
        )}
      </Caja>
    </Caja>
  );
}
