# PMO · Módulo de facturación electrónica

Este repo es **solo el módulo de facturación** del PMO de ERMA Aegis: la
pestaña `/facturacion`, sus rutas de API y la librería que arma y envía la
factura electrónica a la DGI a través del PAC **The Factory HKA**.

El PMO completo vive en otro repo privado. Lo que el módulo usa del resto del
PMO (roles, el proyecto, la cotización) está aquí **recortado**: solo existe lo
que facturación lee. El trabajo de este repo se integra luego al PMO a mano,
con revisión.

## Arrancar

Necesitas Node 22, npm y Docker (para el Supabase local).

```bash
npm install
npx supabase start          # levanta Postgres + Auth + Storage en Docker
cp .env.example .env.local  # y pega la API URL y la anon key que imprimió el paso anterior
npm run dev                 # http://localhost:3000
```

`npx supabase start` aplica `supabase/migrations/` y carga `supabase/seed.sql`.

**No hay login.** Al abrir la app, el middleware abre la sesión solo con el
usuario de prueba que diga `.env.local` (`FACTURACION_USUARIO_DEV`). Los dos
usuarios del seed son:

| `FACTURACION_USUARIO_DEV` | Rol | Qué puede hacer |
|---|---|---|
| `admin@prueba.test` (por defecto) | admin | emitir, anular, reenviar, borrar demo |
| `auditor@prueba.test` | auditor | ver todo, sin tocar nada |

Para probar el otro rol, cambia esa línea de `.env.local` y recarga.

Para volver a la base limpia: `npx supabase db reset`.

### HKA (ambiente demo)

Sin las variables `HKA_*` la pestaña funciona igual, pero **Emitir queda
deshabilitado** (`GET /api/hka/folios` responde `configurado:false`, que es un
estado normal, no un error). Las credenciales del ambiente **demo** te las pasa
Paul aparte; nunca van en el repo. **Nunca uses credenciales de producción.**

## Verificar antes de cada PR

```bash
npm run typecheck && npm test && npm run lint && npm run build
```

## Qué hay en el repo

| Ruta | Qué es |
|---|---|
| `app/(app)/facturacion/` | La pestaña: listado, KPIs del mes, «Nueva factura» |
| `components/facturacion/` | `FormularioFactura`, `PanelFacturas`, `FormularioEntidad` |
| `app/api/facturas/` | Crear y emitir, reintentar, anular, reenviar correo, archivos |
| `app/api/hka/` | Folios, series, diagnóstico, consulta y verificación de RUC |
| `lib/hka/` | Librería pura que arma el documento (`documento.ts`), catálogos DGI (`datos/`) y el cliente HTTP de HKA (`cliente.ts`, solo servidor) |
| `lib/facturas/` | Preparación de renglones y receptor, emisión del lado del servidor |
| `lib/calc.ts` | **La única cuenta de totales e ITBMS** del PMO |
| `supabase/migrations/` | Esquema de facturación (copia fiel de producción) + tablas del PMO recortadas |

### Archivos que NO son del módulo (no los cambies)

Son copias o versiones mínimas de piezas del PMO. Si los cambias, el cambio no
viaja al PMO y lo que funcionaba aquí se rompe allá:

- `lib/perfil.ts`, `lib/perfil-servidor.ts`, `components/PerfilProvider.tsx`
- `lib/types.ts`, `lib/proyectos/*`, `lib/analitica.ts`, `lib/descargas.ts`, `lib/format.ts`
- `lib/supabase/*`, `components/ui/*`, `middleware.ts`
- `app/layout.tsx`, `app/(app)/layout.tsx`, `app/page.tsx`, `app/globals.css`, `app/erma-tokens.css`

Si el módulo necesita algo nuevo de ahí (una columna de `proyectos`, un rol,
un componente de UI), dilo en la descripción del PR.

## Reglas que no se negocian

1. Los totales **siempre** salen de `calcularTotales` / `itbmsLinea`
   (`lib/calc.ts`). Una segunda cuenta es como el CAFE y la cotización firmada
   terminan difiriendo por un centavo.
2. RUC y DV **nunca** se deducen ni se corrigen solos: `ConsultaRucDv` arbitra
   y un humano decide. Emparejar un cliente con su entidad es por **alias
   exacto normalizado, jamás LIKE**.
3. La fila de la factura se escribe **antes** de llamar a HKA; el `payload` y
   la `respuesta` crudos se guardan siempre (un rechazo sin ellos no se puede
   auditar).
