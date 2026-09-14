import { renderLayout } from "./layout.js";
import { escapeHtml } from "../lib/html.js";

export interface ShareableLinkPageProps {
  link: string;
  employeeName: string;
  // Null for a spouse roster record (no email/link of its own is ever sent —
  // the spouse submits through the primary employee's link instead).
  employeeEmail: string | null;
  cycleYear: number;
  regenerated: boolean;
  backHref: string;
}

const EXTRA_STYLES = `
  input[type="text"].link-field { max-width: 100%; font-family: monospace; font-size: 0.9rem; }
`;

export function renderShareableLinkPage(props: ShareableLinkPageProps): string {
  const notice = props.regenerated
    ? `<p class="notice">
  ${escapeHtml(props.employeeName)}'s previous link for the ${props.cycleYear} cycle had no usable
  token on file (or had expired), so this is a brand-new one — it invalidated
  that old link. Share this one instead.
</p>`
    : `<p class="notice-success">
  This is ${escapeHtml(props.employeeName)}'s current link for the ${props.cycleYear} cycle${
        props.employeeEmail ? ` — the same one already sent to ${escapeHtml(props.employeeEmail)}` : ""
      }. Sharing it again doesn't invalidate anything.
</p>`;

  const body = `
<h1>Link for ${escapeHtml(props.employeeName)}</h1>
${notice}
<label for="link">Link / Enlace</label>
<input class="link-field" type="text" id="link" value="${escapeHtml(props.link)}" readonly onclick="this.select()" />
<p><a href="${props.backHref}">&larr; Back to Dashboard</a></p>
`;
  return renderLayout(`Link for ${props.employeeName}`, body, { extraStyles: EXTRA_STYLES });
}
