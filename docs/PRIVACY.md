# Privacidad

## Qué almacena el host de la PWA

El host estático distribuye archivos de aplicación. No recibe solicitudes de lectura o escritura de notas porque el navegador habla directamente con Google Drive.

Los logs normales del host pueden registrar que una dirección IP descargó recursos estáticos, pero no el contenido de Drive.

## Qué almacena Google

Google Drive almacena las carpetas y notas Markdown. Google Identity Services gestiona la cuenta, el consentimiento y el access token.

Esta versión no cifra el contenido antes de subirlo. No debe considerarse cifrado de extremo a extremo frente a Google.

## Qué almacena el dispositivo

IndexedDB conserva:

- metadatos de archivos;
- contenido de notas sincronizadas;
- IDs de Drive;
- cambios pendientes;
- ajustes no sensibles.

El access token no se almacena.

## Telemetría

La aplicación no incluye analítica, publicidad, trackers ni telemetría propia.

## Eliminar datos

- **Caché local:** Ajustes y seguridad → Borrar caché local.
- **Acceso Google:** Desconectar en la app y, si procede, revocar el acceso desde la cuenta de Google.
- **Notas remotas:** mover o eliminar `NotesVault` desde Google Drive después de crear una copia.

## Cambio de cuenta

La app evita una mezcla entre cuentas de Google: antes de subir cambios compara el identificador opaco de la cuenta actual con el guardado en la caché. Una discrepancia detiene la sincronización y no elimina los cambios locales.
