import { createStudent, normalizeAttendance, normalizeRoster, normalizeStudentName, updateAttendance } from "./ninjutsu-attendance.js";

const MONTHS = Object.freeze([
  ["ene", 1], ["feb", 2], ["mar", 3], ["abr", 4], ["may", 5], ["jun", 6],
  ["jul", 7], ["ago", 8], ["sep", 9], ["oct", 10], ["nov", 11], ["dic", 12]
]);

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function decodeXml(value = "") {
  return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity) => {
    if (entity[0] !== "#") return XML_ENTITIES[entity] ?? match;
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

function xmlText(fragment = "") {
  return decodeXml([...fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => match[1]).join(""));
}

function attribute(attributes, name) {
  return attributes.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1] ?? null;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error("El archivo no es un Excel .xlsx válido");
  const decoder = new TextDecoder();
  const entries = new Map();
  let pointer = view.getUint32(end + 16, true);
  for (let index = 0; index < view.getUint16(end + 10, true); index += 1) {
    if (view.getUint32(pointer, true) !== 0x02014b50) throw new Error("El Excel está dañado");
    const nameLength = view.getUint16(pointer + 28, true);
    entries.set(decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength)), {
      method: view.getUint16(pointer + 10, true),
      size: view.getUint32(pointer + 20, true),
      offset: view.getUint32(pointer + 42, true)
    });
    pointer += 46 + nameLength + view.getUint16(pointer + 30, true) + view.getUint16(pointer + 32, true);
  }
  return {
    has: name => entries.has(name),
    names: () => [...entries.keys()],
    async text(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
      const data = bytes.subarray(start, start + entry.size);
      if (entry.method === 0) return decoder.decode(data);
      if (entry.method === 8) return decoder.decode(await inflateRaw(data));
      throw new Error("El Excel usa una compresión no compatible");
    }
  };
}

async function firstSheetPath(zip) {
  const workbook = await zip.text("xl/workbook.xml") ?? "";
  const relationId = attribute(workbook.match(/<sheet\b([^>]*)\/?>/)?.[1] ?? "", "r:id");
  const relations = await zip.text("xl/_rels/workbook.xml.rels") ?? "";
  for (const [, attributes] of relations.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    if (attribute(attributes, "Id") !== relationId) continue;
    const target = attribute(attributes, "Target") ?? "";
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    if (zip.has(path)) return path;
  }
  return zip.names().filter(name => /^xl\/worksheets\/[^/]+\.xml$/.test(name)).sort()[0] ?? null;
}

