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
4. Empieza a escribir.

El editor guarda localmente después de una pausa. Un punto de estado indica que el cambio todavía está pendiente de Drive.

## Crear carpetas

Pulsa el icono de carpeta con `+`, elige el padre y confirma. En la barra lateral, pulsa una carpeta para expandirla o contraerla y convertirla en destino predeterminado de nuevas notas.

## Vista previa

- **Editar:** solo textarea Markdown.
- **Vista:** solo documento renderizado.
- **Ambos:** editor y vista lado a lado en escritorio.

El HTML crudo no se ejecuta.

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
