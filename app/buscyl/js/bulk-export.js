/* ═══════════════════════════════════════════════════════════════════
   EVO13. EXPORTACIÓN MASIVA A WORD A PARTIR DE UN LISTADO DE PARADAS (CSV)
   Desde la búsqueda por parada, el usuario aporta un CSV con un listado de
   paradas y obtiene un único documento Word con, para cada una, la misma
   rejilla paradas × expediciones que la exportación individual.

   - El fichero se lee y procesa en el navegador; no se envía a ningún servidor.
   - Cada línea se resuelve por código público o por nombre (+ municipio) a la
     agrupación completa (stopArea) de la parada.
   - Se aplica a todas el criterio temporal en pantalla; los filtros de
     concesión y de tipo de línea no se propagan.
   - No modifica STATE: la búsqueda en pantalla queda como estaba.

   Depende de los globales de app.js (STATE, normalize, escapeHtml,
   areaKeyOfParada, paradaIdsOfArea, exportCuerpoLineas, buildWordHtml…), por
   lo que se carga después de él.
   ═══════════════════════════════════════════════════════════════════ */

const BULK_MAX_PARADAS = 200;
const BULK_CONFIRMAR_DESDE = 25;

// Nombres de columna reconocidos en la cabecera (ya normalizados: minúsculas,
// sin acentos, con "_", "-" y "." convertidos en espacios).
const BULK_COLUMNAS = {
  codigo: ['codigo', 'cod', 'code', 'codigo publico', 'codigo parada', 'cod parada',
    'codigo de parada', 'public code', 'publiccode', 'id parada'],
  nombre: ['nombre', 'parada', 'nombre parada', 'nombre de parada', 'name', 'stop',
    'stop name', 'denominacion'],
  municipio: ['municipio', 'localidad', 'poblacion', 'municipality', 'town',
    'nombre municipio', 'codigo municipio', 'cod municipio', 'ine', 'codigo ine'],
};

// Fichero de ejemplo descargable desde la barra de la exportación masiva:
// paradas por código público y por nombre + municipio.
const BULK_CSV_EJEMPLO_NOMBRE = 'ejemplo_listado_paradas.csv';
const BULK_CSV_EJEMPLO = [
  'Código;Nombre;Municipio',
  '420715;;',
  '240589;;',
  ';ESTACIÓN DE AUTOBUSES;Almazán',
  ';IGLESIA;Vega de Valcarce',
  ';PLAZA MAYOR;Alcubilla de Nogales',
].join('\r\n') + '\r\n';

const BULK_SALTO_PAGINA ='<br clear="all" style="page-break-before:always">';

const BULK_ESTILOS_WORD = `
h1.portada { font-size: 26pt; margin: 0 0 4pt 0; }
p.subtitulo { font-size: 14pt; color: #00695c; margin: 0 0 14pt 0; }
table.resumen { border-collapse: collapse; margin: 0 0 10pt 0; }
table.resumen td { border: 0.5pt solid #cccccc; padding: 3pt 8pt; font-size: 10pt; vertical-align: top; }
table.resumen td.k { background: #eeeeee; font-weight: bold; width: 5.5cm; }
h1.apartado { font-size: 16pt; margin: 0 0 8pt 0; }
table.lista { border-collapse: collapse; width: 100%; }
table.lista th, table.lista td { border: 0.5pt solid #999999; padding: 2pt 4pt; font-size: 9pt; text-align: left; vertical-align: top; }
table.lista th { background: #eeeeee; }
table.lista td.num { text-align: right; width: 1.2cm; }
p.secnum { font-size: 8.5pt; color: #888; margin: 0; text-transform: uppercase; letter-spacing: 1pt; }
p.vacio { font-size: 10pt; color: #666; font-style: italic; margin: 10pt 0 0 0; }
`;

const BULK_ESTADOS = {
  resuelta: 'Resuelta',
  no_encontrada: 'No encontrada',
  ambigua: 'Ambigua',
  repetida: 'Repetida',
};

/* ─── Disponibilidad ─────────────────────────────────────────────── */

