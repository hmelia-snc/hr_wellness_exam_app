import { renderLayout, BRAND } from "./layout.js";
import { escapeHtml } from "../lib/html.js";
import type { HrUser } from "../lib/auth.js";
import type { ImportCycleResult } from "../services/importCycle.js";

export interface EmployeeRow {
  id: string;
  fullName: string;
  // Nullable: a spouse row commonly has none — it's never emailed anything
  // independently.
  email: string | null;
  employeeIdExternal: string | null;
  active: boolean;
  recordType: "employee" | "spouse";
  // Set only for a recordType "spouse" row: the primary employee's name.
  linkedEmployeeName: string | null;
  // Set only for a recordType "employee" row that has a linked spouse row.
  spouseName: string | null;
}

export type AddResult = "added" | "exists" | "added_email_failed";

export interface EmployeesPageProps {
  hrUser: HrUser;
  defaultCycleYear: number;
  employees: EmployeeRow[];
  // Active employee-type rows, for the "associate with employee" selector
  // shown when adding a spouse.
  employeeOptions: { id: string; fullName: string }[];
  addResult?: AddResult;
  importResult?: ImportCycleResult;
  deleted?: boolean;
  bulkDeleted?: number;
}

const EXTRA_STYLES = `
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #ddd; }
  th { font-weight: 700; color: ${BRAND.darkRed}; }
  .status-badge { display: inline-block; padding: 0.15rem 0.6rem; border-radius: 999px; font-size: 0.8rem; font-weight: 500; }
  .status-active { background: #d9f2d9; color: #1e6b1e; }
  .status-inactive { background: #eaeaea; color: #555; }
  .status-employee { background: #eaeaea; color: #444; }
  .status-spouse { background: ${BRAND.redTint10}; color: ${BRAND.darkRed}; }
  .linked-note { font-size: 0.75rem; color: #666; margin-top: 0.15rem; }
  .nav-line { margin: 0.5rem 0 1rem; }
  .nav-line a { color: ${BRAND.red}; font-weight: 500; text-decoration: none; }
  .session-line { color: #666; font-size: 0.9rem; }
  .session-line a { color: ${BRAND.red}; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem 1.25rem; margin: 1rem 0; }
  .card h2 { margin-top: 0; }
  .inline-fields { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-end; }
  .inline-fields > div { display: flex; flex-direction: column; }
  /* The plain rule above beats the UA stylesheet's [hidden] { display: none }
     on specificity, so a hidden field (like #linked-employee-field) would
     otherwise stay visible — this restores it. */
  .inline-fields > div[hidden] { display: none; }
  .inline-fields input[type="text"],
  .inline-fields input[type="email"],
  .inline-fields input[type="number"] {
    font-family: 'Ubuntu', Arial, sans-serif;
    padding: 0.4rem 0.5rem;
    border-radius: 6px;
    border: 1px solid #ccc;
  }
  .combobox { position: relative; }
  .combobox input[type="text"] { width: 220px; box-sizing: border-box; }
  .combobox-list {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 20;
    margin: 2px 0 0;
    padding: 0.25rem 0;
    list-style: none;
    max-height: 220px;
    overflow-y: auto;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  }
  .combobox-list li { padding: 0.4rem 0.6rem; cursor: pointer; font-size: 0.95rem; }
  .combobox-list li.active,
  .combobox-list li:hover { background: ${BRAND.redTint10}; }
  .combobox-list li.combobox-empty { color: #888; cursor: default; }
  .combobox-list li.combobox-empty:hover { background: none; }
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
  .actions-cell { display: flex; flex-wrap: nowrap; gap: 0.4rem; white-space: nowrap; }
  .actions-cell form { display: inline; }
  .row-errors { color: ${BRAND.darkRed}; }
  .bulk-toolbar { display: flex; align-items: center; gap: 0.5rem; margin: 0.75rem 0; flex-wrap: wrap; }
  .bulk-toolbar .delete-button { padding: 0.4rem 0.8rem; font-size: 0.85rem; }
  .bulk-toolbar-label { font-size: 0.85rem; color: #666; }
  @media (prefers-color-scheme: dark) {
    th, td { border-bottom-color: #3a3836; }
    .status-inactive { background: #333230; color: #ccc; }
    .status-employee { background: #333230; color: #ccc; }
    .linked-note { color: #999; }
    .session-line { color: #aaa; }
    .card { border-color: #3a3836; }
    .inline-fields input { background: #232120; color: #ededed; border-color: #45423f; }
    .combobox-list { background: #232120; border-color: #45423f; }
    .combobox-list li.active,
    .combobox-list li:hover { background: #3a3836; }
    .combobox-list li.combobox-empty { color: #999; }
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
  const spouseLinkErrors = result.spouseLinkErrors.length
    ? `<p class="row-errors">Spouse rows not linked:<br>${result.spouseLinkErrors
        .map((e) => escapeHtml(e.message))
        .join("<br>")}</p>`
    : "";
  return `
