# Diseño técnico

## Interacción

La estrella de la barra superior abre un cajón desde la izquierda sin reemplazar la navegación principal. Cada elemento favorito muestra su tipo, nombre, ruta y una acción para retirarlo.

- Una nota abre el editor, cierra el cajón y conserva el comportamiento móvil actual.
- Una carpeta cierra el cajón, limpia la búsqueda, expande sus antecesores y la revela en el árbol.
- `Escape`, el fondo superpuesto y el botón de cierre cierran el cajón.

## Modelo local

El store `settings` de IndexedDB guarda:

```json
{
  "key": "favoriteIds",
  "value": ["drive-id", "local:uuid"]
}
```

La lista se normaliza para aceptar únicamente IDs de texto no vacíos y eliminar duplicados. Los favoritos no forman parte de `files`, por lo que una actualización remota de metadatos no puede sobrescribirlos.

## Sustitución de IDs

Las notas y carpetas creadas offline usan IDs `local:*`. `LocalDatabase.replaceLocalId` sustituye esos IDs en archivos y outbox; el mismo commit actualiza `favoriteIds` y `lastSelectedId`. De esta forma la navegación y el favorito sobreviven a la primera sincronización.

## Límites y privacidad

La funcionalidad no realiza peticiones de red. Google Drive no recibe la selección y no se añaden propiedades a los archivos. Borrar la caché local elimina también los favoritos, de acuerdo con el comportamiento existente de `resetAll`.

## Accesibilidad

Los controles son botones nativos con nombre accesible, estado `aria-pressed` o `aria-expanded` y foco visible. El cajón declara su relación con el botón de apertura y devuelve el foco al cerrarse.

## Pruebas

Las pruebas unitarias cubren normalización, alternancia, sustitución de IDs y orden/filtrado de archivos favoritos. La validación en navegador cubre apertura y cierre del cajón, marcado de una carpeta y una nota, navegación y responsive.
