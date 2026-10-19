/* ═══════════════════════════════════════════════════════════════════
   ESTADO GLOBAL DE LA APP
   ═══════════════════════════════════════════════════════════════════ */

const STATE = {
  // Datos cargados (referencias a las variables globales del backend)
  data: {
    concesiones: [],
    municipios: [],
    paradas: [],
    lineas: [],
    rutas: [],
    expediciones: [],
    meta: null,
    operadores: [],   // derivados de las concesiones: [{nombre, concesionIds:[], nLineas}]
  },

  // Búsqueda activa
  // Municipios de la búsqueda por municipio, en el orden indicado por el usuario.
  // 1 municipio = toda la oferta que lo toca (comportamiento clásico).
  // 2 o más     = origen → (municipios de paso) → destino, en orden estricto.
  selectedMunicipios: [],

  // Calendario
  calYear: null,
  calMonth: null,
  selectedDate: null,
  daysWithService: new Set(),  // claves 'YYYY-MM-DD' donde sí hay servicio en el municipio

  // Filtros activos
  filters: {
    tiposDia: new Set(),      // ids de tipos de día seleccionados (vacío = todos)
    concesiones: new Set(),   // ids de concesiones seleccionadas (vacío = todas)
    tiposLinea: new Set(),    // etiquetas de tipo de línea seleccionadas (vacío = todas)
    paradaId: null,           // id de parada concreta o null = todas
  },

  // Modo del buscador principal: 'municipio' | 'linea' | 'parada'
  searchTab: 'municipio',
  selectedLinea: null,   // objeto línea cuando se busca por línea
  // Paradas de la búsqueda por parada, en el orden indicado por el usuario.
  // 1 parada  = expediciones que pasan por ella (comportamiento clásico).
  // 2 o más   = origen → (paradas de paso) → destino, respetando el orden estricto.
  selectedParadas: [],
  selectedConcesion: null, // objeto concesión cuando se busca por concesión
  selectedOperador: null,  // objeto operador {nombre, concesionIds, ...} al buscar por operador
  // Modo de búsqueda temporal: 'dia' (un día concreto del calendario) o 'tipoDia' (todos los días)
  searchMode: 'tipoDia',

  // Índices precomputados (rendimiento)
  indexes: {
    paradaById: new Map(),
    paradaIdsByArea: new Map(),  // clave de área → Set de ids de las paradas físicas equivalentes
    reachableParadaIds: new Set(),  // paradas alcanzables sin transbordo tras la cadena actual
    lineaById: new Map(),
    rutaById: new Map(),
    concesionById: new Map(),
    operadorByNombre: new Map(),
    municipioById: new Map(),
    // Estructura del municipio actual:
    currentParadasIds: new Set(),
    currentLineas: [],
    currentRutas: [],
    currentExpediciones: [],
    currentConcesiones: [],
    currentTiposDia: [],
  },

  // UI
  recentSearches: [],
  resultLimit: 200,
};

const RESULT_BATCH_SIZE = 200;

function resetResultLimit() {
  STATE.resultLimit = RESULT_BATCH_SIZE;
}

function limitedExpeditions(expeditions) {
  const all = Array.isArray(expeditions) ? expeditions : [];
  return {
    visible: all.slice(0, STATE.resultLimit),
    total: all.length,
  };
}

function moreResultsHtml(total, visible) {
  if (visible >= total) return '';
  const next = Math.min(RESULT_BATCH_SIZE, total - visible);
  return `
    <div class="results-load-more">
      <span>Mostrando ${visible.toLocaleString('es-ES')} de ${total.toLocaleString('es-ES')} expediciones.</span>
      <button type="button" class="btn-primary" onclick="showMoreResults()">Mostrar ${next.toLocaleString('es-ES')} más</button>
    </div>
  `;
}

function showMoreResults() {
  STATE.resultLimit += RESULT_BATCH_SIZE;
  renderCurrentResults();
}

// Insignia "A demanda" para paradas que solo se atienden bajo petición.
const DEMANDA_BADGE = '<span class="demanda-tag" title="Parada a demanda: solo se atiende si se solicita previamente">A demanda</span>';

const DOW_KEYS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
const MONTH_NAMES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const WEEKDAY_NAMES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const SEARCH_MODE_ORDER = ['municipio', 'linea', 'parada', 'concesion', 'operador'];

function enabledSearchModes() {
  const configured = window.FRONTEND_CONFIG?.searchModes;
  if (!configured || typeof configured !== 'object') return [...SEARCH_MODE_ORDER];

  const enabled = SEARCH_MODE_ORDER.filter(mode => configured[mode] !== false);
  // El backend rechaza una configuración con todos los modos desactivados. Si
  // llega un fichero externo inválido, se mantienen todos para no inutilizar la UI.
  return enabled.length > 0 ? enabled : [...SEARCH_MODE_ORDER];
}

function isSearchModeEnabled(mode) {
  return enabledSearchModes().includes(mode);
}

function configureSearchModes() {
  const enabled = enabledSearchModes();
  document.querySelectorAll('.search-tab').forEach(tab => {
    tab.style.display = enabled.includes(tab.dataset.mode) ? '' : 'none';
  });

  const initialMode = enabled.includes(STATE.searchTab) ? STATE.searchTab : enabled[0];
  setSearchTab(initialMode);
}

// Códigos INE de provincia → nombre.
// Incluye todas las españolas; las que no aparezcan en los datos simplemente no se usarán.
const PROVINCIAS = {
  '01': 'Álava', '02': 'Albacete', '03': 'Alicante', '04': 'Almería',
  '05': 'Ávila', '06': 'Badajoz', '07': 'Illes Balears', '08': 'Barcelona',
  '09': 'Burgos', '10': 'Cáceres', '11': 'Cádiz', '12': 'Castellón',
  '13': 'Ciudad Real', '14': 'Córdoba', '15': 'A Coruña', '16': 'Cuenca',
  '17': 'Girona', '18': 'Granada', '19': 'Guadalajara', '20': 'Gipuzkoa',
  '21': 'Huelva', '22': 'Huesca', '23': 'Jaén', '24': 'León',
  '25': 'Lleida', '26': 'La Rioja', '27': 'Lugo', '28': 'Madrid',
  '29': 'Málaga', '30': 'Murcia', '31': 'Navarra', '32': 'Ourense',
  '33': 'Asturias', '34': 'Palencia', '35': 'Las Palmas', '36': 'Pontevedra',
  '37': 'Salamanca', '38': 'Santa Cruz de Tenerife', '39': 'Cantabria', '40': 'Segovia',
  '41': 'Sevilla', '42': 'Soria', '43': 'Tarragona', '44': 'Teruel',
  '45': 'Toledo', '46': 'Valencia', '47': 'Valladolid', '48': 'Bizkaia',
  '49': 'Zamora', '50': 'Zaragoza', '51': 'Ceuta', '52': 'Melilla',
};

/* ═══════════════════════════════════════════════════════════════════
   1. CARGA INICIAL: detectar si los datos del backend están disponibles
   ═══════════════════════════════════════════════════════════════════ */

function detectData() {
  if (typeof CONCESIONES !== 'undefined') STATE.data.concesiones = CONCESIONES;
  if (typeof MUNICIPIOS !== 'undefined') STATE.data.municipios = MUNICIPIOS;
  if (typeof PARADAS !== 'undefined') STATE.data.paradas = PARADAS;
  if (typeof LINEAS !== 'undefined') STATE.data.lineas = LINEAS;
  if (typeof RUTAS !== 'undefined') STATE.data.rutas = RUTAS;
  if (typeof META !== 'undefined') STATE.data.meta = META;
  if (typeof EXPEDICIONES !== 'undefined') {
    // El sincronizador ya publica cada expedición una sola vez; solo las
    // publicaciones anteriores (sin la marca) se fusionan al cargar.
    STATE.data.expediciones = STATE.data.meta?.expedicionesFusionadas
      ? EXPEDICIONES
      : fusionarExpedicionesDuplicadas(EXPEDICIONES);
  }

  const missingDatasets = [
    ['concesiones', typeof CONCESIONES !== 'undefined'],
    ['municipios', typeof MUNICIPIOS !== 'undefined'],
    ['paradas', typeof PARADAS !== 'undefined'],
    ['lineas', typeof LINEAS !== 'undefined'],
    ['rutas', typeof RUTAS !== 'undefined'],
    ['expediciones', typeof EXPEDICIONES !== 'undefined'],
    ['meta', typeof META !== 'undefined'],
  ].filter(([, loaded]) => !loaded).map(([name]) => `data/${name}`);
  const loadErrors = Array.isArray(window.__dataLoadErrors)
    ? window.__dataLoadErrors
    : [];
  for (const missing of missingDatasets) {
    if (!loadErrors.includes(missing)) loadErrors.push(missing);
  }

  const hasData = loadErrors.length === 0 && STATE.data.municipios.length > 0;
  if (!hasData) {
    showDataWarning();
    return false;
  }

  // Construir índices
  for (const p of STATE.data.paradas) STATE.indexes.paradaById.set(p.id, p);
  for (const l of STATE.data.lineas) STATE.indexes.lineaById.set(l.id, l);
  for (const r of STATE.data.rutas) STATE.indexes.rutaById.set(r.id, r);
  for (const c of STATE.data.concesiones) STATE.indexes.concesionById.set(c.id, c);
  for (const m of STATE.data.municipios) STATE.indexes.municipioById.set(m.id, m);

  buildOperadoresIndex();
  buildParadaAreasIndex();

  return true;
}

/* ─── Áreas de parada ───────────────────────────────────────────────
   Una misma parada del mundo real aparece en los datos como varias paradas
   físicas (andén de ida, andén de vuelta, marquesinas contiguas…) que comparten
   el nombre de stopArea dentro del mismo municipio. La búsqueda por parada
   trabaja con el área completa: así un origen → destino no falla porque el
   usuario haya elegido el andén del sentido contrario.
   ─────────────────────────────────────────────────────────────────── */

function areaKeyOfParada(parada) {
  if (!parada) return '';
  const nombre = normalize(parada.stopAreaNombre || parada.nombre || '');
  if (!nombre) return `#${parada.id}`;   // sin nombre: el área es la parada misma
  return `${nombre}|${parada.municipioId || ''}`;
}

function buildParadaAreasIndex() {
  const byArea = new Map();
  for (const p of STATE.data.paradas) {
    const key = areaKeyOfParada(p);
    if (!byArea.has(key)) byArea.set(key, new Set());
    byArea.get(key).add(p.id);
  }
  STATE.indexes.paradaIdsByArea = byArea;
}

// Ids de todas las paradas físicas equivalentes a la indicada.
function paradaIdsOfArea(parada) {
  if (!parada) return new Set();
  return STATE.indexes.paradaIdsByArea.get(areaKeyOfParada(parada)) || new Set([parada.id]);
}

// ¿Alguna parada del área indicada está en el conjunto de alcanzables?
// Sin conjunto (no hay cadena activa) todas se consideran válidas.
function areaAlcanzable(parada, alcanzables) {
  if (!alcanzables) return true;
  for (const id of paradaIdsOfArea(parada)) {
    if (alcanzables.has(id)) return true;
  }
  return false;
}

// ¿Tiene el municipio alguna parada alcanzable sin transbordo?
function municipioAlcanzable(municipio, alcanzables) {
  if (!alcanzables) return true;
  return (municipio.paradas || []).some(id => alcanzables.has(id));
}

// Paradas por las que las expediciones dadas siguen pasando DESPUÉS del último
// eslabón de la cadena: el conjunto de destinos que aún se pueden encadenar.
function paradasAlcanzablesTras(expediciones, chainSets) {
  const alcanzables = new Set();
  for (const e of expediciones) {
    const idx = matchSecuenciaParadas(e, chainSets);
    if (!idx) continue;
    const pasos = e.pasos || [];
    for (let i = idx[idx.length - 1] + 1; i < pasos.length; i++) alcanzables.add(pasos[i].paradaId);
  }
  return alcanzables;
}

// Agrupa las concesiones por su operador (campo `operador`, "Desconocido" si falta)
// y precalcula el número de líneas de cada operador para el autocompletado.
function buildOperadoresIndex() {
  const lineasPorConcesion = new Map();
  for (const l of STATE.data.lineas) {
    if (!l.concesionId) continue;
    lineasPorConcesion.set(l.concesionId, (lineasPorConcesion.get(l.concesionId) || 0) + 1);
  }

  const porNombre = new Map();
  for (const c of STATE.data.concesiones) {
    const nombre = (c.operador && String(c.operador).trim()) || 'Desconocido';
    if (!porNombre.has(nombre)) {
      porNombre.set(nombre, { nombre, concesionIds: [], nLineas: 0 });
    }
    const op = porNombre.get(nombre);
    op.concesionIds.push(c.id);
    op.nLineas += lineasPorConcesion.get(c.id) || 0;
  }

  STATE.data.operadores = Array.from(porNombre.values())
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  STATE.indexes.operadorByNombre = porNombre;
}

function showDataWarning() {
  const warning = document.getElementById('dataWarning');
  if (!warning) return;

  const errors = Array.isArray(window.__dataLoadErrors) ? window.__dataLoadErrors : [];
  const detail = errors.length > 0
    ? `No se han podido leer: ${errors.map(escapeHtml).join(', ')}.`
    : 'Los ficheros existen, pero no se han encontrado las variables globales de datos.';

  warning.innerHTML = `
    <strong>Aviso:</strong> Los ficheros de datos no se han cargado.
    ${detail}
    Sirve esta web desde la carpeta <code>html/</code> con
    <code>python -m http.server 8080</code> y abre
    <code>http://localhost:8080/index.html</code>.
    Si estabas viendo la versión anterior, recarga sin caché con <code>Ctrl+F5</code>.
  `;
  warning.style.display = 'block';
}

function injectMeta() {
  // El subtítulo del hero se ha retirado a petición del cliente; no se inyecta texto.
}

// Colapsa la cabecera/buscador al lanzar una búsqueda (se puede reabrir con el
// chevron del hero). Da más espacio a los resultados.
function collapseHero() {
  document.getElementById('hero')?.classList.add('is-collapsed');
}

/* ═══════════════════════════════════════════════════════════════════
   2. AUTOCOMPLETADO DE MUNICIPIOS
   ═══════════════════════════════════════════════════════════════════ */