// Activa salvo que la configuración publicada la desactive explícitamente
// (sin frontend-config, por compatibilidad, sigue disponible).
function bulkExportEnabled() {
  return window.FRONTEND_CONFIG?.busquedaMasivaParadas !== false
    && isSearchModeEnabled('parada');
}

// La acción de carga solo aparece en la pestaña "Por parada".
function updateBulkStopExportVisibility() {
  const bar = document.getElementById('bulkExportBar');
  if (!bar) return;
  bar.style.display = (STATE.searchTab === 'parada' && bulkExportEnabled()) ? '' : 'none';
}

/* ─── Lectura del CSV ────────────────────────────────────────────── */

// Clave de comparación: sin mayúsculas, acentos ni espacios duplicados.
function bulkClave(s) {
  return normalize(s).replace(/\s+/g, ' ');
}

// Las hojas de cálculo en español suelen guardar el CSV en Windows-1252: si el
// contenido no es UTF-8 válido se reinterpreta con esa codificación.
function bulkDecodificar(buffer) {
  let texto;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (_) {
    texto = new TextDecoder('windows-1252').decode(buffer);
  }
  return texto.replace(/^﻿/, '');
}

// Separador más frecuente (fuera de comillas) en la primera línea con contenido.
function bulkDetectarSeparador(texto) {
  let enComillas = false;
  let conContenido = false;
  let puntoYComa = 0;
  let coma = 0;
  for (const ch of texto) {
    if (ch === '"') { enComillas = !enComillas; conContenido = true; continue; }
    if (enComillas) continue;
    if (ch === '\n') {
      if (conContenido) break;
      continue;
    }
    if (ch === ';') puntoYComa++;
    else if (ch === ',') coma++;
    if (ch.trim()) conContenido = true;
  }
  return coma > puntoYComa ? ',' : ';';
}

// Parser CSV (RFC 4180): comillas dobles, comillas escapadas ("") y saltos de
// línea dentro de un valor entrecomillado. Devuelve las filas con contenido y
// el número de línea del fichero en el que empieza cada una.
function bulkParsearCsv(texto, separador) {
  const filas = [];
  let celdas = [];
  let valor = '';
  let enComillas = false;
  let linea = 1;
  let lineaInicio = 1;

  const cerrarFila = () => {
    celdas.push(valor);
    filas.push({ linea: lineaInicio, celdas });
    celdas = [];
    valor = '';
  };

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (enComillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { valor += '"'; i++; }
        else enComillas = false;
      } else if (ch !== '\r') {
        if (ch === '\n') linea++;
        valor += ch;
      }
      continue;
    }
    if (ch === '"') { enComillas = true; continue; }
    if (ch === separador) { celdas.push(valor); valor = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') {
      cerrarFila();
      linea++;
      lineaInicio = linea;
      continue;
    }
    valor += ch;
  }
  if (valor !== '' || celdas.length > 0) cerrarFila();

  return filas
    .map(f => ({ linea: f.linea, celdas: f.celdas.map(c => c.trim()) }))
    .filter(f => f.celdas.some(c => c !== ''));
}

