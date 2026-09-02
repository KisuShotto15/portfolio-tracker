import { defineConfig } from 'vite';
import fs from 'node:fs';

// sw.js era estatico: los navegadores solo disparan 'updatefound' (y por ende el
// toast de "Nueva version") cuando los BYTES de sw.js cambian. Este plugin sella
// cada build con un hash unico en dist/sw.js, asi cada deploy re-instala el SW
// (que ademas re-precachea los assets nuevos para offline).
// Un solo sello por build, compartido entre sw.js y el bundle: asi lo que muestra
// Settings es EXACTAMENTE la version que el SW cacheo, y comparar los dos numeros
// alcanza para saber si un deploy llego al dispositivo.
const BUILD = Date.now().toString(36);

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD) },
  plugins: [{
    name: 'sw-build-stamp',
    closeBundle() {
      const p = 'dist/sw.js';
      if (!fs.existsSync(p)) return;
      const s = fs.readFileSync(p, 'utf8').replace('__BUILD__', BUILD);
      fs.writeFileSync(p, s);
    },
  }],
});
