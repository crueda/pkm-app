/* ════════════════════════════════════════════════════════════════════
   CARGA DE DATOS COMPRIMIDOS

   Los datos (~30 MB sin comprimir) se sirven como ficheros .json.gz y se
   descomprimen en el navegador con DecompressionStream. Así la descarga
   baja a ~3-4 MB sin necesidad de activar gzip en el servidor.

   Cada fichero define un global (CONCESIONES, MUNICIPIOS, …) que app.js
   detecta en detectData(). Los errores se acumulan en window.__dataLoadErrors
   para que app.js muestre el aviso de datos no cargados.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Fallback para conjuntos antiguos que todavía no publican metadatos.
  const DATA_VERSION = '20261016-chunked-expeditions2';

  const DATA_FILES = [
    ['concesiones.json.gz', 'CONCESIONES'],
    ['municipios.json.gz', 'MUNICIPIOS'],
    ['paradas.json.gz', 'PARADAS'],
    ['lineas.json.gz', 'LINEAS'],
    ['rutas.json.gz', 'RUTAS'],
  ];

  // Opcionales para conservar compatibilidad con publicaciones anteriores.
  const OPTIONAL_DATA_FILES = [
    ['frontend-config.json.gz', 'FRONTEND_CONFIG'],
  ];

  async function fetchGzipJson(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    if (typeof DecompressionStream === 'undefined') {
      throw new Error('El navegador no soporta DecompressionStream');
    }

    const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
    const text = await new Response(stream).text();
    return JSON.parse(text);
  }

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function dataVersion(meta) {
    return encodeURIComponent(meta?.generadoEn || DATA_VERSION);
  }

  async function loadExpeditions(version) {
    let manifest;
    try {
      manifest = await fetchJson(`data/expediciones.manifest.json?v=${version}`);
    } catch (manifestError) {
      // Compatibilidad con despliegues anteriores al formato fragmentado.
      console.warn('No se encontró el manifiesto de expediciones; se intenta el fichero único.', manifestError);
      return fetchGzipJson(`data/expediciones.json.gz?v=${version}`);
    }

    if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.chunks)) {
      throw new Error('Manifiesto de expediciones no válido');
    }

    const expeditions = [];
    for (const chunk of manifest.chunks) {
      if (!chunk || typeof chunk.file !== 'string') {
        throw new Error('Fragmento de expediciones no válido');
      }
      const rows = await fetchGzipJson(`data/${encodeURIComponent(chunk.file)}?v=${version}`);
      if (!Array.isArray(rows)) {
        throw new Error(`El fragmento ${chunk.file} no contiene un array`);
      }
      if (Number.isInteger(chunk.count) && rows.length !== chunk.count) {
        throw new Error(`Conteo inesperado en ${chunk.file}`);
      }
      for (const row of rows) expeditions.push(row);
    }

    if (Number.isInteger(manifest.total) && expeditions.length !== manifest.total) {
      throw new Error(
        `Conteo total de expediciones inesperado: ${expeditions.length}/${manifest.total}`
      );
    }
    return expeditions;
  }

  async function loadAppData() {
    window.__dataLoadErrors = window.__dataLoadErrors || [];
    window.__dataLoadErrors.length = 0;

    try {
      // El timestamp evita que navegador o proxy reutilicen el meta de otro día.
      window.META = await fetchGzipJson(
        `data/meta.json.gz?t=${Date.now()}`,
        { cache: 'no-store' }
      );
    } catch (err) {
      console.error('No se pudo cargar data/meta.json.gz:', err);
      window.__dataLoadErrors.push('data/meta.json.gz');
    }

    const version = dataVersion(window.META);
    await Promise.all(
      DATA_FILES.map(async ([file, varName]) => {
        try {
          window[varName] = await fetchGzipJson(`data/${file}?v=${version}`);
        } catch (err) {
          console.error(`No se pudo cargar data/${file}:`, err);
          window.__dataLoadErrors.push(`data/${file}`);
        }
      })
    );

    await Promise.all(
      OPTIONAL_DATA_FILES.map(async ([file, varName]) => {
        try {
          window[varName] = await fetchGzipJson(`data/${file}?v=${version}`);
        } catch (err) {
          console.warn(`No se pudo cargar data/${file}:`, err);
        }
      })
    );

    try {
      // Secuencial: solo existe una cadena JSON descomprimida en memoria cada vez.
      window.EXPEDICIONES = await loadExpeditions(version);
    } catch (err) {
      console.error('No se pudieron cargar las expediciones:', err);
      window.__dataLoadErrors.push('data/expediciones');
    }

    if (window.__dataLoadErrors.length > 0) {
      throw new Error(`Carga de datos incompleta: ${window.__dataLoadErrors.join(', ')}`);
    }
  }

  window.loadAppData = loadAppData;
})();
