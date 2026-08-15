# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Reglas para Claude Code — Ahorra Tokens

## 1. No programar sin contexto
- ANTES de escribir codigo: lee los archivos relevantes, revisa git log, entiende la arquitectura.
- Si no tienes contexto suficiente, pregunta. No asumas.

## 2. Respuestas cortas
- Responde en 1-3 oraciones. Sin preambulos, sin resumen final.
- No repitas lo que el usuario dijo. No expliques lo obvio.
- Codigo habla por si mismo: no narres cada linea que escribes.

## 3. No reescribir archivos completos
- Usa Edit (reemplazo parcial), NUNCA Write para archivos existentes salvo que el cambio sea >80% del archivo.
- Cambia solo lo necesario. No "limpies" codigo alrededor del cambio.

## 4. No releer archivos ya leidos
- Si ya leiste un archivo en esta conversacion, no lo vuelvas a leer salvo que haya cambiado.
- Toma notas mentales de lo importante en tu primera lectura.

## 5. Validar antes de declarar hecho
- Despues de un cambio: compila, corre tests, o verifica que funciona.
- Nunca digas "listo" sin evidencia de que funciona.

## 6. Cero charla aduladora
- No digas "Excelente pregunta", "Gran idea", "Perfecto", etc.
- No halagues al usuario. Ve directo al trabajo.
- Nunca me escribas con acento de ningun pais, sobretodo argentino. Siempre utiliza un Español neutro

## 7. Soluciones simples
- Implementa lo minimo que resuelve el problema. Nada mas.
- No agregues abstracciones, helpers, tipos, validaciones, ni features que no se pidieron.
- 3 lineas repetidas > 1 abstraccion prematura.

## 8. No pelear con el usuario
- Si el usuario dice "hazlo asi", hazlo asi. No debatas salvo riesgo real de seguridad o perdida de datos.
- Si discrepas, menciona tu concern en 1 oracion y procede con lo que pidio.

## 9. Leer solo lo necesario
- No leas archivos completos si solo necesitas una seccion. Usa offset y limit.
- Si sabes la ruta exacta, usa Read directo. No hagas Glob + Grep + Read cuando Read basta.

## 10. No narrar el plan antes de ejecutar
- No digas "Voy a leer el archivo, luego modificar la funcion, luego compilar...". Solo hazlo.
- El usuario ve tus tool calls. No necesita un preview en texto.

## 11. Paralelizar tool calls
- Si necesitas leer 3 archivos independientes, lee los 3 en un solo mensaje, no uno por uno.
- Menos roundtrips = menos tokens de contexto acumulado.

## 12. No duplicar codigo en la respuesta
- Si ya editaste un archivo, no copies el resultado en tu respuesta. El usuario lo ve en el diff.
- Si creaste un archivo, no lo muestres entero en texto tambien.

## 13. No usar Agent cuando Grep/Read basta
- Agent duplica todo el contexto en un subproceso. Solo usalo para busquedas amplias o tareas complejas.
- Para buscar una funcion o archivo especifico, usa Grep o Glob directo.

## Comandos

```
npm run dev          # vite dev server
npm run build        # build de produccion -> dist/ (mismo comando que corre Vercel)
npm run preview      # sirve dist/ localmente, como en prod
npm test             # vitest run (una sola pasada, todos los *.test.js)
npm run test:watch   # vitest en modo watch
npx vitest run src/finance-core.test.js   # correr un solo archivo de test
npm run test:e2e     # build + levanta vite preview + dirige Chrome headless via CDP (e2e/sync.e2e.mjs)
```

No hay linter configurado. Despues de cualquier cambio en `src/` o `api/`, correr `npm run build` (falla si hay un error de sintaxis/import) y `npm test` si el cambio toca un modulo con `.test.js`.

## Arquitectura

**SPA vanilla sin framework.** No hay React/Vue ni router: `index.html` contiene todas las "paginas" como `<div id="page-*">` ocultos que `showPage()` (src/main.js) muestra/oculta. Vite solo bundlea `src/main.js` (ES modules) + `index.html`. El estado global mutable `S` (definido al tope de src/main.js) es la unica fuente de verdad del cliente.

