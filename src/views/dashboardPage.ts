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
  rejectionReason: string | null;
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
  availableYears: number[];
  statusFilter?: string;
  resendFailed?: boolean;
  rejectEmailFailed?: boolean;
  bulkApproved?: number;
  bulkResent?: number;
  bulkResentFailed?: number;
  bulkResentSkipped?: number;
  bulkRejected?: number;
  bulkRejectedFailed?: number;
  bulkRejectedSkipped?: number;
  records: DashboardRecordRow[];
}

const STATUSES = ["sent", "received", "needs_review", "rejected", "completed"];

const EXTRA_STYLES = `
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #ddd; }
  th { font-weight: 700; color: ${BRAND.darkRed}; }
  .status-badge { display: inline-block; padding: 0.15rem 0.6rem; border-radius: 999px; font-size: 0.8rem; font-weight: 500; }
  .status-sent { background: #eaeaea; color: #444; }
  .status-received { background: #fff3cd; color: #7a5b00; }
  .status-needs_review { background: ${BRAND.redTint10}; color: ${BRAND.darkRed}; }
  .status-rejected { background: ${BRAND.red}; color: #fff; }
  .status-completed { background: #d9f2d9; color: #1e6b1e; }
  .filters { margin: 1rem 0; }
  .filters a { margin-right: 0.9rem; text-decoration: none; color: ${BRAND.red}; font-weight: 500; }
  .filters a.active { text-decoration: underline; }
  .session-line { color: #666; font-size: 0.9rem; }
  .session-line a { color: ${BRAND.red}; }
  .nav-line { margin: 0.5rem 0 1rem; }
  .nav-line a { color: ${BRAND.red}; font-weight: 500; text-decoration: none; }
  .year-select-form { display: inline-flex; align-items: center; gap: 0.4rem; margin: 0.5rem 0 1rem 1.5rem; }
  .year-select-form label { font-weight: 500; }
  .year-select-form select {
    font-family: 'Ubuntu', Arial, sans-serif;
    font-size: 0.95rem;
    padding: 0.3rem 0.5rem;
    border-radius: 6px;
    border: 1px solid #ccc;
  }
  .small-button {
    font-family: 'Ubuntu', Arial, sans-serif;
    font-size: 0.8rem;
    padding: 0.25rem 0.6rem;
    border-radius: 6px;
    border: 1px solid ${BRAND.red};
    background: transparent;
    color: ${BRAND.red};
    cursor: pointer;
    white-space: nowrap;
  }
  .small-button:hover { background: ${BRAND.red}; color: #fff; }
  .actions-cell { display: flex; flex-wrap: nowrap; gap: 0.4rem; white-space: nowrap; }
  .actions-cell form { display: inline; }
  .inactive-note { color: #888; font-size: 0.8rem; font-style: italic; white-space: nowrap; }
  .file-link { display: block; font-size: 0.75rem; color: ${BRAND.red}; text-decoration: none; margin-top: 0.15rem; }
  .file-link:hover { text-decoration: underline; }
  .export-link { color: ${BRAND.red}; font-weight: 500; text-decoration: none; font-size: 0.9rem; }
  .notice-error { margin-bottom: 1rem; }
  .rejection-reason { display: block; font-size: 0.75rem; color: ${BRAND.darkRed}; margin-top: 0.15rem; max-width: 22ch; }
  .bulk-toolbar { display: flex; align-items: center; gap: 0.5rem; margin: 0.75rem 0; flex-wrap: wrap; }
  .bulk-toolbar .small-button { padding: 0.4rem 0.8rem; font-size: 0.85rem; }
  .bulk-toolbar-label { font-size: 0.85rem; color: #666; }
  dialog#reject-dialog {
    border: none;
    border-radius: 10px;
    padding: 1.25rem 1.5rem 1.5rem;
    max-width: 420px;
    width: 90vw;
    box-shadow: 0 10px 40px rgba(0,0,0,0.25);
  }
  dialog#reject-dialog::backdrop { background: rgba(0,0,0,0.4); }
  dialog#reject-dialog h2 { margin: 0 0 0.5rem; font-size: 1.1rem; }
  dialog#reject-dialog textarea {
    width: 100%;
    font-family: 'Ubuntu', Arial, sans-serif;
    font-size: 0.95rem;
    padding: 0.5rem 0.6rem;
    border-radius: 6px;
    border: 1px solid #ccc;
    box-sizing: border-box;
    resize: vertical;
  }
  .dialog-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.9rem; }
  #reject-count { font-size: 0.85rem; color: #666; margin: 0 0 0.5rem; }
  @media (prefers-color-scheme: dark) {
    th, td { border-bottom-color: #3a3836; }
    .status-sent { background: #333230; color: #ccc; }
    .session-line { color: #aaa; }
    .inactive-note { color: #999; }
    .year-select-form select { background: #232120; color: #ededed; border-color: #45423f; }
    .bulk-toolbar-label { color: #aaa; }
    dialog#reject-dialog { background: #232120; color: #ededed; }
    dialog#reject-dialog textarea { background: #17140f; color: #ededed; border-color: #45423f; }
    #reject-count { color: #aaa; }
  }
`;

function formatDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "—";
}

function filterLabel(status: string): string {
  return status.replace(/_/g, " ").toUpperCase();
}

export function renderDashboardPage(props: DashboardPageProps): string {
  const query = new URLSearchParams();
  query.set("year", String(props.cycleYear));
  if (props.statusFilter) query.set("status", props.statusFilter);
  const qs = query.toString();

  const rows = props.records
    .map(
      (r) => `
    <tr>
      <td><input type="checkbox" name="ids" value="${escapeHtml(r.id)}" aria-label="Select ${escapeHtml(r.employeeName)}"${r.employeeActive ? "" : ` disabled title="Employee inactive — excluded from bulk actions"`} /></td>
      <td>${escapeHtml(r.employeeName)}</td>
      <td>${escapeHtml(r.employeeEmail)}</td>
      <td>
        <span class="status-badge status-${escapeHtml(r.status)}"${r.verificationResult ? ` title="${escapeHtml(r.verificationResult)}"` : ""}>${escapeHtml(r.status)}</span>
        ${r.rejectionReason ? `<span class="rejection-reason" title="${escapeHtml(r.rejectionReason)}">${escapeHtml(r.rejectionReason)}</span>` : ""}
      </td>
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
            ? `<button type="submit" formaction="/dashboard/records/${encodeURIComponent(r.id)}/resend?${qs}" formmethod="post" class="small-button">Resend</button>
        <button type="submit" formaction="/dashboard/records/${encodeURIComponent(r.id)}/link?${qs}" formmethod="post" class="small-button">Get Link</button>`
            : `<span class="inactive-note">Employee inactive</span>`
        }
        ${
          r.status === "needs_review"
            ? `<button type="submit" formaction="/dashboard/records/${encodeURIComponent(r.id)}/approve?${qs}" formmethod="post" class="small-button">Approve</button>`
            : ""
        }
        ${
          r.employeeActive && r.status !== "rejected" && r.status !== "completed"
            ? `<button type="button" class="small-button" onclick="openRejectModal(${escapeHtml(JSON.stringify([r.id]))}, ${escapeHtml(JSON.stringify(r.employeeName))})">Reject</button>`
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

  const notices: string[] = [];
  if (props.resendFailed) {
    notices.push(
      `<div class="notice-error">The link was regenerated, but the email failed to send — check the server logs for details, or use "Get Link" to grab it manually.</div>`
    );
  }
  if (props.rejectEmailFailed) {
    notices.push(
      `<div class="notice-error">The record was rejected, but the notification email failed to send — check the server logs for details.</div>`
    );
  }
  if (props.bulkApproved !== undefined) {
    notices.push(`<div class="notice-success">Approved ${props.bulkApproved} record(s).</div>`);
  }
  if (props.bulkResent !== undefined) {
    const failedNote = props.bulkResentFailed ? ` (${props.bulkResentFailed} email(s) failed to send — check server logs)` : "";
    const skippedNote = props.bulkResentSkipped ? ` — ${props.bulkResentSkipped} skipped (employee inactive)` : "";
    notices.push(
      `<div class="${props.bulkResentFailed ? "notice-error" : "notice-success"}">Resent ${props.bulkResent} record(s)${failedNote}${skippedNote}.</div>`
    );
  }
  if (props.bulkRejected !== undefined) {
    const failedNote = props.bulkRejectedFailed ? ` (${props.bulkRejectedFailed} email(s) failed to send — check server logs)` : "";
    const skippedNote = props.bulkRejectedSkipped ? ` — ${props.bulkRejectedSkipped} skipped (employee inactive)` : "";
    notices.push(
      `<div class="${props.bulkRejectedFailed ? "notice-error" : "notice-success"}">Rejected ${props.bulkRejected} record(s)${failedNote}${skippedNote}.</div>`
    );
  }

  const exportQuery = new URLSearchParams();
  exportQuery.set("year", String(props.cycleYear));
  if (props.statusFilter) exportQuery.set("status", props.statusFilter);

  const yearOptions = props.availableYears
    .map((y) => `<option value="${y}"${y === props.cycleYear ? " selected" : ""}>${y}</option>`)
    .join("");

  const body = `
<h1>HR Dashboard — ${props.cycleYear} Cycle</h1>
<p class="session-line">Signed in as ${escapeHtml(props.hrUser.name)} (${escapeHtml(
    props.hrUser.email
  )}) &middot; <a href="/auth/logout">Sign out</a></p>
<p class="nav-line"><a href="/dashboard/employees">Manage Employees →</a></p>
<form class="year-select-form" method="get" action="/dashboard">
  <label for="year">Cycle year</label>
  <select id="year" name="year" onchange="this.form.submit()">${yearOptions}</select>
  ${props.statusFilter ? `<input type="hidden" name="status" value="${escapeHtml(props.statusFilter)}" />` : ""}
  <noscript><button type="submit">Go</button></noscript>
</form>
${notices.join("\n")}
<div class="filters">
  ${filterLink("ALL")}
  ${STATUSES.map((s) => filterLink(filterLabel(s), s)).join("")}
  <a class="export-link" href="/dashboard/export?${exportQuery.toString()}">Export CSV →</a>
</div>
<form id="bulk-form" method="post">
  <div class="bulk-toolbar">
    <span class="bulk-toolbar-label">With selected:</span>
    <button type="submit" formaction="/dashboard/bulk/approve?${qs}" class="small-button" onclick="return confirmBulk('approve')">Approve Selected</button>
    <button type="submit" formaction="/dashboard/bulk/resend?${qs}" class="small-button" onclick="return confirmBulk('resend')">Resend Selected</button>
    <button type="button" class="small-button" onclick="openBulkRejectModal()">Reject Selected</button>
  </div>
  <table>
    <thead>
      <tr>
        <th><input type="checkbox" id="select-all" onclick="toggleAllRows(this)" aria-label="Select all" /></th>
        <th>Employee</th><th>Email</th><th>Status</th><th>Progress</th><th>Sent</th><th>Received</th><th>Completed</th><th></th>
      </tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="9">No records for this cycle${props.statusFilter ? ` with status "${escapeHtml(props.statusFilter)}"` : ""}.</td></tr>`}</tbody>
  </table>
</form>

<dialog id="reject-dialog">
  <form method="post" id="reject-form">
    <h2>Reject <span id="reject-target-name">form</span></h2>
    <p id="reject-count"></p>
    <div id="reject-ids-container"></div>
    <label for="reject-reason">Reason (included in the email to the employee)</label>
    <textarea id="reject-reason" name="reason" rows="4" required></textarea>
    <div class="dialog-actions">
      <button type="button" class="small-button" onclick="document.getElementById('reject-dialog').close()">Cancel</button>
      <button type="submit" class="small-button">Send Rejection</button>
    </div>
  </form>
</dialog>

<script>
  function selectedRowIds() {
    return Array.prototype.slice.call(document.querySelectorAll('#bulk-form input[name="ids"]:checked')).map(function (cb) {
      return cb.value;
    });
  }
  function toggleAllRows(source) {
    var boxes = document.querySelectorAll('#bulk-form input[name="ids"]:not(:disabled)');
    for (var i = 0; i < boxes.length; i++) boxes[i].checked = source.checked;
  }
  function confirmBulk(action) {
    var ids = selectedRowIds();
    if (ids.length === 0) {
      alert('Select at least one record first.');
      return false;
    }
    return confirm(action.charAt(0).toUpperCase() + action.slice(1) + ' ' + ids.length + ' record(s)?');
  }
  function openRejectModal(ids, targetName) {
    var form = document.getElementById('reject-form');
    form.action = ids.length === 1
      ? '/dashboard/records/' + encodeURIComponent(ids[0]) + '/reject?${qs}'
      : '/dashboard/bulk/reject?${qs}';
    var container = document.getElementById('reject-ids-container');
    container.innerHTML = '';
    if (ids.length > 1) {
      ids.forEach(function (id) {
        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'ids';
        input.value = id;
        container.appendChild(input);
      });
    }
    document.getElementById('reject-target-name').textContent = targetName || (ids.length + ' record(s)');
    document.getElementById('reject-count').textContent = ids.length > 1 ? ('This reason will be emailed to all ' + ids.length + ' employees.') : '';
    document.getElementById('reject-reason').value = '';
    document.getElementById('reject-dialog').showModal();
  }
  function openBulkRejectModal() {
    var ids = selectedRowIds();
    if (ids.length === 0) {
      alert('Select at least one record first.');
      return;
    }
    openRejectModal(ids, null);
  }
</script>
`;

  return renderLayout(`HR Dashboard — ${props.cycleYear}`, body, { wide: true, extraStyles: EXTRA_STYLES });
}