function bulkClaveCabecera(celda) {
  return normalize(celda).replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Columnas de la cabecera, o null si la primera fila no es una cabecera.
function bulkDetectarColumnas(celdas) {
  const columnas = {};
  celdas.forEach((celda, i) => {
    const clave = bulkClaveCabecera(celda);
    for (const [campo, alias] of Object.entries(BULK_COLUMNAS)) {
      if (columnas[campo] === undefined && alias.includes(clave)) columnas[campo] = i;
    }
  });
  return Object.keys(columnas).length > 0 ? columnas : null;
}

// Código, nombre y municipio de una fila. Sin cabecera: una primera columna
// numérica (o que coincide con un código del catálogo) es el código; si no, la
// primera columna es el nombre y la segunda el municipio.
function bulkCamposFila(celdas, columnas, indice) {
  const en = (i) => (i === undefined ? '' : (celdas[i] || '').trim());
  if (columnas) {
    return { codigo: en(columnas.codigo), nombre: en(columnas.nombre), municipio: en(columnas.municipio) };
  }
  const [c0 = '', c1 = '', c2 = ''] = celdas;
  if (/^\d+$/.test(c0) || indice.porCodigo.has(bulkClave(c0))) {
    return { codigo: c0, nombre: c1, municipio: c2 };
  }
  return { codigo: '', nombre: c0, municipio: c1 };
}

// Interpreta el texto del CSV. Devuelve { filas, cabecera, separador } o { error }.
function bulkLeerListado(texto) {
  const separador = bulkDetectarSeparador(texto || '');
  const filas = bulkParsearCsv(texto || '', separador);
  const columnas = filas.length > 0 ? bulkDetectarColumnas(filas[0].celdas) : null;
  if (columnas && columnas.codigo === undefined && columnas.nombre === undefined) {
    return { error: 'La cabecera del fichero no tiene ninguna columna de código ni de nombre de parada.' };
  }
  const datos = columnas ? filas.slice(1) : filas;
  if (datos.length === 0) {
    return { error: 'El fichero no contiene ninguna parada.' };
  }
  if (datos.length > BULK_MAX_PARADAS) {
    return {
      error: `El listado tiene ${datos.length} paradas y el máximo admitido es ${BULK_MAX_PARADAS}. `
        + 'Divide el fichero y genera un documento por cada parte.',
    };
  }
  const indice = bulkIndiceCatalogo();
  return {
    separador,
    cabecera: !!columnas,
    filas: datos.map(f => ({
      linea: f.linea,
      texto: f.celdas.filter(Boolean).join(' · '),
      ...bulkCamposFila(f.celdas, columnas, indice),
    })),
  };
}

/* ─── Resolución contra el catálogo ──────────────────────────────── */

let bulkIndiceCache = null;

// Índices de búsqueda sobre el catálogo publicado (se calculan una vez).
function bulkIndiceCatalogo() {
  if (bulkIndiceCache && bulkIndiceCache.paradas === STATE.data.paradas
      && bulkIndiceCache.municipiosData === STATE.data.municipios) {
    return bulkIndiceCache;
  }
  const porCodigo = new Map();   // código → parada
  const porNombre = new Map();   // nombre (de parada o de agrupación) → Map(área → parada)
  for (const p of STATE.data.paradas) {
    const codigo = bulkClave(p.publicCode);
    if (codigo && !porCodigo.has(codigo)) porCodigo.set(codigo, p);
    const area = areaKeyOfParada(p);
    for (const nombre of new Set([bulkClave(p.stopAreaNombre), bulkClave(p.nombre)])) {
      if (!nombre) continue;
      if (!porNombre.has(nombre)) porNombre.set(nombre, new Map());
      const areas = porNombre.get(nombre);
      if (!areas.has(area)) areas.set(area, p);
    }
  }
  // Municipio por nombre o por código INE ("42_004" o "42004"). Un mismo nombre
  // puede corresponder a varios municipios de provincias distintas.
  const municipios = new Map();
  for (const m of STATE.data.municipios) {
    const id = String(m.id || '');
    for (const clave of new Set([bulkClave(m.nombre), bulkClave(id), bulkClave(id.replace(/_/g, ''))])) {
      if (!clave) continue;
      if (!municipios.has(clave)) municipios.set(clave, new Set());
      municipios.get(clave).add(m.id);
    }
  }
  bulkIndiceCache = {
    paradas: STATE.data.paradas,
    municipiosData: STATE.data.municipios,
    porCodigo,
    porNombre,
    municipios,
  };
  return bulkIndiceCache;
}

function bulkMunicipioNombre(parada) {
  const m = parada?.municipioId ? STATE.indexes.municipioById.get(parada.municipioId) : null;
  return m ? m.nombre : '';
}

function bulkDescribirParada(parada) {
  return [paradaDisplay(parada), bulkMunicipioNombre(parada), parada.publicCode]
    .filter(Boolean).join(' · ');
}

function bulkResolverFila(fila, indice) {
  const noEncontrada = (motivo) => ({ ...fila, estado: 'no_encontrada', motivo });
  const resuelta = (parada, criterio) => ({
    ...fila, estado: 'resuelta', criterio, parada, areaKey: areaKeyOfParada(parada),
  });

  if (fila.codigo) {
    const parada = indice.porCodigo.get(bulkClave(fila.codigo));
    return parada
      ? resuelta(parada, 'código')
      : noEncontrada(`No existe ninguna parada con el código público ${fila.codigo}.`);
  }
  if (!fila.nombre) return noEncontrada('La línea no indica código ni nombre de parada.');

  let municipioIds = null;
  if (fila.municipio) {
    municipioIds = indice.municipios.get(bulkClave(fila.municipio));
    if (!municipioIds) return noEncontrada(`No existe el municipio «${fila.municipio}».`);
  }
  const areas = indice.porNombre.get(bulkClave(fila.nombre));
  const candidatas = areas
    ? Array.from(areas.values()).filter(p => !municipioIds || municipioIds.has(p.municipioId))
    : [];
  if (candidatas.length === 0) {
    return noEncontrada(municipioIds
      ? `No hay ninguna parada «${fila.nombre}» en ${fila.municipio}.`
      : `No hay ninguna parada llamada «${fila.nombre}».`);
  }
  if (candidatas.length > 1) {
    const muestra = candidatas.slice(0, 5).map(bulkDescribirParada).join('; ');
    const resto = candidatas.length > 5 ? ` y ${candidatas.length - 5} más` : '';
    const consejo = municipioIds ? 'Indica el código público.' : 'Añade el municipio o indica el código público.';
    return {
      ...fila,
      estado: 'ambigua',
      candidatos: candidatas,
      motivo: `${candidatas.length} paradas coinciden: ${muestra}${resto}. ${consejo}`,
    };
  }
  return resuelta(candidatas[0], municipioIds ? 'nombre y municipio' : 'nombre');
}

// Clasifica cada línea del listado en resuelta, no encontrada, ambigua o
// repetida (misma agrupación que una línea anterior ya resuelta).
function bulkResolverListado(filas) {
  const indice = bulkIndiceCatalogo();
  const vistas = new Map();   // área → línea del fichero que la incluyó primero
  const items = filas.map((fila) => {
    const r = bulkResolverFila(fila, indice);
    if (r.estado !== 'resuelta') return r;
    if (vistas.has(r.areaKey)) {
      const primera = vistas.get(r.areaKey);
      return { ...r, estado: 'repetida', repiteLinea: primera, motivo: `Misma parada que la línea ${primera}.` };
    }
    vistas.set(r.areaKey, fila.linea);
    return r;
  });
  const con = (estado) => items.filter(i => i.estado === estado);
  return {
    items,
    resueltas: con('resuelta'),
    noEncontradas: con('no_encontrada'),
    ambiguas: con('ambigua'),
    repetidas: con('repetida'),
  };
}

/* ─── Oferta de cada parada ──────────────────────────────────────── */

// Instantánea del criterio temporal en pantalla. Sin búsqueda activa se
// exporta toda la ventana. Devuelve { error } si no se puede aplicar.
function bulkCriterioTemporal() {
  const results = document.getElementById('results');
  const enPantalla = !!results && results.style.display !== 'none';
  if (!enPantalla) {
    return { modo: 'tipoDia', fecha: null, tiposDia: new Set(), label: exportCriterioTemporalLabel('tipoDia', null, null) };
  }
  const modo = STATE.searchMode;
  const fecha = STATE.selectedDate instanceof Date && !Number.isNaN(STATE.selectedDate.getTime())
    ? new Date(STATE.selectedDate.getTime()) : null;
  if (modo === 'dia' && !fecha) {
    return {
      error: 'El modo «Día concreto» está activo sin ningún día seleccionado. '
        + 'Selecciona un día en el calendario o cambia a «Por tipo de día».',
    };
  }
  const tiposDia = new Set(STATE.filters.tiposDia);
  return { modo, fecha, tiposDia, label: exportCriterioTemporalLabel(modo, fecha, tiposDia) };
}

// Mismo filtrado temporal que la búsqueda por parada, sin concesión ni tipo de línea.
function bulkAplicarCriterio(exps, criterio) {
  let lista = exps;
  if (criterio.modo === 'dia') lista = filterExpedicionesPorFecha(lista, criterio.fecha);
  if (criterio.tiposDia.size > 0) {
    lista = lista.filter(e => e.tipoDia
      && criterio.tiposDia.has(cleanMojibake(e.tipoDia.descripcion) || e.tipoDia.id));
  }
  return lista;
}

// Expediciones de cada agrupación en una sola pasada por el catálogo: cada
// expedición se asigna a todas las agrupaciones resueltas por las que pasa.
function bulkCalcularOferta(resueltas, criterio) {
  const areaPorParada = new Map();
  const expsPorArea = new Map();
  for (const item of resueltas) {
    expsPorArea.set(item.areaKey, []);
    for (const id of paradaIdsOfArea(item.parada)) areaPorParada.set(id, item.areaKey);
  }
  for (const e of STATE.data.expediciones) {
    let vistas = null;
    for (const paso of (e.pasos || [])) {
      const area = areaPorParada.get(paso.paradaId);
      if (area === undefined || (vistas && vistas.has(area))) continue;
      (vistas || (vistas = new Set())).add(area);
      expsPorArea.get(area).push(e);
    }
  }
  const ofertas = new Map();
  for (const item of resueltas) {
    ofertas.set(item.areaKey, {
      exps: bulkAplicarCriterio(expsPorArea.get(item.areaKey), criterio),
      targetStops: paradaIdsOfArea(item.parada),
    });
  }
  return ofertas;
}

let bulkOrdenCache = null;

// Posición de rutas y líneas en el catálogo, para listarlas en el mismo orden
// que la búsqueda por parada.
function bulkOrdenCatalogo() {
  if (bulkOrdenCache && bulkOrdenCache.rutasData === STATE.data.rutas
      && bulkOrdenCache.lineasData === STATE.data.lineas) {
    return bulkOrdenCache;
  }
  bulkOrdenCache = {
    rutasData: STATE.data.rutas,
    lineasData: STATE.data.lineas,
    ruta: new Map(STATE.data.rutas.map((r, i) => [r.id, i])),
    linea: new Map(STATE.data.lineas.map((l, i) => [l.id, i])),
  };
  return bulkOrdenCache;
}

function bulkRutasYLineas(exps) {
  const orden = bulkOrdenCatalogo();
  const rutas = Array.from(new Set(exps.map(e => e.rutaId)))
    .map(id => STATE.indexes.rutaById.get(id)).filter(Boolean)
    .sort((a, b) => orden.ruta.get(a.id) - orden.ruta.get(b.id));
  const lineas = Array.from(new Set(rutas.map(r => r.lineaId).filter(Boolean)))
    .map(id => STATE.indexes.lineaById.get(id)).filter(Boolean)
    .sort((a, b) => orden.linea.get(a.id) - orden.linea.get(b.id));
  return { rutas, lineas };
}

/* ─── Documento ──────────────────────────────────────────────────── */

function bulkCederHilo() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function bulkNombreDocumento(nombreFichero) {
  const base = String(nombreFichero || '').replace(/\.[^.]+$/, '');
  const limpio = `Visualizador_oferta_listado_${base}`
    .replace(/[^\w\sáéíóúüñ-]/gi, '').replace(/\s+/g, '_').slice(0, 80);
  return `${limpio || 'Visualizador_oferta_listado'}.doc`;
}

function bulkFilasResumen(pares) {
  return pares.map(([k, v]) => `<tr><td class="k">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join('');
}

// Compone el documento completo. `debeCancelar` permite abortar entre paradas.
async function bulkComponerDocumento({ nombreFichero, resolucion, criterio }, onProgreso = () => {}, debeCancelar = () => false) {
  const resueltas = resolucion.resueltas;
  const total = resueltas.length;
  const noResueltas = [...resolucion.noEncontradas, ...resolucion.ambiguas]
    .sort((a, b) => a.linea - b.linea);

  onProgreso(0, total, 'Calculando la oferta de las paradas…');
  await bulkCederHilo();
  const ofertas = bulkCalcularOferta(resueltas, criterio);

  const secciones = [];
  const filasIndice = [];
  for (let i = 0; i < total; i++) {
    if (debeCancelar()) throw new Error('cancelado');
    const item = resueltas[i];
    const { exps, targetStops } = ofertas.get(item.areaKey);
    const { rutas, lineas } = bulkRutasYLineas(exps);
    const nombre = paradaDisplay(item.parada);
    const municipio = bulkMunicipioNombre(item.parada);
    const ancla = `p${i + 1}`;
    const ident = [item.parada.publicCode ? `Código ${item.parada.publicCode}` : '', municipio]
      .filter(Boolean).join(' · ');

    let seccion = `${BULK_SALTO_PAGINA}
      <p class="secnum">Parada ${i + 1} de ${total}</p>
      <h1><a name="${ancla}"></a>${escapeHtml(nombre)}</h1>
      <p class="ctx">Parada: <b>${escapeHtml(nombre)}</b>${ident ? ' · ' + escapeHtml(ident) : ''}</p>`;
    if (exps.length > 0) {
      seccion += `<p class="meta">${exportResumenOferta(lineas.length, exps)}</p>`
        + exportCuerpoLineas(lineas, rutas, exps, targetStops);
    } else {
      seccion += '<p class="vacio">No hay expediciones que pasen por esta parada con el criterio temporal aplicado.</p>';
    }
    secciones.push(seccion);

    filasIndice.push(`<tr><td class="num">${i + 1}</td>`
      + `<td><a href="#${ancla}">${escapeHtml(nombre)}</a></td>`
      + `<td>${escapeHtml(item.parada.publicCode || '')}</td>`
      + `<td>${escapeHtml(municipio)}</td>`
      + `<td class="num">${lineas.length}</td>`
      + `<td class="num">${exps.length}</td>`
      + `<td class="num">${item.linea}</td></tr>`);

    onProgreso(i + 1, total, `Parada ${i + 1} de ${total}: ${nombre}`);
    if ((i + 1) % 5 === 0 || i + 1 === total) await bulkCederHilo();
  }

  const totalLineas = resolucion.items.length;
  const portada = `
    <h1 class="portada">Visualizador de oferta</h1>
    <p class="subtitulo">Exportación masiva por listado de paradas</p>
    <table class="resumen">${bulkFilasResumen([
      ['Fichero de origen', nombreFichero || '—'],
      ['Líneas del fichero', String(totalLineas)],
      ['Paradas incluidas', String(total)],
      ['No encontradas', String(resolucion.noEncontradas.length)],
      ['Ambiguas', String(resolucion.ambiguas.length)],
      ['Repetidas (incluidas una sola vez)', String(resolucion.repetidas.length)],
      ['Criterio temporal', criterio.label],
      ['Generado el', exportFechaGeneracion()],
    ])}</table>
    <p class="note">Cada parada se exporta con su agrupación completa (todos sus andenes y sentidos). `
    + `El criterio temporal se aplica a todas las paradas; los filtros de concesión y de tipo de línea no se aplican.</p>
    <p class="note">${EXPORT_NOTA_LEYENDA}</p>`;

  const indice = `${BULK_SALTO_PAGINA}
    <h1 class="apartado">Índice de paradas</h1>
    <table class="lista"><thead><tr><th>Nº</th><th>Parada</th><th>Código</th><th>Municipio</th>`
    + `<th>Líneas</th><th>Expediciones</th><th>Línea del fichero</th></tr></thead>
    <tbody>${filasIndice.join('')}</tbody></table>`;

  let apartadoFinal = '';
  if (noResueltas.length > 0) {
    apartadoFinal = `${BULK_SALTO_PAGINA}
      <h1 class="apartado">Líneas del fichero no resueltas</h1>
      <p class="meta">${noResueltas.length} línea(s) del fichero no se han incluido en el documento.</p>
      <table class="lista"><thead><tr><th>Línea</th><th>Contenido</th><th>Situación</th><th>Motivo</th></tr></thead>
      <tbody>${noResueltas.map(i => `<tr><td class="num">${i.linea}</td><td>${escapeHtml(i.texto)}</td>`
        + `<td>${escapeHtml(BULK_ESTADOS[i.estado])}</td><td>${escapeHtml(i.motivo)}</td></tr>`).join('')}</tbody></table>`;
  }

  return buildWordHtml(
    `Visualizador de oferta — Listado ${nombreFichero || ''}`.trim(),
    portada + indice + secciones.join('') + apartadoFinal,
    BULK_ESTILOS_WORD,
  );
}

/* ─── Interfaz: selección del fichero, informe y generación ──────── */

let bulkEstado = null;   // { nombreFichero, listado, resolucion, generando, cancelado }

// Descarga el CSV de ejemplo. Con BOM para que Excel lo abra como UTF-8.
function bulkDescargarEjemplo() {
  const blob = new Blob(['﻿', BULK_CSV_EJEMPLO], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = BULK_CSV_EJEMPLO_NOMBRE;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bulkSeleccionarFichero() {
  const input = document.getElementById('bulkCsvInput');
  if (!input) return;
  input.value = '';
  input.click();
}

async function bulkOnFileSelected(input) {
  const file = input?.files?.[0];
  if (!file) return;
  let texto;
  try {
    texto = bulkDecodificar(await file.arrayBuffer());
  } catch (err) {
    alert(`No se ha podido leer el fichero: ${err.message || err}`);
    return;
  }
  bulkProcesarTexto(texto, file.name);
}

// Interpreta y resuelve el listado y abre el informe previo.
function bulkProcesarTexto(texto, nombreFichero) {
  const listado = bulkLeerListado(texto);
  if (listado.error) {
    alert(listado.error);
    return null;
  }
  bulkEstado = {
    nombreFichero,
    listado,
    resolucion: bulkResolverListado(listado.filas),
    generando: false,
    cancelado: false,
  };
  bulkRenderInforme();
  bulkAbrirModal();
  return bulkEstado;
}

function bulkRenderGrupo(titulo, items, clase, detalle, abierto) {
  if (items.length === 0) return '';
  const filas = items.map(i => `
    <li class="bulk-item">
      <span class="bulk-item-linea">L${i.linea}</span>
      <span class="bulk-item-texto">${escapeHtml(i.texto || '(vacía)')}</span>
      <span class="bulk-item-detalle">${escapeHtml(detalle(i))}</span>
    </li>`).join('');
  return `
    <details class="bulk-grupo ${clase}"${abierto ? ' open' : ''}>
      <summary>${escapeHtml(titulo)} <span class="bulk-grupo-n">${items.length}</span></summary>
      <ul class="bulk-lista">${filas}</ul>
    </details>`;
}

function bulkRenderInforme() {
  if (!bulkEstado) return;
  const { nombreFichero, listado, resolucion } = bulkEstado;
  const r = resolucion;
  const criterio = bulkCriterioTemporal();

  const sub = document.getElementById('bulkModalSubtitle');
  if (sub) {
    sub.textContent = `${nombreFichero || 'Listado'} · ${r.items.length} línea(s)`
      + ` · separador «${listado.separador}»${listado.cabecera ? ' · con cabecera' : ' · sin cabecera'}`;
  }

  const tile = (n, label, clase) => `
    <div class="bulk-tile ${clase}"><div class="num">${n}</div><div class="label">${label}</div></div>`;
  const avisoCriterio = criterio.error
    ? `<p class="bulk-aviso is-error">${escapeHtml(criterio.error)}</p>`
    : `<p class="bulk-aviso">Criterio temporal: <strong>${escapeHtml(criterio.label)}</strong>. `
      + 'Los filtros de concesión y de tipo de línea no se aplican.</p>';
  const avisoGrande = r.resueltas.length >= BULK_CONFIRMAR_DESDE
    ? `<p class="bulk-aviso">El listado tiene ${r.resueltas.length} paradas: se pedirá confirmación antes de generar.</p>`
    : '';

  const body = document.getElementById('bulkModalBody');
  if (body) {
    body.innerHTML = `
      <div class="bulk-tiles">
        ${tile(r.resueltas.length, 'Resueltas', 'is-ok')}
        ${tile(r.noEncontradas.length, 'No encontradas', r.noEncontradas.length ? 'is-error' : '')}
        ${tile(r.ambiguas.length, 'Ambiguas', r.ambiguas.length ? 'is-warn' : '')}
        ${tile(r.repetidas.length, 'Repetidas', '')}
      </div>
      ${avisoCriterio}
      ${avisoGrande}
      ${bulkRenderGrupo('No encontradas', r.noEncontradas, 'is-error', i => i.motivo, true)}
      ${bulkRenderGrupo('Ambiguas', r.ambiguas, 'is-warn', i => i.motivo, true)}
      ${bulkRenderGrupo('Repetidas', r.repetidas, '', i => i.motivo, false)}
      ${bulkRenderGrupo('Resueltas', r.resueltas, 'is-ok',
        i => `${bulkDescribirParada(i.parada)} (por ${i.criterio})`, r.resueltas.length <= 10)}
      ${r.resueltas.length === 0 ? '<p class="bulk-aviso is-error">Ninguna línea del fichero se ha podido resolver. Corrige el fichero y vuelve a cargarlo.</p>' : ''}
    `;
  }

  const summary = document.getElementById('bulkModalSummary');
  if (summary) {
    summary.innerHTML = `<strong>${r.resueltas.length}</strong> parada(s) se incluirán en el documento`;
  }
  const btn = document.getElementById('bulkGenerarBtn');
  if (btn) btn.disabled = r.resueltas.length === 0 || !!criterio.error;
  bulkMostrarProgreso(false);
}

function bulkAbrirModal() {
  document.getElementById('modalBulkExport')?.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function bulkCerrarModal() {
  if (bulkEstado?.generando) {
    bulkEstado.cancelado = true;
    return;
  }
  document.getElementById('modalBulkExport')?.classList.remove('is-open');
  document.body.style.overflow = '';
  bulkEstado = null;
}

function bulkMostrarProgreso(visible) {
  const progreso = document.getElementById('bulkProgress');
  if (progreso) progreso.style.display = visible ? '' : 'none';
  const btn = document.getElementById('bulkGenerarBtn');
  if (btn && visible) btn.disabled = true;
  const recargar = document.getElementById('bulkRecargarBtn');
  if (recargar) recargar.disabled = !!visible;
}

function bulkActualizarProgreso(hechas, total, texto) {
  const barra = document.getElementById('bulkProgressBar');
  const etiqueta = document.getElementById('bulkProgressText');
  if (barra) barra.style.width = `${total > 0 ? Math.round((hechas / total) * 100) : 0}%`;
  if (etiqueta) etiqueta.textContent = texto;
}

async function bulkGenerar() {
  if (!bulkEstado || bulkEstado.generando) return;
  const n = bulkEstado.resolucion.resueltas.length;
  if (n === 0) return;
  const criterio = bulkCriterioTemporal();
  if (criterio.error) {
    alert(criterio.error);
    return;
  }
  if (n >= BULK_CONFIRMAR_DESDE
      && !confirm(`Se va a generar un documento con ${n} paradas, una por página. `
        + 'La generación puede tardar unos segundos. ¿Continuar?')) {
    return;
  }

  const estado = bulkEstado;
  estado.generando = true;
  estado.cancelado = false;
  bulkMostrarProgreso(true);
  try {
    const html = await bulkComponerDocumento(
      { nombreFichero: estado.nombreFichero, resolucion: estado.resolucion, criterio },
      bulkActualizarProgreso,
      () => estado.cancelado,
    );
    downloadDoc(bulkNombreDocumento(estado.nombreFichero), html);
    estado.generando = false;
    bulkCerrarModal();
  } catch (err) {
    estado.generando = false;
    if (err?.message === 'cancelado') {
      bulkCerrarModal();
      return;
    }
    console.error('Fallo en la exportación masiva:', err);
    alert(`No se ha podido generar el documento: ${err.message || err}`);
    bulkRenderInforme();
  }
}

// Cerrar con clic fuera o Escape (si está generando, cancela).
document.getElementById('modalBulkExport')?.addEventListener('click', (e) => {
  if (e.target.id === 'modalBulkExport') bulkCerrarModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('modalBulkExport')?.classList.contains('is-open')) {
    bulkCerrarModal();
  }
});
