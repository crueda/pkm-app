# Bóveda de Google Drive

## Purpose

Definir el modelo de carpeta privada, las operaciones remotas y el comportamiento de sincronización entre Google Drive e IndexedDB.

## Requirements

### Requirement: Carpeta raíz gestionada por la aplicación

La aplicación SHALL localizar o crear una carpeta raíz denominada por defecto `NotesVault` y SHALL marcarla con `appProperties.notesVaultRoot = v1`.

#### Scenario: Primera conexión

- **GIVEN** no existe una carpeta accesible marcada como bóveda
- **WHEN** finaliza la autorización
- **THEN** la aplicación crea `NotesVault` en Mi unidad
- **AND** no crea permisos públicos ni enlaces compartidos
- **AND** guarda localmente su ID para accesos posteriores.

#### Scenario: Nuevo dispositivo

- **GIVEN** la caché local no contiene el ID de la bóveda
- **AND** ya existe una carpeta marcada creada por la aplicación
- **WHEN** el usuario conecta la misma cuenta
- **THEN** la aplicación vuelve a descubrir la carpeta por sus propiedades
- **AND** no crea una segunda bóveda.

### Requirement: Archivos Markdown como formato fuente

La aplicación SHALL almacenar cada nota como un archivo cuyo nombre termina en `.md` y cuyo contenido es texto Markdown UTF-8.

#### Scenario: Crear una nota

- **GIVEN** existe una carpeta destino válida
- **WHEN** el usuario crea una nota
- **THEN** se genera un archivo `text/markdown`
- **AND** se conserva la estructura de carpetas mediante la propiedad `parents` de Drive.

### Requirement: Operaciones CRUD

La aplicación SHALL listar carpetas, descargar notas, crear carpetas y notas, actualizar contenido, renombrar elementos y moverlos a la papelera.

#### Scenario: Eliminación recuperable

- **GIVEN** una nota sincronizada
- **WHEN** el usuario confirma su eliminación
- **THEN** la operación local se marca como pendiente
- **AND** en la siguiente sincronización el archivo se establece como `trashed = true`
- **AND** no se ejecuta una eliminación permanente.

### Requirement: Descarga incremental por versión

La aplicación SHALL reutilizar el contenido local cuando la versión remota no haya cambiado y SHALL descargar el contenido cuando detecte una versión diferente.

#### Scenario: Nota sin cambios

- **GIVEN** una nota local con contenido y la misma versión remota
- **WHEN** se actualiza el árbol de Drive
- **THEN** la aplicación actualiza los metadatos necesarios
- **AND** evita descargar nuevamente el cuerpo de la nota.

### Requirement: Cola ordenada de operaciones

La aplicación SHALL registrar las modificaciones locales en una cola persistente y SHALL procesar primero carpetas, después archivos nuevos y finalmente actualizaciones, renombrados y eliminaciones.

#### Scenario: Nota creada offline dentro de carpeta nueva

- **GIVEN** una carpeta y una nota fueron creadas sin conexión
- **WHEN** vuelve la conectividad y el usuario autoriza Drive
- **THEN** se crea primero la carpeta remota
- **AND** el ID local de la carpeta se sustituye en la operación de la nota
- **AND** la nota se crea dentro de la carpeta correcta.

### Requirement: Resolución conservadora de conflictos

La aplicación SHALL evitar sobrescribir silenciosamente un archivo remoto cuya versión haya cambiado desde que comenzó la edición local.

#### Scenario: Conflicto de contenido

- **GIVEN** una actualización local basada en la versión A
- **AND** Drive contiene ahora la versión B
- **WHEN** se intenta subir el contenido local
- **THEN** la versión B permanece como nota original
- **AND** la aplicación crea una segunda nota con el sufijo “conflicto local” que conserva el contenido local
- **AND** informa al usuario del nombre del archivo de conflicto.

### Requirement: Importación de una bóveda existente

La aplicación SHALL permitir importar hasta el límite configurado de archivos Markdown seleccionados desde el navegador, conservando sus rutas relativas y omitiendo `.obsidian` y entradas ocultas.

#### Scenario: Importación desde escritorio

- **GIVEN** el usuario selecciona una carpeta con subcarpetas y archivos `.md`
- **WHEN** confirma la importación
- **THEN** la aplicación recrea las carpetas necesarias
- **AND** crea cada nota con su contenido
- **AND** añade las operaciones a la cola para su sincronización.
