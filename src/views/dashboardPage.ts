import { renderLayout, BRAND } from "./layout.js";
import { escapeHtml } from "../lib/html.js";
import type { HrUser } from "../lib/auth.js";

export interface DashboardRecordRow {
  id: string;
  employeeName: string;
  employeeEmail: string;
  employeeActive: boolean;
  status: string;
  sentAt: Date | null;
  receivedAt: Date | null;
  completedAt: Date | null;
  needsSpouseForm: boolean;
  spouseReceivedAt: Date | null;
  verificationResult: string | null;
  hasUploadedFile: boolean;
  hasSpouseFile: boolean;
}

function progressLabel(r: Pick<DashboardRecordRow, "receivedAt" | "needsSpouseForm" | "spouseReceivedAt">): string {
  const total = r.needsSpouseForm ? 2 : 1;
  const done = (r.receivedAt ? 1 : 0) + (r.needsSpouseForm && r.spouseReceivedAt ? 1 : 0);
  return `${done} of ${total}`;
}

export interface DashboardPageProps {
  hrUser: HrUser;
  cycleYear: number;
  statusFilter?: string;
  resendFailed?: boolean;
  records: DashboardRecordRow[];
}

const STATUSES = ["sent", "received", "needs_review", "completed"];

const EXTRA_STYLES = `
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #ddd; }
  th { font-weight: 700; color: ${BRAND.darkRed}; }
  .status-badge { display: inline-block; padding: 0.15rem 0.6rem; border-radius: 999px; font-size: 0.8rem; font-weight: 500; }
  .status-sent { background: #eaeaea; color: #444; }
  .status-received { background: #fff3cd; color: #7a5b00; }
  .status-needs_review { background: ${BRAND.redTint10}; color: ${BRAND.darkRed}; }
  .status-completed { background: #d9f2d9; color: #1e6b1e; }
  .filters { margin: 1rem 0; }
  .filters a { margin-right: 0.9rem; text-decoration: none; color: ${BRAND.red}; font-weight: 500; }
  .filters a.active { text-decoration: underline; }
  .session-line { color: #666; font-size: 0.9rem; }
  .session-line a { color: ${BRAND.red}; }
  .nav-line { margin: 0.5rem 0 1rem; }
  .nav-line a { color: ${BRAND.red}; font-weight: 500; text-decoration: none; }
  .small-button {
    font-family: 'Ubuntu', Arial, sans-serif;
    font-size: 0.8rem;
    padding: 0.25rem 0.6rem;
    border-radius: 6px;
    border: 1px solid ${BRAND.red};
    background: transparent;
    color: ${BRAND.red};
    cursor: pointer;
  }
  .small-button:hover { background: ${BRAND.red}; color: #fff; }
  .actions-cell { display: flex; gap: 0.4rem; }
  .actions-cell form { display: inline; }
  .inactive-note { color: #888; font-size: 0.8rem; font-style: italic; }
  .file-link { display: block; font-size: 0.75rem; color: ${BRAND.red}; text-decoration: none; margin-top: 0.15rem; }
  .file-link:hover { text-decoration: underline; }
  .export-link { color: ${BRAND.red}; font-weight: 500; text-decoration: none; font-size: 0.9rem; }
  .notice-error { background: ${BRAND.redTint10}; color: ${BRAND.darkRed}; border: 1px solid ${BRAND.redTintBorder}; border-radius: 6px; padding: 0.6rem 1rem; margin-bottom: 1rem; }
  @media (prefers-color-scheme: dark) {
    th, td { border-bottom-color: #3a3836; }
    .status-sent { background: #333230; color: #ccc; }
    .session-line { color: #aaa; }
    .inactive-note { color: #999; }
    .notice-error { background: ${BRAND.redTint10Dark}; color: #f5b9b4; border-color: ${BRAND.redTintBorderDark}; }
  }
`;

function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "—";
}

function filterLabel(status: string): string {
  return status.replace(/_/g, " ").toUpperCase();
}

