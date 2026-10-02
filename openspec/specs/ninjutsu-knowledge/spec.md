# Ninjutsu knowledge area

## Purpose

Provide a focused workspace over the Markdown content stored below `200 - AREA/201 - NINJUTSU`, without creating a second source of truth outside the Drive vault.

## Requirements

### Requirement: Applications menu entry point

The application SHALL expose a single applications button next to the favorites button that opens an accessible menu with the **Recetas** and **Ninjutsu** options, and SHALL keep those areas mutually exclusive with the note editor.

#### Scenario: Open the Ninjutsu area

- **WHEN** the user opens the applications menu and chooses Ninjutsu
- **THEN** the menu closes
- **AND** the application shows the dedicated Ninjutsu view on the annual programming tab
- **AND** hides the recipes and note editor views

#### Scenario: Dismiss the menu

- **WHEN** the menu is open and the user presses Escape or clicks outside it
- **THEN** the menu closes without changing the current view

### Requirement: Annual programming

The application SHALL bundle the 2026–2027 annual programming as read-only data and SHALL let the user browse every session by trimester and week, filter by weekday and jump to the next session.

#### Scenario: Edit a session

- **WHEN** the user edits the blocks or personal notes of a session
- **THEN** the changes are stored locally per session without altering the bundled programming
- **AND** items added by the user are highlighted in the session view
- **AND** the user can restore the original content

#### Scenario: Export a session

- **WHEN** the user exports a session
- **THEN** the application writes a Markdown training note with frontmatter (`tipo: entrenamiento`, `sesion`, `fecha`, `instructor`) to `03 - Entrenamientos/Programación 2026-2027`
- **AND** creates any missing folder of the hierarchy
- **AND** updates the same note on later exports instead of duplicating it
- **AND** queues it for Drive synchronization

### Requirement: Recursive library discovery

The application SHALL discover `201 - NINJUTSU` only when it is a child of `200 - AREA` and SHALL include Markdown notes from every descendant folder.

#### Scenario: Duplicate folder names exist

- **WHEN** more than one matching hierarchy exists
- **THEN** the application prefers the hierarchy containing the most Markdown notes

### Requirement: Focused search and categories

The application SHALL search Ninjutsu notes by title, body, metadata, category and path without distinguishing case or diacritics, and SHALL offer category filters derived from the first descendant folder.

#### Scenario: Search a technique

- **WHEN** the user enters one or more terms
- **THEN** only notes containing every normalized term are shown
- **AND** selecting a result renders its Markdown in the detail panel

### Requirement: Training log

The application SHALL create dated training notes in `03 - Entrenamientos` using an editable session template.

#### Scenario: Missing hierarchy

- **WHEN** the user creates a training note and part of the Ninjutsu hierarchy is missing
- **THEN** the application creates the missing `200 - AREA`, `201 - NINJUTSU` and `03 - Entrenamientos` folders below the preferred PKM root
- **AND** opens the new Markdown note in edit mode

### Requirement: Responsive and offline-capable interface

The Ninjutsu module SHALL be included in the application shell and SHALL remain usable at desktop and narrow mobile widths without horizontal page overflow.

