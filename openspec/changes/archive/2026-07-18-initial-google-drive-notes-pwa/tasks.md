# Tareas de implementación

## 1. Fundamentos del proyecto

- [x] 1.1 Crear estructura de aplicación estática, módulos ES y scripts Node sin dependencias.
- [x] 1.2 Definir configuración pública inyectable para Client ID, nombre y bóveda.
- [x] 1.3 Añadir build reproducible a `dist/`, servidor local y comprobaciones estáticas.

## 2. Autorización Google

- [x] 2.1 Integrar Google Identity Services con `initTokenClient`.
- [x] 2.2 Solicitar exclusivamente `drive.file`.
- [x] 2.3 Mantener el access token únicamente en memoria y gestionar expiración/revocación.
- [x] 2.4 Añadir estados de configuración ausente, conexión y reconexión.

## 3. Adaptador Google Drive

- [x] 3.1 Implementar cliente REST autenticado con errores estructurados.
- [x] 3.2 Implementar búsqueda/creación de `NotesVault` mediante `appProperties`.
- [x] 3.3 Implementar listado paginado y recorrido de carpetas.
- [x] 3.4 Implementar creación multipart, descarga, actualización, renombrado y papelera.

## 4. Persistencia y sincronización

- [x] 4.1 Crear stores IndexedDB para archivos, ajustes y outbox.
- [x] 4.2 Implementar IDs locales y sustitución por IDs remotos.
- [x] 4.3 Compactar ediciones y ordenar dependencias de la cola.
- [x] 4.4 Descargar contenido solo al cambiar la versión remota.
- [x] 4.5 Detectar conflictos por `baseVersion` y crear copia local de conflicto.
- [x] 4.6 Implementar importación de carpetas Markdown y omisión de `.obsidian`.

## 5. Experiencia de notas

- [x] 5.1 Crear navegación móvil-first y árbol de carpetas.
- [x] 5.2 Implementar creación, renombrado, papelera y autosave.
- [x] 5.3 Añadir modos Editar, Vista y Ambos.
- [x] 5.4 Implementar renderizador Markdown seguro con enlaces wiki.
- [x] 5.5 Implementar búsqueda por título, ruta, contenido, etiquetas y filtros.
- [x] 5.6 Añadir atajos de teclado, tema y estados de sincronización.

## 6. Seguridad y privacidad

- [x] 6.1 Escapar HTML y bloquear protocolos de enlace peligrosos.
- [x] 6.2 Añadir CSP, no-referrer y ausencia de scripts inline.
- [x] 6.3 Verificar que tokens y Client Secrets no se persisten.
- [x] 6.4 Evitar APIs de compartición de Drive.
- [x] 6.5 Añadir borrado local confirmado y documentación de amenazas.
- [x] 6.6 Verificar la cuenta de Drive antes de vaciar la cola y bloquear mezclas entre cuentas.

## 7. PWA y despliegue

- [x] 7.1 Crear manifest, iconos normal/maskable y apple-touch-icon.
- [x] 7.2 Crear Service Worker limitado al mismo origen.
- [x] 7.3 Añadir versionado y limpieza de cachés.
- [x] 7.4 Añadir workflow de GitHub Pages y configuración por variable.

## 8. Calidad y documentación

- [x] 8.1 Añadir pruebas unitarias de Markdown, búsqueda, rutas y Drive.
- [x] 8.2 Añadir README, configuración Google Cloud, despliegue, arquitectura, uso y seguridad.
- [x] 8.3 Crear configuración, specs canónicas y archivo de cambio OpenSpec.
- [x] 8.4 Ejecutar pruebas y comprobaciones del proyecto.
