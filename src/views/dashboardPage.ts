import { renderLayout, BRAND } from "./layout.js";
import { escapeHtml } from "../lib/html.js";
import type { HrUser } from "../lib/auth.js";

export interface DashboardRecordRow {
  employeeName: string;
  employeeEmail: string;
  status: string;
  sentAt: Date | null;
  receivedAt: Date | null;
  completedAt: Date | null;
}

export interface DashboardPageProps {
  hrUser: HrUser;
  cycleYear: number;
  statusFilter?: string;
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
  @media (prefers-color-scheme: dark) {
    th, td { border-bottom-color: #3a3836; }
    .status-sent { background: #333230; color: #ccc; }
    .session-line { color: #aaa; }
  }
`;

function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "—";
}

export function renderDashboardPage(props: DashboardPageProps): string {
  const rows = props.records
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.employeeName)}</td>
      <td>${escapeHtml(r.employeeEmail)}</td>
      <td><span class="status-badge status-${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
      <td>${formatDate(r.sentAt)}</td>
      <td>${formatDate(r.receivedAt)}</td>
      <td>${formatDate(r.completedAt)}</td>
    </tr>`
    )
    .join("");

  const filterLink = (label: string, status?: string) => {
    const href = `/dashboard?year=${props.cycleYear}${status ? `&status=${status}` : ""}`;
    const isActive = (status ?? undefined) === props.statusFilter;
    return `<a href="${href}"${isActive ? ' class="active"' : ""}>${label}</a>`;
  };

  const body = `
<h1>HR Dashboard — ${props.cycleYear} Cycle</h1>
<p class="session-line">Signed in as ${escapeHtml(props.hrUser.name)} (${escapeHtml(
    props.hrUser.email
  )}) &middot; <a href="/auth/logout">Sign out</a></p>
<div class="filters">
  ${filterLink("All")}
  ${STATUSES.map((s) => filterLink(s, s)).join("")}
</div>
<table>
  <thead>
    <tr><th>Employee</th><th>Email</th><th>Status</th><th>Sent</th><th>Received</th><th>Completed</th></tr>
  </thead>
  <tbody>${rows || `<tr><td colspan="6">No records for this cycle${props.statusFilter ? ` with status "${escapeHtml(props.statusFilter)}"` : ""}.</td></tr>`}</tbody>
</table>
`;

  return renderLayout(`HR Dashboard — ${props.cycleYear}`, body, { wide: true, extraStyles: EXTRA_STYLES });
}