4. El número fiscal sale de `siguiente_numero_fiscal()` y **se queda con su
   fila**: un reintento usa el mismo número. Un código 102 (duplicado) se
   resuelve consultando `EstadoDocumento`.
5. Una factura **autorizada** de producción es un documento fiscal: solo puede
   pasar a anulada (≤ 7 días). Después es Nota de Crédito (≤ 180 días). Una
   **anulada** es terminal. Lo imponen los triggers de la base, no la UI.
6. Las facturas **demo** son ensayos borrables. En demo **jamás** se precarga
   el correo real de la entidad.
7. Emitir **no** toca nada del proyecto fuera de facturación (fechas de
   factura, cobros): eso sigue siendo manual en el PMO.
8. Solo **Admin y PM** emiten (`esGestorServidor` en cada ruta). Auditor y
   Co-Founder ven la pestaña en solo lectura. El Cotizador no entra.
9. Toda tabla nueva lleva las políticas RLS del patrón (ver el final de la
   migración base: 1 restrictiva de equipo, 3 restrictivas del auditor, lectura
   del equipo, escritura del gestor) **y sus `GRANT` explícitos**. Todo RPC
   nuevo lleva su `revoke execute ... from public, anon`.
10. Montos como **string con 2 decimales**; los campos que no aplican se
    **omiten** (`podar()`), no se mandan vacíos.

## Reglas de HKA aprendidas en demo

- `fechaVenceCuota` exige el formato completo `AAAA-MM-DDThh:mm:ss-05:00`.
- `infoPagoCuota` es obligatorio y con longitud mínima, aunque la ficha lo
  pinte opcional.
- La retención (`codigoRetencion` 2, 50 % del ITBMS, venta al Estado) **no
  descuenta nada**: cuota y `totalValorRecibido` van por el total completo; la
  retención viaja en su propio bloque.
- `totalMontoGravado` es la **suma de impuestos** (nombre engañoso).
- Receptor gobierno (`tipoClienteFE` 03) exige RUC+DV válidos, razón social,
  dirección, la ubicación **exacta** del catálogo (`lib/hka/datos/`, el
  catálogo escribe "PANAMA" sin tilde) y **CPBS por renglón**.
- `ListaDocumentos`: rango máximo de 7 días, throttle de 30 s (código 203),
  `fechaFin` obligatoria.
- Series: el PMO emite por el punto de facturación **002**; el **001** es el de
  Dfactura (la facturación manual) y no se toca.

## Estado y lo que falta

| Fase | Estado |
|---|---|
| F1 · Pestaña `/facturacion` | Hecha |
| F2 · Factura libre (sin proyecto) + directorio de entidades | Hecha |
| F3 · Importar las facturas de la serie 001 (Dfactura) | **Pendiente** |
| F4 · Notas de crédito (tipo 04) | **Pendiente** |
| F5 · Pase a producción | Lo hace Paul en el PMO |

**F3 · Importar Dfactura.** Columna nueva `facturas.origen` (`'pmo'` por
defecto | `'dfactura'`). Sync por ventanas de 7 días hacia atrás con
`ListaDocumentos` (throttle de 30 s → bucle desde el cliente con
`{continuar: true}`, sin cron), una tabla de estado con la marca de hasta dónde
se llegó, dedupe por CUFE y descarga de CAFE/XML por CUFE al bucket `facturas`
(rutas `origen-dfactura/...`). Ligar una importada a un proyecto es **con
confirmación manual**: el sync propone candidatos por entidad + monto + rango de
fecha y un humano confirma cada enlace; sin confirmar quedan sueltas con su chip
«Dfactura». Solo funciona con credenciales de producción; en local se trabaja
con respuestas de HKA simuladas.

**F4 · Notas de crédito.** `tipoDocumento` 04 con
`listaDocsFiscalReferenciados[]` (`fechaEmisionDocFiscalReferenciado` +
`cufeFEReferenciada` de 66 posiciones). Consume su propia secuencia
(serie 0000-002-04). En la UI: acción «Nota de crédito» sobre una autorizada de
más de 7 días, con los renglones de la factura prellenados y editables (parcial
o total).

## Cómo entregar

Rama por tarea y PR contra `main` de este repo. Cada PR con: qué cambia, cómo
se probó (en demo, si toca HKA) y, si hay migración, el SQL en
`supabase/migrations/` con un nombre `AAAAMMDDHHMMSS_que_hace.sql`.