// Cambia la pestaña del buscador principal
function setSearchTab(mode) {
  if (!isSearchModeEnabled(mode)) return;
  STATE.searchTab = mode;
  document.querySelectorAll('.search-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
  const input = document.getElementById('municipioInput');
  const placeholders = {
    municipio: 'Escribe un municipio… (añade otro para origen → destino)',
    linea: 'Escribe código o nombre de línea…',
    parada: 'Escribe una parada… (añade otra para origen → destino)',
    concesion: 'Escribe código o nombre de concesión…',
    operador: 'Escribe el nombre del operador…',
  };
  if (input) input.placeholder = placeholders[mode] || '';
  if (input) input.value = '';
  document.getElementById('autocomplete').classList.remove('is-open');
  const clearBtn = document.getElementById('searchClear');
  if (clearBtn) clearBtn.classList.remove('is-visible');
  // Mostrar/ocultar filtro de parada en resultados según modo
  const pg = document.getElementById('fg-parada');
  if (pg) pg.style.display = (mode === 'linea' || mode === 'concesion' || mode === 'operador') ? 'none' : '';

  // Actualizar el texto del estado vacío según el modo
  const emptyTexts = {
    municipio: {
      title: 'Empieza buscando un municipio (o un origen y un destino)',
      desc: 'Escribe el nombre de cualquier municipio disponible y verás todas las líneas que pasan por sus paradas. Añade un segundo municipio para buscar origen → destino, y los que quieras entre medias como municipios de paso: solo se muestran los viajes directos que los recorren en ese orden.',
    },
    linea: {
      title: 'Busca una línea',
      desc: 'Escribe el código o el nombre de una línea (por ejemplo "L-001" o "CENTRO-ESTACIÓN"). Verás todas sus expediciones agrupadas por trayecto.',
    },
    parada: {
      title: 'Busca una parada (o un origen y un destino)',
      desc: 'Escribe el nombre o el código público de una parada y verás todas las expediciones que pasan por ella. Añade una segunda parada para buscar origen → destino, y las que quieras entre medias como paradas de paso: solo se muestran los viajes directos que las recorren en ese orden.',
    },
    concesion: {
      title: 'Busca una concesión',
      desc: 'Escribe el código o el nombre de una concesión (por ejemplo "CON-001"). Verás todas sus líneas con sus expediciones agrupadas por trayecto.',
    },
    operador: {
      title: 'Busca un operador',
      desc: 'Escribe el nombre de un operador concesionario. Verás toda su oferta: las líneas de todas sus concesiones con sus expediciones agrupadas por trayecto.',
    },
  };
  const texts = emptyTexts[mode];
  if (texts) {
    const t = document.getElementById('emptyStateTitle');
    const d = document.getElementById('emptyStateDesc');
    if (t) t.textContent = texts.title;
    if (d) d.textContent = texts.desc;
  }

  // Cada cadena pertenece a su pestaña: al cambiar de modo se vacían las dos.
  STATE.selectedParadas = [];
  STATE.selectedMunicipios = [];
  renderSearchChain();
  // Exportación masiva por listado de paradas (js/bulk-export.js, EVO13).
  if (typeof updateBulkStopExportVisibility === 'function') updateBulkStopExportVisibility();
}

function clearSearchInput() {
  const input = document.getElementById('municipioInput');
  const ac = document.getElementById('autocomplete');
  if (input) { input.value = ''; input.focus(); }
  if (ac) ac.classList.remove('is-open');
  document.getElementById('searchClear').classList.remove('is-visible');
}

function setupAutocomplete() {
  const input = document.getElementById('municipioInput');
  const ac = document.getElementById('autocomplete');
  const clearBtn = document.getElementById('searchClear');
  let highlighted = -1;

  // Mostrar/ocultar botón de limpiar según el contenido del input
  function updateClearBtn() {
    clearBtn.classList.toggle('is-visible', input.value.length > 0);
  }

  function getMatches(query) {
    const q = normalize(query);
    if (q.length < 1) return [];
    if (STATE.searchTab === 'linea') {
      return STATE.data.lineas
        .filter(l => normalize(l.codigo).includes(q) || normalize(l.nombre).includes(q))
        .sort((a, b) => {
          const aCode = normalize(a.codigo).startsWith(q);
          const bCode = normalize(b.codigo).startsWith(q);
          const aName = normalize(a.nombre).startsWith(q);
          const bName = normalize(b.nombre).startsWith(q);
          if ((aCode || aName) && !(bCode || bName)) return -1;
          if (!(aCode || aName) && (bCode || bName)) return 1;
          return a.nombre.localeCompare(b.nombre, 'es');
        })
        .slice(0, 12);
    }
    if (STATE.searchTab === 'concesion') {
      return STATE.data.concesiones
        .filter(c => normalize(c.id).includes(q) || normalize(c.nombre || '').includes(q))
        .sort((a, b) => {
          const aS = normalize(a.id).startsWith(q) || normalize(a.nombre || '').startsWith(q);
          const bS = normalize(b.id).startsWith(q) || normalize(b.nombre || '').startsWith(q);
          if (aS && !bS) return -1;
          if (!aS && bS) return 1;
          return (a.nombre || a.id).localeCompare(b.nombre || b.id, 'es');
        })
        .slice(0, 12);
    }
    if (STATE.searchTab === 'operador') {
      return STATE.data.operadores
        .filter(o => normalize(o.nombre).includes(q))
        .sort((a, b) => {
          const aS = normalize(a.nombre).startsWith(q);
          const bS = normalize(b.nombre).startsWith(q);
          if (aS && !bS) return -1;
          if (!aS && bS) return 1;
          return a.nombre.localeCompare(b.nombre, 'es');
        })
        .slice(0, 12);
    }
    if (STATE.searchTab === 'parada') {
      // Buscar por nombre de parada, nombre de stopArea o publicCode
      const candidatas = STATE.data.paradas.filter(p => {
        const nom = normalize(p.nombre || '');
        const area = normalize(p.stopAreaNombre || '');
        const code = normalize(p.publicCode || '');
        return nom.includes(q) || area.includes(q) || code.includes(q);
      });
      // Si ya hay paradas en la cadena, las que se pueden alcanzar sin transbordo
      // desde la última se muestran primero (las demás siguen apareciendo).
      const alcanzables = paradaSearchActive() ? STATE.indexes.reachableParadaIds : null;
      const rango = new Map(candidatas.map(p => [p.id, areaAlcanzable(p, alcanzables) ? 0 : 1]));
      return candidatas
        .sort((a, b) => {
          const ra = rango.get(a.id);
          const rb = rango.get(b.id);
          if (ra !== rb) return ra - rb;
          const an = normalize(a.stopAreaNombre || a.nombre || '');
          const bn = normalize(b.stopAreaNombre || b.nombre || '');
          const aS = an.startsWith(q);
          const bS = bn.startsWith(q);
          if (aS && !bS) return -1;
          if (!aS && bS) return 1;
          return an.localeCompare(bn, 'es');
        })
        .slice(0, 12);
    }
    // modo municipio
    // Con una cadena activa, los municipios alcanzables sin transbordo primero.
    const alcanzablesMun = municipioSearchActive() ? STATE.indexes.reachableParadaIds : null;
    const munCandidatos = STATE.data.municipios.filter(m => normalize(m.nombre).includes(q));
    const rangoMun = new Map(munCandidatos.map(m =>
      [m.id, municipioAlcanzable(m, alcanzablesMun) ? 0 : 1]));
    return munCandidatos
      .sort((a, b) => {
        const ra = rangoMun.get(a.id);
        const rb = rangoMun.get(b.id);
        if (ra !== rb) return ra - rb;
        const aStarts = normalize(a.nombre).startsWith(q);
        const bStarts = normalize(b.nombre).startsWith(q);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.nombre.localeCompare(b.nombre, 'es');
      })
      .slice(0, 12);
  }

  function renderItem(item) {
    if (STATE.searchTab === 'linea') {
      const conc = STATE.indexes.concesionById.get(item.concesionId);
      const concLabel = conc ? prettyConcesionName(conc.nombre) : '';
      const tipo = item.tipoLinea ? tipoLineaLabel(item) : '';
      const meta = [concLabel, tipo].filter(Boolean).join(' · ');
      return `
        <div class="ac-item" data-linea-id="${escapeAttr(item.id)}" data-index="0">
          <span class="ac-name">${escapeHtml(item.codigo)} — ${escapeHtml(item.nombre)}</span>
          ${meta ? `<span class="ac-meta">${escapeHtml(meta)}</span>` : ''}
        </div>
      `;
    }
    if (STATE.searchTab === 'parada') {
      const display = paradaDisplay(item);
      const muni = item.municipioId ? STATE.indexes.municipioById.get(item.municipioId) : null;
      const muniNombre = muni ? muni.nombre : '';
      const alcanzables = paradaSearchActive() ? STATE.indexes.reachableParadaIds : null;
      const aviso = areaAlcanzable(item, alcanzables) ? '' : 'sin viaje directo';
      const sub = [item.publicCode, muniNombre, aviso].filter(Boolean).join(' · ');
      // Si el nombre propio difiere del área, mostrarlo como aclaración
      const aclaracion = (item.stopAreaNombre && item.nombre && item.stopAreaNombre !== item.nombre)
        ? `<span class="ac-sub">${escapeHtml(item.nombre)}</span>` : '';
      return `
        <div class="ac-item" data-parada-id="${escapeAttr(item.id)}" data-index="0">
          <span class="ac-name">${escapeHtml(display)}${aclaracion}</span>
          <span class="ac-meta">${escapeHtml(sub)}</span>
        </div>
      `;
    }
    if (STATE.searchTab === 'concesion') {
      const nLineas = STATE.data.lineas.filter(l => l.concesionId === item.id).length;
      const label = prettyConcesionName(item.nombre) || item.id;
      return `
        <div class="ac-item" data-conc-id="${escapeAttr(item.id)}" data-index="0">
          <span class="ac-name">${escapeHtml(label)}</span>
          <span class="ac-meta">${nLineas} línea${nLineas !== 1 ? 's' : ''}</span>
        </div>
      `;
    }
    if (STATE.searchTab === 'operador') {
      const nConc = item.concesionIds.length;
      const meta = `${nConc} concesión${nConc !== 1 ? 'es' : ''} · ${item.nLineas} línea${item.nLineas !== 1 ? 's' : ''}`;
      return `
        <div class="ac-item" data-operador="${escapeAttr(item.nombre)}" data-index="0">
          <span class="ac-name">${escapeHtml(item.nombre)}</span>
          <span class="ac-meta">${meta}</span>
        </div>
      `;
    }
    const alcanzablesMun = municipioSearchActive() ? STATE.indexes.reachableParadaIds : null;
    const avisoMun = municipioAlcanzable(item, alcanzablesMun) ? '' : ' · sin viaje directo';
    return `
      <div class="ac-item" data-mun-id="${escapeAttr(item.id)}" data-index="0">
        <span class="ac-name">${escapeHtml(item.nombre)}</span>
        <span class="ac-meta">${item.paradas.length} parada${item.paradas.length === 1 ? '' : 's'}${avisoMun}</span>
      </div>
    `;
  }

  function selectItem(el) {
    if (STATE.searchTab === 'linea') {
      const linea = STATE.indexes.lineaById.get(el.dataset.lineaId);
      if (!linea) return;
      input.value = linea.nombre || linea.codigo;
      ac.classList.remove('is-open');
      runSearchLinea(linea);
    } else if (STATE.searchTab === 'parada') {
      const parada = STATE.indexes.paradaById.get(el.dataset.paradaId);
      if (!parada) return;
      // La parada pasa a la cadena y el input queda vacío, listo para añadir la
      // siguiente (origen → paso → destino). La cadena es la que muestra la selección.
      input.value = '';
      ac.classList.remove('is-open');
      updateClearBtn();
      addParadaToChain(parada);
    } else if (STATE.searchTab === 'concesion') {
      const conc = STATE.indexes.concesionById.get(el.dataset.concId);
      if (!conc) return;
      input.value = prettyConcesionName(conc.nombre) || conc.id;
      ac.classList.remove('is-open');
      updateClearBtn();
      runSearchConcesion(conc);
    } else if (STATE.searchTab === 'operador') {
      const operador = STATE.indexes.operadorByNombre.get(el.dataset.operador);
      if (!operador) return;
      input.value = operador.nombre;
      ac.classList.remove('is-open');
      updateClearBtn();
      runSearchOperador(operador);
    } else {
      selectMunicipio(el.dataset.munId);
    }
  }

  function render(query) {
    const matches = getMatches(query);
    const q = normalize(query);
    if (matches.length === 0) {
      ac.innerHTML = q ? '<div class="ac-empty">Sin resultados</div>' : '';
      ac.classList.toggle('is-open', q.length >= 1);
      return;
    }
    ac.innerHTML = matches.map((m, i) => renderItem(m).replace('data-index="0"', `data-index="${i}"`)).join('');
    ac.classList.add('is-open');
    highlighted = -1;
    ac.querySelectorAll('.ac-item').forEach(el => {
      el.addEventListener('mousedown', e => { e.preventDefault(); selectItem(el); });
    });
  }

  input.addEventListener('input', () => { render(input.value); updateClearBtn(); });
  input.addEventListener('focus', () => { if (input.value) render(input.value); updateClearBtn(); });
  input.addEventListener('blur', () => { setTimeout(() => ac.classList.remove('is-open'), 150); });
  input.addEventListener('keydown', e => {
    const items = ac.querySelectorAll('.ac-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlighted = Math.min(items.length - 1, highlighted + 1);
      items.forEach((el, i) => el.classList.toggle('is-highlighted', i === highlighted));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlighted = Math.max(0, highlighted - 1);
      items.forEach((el, i) => el.classList.toggle('is-highlighted', i === highlighted));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = highlighted >= 0 ? items[highlighted] : items[0];
      if (item) selectItem(item);
      else triggerSearch();
    } else if (e.key === 'Escape') {
      ac.classList.remove('is-open');
    }
  });
}

function selectMunicipio(munId) {
  const mun = STATE.indexes.municipioById.get(munId);
  if (!mun) return;
  // El municipio pasa a la cadena y el input queda listo para el siguiente.
  const input = document.getElementById('municipioInput');
  if (input) input.value = '';
  document.getElementById('autocomplete').classList.remove('is-open');
  document.getElementById('searchClear')?.classList.remove('is-visible');
  addMunicipioToChain(mun);
}

function triggerSearch() {
  if (STATE.searchTab === 'linea') { triggerSearchLinea(); return; }
  if (STATE.searchTab === 'parada') { triggerSearchParada(); return; }
  if (STATE.searchTab === 'concesion') { triggerSearchConcesion(); return; }
  if (STATE.searchTab === 'operador') { triggerSearchOperador(); return; }
  const input = document.getElementById('municipioInput');
  const query = (input?.value || '').trim();
  if (!query) {
    // Sin texto pendiente: "Consultar" relanza la búsqueda de la cadena actual.
    if (STATE.selectedMunicipios.length > 0) runSearchMunicipios(STATE.selectedMunicipios);
    return;
  }
  const q = normalize(query);
  let mun = STATE.data.municipios.find(m => normalize(m.nombre) === q);
  if (!mun) mun = STATE.data.municipios.find(m => normalize(m.nombre).includes(q));
  if (!mun) { alert('No se encontró ningún municipio con ese nombre.'); return; }
  if (input) input.value = '';
  document.getElementById('searchClear')?.classList.remove('is-visible');
  addMunicipioToChain(mun);
}

function triggerSearchParada() {
  const input = document.getElementById('municipioInput');
  const query = (input?.value || '').trim();
  if (!query) {
    // Sin texto pendiente: "Consultar" relanza la búsqueda de la cadena actual.
    if (STATE.selectedParadas.length > 0) runSearchParadas(STATE.selectedParadas);
    return;
  }
  const q = normalize(query);
  let parada = STATE.data.paradas.find(p =>
    normalize(p.publicCode || '') === q || normalize(p.nombre || '') === q || normalize(p.stopAreaNombre || '') === q
  );
  if (!parada) parada = STATE.data.paradas.find(p =>
    normalize(p.publicCode || '').includes(q) || normalize(p.nombre || '').includes(q) || normalize(p.stopAreaNombre || '').includes(q)
  );
  if (!parada) { alert('No se encontró ninguna parada con ese código o nombre.'); return; }
  if (input) input.value = '';
  document.getElementById('searchClear')?.classList.remove('is-visible');
  addParadaToChain(parada);
}

/* ═══════════════════════════════════════════════════════════════════
   3c. BÚSQUEDA POR PARADA (una parada de paso, u origen → destino)
   ═══════════════════════════════════════════════════════════════════ */

// ¿Hay una búsqueda por parada activa?
function paradaSearchActive() {
  return STATE.selectedParadas.length > 0;
}

// Áreas (Set de ids) de las paradas seleccionadas, en el orden indicado.
function selectedParadaAreaSets() {
  return STATE.selectedParadas.map(paradaIdsOfArea);
}

// Índices de los pasos en los que la expedición recorre las áreas indicadas en
// orden estricto, o null si no cumple la secuencia. Búsqueda voraz: para cada
// área se toma el primer paso posible tras la anterior, que es suficiente para
// decidir si la subsecuencia existe.
function matchSecuenciaParadas(exp, areaSets) {
  if (!areaSets || areaSets.length === 0) return null;
  const pasos = exp.pasos || [];
  const indices = [];
  let desde = 0;
  for (const set of areaSets) {
    let encontrado = -1;
    for (let i = desde; i < pasos.length; i++) {
      if (set.has(pasos[i].paradaId)) { encontrado = i; break; }
    }
    if (encontrado === -1) return null;
    indices.push(encontrado);
    desde = encontrado + 1;
  }
  return indices;
}

/* ─── Cadena de paradas del buscador ─── */

// Añade una parada al final de la cadena y relanza la búsqueda.
function addParadaToChain(parada) {
  if (!parada) return;
  const ultima = STATE.selectedParadas[STATE.selectedParadas.length - 1];
  // Repetir la misma área justo detrás de sí misma no aporta nada al filtro.
  if (ultima && areaKeyOfParada(ultima) === areaKeyOfParada(parada)) return;
  runSearchParadas([...STATE.selectedParadas, parada]);
}

function removeParadaFromChain(index) {
  const resto = STATE.selectedParadas.filter((_, i) => i !== index);
  if (resto.length === 0) { clearParadasChain(); return; }
  runSearchParadas(resto);
}

// Mueve una parada dentro de la cadena (dir = -1 antes, +1 después).
function moveParadaInChain(index, dir) {
  const lista = [...STATE.selectedParadas];
  const destino = index + dir;
  if (destino < 0 || destino >= lista.length) return;
  [lista[index], lista[destino]] = [lista[destino], lista[index]];
  runSearchParadas(lista);
}

// Deja los índices del contexto actual vacíos y vuelve al estado inicial.
function resetCurrentResults() {
  STATE.indexes.currentExpediciones = [];
  STATE.indexes.currentRutas = [];
  STATE.indexes.currentLineas = [];
  STATE.indexes.currentConcesiones = [];
  STATE.indexes.currentTiposDia = [];
  STATE.indexes.currentParadasIds = new Set();
  STATE.indexes.reachableParadaIds = new Set();
  const empty = document.getElementById('emptyState');
  const results = document.getElementById('results');
  if (empty) empty.style.display = '';
  if (results) results.style.display = 'none';
  document.getElementById('hero')?.classList.remove('is-collapsed');
}

// Vacía la cadena de paradas y vuelve al estado inicial (sin resultados).
function clearParadasChain() {
  STATE.selectedParadas = [];
  resetCurrentResults();
  renderSearchChain();
  renderRecentSearches();
}

/* ─── Cadena de búsqueda (chips bajo el buscador) ────────────────────
   La misma pieza sirve a los dos modos que admiten encadenar: paradas y
   municipios. Los botones de los chips llaman a los despachadores de abajo,
   que resuelven a qué cadena aplican según la pestaña activa.
   ─────────────────────────────────────────────────────────────────── */

// Descriptor de la cadena de la pestaña activa, o null si esta no admite cadena.
function activeChain() {
  if (STATE.searchTab === 'parada') {
    return {
      items: STATE.selectedParadas,
      unidad: 'parada',
      label: (p) => paradaDisplay(p),
      title: (p) => {
        const muni = p.municipioId ? STATE.indexes.municipioById.get(p.municipioId) : null;
        return [paradaTitle(p) || paradaDisplay(p), muni ? muni.nombre : '', p.publicCode]
          .filter(Boolean).join(' · ');
      },
    };
  }
  if (STATE.searchTab === 'municipio') {
    return {
      items: STATE.selectedMunicipios,
      unidad: 'municipio',
      label: (m) => m.nombre,
      title: (m) => {
        const prov = PROVINCIAS[m.provincia] || m.provincia || '';
        return [m.nombre, prov ? `Provincia de ${prov}` : '',
          `${(m.paradas || []).length} paradas`].filter(Boolean).join(' · ');
      },
    };
  }
  return null;
}

function chainMove(index, dir) {
  if (STATE.searchTab === 'municipio') moveMunicipioInChain(index, dir);
  else moveParadaInChain(index, dir);
}

function chainRemove(index) {
  if (STATE.searchTab === 'municipio') removeMunicipioFromChain(index);
  else removeParadaFromChain(index);
}

function chainClear() {
  if (STATE.searchTab === 'municipio') clearMunicipiosChain();
  else clearParadasChain();
}

// Reabre el buscador y deja el foco listo para añadir otro eslabón a la cadena.
function chainFocusInput() {
  document.getElementById('hero')?.classList.remove('is-collapsed');
  const input = document.getElementById('municipioInput');
  if (input) { input.value = ''; input.focus(); }
}

function renderSearchChain() {
  const wrap = document.getElementById('stopsChain');
  if (!wrap) return;
  const chain = activeChain();
  if (!chain || chain.items.length === 0) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }

  const items = chain.items;
  const total = items.length;
  const plural = chain.unidad === 'municipio' ? 'municipios' : 'paradas';
  const rolOf = (i) => {
    if (total === 1) return chain.unidad === 'municipio' ? 'Municipio' : 'Paso por';
    if (i === 0) return 'Origen';
    if (i === total - 1) return 'Destino';
    return `Paso ${i}`;
  };
  const claseOf = (i) => {
    if (total === 1) return 'is-single';
    if (i === 0) return 'is-origen';
    if (i === total - 1) return 'is-destino';
    return 'is-intermedia';
  };

  const chips = items.map((item, i) => {
    const nombre = chain.label(item);
    return `
      ${i > 0 ? '<span class="stop-chain-arrow" aria-hidden="true">→</span>' : ''}
      <span class="stop-chip ${claseOf(i)}" title="${escapeAttr(chain.title(item))}">
        <span class="stop-chip-rol">${escapeHtml(rolOf(i))}</span>
        <span class="stop-chip-text">${escapeHtml(truncate(nombre, 26))}</span>
        <button type="button" class="stop-chip-btn" title="Mover antes"
          onclick="chainMove(${i}, -1)" ${i === 0 ? 'disabled' : ''}>&lsaquo;</button>
        <button type="button" class="stop-chip-btn" title="Mover después"
          onclick="chainMove(${i}, 1)" ${i === total - 1 ? 'disabled' : ''}>&rsaquo;</button>
        <button type="button" class="stop-chip-remove" title="Quitar de la búsqueda"
          onclick="chainRemove(${i})" aria-label="Quitar ${escapeAttr(nombre)}">&times;</button>
      </span>
    `;
  }).join('');

  const hint = total === 1
    ? `Añade otro ${chain.unidad} para buscar origen → destino`
    : `${total} ${plural} en orden · solo viajes directos`;

  wrap.style.display = '';
  wrap.innerHTML = `
    <span class="quick-label">Recorrido</span>
    ${chips}
    <button type="button" class="stops-chain-add" onclick="chainFocusInput()"
      title="Añadir otro ${chain.unidad} al final del recorrido">+ Añadir ${chain.unidad}</button>
    <span class="stops-chain-hint">${escapeHtml(hint)}</span>
    <button type="button" class="recent-clear" onclick="chainClear()">Vaciar</button>
  `;
}

// Lanza la búsqueda para la cadena de paradas indicada (1 = paso por ella,
// 2 o más = origen → … → destino en orden estricto).
function runSearchParadas(paradas) {
  const lista = (paradas || []).filter(Boolean);
  if (lista.length === 0) { clearParadasChain(); return; }

  STATE.selectedParadas = lista;
  STATE.selectedLinea = null;
  STATE.selectedMunicipios = [];
  STATE.selectedConcesion = null;
  STATE.selectedOperador = null;
  if (lista.length === 1) addToRecentSearches('parada', lista[0].id);
  else addToRecentSearches('paradas', lista.map(p => p.id).join(RECENT_CHAIN_SEP));
  STATE.filters.tiposDia = new Set();
  STATE.filters.concesiones = new Set();
  STATE.filters.tiposLinea = new Set();
  STATE.filters.paradaId = null;
  resetResultLimit();

  const areaSets = selectedParadaAreaSets();

  // Expediciones que pasan por todas las paradas indicadas, en orden
  // (con una sola parada equivale a "pasa por ella").
  const exps = STATE.data.expediciones.filter(e => matchSecuenciaParadas(e, areaSets) !== null);

  // Paradas a las que se puede seguir viajando sin transbordo desde la última de
  // la cadena: el autocompletado las prioriza al añadir el siguiente destino.
  STATE.indexes.reachableParadaIds = paradasAlcanzablesTras(exps, areaSets);

  // Rutas que contienen esta parada
  const rutaIds = new Set(exps.map(e => e.rutaId));
  const rutas = STATE.data.rutas.filter(r => rutaIds.has(r.id));

  // Líneas
  const lineaIds = new Set(rutas.map(r => r.lineaId).filter(Boolean));
  const lineas = STATE.data.lineas.filter(l => lineaIds.has(l.id));

  // Tipos de día agrupados
  const tipoDiaMap = new Map();
  for (const e of exps) {
    const td = e.tipoDia;
    if (!td || !td.id) continue;
    const desc = cleanMojibake(td.descripcion) || td.id;
    if (!tipoDiaMap.has(desc)) {
      tipoDiaMap.set(desc, { id: desc, descripcion: desc, diasSemana: td.diasSemana, tipoDiaIds: new Set(), concesionIds: new Set(), count: 0 });
    }
    const g = tipoDiaMap.get(desc);
    g.tipoDiaIds.add(td.id);
    const lin = STATE.indexes.lineaById.get(e.lineaId);
    if (lin?.concesionId) g.concesionIds.add(lin.concesionId);
    g.count++;
  }

  STATE.indexes.currentTiposDia = Array.from(tipoDiaMap.values()).sort((a, b) => b.count - a.count);
  STATE.indexes.currentExpediciones = exps;
  STATE.indexes.currentRutas = rutas;
  STATE.indexes.currentLineas = lineas;
  STATE.indexes.currentConcesiones = STATE.data.concesiones.filter(c => exps.some(e => e.concesionId === c.id));
  // Todas las paradas físicas de las áreas buscadas: son las que se resaltan en
  // el recorrido y en la exportación a Word.
  STATE.indexes.currentParadasIds = new Set(areaSets.flatMap(s => Array.from(s)));

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('results').style.display = 'block';
  collapseHero();

  const fgTipoDia = document.getElementById('fg-tipodia');
  if (fgTipoDia) fgTipoDia.style.display = STATE.searchMode === 'dia' ? 'none' : '';
  const pg = document.getElementById('fg-parada');
  if (pg) pg.style.display = 'none'; // filtro por parada no aplica (ya son el criterio de búsqueda)
  const fcParada = document.getElementById('fg-concesion');
  if (fcParada) fcParada.style.display = ''; // restaurar si venía de modo concesión

  renderSearchChain();
  renderHeaderParadas(lista, exps, rutas, lineas);
  renderSidebar();
  buildDaysWithService();
  initCalendarForMunicipio();
  renderParadaExpediciones(rutas, exps);
  renderActiveFiltersChips();
}

// Etiqueta corta del recorrido buscado: "PARADA" o "ORIGEN → DESTINO".
function paradasChainLabel(paradas = STATE.selectedParadas) {
  if (paradas.length === 0) return '—';
  if (paradas.length === 1) return paradaDisplay(paradas[0]);
  return `${paradaDisplay(paradas[0])} → ${paradaDisplay(paradas[paradas.length - 1])}`;
}

function renderHeaderParadas(paradas, exps, rutas, lineas) {
  const multi = paradas.length >= 2;
  const primera = paradas[0];
  const muni = primera?.municipioId ? STATE.indexes.municipioById.get(primera.municipioId) : null;

  const idsBuscados = new Set(paradas.flatMap(p => Array.from(paradaIdsOfArea(p))));
  const esDemanda = rutas.some(r =>
    (r.paradas || []).some(p => idsBuscados.has(p.paradaId) && p.aDemanda)
  );

  const intermedias = multi ? paradas.slice(1, -1) : [];
  const sub = multi
    ? [
        `Origen: ${paradaDisplay(paradas[0])}`,
        `Destino: ${paradaDisplay(paradas[paradas.length - 1])}`,
        intermedias.length
          ? `Vía ${intermedias.map(paradaDisplay).join(' · ')}`
          : '',
        `${lineas.length} línea${lineas.length !== 1 ? 's' : ''}`,
        `${exps.length} viaje${exps.length !== 1 ? 's' : ''} directo${exps.length !== 1 ? 's' : ''}`,
      ]
    : [
        primera?.publicCode,
        muni ? muni.nombre : '',
        `${lineas.length} línea${lineas.length !== 1 ? 's' : ''}`,
        `${exps.length} expedición${exps.length !== 1 ? 'es' : ''}`,
        esDemanda ? 'A demanda' : '',
      ];

  const h = document.getElementById('resultsTitle');
  const s = document.getElementById('resultsSubtitle');
  if (h) h.textContent = paradasChainLabel(paradas);
  if (s) s.textContent = sub.filter(Boolean).join(' · ');

  const mL = document.getElementById('metaLineas');
  const mP = document.getElementById('metaParadas');
  const mC = document.getElementById('metaConcesiones');
  if (mL) mL.textContent = lineas.length;
  if (mP) mP.textContent = paradas.length;
  if (mC) mC.textContent = STATE.indexes.currentConcesiones.length;

  const bannerDay = document.getElementById('bannerDay');
  const bannerExp = document.getElementById('bannerExpeds');
  if (bannerDay) bannerDay.textContent = paradasChainLabel(paradas);
  if (bannerExp) bannerExp.textContent = `${exps.length} expediciones`;
}

function filteredExpedicionesParada() {
  let list = STATE.indexes.currentExpediciones;
  if (STATE.searchMode === 'dia') list = filterExpedicionesPorFecha(list, STATE.selectedDate);
  if (STATE.filters.tiposDia.size > 0) {
    list = list.filter(e => {
      const td = e.tipoDia;
      if (!td) return false;
      return STATE.filters.tiposDia.has(cleanMojibake(td.descripcion) || td.id);
    });
  }
  if (STATE.filters.concesiones.size > 0) {
    list = list.filter(e => STATE.filters.concesiones.has(e.concesionId));
  }
  if (STATE.filters.tiposLinea.size > 0) {
    list = list.filter(e => STATE.filters.tiposLinea.has(tipoLineaOfExp(e)));
  }
  return list;
}