<div class="notice-success">
  Imported ${result.employeesSeen} row(s): ${result.recordsCreated} created and emailed,
  ${result.recordsSkippedExisting} already had a record for this cycle, ${result.emailsSent} email(s) sent,
  ${result.spousesLinked} spouse(s) linked.
</div>
${rowErrors}
${emailFailures}
${spouseLinkErrors}
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
  const bulkDeletedNotice =
    props.bulkDeleted !== undefined ? `<div class="notice-success">Deleted ${props.bulkDeleted} employee(s).</div>` : "";

  const rows = props.employees
    .map((e) => {
      const toggleAction = e.active ? "deactivate" : "reactivate";
      const toggleLabel = e.active ? "Deactivate" : "Reactivate";
      const confirmMessage = `Permanently delete ${e.fullName}? This cannot be undone.`;
      const confirmAttr = escapeHtml(JSON.stringify(confirmMessage));
      const nameCell =
        e.recordType === "spouse"
          ? `${escapeHtml(e.fullName)}<div class="linked-note">↳ Spouse of ${escapeHtml(e.linkedEmployeeName ?? "—")}</div>`
          : escapeHtml(e.fullName);
      const linkedSpouseCell = e.spouseName ? escapeHtml(e.spouseName) : "—";
      return `
    <tr>
      <td><input type="checkbox" name="ids" value="${escapeHtml(e.id)}" aria-label="Select ${escapeHtml(e.fullName)}" /></td>
      <td>${nameCell}</td>
      <td>${e.email ? escapeHtml(e.email) : "—"}</td>
      <td>${e.employeeIdExternal ? escapeHtml(e.employeeIdExternal) : "—"}</td>
      <td><span class="status-badge status-${e.recordType}">${e.recordType === "spouse" ? "Spouse" : "Employee"}</span></td>
      <td><span class="status-badge status-${e.active ? "active" : "inactive"}">${e.active ? "active" : "inactive"}</span></td>
      <td>${linkedSpouseCell}</td>
      <td class="actions-cell">
        <button type="submit" formaction="/dashboard/employees/${encodeURIComponent(e.id)}/${toggleAction}" formmethod="post" class="small-button">${toggleLabel}</button>
        <button type="submit" formaction="/dashboard/employees/${encodeURIComponent(e.id)}/delete" formmethod="post" class="delete-button" onclick="return confirm(${confirmAttr})">Delete</button>
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
${bulkDeletedNotice}

<div class="card">
  <h2>Add a record</h2>
  <form method="post" action="/dashboard/employees" id="add-record-form">
    <div class="inline-fields">
      <div>
        <label for="recordTypeSearch">Record type</label>
        <div class="combobox">
          <input type="text" id="recordTypeSearch" autocomplete="off" placeholder="Employee or Spouse…" role="combobox" aria-expanded="false" aria-controls="recordTypeList" />
          <input type="hidden" id="recordType" name="recordType" value="" />
          <ul class="combobox-list" id="recordTypeList" role="listbox" hidden></ul>
        </div>
      </div>
      <div><label for="fullName">Full name</label><input type="text" id="fullName" name="fullName" required /></div>
      <div id="email-field"><label for="email">Email</label><input type="email" id="email" name="email" required /></div>
      <div id="linked-employee-field" hidden>
        <label for="linkedEmployeeSearch">Associate with employee</label>
        <div class="combobox">
          <input type="text" id="linkedEmployeeSearch" autocomplete="off" placeholder="Search employees…" role="combobox" aria-expanded="false" aria-controls="linkedEmployeeList" />
          <input type="hidden" id="linkedEmployeeId" name="linkedEmployeeId" />
          <ul class="combobox-list" id="linkedEmployeeList" role="listbox" hidden></ul>
        </div>
      </div>
      <div><label for="employeeIdExternal">Employee ID (optional)</label><input type="text" id="employeeIdExternal" name="employeeIdExternal" /></div>
      <div><label for="cycleYear">Cycle year</label><input type="number" id="cycleYear" name="cycleYear" value="${props.defaultCycleYear}" required /></div>
      <div><button type="submit">Add</button></div>
    </div>
  </form>
</div>

<div class="card">
  <h2>Upload CSV</h2>
  <p class="nav-line"><a href="/dashboard/employees/csv-template">Download CSV template →</a></p>
  <form method="post" action="/dashboard/employees/import" enctype="multipart/form-data">
    <div class="inline-fields">
      <div><label for="csv">CSV file</label><input type="file" id="csv" name="csv" accept=".csv" required /></div>
      <div><label for="importCycleYear">Cycle year</label><input type="number" id="importCycleYear" name="cycleYear" value="${props.defaultCycleYear}" required /></div>
      <div><button type="submit">Upload</button></div>
    </div>
  </form>
</div>

<form id="bulk-form" method="post">
  <div class="bulk-toolbar">
    <span class="bulk-toolbar-label">With selected:</span>
    <button type="submit" formaction="/dashboard/employees/bulk-delete" class="delete-button" onclick="return confirmBulkDelete()">Delete Selected</button>
  </div>
  <div style="overflow-x: auto;">
  <table>
    <thead>
      <tr>
        <th><input type="checkbox" id="select-all" onclick="toggleAllRows(this)" aria-label="Select all" /></th>
        <th>Name</th><th>Email</th><th>External ID</th><th>Type</th><th>Status</th><th>Linked Spouse</th><th></th>
      </tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="8">No records yet.</td></tr>`}</tbody>
  </table>
  </div>
</form>

<script>
  // Minimal type-ahead combobox: a visible text input filters a dropdown of
  // {value,label} options; the actual form value lives in a paired hidden
  // input so the field still submits a plain id/enum value, not the
  // display label. No native <select> here since neither field needs one —
  // this is deliberately dependency-free (no CDN combobox library) to match
  // the rest of this app's plain-JS approach.
  function initCombobox(config) {
    var input = document.getElementById(config.inputId);
    var hidden = document.getElementById(config.hiddenId);
    var list = document.getElementById(config.listId);
    var options = config.options;
    var filtered = options.slice();
    var highlighted = -1;

    function labelFor(value) {
      for (var i = 0; i < options.length; i++) {
        if (options[i].value === value) return options[i].label;
      }
      return '';
    }

    function render() {
      list.innerHTML = '';
      if (filtered.length === 0) {
        var empty = document.createElement('li');
        empty.className = 'combobox-empty';
        empty.textContent = 'No matches';
        list.appendChild(empty);
        return;
      }
      filtered.forEach(function (opt, i) {
        var li = document.createElement('li');
        li.textContent = opt.label;
        li.setAttribute('role', 'option');
        if (i === highlighted) li.className = 'active';
        li.addEventListener('mousedown', function (e) {
          // mousedown (not click) fires before the input's blur handler,
          // so the selection wins instead of blur snapping the text back.
          e.preventDefault();
          select(opt);
        });
        list.appendChild(li);
      });
    }

    function open() {
      input.setAttribute('aria-expanded', 'true');
      list.hidden = false;
      render();
    }

    function close() {
      input.setAttribute('aria-expanded', 'false');
      list.hidden = true;
      highlighted = -1;
    }

    function select(opt) {
      input.value = opt.label;
      hidden.value = opt.value;
      close();
      if (config.onChange) config.onChange(opt.value);
    }

    function filterOptions() {
      var q = input.value.trim().toLowerCase();
      filtered = q ? options.filter(function (o) { return o.label.toLowerCase().indexOf(q) !== -1; }) : options.slice();
      highlighted = -1;
    }

    input.addEventListener('input', function () {
      filterOptions();
      open();
      // Typing invalidates whatever was previously selected until they pick
      // a match again — prevents submitting a stale hidden value that no
      // longer matches the visible text.
      hidden.value = '';
    });
    input.addEventListener('focus', function () {
      filterOptions();
      open();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (list.hidden) { filterOptions(); open(); }
        highlighted = Math.min(highlighted + 1, filtered.length - 1);
        render();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlighted = Math.max(highlighted - 1, 0);
        render();
      } else if (e.key === 'Enter') {
        if (!list.hidden && highlighted >= 0 && filtered[highlighted]) {
          e.preventDefault();
          select(filtered[highlighted]);
        }
      } else if (e.key === 'Escape') {
        close();
      }
    });
    input.addEventListener('blur', function () {
      // Delay so a mousedown-driven select() above (or an outside click)
      // resolves first.
      setTimeout(function () {
        input.value = hidden.value ? labelFor(hidden.value) : '';
        close();
      }, 150);
    });
    document.addEventListener('click', function (e) {
      if (e.target !== input && !list.contains(e.target)) close();
    });

    return {
      setValue: function (value) {
        hidden.value = value;
        input.value = labelFor(value);
      },
    };
  }

  var linkedEmployeeCombo = initCombobox({
    inputId: 'linkedEmployeeSearch',
    hiddenId: 'linkedEmployeeId',
    listId: 'linkedEmployeeList',
    options: ${JSON.stringify(props.employeeOptions.map((o) => ({ value: o.id, label: o.fullName }))).replace(/</g, "\\u003c")},
  });

  initCombobox({
    inputId: 'recordTypeSearch',
    hiddenId: 'recordType',
    listId: 'recordTypeList',
    options: [
      { value: 'employee', label: 'Employee' },
      { value: 'spouse', label: 'Spouse' },
    ],
    onChange: toggleRecordTypeFields,
  });
  // Left blank rather than defaulting to "Employee" — a blank Record type
  // still submits and is treated as "employee" server-side (same as an
  // absent record_type column in a CSV import), but starting blank forces
  // a deliberate choice instead of an easy-to-miss pre-selection.
  toggleRecordTypeFields();

  function toggleRecordTypeFields() {
    var isSpouse = document.getElementById('recordType').value === 'spouse';
    document.getElementById('email').required = !isSpouse;
    document.getElementById('linked-employee-field').hidden = !isSpouse;
    if (!isSpouse) {
      linkedEmployeeCombo.setValue('');
    }
  }

  document.getElementById('add-record-form').addEventListener('submit', function (e) {
    var isSpouse = document.getElementById('recordType').value === 'spouse';
    if (isSpouse && !document.getElementById('linkedEmployeeId').value) {
      e.preventDefault();
      alert('Select which employee this spouse belongs to.');
      document.getElementById('linkedEmployeeSearch').focus();
    }
  });

  function toggleAllRows(source) {
    var boxes = document.querySelectorAll('#bulk-form input[name="ids"]');
    for (var i = 0; i < boxes.length; i++) boxes[i].checked = source.checked;
  }
  function confirmBulkDelete() {
    var ids = Array.prototype.slice.call(document.querySelectorAll('#bulk-form input[name="ids"]:checked'));
    if (ids.length === 0) {
      alert('Select at least one employee first.');
      return false;
    }
    return confirm('Permanently delete ' + ids.length + ' employee(s)? This cannot be undone.');
  }
</script>
`;

  return renderLayout("Manage Employees", body, { wide: true, extraStyles: EXTRA_STYLES });
}
