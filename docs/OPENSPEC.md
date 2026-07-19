# OpenSpec en este proyecto

## Estructura

```text
openspec/
├── config.yaml
├── specs/
│   ├── authentication/spec.md
│   ├── drive-vault/spec.md
│   ├── notes-editor/spec.md
│   ├── offline-search/spec.md
│   ├── pwa-deployment/spec.md
│   └── security/spec.md
└── changes/archive/
    └── 2026-07-18-initial-google-drive-notes-pwa/
        ├── .openspec.yaml
        ├── proposal.md
        ├── design.md
        ├── tasks.md
        └── specs/*/spec.md
```

`openspec/specs/` describe el comportamiento vigente. El cambio inicial archivado conserva por qué se construyó, cómo se diseñó y qué tareas se completaron.

## Instalar y validar

OpenSpec requiere Node.js 20.19 o posterior.

```bash
npm install -g @fission-ai/openspec@latest
openspec validate --all --strict
openspec list --specs
openspec show security --type spec
openspec view
```

## Iniciar un cambio nuevo

En terminal:

```bash
openspec new change add-client-side-encryption
openspec status --change add-client-side-encryption
```

En el chat de un asistente compatible:

```text
/opsx:propose add-client-side-encryption
/opsx:apply
/opsx:archive
```

Los comandos `openspec ...` se ejecutan en terminal. Los comandos `/opsx:...` se escriben en el chat del asistente.

## Convenciones

- Mantener los encabezados exactos `## Requirements`, `### Requirement:` y `#### Scenario:` aunque el contenido esté en español.
- Usar `SHALL` o `MUST` para requisitos obligatorios.
- Escribir escenarios verificables con GIVEN/WHEN/THEN.
- Guardar mecanismos internos en `design.md` salvo que sean parte del contrato de seguridad.
- Añadir escenarios para offline, expiración, errores y conflictos cuando afecten al cambio.

## Próximos cambios sugeridos

- `add-attachment-support`
- `add-client-side-cache-encryption`
- `add-drive-changes-incremental-sync`
- `add-backlinks-and-heading-navigation`
- `add-tauri-desktop-shell`
