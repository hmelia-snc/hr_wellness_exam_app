import { escapeHtml } from "../lib/html.js";
import { renderLayout } from "./layout.js";

export type PhysicalPageStatus = "sent" | "received" | "needs_review";
export type BlockedPageKind = "not_found" | "expired" | "completed";

export interface UploadedFileInfo {
  contentType: string;
}

const EXTRA_STYLES = `
  .content-columns { display: flex; gap: 2rem; align-items: flex-start; flex-wrap: wrap; }
  .content-main { flex: 1 1 320px; min-width: 280px; }
  .content-preview { flex: 1 1 280px; min-width: 240px; }
  .preview-frame { width: 100%; height: 480px; border: 1px solid #ddd; border-radius: 6px; background: #fff; }
  .preview-image { max-width: 100%; border: 1px solid #ddd; border-radius: 6px; }
  @media (prefers-color-scheme: dark) {
    .preview-frame { border-color: #3a3836; }
    .preview-image { border-color: #3a3836; }
  }
`;

function statusNotice(status: PhysicalPageStatus): string {
  switch (status) {
    case "sent":
      return "";
    case "received":
      return `<p class="notice-success">We've received your uploaded form — thank you! If you need to replace it, upload a new one below.<br>Hemos recibido su formulario — ¡gracias! Si necesita reemplazarlo, suba uno nuevo a continuación.</p>`;
    case "needs_review":
      return `<p class="notice-success">Your form is being reviewed by HR. If you need to replace it, upload a new one below.<br>Su formulario está siendo revisado por Recursos Humanos. Si necesita reemplazarlo, suba uno nuevo a continuación.</p>`;
  }
}

function renderPreviewColumn(safeToken: string, contentType: string): string {
  const previewUrl = `/wellness-exam/${safeToken}/uploaded-file`;
  const viewer = contentType.startsWith("image/")
    ? `<img class="preview-image" src="${previewUrl}" alt="Uploaded form" />`
    : `<iframe class="preview-frame" src="${previewUrl}" title="Uploaded form"></iframe>`;
  return `
<div class="content-preview">
  <h2>Uploaded document / Documento subido</h2>
  ${viewer}
</div>`;
}

export interface SpouseFormInfo {
  needsSpouseForm: boolean;
  spouseReceived: boolean;
}

function spouseStatusLine(spouseReceived: boolean): string {
  return spouseReceived
    ? `<p class="notice-success">Spouse form: received — thank you!<br>Formulario del cónyuge: recibido — ¡gracias!</p>`
    : `<p class="notice">Spouse form: not yet received.<br>Formulario del cónyuge: aún no recibido.</p>`;
}

export function renderPhysicalPage(
  token: string,
  status: PhysicalPageStatus,
  uploadedFile: UploadedFileInfo | null = null,
  spouseForm: SpouseFormInfo | null = null
): string {
  const safeToken = encodeURIComponent(token);
  const needsSpouseForm = spouseForm?.needsSpouseForm ?? false;

  const employeeFileField = needsSpouseForm
    ? `<label for="form">Your completed form / Su formulario completado</label>
    <input type="file" id="form" name="form" accept=".pdf,.jpg,.jpeg,.png" />`
    : `<label for="form">Completed form / Formulario completado</label>
    <input type="file" id="form" name="form" accept=".pdf,.jpg,.jpeg,.png" required />`;

  const spouseFileField = needsSpouseForm
    ? `<label for="spouseForm">Spouse's completed form / Formulario completado del cónyuge</label>
    <input type="file" id="spouseForm" name="spouseForm" accept=".pdf,.jpg,.jpeg,.png" />
    ${spouseStatusLine(spouseForm!.spouseReceived)}`
    : "";

  const mainColumn = `
<div class="content-main">
<h1>Wellness Exam Verification / Verificación del Examen de Bienestar</h1>
${statusNotice(status)}
<section>
  <h2>1. Download the blank form / Descargue el formulario en blanco</h2>
  <div class="downloads">
    <a class="button" href="/wellness-exam/${safeToken}/download?lang=en">Download (English)</a>
    <a class="button" href="/wellness-exam/${safeToken}/download?lang=es">Descargar (Español)</a>
  </div>
</section>
<section>
  <h2>2. Upload your completed form / Suba su formulario completado</h2>
  <form action="/wellness-exam/${safeToken}/upload" method="post" enctype="multipart/form-data">
    ${employeeFileField}
    ${spouseFileField}
    <div><button type="submit" style="margin-top: 1rem;">Upload / Subir</button></div>
  </form>
</section>
</div>`;

  const body = `<div class="content-columns">${mainColumn}${
    uploadedFile ? renderPreviewColumn(safeToken, uploadedFile.contentType) : ""
  }</div>`;

  return renderLayout("Wellness Exam Verification", body, {
    wide: Boolean(uploadedFile),
    extraStyles: EXTRA_STYLES,
  });
}

export function renderBlockedPage(kind: BlockedPageKind): string {
  const copy = blockedCopy(kind);
  return renderLayout(copy.title, `<h1>${escapeHtml(copy.title)}</h1><p>${copy.message}</p>`);
}

function blockedCopy(kind: BlockedPageKind): { title: string; message: string } {
  switch (kind) {
    case "expired":
      return {
        title: "Link expired / Enlace vencido",
        message:
          "This link has expired. Please contact HR for a new one.<br>Este enlace ha vencido. Comuníquese con Recursos Humanos para obtener uno nuevo.",
      };
    case "completed":
      return {
        title: "Already completed / Ya completado",
        message:
          "This form has already been completed — thank you!<br>Este formulario ya ha sido completado — ¡gracias!",
      };
    case "not_found":
      return {
        title: "Link not found / Enlace no encontrado",
        message:
          "We couldn't find this link. Please check the URL or contact HR.<br>No pudimos encontrar este enlace. Verifique la URL o comuníquese con Recursos Humanos.",
      };
  }
}