function columnIndex(reference = "") {
  const letters = reference.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "";
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

export function parseSheetXml(sheetXml, sharedStrings = []) {
  const rows = [];
  for (const [, rowAttributes, rowBody = ""] of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowIndex = Number(attribute(rowAttributes, "r") ?? rows.length + 1) - 1;
    const row = [];
    for (const [, cellAttributes, body = ""] of rowBody.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const type = attribute(cellAttributes, "t");
      let value = null;
      if (type === "inlineStr") value = xmlText(body);
      else if (raw === undefined) value = null;
      else if (type === "s") value = sharedStrings[Number(raw)] ?? null;
      else if (type === "b") value = raw === "1";
      else if (type === "str") value = decodeXml(raw);
      else if (type !== "e") value = Number(raw);
      const column = columnIndex(attribute(cellAttributes, "r") ?? "");
      row[column >= 0 ? column : row.length] = value;
    }
    rows[rowIndex] = Array.from(row, cell => cell ?? null);
  }
  return Array.from(rows, row => row ?? []);
}

export async function readXlsxRows(buffer) {
  const zip = await unzip(buffer);
  const sheetPath = await firstSheetPath(zip);
  if (!sheetPath) throw new Error("El Excel no contiene ninguna hoja");
  const shared = await zip.text("xl/sharedStrings.xml") ?? "";
  const sharedStrings = [...shared.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match => xmlText(match[1]));
  return parseSheetXml(await zip.text(sheetPath), sharedStrings);
}

function plain(value) {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLocaleLowerCase("es");
}

function monthNumber(value) {
  const label = plain(value);
  return MONTHS.find(([prefix]) => label.startsWith(prefix))?.[1] ?? null;
}

function isPresent(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  return ["true", "verdadero", "si", "x", "1", "presente"].includes(plain(value));
}

export function abbreviatedName(firstName, surnames = []) {
  const initials = surnames.map(surname => normalizeStudentName(surname ?? "")).filter(Boolean).map(surname => `${surname[0].toLocaleUpperCase("es")}.`);
  const name = normalizeStudentName(firstName ?? "");
  return name ? normalizeStudentName([name, ...initials].join(" ")) : "";
}

export function studentKey(name) {
  return plain(normalizeStudentName(name));
}

export function parseAttendanceSheet(rows, { sessions, today = new Date().toLocaleDateString("sv-SE") }) {
  const headerIndex = rows.findIndex(row => row.some(cell => plain(cell) === "nombre"));
  if (headerIndex < 0) throw new Error("No se encuentra la columna NOMBRE en el Excel");
  const header = rows[headerIndex].map(plain);
  const nameColumn = header.indexOf("nombre");
  const surnameColumns = header.flatMap((label, index) => label.startsWith("apellido") ? [index] : []);
  const identityColumns = new Set([nameColumn, ...surnameColumns, ...header.flatMap((label, index) => /^(dni|nif|nie)$/.test(label) ? [index] : [])]);
  const monthRow = rows.slice(0, headerIndex).reverse().find(row => row.some(cell => monthNumber(cell))) ?? [];
  const sessionByDay = new Map(sessions.filter(session => !session.cancelled).map(session => [session.date.slice(5), session]));
  const columns = [];
  let month = null;
  rows[headerIndex].forEach((cell, index) => {
    month = monthNumber(monthRow[index]) ?? month;
    const day = Number(cell);
    if (identityColumns.has(index) || cell === null || !Number.isInteger(day) || day < 1 || day > 31 || !month) return;
    const session = sessionByDay.get(`${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    if (session) columns.push({ index, session });
  });
  const students = rows.slice(headerIndex + 1).flatMap(row => {
    const name = abbreviatedName(row[nameColumn], surnameColumns.map(index => row[index]));
    return name ? [{ name, row }] : [];
  });
  const taken = columns.filter(({ index, session }) => session.date <= today && students.some(({ row }) => isPresent(row[index])));
  return {
    sessions: taken.map(({ session }) => session.code),
    students: students.map(({ name, row }) => ({
      name,
      marks: Object.fromEntries(taken.map(({ index, session }) => [session.code, isPresent(row[index]) ? "present" : "absent"]))
    }))
  };
}

export function mergeImportedAttendance(roster, attendance, imported, { createId, now = new Date().toISOString() }) {
  const nextRoster = normalizeRoster(roster);
  const byKey = new Map(nextRoster.map(student => [studentKey(student.name), student]));
  let nextAttendance = normalizeAttendance(attendance);
  let added = 0;
  let marks = 0;
  for (const entry of imported.students) {
    let student = byKey.get(studentKey(entry.name));
    if (!student) {
      student = createStudent({ name: entry.name, id: createId(), now });
      nextRoster.push(student);
      byKey.set(studentKey(student.name), student);
      added += 1;
    } else if (!student.active) {
      student.active = true;
      student.updatedAt = now;
    }
    for (const [sessionCode, status] of Object.entries(entry.marks)) {
      nextAttendance = updateAttendance(nextAttendance, sessionCode, student.id, status);
      marks += 1;
    }
  }
  return { roster: normalizeRoster(nextRoster), attendance: nextAttendance, added, matched: imported.students.length - added, marks, sessions: imported.sessions.length };
}

export function applyRosterSeed(roster, attendance, seed, { now = new Date().toISOString() } = {}) {
  const nextRoster = normalizeRoster(roster);
  const byId = new Map(nextRoster.map(student => [student.id, student]));
  const byKey = new Map(nextRoster.map(student => [studentKey(student.name), student]));
  const resolved = new Map();
  for (const entry of seed.students) {
    let student = byId.get(entry.id) ?? byKey.get(studentKey(entry.name));
    if (!student) {
      student = createStudent({ name: entry.name, id: entry.id, now });
      nextRoster.push(student);
      byKey.set(studentKey(student.name), student);
    }
    resolved.set(entry.id, student.id);
  }
  let nextAttendance = normalizeAttendance(attendance);
  for (const [sessionCode, records] of Object.entries(seed.attendance)) {
    for (const [seedId, status] of Object.entries(records)) {
      const studentId = resolved.get(seedId);
      if (studentId && !nextAttendance[sessionCode]?.[studentId]) nextAttendance = updateAttendance(nextAttendance, sessionCode, studentId, status);
    }
  }
  return { roster: normalizeRoster(nextRoster), attendance: nextAttendance };
}