export function renderDashboardPage(props: DashboardPageProps): string {
  const resendQuery = new URLSearchParams();
  resendQuery.set("year", String(props.cycleYear));
  if (props.statusFilter) resendQuery.set("status", props.statusFilter);

  const rows = props.records
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.employeeName)}</td>
      <td>${escapeHtml(r.employeeEmail)}</td>
      <td><span class="status-badge status-${escapeHtml(r.status)}"${r.verificationResult ? ` title="${escapeHtml(r.verificationResult)}"` : ""}>${escapeHtml(r.status)}</span></td>
      <td>
        ${progressLabel(r)}
        ${r.hasUploadedFile ? `<a class="file-link" href="/dashboard/records/${encodeURIComponent(r.id)}/file" target="_blank" rel="noopener">View file</a>` : ""}
        ${r.hasSpouseFile ? `<a class="file-link" href="/dashboard/records/${encodeURIComponent(r.id)}/spouse-file" target="_blank" rel="noopener">View spouse file</a>` : ""}
      </td>
      <td>${formatDate(r.sentAt)}</td>
      <td>${formatDate(r.receivedAt)}</td>
      <td>${formatDate(r.completedAt)}</td>
      <td class="actions-cell">
        ${
          r.employeeActive
            ? `<form method="post" action="/dashboard/records/${encodeURIComponent(r.id)}/resend?${resendQuery.toString()}">
          <button type="submit" class="small-button">Resend</button>
        </form>
        <form method="post" action="/dashboard/records/${encodeURIComponent(r.id)}/link?${resendQuery.toString()}">
          <button type="submit" class="small-button">Get Link</button>
        </form>`
            : `<span class="inactive-note">Employee inactive</span>`
        }
        ${
          r.status === "needs_review"
            ? `<form method="post" action="/dashboard/records/${encodeURIComponent(r.id)}/approve?${resendQuery.toString()}">
          <button type="submit" class="small-button">Approve</button>
        </form>`
            : ""
        }
      </td>
    </tr>`
    )
    .join("");

  const filterLink = (label: string, status?: string) => {
    const href = `/dashboard?year=${props.cycleYear}${status ? `&status=${status}` : ""}`;
    const isActive = (status ?? undefined) === props.statusFilter;
    return `<a href="${href}"${isActive ? ' class="active"' : ""}>${escapeHtml(label)}</a>`;
  };

  const resendFailedNotice = props.resendFailed
    ? `<div class="notice-error">The link was regenerated, but the email failed to send — check the server logs for details, or use "Get Link" to grab it manually.</div>`
    : "";

  const exportQuery = new URLSearchParams();
  exportQuery.set("year", String(props.cycleYear));
  if (props.statusFilter) exportQuery.set("status", props.statusFilter);

  const body = `
<h1>HR Dashboard — ${props.cycleYear} Cycle</h1>
<p class="session-line">Signed in as ${escapeHtml(props.hrUser.name)} (${escapeHtml(
    props.hrUser.email
  )}) &middot; <a href="/auth/logout">Sign out</a></p>
<p class="nav-line"><a href="/dashboard/employees">Manage Employees →</a></p>
${resendFailedNotice}
<div class="filters">
  ${filterLink("ALL")}
  ${STATUSES.map((s) => filterLink(filterLabel(s), s)).join("")}
  <a class="export-link" href="/dashboard/export?${exportQuery.toString()}">Export CSV →</a>
</div>
<table>
  <thead>
    <tr><th>Employee</th><th>Email</th><th>Status</th><th>Progress</th><th>Sent</th><th>Received</th><th>Completed</th><th></th></tr>
  </thead>
  <tbody>${rows || `<tr><td colspan="8">No records for this cycle${props.statusFilter ? ` with status "${escapeHtml(props.statusFilter)}"` : ""}.</td></tr>`}</tbody>
</table>
`;

  return renderLayout(`HR Dashboard — ${props.cycleYear}`, body, { wide: true, extraStyles: EXTRA_STYLES });
}