function renderParadaExpediciones(rutas, _expsAll) {
  const container = document.getElementById('linesContainer');
  if (!container) return;

  const allExps = paradaSearchActive() ? filteredExpedicionesParada() : _expsAll;
  const { visible: exps, total: totalExps } = limitedExpeditions(allExps);
  const areaSets = selectedParadaAreaSets();

  const bannerExp = document.getElementById('bannerExpeds');
  if (bannerExp) bannerExp.textContent = `${totalExps} expediciones`;

  // Agrupar por ruta, y dentro ordenar por hora de salida
  const expsByRuta = new Map();
  for (const e of exps) {
    if (!expsByRuta.has(e.rutaId)) expsByRuta.set(e.rutaId, []);
    expsByRuta.get(e.rutaId).push(e);
  }

  if (exps.length === 0) {
    const msg = areaSets.length >= 2
      ? 'No hay ningún viaje directo que recorra esas paradas en ese orden con los filtros seleccionados. Prueba a quitar paradas de paso, a invertir el orden o a relajar los filtros.'
      : 'No hay expediciones con los filtros seleccionados.';
    container.innerHTML = `<div class="no-results-msg">${escapeHtml(msg)}</div>`;
    return;
  }

  // Ordenar rutas por número de expediciones desc
  const rutasConExps = rutas
    .filter(r => (expsByRuta.get(r.id) || []).length > 0)
    .sort((a, b) => (expsByRuta.get(b.id) || []).length - (expsByRuta.get(a.id) || []).length);

  const html = rutasConExps.map((ruta, i) => {
    // Con origen → destino se ordena por la hora de paso en el origen buscado,
    // no por la salida de cabecera de la ruta.
    const horaRef = (e) => {
      if (areaSets.length < 2) return e.horaSalida || '';
      const idx = matchSecuenciaParadas(e, areaSets);
      const paso = idx ? (e.pasos || [])[idx[0]] : null;
      return paso?.horaSalida || paso?.horaLlegada || e.horaSalida || '';
    };
    const expsRuta = (expsByRuta.get(ruta.id) || []).sort((a, b) => horaRef(a).localeCompare(horaRef(b)));
    const linea = STATE.indexes.lineaById.get(ruta.lineaId);
    const lineaLabel = linea ? `${linea.codigo} — ${linea.nombre}` : ruta.id;

    const origenId = ruta.paradas?.[0]?.paradaId;
    const destinoId = ruta.paradas?.[ruta.paradas.length - 1]?.paradaId;
    const origen = origenId ? STATE.indexes.paradaById.get(origenId) : null;
    const destino = destinoId ? STATE.indexes.paradaById.get(destinoId) : null;
    const origenNombre = origen ? paradaDisplay(origen) : '—';
    const destinoNombre = destino ? paradaDisplay(destino) : '—';

    const expRows = expsRuta.map(e => renderExpRowParada(e, ruta, areaSets)).join('');

    return `
      <div class="trayecto-block">
        <div class="trayecto-block-header">
          <span class="trayecto-block-code">T${i + 1}</span>
          <span class="trayecto-block-nombre" title="${escapeAttr(lineaLabel)}">${escapeHtml(lineaLabel)}</span>
          <span class="trayecto-block-count">${expsRuta.length} exp · ${origenNombre} → ${destinoNombre}</span>
        </div>
        ${expRows}
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="linea-results-wrap">${html}${moreResultsHtml(totalExps, exps.length)}</div>`;

  // Bindear expansión
  container.querySelectorAll('.linea-exp-row').forEach(row => {
    row.addEventListener('click', () => {
      const expId = row.dataset.expId;
      const detail = container.querySelector(`.linea-exp-detail[data-exp-id="${CSS.escape(expId)}"]`);
      if (!detail) return;
      const isOpen = detail.classList.contains('is-open');
      detail.classList.toggle('is-open', !isOpen);
      row.classList.toggle('is-open', !isOpen);
    });
  });
}

function renderExpRowParada(exp, ruta, areaSets) {
  const pasos = exp.pasos || [];
  const multi = (areaSets?.length || 0) >= 2;
  const indices = multi ? matchSecuenciaParadas(exp, areaSets) : null;

  let horaSalida, horaFin, resumenDerecha, tramoLabel;
  if (indices) {
    // Origen → destino: horas del tramo buscado y su duración.
    const pasoOrigen = pasos[indices[0]];
    const pasoDestino = pasos[indices[indices.length - 1]];
    const hIni = pasoOrigen?.horaSalida || pasoOrigen?.horaLlegada || '';
    const hFin = pasoDestino?.horaLlegada || pasoDestino?.horaSalida || '';
    horaSalida = hIni.slice(0, 5) || '—';
    horaFin = hFin.slice(0, 5) || '—';
    const nTramo = indices[indices.length - 1] - indices[0] + 1;
    const dur = formatDuracion(minutosEntre(hIni, hFin));
    resumenDerecha = [dur, `${nTramo} paradas`].filter(Boolean).join(' · ');
    tramoLabel = 'Tramo buscado';
  } else {
    horaSalida = (exp.horaSalida || '').slice(0, 5);
    const ultimoPaso = pasos[pasos.length - 1];
    horaFin = ultimoPaso ? (ultimoPaso.horaLlegada || '').slice(0, 5) : '—';
    resumenDerecha = `${pasos.length || ruta.paradas?.length || 0} paradas`;
    tramoLabel = '';
  }
  const tipoDesc = truncate(cleanMojibake(exp.tipoDia?.descripcion) || '—', 28);

  const tieneCoords = (ruta.paradas || []).some(p => {
    const par = STATE.indexes.paradaById.get(p.paradaId);
    return par?.coords?.lat != null;
  });

  const detailHtml = renderExpDetailParada(exp, ruta, areaSets);

  return `
    <div class="linea-exp-row${indices ? ' is-tramo' : ''}" data-exp-id="${escapeAttr(exp.id)}"${tramoLabel ? ` title="${escapeAttr(tramoLabel)}"` : ''}>
      <span class="linea-exp-hora">${escapeHtml(horaSalida)}</span>
      <span class="linea-exp-hora-fin">→ ${escapeHtml(horaFin)}</span>
      <span class="linea-exp-tipo" title="${escapeAttr(cleanMojibake(exp.tipoDia?.descripcion) || '')}">${escapeHtml(tipoDesc)}</span>
      <span class="linea-exp-nparadas">${escapeHtml(resumenDerecha)}</span>
      <svg class="linea-exp-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <div class="linea-exp-detail" data-exp-id="${escapeAttr(exp.id)}">
      <div class="linea-exp-detail-title">Recorrido completo</div>
      <div class="exp-recorrido">
        ${detailHtml}
      </div>
      <div style="margin-top: 12px; display: flex; justify-content: flex-end;">
        <button class="btn-map" onclick="openMapModal('${escapeAttr(ruta.id)}')" ${tieneCoords ? '' : 'disabled title="No hay coordenadas disponibles"'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
            <line x1="8" y1="2" x2="8" y2="18"/>
            <line x1="16" y1="6" x2="16" y2="22"/>
          </svg>
          Ver en mapa
        </button>
      </div>
    </div>
  `;
}

function renderExpDetailParada(exp, ruta, areaSets) {
  const demandaByParada = demandaMap(ruta);
  const pasos = exp.pasos && exp.pasos.length > 0
    ? exp.pasos
    : (ruta.paradas || []).map(p => ({ paradaId: p.paradaId, orden: p.orden, horaLlegada: null, horaSalida: null }));
  const n = pasos.length;

  // Con origen → destino se resaltan los pasos que materializan la secuencia (y no
  // cualquier otra parada del mismo área que la expedición pueda repetir). Con una
  // sola parada se resaltan todos sus pasos, que es el comportamiento clásico.
  const multi = (areaSets?.length || 0) >= 2;
  const indices = matchSecuenciaParadas(exp, areaSets);
  const buscados = new Map();
  if (multi) {
    (indices || []).forEach((idx, pos) => buscados.set(idx, pos));
  } else if (areaSets?.length === 1) {
    pasos.forEach((paso, i) => {
      if (areaSets[0].has(paso.paradaId)) buscados.set(i, 0);
    });
  }
  const desdeTramo = indices ? indices[0] : null;
  const hastaTramo = indices ? indices[indices.length - 1] : null;
  const totalBuscadas = areaSets?.length || 0;

  return pasos.map((paso, i) => {
    const parada = STATE.indexes.paradaById.get(paso.paradaId);
    const nombre = parada ? paradaDisplay(parada) : paso.paradaId;
    const title = parada ? paradaTitle(parada) : '';
    const hora = (paso.horaLlegada || paso.horaSalida || '').slice(0, 5) || '—';
    const cls = i === 0 ? 'is-first' : (i === n - 1 ? 'is-last' : '');
    const pos = buscados.get(i);
    const esBuscada = pos !== undefined;
    const fueraTramo = multi && indices && (i < desdeTramo || i > hastaTramo);
    const muni = parada?.municipioId ? STATE.indexes.municipioById.get(parada.municipioId) : null;
    const muniNombre = muni ? muni.nombre : '';
    const demandaHtml = demandaByParada.get(paso.paradaId) ? ' ' + DEMANDA_BADGE : '';
    // Parada buscada: nombre en negrita y fondo destacado
    const nombreHtml = esBuscada
      ? `<strong>${escapeHtml(nombre)}</strong>`
      : escapeHtml(nombre);
    // Con origen → destino, cada parada buscada lleva su papel en la secuencia
    let rolHtml = '';
    if (esBuscada && multi) {
      const kind = pos === 0 ? 'origin' : (pos === totalBuscadas - 1 ? 'destination' : 'intermediate');
      const label = pos === 0 ? 'Origen' : (pos === totalBuscadas - 1 ? 'Destino' : `Paso ${pos}`);
      rolHtml = ` <span class="role-badge role-${kind}">${escapeHtml(label)}</span>`;
    }
    return `
      <div class="exp-recorrido-stop ${cls}${esBuscada ? ' is-buscada' : ''}${fueraTramo ? ' is-fuera-tramo' : ''}">
        <div class="exp-recorrido-dot"></div>
        <div class="exp-recorrido-nombre" title="${escapeAttr(title || nombre)}">${nombreHtml}${rolHtml}${demandaHtml}</div>
        <div class="exp-recorrido-municipio" title="${escapeAttr(muniNombre)}">${escapeHtml(truncate(muniNombre, 16))}</div>
        <div class="exp-recorrido-hora">${escapeHtml(hora)}</div>
      </div>
    `;
  }).join('');
}

function triggerSearchConcesion() {
  const query = document.getElementById('municipioInput').value.trim();
  if (!query) return;
  const q = normalize(query);
  let conc = STATE.data.concesiones.find(c => normalize(c.id) === q || normalize(c.nombre || '') === q);
  if (!conc) conc = STATE.data.concesiones.find(c => normalize(c.id).includes(q) || normalize(c.nombre || '').includes(q));
  if (!conc) { alert('No se encontró ninguna concesión con ese código o nombre.'); return; }
  document.getElementById('municipioInput').value = prettyConcesionName(conc.nombre) || conc.id;
  runSearchConcesion(conc);
}

/* ═══════════════════════════════════════════════════════════════════
   3d. BÚSQUEDA POR CONCESIÓN
   ═══════════════════════════════════════════════════════════════════ */

function runSearchConcesion(concesion) {
  STATE.selectedConcesion = concesion;
  STATE.selectedOperador = null;
  STATE.selectedLinea = null;
  STATE.selectedMunicipios = [];
  STATE.selectedParadas = [];
  addToRecentSearches('concesion', concesion.id);
  STATE.filters.tiposDia = new Set();
  STATE.filters.concesiones = new Set();
  STATE.filters.tiposLinea = new Set();
  STATE.filters.paradaId = null;
  resetResultLimit();

  // Líneas y expediciones de esta concesión
  const lineas = STATE.data.lineas.filter(l => l.concesionId === concesion.id);
  const lineaIds = new Set(lineas.map(l => l.id));
  const exps = STATE.data.expediciones.filter(e => e.concesionId === concesion.id);
  const rutaIds = new Set(exps.map(e => e.rutaId));
  const rutas = STATE.data.rutas.filter(r => rutaIds.has(r.id));

  // Tipos de día agrupados
  const tipoDiaMap = new Map();
  for (const e of exps) {
    const td = e.tipoDia;
    if (!td || !td.id) continue;
    const desc = cleanMojibake(td.descripcion) || td.id;
    if (!tipoDiaMap.has(desc)) {
      tipoDiaMap.set(desc, { id: desc, descripcion: desc, diasSemana: td.diasSemana, tipoDiaIds: new Set(), concesionIds: new Set([concesion.id]), count: 0 });
    }
    tipoDiaMap.get(desc).tipoDiaIds.add(td.id);
    tipoDiaMap.get(desc).count++;
  }

  STATE.indexes.currentTiposDia = Array.from(tipoDiaMap.values()).sort((a, b) => b.count - a.count);
  STATE.indexes.currentExpediciones = exps;
  STATE.indexes.currentRutas = rutas;
  STATE.indexes.currentLineas = lineas;
  STATE.indexes.currentConcesiones = [concesion];
  STATE.indexes.currentParadasIds = new Set();

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('results').style.display = 'block';
  collapseHero();

  const fgTipoDia = document.getElementById('fg-tipodia');
  if (fgTipoDia) fgTipoDia.style.display = STATE.searchMode === 'dia' ? 'none' : '';
  const pg = document.getElementById('fg-parada');
  if (pg) pg.style.display = 'none';
  // El filtro de concesión tampoco aplica (solo hay una)
  const fc = document.getElementById('fg-concesion');
  if (fc) fc.style.display = 'none';

  renderHeaderConcesion(concesion, lineas, exps);
  renderSidebar();
  buildDaysWithService();
  initCalendarForMunicipio();
  renderConcesionExpediciones(concesion, lineas, rutas, exps);
  renderActiveFiltersChips();
}

function renderHeaderConcesion(concesion, lineas, exps) {
  const nombre = prettyConcesionName(concesion.nombre) || concesion.id;
  const h = document.getElementById('resultsTitle');
  const s = document.getElementById('resultsSubtitle');
  if (h) h.textContent = nombre;
  if (s) s.textContent = `${concesion.id} · ${lineas.length} línea${lineas.length !== 1 ? 's' : ''} · ${exps.length} expedición${exps.length !== 1 ? 'es' : ''}`;

  const mL = document.getElementById('metaLineas');
  const mP = document.getElementById('metaParadas');
  const mC = document.getElementById('metaConcesiones');
  if (mL) mL.textContent = lineas.length;
  if (mP) {
    const paradaIds = new Set(exps.flatMap(e => (e.pasos || []).map(p => p.paradaId)));
    mP.textContent = paradaIds.size;
  }
  if (mC) mC.textContent = prettyConcesionName(nombre);

  const bannerDay = document.getElementById('bannerDay');
  const bannerExp = document.getElementById('bannerExpeds');
  if (bannerDay) bannerDay.textContent = nombre;
  if (bannerExp) bannerExp.textContent = `${exps.length} expediciones`;
}

function filteredExpedicionesConcesion() {
  let list = STATE.indexes.currentExpediciones;
  if (STATE.searchMode === 'dia') list = filterExpedicionesPorFecha(list, STATE.selectedDate);
  if (STATE.filters.tiposDia.size > 0) {
    list = list.filter(e => {
      const td = e.tipoDia;
      if (!td) return false;
      return STATE.filters.tiposDia.has(cleanMojibake(td.descripcion) || td.id);
    });
  }
  if (STATE.filters.tiposLinea.size > 0) {
    list = list.filter(e => STATE.filters.tiposLinea.has(tipoLineaOfExp(e)));
  }
  return list;
}

function renderConcesionExpediciones(concesion, lineas, rutas, _expsAll) {
  const exps = STATE.selectedConcesion ? filteredExpedicionesConcesion() : _expsAll;
  renderLineGroupedExpediciones(lineas, rutas, exps);
}

// Render de expediciones agrupadas por línea → trayecto. Compartido por las
// búsquedas por concesión y por operador (ambas presentan la oferta como
// líneas con sus trayectos y expediciones).
function renderLineGroupedExpediciones(lineas, rutas, exps) {
  const container = document.getElementById('linesContainer');
  if (!container) return;

  const { visible: visibleExps, total: totalExps } = limitedExpeditions(exps);
  const bannerExp = document.getElementById('bannerExpeds');
  if (bannerExp) bannerExp.textContent = `${totalExps} expediciones`;

  if (exps.length === 0) {
    container.innerHTML = `<div class="no-results-msg">No hay expediciones con los filtros seleccionados.</div>`;
    return;
  }

  // Agrupar expediciones por línea, y dentro por ruta
  const expsByRuta = new Map();
  for (const e of visibleExps) {
    if (!expsByRuta.has(e.rutaId)) expsByRuta.set(e.rutaId, []);
    expsByRuta.get(e.rutaId).push(e);
  }

  // Agrupar rutas por línea
  const rutasByLinea = new Map();
  for (const r of rutas) {
    if (!r.lineaId) continue;
    if (!rutasByLinea.has(r.lineaId)) rutasByLinea.set(r.lineaId, []);
    rutasByLinea.get(r.lineaId).push(r);
  }

  const html = lineas.map(linea => {
    const rutasLinea = (rutasByLinea.get(linea.id) || [])
      .filter(r => (expsByRuta.get(r.id) || []).length > 0);
    if (rutasLinea.length === 0) return '';

    const totalExpsLinea = rutasLinea.reduce((s, r) => s + (expsByRuta.get(r.id) || []).length, 0);

    // Cabecera de la línea (colapsable)
    const lineaHtml = rutasLinea.map((ruta, i) => {
      const expsRuta = (expsByRuta.get(ruta.id) || []).sort((a, b) => (a.horaSalida || '').localeCompare(b.horaSalida || ''));
      const origenId = ruta.paradas?.[0]?.paradaId;
      const destinoId = ruta.paradas?.[ruta.paradas.length - 1]?.paradaId;
      const origen = origenId ? STATE.indexes.paradaById.get(origenId) : null;
      const destino = destinoId ? STATE.indexes.paradaById.get(destinoId) : null;
      const origenNombre = origen ? paradaDisplay(origen) : '—';
      const destinoNombre = destino ? paradaDisplay(destino) : '—';
      const expRows = expsRuta.map(e => renderExpRowLinea(e, ruta)).join('');
      return `
        <div class="trayecto-block" style="border-top: 1px solid var(--line); border-radius: 0;">
          <div class="trayecto-block-header">
            <span class="trayecto-block-code">T${i + 1}</span>
            <span class="trayecto-block-nombre" title="${escapeAttr(origenNombre + ' → ' + destinoNombre)}">${escapeHtml(origenNombre)} → ${escapeHtml(destinoNombre)}</span>
            <span class="trayecto-block-count">${expsRuta.length} exp · ${ruta.paradas?.length || 0} paradas</span>
          </div>
          ${expRows}
        </div>
      `;
    }).join('');

    return `
      <div class="trayecto-block" style="overflow:hidden;">
        <div class="trayecto-block-header" style="background: var(--footer-bg); cursor:default;">
          <span style="font-size:11px;font-weight:700;color:var(--on-accent);letter-spacing:0.06em;">${escapeHtml(linea.codigo)}</span>
          <span class="trayecto-block-nombre" style="color:var(--on-accent);" title="${escapeAttr(linea.nombre)}">${escapeHtml(linea.nombre)}</span>
          <span class="trayecto-block-count" style="color:rgba(255,255,255,0.65);">${escapeHtml(tipoLineaLabel(linea))} · ${totalExpsLinea} exp · ${rutasLinea.length} trayecto${rutasLinea.length !== 1 ? 's' : ''}</span>
        </div>
        ${lineaHtml}
      </div>
    `;
  }).filter(Boolean).join('');

  container.innerHTML = `<div class="linea-results-wrap">${html}${moreResultsHtml(totalExps, visibleExps.length)}</div>`;

  // Bindear expansión
  container.querySelectorAll('.linea-exp-row').forEach(row => {
    row.addEventListener('click', () => {
      const expId = row.dataset.expId;
      const detail = container.querySelector(`.linea-exp-detail[data-exp-id="${CSS.escape(expId)}"]`);
      if (!detail) return;
      const isOpen = detail.classList.contains('is-open');
      detail.classList.toggle('is-open', !isOpen);
      row.classList.toggle('is-open', !isOpen);
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════
   3e. BÚSQUEDA POR OPERADOR
   Un operador agrupa una o varias concesiones (campo `operador` de cada
   concesión, resuelto por el ETL). Se presenta toda su oferta combinada.
   ═══════════════════════════════════════════════════════════════════ */

function triggerSearchOperador() {
  const query = document.getElementById('municipioInput').value.trim();
  if (!query) return;
  const q = normalize(query);
  let operador = STATE.data.operadores.find(o => normalize(o.nombre) === q);
  if (!operador) operador = STATE.data.operadores.find(o => normalize(o.nombre).includes(q));
  if (!operador) { alert('No se encontró ningún operador con ese nombre.'); return; }
  document.getElementById('municipioInput').value = operador.nombre;
  runSearchOperador(operador);
}

function runSearchOperador(operador) {
  STATE.selectedOperador = operador;
  STATE.selectedConcesion = null;
  STATE.selectedLinea = null;
  STATE.selectedMunicipios = [];
  STATE.selectedParadas = [];
  addToRecentSearches('operador', operador.nombre);
  STATE.filters.tiposDia = new Set();
  STATE.filters.concesiones = new Set();
  STATE.filters.tiposLinea = new Set();
  STATE.filters.paradaId = null;
  resetResultLimit();

  const concesionIds = new Set(operador.concesionIds);
  const lineas = STATE.data.lineas
    .filter(l => concesionIds.has(l.concesionId))
    .sort((a, b) => (a.codigo || '').localeCompare(b.codigo || '', 'es', { numeric: true }));
  const exps = STATE.data.expediciones.filter(e => concesionIds.has(e.concesionId));
  const rutaIds = new Set(exps.map(e => e.rutaId));
  const rutas = STATE.data.rutas.filter(r => rutaIds.has(r.id));

  // Tipos de día agrupados por descripción (igual que en municipio: el operador
  // puede abarcar varias concesiones, cada una con su propio tipoDia).
  const tipoDiaMap = new Map();
  for (const e of exps) {
    const td = e.tipoDia;
    if (!td || !td.id) continue;
    const desc = cleanMojibake(td.descripcion) || td.id;
    if (!tipoDiaMap.has(desc)) {
      tipoDiaMap.set(desc, {
        id: desc, descripcion: desc, diasSemana: td.diasSemana,
        tipoDiaIds: new Set(), concesionIds: new Set(), count: 0,
      });
    }
    const grupo = tipoDiaMap.get(desc);
    grupo.tipoDiaIds.add(td.id);
    if (e.concesionId) grupo.concesionIds.add(e.concesionId);
    grupo.count++;
  }

  STATE.indexes.currentTiposDia = Array.from(tipoDiaMap.values()).sort((a, b) => b.count - a.count);
  STATE.indexes.currentExpediciones = exps;
  STATE.indexes.currentRutas = rutas;
  STATE.indexes.currentLineas = lineas;
  STATE.indexes.currentConcesiones = STATE.data.concesiones
    .filter(c => concesionIds.has(c.id))
    .sort((a, b) => prettyConcesionName(a.nombre).localeCompare(prettyConcesionName(b.nombre), 'es'));
  STATE.indexes.currentParadasIds = new Set();

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('results').style.display = 'block';
  collapseHero();

  const fgTipoDia = document.getElementById('fg-tipodia');
  if (fgTipoDia) fgTipoDia.style.display = STATE.searchMode === 'dia' ? 'none' : '';
  const pg = document.getElementById('fg-parada');
  if (pg) pg.style.display = 'none';
  // El operador puede tener varias concesiones: el filtro de concesión sí aplica.
  const fc = document.getElementById('fg-concesion');
  if (fc) fc.style.display = STATE.indexes.currentConcesiones.length > 1 ? '' : 'none';

  renderHeaderOperador(operador, lineas, exps);
  renderSidebar();
  buildDaysWithService();
  initCalendarForMunicipio();
  renderOperadorExpediciones(lineas, rutas, exps);
  renderActiveFiltersChips();
}

function renderHeaderOperador(operador, lineas, exps) {
  const nConc = operador.concesionIds.length;
  const h = document.getElementById('resultsTitle');
  const s = document.getElementById('resultsSubtitle');
  if (h) h.textContent = operador.nombre;
  if (s) s.textContent = `Operador · ${nConc} concesión${nConc !== 1 ? 'es' : ''} · ${lineas.length} línea${lineas.length !== 1 ? 's' : ''} · ${exps.length} expedición${exps.length !== 1 ? 'es' : ''}`;

  const mL = document.getElementById('metaLineas');
  const mP = document.getElementById('metaParadas');
  const mC = document.getElementById('metaConcesiones');
  if (mL) mL.textContent = lineas.length;
  if (mP) {
    const paradaIds = new Set(exps.flatMap(e => (e.pasos || []).map(p => p.paradaId)));
    mP.textContent = paradaIds.size;
  }
  if (mC) mC.textContent = nConc;

  const bannerDay = document.getElementById('bannerDay');
  const bannerExp = document.getElementById('bannerExpeds');
  if (bannerDay) bannerDay.textContent = operador.nombre;
  if (bannerExp) bannerExp.textContent = `${exps.length} expediciones`;
}

function renderOperadorExpediciones(lineas, rutas, _expsAll) {
  // En modo operador el filtro de concesión sí aplica, por eso usamos el
  // filtrado genérico (filteredExpediciones), no el específico de concesión.
  const exps = STATE.selectedOperador ? filteredExpediciones() : _expsAll;
  renderLineGroupedExpediciones(lineas, rutas, exps);
}

function triggerSearchLinea() {
  const query = document.getElementById('municipioInput').value.trim();
  if (!query) return;
  const q = normalize(query);
  let linea = STATE.data.lineas.find(l => normalize(l.codigo) === q || normalize(l.nombre) === q);
  if (!linea) linea = STATE.data.lineas.find(l => normalize(l.codigo).includes(q) || normalize(l.nombre).includes(q));
  if (!linea) { alert('No se encontró ninguna línea con ese código o nombre.'); return; }
  document.getElementById('municipioInput').value = linea.nombre || linea.codigo;
  runSearchLinea(linea);
}

/* ═══════════════════════════════════════════════════════════════════
   3. BÚSQUEDA POR MUNICIPIO (uno, u origen → destino): filtrar y renderizar
   ═══════════════════════════════════════════════════════════════════ */

/* ─── Cadena de municipios ──────────────────────────────────────────
   Igual que la cadena de paradas, pero cada eslabón es un municipio entero
   (todas sus paradas). Con dos o más se buscan los viajes directos que pasan
   por ellos en el orden indicado.
   ─────────────────────────────────────────────────────────────────── */

function municipioSearchActive() {
  return STATE.selectedMunicipios.length > 0;
}

// Conjuntos de paradas (uno por municipio de la cadena), en orden.
function selectedMunicipioParadaSets() {
  return STATE.selectedMunicipios.map(m => new Set(m.paradas || []));
}

function isSelectedMunicipioId(municipioId) {
  return STATE.selectedMunicipios.some(m => m.id === municipioId);
}

// Título de la búsqueda: "MUNICIPIO" o "ORIGEN → DESTINO".
function municipiosChainLabel(municipios = STATE.selectedMunicipios) {
  if (municipios.length === 0) return '—';
  if (municipios.length === 1) return municipios[0].nombre;
  return `${municipios[0].nombre} → ${municipios[municipios.length - 1].nombre}`;
}

// Ámbito de la búsqueda en prosa, para textos del tipo "horas en …".
function municipiosScopeLabel() {
  const nombres = STATE.selectedMunicipios.map(m => m.nombre);
  if (nombres.length === 0) return '—';
  if (nombres.length === 1) return nombres[0];
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

function addMunicipioToChain(municipio) {
  if (!municipio) return;
  const ultimo = STATE.selectedMunicipios[STATE.selectedMunicipios.length - 1];
  // Repetir el mismo municipio justo detrás de sí mismo no aporta nada al filtro.
  if (ultimo && ultimo.id === municipio.id) return;
  runSearchMunicipios([...STATE.selectedMunicipios, municipio]);
}

function removeMunicipioFromChain(index) {
  const resto = STATE.selectedMunicipios.filter((_, i) => i !== index);
  if (resto.length === 0) { clearMunicipiosChain(); return; }
  runSearchMunicipios(resto);
}

function moveMunicipioInChain(index, dir) {
  const lista = [...STATE.selectedMunicipios];
  const destino = index + dir;
  if (destino < 0 || destino >= lista.length) return;
  [lista[index], lista[destino]] = [lista[destino], lista[index]];
  runSearchMunicipios(lista);
}

function clearMunicipiosChain() {
  STATE.selectedMunicipios = [];
  resetCurrentResults();
  renderSearchChain();
  renderRecentSearches();
}

function runSearchMunicipios(municipios) {
  const lista = (municipios || []).filter(Boolean);
  if (lista.length === 0) { clearMunicipiosChain(); return; }

  STATE.selectedMunicipios = lista;
  STATE.selectedLinea = null;
  STATE.selectedParadas = [];
  STATE.selectedConcesion = null;
  STATE.selectedOperador = null;
  if (lista.length === 1) addToRecentSearches('municipio', lista[0].id);
  else addToRecentSearches('municipios', lista.map(m => m.id).join(RECENT_CHAIN_SEP));
  STATE.filters.tiposDia = new Set();
  STATE.filters.concesiones = new Set();
  STATE.filters.tiposLinea = new Set();
  STATE.filters.paradaId = null;
  resetResultLimit();

  // Restaurar filtros que pueden estar ocultos si veníamos de otro modo
  const pg = document.getElementById('fg-parada');
  if (pg) pg.style.display = '';
  const fc = document.getElementById('fg-concesion');
  if (fc) fc.style.display = '';

  // 1. Paradas de los municipios buscados (todas las de la cadena)
  const paradaSets = selectedMunicipioParadaSets();
  const paradasIds = new Set(paradaSets.flatMap(s => Array.from(s)));
  STATE.indexes.currentParadasIds = paradasIds;

  // 2. Rutas y expediciones.
  //    Con un municipio: todas las rutas que tocan alguna de sus paradas.
  //    Con dos o más: solo las expediciones que los recorren en orden, y las
  //    rutas de esas expediciones.
  let rutasDelMun;
  let expediciones;
  if (lista.length === 1) {
    rutasDelMun = STATE.data.rutas.filter(ruta =>
      ruta.paradas.some(p => paradasIds.has(p.paradaId))
    );
    const rutaIdsMun = new Set(rutasDelMun.map(r => r.id));
    expediciones = STATE.data.expediciones.filter(e => rutaIdsMun.has(e.rutaId));
  } else {
    expediciones = STATE.data.expediciones.filter(e => matchSecuenciaParadas(e, paradaSets) !== null);
    const rutaIdsExps = new Set(expediciones.map(e => e.rutaId));
    rutasDelMun = STATE.data.rutas.filter(r => rutaIdsExps.has(r.id));
  }
  STATE.indexes.currentRutas = rutasDelMun;

  // Paradas a las que se sigue viajando sin transbordo desde el último municipio
  // de la cadena: el autocompletado prioriza los municipios que las contienen.
  STATE.indexes.reachableParadaIds = paradasAlcanzablesTras(expediciones, paradaSets);

  // 3. Líneas asociadas a esas rutas
  const lineaIds = new Set();
  for (const r of rutasDelMun) if (r.lineaId) lineaIds.add(r.lineaId);
  STATE.indexes.currentLineas = STATE.data.lineas
    .filter(l => lineaIds.has(l.id))
    .sort((a, b) => (a.codigo || '').localeCompare(b.codigo || '', 'es', { numeric: true }));

  // 4. Expediciones del ámbito buscado
  STATE.indexes.currentExpediciones = expediciones;

  // 5. Concesiones que aparecen
  const concIds = new Set();
  for (const l of STATE.indexes.currentLineas) if (l.concesionId) concIds.add(l.concesionId);
  STATE.indexes.currentConcesiones = STATE.data.concesiones
    .filter(c => concIds.has(c.id))
    .sort((a, b) => prettyConcesionName(a.nombre).localeCompare(prettyConcesionName(b.nombre), 'es'));

  // 6. Tipos de día que aparecen, AGRUPADOS POR DESCRIPCIÓN.
  // Razón: la API genera un tipoDia distinto por concesión, aunque tengan la misma descripción
  // ("LMXJV" puede aparecer múltiples veces, una por concesión). Para el usuario es más natural
  // ver un solo item "LMXJV" que agrupa todos los tipos con esa descripción. Cada grupo conserva
  // el conjunto de tipoDiaIds reales y el conjunto de concesiones a las que pertenece.
  const tipoDiaMap = new Map(); // key = descripción
  for (const e of STATE.indexes.currentExpediciones) {
    const td = e.tipoDia;
    if (!td || !td.id) continue;
    const descripcion = cleanMojibake(td.descripcion) || td.id;
    if (!tipoDiaMap.has(descripcion)) {
      tipoDiaMap.set(descripcion, {
        // 'id' del grupo = la propia descripción (clave estable usada por los filtros y los chips)
        id: descripcion,
        descripcion: descripcion,
        diasSemana: td.diasSemana, // referencia (todos los del grupo deberían tener el mismo patrón)
        tipoDiaIds: new Set(),     // ids reales de tipoDia que componen el grupo
        concesionIds: new Set(),   // concesiones a las que pertenece
        count: 0,
      });
    }
    const grupo = tipoDiaMap.get(descripcion);
    grupo.tipoDiaIds.add(td.id);
    const linea = STATE.indexes.lineaById.get(e.lineaId);
    if (linea && linea.concesionId) grupo.concesionIds.add(linea.concesionId);
    grupo.count++;
  }
  STATE.indexes.currentTiposDia = Array.from(tipoDiaMap.values())
    .sort((a, b) => b.count - a.count);

  // 7. Construir el set de días con servicio
  buildDaysWithService();

  // Mostrar resultados
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('results').style.display = 'block';
  collapseHero();

  // Asegurar visibilidad correcta del filtro de tipo de día según el modo activo
  const fgTipoDia = document.getElementById('fg-tipodia');
  if (fgTipoDia) fgTipoDia.style.display = STATE.searchMode === 'dia' ? 'none' : '';

  renderSearchChain();
  renderHeader();
  renderSidebar();
  initCalendarForMunicipio();
  renderLines();
}

/* ═══════════════════════════════════════════════════════════════════
   3b. BÚSQUEDA POR LÍNEA
   ═══════════════════════════════════════════════════════════════════ */

function runSearchLinea(linea) {
  STATE.selectedLinea = linea;
  STATE.selectedMunicipios = [];
  STATE.selectedParadas = [];
  STATE.selectedConcesion = null;
  STATE.selectedOperador = null;
  addToRecentSearches('linea', linea.id);
  STATE.filters.tiposDia = new Set();
  STATE.filters.concesiones = new Set();
  STATE.filters.tiposLinea = new Set();
  STATE.filters.paradaId = null;
  resetResultLimit();

  // Expediciones de esta línea
  const exps = STATE.data.expediciones.filter(e => e.lineaId === linea.id);

  // Rutas (trayectos) de esta línea
  const rutasDeLinea = STATE.data.rutas.filter(r => r.lineaId === linea.id);

  // Tipos de día (agrupados por descripción)
  const tipoDiaMap = new Map();
  for (const e of exps) {
    const td = e.tipoDia;
    if (!td || !td.id) continue;
    const desc = cleanMojibake(td.descripcion) || td.id;
    if (!tipoDiaMap.has(desc)) {
      tipoDiaMap.set(desc, { id: desc, descripcion: desc, diasSemana: td.diasSemana, tipoDiaIds: new Set(), concesionIds: new Set(), count: 0 });
    }
    const g = tipoDiaMap.get(desc);
    g.tipoDiaIds.add(td.id);
    g.count++;
  }
  STATE.indexes.currentTiposDia = Array.from(tipoDiaMap.values()).sort((a, b) => b.count - a.count);
  STATE.indexes.currentExpediciones = exps;
  STATE.indexes.currentRutas = rutasDeLinea;
  STATE.indexes.currentLineas = [linea];
  STATE.indexes.currentConcesiones = STATE.data.concesiones.filter(c => exps.some(e => e.concesionId === c.id));
  STATE.indexes.currentParadasIds = new Set();

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('results').style.display = 'block';
  collapseHero();

  const fgTipoDia3 = document.getElementById('fg-tipodia');
  if (fgTipoDia3) fgTipoDia3.style.display = STATE.searchMode === 'dia' ? 'none' : '';
  const fcLinea = document.getElementById('fg-concesion');
  if (fcLinea) fcLinea.style.display = '';

  renderHeaderLinea(linea, exps, rutasDeLinea);
  renderSidebarLinea();
  buildDaysWithService();
  initCalendarForMunicipio();
  renderLineaExpediciones(linea, rutasDeLinea, exps);
  renderActiveFiltersChips();
}

function renderHeaderLinea(linea, exps, rutas) {
  const concesion = STATE.indexes.concesionById.get(linea.concesionId);
  const h = document.getElementById('resultsTitle');
  const s = document.getElementById('resultsSubtitle');
  if (h) h.textContent = linea.nombre || linea.codigo;
  if (s) s.textContent = `${linea.codigo} · ${tipoLineaLabel(linea)} · ${rutas.length} trayecto${rutas.length !== 1 ? 's' : ''} · ${exps.length} expedicion${exps.length !== 1 ? 'es' : ''}`;

  const mL = document.getElementById('metaLineas');
  const mP = document.getElementById('metaParadas');
  const mC = document.getElementById('metaConcesiones');
  if (mL) mL.textContent = rutas.length;
  if (mP) {
    const paradasIds = new Set(rutas.flatMap(r => (r.paradas || []).map(p => p.paradaId)));
    mP.textContent = paradasIds.size;
  }
  if (mC) mC.textContent = concesion ? prettyConcesionName(concesion.nombre) : '—';

  const bannerDay = document.getElementById('bannerDay');
  const bannerExp = document.getElementById('bannerExpeds');
  if (bannerDay) bannerDay.textContent = linea.nombre || linea.codigo;
  if (bannerExp) bannerExp.textContent = `${exps.length} expediciones`;
}

function renderSidebarLinea() {
  // Misma lógica que renderSidebar pero sin filtro por parada
  // (en modo línea el filtro por parada no aplica)
  renderSidebar();
  const pGroup = document.getElementById('fg-parada');
  if (pGroup) pGroup.style.display = 'none';
}

function filteredExpedicionesLinea() {
  // Igual que filteredExpediciones, sin el filtro por parada.
  let list = STATE.indexes.currentExpediciones;
  if (STATE.searchMode === 'dia') list = filterExpedicionesPorFecha(list, STATE.selectedDate);
  if (STATE.filters.tiposDia.size > 0) {
    list = list.filter(e => {
      const td = e.tipoDia;
      if (!td) return false;
      const desc = cleanMojibake(td.descripcion) || td.id;
      return STATE.filters.tiposDia.has(desc);
    });
  }
  if (STATE.filters.concesiones.size > 0) {
    list = list.filter(e => STATE.filters.concesiones.has(e.concesionId));
  }
  return list;
}

function renderLineaExpediciones(linea, rutas, _expsAll) {
  const container = document.getElementById('linesContainer');
  if (!container) return;

  const allExps = STATE.selectedLinea ? filteredExpedicionesLinea() : _expsAll;
  const { visible: exps, total: totalExps } = limitedExpeditions(allExps);

  // Actualizar banner
  const bannerExp = document.getElementById('bannerExpeds');
  if (bannerExp) bannerExp.textContent = `${totalExps} expediciones`;

  // Agrupar expediciones por rutaId
  const expsByRuta = new Map();
  for (const e of exps) {
    if (!expsByRuta.has(e.rutaId)) expsByRuta.set(e.rutaId, []);
    expsByRuta.get(e.rutaId).push(e);
  }

  if (exps.length === 0) {
    container.innerHTML = `<div class="no-results-msg">No hay expediciones con los filtros seleccionados.</div>`;
    return;
  }

  const html = rutas.map((ruta, i) => {
    const expsRuta = (expsByRuta.get(ruta.id) || []).sort((a, b) => (a.horaSalida || '').localeCompare(b.horaSalida || ''));
    if (expsRuta.length === 0) return '';
    const origenId = ruta.paradas?.[0]?.paradaId;
    const destinoId = ruta.paradas?.[ruta.paradas.length - 1]?.paradaId;
    const origen = origenId ? STATE.indexes.paradaById.get(origenId) : null;
    const destino = destinoId ? STATE.indexes.paradaById.get(destinoId) : null;
    const origenNombre = origen ? paradaDisplay(origen) : '—';
    const destinoNombre = destino ? paradaDisplay(destino) : '—';
    const nParadas = ruta.paradas?.length || 0;

    const expRows = expsRuta.map(e => renderExpRowLinea(e, ruta)).join('');

    return `
      <div class="trayecto-block">
        <div class="trayecto-block-header">
          <span class="trayecto-block-code">T${i + 1}</span>
          <span class="trayecto-block-nombre" title="${escapeAttr(origenNombre + ' → ' + destinoNombre)}">${escapeHtml(origenNombre)} → ${escapeHtml(destinoNombre)}</span>
          <span class="trayecto-block-count">${expsRuta.length} exp · ${nParadas} paradas</span>
        </div>
        ${expRows}
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="linea-results-wrap">${html}${moreResultsHtml(totalExps, exps.length)}</div>`;

  // Bindear eventos de expansión
  container.querySelectorAll('.linea-exp-row').forEach(row => {
    row.addEventListener('click', () => {
      const expId = row.dataset.expId;
      const detail = container.querySelector(`.linea-exp-detail[data-exp-id="${CSS.escape(expId)}"]`);
      if (!detail) return;
      const isOpen = detail.classList.contains('is-open');
      detail.classList.toggle('is-open', !isOpen);
      row.classList.toggle('is-open', !isOpen);
    });
  });
}

function renderExpRowLinea(exp, ruta) {
  const horaSalida = (exp.horaSalida || '').slice(0, 5);
  const ultimoPaso = exp.pasos?.[exp.pasos.length - 1];
  const horaFin = ultimoPaso ? (ultimoPaso.horaLlegada || '').slice(0, 5) : '—';
  const nParadas = exp.pasos?.length || ruta.paradas?.length || 0;
  const tipoDesc = truncate(cleanMojibake(exp.tipoDia?.descripcion) || '—', 28);

  // ¿Tiene coordenadas alguna parada de esta ruta?
  const tieneCoords = (ruta.paradas || []).some(p => {
    const parada = STATE.indexes.paradaById.get(p.paradaId);
    return parada?.coords?.lat != null;
  });

  const detailHtml = renderExpDetailLinea(exp, ruta);

  return `
    <div class="linea-exp-row" data-exp-id="${escapeAttr(exp.id)}">
      <span class="linea-exp-hora">${escapeHtml(horaSalida)}</span>
      <span class="linea-exp-hora-fin">→ ${escapeHtml(horaFin)}</span>
      <span class="linea-exp-tipo" title="${escapeAttr(cleanMojibake(exp.tipoDia?.descripcion) || '')}">${escapeHtml(tipoDesc)}</span>
      <span class="linea-exp-nparadas">${nParadas} paradas</span>
      <svg class="linea-exp-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <div class="linea-exp-detail" data-exp-id="${escapeAttr(exp.id)}">
      <div class="linea-exp-detail-title">Recorrido completo</div>
      <div class="exp-recorrido">
        ${detailHtml}
      </div>
      <div style="margin-top: 12px; display: flex; justify-content: flex-end;">
        <button class="btn-map" onclick="openMapModal('${escapeAttr(ruta.id)}')" ${tieneCoords ? '' : 'disabled title="No hay coordenadas disponibles"'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
            <line x1="8" y1="2" x2="8" y2="18"/>
            <line x1="16" y1="6" x2="16" y2="22"/>
          </svg>
          Ver en mapa
        </button>
      </div>
    </div>
  `;
}

function renderExpDetailLinea(exp, ruta) {
  const demandaByParada = demandaMap(ruta);
  const pasos = exp.pasos && exp.pasos.length > 0
    ? exp.pasos
    : (ruta.paradas || []).map(p => ({ paradaId: p.paradaId, orden: p.orden, horaLlegada: null, horaSalida: null }));
  const n = pasos.length;
  return pasos.map((paso, i) => {
    const parada = STATE.indexes.paradaById.get(paso.paradaId);
    const nombre = parada ? paradaDisplay(parada) : paso.paradaId;
    const title = parada ? paradaTitle(parada) : '';
    const hora = (paso.horaLlegada || paso.horaSalida || '').slice(0, 5) || '—';
    const cls = i === 0 ? 'is-first' : (i === n - 1 ? 'is-last' : '');
    // Municipio de la parada
    const muni = parada?.municipioId ? STATE.indexes.municipioById.get(parada.municipioId) : null;
    const muniNombre = muni ? muni.nombre : '';
    return `
      <div class="exp-recorrido-stop ${cls}">
        <div class="exp-recorrido-dot"></div>
        <div class="exp-recorrido-nombre" title="${escapeAttr(title || nombre)}">${escapeHtml(nombre)}${demandaByParada.get(paso.paradaId) ? ' ' + DEMANDA_BADGE : ''}</div>
        <div class="exp-recorrido-municipio" title="${escapeAttr(muniNombre)}">${escapeHtml(truncate(muniNombre, 16))}</div>
        <div class="exp-recorrido-hora">${escapeHtml(hora)}</div>
      </div>
    `;
  }).join('');
}

// Mapa paradaId → aDemanda a partir de las paradas de una ruta.
// Las expediciones (pasos) no llevan el flag; vive en ruta.paradas.
function demandaMap(ruta) {
  return new Map((ruta?.paradas || []).map(p => [p.paradaId, !!p.aDemanda]));
}

// Periodos de vigencia de una expedición, cada uno con sus días de la semana.
// Una expedición vigente en varios tramos separados (p. ej. solo los viernes
// lectivos) llega del sincronizador como una única expedición con `periodos`;
// cada periodo lleva `diasSemana` solo si difiere de los del tipo de día.
function periodosExpedicion(exp) {
  const dias = exp.tipoDia?.diasSemana;
  if (Array.isArray(exp.periodos) && exp.periodos.length > 0) {
    return exp.periodos.map(p => ({ desde: p.desde, hasta: p.hasta, diasSemana: p.diasSemana || dias }));
  }
  return [{ desde: exp.validez?.desde, hasta: exp.validez?.hasta, diasSemana: dias }];
}

function mismosDiasSemana(a, b) {
  return DOW_KEYS.every(d => (a?.[d] === true) === (b?.[d] === true));
}

function diaSiguienteKey(key) {
  const d = dateFromKey(key);
  if (!d) return null;
  d.setDate(d.getDate() + 1);
  return formatDateKey(d);
}

// Identidad funcional de una expedición: todo salvo su id, la validez, los
// periodos y los días del tipo de día. Así coinciden tanto las copias de una
// expedición por tramo de vigencia como los service journeys que algunas
// concesiones dan de alta por separado para cada día de la semana.
function claveFusionExpedicion(exp) {
  const { id, validez, periodos, tipoDia, ...resto } = exp;
  const { diasSemana, ...tipo } = tipoDia || {};
  return JSON.stringify([resto, tipo]);
}

// Fechas como número de día (días desde 1970-01-01, UTC) para operar rápido.
const MS_DIA = 86400000;

function numeroDia(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!match) return null;
  const n = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MS_DIA;
  return Number.isFinite(n) ? n : null;
}

function claveDeNumeroDia(n) {
  return new Date(n * MS_DIA).toISOString().slice(0, 10);
}

// Día de la semana (0 = lunes … 6 = domingo, como DOW_KEYS); el 1/1/1970 fue jueves.
function diaSemanaDeNumero(n) {
  return (((n + 3) % 7) + 7) % 7;
}

// Días concretos (números de día) en que circula una expedición según sus
// periodos, o null si alguna fecha no es interpretable.
function fechasDeServicio(periodos) {
  const fechas = new Set();
  for (const p of periodos) {
    const desde = numeroDia(p.desde);
    const hasta = numeroDia(p.hasta);
    if (desde === null || hasta === null) return null;
    const activos = new Set(DOW_KEYS.map((k, i) => (p.diasSemana?.[k] === true ? i : -1)).filter(i => i >= 0));
    for (let n = desde; n <= hasta; n++) {
      if (activos.has(diaSemanaDeNumero(n))) fechas.add(n);
    }
  }
  return fechas;
}

function periodoConDias(desde, hasta, dias) {
  return {
    desde: claveDeNumeroDia(desde),
    hasta: claveDeNumeroDia(hasta),
    diasSemana: Object.fromEntries(DOW_KEYS.map((k, i) => [k, dias.has(i)])),
  };
}

// Expresa días de servicio (números de día ordenados) como periodos exactos:
// un periodo se alarga mientras todos los días de su rango cuyo día de la
// semana está en el periodo sean días de servicio. Misma regla que
// src/domain/merger.py (_codificar_periodos).
function codificarPeriodos(fechas) {
  const servidas = new Set(fechas);
  const periodos = [];
  let inicio = fechas[0];
  let fin = fechas[0];
  let dias = new Set([diaSemanaDeNumero(inicio)]);
  for (const fecha of fechas.slice(1)) {
    const diaFecha = diaSemanaDeNumero(fecha);
    const nuevos = new Set([...dias, diaFecha]);
    // Entre dos días de servicio consecutivos ningún día puede ser de los del periodo.
    let exacto = true;
    for (let n = fin + 1; exacto && n < fecha; n++) {
      if (nuevos.has(diaSemanaDeNumero(n))) exacto = false;
    }
    // Un día de la semana nuevo debe tener servicio en todo el periodo.
    if (exacto && !dias.has(diaFecha)) {
      for (let n = inicio; exacto && n <= fin; n++) {
        if (diaSemanaDeNumero(n) === diaFecha && !servidas.has(n)) exacto = false;
      }
    }
    if (exacto) {
      fin = fecha;
      dias = nuevos;
    } else {
      periodos.push(periodoConDias(inicio, fin, dias));
      inicio = fecha;
      fin = fecha;
      dias = new Set([diaFecha]);
    }
  }
  periodos.push(periodoConDias(inicio, fin, dias));
  return periodos;
}

// Une periodos contiguos o solapados con los mismos días (sin expandir fechas).
function compactarPeriodos(periodos) {
  const compactados = [];
  const ordenados = [...periodos].sort((a, b) => a.desde.localeCompare(b.desde) || a.hasta.localeCompare(b.hasta));
  for (const p of ordenados) {
    const ultimo = compactados[compactados.length - 1];
    const siguiente = ultimo ? diaSiguienteKey(ultimo.hasta) : null;
    if (ultimo && siguiente && p.desde <= siguiente && mismosDiasSemana(ultimo.diasSemana, p.diasSemana)) {
      if (p.hasta > ultimo.hasta) ultimo.hasta = p.hasta;
    } else {
      compactados.push({ ...p });
    }
  }
  return compactados;
}

// La expedición `base` con la vigencia descrita por `compactados`: validez del
// primer al último día, días = unión y, con más de un periodo, `periodos`
// (cada uno con sus días solo si difieren de la unión).
function conPeriodos(base, compactados) {
  const union = Object.fromEntries(DOW_KEYS.map(d => [d, compactados.some(p => p.diasSemana[d] === true)]));
  const fusionada = {
    ...base,
    tipoDia: { ...(base.tipoDia || {}), diasSemana: union },
    validez: {
      desde: compactados[0].desde,
      hasta: compactados.reduce((max, p) => (p.hasta > max ? p.hasta : max), ''),
    },
  };
  if (compactados.length > 1) {
    fusionada.periodos = compactados.map(p => (mismosDiasSemana(p.diasSemana, union)
      ? { desde: p.desde, hasta: p.hasta }
      : { desde: p.desde, hasta: p.hasta, diasSemana: p.diasSemana }));
  } else {
    delete fusionada.periodos;
  }
  return fusionada;
}

// Fusiona los registros de una misma expedición (misma clave funcional), con la
// misma regla que el sincronizador (src/domain/merger.py: fusionar_registros).
// Cada registro se une al primer grupo con el que no comparte ningún día de
// servicio; si coincide algún día con todos, abre un grupo propio (refuerzo).
function fusionarRegistros(registros) {
  const grupos = [];
  for (const registro of registros) {
    const periodos = periodosExpedicion(registro)
      .map(p => ({ desde: p.desde || '', hasta: p.hasta || '', diasSemana: p.diasSemana || {} }));
    const fechas = fechasDeServicio(periodos);
    const grupo = grupos.find(g => !fechas || !g.fechas || ![...fechas].some(f => g.fechas.has(f)));
    if (grupo) {
      grupo.periodos.push(...periodos);
      if (fechas && grupo.fechas) fechas.forEach(f => grupo.fechas.add(f));
      else grupo.fechas = null;
      grupo.total++;
    } else {
      grupos.push({ base: registro, periodos, fechas, total: 1 });
    }
  }
  return grupos.map(g => {
    if (g.total === 1) return g.base;
    if (g.fechas && g.fechas.size > 0) {
      return conPeriodos(g.base, codificarPeriodos([...g.fechas].sort((a, b) => a - b)));
    }
    // Fechas no interpretables o sin ningún día de servicio: se unen los rangos.
    return conPeriodos(g.base, compactarPeriodos(g.periodos));
  });
}

// Las publicaciones anteriores al cambio del sincronizador traen la misma
// expedición repetida (una copia por tramo de vigencia o un service journey
// por día de la semana), y la consulta la mostraba varias veces. Se fusionan al
// cargar; si no hay nada que fusionar la lista se devuelve tal cual.
function fusionarExpedicionesDuplicadas(expediciones) {
  if (!Array.isArray(expediciones)) return [];
  const porClave = new Map();
  let repetidas = false;
  for (const e of expediciones) {
    const clave = claveFusionExpedicion(e);
    const grupo = porClave.get(clave);
    if (grupo) { grupo.push(e); repetidas = true; } else porClave.set(clave, [e]);
  }
  if (!repetidas) return expediciones;

  const resultado = [];
  for (const grupo of porClave.values()) {
    if (grupo.length === 1) resultado.push(grupo[0]);
    else resultado.push(...fusionarRegistros(grupo));
  }
  return resultado.length < expediciones.length ? resultado : expediciones;
}

function buildDaysWithService() {
  // The calendar only needs the currently visible month.
  STATE.daysWithService = new Set();
  const year = Number.isInteger(STATE.calYear) ? STATE.calYear : new Date().getFullYear();
  const month = Number.isInteger(STATE.calMonth) ? STATE.calMonth : new Date().getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const firstKey = formatDateKey(first);
  const lastKey = formatDateKey(last);
  const daysInMonth = last.getDate();
  for (const exp of STATE.indexes.currentExpediciones) {
    for (const periodo of periodosExpedicion(exp)) {
      if (!periodo.desde || !periodo.hasta) continue;
      const ds = periodo.diasSemana;
      if (!ds || !Object.values(ds).some(Boolean)) continue;
      const desdeKey = periodo.desde > firstKey ? periodo.desde : firstKey;
      const hastaKey = periodo.hasta < lastKey ? periodo.hasta : lastKey;
      if (desdeKey > hastaKey) continue;
      const desde = dateFromKey(desdeKey);
      const hasta = dateFromKey(hastaKey);
      if (!desde || !hasta) continue;
      for (let d = desde; d <= hasta; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        const dowKey = DOW_KEYS[dow === 0 ? 6 : dow - 1];
        if (ds[dowKey]) STATE.daysWithService.add(formatDateKey(d));
      }
    }
    if (STATE.daysWithService.size === daysInMonth) break;
  }
}

// Indica si una expedición circula en la fecha local indicada. Esta es la única
// fuente de verdad compartida por el calendario y todos los modos de búsqueda.
function expedicionCirculaEnFecha(exp, date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const dateKey = formatDateKey(date);
  const dow = date.getDay();
  const dowKey = DOW_KEYS[dow === 0 ? 6 : dow - 1];
  return periodosExpedicion(exp).some(p =>
    (!p.desde || dateKey >= p.desde)
    && (!p.hasta || dateKey <= p.hasta)
    && p.diasSemana?.[dowKey] === true
  );
}

function filterExpedicionesPorFecha(expediciones, date) {
  // En modo "Día concreto" no debe aparecer oferta de todas las fechas mientras
  // todavía no haya una fecha válida seleccionada.
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return [];
  return expediciones.filter(exp => expedicionCirculaEnFecha(exp, date));
}

/* ═══════════════════════════════════════════════════════════════════
   4. RENDERIZADO: cabecera, sidebar, líneas
   ═══════════════════════════════════════════════════════════════════ */

function renderHeader() {
  const municipios = STATE.selectedMunicipios;
  const multi = municipios.length >= 2;
  document.getElementById('resultsTitle').textContent = municipiosChainLabel();

  let subtitle;
  if (multi) {
    const intermedios = municipios.slice(1, -1).map(m => m.nombre);
    const exps = STATE.indexes.currentExpediciones.length;
    subtitle = [
      `Origen: ${municipios[0].nombre}`,
      `Destino: ${municipios[municipios.length - 1].nombre}`,
      intermedios.length ? `Vía ${intermedios.join(' · ')}` : '',
      `${exps} viaje${exps !== 1 ? 's' : ''} directo${exps !== 1 ? 's' : ''}`,
    ].filter(Boolean).join(' · ');
  } else {
    const m = municipios[0];
    const provNombre = m ? (PROVINCIAS[m.provincia] || m.provincia || '') : '';
    subtitle = provNombre ? `Provincia de ${provNombre}` : '';
  }
  document.getElementById('resultsSubtitle').textContent = subtitle;

  document.getElementById('metaLineas').textContent = STATE.indexes.currentLineas.length;
  document.getElementById('metaParadas').textContent = STATE.indexes.currentParadasIds.size;
  document.getElementById('metaConcesiones').textContent = STATE.indexes.currentConcesiones.length;
}

function renderSidebar() {
  // ─── Tipo de día ───
  // Conteo dinámico: cuántas expediciones de cada tipo de día caben con los demás filtros activos
  // (excluyendo el filtro de tipo de día para no anularse a sí mismo).
  // En modo "tipoDia" también excluimos el filtro temporal: el tipo de día ES el criterio
  // principal, así que no tiene sentido ocultarlo porque "no aplique hoy".
  const tdList = document.getElementById('tipodia-list');
  if (STATE.indexes.currentTiposDia.length === 0) {
    tdList.innerHTML = '<div class="filter-empty">Sin tipos de día</div>';
  } else {
    const exclTipoDia = STATE.searchMode === 'tipoDia'
      ? { tipoDia: true, temporal: true }   // modo tipo de día: ignorar restricción temporal
      : { tipoDia: true };                  // modo día concreto: respetar el día seleccionado
    const expsForTipoDia = filteredExpediciones(exclTipoDia);
    const countByDesc = new Map();
    for (const e of expsForTipoDia) {
      const td = e.tipoDia;
      if (!td) continue;
      const desc = cleanMojibake(td.descripcion) || td.id;
      countByDesc.set(desc, (countByDesc.get(desc) || 0) + 1);
    }
    tdList.innerHTML = STATE.indexes.currentTiposDia.map(td => {
      const count = countByDesc.get(td.descripcion) || 0;
      const sinAsignar = td.descripcion === 'Sin asignar';
      const checked = STATE.filters.tiposDia.has(td.id);
      // En modo "día concreto" ocultar los incompatibles; en modo "tipoDia" mostrar siempre
      if (STATE.searchMode !== 'tipoDia' && count === 0 && !checked) return '';

      // Tooltip: lista de concesiones a las que pertenece este grupo
      const concesionLabels = Array.from(td.concesionIds)
        .map(cid => STATE.indexes.concesionById.get(cid))
        .filter(Boolean)
        .map(c => prettyConcesionName(c.nombre))
        .sort((a, b) => a.localeCompare(b, 'es'));
      let tooltipText = td.descripcion;
      if (concesionLabels.length === 1) {
        tooltipText = `${td.descripcion} — Concesión: ${concesionLabels[0]}`;
      } else if (concesionLabels.length > 1) {
        tooltipText = `${td.descripcion} — Pertenece a: ${concesionLabels.join(', ')}`;
      }

      return `
        <label class="filter-check${sinAsignar ? ' is-sin-asignar' : ''}">
          <input type="checkbox" data-tipodia-id="${escapeAttr(td.id)}" ${checked ? 'checked' : ''} onchange="onFilterTipoDiaChange(this)">
          <span title="${escapeAttr(tooltipText)}">${escapeHtml(truncate(td.descripcion, 40))}</span>
          <span class="filter-count">${count}</span>
        </label>
      `;
    }).join('');
  }

  // ─── Concesión ───
  // Conteo dinámico: cuántas líneas de cada concesión aparecen con los demás filtros activos
  // (excluyendo el filtro de concesión).
  const cList = document.getElementById('concesion-list');
  const expsForConcesion = filteredExpediciones({ concesion: true });
  const lineasByConc = new Map();
  for (const e of expsForConcesion) {
    if (!lineasByConc.has(e.concesionId)) lineasByConc.set(e.concesionId, new Set());
    lineasByConc.get(e.concesionId).add(e.lineaId);
  }
  const muestraTop = STATE.indexes.currentConcesiones.slice(0, 6);
  cList.innerHTML = muestraTop.map(c => {
    const count = (lineasByConc.get(c.id) || new Set()).size;
    const checked = STATE.filters.concesiones.has(c.id);
    if (count === 0 && !checked) return '';
    return `
      <label class="filter-check">
        <input type="checkbox" data-conc-id="${escapeAttr(c.id)}" ${checked ? 'checked' : ''} onchange="onFilterConcesionChange(this)">
        <span class="concesion-dot" style="background: ${c.color || 'var(--ink-faint)'}"></span>
        <span title="${escapeAttr(c.nombre)}">${escapeHtml(prettyConcesionName(c.nombre))}</span>
        <span class="filter-count">${count}</span>
      </label>
    `;
  }).join('');
  const btnAll = document.getElementById('showAllConcesionesBtn');
  if (STATE.indexes.currentConcesiones.length > 6) {
    btnAll.style.display = '';
    btnAll.firstChild.nodeValue = `Ver las ${STATE.indexes.currentConcesiones.length} concesiones `;
  } else {
    btnAll.style.display = 'none';
  }

  // ─── Tipo de línea ───
  // El grupo solo se muestra cuando hay 2 o más tipos distintos en los resultados
  // actuales (si todas las líneas son del mismo tipo, no hay nada que filtrar).
  // Conteo dinámico: cuántas líneas de cada tipo aparecen con los demás filtros activos.
  const tlGroup = document.getElementById('fg-tipolinea');
  const tlList = document.getElementById('tipolinea-list');
  if (tlGroup && tlList) {
    const tiposPresentes = new Set();
    for (const l of STATE.indexes.currentLineas) tiposPresentes.add(tipoLineaLabel(l));
    if (tiposPresentes.size < 2) {
      tlGroup.style.display = 'none';
      tlList.innerHTML = '';
    } else {
      tlGroup.style.display = '';
      const expsForTipoLinea = filteredExpediciones({ tipoLinea: true });
      const lineasByTL = new Map();
      for (const e of expsForTipoLinea) {
        const label = tipoLineaOfExp(e);
        if (!lineasByTL.has(label)) lineasByTL.set(label, new Set());
        lineasByTL.get(label).add(e.lineaId);
      }
      const labels = Array.from(tiposPresentes).sort((a, b) => a.localeCompare(b, 'es'));
      tlList.innerHTML = labels.map(label => {
        const count = (lineasByTL.get(label) || new Set()).size;
        const checked = STATE.filters.tiposLinea.has(label);
        if (count === 0 && !checked) return '';
        return `
          <label class="filter-check">
            <input type="checkbox" data-tipolinea="${escapeAttr(label)}" ${checked ? 'checked' : ''} onchange="onFilterTipoLineaChange(this)">
            <span>${escapeHtml(label)}</span>
            <span class="filter-count">${count}</span>
          </label>
        `;
      }).join('');
    }
  }

  // ─── Paradas ───
  // Conteo dinámico: cuántas expediciones pasan por cada parada con los demás filtros activos
  // (excluyendo el filtro de parada).
  const pList = document.getElementById('parada-list');
  const expsForParada = filteredExpediciones({ parada: true });
  const countByParada = new Map();
  for (const e of expsForParada) {
    const seen = new Set();
    for (const paso of (e.pasos || [])) {
      if (!seen.has(paso.paradaId) && STATE.indexes.currentParadasIds.has(paso.paradaId)) {
        seen.add(paso.paradaId);
        countByParada.set(paso.paradaId, (countByParada.get(paso.paradaId) || 0) + 1);
      }
    }
  }
  const paradasMun = Array.from(STATE.indexes.currentParadasIds)
    .map(id => STATE.indexes.paradaById.get(id))
    .filter(Boolean)
    .sort((a, b) => (paradaDisplay(a) || '').localeCompare(paradaDisplay(b) || '', 'es'));
  pList.innerHTML = `
    <label class="filter-radio">
      <input type="radio" name="parada" value="" ${!STATE.filters.paradaId ? 'checked' : ''} onchange="onFilterParadaChange(this)">
      <span>Todas las paradas</span>
    </label>
  ` + paradasMun.map(p => {
    const count = countByParada.get(p.id) || 0;
    const checked = STATE.filters.paradaId === p.id;
    if (count === 0 && !checked) return '';
    return `
      <label class="filter-radio">
        <input type="radio" name="parada" value="${escapeAttr(p.id)}" ${checked ? 'checked' : ''} onchange="onFilterParadaChange(this)">
        <span title="${escapeAttr(paradaTitle(p))}">${escapeHtml(truncate(paradaDisplay(p), 30))}</span>
        <span class="filter-count">${count}</span>
      </label>
    `;
  }).join('');
}

function renderLines() {
  // Filtrar expediciones por todos los filtros activos
  const allVisibleExps = filteredExpediciones();
  const { visible: expsVisibles, total: totalExps } = limitedExpeditions(allVisibleExps);

  // Agrupar expediciones por línea
  const expsByLinea = new Map();
  for (const e of expsVisibles) {
    if (!expsByLinea.has(e.lineaId)) expsByLinea.set(e.lineaId, []);
    expsByLinea.get(e.lineaId).push(e);
  }

  // Renderizar tarjetas de línea (solo las que tienen expediciones visibles)
  const lineasVisibles = STATE.indexes.currentLineas.filter(l => {
    const passConcFilter = STATE.filters.concesiones.size === 0
      || STATE.filters.concesiones.has(l.concesionId);
    const passTipoLinea = STATE.filters.tiposLinea.size === 0
      || STATE.filters.tiposLinea.has(tipoLineaLabel(l));
    return passConcFilter && passTipoLinea && expsByLinea.has(l.id);
  });

  const container = document.getElementById('linesContainer');
  if (lineasVisibles.length === 0) {
    container.innerHTML = `
      <div class="empty-state-big" style="padding: 60px 24px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
        <h3>Sin resultados</h3>
        <p>No hay líneas que circulen el día seleccionado con los filtros actuales. Prueba cambiando el día o ajustando los filtros.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = lineasVisibles.map(linea => renderLineCard(linea, expsByLinea.get(linea.id))).join('')
    + moreResultsHtml(totalExps, expsVisibles.length);
  renderActiveFiltersChips();
}

function renderLineCard(linea, expediciones) {
  const conc = STATE.indexes.concesionById.get(linea.concesionId);
  const concColor = conc?.color || 'var(--ink-faint)';
  const concNombre = prettyConcesionName(conc?.nombre) || linea.concesionId || '—';

  // Agrupar expediciones por ruta
  const expsByRuta = new Map();
  for (const e of expediciones) {
    if (!expsByRuta.has(e.rutaId)) expsByRuta.set(e.rutaId, []);
    expsByRuta.get(e.rutaId).push(e);
  }

  // Contar paradas del municipio en esta línea
  const paradasMunEnLinea = new Set();
  for (const rutaId of expsByRuta.keys()) {
    const ruta = STATE.indexes.rutaById.get(rutaId);
    if (!ruta) continue;
    for (const p of ruta.paradas) {
      if (STATE.indexes.currentParadasIds.has(p.paradaId)) {
        paradasMunEnLinea.add(p.paradaId);
      }
    }
  }

  return `
    <article class="line-card" data-linea-id="${escapeAttr(linea.id)}" style="border-left-color: ${concColor};">
      <div class="line-head" onclick="toggleLine(this)">
        <div class="line-code">${escapeHtml(linea.codigo || '—')}</div>
        <div class="line-info">
          <div class="line-name">${escapeHtml(linea.nombre || '—')}</div>
          <div class="line-meta">
            <span class="concesion-tag">
              <span class="concesion-dot" style="background: ${concColor}"></span>
              ${escapeHtml(truncate(concNombre, 36))}
            </span>
            <span class="sep-dot">·</span>
            <span class="tipolinea-tag">${escapeHtml(tipoLineaLabel(linea))}</span>
            <span class="sep-dot">·</span>
            <span>${expediciones.length} expedicion${expediciones.length === 1 ? '' : 'es'}</span>
            <span class="sep-dot">·</span>
            <span class="stops-in-mun">${paradasMunEnLinea.size} parada${paradasMunEnLinea.size === 1 ? '' : 's'} en ${escapeHtml(truncate(municipiosScopeLabel(), 42))}</span>
          </div>
        </div>
        <button class="line-toggle" aria-label="Expandir">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>
      <div class="line-detail">${renderLineDetail(linea, expsByRuta)}</div>
    </article>
  `;
}

function renderLineDetail(linea, expsByRuta) {
  const rutas = Array.from(expsByRuta.keys())
    .map(id => STATE.indexes.rutaById.get(id))
    .filter(Boolean);

  if (rutas.length === 0) {
    return `<p style="color: var(--ink-soft); font-size: 14px;">Sin trayectos disponibles.</p>`;
  }

  const tabs = rutas.map((ruta, i) => {
    const role = roleOfMunicipioInRuta(ruta);
    return `
      <button class="route-tab ${i === 0 ? 'is-active' : ''}" data-route="${escapeAttr(ruta.id)}">
        <span class="route-tab-code">T${i + 1}</span>
        <span class="route-tab-name">${escapeHtml(truncate(ruta.nombre || ruta.codigo || '—', 50))}</span>
        <span class="route-tab-role">${role.label}</span>
      </button>
    `;
  }).join('');

  const panels = rutas.map((ruta, i) => `
    <div class="route-panel ${i === 0 ? 'is-active' : ''}" data-route-panel="${escapeAttr(ruta.id)}">
      ${renderRoutePanel(ruta, expsByRuta.get(ruta.id))}
    </div>
  `).join('');

  return `
    <div class="detail-section-title">${rutas.length === 1 ? 'Trayecto' : 'Trayectos'} de esta línea (${rutas.length})</div>
    <div class="route-tabs">${tabs}</div>
    ${panels}
  `;
}

// Papel de la búsqueda dentro de la ruta. Con una cadena de municipios, "origen"
// se mide contra el primer municipio y "destino" contra el último.
function roleOfMunicipioInRuta(ruta) {
  const paradas = ruta.paradas || [];
  if (paradas.length === 0) return { label: 'Sin paradas', kind: 'none' };
  const total = paradas.length;
  const sets = selectedMunicipioParadaSets();
  const setOrigen = sets[0] || STATE.indexes.currentParadasIds;
  const setDestino = sets[sets.length - 1] || STATE.indexes.currentParadasIds;
  const firstIsMun = setOrigen.has(paradas[0].paradaId);
  const lastIsMun = setDestino.has(paradas[total - 1].paradaId);
  if (firstIsMun && lastIsMun) return { label: 'Origen y destino', kind: 'both' };
  if (firstIsMun) return { label: 'Origen', kind: 'origin' };
  if (lastIsMun) return { label: 'Destino', kind: 'destination' };
  return { label: 'Paso intermedio', kind: 'intermediate' };
}

function renderRoutePanel(ruta, expediciones) {
  const paradas = ruta.paradas || [];
  const role = roleOfMunicipioInRuta(ruta);
  const origenParada = paradas[0] ? STATE.indexes.paradaById.get(paradas[0].paradaId) : null;
  const destinoParada = paradas[paradas.length - 1] ? STATE.indexes.paradaById.get(paradas[paradas.length - 1].paradaId) : null;
  const origenNombre = origenParada ? paradaDisplay(origenParada) : '—';
  const destinoNombre = destinoParada ? paradaDisplay(destinoParada) : '—';
  const origenTitle = origenParada ? paradaTitle(origenParada) : '';
  const destinoTitle = destinoParada ? paradaTitle(destinoParada) : '';
  const munParadas = paradas.filter(p => STATE.indexes.currentParadasIds.has(p.paradaId));

  // Resumen
  const summary = `
    <div class="route-summary">
      <div class="route-summary-block">
        <div class="route-summary-label">Origen</div>
        <div class="route-summary-value"${origenTitle ? ` title="${escapeAttr(origenTitle)}"` : ''}>${escapeHtml(origenNombre)}</div>
      </div>
      <div class="route-summary-arrow">→</div>
      <div class="route-summary-block">
        <div class="route-summary-label">Destino</div>
        <div class="route-summary-value"${destinoTitle ? ` title="${escapeAttr(destinoTitle)}"` : ''}>${escapeHtml(destinoNombre)}</div>
      </div>
      <div class="route-summary-arrow">·</div>
      <div class="route-summary-block">
        <div class="route-summary-label">Paradas</div>
        <div class="route-summary-value">${paradas.length} paradas (${munParadas.length} en ${escapeHtml(truncate(municipiosScopeLabel(), 42))})</div>
      </div>
    </div>
  `;

  // Recorrido
  const recorrido = paradas.map((p, idx) => {
    const parada = STATE.indexes.paradaById.get(p.paradaId);
    const isMun = STATE.indexes.currentParadasIds.has(p.paradaId);
    const isFirst = idx === 0;
    const isLast = idx === paradas.length - 1;
    const cls = [
      'stop-row',
      isFirst ? 'is-origin' : '',
      isLast ? 'is-destination' : '',
      isMun ? 'is-mun' : '',
    ].filter(Boolean).join(' ');
    const nombre = parada ? paradaDisplay(parada) : '(parada desconocida)';
    const titleAttr = parada ? paradaTitle(parada) : '';
    const muniId = parada?.municipioId;
    const muni = muniId ? STATE.indexes.municipioById.get(muniId) : null;
    const tag = isFirst ? 'Cabecera' : (isLast ? 'Destino' : (muni && !isSelectedMunicipioId(muni.id) ? muni.nombre : ''));
    return `
      <div class="${cls}">
        <div class="stop-marker"><div class="stop-dot"></div></div>
        <div class="stop-content">
          <div class="stop-name"${titleAttr ? ` title="${escapeAttr(titleAttr)}"` : ''}>
            ${escapeHtml(nombre)}
            ${tag ? `<span class="stop-mun-tag">${escapeHtml(tag)}</span>` : ''}
            ${p.aDemanda ? DEMANDA_BADGE : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Tabla de expediciones (filas por expedición, columnas: paradas del municipio)
  const munParadasIds = munParadas.map(p => p.paradaId);
  const munParadasObjs = munParadasIds.map(id => STATE.indexes.paradaById.get(id)).filter(Boolean);

  // Ordenar expediciones por hora de paso por la primera parada del municipio
  const expedicionesOrdenadas = [...expediciones].sort((a, b) => {
    const aTime = firstMunPasoTime(a, munParadasIds);
    const bTime = firstMunPasoTime(b, munParadasIds);
    return aTime.localeCompare(bTime);
  });

  const tableHeader = `
    <tr>
      <th class="col-num">#</th>
      <th class="col-time">Salida</th>
      ${munParadasObjs.map(p => `<th class="col-time" title="${escapeAttr(paradaTitle(p))}">${escapeHtml(truncate(paradaDisplay(p), 18))}</th>`).join('')}
      <th class="col-role">Rol</th>
      <th class="col-time">Llegada</th>
    </tr>
  `;

  const tableBody = expedicionesOrdenadas.map((exp, i) => {
    const pasoByParada = new Map();
    for (const paso of exp.pasos || []) pasoByParada.set(paso.paradaId, paso);
    const tdRole = roleOfMunicipioInExp(exp, munParadasIds);
    const salida = exp.pasos?.[0]?.horaSalida || exp.horaSalida || '—';
    const llegada = exp.pasos?.[exp.pasos.length - 1]?.horaLlegada || '—';
    return `
      <tr>
        <td class="col-num">${i + 1}</td>
        <td class="col-time">${escapeHtml(formatHora(salida))}</td>
        ${munParadasObjs.map(p => {
          const paso = pasoByParada.get(p.id);
          if (!paso) return `<td class="col-time is-empty">—</td>`;
          return `<td class="col-time is-mun-time">${escapeHtml(formatHora(paso.horaLlegada))}</td>`;
        }).join('')}
        <td><span class="role-badge role-${tdRole.kind}">${tdRole.label}</span></td>
        <td class="col-time">${escapeHtml(formatHora(llegada))}</td>
      </tr>
    `;
  }).join('');

  const expedicionesTable = expedicionesOrdenadas.length === 0 ? `
    <p style="color: var(--ink-soft); font-size: 13px; padding: 16px;">No hay expediciones para este día con los filtros actuales.</p>
  ` : `
    <div class="expeditions">
      <table class="exp-table">
        <thead>${tableHeader}</thead>
        <tbody>${tableBody}</tbody>
      </table>
    </div>
  `;

  // ¿Hay alguna parada con coordenadas en esta ruta? Si no, deshabilitamos el botón.
  const tieneCoords = paradas.some(p => {
    const parada = STATE.indexes.paradaById.get(p.paradaId);
    return parada?.coords?.lat != null && parada?.coords?.lng != null;
  });

  return `
    <div class="route-actions">
      <button class="btn-map" onclick="openMapModal('${escapeAttr(ruta.id)}')" ${tieneCoords ? '' : 'disabled title="No hay coordenadas disponibles"'}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
          <line x1="8" y1="2" x2="8" y2="18"/>
          <line x1="16" y1="6" x2="16" y2="22"/>
        </svg>
        Ver en mapa
      </button>
    </div>
    ${summary}
    <div class="detail-section-title">Recorrido</div>
    <div class="route">${recorrido}</div>
    <div class="detail-section-title">Expediciones (${expedicionesOrdenadas.length}) — horas en ${escapeHtml(municipiosScopeLabel())}</div>
    ${expedicionesTable}
  `;
}

function roleOfMunicipioInExp(exp, munParadasIds) {
  const munSet = new Set(munParadasIds);
  const pasos = exp.pasos || [];
  if (pasos.length === 0) return { label: '—', kind: 'intermediate' };
  const sets = selectedMunicipioParadaSets();
  const setOrigen = sets[0] || munSet;
  const setDestino = sets[sets.length - 1] || munSet;
  const firstIsMun = setOrigen.has(pasos[0].paradaId);
  const lastIsMun = setDestino.has(pasos[pasos.length - 1].paradaId);
  if (firstIsMun && lastIsMun) return { label: 'Completo', kind: 'origin' };
  if (firstIsMun) return { label: 'Origen', kind: 'origin' };
  if (lastIsMun) return { label: 'Destino', kind: 'destination' };
  return { label: 'Intermedia', kind: 'intermediate' };
}

function firstMunPasoTime(exp, munParadasIds) {
  const munSet = new Set(munParadasIds);
  for (const paso of exp.pasos || []) {
    if (munSet.has(paso.paradaId)) return paso.horaLlegada || paso.horaSalida || '99:99:99';
  }
  return '99:99:99';
}

function paradaName(paradaId) {
  if (!paradaId) return '—';
  const p = STATE.indexes.paradaById.get(paradaId);
  if (!p) return paradaId;
  return paradaDisplay(p);
}

// Devuelve el texto a mostrar para una parada.
// Prioridad: nombre de la stopArea > nombre de la parada.
function paradaDisplay(parada) {
  if (!parada) return '—';
  const stopArea = (parada.stopAreaNombre || '').trim();
  const propio = (parada.nombre || '').trim();
  return stopArea || propio || '(sin nombre)';
}

// Devuelve el texto del tooltip (atributo title) para una parada.
// Si hay nombre de stopArea, el tooltip muestra el nombre propio de la parada.
// Si no, devuelve el propio nombre (sin redundancia).
function paradaTitle(parada) {
  if (!parada) return '';
  const stopArea = (parada.stopAreaNombre || '').trim();
  const propio = (parada.nombre || '').trim();
  if (stopArea && propio && stopArea !== propio) {
    return `${propio} · Parada en ${stopArea}`;
  }
  return propio || stopArea || '';
}

/* ═══════════════════════════════════════════════════════════════════
   5. FILTROS
   ═══════════════════════════════════════════════════════════════════ */

// Devuelve las expediciones que cumplen los filtros activos.
// El parámetro opcional `exclude` permite excluir uno o varios filtros del cálculo,
// útil para los conteos dinámicos (cada filtro lateral recalcula su lista respetando
// los demás filtros pero NO el suyo propio).
function filteredExpediciones(exclude = {}) {
  let list = STATE.indexes.currentExpediciones;

  // Filtro temporal: modo "día concreto" o "tipo de día"
  if (!exclude.temporal) {
    if (STATE.searchMode === 'dia') list = filterExpedicionesPorFecha(list, STATE.selectedDate);
    // En modo 'tipoDia' no se filtra por fecha. Sólo aplica el filtro de tiposDia más abajo.
  }

  // Filtro por tipo de día (siempre aplicable salvo si excluye).
  // Las claves del set son descripciones (no tipoDia.id), porque los tipos están
  // agrupados por descripción en el sidebar. Comparamos la descripción de la
  // expedición ya normalizada (cleanMojibake) o, si no existe, el id como fallback.
  if (!exclude.tipoDia && STATE.filters.tiposDia.size > 0) {
    list = list.filter(e => {
      const td = e.tipoDia;
      if (!td) return false;
      const descripcion = cleanMojibake(td.descripcion) || td.id;
      return STATE.filters.tiposDia.has(descripcion);
    });
  }

  // Filtro por concesión
  if (!exclude.concesion && STATE.filters.concesiones.size > 0) {
    list = list.filter(e => STATE.filters.concesiones.has(e.concesionId));
  }

  // Filtro por tipo de línea
  if (!exclude.tipoLinea && STATE.filters.tiposLinea.size > 0) {
    list = list.filter(e => STATE.filters.tiposLinea.has(tipoLineaOfExp(e)));
  }

  // Filtro por parada concreta
  if (!exclude.parada && STATE.filters.paradaId) {
    list = list.filter(e =>
      (e.pasos || []).some(p => p.paradaId === STATE.filters.paradaId)
    );
  }

  return list;
}

function onFilterTipoDiaChange(input) {
  const id = input.dataset.tipodiaId;
  if (input.checked) STATE.filters.tiposDia.add(id);
  else STATE.filters.tiposDia.delete(id);
  refreshUiAfterFilterChange();
}

function onFilterConcesionChange(input) {
  const id = input.dataset.concId;
  if (input.checked) STATE.filters.concesiones.add(id);
  else STATE.filters.concesiones.delete(id);
  refreshUiAfterFilterChange();
}

function onFilterTipoLineaChange(input) {
  const key = input.dataset.tipolinea;
  if (input.checked) STATE.filters.tiposLinea.add(key);
  else STATE.filters.tiposLinea.delete(key);
  refreshUiAfterFilterChange();
}

function onFilterParadaChange(input) {
  STATE.filters.paradaId = input.value || null;
  refreshUiAfterFilterChange();
}

function updateFilterBadge(badgeId, count) {
  const badge = document.getElementById(badgeId);
  if (!badge) return;
  if (count > 0) {
    badge.style.display = '';
    badge.textContent = count;
  } else {
    badge.style.display = 'none';
  }
}

function renderActiveFiltersChips() {
  const wrap = document.getElementById('activeFilters');
  const chips = [];

  for (const id of STATE.filters.tiposDia) {
    const td = STATE.indexes.currentTiposDia.find(t => t.id === id);
    if (td) chips.push({
      label: `Tipo: ${truncate(td.descripcion, 24)}`,
      remove: () => { STATE.filters.tiposDia.delete(id); refreshUiAfterFilterChange(); },
    });
  }
  if (STATE.filters.concesiones.size > 0) {
    chips.push({
      label: `${STATE.filters.concesiones.size} concesione${STATE.filters.concesiones.size === 1 ? '' : 's'}`,
      remove: () => { STATE.filters.concesiones.clear(); refreshUiAfterFilterChange(); },
    });
  }
  for (const key of STATE.filters.tiposLinea) {
    chips.push({
      label: `Tipo línea: ${truncate(key, 24)}`,
      remove: () => { STATE.filters.tiposLinea.delete(key); refreshUiAfterFilterChange(); },
    });
  }
  if (STATE.filters.paradaId) {
    const p = STATE.indexes.paradaById.get(STATE.filters.paradaId);
    chips.push({
      label: `Parada: ${truncate(p?.nombre || '—', 24)}`,
      remove: () => { STATE.filters.paradaId = null; refreshUiAfterFilterChange(); },
    });
  }

  if (chips.length === 0) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  const existing = wrap.querySelectorAll('.filter-chip');
  existing.forEach(c => c.remove());
  const clearBtn = wrap.querySelector('.clear-all-filters');
  chips.forEach((c, i) => {
    const el = document.createElement('span');
    el.className = 'filter-chip';
    el.innerHTML = `
      ${escapeHtml(c.label)}
      <button class="chip-remove" aria-label="Quitar">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    el.querySelector('.chip-remove').addEventListener('click', c.remove);
    wrap.insertBefore(el, clearBtn);
  });
}

function renderCurrentResults() {
  if (STATE.selectedOperador) {
    renderOperadorExpediciones(STATE.indexes.currentLineas, STATE.indexes.currentRutas, STATE.indexes.currentExpediciones);
  } else if (STATE.selectedConcesion) {
    renderConcesionExpediciones(STATE.selectedConcesion, STATE.indexes.currentLineas, STATE.indexes.currentRutas, STATE.indexes.currentExpediciones);
  } else if (paradaSearchActive()) {
    renderParadaExpediciones(STATE.indexes.currentRutas, STATE.indexes.currentExpediciones);
  } else if (STATE.selectedLinea) {
    renderLineaExpediciones(STATE.selectedLinea, STATE.indexes.currentRutas, STATE.indexes.currentExpediciones);
  } else {
    renderLines();
  }
}

function refreshUiAfterFilterChange() {
  resetResultLimit();
  updateFilterBadge('badgeTipoDia', STATE.filters.tiposDia.size);
  updateFilterBadge('badgeConcesion', STATE.filters.concesiones.size);
  updateFilterBadge('badgeTipoLinea', STATE.filters.tiposLinea.size);
  renderSidebar();
  renderCurrentResults();
  renderActiveFiltersChips();
}

function clearAllFilters() {
  STATE.filters.tiposDia.clear();
  STATE.filters.concesiones.clear();
  STATE.filters.tiposLinea.clear();
  STATE.filters.paradaId = null;
  refreshUiAfterFilterChange();
}

function toggleFilterGroup(id) {
  document.getElementById(id).classList.toggle('is-collapsed');
}

function filterList(input, listId) {
  const q = normalize(input.value);
  const list = document.getElementById(listId);
  list.querySelectorAll('label').forEach(label => {
    const text = normalize(label.textContent);
    label.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
}

/* ═══════════════════════════════════════════════════════════════════
   6. CALENDARIO
   ═══════════════════════════════════════════════════════════════════ */

function initCalendarForMunicipio() {
  const today = new Date();
  STATE.calYear = today.getFullYear();
  STATE.calMonth = today.getMonth();
  // Cada búsqueda arranca en el modo "Por tipo de día" (todas las expediciones,
  // filtrables por tipo), sin día concreto seleccionado.
  STATE.searchMode = 'tipoDia';
  STATE.selectedDate = null;
  applySearchModeUI('tipoDia');
  buildDaysWithService();
  renderCalendar();
}

// Refleja el modo temporal activo en las pestañas y paneles.
function applySearchModeUI(mode) {
  document.querySelectorAll('.search-mode-tab').forEach(tab => {
    const isActive = tab.dataset.mode === mode;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.querySelectorAll('.search-mode-panel').forEach(panel => {
    panel.classList.toggle('is-active', panel.dataset.modePanel === mode);
  });
}

// Cambia el modo de búsqueda temporal (día concreto vs por tipo de día).
function setSearchMode(mode) {
  if (mode !== 'dia' && mode !== 'tipoDia') return;
  STATE.searchMode = mode;
  resetResultLimit();
  if (mode === 'dia') {
    // Evita el estado incoherente "Día concreto" sin fecha: ese estado mostraba
    // expediciones de toda la ventana y hacía que desapareciesen al cambiar de día.
    const selectedKey = STATE.selectedDate ? formatDateKey(STATE.selectedDate) : '';
    if (!STATE.daysWithService.has(selectedKey)) {
      STATE.selectedDate = findFirstDayWithService();
    }
    // Si el primer servicio está en otro mes (p. ej. Benavente → Valladolid),
    // abrir directamente ese mes para que haya un día concreto seleccionable.
    if (STATE.selectedDate) {
      STATE.calYear = STATE.selectedDate.getFullYear();
      STATE.calMonth = STATE.selectedDate.getMonth();
    }
  }
  applySearchModeUI(mode);
  renderCalendar();
  renderSidebar();
  renderCurrentResults();
  renderActiveFiltersChips();
}

function dateFromKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function findFirstDayWithService(referenceDate = new Date()) {
  const keys = Array.from(STATE.daysWithService).sort();
  if (keys.length === 0) return null;
  const referenceKey = formatDateKey(referenceDate);
  // Preferir el primer servicio desde hoy. Si toda la oferta ya pasó, mostrar el
  // último día disponible en vez de dejar el calendario en un mes vacío.
  const key = keys.find(candidate => candidate >= referenceKey) || keys[keys.length - 1];
  return dateFromKey(key);
}

function renderCalendar() {
  document.getElementById('calMonth').textContent =
    `${MONTH_NAMES[STATE.calMonth]} ${STATE.calYear}`;
  document.getElementById('calMonth').style.textTransform = 'capitalize';

  const grid = document.getElementById('calGrid');
  const firstDay = new Date(STATE.calYear, STATE.calMonth, 1);
  const lastDay = new Date(STATE.calYear, STATE.calMonth + 1, 0);
  let startOffset = firstDay.getDay() - 1;
  if (startOffset < 0) startOffset = 6;

  const today = new Date();
  const todayKey = formatDateKey(today);
  const selectedKey = STATE.selectedDate ? formatDateKey(STATE.selectedDate) : '';

  let html = '';
  for (let i = 0; i < startOffset; i++) html += '<button class="cal-day empty" disabled></button>';
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(STATE.calYear, STATE.calMonth, d);
    const key = formatDateKey(date);
    const hasService = STATE.daysWithService.has(key);
    const isToday = key === todayKey;
    const isSelected = key === selectedKey;
    const cls = [
      'cal-day',
      hasService ? 'has-service' : 'no-service',
      isToday ? 'is-today' : '',
      isSelected ? 'is-selected' : '',
    ].filter(Boolean).join(' ');
    html += `<button class="${cls}" data-date="${key}" ${hasService ? '' : 'disabled'}>${d}</button>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.cal-day.has-service').forEach(btn => {
    btn.addEventListener('click', () => {
      const [y, m, day] = btn.dataset.date.split('-').map(Number);
      STATE.selectedDate = new Date(y, m - 1, day);
      resetResultLimit();
      renderCalendar();
      renderSidebar();
      renderCurrentResults();
    });
  });
}

document.querySelectorAll('.cal-nav').forEach(btn => {
  btn.addEventListener('click', () => {
    const dir = parseInt(btn.dataset.dir);
    STATE.calMonth += dir;
    if (STATE.calMonth > 11) { STATE.calMonth = 0; STATE.calYear++; }
    if (STATE.calMonth < 0) { STATE.calMonth = 11; STATE.calYear--; }
    buildDaysWithService();
    renderCalendar();
  });
});

/* ═══════════════════════════════════════════════════════════════════
   7. MODAL DE CONCESIONES
   ═══════════════════════════════════════════════════════════════════ */

let modalPendingSelection = new Set();

function openConcesionModal() {
  const total = STATE.indexes.currentConcesiones.length;
  document.getElementById('modalSubtitle').textContent = `${total} concesiones disponibles en este municipio`;
  document.getElementById('modalTotalCount').textContent = total;
  modalPendingSelection = new Set(STATE.filters.concesiones);

  // Agrupar por letra inicial del código
  const byLetter = new Map();
  for (const c of STATE.indexes.currentConcesiones) {
    const pretty = prettyConcesionName(c.nombre) || c.id || '?';
    const letter = pretty[0].toUpperCase();
    if (!byLetter.has(letter)) byLetter.set(letter, []);
    byLetter.get(letter).push(c);
  }
  const letters = Array.from(byLetter.keys()).sort();

  const html = letters.map(letter => `
    <div class="modal-group-letter">${letter}</div>
    <div class="modal-options">
      ${byLetter.get(letter).map(c => `
        <label class="filter-check">
          <input type="checkbox" data-modal-conc-id="${escapeAttr(c.id)}" ${modalPendingSelection.has(c.id) ? 'checked' : ''}>
          <span class="concesion-dot" style="background: ${c.color || 'var(--ink-faint)'}"></span>
          <span title="${escapeAttr(c.nombre)}">${escapeHtml(prettyConcesionName(c.nombre))}</span>
        </label>
      `).join('')}
    </div>
  `).join('');
  document.getElementById('modal-concesion-list').innerHTML = html;
  document.getElementById('modal-empty').style.display = 'none';

  document.querySelectorAll('#modal-concesion-list input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) modalPendingSelection.add(cb.dataset.modalConcId);
      else modalPendingSelection.delete(cb.dataset.modalConcId);
      updateModalCount();
    });
  });
  updateModalCount();

  document.getElementById('modalConcesion').classList.add('is-open');
  document.body.style.overflow = 'hidden';
}

function closeConcesionModal() {
  document.getElementById('modalConcesion').classList.remove('is-open');
  document.body.style.overflow = '';
}

function applyModalSelection() {
  STATE.filters.concesiones = new Set(modalPendingSelection);
  closeConcesionModal();
  refreshUiAfterFilterChange();
}

function updateModalCount() {
  document.getElementById('modalSelectedCount').textContent = modalPendingSelection.size;
}

function filterModalList(input) {
  const q = normalize(input.value);
  let visibleTotal = 0;
  document.querySelectorAll('#modal-concesion-list .modal-group-letter').forEach(letter => {
    const options = letter.nextElementSibling;
    let visibleInGroup = 0;
    options.querySelectorAll('label').forEach(label => {
      const text = normalize(label.textContent);
      const match = !q || text.includes(q);
      label.style.display = match ? '' : 'none';
      if (match) { visibleInGroup++; visibleTotal++; }
    });
    letter.style.display = visibleInGroup > 0 ? '' : 'none';
    options.style.display = visibleInGroup > 0 ? '' : 'none';
  });
  document.getElementById('modal-empty').style.display = visibleTotal === 0 ? '' : 'none';
}

function bulkSelectModal(state) {
  document.querySelectorAll('#modal-concesion-list input[type="checkbox"]').forEach(cb => {
    const label = cb.closest('label');
    if (label && label.style.display !== 'none') {
      cb.checked = state;
      if (state) modalPendingSelection.add(cb.dataset.modalConcId);
      else modalPendingSelection.delete(cb.dataset.modalConcId);
    }
  });
  updateModalCount();
}

// Cerrar modal con clic fuera o Escape
document.getElementById('modalConcesion').addEventListener('click', (e) => {
  if (e.target.id === 'modalConcesion') closeConcesionModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeConcesionModal();
});

/* ═══════════════════════════════════════════════════════════════════
   8. LÍNEA EXPANDIDA: gestor de tabs
   ═══════════════════════════════════════════════════════════════════ */

function toggleLine(headEl) {
  const card = headEl.closest('.line-card');
  card.classList.toggle('is-open');
  // Asociar listeners de route-tabs al primer abrir
  if (card.classList.contains('is-open') && !card.dataset.tabsBound) {
    card.querySelectorAll('.route-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        const routeId = tab.dataset.route;
        const detail = tab.closest('.line-detail');
        detail.querySelectorAll('.route-tab').forEach(t => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        detail.querySelectorAll('.route-panel').forEach(p => p.classList.remove('is-active'));
        detail.querySelector(`[data-route-panel="${CSS.escape(routeId)}"]`).classList.add('is-active');
      });
    });
    card.dataset.tabsBound = '1';
  }
}

/* ═══════════════════════════════════════════════════════════════════
   9. ÚLTIMAS BÚSQUEDAS (localStorage)
   ═══════════════════════════════════════════════════════════════════ */

const RECENT_SEARCHES_KEY = 'horarios-cyl-recent-searches';
const LEGACY_RECENT_MUNICIPIOS_KEY = 'recentMunicipios';
const RECENT_SEARCH_LIMIT = 8;
const RECENT_MODE_LABELS = {
  municipio: 'Municipio',
  municipios: 'Origen-destino',
  linea: 'Línea',
  parada: 'Parada',
  paradas: 'Origen-destino',
  concesion: 'Concesión',
  operador: 'Operador',
};
// Separador de los ids en una entrada reciente de cadena ('paradas' o 'municipios').
const RECENT_CHAIN_SEP = '>';

function addToRecentSearches(mode, id) {
  if (!mode || !id) return;
  const entry = { mode, id };
  const recent = [
    entry,
    ...loadRecentSearches().filter(item => item.mode !== mode || item.id !== id),
  ].slice(0, RECENT_SEARCH_LIMIT);
  saveRecentSearches(recent);
  renderRecentSearches();
}

function loadRecentSearches() {
  let recent = [];
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]');
    if (Array.isArray(stored)) recent = stored;
  } catch (e) {}

  if (recent.length === 0) {
    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_RECENT_MUNICIPIOS_KEY) || '[]');
      if (Array.isArray(legacy)) {
        recent = legacy.map(id => ({ mode: 'municipio', id }));
        saveRecentSearches(recent);
      }
    } catch (e) {}
  }

  return recent
    .filter(item => item && item.mode && item.id)
    .filter((item, index, arr) =>
      arr.findIndex(other => other.mode === item.mode && other.id === item.id) === index
    )
    .slice(0, RECENT_SEARCH_LIMIT);
}

function saveRecentSearches(recent) {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent));
  } catch (e) {}
}

