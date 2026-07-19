# Caché offline y búsqueda — delta inicial

## ADDED Requirements


### Requirement: Caché local estructurada

La aplicación SHALL almacenar en IndexedDB metadatos, contenido Markdown, versiones remotas, estado pendiente y rutas de los archivos accesibles de la bóveda.

#### Scenario: Arranque offline

- **GIVEN** el dispositivo no tiene conectividad
- **AND** existen notas sincronizadas anteriormente
- **WHEN** el usuario abre la PWA
- **THEN** la lista y el contenido local aparecen sin solicitar Google
- **AND** la aplicación identifica el estado como “Sin conexión”.

### Requirement: Cola durable

La aplicación SHALL conservar las operaciones pendientes en IndexedDB hasta que se completen o el usuario borre explícitamente la caché local.

#### Scenario: Cierre antes de sincronizar

- **GIVEN** hay cambios pendientes
- **WHEN** el sistema cierra la PWA
- **AND** el usuario vuelve a abrirla
- **THEN** los cambios y las operaciones siguen presentes.

### Requirement: Búsqueda local inmediata

La aplicación SHALL buscar en nombre, título H1, ruta, contenido y etiquetas a partir de la caché local.

#### Scenario: Búsqueda tolerante a tildes

- **GIVEN** existe una nota titulada `Álgebra lineal`
- **WHEN** el usuario busca `algebra`
- **THEN** la nota aparece entre los resultados
- **AND** las coincidencias en el título se priorizan sobre las coincidencias solo en el cuerpo.

### Requirement: Filtros de búsqueda

La aplicación SHALL admitir frases entre comillas, filtros `#etiqueta` y `path:carpeta`.

#### Scenario: Combinar filtros

- **GIVEN** existen notas de trabajo en varias carpetas
- **WHEN** el usuario busca `#trabajo path:proyectos`
- **THEN** solo aparecen notas etiquetadas como trabajo cuya ruta contiene `proyectos`.

### Requirement: Indicadores de estado

La aplicación SHALL distinguir visualmente entre nota sincronizada, guardada localmente y pendiente, sincronización activa, autorización requerida, sin conexión y error.

#### Scenario: Cambio pendiente

- **GIVEN** el contenido se guardó en IndexedDB pero no en Drive
- **WHEN** se muestra la nota o el árbol
- **THEN** aparece un indicador de pendiente
- **AND** el usuario puede seguir editando sin bloqueo.
