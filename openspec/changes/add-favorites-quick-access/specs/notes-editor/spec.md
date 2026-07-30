## ADDED Requirements

### Requirement: Marcado local de favoritos

La aplicación SHALL permitir marcar y desmarcar como favoritas las notas y carpetas accesibles, y SHALL conservar esa selección en el dispositivo sin modificar los archivos de Google Drive.

#### Scenario: Marcar una nota sin conexión

- **GIVEN** una nota está disponible en la caché local
- **AND** el dispositivo no tiene red
- **WHEN** el usuario activa su estrella
- **THEN** la nota aparece inmediatamente en favoritos
- **AND** permanece allí después de cerrar y reabrir la PWA.

#### Scenario: Sincronizar un elemento creado localmente

- **GIVEN** una nota o carpeta con ID local está marcada como favorita
- **WHEN** Google Drive asigna un ID remoto durante la sincronización
- **THEN** el elemento continúa marcado como favorito
- **AND** el acceso rápido abre el registro con el nuevo ID.

#### Scenario: Eliminar un elemento favorito

- **GIVEN** una nota o carpeta está marcada como favorita
- **WHEN** el elemento deja de estar disponible o se mueve a la papelera
- **THEN** deja de mostrarse en el cajón de favoritos
- **AND** los demás favoritos permanecen disponibles.

### Requirement: Cajón de accesos rápidos

La aplicación SHALL ofrecer un botón de estrella en la zona superior izquierda que abra un cajón deslizante con las carpetas y notas favoritas.

#### Scenario: Abrir una nota favorita

- **GIVEN** el cajón contiene una nota favorita
- **WHEN** el usuario selecciona la nota
- **THEN** la aplicación abre la nota en el editor
- **AND** cierra el cajón de favoritos.

#### Scenario: Abrir una carpeta favorita

- **GIVEN** el cajón contiene una carpeta favorita
- **WHEN** el usuario selecciona la carpeta
- **THEN** la aplicación revela y expande la carpeta en el árbol
- **AND** abre la navegación principal cuando la pantalla es estrecha.

#### Scenario: Cajón sin favoritos

- **GIVEN** no hay carpetas ni notas marcadas
- **WHEN** el usuario abre el cajón
- **THEN** la aplicación muestra un estado vacío
- **AND** permite cerrarlo sin alterar la nota actual.

#### Scenario: Cerrar mediante teclado

- **GIVEN** el cajón de favoritos está abierto
- **WHEN** el usuario pulsa Escape
- **THEN** la aplicación cierra el cajón
- **AND** devuelve el foco al botón que lo abrió.
