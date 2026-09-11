# workers/ — codigo muerto, NO lo usa la app

Estos dos workers son piezas de otro proyecto que quedaron en el repositorio.
**Ninguna esta referenciada desde `src/` ni desde `api/`** (verificado con grep en
todo el repo), este repo no tiene `wrangler` ni script de deploy, y borrar la
carpeta no cambiaria nada en el tracker.

Si alguna vez se publicaron en Cloudflare, siguen respondiendo aunque nadie las
llame desde aca. Eso importa por lo siguiente.

## `balance-worker` (`portfolio-balance-worker`)

Devuelve los saldos reales de Binance, Bybit y OKX **sin pedir ninguna
credencial** y con `Access-Control-Allow-Origin: *`. Cualquiera que conozca la URL
ve los saldos. `/debug-ip` ademas expone la IP y el ISP de salida.

Secretos que usa: `BINANCE_KEY`, `BINANCE_SECRET`, `BYBIT_KEY`, `BYBIT_SECRET`,
`OKX_KEY`, `OKX_SECRET`, `OKX_PASSPHRASE`.

## `bot-worker` (`p2p-bot-worker`)

Lista, edita y apaga anuncios P2P de Binance con las claves del dueno. Lo protege
un token estatico (`X-Bot-Token`), sin rotacion ni expiracion.

Secretos que usa: `BOT_TOKEN` y las mismas claves de Binance.

## Que hacer

1. Entrar al panel de Cloudflare → Workers & Pages y buscar
   `portfolio-balance-worker` y `p2p-bot-worker`.
2. **Si NO estan desplegados**: no hay nada expuesto. Esta carpeta se puede borrar.
3. **Si estan desplegados**: darlos de baja (Delete, no solo desactivar la ruta) y
   **rotar las claves de exchange que tengan cargadas** — estuvieron accesibles
   detras de una URL sin autenticacion, asi que hay que asumirlas quemadas. Las
   claves del tracker son otras: viven en el `localStorage` de cada dispositivo
   (`ft13_xk`) y no tienen nada que ver con estas.

La app pide los saldos por su propio proxy (`api/balance.js?ex=binance|bybit|okx|ankr`,
antes cuatro archivos separados), que exige el JWT de Supabase del usuario. Ese es
el que hay que mirar si algo de saldos deja de funcionar.
