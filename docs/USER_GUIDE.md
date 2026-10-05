# Guía de uso

## Publicar una nota o carpeta

La aplicación puede crear en Google Drive una copia separada que cualquiera con el enlace podrá ver. La bóveda y los archivos originales no cambian de permisos.

- En una nota, pulsa **Publicar** en la cabecera.
- En una carpeta, usa el botón **Publicar una copia con enlace** que aparece al pasar por su fila.
- Pulsa **Publicar ahora**. La aplicación sincroniza primero los cambios pendientes y genera la copia pública.
- Usa **Abrir** para comprobarla o **Copiar enlace** para enviarla por el medio que prefieras.
- Si cambia el contenido, abre de nuevo la acción y pulsa **Actualizar publicación**. El enlace se conserva.

Las carpetas publicadas incluyen sus subcarpetas, notas y adjuntos. Un elemento eliminado del origen se retira de la copia pública en la siguiente actualización. La publicación no se actualiza automáticamente: requiere volver a ejecutar la acción.

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

Al arrancar la aplicación, el árbol muestra únicamente el primer nivel: todas las carpetas aparecen contraídas hasta que decidas abrirlas.

Para mover una carpeta, pulsa el icono de movimiento que aparece junto a su estrella, elige la carpeta de destino y confirma. Se mueve la carpeta completa, incluidas todas sus subcarpetas, notas y adjuntos. La propia carpeta y sus descendientes no aparecen como destinos para evitar ciclos.

Para renombrar una carpeta, pulsa el icono de lápiz que aparece en su fila, escribe el nombre nuevo y confirma. Las rutas de todas sus subcarpetas y notas se actualizan automáticamente, también cuando trabajas sin conexión.

Para borrar una carpeta, pulsa el icono de papelera que aparece al lado. Tras confirmar, la carpeta y todo su contenido se ocultan localmente y se mueven a la papelera de Google Drive en la siguiente sincronización, desde donde todavía se pueden recuperar.

## Favoritos

Pulsa la estrella de una carpeta en el árbol o la estrella de la cabecera de una nota para añadirla a favoritos. La estrella situada arriba a la izquierda abre el cajón de accesos rápidos.

- Al elegir una nota favorita se abre directamente en el editor.
- Al elegir una carpeta favorita se revela y expande en el árbol.
- La selección se guarda en este dispositivo, funciona sin conexión y no modifica los archivos de Drive.

Vuelve a pulsar una estrella activa para retirar el elemento. Borrar la caché local también borra esta selección.

## Menú de aplicaciones

El botón de cuadrícula, junto a la estrella de favoritos, abre el menú de aplicaciones con dos opciones: **Recetas** y **Ninjutsu**. Se cierra al elegir una opción, al pulsar fuera o con `Esc`, y se puede recorrer con las flechas del teclado.

## Área de Ninjutsu

Abre **Ninjutsu** desde el menú de aplicaciones. La vista tiene dos pestañas.

### Programación 2026–2027

Incluye las 60 sesiones de la programación anual (semanas 40 de 2026 a 21 de 2027, lunes de taijutsu y miércoles de taihen y armas), con instructor, días no lectivos, niveles por grado y repaso espaciado.

- La lista se agrupa por trimestre y semana; filtra por **Lunes** o **Miércoles** y pulsa **Hoy** para ir a la próxima sesión.
- **Editar** convierte cada bloque (calentamiento, taihen, dakentai, jutai, armas, cierre) en un cuadro de texto con un elemento por línea, permite ajustar los minutos de cada bloque y añade el campo **Mis notas** (admite Markdown). Los cambios se guardan solos en este dispositivo y lo añadido se resalta en ocre.
- **Restaurar original** descarta tus cambios de esa sesión.
- **Empezar** abre el temporizador a pantalla completa: muestra el bloque que toca según el tiempo transcurrido, la cuenta atrás del bloque, sus contenidos, el siguiente bloque y una barra con todos los bloques (pulsa uno para saltar a él). Avisa con sonido y vibración en cada cambio de bloque y mantiene la pantalla encendida mientras está abierto.
- **Pausar/Reanudar** (o la barra espaciadora), **Anterior** y **Siguiente** controlan el avance. Puedes minimizarlo: una pastilla flotante sigue mostrando el bloque y el tiempo, y el entrenamiento continúa aunque recargues la app. Al terminar, **Cerrar y anotar** abre el editor de la sesión para añadir tus notas antes de exportarla.
- **Exportar a Drive** genera una nota Markdown con la sesión completa en `201 - NINJUTSU/03 - Entrenamientos/Programación 2026-2027`, por ejemplo `2026-10-05 - L41 - Kihon happo I- Ichimonji no kata.md`. Si ya existe, **Actualizar en Drive** la sobrescribe con la versión actual. Sin conexión, la nota queda pendiente y se sube en la próxima sincronización.

### Biblioteca

La aplicación localiza la carpeta `200 - AREA/201 - NINJUTSU` aunque esté dentro de `PKM` y muestra también las notas de todas sus subcarpetas, incluidas las sesiones exportadas.

- Usa la caja principal para buscar por técnica, grado, arma, concepto, texto o ruta. La búsqueda ignora mayúsculas y tildes.
- Filtra por **Programa 2024**, **Programación anual**, **Entrenamientos** o cualquier nueva sección que añadas.
- Selecciona un resultado para leerlo sin abandonar la vista; **Abrir y editar** lo lleva al editor Markdown normal.
- **Entrenamiento libre** crea una nota fechada dentro de `03 - Entrenamientos`, con objetivos, bloques de tiempo y observaciones listas para completar.

El contenido sigue siendo Markdown normal en Google Drive. La vista especial no crea una base de datos paralela ni publica el programa.

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

La primera sincronización puede tardar más porque prepara la copia local completa. A partir de entonces la aplicación consulta únicamente los cambios recientes de Drive. Si Drive no responde, la petición termina y se reintenta automáticamente; ya no debe permanecer indefinidamente en **Sincronizando…**.

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
