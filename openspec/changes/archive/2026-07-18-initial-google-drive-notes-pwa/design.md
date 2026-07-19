# Diseño técnico

## Contexto

La aplicación debe ejecutarse como sitio estático y PWA instalada en iOS. Safari no puede recibir acceso permanente a una carpeta arbitraria de iCloud Drive desde una web, por lo que Google Drive se usa como almacenamiento remoto mediante su API. No existe servidor de confianza propio: todo el código de aplicación se ejecuta en el navegador.

## Objetivos de diseño

1. Mantener Markdown como formato portable y legible.
2. Evitar backend, secretos de cliente y refresh tokens.
3. Ofrecer una experiencia rápida incluso con red lenta o sin conexión.
4. Minimizar permisos y dependencias.
5. Preservar el contenido ante conflictos o errores.
6. Mantener el proyecto desplegable en cualquier host estático HTTPS.

## Arquitectura

```text
┌──────────────────────────────────────────────────────────┐
│ PWA instalada / navegador                               │
│                                                          │
│  UI + editor + Markdown seguro + búsqueda local          │
│                 │                    │                   │
│                 ▼                    ▼                   │
│          Sync Engine             IndexedDB              │
│                 │        files · settings · outbox       │
│                 ▼                                        │
│       Google Drive REST API                              │
│                 ▲                                        │
│                 │ Bearer access token en memoria         │
│       Google Identity Services                           │
└──────────────────────────────────────────────────────────┘
```

GitHub Pages o un host equivalente sirve únicamente HTML, CSS, JavaScript, manifest, iconos y Service Worker. El host no recibe tokens ni contenido de las notas.

## Componentes

### `auth.js`

- Espera a que Google Identity Services esté disponible.
- Inicializa `initTokenClient` con el Client ID público y `drive.file`.
- Guarda el access token y su vencimiento únicamente en propiedades de memoria.
- Expone conexión, expiración y revocación mediante eventos.

### `drive-api.js`

- Encapsula solicitudes autenticadas REST/CORS.
- Centraliza tratamiento de HTTP 401 y errores estructurados de Drive.
- Implementa listado paginado, creación multipart, descarga, actualización y papelera.
- Normaliza metadatos de Drive al modelo local.

### `db.js`

IndexedDB contiene tres object stores:

```text
files
  key: id
  indexes: parentId, kind, path, dirty

settings
  key: key
  values: vaultRootId, lastSyncAt, lastSelectedId

outbox
  key: opId
  indexes: createdAt, fileId, type
```

No se persisten access tokens ni credenciales.

### `sync-engine.js`

- Descubre o crea la raíz de la bóveda.
- Registra operaciones locales antes de intentar red.
- Resuelve IDs temporales `local:<uuid>` tras crear recursos remotos.
- Sube la cola en orden de dependencias.
- Descarga el árbol remoto y solo recupera contenido cuando cambia `version`.
- Recalcula rutas y metadatos de búsqueda.
- Conserva contenidos en conflictos.

### `markdown.js`

- No admite HTML crudo.
- Escapa caracteres HTML antes de aplicar formato.
- Solo permite enlaces con `https`, `http`, `mailto`, anclas o rutas relativas.
- Genera botones controlados para enlaces wiki.
- No utiliza librerías externas ni `eval`.

### `search.js`

- Extrae el primer H1 como título y hashtags fuera de bloques de código.
- Normaliza mayúsculas y diacríticos.
- Puntúa título, ruta y contenido.
- Admite frases, `#tag` y `path:`.

### `app.js`

- Coordina estado visual, eventos, autosave, búsqueda y diálogos.
- Solo usa `innerHTML` con el resultado del renderizador seguro interno.
- Mantiene accesibilidad básica mediante botones nativos, labels y regiones live.

## Modelo de archivo local

```json
{
  "id": "drive-id o local:uuid",
  "name": "Proyecto.md",
  "kind": "note | folder | attachment",
  "mimeType": "text/markdown",
  "parentId": "drive-id",
  "path": "Proyectos/Proyecto.md",
  "content": "# Proyecto",
  "remoteVersion": "17",
  "modifiedTime": "2026-07-18T12:00:00Z",
  "localUpdatedAt": "2026-07-18T12:03:00Z",
  "dirty": true,
  "isLocalOnly": false,
  "tags": ["trabajo"]
}
```

## Modelo de la cola

Operaciones soportadas:

```text
createFolder(fileId local, parentId, name)
createFile(fileId local, parentId, name, content)
updateFile(fileId remoto, baseVersion, content)
rename(fileId remoto, name)
trash(fileId remoto)
```

Las ediciones repetidas se compactan en una sola `updateFile`. Las ediciones de un archivo todavía local actualizan directamente su `createFile`.

## Flujo de sincronización

```text
1. Verificar token en memoria
2. Consultar `about.get` y comprobar `user.permissionId`
3. Bloquear la operación si la caché pertenece a otra cuenta
4. Obtener o crear NotesVault
5. Leer outbox
6. Crear carpetas pendientes
7. Sustituir IDs temporales
8. Crear notas pendientes
9. Procesar actualizaciones, renombrados y papelera
10. Recorrer el árbol remoto por parentId
11. Descargar notas cuya versión cambió
12. Mezclar registros locales pendientes
13. Eliminar registros remotos obsoletos de la caché
14. Guardar lastSyncAt y notificar a la UI
```

