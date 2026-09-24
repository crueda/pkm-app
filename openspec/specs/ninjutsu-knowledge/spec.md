# Ninjutsu knowledge area

## Purpose

Provide a focused workspace over the Markdown content stored below `200 - AREA/201 - NINJUTSU`, without creating a second source of truth outside the Drive vault.

## Requirements

### Requirement: Dedicated entry point

The application SHALL expose the Ninjutsu area from the top bar with a distinct accessible icon and SHALL keep it mutually exclusive with the editor and recipes views.

#### Scenario: Open the Ninjutsu area

- **WHEN** the user activates the Ninjutsu icon
- **THEN** the application shows the dedicated Ninjutsu view
- **AND** focuses its search field
- **AND** hides the recipes and note editor views

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

