# PWA y despliegue estático — delta inicial

## ADDED Requirements


### Requirement: Aplicación instalable

La aplicación SHALL incluir manifest, iconos, colores, `display: standalone`, `start_url` y `scope` relativos para funcionar tanto en dominio raíz como bajo una ruta de proyecto.

#### Scenario: Instalación en iPhone

- **GIVEN** la aplicación se sirve por HTTPS y se abre en Safari
- **WHEN** el usuario elige “Añadir a pantalla de inicio” y “Abrir como app web”
- **THEN** aparece un icono independiente
- **AND** la aplicación se abre sin la interfaz normal de una pestaña de Safari.

### Requirement: Shell disponible offline

La aplicación SHALL usar un Service Worker que almacene únicamente recursos estáticos del mismo origen y SHALL excluir las respuestas de Google Drive y OAuth.

#### Scenario: Apertura sin red

- **GIVEN** el shell fue cargado al menos una vez
- **WHEN** la red no está disponible
- **THEN** el Service Worker entrega la interfaz desde Cache Storage
- **AND** IndexedDB proporciona las notas locales.

### Requirement: Actualizaciones controladas

Cada build SHALL generar una versión distinta del Service Worker para retirar cachés antiguas y SHALL informar cuando una versión nueva esté instalada.

#### Scenario: Nuevo despliegue

- **GIVEN** hay una versión anterior controlando la PWA
- **WHEN** el navegador instala un Service Worker nuevo
- **THEN** se eliminan las cachés de builds anteriores
- **AND** el usuario recibe un aviso para recargar.

### Requirement: Build estático configurable

El build SHALL generar `dist/` sin depender de un servidor de aplicación y SHALL aceptar `GOOGLE_CLIENT_ID`, `APP_NAME`, `VAULT_NAME` y `BUILD_VERSION` mediante variables de entorno.

#### Scenario: Build sin Client ID

- **GIVEN** no se define `GOOGLE_CLIENT_ID`
- **WHEN** se ejecuta `npm run build`
- **THEN** el build se completa para permitir revisión local
- **AND** la aplicación publicada muestra una advertencia de configuración en vez de fallar silenciosamente.

### Requirement: Despliegue por GitHub Actions

El repositorio SHALL incluir un workflow que construya y publique `dist/` en GitHub Pages usando un Client ID configurado como variable del repositorio.

#### Scenario: Push a main

- **GIVEN** Pages está configurado para GitHub Actions
- **AND** existe la variable `GOOGLE_CLIENT_ID`
- **WHEN** se hace push a `main`
- **THEN** el workflow ejecuta comprobaciones, genera el build y publica el artefacto.
