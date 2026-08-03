# Guía de uso

## Primera conexión

1. Abre la PWA.
2. Pulsa **Continuar con Google**.
3. Elige tu cuenta en la ventana oficial.
4. Autoriza el acceso limitado.
5. La app crea o localiza `NotesVault`.

## Crear una nota

1. Pulsa **Nueva nota**.
2. Escribe el nombre.
3. Elige una carpeta.
4. La nota se abre en **Vista**. Pulsa **Editar** para empezar a escribir.

El editor guarda localmente después de una pausa. Un punto de estado indica que el cambio todavía está pendiente de Drive.

La cabecera de cada nota distingue entre **Solo en este dispositivo**, **Cambios pendientes de Drive** y **Guardada en Drive**. Si la nota aún no está subida, pulsa **Subir a Drive** o **Sincronizar**; la aplicación pedirá conectar Google si hace falta y procesará inmediatamente los cambios pendientes.

## Crear carpetas

Pulsa el icono de carpeta con `+`, elige el padre y confirma. En la barra lateral, pulsa una carpeta para expandirla o contraerla y convertirla en destino predeterminado de nuevas notas.

Para mover una carpeta, pulsa el icono de movimiento que aparece junto a su estrella, elige la carpeta de destino y confirma. Se mueve la carpeta completa, incluidas todas sus subcarpetas, notas y adjuntos. La propia carpeta y sus descendientes no aparecen como destinos para evitar ciclos.

Para borrar una carpeta, pulsa el icono de papelera que aparece al lado. Tras confirmar, la carpeta y todo su contenido se ocultan localmente y se mueven a la papelera de Google Drive en la siguiente sincronización, desde donde todavía se pueden recuperar.

## Favoritos

Pulsa la estrella de una carpeta en el árbol o la estrella de la cabecera de una nota para añadirla a favoritos. La estrella situada arriba a la izquierda abre el cajón de accesos rápidos.

- Al elegir una nota favorita se abre directamente en el editor.
- Al elegir una carpeta favorita se revela y expande en el árbol.
- La selección se guarda en este dispositivo, funciona sin conexión y no modifica los archivos de Drive.

Vuelve a pulsar una estrella activa para retirar el elemento. Borrar la caché local también borra esta selección.

## Visualizar y editar

- **Vista:** es el modo predeterminado al abrir una nota y muestra el Markdown con títulos, listas, enlaces, tablas, imágenes y demás formato aplicado.
- **Editar:** muestra el texto `.md` y una barra de ayuda para insertar títulos H1-H3, negrita, cursiva, código, listas con viñetas, listas numeradas, tareas, citas y enlaces.

Selecciona texto antes de pulsar un formato para aplicarlo a la selección. Sin selección, los controles insertan un texto de ejemplo listo para reemplazar. También puedes usar `Ctrl/Cmd+B` para negrita, `Ctrl/Cmd+I` para cursiva y `Ctrl/Cmd+K` para enlaces.

El HTML crudo no se ejecuta.

Los enlaces escritos con `[texto](https://ejemplo.com)` y las URLs `http://` o `https://` pegadas directamente son clicables y se abren fuera de la PWA. Los enlaces de Google Maps se reconocen para que iOS o Android abran Google Maps cuando la aplicación esté instalada; si no lo está, se abren en el navegador.

## Adjuntar fotos

Abre una nota y pulsa el icono de imagen. En móvil, el selector del navegador permite elegir una foto existente o abrir la cámara cuando esté disponible.

La app guarda la foto como adjunto en la misma carpeta de Drive que la nota e inserta una línea Markdown:

```text
![foto](foto-20260720-153000.jpg)
```

El adjunto queda disponible sin conexión en este dispositivo y se sincroniza con Drive junto con la nota.

## Enlaces wiki

```text
[[Nombre de nota]]
[[Nombre de nota|Texto visible]]
![[Adjunto o nota]]
```

La app busca por nombre o ruta. Los enlaces a encabezados aceptan la sintaxis `[[Nota#Sección]]`, aunque el MVP abre la nota sin desplazarse todavía al encabezado.

## Buscar

La búsqueda usa la copia local y funciona offline.

```text
palabras normales
"frase exacta"
#etiqueta
path:carpeta
```

## Sin conexión

Puedes abrir notas cacheadas, buscar, crear y editar. Los cambios permanecen en la outbox. Al volver la conexión, pulsa **Conectar/Sincronizar** si el token caducó.

## Conflictos

Cuando Drive cambió una nota después de empezar tu edición, la app:

1. conserva la versión remota como original;
2. crea otra nota con `conflicto local` en el nombre;
3. muestra un aviso.

Compara ambas y fusiona manualmente lo necesario.

## Papelera

Eliminar mueve el archivo a la papelera de Drive. Puedes recuperarlo desde Google Drive mientras continúe allí.

## Atajos de escritorio

- Cmd/Ctrl+K: buscar.
- Cmd/Ctrl+N: nueva nota.
- Cmd/Ctrl+S: guardar localmente y sincronizar si hay autorización.

## Cuenta de Google distinta

Si aparece el aviso de cuenta distinta, desconecta y vuelve a elegir la cuenta que creó la bóveda. Solo utiliza **Borrar caché local** para cambiar de cuenta después de comprobar que no quedan cambios pendientes.
