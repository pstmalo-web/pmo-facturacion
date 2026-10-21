// Formatos heredados de Invoice Simple para continuidad visual.

/** 1,000.00 $ — coma para miles, punto para decimales. */
export function moneda(n: number): string {
  const fijo = (Math.round(n * 100) / 100).toFixed(2);
  const [entero, decimales] = fijo.split(".");
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${conMiles}.${decimales} $`;
}

/**
 * El mismo importe que `moneda`, con un espacio DURO antes del «$».
 *
 * Para tarjetas estrechas y nada más: en una KPI de 132 px, «411,761.47 $»
 * rompe justo por ese espacio y deja el símbolo solo en la línea de abajo.
 * `moneda` no se toca porque su salida está congelada en los golden de los
 * PDF, y un `whitespace-nowrap` solo cambiaría el corte por un desborde.
 */
export function monedaSinCorte(n: number): string {
  return moneda(n).replace(" $", "\u00a0$");
}

/**
 * El importe en corto para columnas de ~40 px: «133k $», «9.6k $», «1.2M $».
 *
 * Nació para la fila de lo ganado por mes bajo la gráfica del Dashboard, donde
 * «133,011.06 $» no cabe y los centavos no dicen nada. NUNCA para un
 * documento, un total ni una celda editable: redondea, y una cifra redondeada
 * que se copie a PanamaCompra es un error de captura. El tooltip de la misma
 * columna lleva `moneda` con los centavos completos.
 *
 * Reglas: desde 10,000 sin decimal («133k»), entre 1,000 y 9,999 con uno
 * («9.6k», y «10k» cuando el redondeo llega ahí), desde un millón en «M» con
 * uno («1.2M»; el umbral es 999,500 para que el redondeo no imprima «1000k»).
 * Espacio DURO antes del «$», como `monedaSinCorte`.
 */
export function monedaCorta(n: number): string {
  const abs = Math.abs(n);
  const signo = n < 0 ? "-" : "";
  const sinCeroMuerto = (x: string) => x.replace(/\.0$/, "");
  let cifra: string;
  if (abs >= 999_500) cifra = `${sinCeroMuerto((abs / 1_000_000).toFixed(1))}M`;
  else if (abs >= 10_000) cifra = `${Math.round(abs / 1_000)}k`;
  else if (abs >= 1_000) cifra = `${sinCeroMuerto((abs / 1_000).toFixed(1))}k`;
  else cifra = String(Math.round(abs));
  return `${signo}${cifra}\u00a0$`;
}

/** USD 1,000.00 $ — para el total del encabezado. */
export function monedaUSD(n: number): string {
  return `USD ${moneda(n)}`;
}

/**
 * La cifra tal cual se TECLEA en un formulario: "4387.00".
 *
 * Sin símbolo y **sin separador de miles**, que es la razón de existir: todos
 * los demás formatos de este archivo son para leer, y `moneda()` produce
 * "4,387.00 $" — pegado en un input de PanamaCompra eso es un error de captura,
 * no un número. La usa el buzón de subida en sus botones de copiar.
 *
 * Siempre dos decimales: un precio que se copie como "18.2" invita a que el
 * portal lo interprete distinto del PDF.
 */
export function cifraCruda(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * Cifra en formato contable, SIN símbolo: "1,460.00", y los negativos entre
 * paréntesis. El "$" va aparte porque en la tabla de Proyectos se ancla al
 * borde izquierdo de la celda mientras el número alinea a la derecha (ver
 * `Contable`); pegarlo aquí haría imposible esa alineación.
 */
export function cifraContable(n: number): string {
  const abs = Math.abs(Math.round(n * 100) / 100).toFixed(2);
  const [entero, decimales] = abs.split(".");
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cifra = `${conMiles}.${decimales}`;
  return n < 0 ? `(${cifra})` : cifra;
}

/** "$ 1,460.00" — contable en una sola cadena (aria-labels, tooltips, chips). */
export function monedaContable(n: number): string {
  return `$ ${cifraContable(n)}`;
}

/** 2026.07.10 a partir de una fecha ISO (YYYY-MM-DD). */
export function fechaPunto(iso: string): string {
  if (!iso) return "";
  return iso.slice(0, 10).replaceAll("-", ".");
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

// Días abreviados en el orden de getUTCDay(): domingo primero.
const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/**
 * "lun, Julio 23" — formato de fecha de la pestaña Proyectos. El día de la
 * semana sale de una fecha construida en UTC (Date.UTC + getUTCDay), único
 * uso de Date que no corre el día: leer el texto ISO no basta porque el día
 * de la semana hay que calcularlo.
 */
export function fechaDiaMes(iso: string): string {
  if (!iso) return "";
  const [anio, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  if (!anio || !mes || !dia || mes < 1 || mes > 12) return "";
  const nombreMes = MESES[mes - 1];
  const diaSemana = DIAS_CORTOS[new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay()];
  return `${diaSemana}, ${nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)} ${dia}`;
}

/** "17 de julio de 2026" a partir de una fecha ISO (sin pasar por Date: evita
 *  corrimientos de zona horaria). */
export function fechaLarga(iso: string): string {
  if (!iso) return "";
  const [anio, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  if (!anio || !mes || !dia || mes < 1 || mes > 12) return "";
  return `${dia} de ${MESES[mes - 1]} de ${anio}`;
}

/** "2026-07-23T23:59:00-05:00" -> "23 de julio de 2026, 11:59 p. m.".
 *  Lee el texto ISO directamente (sin Date: la hora es la local del pliego).
 *  Si el texto no es ISO se devuelve tal cual. */
export function fechaHoraLegible(iso: string): string {
  if (!iso) return "";
  const fecha = fechaLarga(iso);
  if (!fecha) return iso;
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (!m) return fecha;
  const h24 = parseInt(m[1], 10);
  const h12 = h24 % 12 || 12;
  return `${fecha}, ${h12}:${m[2]} ${h24 >= 12 ? "p. m." : "a. m."}`;
}

/**
 * Cierre de un acto en hora de Panamá: "2026.08.10 · 12:00 p. m.".
 *
 * TERCERA excepción deliberada a la regla de leer el ISO como texto (las otras
 * dos son `hoyPA()` y `diaPA()` en lib/ventana.ts): `acto_cierre` es un
 * timestamptz de verdad, así que convertirlo al calendario panameño SÍ pide
 * Intl con timeZone America/Panama.
 *
 * PERO EL «p. m.» LO ESCRIBIMOS NOSOTROS, y esa es la razón de que esta
 * función exista en vez de las dos copias que había (el PDF y la vista previa
 * del editor). El `dayPeriod` de ICU no es el mismo texto en todas partes:
 *
 *   Node 22  →  "p." + U+00A0 (espacio duro) + "m."
 *   Chrome   →  "p." + U+0020 (espacio normal) + "m."
 *
 * Se ven idénticos y no lo son, así que la vista previa —que es un componente
 * de cliente renderizado también en el servidor— rompía la hidratación de
 * /cotizaciones/[id] en CADA carga: React tiraba el HTML del servidor y
 * repintaba el árbol entero en el cliente. Con `hourCycle: "h23"` no se le
 * pide a ICU ni el dayPeriod ni el paso a 12 horas, así que el resultado es
 * byte a byte el mismo en los dos lados (y el PDF del servidor imprime
 * exactamente lo que la vista previa enseña, que es lo que su comentario
 * prometía desde el principio).
 */
export function cierreEnPanama(iso: string): string {
  const partes = new Intl.DateTimeFormat("es-PA", {
    timeZone: "America/Panama",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const p = (t: Intl.DateTimeFormatPartTypes) =>
    partes.find((x) => x.type === t)?.value ?? "";
  const h24 = parseInt(p("hour"), 10);
  // Misma aritmética que fechaHoraLegible: 0 → 12 a. m., 12 → 12 p. m.
  const h12 = String(h24 % 12 || 12).padStart(2, "0");
  const ampm = h24 >= 12 ? "p. m." : "a. m.";
  return `${p("year")}.${p("month")}.${p("day")} · ${h12}:${p("minute")} ${ampm}`;
}

/** Fecha de hoy en ISO local (YYYY-MM-DD). */
export function hoyISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dia}`;
}