function clearRecentSearches() {
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
    localStorage.removeItem(LEGACY_RECENT_MUNICIPIOS_KEY);
  } catch (e) {}
  renderRecentSearches();
}

function resolveRecentSearch(entry) {
  const requiredMode = entry.mode === 'municipios'
    ? 'municipio'
    : (entry.mode === 'paradas' ? 'parada' : entry.mode);
  if (!isSearchModeEnabled(requiredMode)) return null;

  if (entry.mode === 'municipio') {
    const municipio = STATE.indexes.municipioById.get(entry.id);
    if (!municipio) return null;
    return {
      ...entry,
      label: municipio.nombre,
      title: municipio.nombre,
      isActive: STATE.selectedMunicipios.length === 1 && STATE.selectedMunicipios[0].id === municipio.id,
      run: () => {
        setSearchTab('municipio');
        document.getElementById('municipioInput').value = '';
        runSearchMunicipios([municipio]);
      },
    };
  }

  // Cadena de municipios en orden (origen → … → destino)
  if (entry.mode === 'municipios') {
    const ids = String(entry.id).split(RECENT_CHAIN_SEP).filter(Boolean);
    const municipios = ids.map(id => STATE.indexes.municipioById.get(id));
    if (municipios.length < 2 || municipios.some(m => !m)) return null;
    return {
      ...entry,
      // Etiqueta corta: la flecha debe sobrevivir al recorte del chip.
      label: `${truncate(municipios[0].nombre, 14)} → ${truncate(municipios[municipios.length - 1].nombre, 14)}`,
      title: municipios.map(m => m.nombre).join(' → '),
      isActive: STATE.selectedMunicipios.length === municipios.length
        && STATE.selectedMunicipios.every((m, i) => m.id === municipios[i].id),
      run: () => {
        setSearchTab('municipio');
        document.getElementById('municipioInput').value = '';
        runSearchMunicipios(municipios);
      },
    };
  }

  if (entry.mode === 'linea') {
    const linea = STATE.indexes.lineaById.get(entry.id);
    if (!linea) return null;
    const label = linea.codigo || linea.nombre || linea.id;
    return {
      ...entry,
      label,
      title: [linea.codigo, linea.nombre].filter(Boolean).join(' — '),
      isActive: STATE.selectedLinea?.id === linea.id,
      run: () => {
        setSearchTab('linea');
        document.getElementById('municipioInput').value = linea.nombre || linea.codigo || '';
        runSearchLinea(linea);
      },
    };
  }

  if (entry.mode === 'parada') {
    const parada = STATE.indexes.paradaById.get(entry.id);
    if (!parada) return null;
    const label = paradaDisplay(parada);
    return {
      ...entry,
      label,
      title: paradaTitle(parada) || label,
      isActive: STATE.selectedParadas.length === 1 && STATE.selectedParadas[0].id === parada.id,
      run: () => {
        setSearchTab('parada');
        document.getElementById('municipioInput').value = '';
        runSearchParadas([parada]);
      },
    };
  }

  // Búsqueda de varias paradas en orden (origen → … → destino)
  if (entry.mode === 'paradas') {
    const ids = String(entry.id).split(RECENT_CHAIN_SEP).filter(Boolean);
    const paradas = ids.map(id => STATE.indexes.paradaById.get(id));
    if (paradas.length < 2 || paradas.some(p => !p)) return null;
    // Etiqueta corta: la flecha debe sobrevivir al recorte del chip.
    const label = `${truncate(paradaDisplay(paradas[0]), 14)} → ${truncate(paradaDisplay(paradas[paradas.length - 1]), 14)}`;
    return {
      ...entry,
      label,
      title: paradas.map(paradaDisplay).join(' → '),
      isActive: STATE.selectedParadas.length === paradas.length
        && STATE.selectedParadas.every((p, i) => p.id === paradas[i].id),
      run: () => {
        setSearchTab('parada');
        document.getElementById('municipioInput').value = '';
        runSearchParadas(paradas);
      },
    };
  }

  if (entry.mode === 'concesion') {
    const concesion = STATE.indexes.concesionById.get(entry.id);
    if (!concesion) return null;
    const label = prettyConcesionName(concesion.nombre) || concesion.id;
    return {
      ...entry,
      label,
      title: concesion.nombre || concesion.id,
      isActive: STATE.selectedConcesion?.id === concesion.id,
      run: () => {
        setSearchTab('concesion');
        document.getElementById('municipioInput').value = label;
        runSearchConcesion(concesion);
      },
    };
  }

  if (entry.mode === 'operador') {
    const operador = STATE.indexes.operadorByNombre.get(entry.id);
    if (!operador) return null;
    return {
      ...entry,
      label: operador.nombre,
      title: operador.nombre,
      isActive: STATE.selectedOperador?.nombre === operador.nombre,
      run: () => {
        setSearchTab('operador');
        document.getElementById('municipioInput').value = operador.nombre;
        runSearchOperador(operador);
      },
    };
  }

  return null;
}

