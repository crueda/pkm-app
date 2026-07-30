# Propuesta: accesos rápidos a favoritos

## Why

Las bóvedas con muchas carpetas y notas obligan a recorrer repetidamente el árbol o lanzar una búsqueda para volver a contenido frecuente. El usuario necesita marcar elementos importantes y abrirlos desde un acceso estable en la barra superior, tanto en móvil como en escritorio.

## What Changes

- Sustituir el símbolo de la marca en la barra superior por un botón de estrella.
- Abrir desde ese botón un cajón deslizante con las carpetas y notas favoritas.
- Permitir marcar o desmarcar carpetas desde el árbol y notas desde el árbol o su cabecera.
- Abrir directamente una nota favorita y revelar una carpeta favorita en el árbol.
- Conservar favoritos en IndexedDB para que estén disponibles sin conexión.

## Capabilities

- `notes-editor`: marcado local y navegación rápida a carpetas y notas favoritas.

## Non-Goals

- No sincronizar la selección de favoritos entre dispositivos.
- No escribir metadatos de favorito en los archivos Markdown ni en Google Drive.
- No cambiar el orden manualmente ni crear grupos de favoritos.

## Impact

- Se amplía el ajuste local persistente con una lista de IDs de elementos.
- No cambian el scope OAuth, el contenido remoto ni el modelo de la cola.
- El cajón se superpone al contenido y mantiene la navegación existente.

## Risks and Mitigations

- **IDs temporales:** al sustituir un ID local por el ID de Drive, IndexedDB actualiza también la lista de favoritos.
- **Elementos eliminados:** el cajón filtra elementos ausentes o enviados a la papelera.
- **Espacio móvil:** el botón sustituye al símbolo anterior de la marca y el cajón limita su anchura al viewport.

## Rollback

Retirar el botón, el cajón y los controles de estrella, y dejar de leer el ajuste `favoriteIds`. El ajuste residual es inerte y puede eliminarse junto con la caché local.
