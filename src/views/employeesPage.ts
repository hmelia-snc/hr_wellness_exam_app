import { renderLayout, BRAND } from "./layout.js";
import { escapeHtml } from "../lib/html.js";
import type { HrUser } from "../lib/auth.js";
import type { ImportCycleResult } from "../services/importCycle.js";

export interface EmployeeRow {
  id: string;
  fullName: string;
  email: string;
  employeeIdExternal: string | null;
  active: boolean;
  needsSpouseForm: boolean;
}

export type AddResult = "added" | "exists" | "added_email_failed";

export interface EmployeesPageProps {
  hrUser: HrUser;
  defaultCycleYear: number;
  employees: EmployeeRow[];
  addResult?: AddResult;
  importResult?: ImportCycleResult;
  deleted?: boolean;
}

const EXTRA_STYLES = `
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #ddd; }
  th { font-weight: 700; color: ${BRAND.darkRed}; }
  .status-badge { display: inline-block; padding: 0.15rem 0.6rem; border-radius: 999px; font-size: 0.8rem; font-weight: 500; }
  .status-active { background: #d9f2d9; color: #1e6b1e; }
  .status-inactive { background: #eaeaea; color: #555; }
  .nav-line { margin: 0.5rem 0 1rem; }
  .nav-line a { color: ${BRAND.red}; font-weight: 500; text-decoration: none; }
  .session-line { color: #666; font-size: 0.9rem; }
  .session-line a { color: ${BRAND.red}; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem 1.25rem; margin: 1rem 0; }
  .card h2 { margin-top: 0; }
  .inline-fields { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-end; }
  .inline-fields > div { display: flex; flex-direction: column; }
  .inline-fields input[type="text"],
  .inline-fields input[type="email"],
  .inline-fields input[type="number"] {
    font-family: 'Ubuntu', Arial, sans-serif;
    padding: 0.4rem 0.5rem;
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
  }
  .small-button:hover { background: ${BRAND.red}; color: #fff; }
  .delete-button {
    font-family: 'Ubuntu', Arial, sans-serif;
    font-size: 0.8rem;
    padding: 0.25rem 0.6rem;
    border-radius: 6px;
    border: 1px solid ${BRAND.darkRed};
    background: ${BRAND.darkRed};
    color: #fff;
    cursor: pointer;
  }
  .delete-button:hover { opacity: 0.85; }
  .checkbox-field { display: flex; flex-direction: row !important; align-items: center; gap: 0.4rem; }
  .checkbox-field label { white-space: nowrap; }
  .notice-success { background: #d9f2d9; color: #1e6b1e; border: 1px solid #a9d9a9; border-radius: 6px; padding: 0.6rem 1rem; }
  .notice-error { background: ${BRAND.redTint10}; color: ${BRAND.darkRed}; border: 1px solid ${BRAND.redTintBorder}; border-radius: 6px; padding: 0.6rem 1rem; }
  .row-errors { color: ${BRAND.darkRed}; }
  @media (prefers-color-scheme: dark) {
    th, td { border-bottom-color: #3a3836; }
    .status-inactive { background: #333230; color: #ccc; }
    .session-line { color: #aaa; }
    .card { border-color: #3a3836; }
    .inline-fields input { background: #232120; color: #ededed; border-color: #45423f; }
    .notice-error { background: ${BRAND.redTint10Dark}; color: #f5b9b4; border-color: ${BRAND.redTintBorderDark}; }
  }
`;

function importResultSummary(result: ImportCycleResult): string {
  const rowErrors = result.rowErrors.length
    ? `<p class="row-errors">Row errors:<br>${result.rowErrors
        .map((e) => `line ${e.line}: ${escapeHtml(e.message)}`)
        .join("<br>")}</p>`
    : "";
  const emailFailures = result.emailFailures.length
    ? `<p class="row-errors">Email send failures:<br>${result.emailFailures
        .map((f) => `${escapeHtml(f.email)}: ${escapeHtml(f.error)}`)
        .join("<br>")}</p>`
    : "";
  return `
<div class="notice-success">
  Imported ${result.employeesSeen} row(s): ${result.recordsCreated} created and emailed,
  ${result.recordsSkippedExisting} already had a record for this cycle, ${result.emailsSent} email(s) sent.
</div>
${rowErrors}
${emailFailures}
`;
}