La sincronización se ejecuta mientras la PWA está abierta. Se activa al conectar, manualmente, al recuperar conectividad y tras una pausa después de cambios locales.

## Aislamiento entre cuentas

Antes de crear o subir archivos, el motor consulta `Drive about.get` y compara `user.permissionId` con el identificador almacenado junto a la caché. Si no coincide, aborta antes de procesar `outbox`. La cola no se borra ni se migra automáticamente: el usuario debe reconectar la cuenta original o borrar la caché de forma explícita.

## Conflictos

Cada `updateFile` registra `baseVersion`, la versión que existía al empezar la edición. Antes de subir:

```text
remote.version == baseVersion
  → actualizar contenido original

remote.version != baseVersion
  → descargar versión remota
  → mantenerla como original
  → crear "Nombre (conflicto local fecha).md" con contenido local
  → informar al usuario
```

Este diseño prioriza no perder datos frente a una fusión automática potencialmente incorrecta.

## Bóveda y permisos

La raíz tiene:

```json
{
  "name": "NotesVault",
  "mimeType": "application/vnd.google-apps.folder",
  "appProperties": {
    "notesVaultRoot": "v1",
    "notesAppManaged": "v1"
  }
}
```

La app no llama a `permissions.create`, no establece `anyone` y no crea enlaces de compartición. El ID se descubre después de OAuth y se almacena únicamente en IndexedDB.

## Seguridad

### Límites de confianza

- **Público:** código, estilos, iconos, manifest y OAuth Client ID.
- **Privado local:** caché IndexedDB, IDs de Drive y cola.
- **Secreto temporal:** access token en memoria.
- **Privado remoto:** notas y carpetas bajo permisos de Drive.

### Controles

- Scope `drive.file`.
- Access token solo en memoria.
- CSP restringida a origen propio y endpoints de Google necesarios.
- `Referrer-Policy: no-referrer`.
- Sin dependencias de runtime de terceros aparte del script oficial de GIS.
- Renderizado Markdown con escape por defecto.
- Sin HTML de usuario, `eval`, `new Function` ni scripts inline.
- Build sin Client Secret.
- Confirmación antes de borrar IndexedDB.

### Riesgo residual

No se ofrece cifrado de extremo a extremo. Google Drive y el dispositivo forman parte del perímetro de confianza. Un despliegue malicioso, una cuenta comprometida o un navegador vulnerable podría acceder a los datos durante una sesión autorizada.

## PWA y cachés

El Service Worker solo intercepta solicitudes GET del mismo origen. Precarga el shell y usa:

- network-first para navegación;
- cache-first con actualización en segundo plano para recursos estáticos;
- ninguna interceptación para `googleapis.com` o `accounts.google.com`.

El build sustituye `__BUILD_VERSION__` para crear un nombre de caché nuevo y elimina versiones antiguas durante `activate`.

## Despliegue

El proyecto no necesita bundler ni dependencias. `npm run build` copia `app/` a `dist/`, inyecta configuración pública y genera `404.html` y `.nojekyll`.

GitHub Actions:

1. checkout;
2. Node 22;
3. `npm run check`;
4. build con `GOOGLE_CLIENT_ID` desde variables del repositorio;
5. subida de `dist/`;
6. despliegue Pages.

Se recomienda un dominio dedicado para aislar el origen OAuth y el almacenamiento web.

## Decisiones y alternativas

### JavaScript nativo frente a React

Se elige JavaScript nativo para el MVP porque reduce la cadena de suministro, evita instalación de paquetes en el runtime y produce un artefacto estático directamente auditable. La arquitectura por módulos permite migrar la UI a React más adelante sin cambiar el protocolo con Drive ni el modelo local.

### IndexedDB frente a SQLite/WASM

IndexedDB está disponible de forma nativa en Safari iOS y no requiere descargar binarios. La búsqueda actual recorre registros locales en memoria; para bóvedas muy grandes se podrá introducir un índice dedicado.

### Sin backend

El modelo elimina costes y secretos de servidor, pero impide refresh tokens y sincronización silenciosa con la app cerrada. El usuario debe volver a autorizar cuando expire el token.

## Pruebas

Pruebas automatizadas con `node:test` cubren:

- escape y enlaces seguros de Markdown;
- frontmatter, tareas y tablas;
- normalización y ranking de búsqueda;
- filtros de etiquetas y rutas;
- sanitización y unicidad de nombres;
- construcción de rutas;
- normalización de Drive y escape de consultas.

`check-project.mjs` valida sintaxis, JSON, archivos OpenSpec requeridos y ausencia de persistencia obvia de tokens o evaluación dinámica.

## Limitaciones conocidas

- No hay sincronización en segundo plano con la PWA cerrada.
- La importación de carpetas depende del selector disponible en el navegador de escritorio.
- Los adjuntos se conservan conceptualmente como metadatos, pero el MVP no ofrece visor ni subida general de binarios.
- El parser Markdown es deliberadamente parcial y no pretende reproducir toda la sintaxis de Obsidian.
- La búsqueda es local en memoria; una bóveda de decenas de miles de notas requerirá indexación adicional.
