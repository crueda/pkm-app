import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAdjustmentsRequests,
  findSessionDocument,
  GOOGLE_DOCUMENT_MIME,
  NinjutsuAdjustmentsWriter,
  sessionDocumentScore,
  WORD_DOCUMENT_MIME
} from "../app/src/ninjutsu-adjustments.js";

const session = { code: "L41", date: "2026-10-05" };

test("localiza el documento del día por código y fecha", () => {
  const files = [
    { id: "other", name: "2026-10-05 - X41.docx", mimeType: WORD_DOCUMENT_MIME },
    { id: "target", name: "2026-10-05 - L41 - Entrenamiento.docx", mimeType: WORD_DOCUMENT_MIME }
  ];
  assert.equal(sessionDocumentScore(files[1], session), 30);
  assert.equal(findSessionDocument(files, session)?.id, "target");
  assert.equal(sessionDocumentScore({ name: "Entrenamiento 5 de octubre de 2026", mimeType: GOOGLE_DOCUMENT_MIME }, session), 20);
  assert.equal(sessionDocumentScore({ name: "L41.pdf", mimeType: "application/pdf" }, session), 0);
});

test("rechaza coincidencias ambiguas antes de sobrescribir", () => {
  const files = [
    { id: "a", name: "L41 primer grupo", mimeType: GOOGLE_DOCUMENT_MIME },
    { id: "b", name: "L41 segundo grupo", mimeType: WORD_DOCUMENT_MIME }
  ];
  assert.throws(() => findSessionDocument(files, session), error => error?.code === "ambiguous_training_document");
});

test("reemplaza solo el contenido de la sección Ajustes realizados", () => {
  const document = { body: { content: [
    { startIndex: 1, endIndex: 20, paragraph: { paragraphStyle: { namedStyleType: "HEADING_2" }, elements: [{ textRun: { content: "Ajustes realizados\n" } }] } },
    { startIndex: 20, endIndex: 30, paragraph: { paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, elements: [{ textRun: { content: "Anterior\n" } }] } },
    { startIndex: 30, endIndex: 40, paragraph: { paragraphStyle: { namedStyleType: "HEADING_2" }, elements: [{ textRun: { content: "Siguiente\n" } }] } }
  ] } };
  assert.deepEqual(buildAdjustmentsRequests(document, "Trabajo nuevo"), [
    { deleteContentRange: { range: { startIndex: 20, endIndex: 30 } } },
    { insertText: { location: { index: 20 }, text: "Trabajo nuevo\n" } },
    { updateParagraphStyle: { range: { startIndex: 20, endIndex: 33 }, paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, fields: "namedStyleType" } }
  ]);
});

test("crea la sección cuando el documento todavía no la tiene", () => {
  const document = { body: { content: [
    { startIndex: 1, endIndex: 8, paragraph: { paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, elements: [{ textRun: { content: "Texto\n" } }] } }
  ] } };
  const requests = buildAdjustmentsRequests(document, "Adaptar ukemi");
  assert.match(requests[0].insertText.text, /Ajustes realizados\nAdaptar ukemi/);
  assert.equal(requests[1].updateParagraphStyle.paragraphStyle.namedStyleType, "HEADING_2");
});

test("actualiza directamente un Google Docs localizado en la carpeta", async () => {
  const calls = [];
  const target = { id: "doc", name: "2026-10-05 - L41", mimeType: GOOGLE_DOCUMENT_MIME };
  const drive = {
    async listTree(folderId) { calls.push(["list", folderId]); return [target]; },
    async request(url, options = {}) {
      calls.push([options.method || "GET", url]);
      if (!options.method) return { body: { content: [{ startIndex: 1, endIndex: 2, paragraph: { elements: [{ textRun: { content: "\n" } }] } }] } };
      return {};
    }
  };
  const result = await new NinjutsuAdjustmentsWriter(drive, "folder").save(session, "Ajustar distancia");
  assert.equal(result.file.id, "doc");
  assert.deepEqual(calls.map(call => call[0]), ["list", "GET", "POST"]);
});

test("convierte Word temporalmente, actualiza el original y manda el temporal a la papelera", async () => {
  const calls = [];
  const target = { id: "word", parentId: "folder", name: "L41.docx", mimeType: WORD_DOCUMENT_MIME };
  const drive = {
    async listTree() { return [target]; },
    async downloadBlob() { calls.push("download"); return new Blob(["word"], { type: WORD_DOCUMENT_MIME }); },
    async importAsGoogleDocument() { calls.push("import"); return { id: "temp" }; },
    async request(_url, options = {}) {
      calls.push(options.method || "get-doc");
      if (!options.method) return { body: { content: [{ startIndex: 1, endIndex: 2, paragraph: { elements: [{ textRun: { content: "\n" } }] } }] } };
      return {};
    },
    async exportFile() { calls.push("export"); return new Blob(["updated"], { type: WORD_DOCUMENT_MIME }); },
    async updateFileContent(fileId) { calls.push(`update:${fileId}`); },
    async trash(fileId) { calls.push(`trash:${fileId}`); }
  };
  const result = await new NinjutsuAdjustmentsWriter(drive, "folder").save(session, "Ajustar distancia");
  assert.equal(result.convertedWord, true);
  assert.deepEqual(calls, ["download", "import", "get-doc", "POST", "export", "update:word", "trash:temp"]);
});