**Modulos puros vs. main.js.** `src/sync-core.js`, `finance-core.js`, `format.js`, `tools.js` y `auth.js` son la logica extraida de main.js que es pura/testeable (sin DOM) — cada uno tiene su `*.test.js`. `main.js` (el archivo mas grande del repo) es todo lo demas: render, handlers de eventos, boot, llamadas a red; esta deliberadamente fuera de los tests unitarios por lo acoplado que esta al DOM (lo cubre `e2e/sync.e2e.mjs`).

**Persistencia y sync multi-usuario.**
- `S` se persiste en `localStorage` (`ft13`) y se sincroniza contra Supabase Postgres via `api/sync.js` (GET = pull, POST = push). La tabla `app_state` (ver `supabase/schema.sql`) es una fila por usuario con RLS por `user_id`; el merge es responsabilidad del servidor, no de Postgres.
- `mergeDocs()` en `api/sync.js` es un espejo de la logica de merge del cliente (`src/sync-core.js` + main.js) — **si cambias la convencion de merge, cambiala en ambos lados**.
- Convencion LWW generica: cualquier campo de `S` con un hermano `<campo>UpdatedAt` participa automaticamente del last-writer-wins (ver `stamp()`/`lwwPairs()` en main.js y `mergeDocs()` en api/sync.js). No hay lista hardcodeada de campos: agregar uno nuevo con su `UpdatedAt` ya sincroniza solo.
- `transactions` es la excepcion: no se reemplaza como array completo sino con merge por-transaccion (`mergeTxArrays`) + tombstones revocables (`{id, ts}` en `deletedTxIds`, podados a los 90 dias) — asi un delete en un dispositivo no resucita por un push viejo de otro.
- Lock optimista en la escritura (`writeDocIf` en api/sync.js): el PATCH exige que `updated_at` siga siendo el del snapshot leido; si 0 filas, reintenta read-merge-write (hasta 3 veces) en vez de pisar a ciegas.
- `stamp()` (main.js) es un reloj logico monotono: nunca retrocede aunque el reloj del dispositivo este desincronizado, para que el orden de las ediciones no dependa del wall-clock.

**Patron critico "fromUser".** Las calculadoras de `src/tools.js` (`calcProfit`, `calcSpread`, `calcBCVEmily`) se invocan tanto por input real del usuario como programaticamente (re-render, cambio de tab, etc). Solo deben escribir en `S` (y llamar `save()`) cuando reciben `fromUser===true`; invocarlas sin ese flag nunca debe mutar estado, o un dispositivo puede pisarle a otro con datos viejos en el proximo sync.

**Offline.** `save()` marca `_dirty`, incrementa un contador `_pendingCount` (persistido en localStorage para sobrevivir un reload) y hace debounce del push a la nube (1.5s). El banner `#offline-banner` muestra "trabajando offline · N cambios sin subir" cuando `navigator.onLine` es false.

**Service worker (public/sw.js).** Precachea el app shell + JS/CSS hasheado para que offline funcione desde el primer load, pero excluye explicitamente `/api/*` del cache: la Cache API indexa por URL, no por header `Authorization`, asi que cachear respuestas de sync mezclaria datos entre usuarios. `vite.config.js` inyecta un sello de build unico en `dist/sw.js` en cada build para forzar que el navegador detecte version nueva (sin eso, bytes identicos de sw.js nunca disparan `updatefound`).

**Auth (src/auth.js).** Supabase GoTrue (email/password, OTP y passkeys/WebAuthn). `sbRefresh()` es tri-state (`true`/`false`/`'net'`) para distinguir "el usuario debe volver a loguearse" (credencial invalida) de "fallo de red" — un `'net'` nunca debe forzar logout.

**api/ (Vercel serverless functions, una por archivo).** `sync.js` es la unica con merge complejo. `backup.js`/`restore.js` hacen snapshot/restore completo de `S` protegido con comparacion timing-safe. `blob-upload.js` sube adjuntos con whitelist de mime types. `*-balance.js` (ankr, binance, bybit, okx) son proxies a esas APIs porque no tienen CORS abierto para pedirlas desde el navegador. `api/_lib/web.js` comparte `verifySupabaseUser()`/`cors()` entre los endpoints que lo necesitan.

**Deploy.** Vercel (`vercel.json`: build command, cron diario a `/api/backup`, headers de cache para `sw.js`/`manifest.json`/iconos) detras de Cloudflare en `portfolio.kisushotto.com`. `index.html` redirige a `kisushotto.com` si el hostname no coincide (protege contra acceso por el dominio `.vercel.app` crudo).
