# Seguridad y privacidad

## Purpose

Definir los límites de confianza y controles mínimos para evitar la publicación accidental de notas, el robo de tokens y la ejecución de contenido malicioso.

## Requirements

### Requirement: Ausencia de secretos en el cliente

La aplicación SHALL contener únicamente valores públicos o configurables en sus archivos estáticos y SHALL prohibir Client Secrets, refresh tokens, contraseñas y access tokens persistidos.

#### Scenario: Repositorio público

- **GIVEN** el código y el build son accesibles públicamente
- **WHEN** un tercero inspecciona todos los archivos JavaScript
- **THEN** puede ver el OAuth Client ID
- **BUT** no obtiene ningún token, ID fijo de la bóveda, contenido de notas ni credencial que conceda acceso a una cuenta.

### Requirement: IDs de Drive descubiertos tras autorizar

La aplicación SHALL descubrir el ID de la bóveda y de los archivos después de obtener autorización y SHALL evitar incorporarlos al código fuente o configuración de despliegue.

#### Scenario: Dispositivo nuevo

- **GIVEN** un navegador sin almacenamiento local
- **WHEN** el usuario autoriza Google Drive
- **THEN** los IDs se obtienen mediante Drive API
- **AND** se guardan únicamente en la caché privada del origen para ese navegador.

### Requirement: No compartir archivos

La aplicación SHALL crear la bóveda en Mi unidad y SHALL abstenerse de invocar APIs de creación de permisos o generar enlaces públicos.

#### Scenario: Nota nueva

- **GIVEN** la carpeta raíz no está compartida
- **WHEN** la aplicación crea una nota
- **THEN** la nota hereda el acceso privado correspondiente
- **AND** la aplicación no añade un permiso de tipo `anyone`.


### Requirement: Aislamiento entre cuentas de Google

La aplicación SHALL obtener `user.permissionId` mediante Drive `about.get` antes de procesar la cola y SHALL impedir que una caché vinculada a una cuenta se sincronice con otra.

#### Scenario: Se autoriza una cuenta distinta

- **GIVEN** la caché y la cola están vinculadas a la cuenta A
- **WHEN** Google entrega un token correspondiente a la cuenta B
- **THEN** la aplicación bloquea la sincronización antes de subir cualquier cambio
- **AND** conserva intactas las notas y operaciones locales
- **AND** solicita reconectar la cuenta A o borrar explícitamente la caché para cambiar de cuenta.

### Requirement: Renderizado Markdown sin ejecución

La aplicación SHALL escapar todo HTML de entrada, validar protocolos de enlaces y prohibir evaluación dinámica de código.

#### Scenario: Nota hostil

- **GIVEN** una nota contiene `<script>`, atributos de eventos o un enlace `javascript:`
- **WHEN** se renderiza la vista previa
- **THEN** el script se muestra como texto o se neutraliza
- **AND** no se crea un enlace ejecutable
- **AND** el contenido no puede leer el token de memoria.

### Requirement: Política de seguridad de contenido

La página SHALL aplicar una Content Security Policy que limite scripts al propio origen y Google Identity Services, conexiones a los endpoints requeridos y frames a Google.

#### Scenario: Script de un dominio no autorizado

- **GIVEN** un recurso intenta cargar JavaScript desde un dominio no permitido
- **WHEN** el navegador evalúa la política
- **THEN** bloquea la carga.

### Requirement: Borrado local explícito

La aplicación SHALL permitir borrar archivos, ajustes y cola de IndexedDB mediante una acción separada y confirmada.

#### Scenario: Borrar caché con cambios pendientes

- **GIVEN** existen cambios sin subir
- **WHEN** el usuario solicita borrar la caché
- **THEN** se muestra una confirmación que advierte de la pérdida
- **AND** solo después de aceptarla se elimina el almacenamiento local.

### Requirement: Límites declarados de privacidad

La documentación SHALL diferenciar privacidad frente a publicación accidental de cifrado de extremo a extremo.

#### Scenario: Usuario requiere privacidad frente a Google

- **GIVEN** los `.md` se almacenan sin cifrado adicional gestionado por la aplicación
- **WHEN** el usuario revisa la documentación de seguridad
- **THEN** se explica que la solución no proporciona E2EE frente al proveedor
- **AND** se documenta el cifrado del lado del cliente como evolución incompatible con abrir los `.md` directamente.
