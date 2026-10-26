import test from "node:test";
import assert from "node:assert/strict";

import { createStudent } from "../app/src/ninjutsu-attendance.js";
import { programSessions } from "../app/src/ninjutsu-planner.js";
import { applyRosterSeed, mergeImportedAttendance, parseAttendanceSheet, readXlsxRows } from "../app/src/ninjutsu-roster-import.js";
import { NINJUTSU_ROSTER_SEED } from "../app/src/ninjutsu-roster-seed.js";

const sessions = programSessions();

function storedZip(files) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, centrals.length, true);
  endView.setUint16(10, centrals.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...locals, ...centrals, end]).arrayBuffer();
}

const rows = [
  ["Grupo A"],
  [null, null, null, null, null, "SEPT", null, "OCTUBRE"],
  [null, "APELLIDO 1", "APELLIDO 2", "NOMBRE", "DNI", 28, 30, 5, 7, 14, 26],
  [1, "Pérez", "Gil", "Ana ", "00000000T", false, false, true, false, true, false],
  [2, "Ruiz", null, "Luis", "11111111H", false, false, false, false, true, false],
  [null, null, null, null, null]
];

test("lee un Excel con cadenas compartidas, booleanos y celdas fusionadas", async () => {
  const buffer = await storedZip({
    "xl/workbook.xml": `<workbook><sheets><sheet name="Hoja1" sheetId="1" r:id="rId4"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId4" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst><si><t>OCTUBRE</t></si><si><t>NOMBRE</t></si><si><r><t>Ana</t></r><r><t xml:space="preserve"> Mar&#237;a</t></r></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
      <row r="2"><c r="C2" t="s"><v>0</v></c></row>
      <row r="3"><c r="B3" t="s"><v>1</v></c><c r="C3"><v>5.0</v></c><c r="D3"/></row>
      <row r="4"><c r="B4" t="s"><v>2</v></c><c r="C4" t="b"><v>1</v></c><c r="D4" t="inlineStr"><is><t>x &amp; y</t></is></c></row>
    </sheetData></worksheet>`
  });
  const parsed = await readXlsxRows(buffer);
  assert.deepEqual(parsed[1], [null, null, "OCTUBRE"]);
  assert.deepEqual(parsed[2], [null, "NOMBRE", 5, null]);
  assert.deepEqual(parsed[3], [null, "Ana María", true, "x & y"]);
});

test("convierte la hoja de asistencia en marcas por sesión con iniciales y sin DNI", () => {
  const imported = parseAttendanceSheet(rows, { sessions, today: "2026-10-26" });
  assert.deepEqual(imported.sessions, ["L41", "X42"]);
  assert.deepEqual(imported.students, [
    { name: "Ana P. G.", marks: { L41: "present", X42: "present" } },
    { name: "Luis R.", marks: { L41: "absent", X42: "present" } }
  ]);
  assert.equal(/00000000T|Pérez|Ruiz/.test(JSON.stringify(imported)), false);
});

test("fusiona el Excel con el alumnado existente sin duplicar nombres", () => {
  const existing = createStudent({ id: "ana", name: "ana p. g.", grade: "9-kyu", now: "2026-09-01T00:00:00.000Z" });
  const imported = parseAttendanceSheet(rows, { sessions, today: "2026-10-26" });
  const result = mergeImportedAttendance([existing], { L41: { ana: "absent" } }, imported, { createId: () => "luis", now: "2026-10-26T00:00:00.000Z" });
  assert.deepEqual(result.roster.map(student => [student.id, student.grade]), [["ana", "9-kyu"], ["luis", "sin-grado"]]);
  assert.deepEqual(result.attendance, { L41: { ana: "present", luis: "absent" }, X42: { ana: "present", luis: "present" } });
  assert.deepEqual([result.added, result.matched, result.marks, result.sessions], [1, 1, 4, 2]);
});

test("rechaza archivos que no son Excel o no tienen columna de nombre", async () => {
  await assert.rejects(readXlsxRows(new TextEncoder().encode("hola").buffer), /no es un Excel/);
  assert.throws(() => parseAttendanceSheet([["DNI"]], { sessions }), /NOMBRE/);
});

test("incluye el grupo A solo con iniciales y asistencias de sesiones programadas", () => {
  const codes = new Set(sessions.map(session => session.code));
  assert.equal(NINJUTSU_ROSTER_SEED.students.length, 11);
  assert.ok(NINJUTSU_ROSTER_SEED.students.every(student => /^[\p{L} ]+?( \p{Lu}\.)+$/u.test(student.name)));
  assert.ok(Object.keys(NINJUTSU_ROSTER_SEED.attendance).every(code => codes.has(code)));
  assert.equal(/\d{8}/.test(JSON.stringify(NINJUTSU_ROSTER_SEED)), false);
});

test("aplica el grupo incluido sin duplicar alumnos ni pisar marcas locales", () => {
  const seed = {
    students: [{ id: "seed-ana", name: "Ana P. G." }, { id: "seed-luis", name: "Luis R." }],
    attendance: { L41: { "seed-ana": "present", "seed-luis": "absent" } }
  };
  const existing = createStudent({ id: "local-ana", name: "Ana P. G.", grade: "8-kyu", now: "2026-09-01T00:00:00.000Z" });
  const result = applyRosterSeed([existing], { L41: { "local-ana": "absent" } }, seed, { now: "2026-10-26T00:00:00.000Z" });
  assert.deepEqual(result.roster.map(student => [student.id, student.grade]), [["local-ana", "8-kyu"], ["seed-luis", "sin-grado"]]);
  assert.deepEqual(result.attendance, { L41: { "local-ana": "absent", "seed-luis": "absent" } });
  assert.deepEqual(applyRosterSeed(result.roster, result.attendance, seed), result);
});
