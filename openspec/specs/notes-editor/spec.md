# Navegación y edición de notas

## Purpose

Definir la experiencia móvil y de escritorio para recorrer carpetas, crear notas, editar Markdown y seguir enlaces internos.

## Requirements

### Requirement: Navegación móvil-first

La aplicación SHALL mostrar una barra lateral persistente en escritorio y un panel superpuesto en pantallas móviles.

#### Scenario: Abrir una nota en iPhone

- **GIVEN** la barra lateral está abierta en una pantalla estrecha
- **WHEN** el usuario selecciona una nota
- **THEN** la nota se abre en el área principal
- **AND** la barra lateral se cierra para maximizar el espacio de edición.

### Requirement: Creación y organización

La aplicación SHALL permitir crear notas y carpetas en la carpeta raíz o en cualquier carpeta accesible y SHALL evitar nombres duplicados entre hermanos.

#### Scenario: Nombre repetido

- **GIVEN** ya existe `Idea.md` en una carpeta
- **WHEN** el usuario crea otra nota llamada `Idea`
- **THEN** la nueva nota recibe un sufijo numérico, por ejemplo `Idea 2.md`
- **AND** ninguna nota existente se sobrescribe.

### Requirement: Autosave local

La aplicación SHALL guardar el contenido editado en IndexedDB tras una pausa breve de escritura y SHALL marcarlo como pendiente de sincronización.

#### Scenario: Edición sin conexión

- **GIVEN** una nota está abierta y el dispositivo no tiene red
- **WHEN** el usuario modifica el texto
- **THEN** los cambios quedan disponibles después de cerrar y reabrir la PWA
- **AND** la interfaz indica que están pendientes.

### Requirement: Modos de edición y vista previa

La aplicación SHALL proporcionar modos Editar, Vista y Ambos en escritorio, y SHALL mantener modos Editar y Vista en móvil.

#### Scenario: Vista previa segura

- **GIVEN** una nota contiene Markdown y HTML crudo
- **WHEN** el usuario activa Vista
- **THEN** se renderizan encabezados, listas, código, tablas, enlaces, etiquetas y frontmatter
- **AND** el HTML crudo se muestra escapado y no se ejecuta.

### Requirement: Compatibilidad básica con enlaces wiki

La aplicación SHALL reconocer `[[Nota]]`, `[[Nota|Etiqueta]]` y `![[Recurso]]` en la vista previa.

#### Scenario: Enlace wiki existente

- **GIVEN** existe una nota denominada `Proyecto.md`
- **WHEN** el usuario pulsa `[[Proyecto]]`
- **THEN** la aplicación abre esa nota
- **AND** prioriza una coincidencia situada en la misma carpeta que la nota actual.

#### Scenario: Enlace wiki inexistente

- **GIVEN** no existe la nota de destino
- **WHEN** el usuario pulsa el enlace
- **THEN** la aplicación no navega
- **AND** muestra un aviso no destructivo.

### Requirement: Acciones mediante teclado

La aplicación SHALL ofrecer atajos para buscar, crear una nota y guardar/sincronizar en navegadores de escritorio.

#### Scenario: Buscar con teclado

- **GIVEN** la aplicación está abierta
- **WHEN** el usuario pulsa Cmd/Ctrl+K
- **THEN** se abre la navegación cuando sea necesario
- **AND** el foco pasa al buscador.
