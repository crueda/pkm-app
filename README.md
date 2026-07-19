# Notas Drive PWA

PWA local-first para leer, crear, editar, organizar y buscar notas Markdown almacenadas en una carpeta privada de Google Drive. Está diseñada primero para iPhone/iPad, funciona también en escritorio y no necesita backend, App Store ni cuenta Apple Developer.

## Estado del proyecto

Este ZIP contiene un MVP funcional con:

- login y consentimiento mediante la ventana oficial de Google;
- scope OAuth mínimo `drive.file`;
- creación o descubrimiento de `NotesVault`;
- notas `.md` y carpetas reales en Google Drive;
- lectura, creación, autosave, renombrado y papelera;
- caché IndexedDB y cola de cambios offline;
- búsqueda por título, contenido, ruta, `#tag` y `path:`;
- detección conservadora de conflictos por versión;
- bloqueo preventivo al autorizar una cuenta de Google distinta;
- importación de carpetas Markdown desde escritorio;
- renderizado seguro de Markdown y enlaces `[[wiki]]` básicos;
- manifest, iconos y Service Worker para instalación como PWA;
- despliegue automático en GitHub Pages;
- especificación OpenSpec completa bajo `openspec/`;
- pruebas automatizadas sin dependencias externas.

## Principio de seguridad

El código estático y el OAuth Client ID pueden ser públicos. No se incluyen en el repositorio ni en el build:

- contraseñas;
- Client Secrets;
- access tokens o refresh tokens;
- un ID fijo de tu carpeta de Drive;
- IDs fijos de notas;
- contenido Markdown.

Los IDs se descubren después de que el usuario autoriza Google Drive. El access token solo vive en memoria y desaparece al recargar o caducar. La caché queda vinculada al `permissionId` de la cuenta: si se autoriza otra cuenta, la sincronización se bloquea antes de subir datos.

Consulta [SECURITY.md](SECURITY.md), [docs/PRIVACY.md](docs/PRIVACY.md) y [docs/VERIFICATION.md](docs/VERIFICATION.md) antes de publicar.

## Requisitos

- Node.js 20.19 o posterior para los scripts de desarrollo y OpenSpec.
- Un proyecto gratuito de Google Cloud con Drive API activada.
- Un OAuth Client ID de tipo **Web application**.
- Un host HTTPS; GitHub Pages está preparado de serie.

La aplicación publicada no necesita Node.js: `dist/` son archivos estáticos.

## Inicio rápido local

1. Configura Google Cloud siguiendo [docs/GOOGLE_CLOUD_SETUP.md](docs/GOOGLE_CLOUD_SETUP.md).
2. Desde la raíz del proyecto, ejecuta:

```bash
GOOGLE_CLIENT_ID="TU_CLIENT_ID.apps.googleusercontent.com" npm run dev
```

3. Abre `http://127.0.0.1:4173`.
4. Pulsa **Continuar con Google**.

No se ejecuta `npm install` porque el proyecto no tiene dependencias de runtime ni de build.

## Pruebas y build

```bash
npm test
npm run check
```

Crear un build estático:

```bash
GOOGLE_CLIENT_ID="TU_CLIENT_ID.apps.googleusercontent.com" npm run build
```

Resultado:

```text
dist/
├── index.html
├── 404.html
├── config.js
├── manifest.webmanifest
├── sw.js
├── styles.css
├── icons/
└── src/
```

Variables opcionales:

```bash
APP_NAME="Mis notas" \
VAULT_NAME="NotesVault" \
BUILD_VERSION="release-1" \
GOOGLE_CLIENT_ID="...apps.googleusercontent.com" \
npm run build
```

## GitHub Pages

El workflow `.github/workflows/deploy-pages.yml` valida, construye y publica la app. Configuración completa en [docs/DEPLOY_GITHUB_PAGES.md](docs/DEPLOY_GITHUB_PAGES.md).

La variable principal es:

```text
Repository Settings → Secrets and variables → Actions → Variables
GOOGLE_CLIENT_ID = ...apps.googleusercontent.com
```

El Client ID no es un secreto. Se usa una variable para evitar editar código entre entornos.

## Instalación en iPhone

1. Publica la PWA por HTTPS.
2. Abre la URL en Safari.
3. Pulsa **Compartir**.
4. Elige **Añadir a pantalla de inicio**.
5. Activa **Abrir como app web** y confirma.

La app se abre desde un icono propio y conserva el shell y las notas sincronizadas para uso offline.

## Búsqueda

```text
algebra                 palabras sin distinguir tildes
"plan anual"            frase exacta
#trabajo                 etiqueta
path:proyectos           fragmento de ruta
#trabajo path:clientes   combinación de filtros
```

## Importar una bóveda existente

La importación por carpeta está pensada para escritorio:

1. Pulsa el botón de importación en la barra lateral.
2. Selecciona la carpeta de la bóveda exportada o descargada.
3. La app omite `.obsidian`, archivos ocultos y elementos que no sean Markdown.
4. Se recrean las carpetas en Drive y se añaden las notas a la cola.
5. Verifica el contenido antes de abandonar la copia original.

No mantengas iCloud y Drive como dos fuentes de verdad editables de manera simultánea.

## Estructura

```text
app/                         PWA servida al navegador
  src/auth.js                Google Identity Services
  src/drive-api.js           Drive REST API
  src/db.js                  IndexedDB
  src/sync-engine.js         cola, descarga y conflictos
  src/markdown.js            renderizado seguro
  src/search.js              búsqueda local
scripts/                     build, servidor y checks
 tests/                      node:test
 docs/                       configuración y operación
 openspec/                   specs y cambio inicial archivado
 .github/workflows/          despliegue Pages
```

## OpenSpec

La fuente de verdad de comportamiento está en `openspec/specs/`. El cambio inicial completo, con propuesta, diseño, tareas y deltas, está archivado en:

```text
openspec/changes/archive/2026-07-18-initial-google-drive-notes-pwa/
```

Para validar con el CLI oficial:

```bash
npm install -g @fission-ai/openspec@latest
openspec validate --all --strict
openspec list --specs
openspec view
```

Más detalles en [docs/OPENSPEC.md](docs/OPENSPEC.md).

## Limitaciones del MVP

- El token es temporal; habrá que pulsar **Conectar/Reconectar** cuando caduque.
- No hay sincronización cuando la PWA está cerrada.
- No hay compatibilidad con plugins de Obsidian, Canvas o Dataview.
- El renderizador implementa un subconjunto útil de Markdown, no toda la sintaxis de Obsidian.
- Los adjuntos no disponen todavía de visor o gestión completa.
- No hay cifrado de extremo a extremo frente a Google.
- Para bóvedas de decenas de miles de notas será conveniente introducir un índice de búsqueda especializado.

## Licencia

MIT. Consulta [LICENSE](LICENSE).
