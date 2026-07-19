# Configurar Google Cloud y OAuth

Esta operación se realiza una sola vez por despliegue.

## 1. Crear el proyecto

1. Entra en Google Cloud Console.
2. Crea un proyecto, por ejemplo `Notas Drive PWA`.
3. Selecciona el proyecto recién creado.

## 2. Activar Google Drive API

1. Abre **APIs & Services → Library**.
2. Busca **Google Drive API**.
3. Pulsa **Enable**.

## 3. Configurar Google Auth Platform

1. Abre la sección de Google Auth Platform / OAuth consent screen.
2. Configura el nombre de la aplicación, correo de soporte y datos de contacto.
3. Para una cuenta personal, utiliza audiencia **External**.
4. Durante las pruebas, añade tu cuenta como test user.
5. Añade únicamente el scope:

```text
https://www.googleapis.com/auth/drive.file
```

No añadas `https://www.googleapis.com/auth/drive`.

Para uso diario conviene pasar el proyecto a estado de producción; revisa las condiciones actuales de Google para el tipo de audiencia y número de usuarios.

## 4. Crear el OAuth Client ID

1. Abre **Clients** o **Credentials**.
2. Crea un cliente OAuth.
3. Tipo: **Web application**.
4. Nombre sugerido: `Notas Drive Web`.
5. Añade los orígenes JavaScript autorizados.

Desarrollo local:

```text
http://127.0.0.1:4173
http://localhost:4173
```

GitHub Pages de proyecto:

```text
https://TU_USUARIO.github.io
```

No incluyas `/NOMBRE_DEL_REPO/`: un origen contiene esquema, host y puerto, no la ruta.

Dominio dedicado recomendado:

```text
https://notas.tudominio.com
```

No necesitas configurar un Client Secret en esta PWA ni copiarlo al proyecto.

## 5. Configurar el proyecto local

```bash
GOOGLE_CLIENT_ID="1234567890-abc.apps.googleusercontent.com" npm run dev
```

O para el build:

```bash
GOOGLE_CLIENT_ID="1234567890-abc.apps.googleusercontent.com" npm run build
```

El Client ID aparecerá en `dist/config.js`; es normal y público por diseño.

## 6. Configurar GitHub

En el repositorio:

```text
Settings
→ Secrets and variables
→ Actions
→ Variables
→ New repository variable
```

Nombre:

```text
GOOGLE_CLIENT_ID
```

Valor:

```text
1234567890-abc.apps.googleusercontent.com
```

Usa **Variables**, no Secrets, porque el valor termina en JavaScript público de todos modos.

## 7. Verificación

1. Abre la aplicación desde un origen autorizado.
2. Pulsa **Continuar con Google**.
3. Comprueba que la ventana pertenece a Google.
4. Autoriza el permiso limitado.
5. Verifica en Drive que aparece una carpeta privada `NotesVault`.
6. Crea una nota y comprueba que es un `.md`.
7. Revisa la compartición de la carpeta: no debe incluir acceso público.

## Errores comunes

### `origin_mismatch`

El origen exacto no está registrado. Comprueba protocolo, host y puerto. Para GitHub Pages no añadas la ruta del repositorio.

### El botón de conexión está desactivado

El build no recibió `GOOGLE_CLIENT_ID` o no termina en `.apps.googleusercontent.com`.

### La app sigue mostrando la configuración anterior

Recarga, cierra y vuelve a abrir la PWA o elimina el Service Worker. Cada build de GitHub genera una versión nueva, pero Safari puede tardar en activar una actualización ya instalada.

### La autorización caduca con frecuencia durante pruebas

Revisa el estado de publicación y la configuración de usuarios de prueba en Google Auth Platform.

## Referencias oficiales

- Google Identity Services, token model: https://developers.google.com/identity/oauth2/web/guides/use-token-model
- Configurar un Client ID web: https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid
- Scopes de Google Drive: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Drive JavaScript quickstart: https://developers.google.com/workspace/drive/api/quickstart/js
