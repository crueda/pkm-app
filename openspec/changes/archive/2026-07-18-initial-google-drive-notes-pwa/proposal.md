# Propuesta: PWA de notas Markdown sobre Google Drive

## Why

El usuario necesita consultar, crear, editar y buscar sus notas personales desde iPhone y escritorio sin depender de Obsidian, sin instalar una aplicación nativa y sin mantener un backend. La bóveda debe continuar siendo un conjunto de archivos Markdown portables y privados.

Una PWA estática conectada directamente a Google Drive resuelve la instalación en iPhone mediante Safari, elimina la cuenta Apple Developer y permite alojar la aplicación en GitHub Pages. Google Drive aporta una API web, permisos OAuth limitados y una fuente remota accesible desde varios dispositivos.

## What Changes

- Crear una PWA móvil-first en español para navegar por una bóveda `NotesVault` de Google Drive.
- Integrar Google Identity Services mediante el modelo de token y el scope mínimo `drive.file`.
- Crear, leer, modificar, renombrar, organizar y enviar a la papelera archivos Markdown.
- Mantener una caché IndexedDB con búsqueda inmediata y una cola de cambios offline.
- Detectar conflictos por versión y conservar ambos contenidos en archivos separados.
- Renderizar Markdown de forma segura, incluyendo frontmatter, tareas, tablas y enlaces wiki básicos.
- Añadir manifest, iconos y Service Worker para instalación y shell offline.
- Añadir build estático, servidor local, pruebas, comprobaciones y despliegue de GitHub Pages.
- Documentar configuración OAuth, despliegue, arquitectura, privacidad y uso.

## Capabilities

- `authentication`: autorización temporal con Google sin backend.
- `drive-vault`: carpeta privada, CRUD, importación, sincronización y conflictos.
- `notes-editor`: navegación, edición, vista previa y enlaces wiki.
- `offline-search`: caché local, cola durable y búsqueda.
- `pwa-deployment`: instalación, Service Worker y hosting estático.
- `security`: límites de confianza, CSP, tokens efímeros y Markdown seguro.

## Non-Goals

- No implementar colaboración multiusuario en tiempo real.
- No proporcionar compatibilidad con plugins de Obsidian, Canvas o consultas Dataview.
- No ofrecer cifrado de extremo a extremo en el MVP.
- No sincronizar simultáneamente iCloud y Google Drive.
- No ejecutar sincronización en segundo plano cuando la PWA está cerrada.
- No utilizar un backend, refresh tokens ni Client Secrets.

## Impact

- Se crea una aplicación nueva y autocontenida sin migraciones de software existente.
- El usuario debe configurar un proyecto de Google Cloud y un OAuth Client ID web.
- Los archivos importados pasan a tener Google Drive como fuente de verdad.
- El repositorio y el Client ID pueden ser públicos; los datos y tokens no forman parte del build.

## Risks and Mitigations

- **Caducidad del token:** la caché sigue disponible y la UI solicita reconexión.
- **Conflictos:** se conserva la versión remota y se crea una copia del contenido local.
- **XSS mediante notas:** HTML crudo se escapa y la CSP restringe scripts y conexiones.
- **Compromiso del host:** documentación exige 2FA, origen dedicado y revisión del workflow de despliegue.
- **Pérdida de cola local:** el borrado de caché requiere confirmación explícita.

## Rollback

La aplicación no modifica otros datos de Drive ni instala servicios. Para revertir:

1. Despublicar GitHub Pages.
2. Revocar el acceso de la aplicación en la cuenta de Google.
3. Descargar o mover la carpeta `NotesVault` a otro editor compatible con Markdown.
4. Eliminar la carpeta de Drive solo después de verificar una copia de seguridad.
