const DOCS_API = "https://docs.googleapis.com/v1/documents";

export const GOOGLE_DOCUMENT_MIME = "application/vnd.google-apps.document";
export const WORD_DOCUMENT_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function comparable(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dateNeedles(date = "") {
  const [year, month, day] = String(date).split("-");
  if (!year || !month || !day) return [];
  const monthName = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][Number(month) - 1];
  return [
    `${year} ${month} ${day}`,
    `${day} ${month} ${year}`,
    `${Number(day)} ${Number(month)} ${year}`,
    `${Number(day)} ${monthName} ${year}`,
    `${Number(day)} de ${monthName} de ${year}`
  ];
}

export function sessionDocumentScore(file, session) {
  if (![GOOGLE_DOCUMENT_MIME, WORD_DOCUMENT_MIME].includes(file?.mimeType)) return 0;
  const name = comparable(file.name);
  const code = comparable(session?.code);
  const hasCode = Boolean(code && new RegExp(`(?:^| )${code}(?: |$)`, "i").test(name));
  const hasDate = dateNeedles(session?.date).some(value => name.includes(value));
  if (hasCode && hasDate) return 30;
  if (hasDate) return 20;
  if (hasCode) return 10;
  return 0;
}

export function findSessionDocument(files, session) {
  const candidates = (files ?? [])
    .map(file => ({ file, score: sessionDocumentScore(file, session) }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || String(right.file.modifiedTime ?? "").localeCompare(String(left.file.modifiedTime ?? "")));
  if (!candidates.length) return null;
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    const error = new Error(`Hay varios documentos que podrían corresponder a ${session.code}; incluye la fecha o el código en el nombre para distinguirlos`);
    error.code = "ambiguous_training_document";
    throw error;
  }
  return candidates[0].file;
}

function paragraphText(element) {
  return (element?.paragraph?.elements ?? []).map(part => part.textRun?.content ?? "").join("").trim();
}

function documentBody(document) {
  if (document?.body?.content) return document.body;
  for (const tab of document?.tabs ?? []) {
    if (tab?.documentTab?.body?.content) return tab.documentTab.body;
  }
  throw new Error("El documento no contiene un cuerpo de texto compatible");
}

export function buildAdjustmentsRequests(document, adjustments) {
  const body = documentBody(document);
  const content = body.content ?? [];
  const heading = content.find(element => comparable(paragraphText(element)) === "ajustes realizados");
  const cleanText = String(adjustments ?? "").replaceAll("\r\n", "\n").trim();
  const requests = [];

  if (heading) {
    const startIndex = heading.endIndex;
    const followingHeading = content.find(element => (
      element.startIndex >= startIndex &&
      element.paragraph?.paragraphStyle?.namedStyleType?.startsWith("HEADING_")
    ));
    const documentEnd = content.at(-1)?.endIndex ?? startIndex;
    const endIndex = followingHeading?.startIndex ?? Math.max(startIndex, documentEnd - 1);
    if (endIndex > startIndex) requests.push({ deleteContentRange: { range: { startIndex, endIndex } } });
    if (cleanText) {
      requests.push({ insertText: { location: { index: startIndex }, text: `${cleanText}\n` } });
      requests.push({
        updateParagraphStyle: {
          range: { startIndex, endIndex: startIndex + cleanText.length },
          paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
          fields: "namedStyleType"
        }
      });
    }
    return requests;
  }

  const insertionIndex = Math.max(1, (content.at(-1)?.endIndex ?? 2) - 1);
  const headingText = "Ajustes realizados";
  const prefix = insertionIndex > 1 ? "\n" : "";
  requests.push({ insertText: { location: { index: insertionIndex }, text: `${prefix}${headingText}\n${cleanText ? `${cleanText}\n` : ""}` } });
  const headingStart = insertionIndex + prefix.length;
  requests.push({
    updateParagraphStyle: {
      range: { startIndex: headingStart, endIndex: headingStart + headingText.length },
      paragraphStyle: { namedStyleType: "HEADING_2" },
      fields: "namedStyleType"
    }
  });
  if (cleanText) {
    const adjustmentsStart = headingStart + headingText.length + 1;
    requests.push({
      updateParagraphStyle: {
        range: { startIndex: adjustmentsStart, endIndex: adjustmentsStart + cleanText.length },
        paragraphStyle: { namedStyleType: "NORMAL_TEXT" },
        fields: "namedStyleType"
      }
    });
  }
  return requests;
}

export class NinjutsuAdjustmentsWriter {
  constructor(drive, folderId) {
    this.drive = drive;
    this.folderId = String(folderId ?? "").trim();
  }

  async updateGoogleDocument(documentId, adjustments) {
    const document = await this.drive.request(`${DOCS_API}/${encodeURIComponent(documentId)}`);
    const requests = buildAdjustmentsRequests(document, adjustments);
    if (!requests.length) return;
    await this.drive.request(`${DOCS_API}/${encodeURIComponent(documentId)}:batchUpdate`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ requests })
    });
  }

  async save(session, adjustments) {
    if (!this.folderId) throw new Error("No está configurada la carpeta de ajustes de Ninjutsu");
    const files = await this.drive.listTree(this.folderId);
    const target = findSessionDocument(files, session);
    if (!target) throw new Error(`No se encontró un Google Docs o Word para ${session.code} (${session.date}) en la carpeta configurada`);

    if (target.mimeType === GOOGLE_DOCUMENT_MIME) {
      await this.updateGoogleDocument(target.id, adjustments);
      return { file: target, convertedWord: false };
    }

    const original = await this.drive.downloadBlob(target.id);
    let temporary = null;
    try {
      temporary = await this.drive.importAsGoogleDocument(`Ajustes temporales ${session.code}`, target.parentId ?? this.folderId, original);
      await this.updateGoogleDocument(temporary.id, adjustments);
      const updatedWord = await this.drive.exportFile(temporary.id, WORD_DOCUMENT_MIME);
      await this.drive.updateFileContent(target.id, updatedWord, WORD_DOCUMENT_MIME);
      return { file: target, convertedWord: true };
    } finally {
      if (temporary?.id) await this.drive.trash(temporary.id).catch(() => {});
    }
  }
}