function renderRecentSearches() {
  const wrap = document.getElementById('quickMunicipios');
  if (!wrap) return;

  const items = loadRecentSearches()
    .map(resolveRecentSearch)
    .filter(Boolean);

  if (items.length === 0) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = '';
  wrap.innerHTML = `<span class="quick-label">Últimas búsquedas</span>` +
    items.map(item => `
      <button
        class="chip recent-chip ${item.isActive ? 'is-active' : ''}"
        data-recent-mode="${escapeAttr(item.mode)}"
        data-recent-id="${escapeAttr(item.id)}"
        title="${escapeAttr(item.title)}">
        <span class="chip-type">${escapeHtml(RECENT_MODE_LABELS[item.mode] || item.mode)}</span>
        <span class="chip-text">${escapeHtml(truncate(item.label, 34))}</span>
      </button>
    `).join('') +
    '<button class="recent-clear" type="button" id="clearRecentSearches">Limpiar</button>';

  wrap.querySelectorAll('.recent-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const item = resolveRecentSearch({
        mode: chip.dataset.recentMode,
        id: chip.dataset.recentId,
      });
      if (item) item.run();
    });
  });

  const clearBtn = document.getElementById('clearRecentSearches');
  if (clearBtn) clearBtn.addEventListener('click', clearRecentSearches);
}

