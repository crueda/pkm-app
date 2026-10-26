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

The application SHALL bundle the 2026–2027 annual programming as read-only data and SHALL let the user browse every session by trimester and week, filter by weekday and jump to the next session, skipping the sessions cancelled because of a public holiday.

#### Scenario: Open a programmed training

- **WHEN** the user selects a session in the Programación tab
- **THEN** the application opens the Entrenamiento tab
- **AND** shows the selected session using the full available content width
- **AND** keeps Programación, Entrenamiento, Alumnado and Biblioteca as independently selectable tabs

#### Scenario: Edit a session

- **WHEN** the user edits the blocks or personal notes of a session
- **THEN** the changes are stored locally per session without altering the bundled programming
- **AND** items added by the user are highlighted in the session view
- **AND** the user can restore the original content

#### Scenario: Word of the week

- **WHEN** the selected session belongs to a week taught by Carlos
- **THEN** a "Palabra de la semana" card shows an editable word and explanation shared by both sessions of that week, prefilled for the weeks already taught (Shoshin, Ichigo ichie)
- **AND** lists the words of previous Carlos weeks
- **AND** the export includes a `## Palabra de la semana` section
- **AND** weeks taught by other instructors show no card

#### Scenario: Cancelled session

- **WHEN** a session is cancelled because its day is a public holiday
- **THEN** the session list shows a "Sin clase" flag and the session view states the reason instead of the non-teaching warning
- **AND** the next-session shortcut skips it
- **AND** the export writes `> Sin clase: …` below the heading

#### Scenario: Fill session notices and notes

- **WHEN** the user types in the free-text Notices or Notes boxes of a session
- **THEN** the text is stored locally for that session without entering edit mode
- **AND** restoring the original blocks keeps both texts
- **AND** the export includes `## Avisos` before the blocks and `## Notas del entrenamiento` at the end
- **AND** the training timer shows the notices

#### Scenario: Export a session

- **WHEN** the user exports a session
- **THEN** the application writes a Markdown training note with frontmatter (`tipo: entrenamiento`, `sesion`, `fecha`, `instructor`) to `03 - Entrenamientos/Programación 2026-2027`
- **AND** creates any missing folder of the hierarchy
- **AND** updates the same note on later exports instead of duplicating it
- **AND** queues it for Drive synchronization

#### Scenario: Run a session with the training timer

- **WHEN** the user starts a session
- **THEN** a full-screen timer shows the block that corresponds to the elapsed time, its countdown, its items and the next block, using the edited minutes of each block
- **AND** signals each block change with sound and vibration and keeps the screen awake while visible
- **AND** supports pausing, skipping to the previous, next or any block, and minimizing to a floating indicator that can either reopen the timer or end the training and dismiss itself
- **AND** keeps running across reloads until the user ends it

### Requirement: Local student and attendance tracking

The application SHALL let the user maintain a private, device-local Ninjutsu roster with each student's current grade, record present, absent or pending attendance for every programmed session, and derive progress from the blocks and grade adaptations in the sessions attended. It SHALL NOT require or store a national identity number.

#### Scenario: Manage the roster

- **WHEN** the user adds a student and selects a grade
- **THEN** the student appears in the Alumnado tab
- **AND** the user can later change the grade or remove the student and their attendance marks
- **AND** the roster remains only in the local IndexedDB settings

#### Scenario: Load the bundled group

- **WHEN** the application opens on a device that has not yet loaded the bundled Group A roster
- **THEN** it adds the bundled students, identified only by first name and surname initials, and their recorded attendance
- **AND** keeps any existing student with the same name and any attendance mark already recorded on the device
- **AND** does not load the bundled roster again on that device, so removed students stay removed

#### Scenario: Import the attendance spreadsheet

- **WHEN** the user picks an `.xlsx` attendance sheet in the Alumnado tab
- **THEN** the application reads it in the browser, adds or matches each student by first name and surname initials and ignores the DNI column
- **AND** maps each month and day column to the programmed session on that date
- **AND** records present for checked cells and absent for unchecked ones only in past sessions where at least one student is checked, leaving the rest pending
- **AND** keeps the imported data only in the local IndexedDB settings

#### Scenario: Take attendance

- **WHEN** the user opens a programmed training session
- **THEN** every active student can be marked present, absent or pending
- **AND** the user can mark the whole group present in one action
- **AND** the session list and header summarize the recorded attendance

#### Scenario: Review the group attendance history

- **WHEN** the user opens the Alumnado tab
- **THEN** the application shows a grid with every active student as a row and every non-cancelled session up to today as a column
- **AND** marks each cell as present, absent or not marked, with per-student and per-session totals
- **AND** opens the session when its column header is selected and the student's detail when their name is selected

#### Scenario: Review progress for an exam

- **WHEN** the user selects a student in the Alumnado tab
- **THEN** the application shows their attendance rate and unmarked past sessions
- **AND** lists the distinct program blocks, minutes and contents from sessions they attended
- **AND** highlights the attended sessions whose level adaptation matches the student's current grade
- **AND** identifies the result as an orientation rather than a final technical assessment

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

