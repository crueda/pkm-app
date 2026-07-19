# Autenticación y autorización con Google — delta inicial

## ADDED Requirements


### Requirement: Inicio de autorización alojado por Google

La aplicación SHALL iniciar Google Identity Services únicamente después de una acción explícita del usuario y SHALL delegar en Google la selección de cuenta, autenticación y consentimiento.

#### Scenario: Conexión inicial

- **GIVEN** la aplicación tiene configurado un OAuth Client ID válido
- **AND** el usuario aún no dispone de un access token activo
- **WHEN** pulsa “Continuar con Google”
- **THEN** se abre la experiencia oficial de Google
- **AND** la aplicación no solicita ni recibe la contraseña del usuario
- **AND** el usuario puede aprobar o cancelar el acceso.

#### Scenario: Ventana cancelada

- **GIVEN** el usuario inició el flujo de Google
- **WHEN** cierra o cancela la ventana de autorización
- **THEN** la aplicación permanece operativa con su caché local
- **AND** muestra un estado desconectado sin borrar notas ni cambios pendientes.

### Requirement: Permiso mínimo de Drive

La aplicación SHALL solicitar exclusivamente el scope `https://www.googleapis.com/auth/drive.file` para el MVP.

#### Scenario: Consentimiento limitado

- **GIVEN** el usuario autoriza la aplicación
- **WHEN** Google entrega el access token
- **THEN** el token permite operar únicamente sobre archivos creados o abiertos para la aplicación
- **AND** la aplicación no solicita acceso general a todo Google Drive.

### Requirement: Token efímero

La aplicación SHALL conservar el access token únicamente en memoria y SHALL descartarlo al caducar, desconectar o recargar completamente la aplicación.

#### Scenario: Persistencia prohibida

- **GIVEN** existe un access token válido
- **WHEN** la aplicación guarda ajustes, archivos o la cola offline
- **THEN** el token no aparece en IndexedDB, localStorage, Cache Storage, URLs, logs ni archivos de configuración.

#### Scenario: Token caducado

- **GIVEN** una llamada a Drive responde con HTTP 401
- **WHEN** el motor detecta la expiración
- **THEN** elimina el token de memoria
- **AND** muestra “Reconecta Google Drive”
- **AND** conserva la cola local para sincronizarla tras una nueva autorización.

### Requirement: Client ID público y restringido por origen

La aplicación SHALL tratar el OAuth Client ID como identificador público y SHALL requerir que el administrador configure únicamente orígenes JavaScript autorizados.

#### Scenario: Configuración ausente

- **GIVEN** el build contiene el marcador `REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID`
- **WHEN** el usuario abre la aplicación
- **THEN** la interfaz explica que falta configuración
- **AND** desactiva los botones de conexión
- **AND** continúa permitiendo consultar cualquier caché local existente.

### Requirement: Desconexión explícita

La aplicación SHALL permitir revocar el token activo sin eliminar automáticamente la caché local.

#### Scenario: Desconectar Google

- **GIVEN** el usuario está conectado
- **WHEN** pulsa “Desconectar Google”
- **THEN** la aplicación revoca o descarta el token
- **AND** deja de realizar solicitudes remotas
- **AND** mantiene las notas locales disponibles.