/* ═══════════════════════════════════════════════════════════════════
   10. UTILIDADES
   ═══════════════════════════════════════════════════════════════════ */

function normalize(s) {
  if (!s) return '';
  return s.toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function prettyConcesionName(nombre) {
  // Los nombres vienen como "AECL-002 ZonaTransporte OK" o "VACL-161 v10".
  // Devolvemos solo la primera palabra (el código), ignorando el sufijo de versión.
  if (!nombre) return '';
  return nombre.split(/\s+/)[0];
}

// Etiqueta del tipo de línea (p. ej. "Regular sin reserva", "Demanda").
// Se usa como clave estable para el filtro: las líneas sin tipo se agrupan
// bajo "Sin clasificar".
function tipoLineaLabel(linea) {
  return cleanMojibake((linea?.tipoLinea || '').trim()) || 'Sin clasificar';
}

// Tipo de línea de una expedición, vía la línea a la que pertenece.
function tipoLineaOfExp(exp) {
  return tipoLineaLabel(STATE.indexes.lineaById.get(exp.lineaId));
}

function cleanMojibake(s) {
  // Red de seguridad: si quedó algún carácter de reemplazo (\uFFFD) en los datos
  // por un encoding mal resuelto en el backend, intentamos sustituirlo por la
  // letra acentuada más probable según contexto. Si no podemos, lo dejamos como '?'.
  if (!s || s.indexOf('\ufffd') === -1) return s;
  // Patrones más comunes en español
  return s
    .replace(/per\ufffdodo/gi, 'período')
    .replace(/sab\ufffdtico/gi, 'sabático')
    .replace(/mi\ufffdrcoles/gi, 'miércoles')
    .replace(/s\ufffdbado/gi, 'sábado')
    .replace(/n\ufffdmero/gi, 'número')
    .replace(/n\ufffd\./gi, 'nº.')
    .replace(/\ufffd/g, '?');
}

function formatDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Minutos entre dos horas "HH:MM(:SS)"; si el resultado sale negativo se asume
// que el viaje cruza la medianoche.
function minutosEntre(desde, hasta) {
  const aMinutos = (h) => {
    const partes = String(h || '').split(':');
    if (partes.length < 2) return null;
    const hh = Number(partes[0]);
    const mm = Number(partes[1]);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return hh * 60 + mm;
  };
  const a = aMinutos(desde);
  const b = aMinutos(hasta);
  if (a == null || b == null) return null;
  let diff = b - a;
  if (diff < 0) diff += 24 * 60;
  return diff;
}

function formatDuracion(minutos) {
  if (minutos == null) return '';
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function formatHora(hms) {
  if (!hms) return '—';
  return hms.length >= 5 ? hms.substring(0, 5) : hms;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.substring(0, n - 1) + '…' : s;
}

/* ═══════════════════════════════════════════════════════════════════
   11. MAPA (Leaflet)
   ═══════════════════════════════════════════════════════════════════ */

let mapInstance = null;
let mapLayers = []; // markers + polyline para limpiar entre rutas

// Paleta de colores para el mapa general (un color por línea, rotando)
const MAP_PALETTE = [
  '--accent', '--c-cabrero', '--c-autodival', '--c-interbus', '--c-linecar',
  '#0b7285', '#5c4033', '#1a5276', '#7d6608', '#145a32',
];
function colorForLinea(lineaId) {
  // Hash determinista del id para asignar siempre el mismo color a la misma línea
  let h = 0;
  for (let i = 0; i < lineaId.length; i++) h = (h * 31 + lineaId.charCodeAt(i)) >>> 0;
  const token = MAP_PALETTE[h % MAP_PALETTE.length];
  return token.startsWith('--') ? cssVar(token) : token;
}

function isMunicipioMapContext() {
  return municipioSearchActive();
}

// Contextos en los que el mapa distingue las paradas buscadas del resto del
// recorrido: el municipio (sus paradas) y la cadena de paradas / origen → destino.
function mapHighlightsSearchedStops() {
  return isMunicipioMapContext() || paradaSearchActive();
}

function renderMapLegend(mode) {
  const legend = document.getElementById('mapLegend');
  if (!legend) return;

  if (mode === 'route' && mapHighlightsSearchedStops()) {
    const etiqueta = isMunicipioMapContext()
      ? `Paradas en ${escapeHtml(truncate(municipiosScopeLabel(), 42))}`
      : (STATE.selectedParadas.length === 1 ? 'Parada buscada' : 'Paradas del recorrido buscado');
    legend.innerHTML = `
      <div class="map-legend-item">
        <span class="map-legend-dot" style="background: var(--accent);"></span>
        <span>${etiqueta}</span>
      </div>
      <div class="map-legend-item">
        <span class="map-legend-dot" style="background: var(--map-muted);"></span>
        <span>Otras paradas</span>
      </div>
      <div class="map-legend-item">
        <span class="map-legend-line" style="background: var(--accent);"></span>
        <span>Recorrido (aproximado)</span>
      </div>
    `;
    return;
  }

  const recorridoLabel = mode === 'general'
    ? 'Recorridos por línea (aprox.)'
    : 'Recorrido (aproximado)';
  legend.innerHTML = `
    <div class="map-legend-item">
      <span class="map-legend-dot" style="background: var(--accent);"></span>
      <span>Paradas</span>
    </div>
    <div class="map-legend-item">
      <span class="map-legend-line" style="background: linear-gradient(90deg, var(--accent), var(--c-cabrero), var(--c-autodival));"></span>
      <span>${recorridoLabel}</span>
    </div>
  `;
}

function openMapModalGeneral() {
  if (typeof L === 'undefined') {
    alert('La librería de mapas no se ha podido cargar. Comprueba tu conexión a internet.');
    return;
  }

  // Recoger todas las rutas visibles (currentRutas ya está filtrado por el contexto actual)
  const rutasAMostrar = STATE.indexes.currentRutas;
  if (!rutasAMostrar || rutasAMostrar.length === 0) {
    alert('No hay rutas disponibles para mostrar en el mapa.');
    return;
  }

  // Título según el modo de búsqueda activo
  let titulo = 'Todos los recorridos';
  if (municipioSearchActive()) {
    titulo = STATE.selectedMunicipios.length === 1
      ? `Recorridos en ${municipiosChainLabel()}`
      : `Recorridos de ${municipiosChainLabel()}`;
  }
  else if (STATE.selectedLinea) titulo = `${STATE.selectedLinea.codigo} — ${STATE.selectedLinea.nombre}`;
  else if (paradaSearchActive()) {
    titulo = STATE.selectedParadas.length === 1
      ? `Recorridos por ${paradasChainLabel()}`
      : `Recorridos de ${paradasChainLabel()}`;
  }
  else if (STATE.selectedConcesion) titulo = `Recorridos de ${prettyConcesionName(STATE.selectedConcesion.nombre) || STATE.selectedConcesion.id}`;
  else if (STATE.selectedOperador) titulo = `Recorridos de ${STATE.selectedOperador.nombre}`;

  document.getElementById('mapModalTitle').textContent = titulo;
  document.getElementById('mapModalSub').textContent =
    `${rutasAMostrar.length} trayecto${rutasAMostrar.length !== 1 ? 's' : ''} · ${STATE.indexes.currentLineas.length} línea${STATE.indexes.currentLineas.length !== 1 ? 's' : ''}`;

  renderMapLegend('general');
  document.getElementById('mapModal').classList.add('is-open');
  document.body.style.overflow = 'hidden';

  setTimeout(() => renderMapGeneral(rutasAMostrar), 50);
}

function renderMapGeneral(rutas) {
  // Crear instancia si es la primera vez (misma que usa openMapModal)
  if (!mapInstance) {
    mapInstance = L.map('map', {
      preferCanvas: true,
      attributionControl: true,
    }).setView([41.5, -4.0], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapInstance);
  }

  // Limpiar capas previas
  for (const layer of mapLayers) mapInstance.removeLayer(layer);
  mapLayers = [];
  const prevWarn = document.querySelector('.map-warning-nocoords');
  if (prevWarn) prevWarn.remove();

  const allPoints = [];

  for (const ruta of rutas) {
    const color = colorForLinea(ruta.lineaId || ruta.id);
    const linea = STATE.indexes.lineaById.get(ruta.lineaId);
    const lineaLabel = linea ? `${linea.codigo} — ${linea.nombre}` : (ruta.nombre || ruta.id);
    const paradas = ruta.paradas || [];
    const points = [];

    for (let i = 0; i < paradas.length; i++) {
      const p = paradas[i];
      const parada = STATE.indexes.paradaById.get(p.paradaId);
      if (!parada || parada.coords?.lat == null || parada.coords?.lng == null) continue;

      const latlng = [parada.coords.lat, parada.coords.lng];
      points.push(latlng);
      allPoints.push(latlng);

      const isFirst = i === 0;
      const isLast = i === paradas.length - 1;
      const isTerminal = isFirst || isLast;

      const marker = L.circleMarker(latlng, {
        radius: isTerminal ? 7 : 5,
        fillColor: color,
        color: cssVar('--paper'),
        weight: isTerminal ? 2 : 1.5,
        opacity: 1,
        fillOpacity: isTerminal ? 1 : 0.75,
      });

      const tag = isFirst ? 'Origen' : (isLast ? 'Destino' : '');
      const muniNombre = parada.municipioId
        ? STATE.indexes.municipioById.get(parada.municipioId)?.nombre : null;

      marker.bindPopup(`
        <div style="font-weight:600;font-size:13px;">${escapeHtml(paradaDisplay(parada))}${tag ? ` <span style="color:var(--ink-faint);font-weight:400">— ${tag}</span>` : ''}</div>
        <div style="font-size:11px;color:var(--ink-faint);margin-top:3px;">${escapeHtml(lineaLabel)}</div>
        ${muniNombre ? `<div style="font-size:11px;color:var(--ink-faint);">${escapeHtml(muniNombre)}</div>` : ''}
      `);
      marker.addTo(mapInstance);
      mapLayers.push(marker);
    }

    if (points.length >= 2) {
      const line = L.polyline(points, {
        color,
        weight: 2.5,
        opacity: 0.7,
        dashArray: '6, 4',
      });
      line.bindPopup(`<div style="font-weight:600;font-size:13px;">${escapeHtml(lineaLabel)}</div>`);
      line.addTo(mapInstance);
      mapLayers.push(line);
    }
  }

  if (allPoints.length === 0) {
    const warn = document.createElement('div');
    warn.className = 'map-warning-nocoords';
    warn.innerHTML = `<h4>Sin coordenadas</h4><p>Ninguna parada de los trayectos visibles tiene coordenadas geográficas disponibles.</p>`;
    document.querySelector('.map-container').appendChild(warn);
    return;
  }

  if (allPoints.length === 1) {
    mapInstance.setView(allPoints[0], 14);
  } else {
    mapInstance.fitBounds(L.latLngBounds(allPoints), { padding: [40, 40] });
  }

  setTimeout(() => mapInstance.invalidateSize(), 50);
}

function openMapModal(rutaId) {
  if (typeof L === 'undefined') {
    alert('La librería de mapas no se ha podido cargar. Comprueba tu conexión a internet.');
    return;
  }
  const ruta = STATE.indexes.rutaById.get(rutaId);
  if (!ruta) return;

  document.getElementById('mapModalTitle').textContent = ruta.nombre || ruta.codigo || 'Trayecto';
  const linea = STATE.indexes.lineaById.get(ruta.lineaId);
  const subParts = [];
  if (linea) subParts.push(`Línea ${linea.codigo} — ${linea.nombre}`);
  subParts.push(`${(ruta.paradas || []).length} paradas`);
  document.getElementById('mapModalSub').textContent = subParts.join(' · ');

  renderMapLegend('route');
  document.getElementById('mapModal').classList.add('is-open');
  document.body.style.overflow = 'hidden';

  // Inicializar el mapa la primera vez (después de que el modal sea visible)
  setTimeout(() => renderMapForRuta(ruta), 50);
}

function closeMapModal() {
  document.getElementById('mapModal').classList.remove('is-open');
  document.body.style.overflow = '';
  // No destruyo el mapa, solo limpio capas. La instancia se reutiliza.
}

function renderMapForRuta(ruta) {
  // Crear instancia si es la primera vez
  if (!mapInstance) {
    mapInstance = L.map('map', {
      preferCanvas: true,  // mejor rendimiento si hay muchas paradas
      attributionControl: true,
    }).setView([41.5, -4.0], 8); // Centro aproximado en Castilla y León
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapInstance);
  }

  // Limpiar capas previas
  for (const layer of mapLayers) mapInstance.removeLayer(layer);
  mapLayers = [];
  // Quitar warning previo si existía
  const prevWarn = document.querySelector('.map-warning-nocoords');
  if (prevWarn) prevWarn.remove();

  const paradas = ruta.paradas || [];
  const points = [];
  const markers = [];

  // Pre-cargar referencias a expediciones de esta ruta y día para mostrar la primera hora de paso
  const expsRuta = STATE.indexes.currentExpediciones.filter(e => e.rutaId === ruta.id);
  const horaPasoByParadaId = new Map();
  if (expsRuta.length > 0) {
    // Tomamos la primera expedición que circule hoy para los popups (representativa)
    const primera = expsRuta[0];
    for (const paso of primera.pasos || []) {
      if (!horaPasoByParadaId.has(paso.paradaId)) {
        horaPasoByParadaId.set(paso.paradaId, paso.horaLlegada || paso.horaSalida);
      }
    }
  }

  for (let i = 0; i < paradas.length; i++) {
    const p = paradas[i];
    const parada = STATE.indexes.paradaById.get(p.paradaId);
    if (!parada || parada.coords?.lat == null || parada.coords?.lng == null) continue;

    const highlightMunicipioStops = mapHighlightsSearchedStops();
    const isMun = highlightMunicipioStops && STATE.indexes.currentParadasIds.has(p.paradaId);
    const isFirst = i === 0;
    const isLast = i === paradas.length - 1;
    const latlng = [parada.coords.lat, parada.coords.lng];
    points.push(latlng);

    // Solo la búsqueda por municipio separa paradas del municipio frente al resto.
    const fillColor = highlightMunicipioStops
      ? (isMun ? cssVar('--accent') : cssVar('--map-muted'))
      : cssVar('--accent');
    const radius = isMun ? 8 : 6;

    const marker = L.circleMarker(latlng, {
      radius,
      fillColor,
      color: cssVar('--paper'),
      weight: 2,
      opacity: 1,
      fillOpacity: 0.95,
    });

    const muniNombre = parada.municipioId
      ? STATE.indexes.municipioById.get(parada.municipioId)?.nombre
      : null;
    const horaPaso = horaPasoByParadaId.get(p.paradaId);
    const tag = isFirst ? 'Origen' : (isLast ? 'Destino' : '');

    const popup = `
      <div class="popup-stop-name">${escapeHtml(paradaDisplay(parada))}${tag ? ` <span style="color: var(--ink-faint); font-weight: 400;">— ${tag}</span>` : ''}</div>
      ${(parada.stopAreaNombre && parada.nombre && parada.stopAreaNombre.trim() !== parada.nombre.trim())
        ? `<div class="popup-stop-meta" style="font-style: italic;">Parada: ${escapeHtml(parada.nombre)}</div>`
        : ''}
      ${muniNombre ? `<div class="popup-stop-meta">${escapeHtml(muniNombre)}</div>` : ''}
      ${parada.publicCode ? `<div class="popup-stop-meta">Código: ${escapeHtml(parada.publicCode)}</div>` : ''}
      ${horaPaso ? `<div class="popup-stop-time">${escapeHtml(formatHora(horaPaso))}</div>` : ''}
    `;
    marker.bindPopup(popup);
    marker.addTo(mapInstance);
    mapLayers.push(marker);
    markers.push(marker);
  }

  // Si no hay puntos con coordenadas, mostrar mensaje y abortar
  if (points.length === 0) {
    const warn = document.createElement('div');
    warn.className = 'map-warning-nocoords';
    warn.innerHTML = `
      <h4>Sin coordenadas</h4>
      <p>Ninguna parada de este trayecto tiene coordenadas geográficas disponibles.</p>
    `;
    document.querySelector('.map-container').appendChild(warn);
    return;
  }

  // Polilínea conectando paradas (recorrido aproximado, en línea recta)
  if (points.length >= 2) {
    const line = L.polyline(points, {
      color: cssVar('--accent'),
      weight: 3,
      opacity: 0.7,
      dashArray: '6, 4', // discontinua para indicar que es aproximada
    });
    line.addTo(mapInstance);
    mapLayers.push(line);
  }

  // Ajustar viewport para que todas las paradas quepan
  if (points.length === 1) {
    mapInstance.setView(points[0], 14);
  } else {
    const bounds = L.latLngBounds(points);
    mapInstance.fitBounds(bounds, { padding: [40, 40] });
  }

  // Forzar redimensionado por si el modal acaba de aparecer y el mapa midió mal
  setTimeout(() => mapInstance.invalidateSize(), 50);
}

// Cerrar modal del mapa con clic fuera o Escape
document.getElementById('mapModal').addEventListener('click', (e) => {
  if (e.target.id === 'mapModal') closeMapModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMapModal();
});

/* ═══════════════════════════════════════════════════════════════════
   11b. EXPORTAR RESULTADOS A WORD
   Genera un documento Word (.doc) en el navegador a partir de la búsqueda
   actual, reproduciendo la rejilla paradas × expediciones (horas de paso)
   por línea y trayecto. Sin dependencias: HTML con cabecera MSO que Word
   abre de forma nativa.
   ═══════════════════════════════════════════════════════════════════ */

// Expediciones realmente mostradas según el modo de búsqueda y los filtros.
function currentDisplayedExpediciones() {
  if (STATE.selectedConcesion) return filteredExpedicionesConcesion();
  if (paradaSearchActive()) return filteredExpedicionesParada();
  if (STATE.selectedLinea) return filteredExpedicionesLinea();
  return filteredExpediciones(); // municipio y operador
}

// Contexto de la exportación según el eje de búsqueda activo.
function exportContext() {
  if (municipioSearchActive()) {
    return STATE.selectedMunicipios.length === 1
      ? { modo: 'Municipio', titulo: municipiosChainLabel() }
      : { modo: 'Origen-destino', titulo: municipiosChainLabel() };
  }
  if (STATE.selectedLinea) return { modo: 'Línea', titulo: `${STATE.selectedLinea.codigo} — ${STATE.selectedLinea.nombre}` };
  if (paradaSearchActive()) {
    return STATE.selectedParadas.length === 1
      ? { modo: 'Parada', titulo: paradasChainLabel() }
      : { modo: 'Origen-destino', titulo: paradasChainLabel() };
  }
  if (STATE.selectedConcesion) return { modo: 'Concesión', titulo: prettyConcesionName(STATE.selectedConcesion.nombre) || STATE.selectedConcesion.id };
  if (STATE.selectedOperador) return { modo: 'Operador', titulo: STATE.selectedOperador.nombre };
  return { modo: '', titulo: 'Resultados' };
}

const DOW_EXPORT = [
  ['lunes', 'L'], ['martes', 'M'], ['miercoles', 'X'], ['jueves', 'J'],
  ['viernes', 'V'], ['sabado', 'S'], ['domingo', 'D'],
];

function exportDiasSemana(tipoDia) {
  const ds = tipoDia?.diasSemana || {};
  return DOW_EXPORT.map(([k, abbr]) =>
    ds[k]
      ? `<b style="color:#00695c">${abbr}</b>`
      : `<span style="color:#bbb">${abbr}</span>`
  ).join(' ');
}

function exportPasoMap(exp) {
  const m = new Map();
  for (const p of (exp.pasos || [])) {
    const hora = (p.horaSalida || p.horaLlegada || '').slice(0, 5);
    if (hora) m.set(p.paradaId, hora);
  }
  return m;
}

// Escala de fuente según el nº de expediciones (columnas), para que las tablas
// anchas sigan cabiendo en la página apaisada sin partir las horas "HH:MM".
function exportColScale(ncols) {
  if (ncols <= 12) return { hh: 9, dow: 7, tipo: 6.5, body: 8 };
  if (ncols <= 18) return { hh: 8, dow: 6, tipo: 5.5, body: 7 };
  if (ncols <= 26) return { hh: 7, dow: 5, tipo: 5, body: 6 };
  return { hh: 6, dow: 4.5, tipo: 4.5, body: 5.5 };
}

// Tabla de un trayecto: filas = paradas, columnas = expediciones.
function exportTrayectoTabla(ruta, indice, exps, targetStops, demandaByParada) {
  const stops = (ruta.paradas || []).slice().sort((a, b) => (a.orden || 0) - (b.orden || 0));
  const ordenadas = exps.slice().sort((a, b) => (a.horaSalida || '').localeCompare(b.horaSalida || ''));
  const pasoMaps = ordenadas.map(exportPasoMap);
  const sz = exportColScale(ordenadas.length);

  const origen = stops.length ? paradaDisplay(STATE.indexes.paradaById.get(stops[0].paradaId)) : '—';
  const destino = stops.length ? paradaDisplay(STATE.indexes.paradaById.get(stops[stops.length - 1].paradaId)) : '—';

  let head = `<th class="stopcol">Parada / secuencia</th>`;
  for (const exp of ordenadas) {
    const tipo = (exp.tipoDia?.descripcion || '').trim();
    head += `<th class="exphdr"><div class="hh" style="font-size:${sz.hh}pt">${escapeHtml((exp.horaSalida || '').slice(0, 5))}</div>`
      + `<div class="dow" style="font-size:${sz.dow}pt">${exportDiasSemana(exp.tipoDia)}</div>`
      + (tipo ? `<div class="tipo" style="font-size:${sz.tipo}pt">${escapeHtml(tipo)}</div>` : '')
      + `</th>`;
  }

  let rows = '';
  stops.forEach((s, ri) => {
    const parada = STATE.indexes.paradaById.get(s.paradaId);
    const nombre = parada ? paradaDisplay(parada) : '—';
    const mun = parada && parada.municipioId ? STATE.indexes.municipioById.get(parada.municipioId) : null;
    const munNombre = mun ? mun.nombre : '';
    const esTarget = targetStops.has(s.paradaId);
    const demanda = demandaByParada.get(s.paradaId) ? ` <span class="dem">A demanda</span>` : '';
    let celdas = `<td class="stopcell${esTarget ? ' target' : ''}">`
      + `<b>${ri + 1}. ${escapeHtml((munNombre || nombre).toUpperCase())}</b>${esTarget ? ' <span class="aqui">● aquí</span>' : ''}`
      + `<div class="stopname">${escapeHtml(nombre)}${demanda}</div></td>`;
    for (const pm of pasoMaps) {
      const h = pm.get(s.paradaId);
      celdas += `<td class="hcell${h ? '' : ' empty'}" style="font-size:${sz.body}pt">${h ? escapeHtml(h) : '·'}</td>`;
    }
    rows += `<tr>${celdas}</tr>`;
  });

  const dir = ((ruta.direccion || '').toLowerCase());
  const dirLbl = dir === 'outbound' ? 'IDA ' : dir === 'inbound' ? 'VUELTA ' : '';
  return `<p class="tray">${dirLbl}T${indice + 1} &nbsp; ${escapeHtml(origen)} &rarr; ${escapeHtml(destino)}`
    + ` <span class="traymeta">(${stops.length} paradas · ${ordenadas.length} expedición(es))</span></p>`
    + `<table class="grid"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

const EXPORT_NOTA_LEYENDA = 'Las cabeceras L · M · X · J · V · S · D indican los días de la semana en que circula cada expedición. Las paradas marcadas como «A demanda» solo se atienden bajo petición previa.';

// Cuerpo del documento: por cada línea (en el orden recibido), sus trayectos
// con expediciones. Compartido por la exportación individual y la masiva.
function exportCuerpoLineas(lineas, rutasCandidatas, exps, targetStops) {
  // Agrupar expediciones por ruta y rutas por línea.
  const expsByRuta = new Map();
  for (const e of exps) {
    if (!expsByRuta.has(e.rutaId)) expsByRuta.set(e.rutaId, []);
    expsByRuta.get(e.rutaId).push(e);
  }
  const rutasByLinea = new Map();
  for (const r of rutasCandidatas) {
    if (!r.lineaId) continue;
    if (!rutasByLinea.has(r.lineaId)) rutasByLinea.set(r.lineaId, []);
    rutasByLinea.get(r.lineaId).push(r);
  }

  let cuerpo = '';
  for (const linea of lineas) {
    const rutas = (rutasByLinea.get(linea.id) || []).filter(r => (expsByRuta.get(r.id) || []).length > 0);
    if (!rutas.length) continue;
    const conc = STATE.indexes.concesionById.get(linea.concesionId);
    const concLabel = conc ? (prettyConcesionName(conc.nombre) || conc.id) : '';
    const operador = conc && conc.operador ? conc.operador : '';
    const sub = [concLabel, tipoLineaLabel(linea), operador ? `Operador: ${operador}` : '']
      .filter(Boolean).join(' · ');
    cuerpo += `<h2 class="linea">[${escapeHtml(linea.codigo || '—')}] ${escapeHtml(linea.nombre || '')}</h2>`;
    if (sub) cuerpo += `<p class="lineameta">${escapeHtml(sub)}</p>`;
    rutas.forEach((ruta, i) => {
      const demandaByParada = new Map((ruta.paradas || []).map(p => [p.paradaId, !!p.aDemanda]));
      cuerpo += exportTrayectoTabla(ruta, i, expsByRuta.get(ruta.id), targetStops, demandaByParada);
    });
  }
  return cuerpo;
}

// "N línea(s) · N parada(s) · N concesión(es) · N expedición(es)".
function exportResumenOferta(nLineas, exps) {
  const nParadas = new Set(exps.flatMap(e => (e.pasos || []).map(p => p.paradaId))).size;
  const nConc = new Set(exps.map(e => e.concesionId)).size;
  return `${nLineas} línea(s) · ${nParadas} parada(s) · ${nConc} concesión(es) · ${exps.length} expedición(es)`;
}

function exportCriterioTemporalLabel(searchMode, selectedDate, tiposDia) {
  if (searchMode === 'dia' && selectedDate) {
    return `Día concreto: ${selectedDate.toLocaleDateString('es-ES')}`;
  }
  if (tiposDia && tiposDia.size > 0) {
    return `Tipos de día: ${Array.from(tiposDia).join(', ')}`;
  }
  return 'Todas las fechas de la ventana';
}

function exportFechaGeneracion() {
  return new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function exportSearchToWord() {
  const results = document.getElementById('results');
  if (!results || results.style.display === 'none') {
    alert('Realiza primero una búsqueda para poder exportarla.');
    return;
  }
  const exps = currentDisplayedExpediciones();
  if (!exps.length) {
    alert('No hay resultados que exportar con los filtros actuales.');
    return;
  }

  const ctx = exportContext();
  const targetStops = (STATE.indexes.currentParadasIds instanceof Set)
    ? STATE.indexes.currentParadasIds : new Set();

  const cuerpo = exportCuerpoLineas(STATE.indexes.currentLineas, STATE.indexes.currentRutas, exps, targetStops);

  // Resumen / cabecera del documento.
  const temporal = exportCriterioTemporalLabel(STATE.searchMode, STATE.selectedDate, STATE.filters.tiposDia);
  const cabecera = `
    <h1>Visualizador de oferta</h1>
    <p class="ctx">${escapeHtml(ctx.modo ? ctx.modo + ': ' : '')}<b>${escapeHtml(ctx.titulo)}</b></p>
    <p class="meta">${exportResumenOferta(STATE.indexes.currentLineas.length, exps)}</p>
    <p class="meta">${escapeHtml(temporal)} · Generado el ${escapeHtml(exportFechaGeneracion())}</p>
    <p class="note">${EXPORT_NOTA_LEYENDA}</p>`;

  const html = buildWordHtml(`Visualizador de oferta — ${ctx.titulo}`, cabecera + cuerpo);
  const nombre = `Visualizador_oferta_${ctx.modo}_${ctx.titulo}`
    .replace(/[^\w\sáéíóúüñ-]/gi, '').replace(/\s+/g, '_').slice(0, 80) || 'Visualizador_oferta';
  downloadDoc(nombre + '.doc', html);
}

function buildWordHtml(titulo, cuerpo, estilosExtra = '') {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(titulo)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>
@page { size: 29.7cm 21cm; mso-page-orientation: landscape; margin: 1.2cm; }
body { font-family: Calibri, Arial, sans-serif; font-size: 10pt; color: #1a1a1a; }
h1 { font-size: 20pt; color: #00695c; margin: 0 0 2pt 0; }
h2.linea { font-size: 13pt; color: #00695c; margin: 14pt 0 0 0; border-bottom: 1pt solid #cccccc; }
p.ctx { font-size: 12pt; margin: 0 0 2pt 0; }
p.meta { font-size: 9pt; color: #666; margin: 0; }
p.note { font-size: 8.5pt; color: #666; font-style: italic; margin: 4pt 0 0 0; }
p.lineameta { font-size: 9pt; color: #666; margin: 1pt 0 4pt 0; }
p.tray { font-size: 10pt; font-weight: bold; margin: 8pt 0 2pt 0; }
p.tray .traymeta { font-weight: normal; font-size: 8.5pt; color: #888; }
table.grid { border-collapse: collapse; width: 100%; mso-table-layout-alt: fixed; }
table.grid th, table.grid td { border: 0.5pt solid #999999; padding: 2pt 3pt; font-size: 8pt; vertical-align: top; }
th.stopcol, td.stopcell { text-align: left; width: 5cm; }
th.exphdr { background: #eeeeee; text-align: center; }
th.exphdr .hh { font-size: 9pt; font-weight: bold; }
th.exphdr .dow { font-size: 7pt; }
th.exphdr .tipo { font-size: 6.5pt; color: #888; }
td.stopcell { background: #fafafa; }
td.stopcell.target { background: #e0f2f1; }
td.stopcell .stopname { font-size: 7pt; color: #888; font-weight: normal; }
td.stopcell .aqui { color: #00695c; font-size: 7pt; }
td.stopcell .dem { color: #b26a00; font-size: 6.5pt; }
td.hcell { text-align: center; }
td.hcell.empty { color: #cccccc; }
${estilosExtra}</style></head>
<body>${cuerpo}</body></html>`;
}

function downloadDoc(filename, html) {
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ═══════════════════════════════════════════════════════════════════
   12. ARRANQUE
   ═══════════════════════════════════════════════════════════════════ */

let appInitialized = false;

// Inicializa el visualizador (datos + listeners). Idempotente: solo la primera vez.
async function initializeApp() {
  if (appInitialized) return;
  appInitialized = true;

  // Tema oscuro fijo (alineado con ITS Suite); el selector claro/oscuro se retiró.

  // Los datos se descargan comprimidos (.json.gz) y se descomprimen en el
  // navegador antes de continuar. Ver html/js/data-loader.js.
  if (typeof loadAppData === 'function') {
    try {
      await loadAppData();
    } catch (err) {
      console.error('Fallo al cargar los datos comprimidos:', err);
    }
  }

  configureSearchModes();
  const ok = detectData();
  injectMeta();

  // Tabs de búsqueda (solo visual)
  // Las pestañas del buscador ya tienen onclick="setSearchTab(...)" inline

  // Botón Consultar
  document.getElementById('searchBtn').addEventListener('click', triggerSearch);

  // Hero colapsable
  document.getElementById('heroCollapse').addEventListener('click', () => {
    document.getElementById('hero').classList.toggle('is-collapsed');
  });

  if (ok) {
    setupAutocomplete();
    renderRecentSearches();
  }
}

// Arranque directo de la distribuciÃ³n estÃ¡tica independiente.
(async function bootstrapStandalone() {
  await initializeApp();
})();
