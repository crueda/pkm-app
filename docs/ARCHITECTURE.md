# Arquitectura

## Flujo principal

```text
Usuario
  │
  ├─ escribe / busca ───────────────┐
  │                                 │
  ▼                                 ▼
UI y editor                    Búsqueda local
  │                                 │
  └──────────────┬──────────────────┘
                 ▼
             IndexedDB
       files · settings · outbox
                 │
                 ▼
            Sync Engine
                 │
                 ▼
        Google Drive REST API
                 ▲
                 │ access token efímero
       Google Identity Services
```

## Fuente de verdad

- Google Drive es la fuente remota y compartida entre dispositivos.
- IndexedDB es una réplica parcial optimizada para abrir, buscar y editar offline.
- La outbox es la fuente de verdad de las operaciones todavía no confirmadas por Drive.

## IDs temporales

Cuando se crea algo sin red, recibe un ID como:

```text
local:550e8400-e29b-41d4-a716-446655440000
```

Al subir la carpeta o nota, Drive devuelve su ID. `replaceLocalId` actualiza:

- el registro del archivo;
- los hijos que apuntan al padre temporal;
- las operaciones pendientes que contienen ese ID.

## Estrategia de lectura

El motor recorre el árbol mediante consultas `'parentId' in parents`. Para cada nota:

- si `remoteVersion` coincide con la caché, conserva el contenido local;
- si cambia, descarga `alt=media`;
- si hay una edición local pendiente, no reemplaza el contenido antes de procesar la outbox.

## Estrategia de escritura

El editor guarda primero en IndexedDB. Esto reduce latencia y evita perder texto por cierres o cortes de red. La sincronización remota se programa después.

## Conflictos

No se intenta una fusión línea a línea. La app conserva ambas versiones porque una fusión automática de Markdown personal puede eliminar intención o estructura.

## Rendimiento

El MVP carga los registros locales en memoria para construir el árbol y buscar. Es adecuado para bóvedas personales pequeñas y medianas. Evoluciones posibles:

- índice de términos persistente;
- paginación virtual de la lista;
- búsqueda en Web Worker;
- SQLite/WASM para bóvedas muy grandes;
- Drive Changes API para sincronización incremental remota.

## Evolución a desktop

La UI y los módulos de dominio pueden reutilizarse en Tauri. El adaptador remoto seguiría siendo Drive o podría añadirse un adaptador de sistema de archivos local. La interfaz recomendada es:

```text
StorageAdapter
  listTree()
  readText(id)
  createFolder(...)
  createNote(...)
  updateText(...)
  rename(...)
  trash(...)
```