export function renderEmployeesPage(props: EmployeesPageProps): string {
  const addNotice =
    props.addResult === "added"
      ? `<div class="notice-success">Employee added and emailed.</div>`
      : props.addResult === "exists"
        ? `<div class="notice-success">That employee already had a record for this cycle — nothing new was sent.</div>`
        : props.addResult === "added_email_failed"
          ? `<div class="notice-error">Employee added, but the email failed to send — check the server logs for details, or use "Get Link" on the status dashboard to grab a link to share manually.</div>`
          : "";

  const importNotice = props.importResult ? importResultSummary(props.importResult) : "";

  const deletedNotice = props.deleted ? `<div class="notice-success">Employee deleted.</div>` : "";

  const rows = props.employees
    .map((e) => {
      const toggleAction = e.active ? "deactivate" : "reactivate";
      const toggleLabel = e.active ? "Deactivate" : "Reactivate";
      const spouseToggleLabel = e.needsSpouseForm ? "Remove spouse form" : "Add spouse form";
      const confirmMessage = `Permanently delete ${e.fullName}? This cannot be undone.`;
      const confirmAttr = escapeHtml(JSON.stringify(confirmMessage));
      return `
    <tr>
      <td>${escapeHtml(e.fullName)}</td>
      <td>${escapeHtml(e.email)}</td>
      <td>${e.employeeIdExternal ? escapeHtml(e.employeeIdExternal) : "—"}</td>
      <td><span class="status-badge status-${e.active ? "active" : "inactive"}">${e.active ? "active" : "inactive"}</span></td>
      <td>${e.needsSpouseForm ? "Yes" : "No"}</td>
      <td>
        <form method="post" action="/dashboard/employees/${encodeURIComponent(e.id)}/${toggleAction}" style="display:inline">
          <button type="submit" class="small-button">${toggleLabel}</button>
        </form>
        <form method="post" action="/dashboard/employees/${encodeURIComponent(e.id)}/toggle-spouse-form" style="display:inline">
          <button type="submit" class="small-button">${spouseToggleLabel}</button>
        </form>
        <form method="post" action="/dashboard/employees/${encodeURIComponent(e.id)}/delete" style="display:inline" onsubmit="return confirm(${confirmAttr})">
          <button type="submit" class="delete-button">Delete</button>
        </form>
      </td>
    </tr>`;
    })
    .join("");

  const body = `
<h1>Manage Employees</h1>
<p class="session-line">Signed in as ${escapeHtml(props.hrUser.name)} (${escapeHtml(
    props.hrUser.email
  )}) &middot; <a href="/auth/logout">Sign out</a></p>
<p class="nav-line"><a href="/dashboard">← Back to status dashboard</a></p>

${addNotice}
${importNotice}
${deletedNotice}

<div class="card">
  <h2>Add an employee</h2>
  <form method="post" action="/dashboard/employees">
    <div class="inline-fields">
      <div><label for="fullName">Full name</label><input type="text" id="fullName" name="fullName" required /></div>
      <div><label for="email">Email</label><input type="email" id="email" name="email" required /></div>
      <div><label for="employeeIdExternal">Employee ID (optional)</label><input type="text" id="employeeIdExternal" name="employeeIdExternal" /></div>
      <div><label for="cycleYear">Cycle year</label><input type="number" id="cycleYear" name="cycleYear" value="${props.defaultCycleYear}" required /></div>
      <div class="checkbox-field"><input type="checkbox" id="needsSpouseForm" name="needsSpouseForm" value="1" /><label for="needsSpouseForm">Spouse also needs to complete a form</label></div>
      <div><button type="submit">Add</button></div>
    </div>
  </form>
</div>

<div class="card">
  <h2>Upload CSV</h2>
  <form method="post" action="/dashboard/employees/import" enctype="multipart/form-data">
    <div class="inline-fields">
      <div><label for="csv">CSV file</label><input type="file" id="csv" name="csv" accept=".csv" required /></div>
      <div><label for="importCycleYear">Cycle year</label><input type="number" id="importCycleYear" name="cycleYear" value="${props.defaultCycleYear}" required /></div>
      <div><button type="submit">Upload</button></div>
    </div>
  </form>
</div>

<table>
  <thead>
    <tr><th>Name</th><th>Email</th><th>External ID</th><th>Status</th><th>Spouse Form</th><th></th></tr>
  </thead>
  <tbody>${rows || `<tr><td colspan="6">No employees yet.</td></tr>`}</tbody>
</table>
`;

  return renderLayout("Manage Employees", body, { wide: true, extraStyles: EXTRA_STYLES });
}