// ---------------------------------------------------------------------------
// Monto en letras (español), para documentos formales panameños.
// Ej.: 4387.00 -> "Cuatro mil trescientos ochenta y siete con 00/100"
// ---------------------------------------------------------------------------

const UNIDADES = [
  "", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho",
  "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis",
  "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós",
  "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete",
  "veintiocho", "veintinueve",
];
const DECENAS = [
  "", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta",
  "ochenta", "noventa",
];
const CENTENAS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
];

/** Convierte 0–999 a palabras. */
function centenasEnLetras(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  let out = "";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c) out += CENTENAS[c] + " ";
  if (resto <= 29) {
    out += UNIDADES[resto];
  } else {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    out += DECENAS[d];
    if (u) out += " y " + UNIDADES[u];
  }
  return out.trim();
}

// "uno" -> "un" antes de sustantivo; "veintiuno" -> "veintiún".
function apocopar(s: string): string {
  return s.replace(/veintiuno/g, "veintiún").replace(/\buno\b/g, "un");
}

/**
 * Convierte un entero no negativo a palabras. Exportado como
 * `numeroEnLetras` para los documentos legales, donde las cantidades se
 * escriben en letras con la cifra entre paréntesis ("quince (15) días
 * hábiles"): el formato CON-0050 de la DGCP lo pide así, y montoEnLetras no
 * sirve porque agrega los centavos de una factura.
 */
export function numeroEnLetras(n: number): string {
  return enteroEnLetras(n);
}

function enteroEnLetras(n: number): string {
  n = Math.floor(n);
  if (n === 0) return "cero";
  let out = "";
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  if (millones) {
    out +=
      (millones === 1
        ? "un millón"
        : apocopar(centenasEnLetras(millones)) + " millones") + " ";
  }
  if (miles) {
    out += (miles === 1 ? "mil" : apocopar(centenasEnLetras(miles)) + " mil") + " ";
  }
  if (resto) out += centenasEnLetras(resto);
  return out.trim();
}

/**
 * 4387.00 -> "Cuatro mil trescientos ochenta y siete con 00/100".
 * Los centavos van como fracción sobre 100, al estilo de facturas.
 */
export function montoEnLetras(n: number): string {
  const entero = Math.floor(n);
  const centavos = Math.round((n - entero) * 100);
  const cent = String(centavos).padStart(2, "0");
  const texto = `${enteroEnLetras(entero)} con ${cent}/100`;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
