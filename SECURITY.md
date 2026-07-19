# Política y diseño de seguridad

## Resumen

Notas Drive está diseñada para que una web pública pueda operar sobre archivos privados sin publicar credenciales ni datos. No existe una garantía absoluta de seguridad: el navegador, Google, la cuenta del usuario y el host de la PWA forman parte del perímetro de confianza.

## Datos públicos por diseño

- HTML, CSS y JavaScript de la aplicación.
- Iconos y manifest.
- OAuth Client ID web.
- Nombre por defecto de la carpeta, `NotesVault`.

El OAuth Client ID identifica a la aplicación, pero no autoriza acceso a una cuenta.

## Datos que no deben publicarse

- Client Secret.
- Access token o refresh token.
- Contraseña de Google.
- IDs fijos de una bóveda o notas concretas.
- Contenido Markdown.
- Dumps de IndexedDB o logs de red autenticados.

## Token OAuth

- Se obtiene mediante Google Identity Services después de una acción del usuario.
- Solo se guarda en una propiedad JavaScript en memoria.
- No se escribe en localStorage, IndexedDB, Cache Storage, URLs ni Service Worker.
- Se envía únicamente en `Authorization: Bearer ...` a `www.googleapis.com`.
- Se descarta al caducar, revocar o recargar la aplicación.

## Permisos Drive

El MVP solicita únicamente:

```text
https://www.googleapis.com/auth/drive.file
```

No solicita acceso general `drive`. La app tampoco usa `permissions.create` ni crea permisos `anyone`.

La carpeta raíz debe crearse en Mi unidad y no dentro de una carpeta ya compartida. Revisa periódicamente el panel de compartición de `NotesVault`.

## Protección frente a XSS

El access token puede ser utilizado por cualquier JavaScript que logre ejecutarse en la página durante su vigencia. Por ello:

- el renderizador Markdown escapa HTML crudo;
- los enlaces se limitan a protocolos permitidos;
- no se usa `eval` ni `new Function`;
- no se cargan librerías Markdown de CDN;
- la Content Security Policy solo permite el origen propio y los endpoints de Google necesarios;
- el único script externo es Google Identity Services;
- las notas no se insertan directamente en `innerHTML` sin pasar por el renderizador seguro.

No elimines estos controles al sustituir el renderizador.

## Riesgos del hosting

Quien controle el despliegue puede publicar JavaScript malicioso. Recomendaciones:

1. Activa passkey o autenticación de dos factores en GitHub y Google.
2. Protege la rama `main` y revisa cambios en el workflow.
3. Usa un dominio dedicado como `notas.ejemplo.com` o una cuenta de GitHub Pages exclusiva.
4. Restringe el OAuth Client ID exactamente al origen de producción y a los orígenes locales necesarios.
5. No añadas scripts de analítica o publicidad.
6. Revisa dependencias antes de introducir un framework o paquetes npm.

## Caché local

Las notas sincronizadas y cambios pendientes se guardan en IndexedDB para funcionar offline. Esto implica que una persona con acceso al dispositivo y al perfil del navegador podría leer la caché.

- Protege el iPhone con código y biometría.
- No uses un dispositivo compartido sin borrar la caché al terminar.
- El botón **Borrar caché local** elimina también cambios pendientes; requiere confirmación.

Una evolución futura puede cifrar IndexedDB con una clave derivada de una frase secreta.

## Conflictos y pérdida de datos

Antes de actualizar un archivo remoto, la app compara su versión con la versión base. Si difieren, no sobrescribe: conserva la versión remota y crea un archivo de conflicto con el contenido local.

Aun así, mantén copias de seguridad periódicas y prueba la importación con una copia de tu bóveda.

## Cifrado

Google Drive cifra datos en tránsito y almacenamiento según su servicio, pero esta aplicación no implementa cifrado de extremo a extremo controlado por el usuario. Google recibe los archivos Markdown en texto legible para su plataforma.

Para privacidad frente al proveedor habría que cifrar antes de subir. Eso convertiría los archivos en contenido cifrado, impediría abrirlos directamente como `.md` y obligaría a realizar toda búsqueda y recuperación dentro de la app.

## Informe de vulnerabilidades

En un repositorio propio, habilita GitHub Security Advisories o publica un correo de seguridad. No incluyas tokens, notas personales ni capturas con IDs sensibles en un issue público.
