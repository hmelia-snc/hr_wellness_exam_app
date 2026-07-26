import { renderLayout } from "./layout.js";
import { escapeHtml } from "../lib/html.js";

export interface ShareableLinkPageProps {
  link: string;
  employeeName: string;
  employeeEmail: string;
  cycleYear: number;
  backHref: string;
}

const EXTRA_STYLES = `
  input[type="text"].link-field { max-width: 100%; font-family: monospace; font-size: 0.9rem; }
`;

export function renderShareableLinkPage(props: ShareableLinkPageProps): string {
  const body = `
<h1>Link for ${escapeHtml(props.employeeName)}</h1>
<p class="notice">
  This is a brand-new link for the ${props.cycleYear} cycle — generating it
  invalidated any link previously sent to
  ${escapeHtml(props.employeeName)} (${escapeHtml(props.employeeEmail)}).
  Share this one instead.
</p>
<label for="link">Link / Enlace</label>
<input class="link-field" type="text" id="link" value="${escapeHtml(props.link)}" readonly onclick="this.select()" />
<p><a href="${props.backHref}">&larr; Back to Dashboard</a></p>
`;
  return renderLayout(`Link for ${props.employeeName}`, body, { extraStyles: EXTRA_STYLES });
}
