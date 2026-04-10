const socketStatus = document.getElementById("socket-status");
const toast = document.getElementById("toast");
const sidebarNav = document.getElementById("sidebarNav");

const todayLabel = document.getElementById("todayLabel");
const summaryCards = document.getElementById("summaryCards");
const dashboardRows = document.getElementById("dashboardRows");
const refreshButton = document.getElementById("refreshButton");
const dailyRefreshButton = document.getElementById("dailyRefreshButton");
const autoManageButton = document.getElementById("autoManageButton");

const attendanceBody = document.getElementById("attendanceBody");
const attendanceEditModal = document.getElementById("attendanceEditModal");
const attendanceEditMeta = document.getElementById("attendanceEditMeta");
const attendanceEditForm = document.getElementById("attendanceEditForm");
const editCheckInInput = document.getElementById("editCheckInInput");
const editCheckOutInput = document.getElementById("editCheckOutInput");
const clearCheckOutInput = document.getElementById("clearCheckOutInput");
const closeAttendanceEditModalButton = document.getElementById("closeAttendanceEditModal");
const cancelAttendanceEditButton = document.getElementById("cancelAttendanceEditButton");

const employeeForm = document.getElementById("employeeForm");
const employeeModal = document.getElementById("employeeModal");
const employeeModalTitle = document.getElementById("employeeModalTitle");
const closeEmployeeModalButton = document.getElementById("closeEmployeeModal");
const openAddEmployeeButton = document.getElementById("openAddEmployeeButton");
const employeeMode = document.getElementById("employeeMode");
const employeeOriginalId = document.getElementById("employeeOriginalId");
const employeeIdInput = document.getElementById("employeeIdInput");
const employeeNameInput = document.getElementById("employeeNameInput");
const employeeDepartmentInput = document.getElementById("employeeDepartmentInput");
const employeePinInput = document.getElementById("employeePinInput");
const employeeActiveInput = document.getElementById("employeeActiveInput");
const resetEmployeeButton = document.getElementById("resetEmployeeButton");
const reloadEmployeesButton = document.getElementById("reloadEmployeesButton");
const employeeSearchInput = document.getElementById("employeeSearchInput");
const employeesBody = document.getElementById("employeesBody");
const employeeMetaCards = document.getElementById("employeeMetaCards");

const settingsForm = document.getElementById("settingsForm");
const shiftStartInput = document.getElementById("shiftStartInput");
const shiftEndInput = document.getElementById("shiftEndInput");
const graceMinutesInput = document.getElementById("graceMinutesInput");
const autoPunchOutToggle = document.getElementById("autoPunchOutToggle");
const autoPunchOutTimeInput = document.getElementById("autoPunchOutTimeInput");
const halfDayAfterInput = document.getElementById("halfDayAfterInput");
const minimumWorkMinutesInput = document.getElementById("minimumWorkMinutesInput");
const workingDaysWrap = document.getElementById("workingDaysWrap");

const reportMonthInput = document.getElementById("reportMonthInput");
const currentMonthButton = document.getElementById("currentMonthButton");
const previousMonthButton = document.getElementById("previousMonthButton");
const runReportButton = document.getElementById("runReportButton");
const exportReportButton = document.getElementById("exportReportButton");
const reportSummaryCards = document.getElementById("reportSummaryCards");
const reportHead = document.getElementById("reportHead");
const reportBody = document.getElementById("reportBody");

const adminProfileCard = document.getElementById("adminProfileCard");

const weekDayLabel = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const todayDate = new Date().toISOString().slice(0, 10);

let cachedEmployees = [];
let cachedAttendanceRows = [];
let editingAttendanceRow = null;
let toastTimeout = null;
let nextEmployeeId = "0000001";
let activeView = "dashboardView";
let cachedReportRows = [];
let cachedSettings = null;
let reportRange = { from: todayDate, to: todayDate };

if (todayLabel) {
  todayLabel.textContent = new Date().toLocaleDateString([], {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

if (reportMonthInput) {
  reportMonthInput.value = todayDate.slice(0, 7);
}

function showToast(message, type = "success") {
  if (!toast) return;
  if (toastTimeout) clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  toastTimeout = setTimeout(() => {
    toast.className = "toast";
  }, 2400);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatTimeOnly(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDurationFromMinutes(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  const totalMinutes = Math.max(0, Math.floor(Number(value)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function formatLocation(location) {
  if (!location) return "-";
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "-";
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function formatPunchCell(iso, location) {
  const timeLabel = iso ? formatTimeOnly(iso) : "-";
  const locationLabel = formatLocation(location);
  return `<div class="punch-stack"><span>${escapeHtml(timeLabel)}</span><span class="employee-id">${escapeHtml(locationLabel)}</span></div>`;
}

function performanceText(value) {
  const map = {
    ABSENT: "Absent",
    ON_TIME: "On Time",
    LATE_IN: "Late In",
    EARLY_OUT: "Early Out",
    LATE_AND_EARLY: "Late + Early",
    IN_PROGRESS: "In Progress",
    AUTO_CLOSED: "Auto Closed",
    HALF_DAY: "Half Day"
  };
  return map[value] ?? value;
}

function performanceClass(value) {
  return `performance-${String(value).toLowerCase().replaceAll("_", "-")}`;
}

function statusBadge(status) {
  if (status === "IN_OFFICE") return '<span class="badge in">Punched In</span>';
  if (status === "CHECKED_OUT") return '<span class="badge out">Punched Out</span>';
  return '<span class="badge absent">Absent</span>';
}

function autoBadge(autoManaged) {
  if (autoManaged) return '<span class="badge auto-yes">Yes</span>';
  return '<span class="badge auto-no">No</span>';
}

function getEmployeeInitials(name, id) {
  const words = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  if (words.length === 1 && words[0].length >= 2) return words[0].slice(0, 2).toUpperCase();
  return String(id ?? "EM").slice(0, 2).toUpperCase();
}

function toTimeInputValue(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function toIsoFromSelectedDate(timeValue) {
  const candidate = new Date(`${todayDate}T${timeValue}:00`);
  if (Number.isNaN(candidate.getTime())) throw new Error("Invalid time selected");
  return candidate.toISOString();
}

function buildDateRange(from, to) {
  const dates = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cursor.getUTCDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${d}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function monthRange(monthValue) {
  if (!/^\d{4}-\d{2}$/.test(monthValue)) {
    throw new Error("Month must be in YYYY-MM format");
  }

  const [year, month] = monthValue.split("-").map(Number);
  const from = `${monthValue}-01`;
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${monthValue}-${String(endDay).padStart(2, "0")}`;
  return { from, to };
}

function setActiveView(viewId) {
  activeView = viewId;

  for (const panel of document.querySelectorAll(".view-panel")) {
    panel.classList.toggle("active", panel.id === viewId);
  }

  for (const button of document.querySelectorAll(".nav-btn")) {
    button.classList.toggle("active", button.dataset.view === viewId);
  }
}

function renderSummary(summary) {
  if (!summaryCards) return;
  const present = summary.checkedIn + summary.checkedOut;
  const attendanceRate = summary.totalEmployees > 0 ? Math.round((present / summary.totalEmployees) * 100) : 0;

  const cards = [
    { label: "Active Team", value: summary.totalEmployees, note: "Employees enabled", tone: "neutral" },
    { label: "In Office", value: summary.checkedIn, note: "Currently punched in", tone: "primary" },
    { label: "Punched Out", value: summary.checkedOut, note: "Shift closed", tone: "secondary" },
    { label: "Absent", value: summary.absent, note: "No check-in", tone: "danger" },
    { label: "Attendance", value: `${attendanceRate}%`, note: "Today present ratio", tone: attendanceRate >= 85 ? "primary" : "warn" }
  ];

  summaryCards.innerHTML = cards
    .map(
      (card) => `<article class="summary-card tone-${card.tone}">
        <p class="summary-label">${escapeHtml(card.label)}</p>
        <p class="summary-value">${escapeHtml(card.value)}</p>
        <p class="summary-note">${escapeHtml(card.note)}</p>
      </article>`
    )
    .join("");
}

function renderDashboardRows(rows) {
  if (!dashboardRows) return;
  if (!rows.length) {
    dashboardRows.innerHTML = '<tr><td colspan="6" class="empty-row">No records for today.</td></tr>';
    return;
  }

  dashboardRows.innerHTML = rows
    .map((row) => {
      const initials = getEmployeeInitials(row.employeeName, row.employeeId);
      return `<tr>
        <td>
          <div class="employee-cell">
            <span class="employee-avatar">${escapeHtml(initials)}</span>
            <span class="employee-meta">
              <span class="employee-name">${escapeHtml(row.employeeName)}</span>
              <span class="employee-id">${escapeHtml(row.employeeId)}</span>
            </span>
          </div>
        </td>
        <td>${escapeHtml(row.department)}</td>
        <td>${statusBadge(row.status)}</td>
        <td>${formatTimeOnly(row.checkInAt)}</td>
        <td>${formatTimeOnly(row.checkOutAt)}</td>
        <td>${formatDurationFromMinutes(row.workedMinutes)}</td>
      </tr>`;
    })
    .join("");
}

function renderAttendanceRows(rows) {
  if (!rows.length) {
    attendanceBody.innerHTML = '<tr><td colspan="9" class="empty-row">No attendance data for today.</td></tr>';
    return;
  }

  attendanceBody.innerHTML = rows
    .map((row) => {
      const initials = getEmployeeInitials(row.employeeName, row.employeeId);
      return `<tr>
        <td>
          <div class="employee-cell">
            <span class="employee-avatar">${escapeHtml(initials)}</span>
            <span class="employee-meta">
              <span class="employee-name">${escapeHtml(row.employeeName)}</span>
              <span class="employee-id">${escapeHtml(row.employeeId)}</span>
            </span>
          </div>
        </td>
        <td>${escapeHtml(row.department)}</td>
        <td>${formatPunchCell(row.checkInAt, row.checkInLocation)}</td>
        <td>${formatPunchCell(row.checkOutAt, row.checkOutLocation)}</td>
        <td>
          <div class="punch-stack">
            <span>Worked: ${escapeHtml(formatDurationFromMinutes(row.workedMinutes))}</span>
            <span class="employee-id">Late: ${escapeHtml(formatDurationFromMinutes(row.lateByMinutes))}</span>
            <span class="employee-id">Early: ${escapeHtml(formatDurationFromMinutes(row.earlyOutByMinutes))}</span>
          </div>
        </td>
        <td>${autoBadge(row.autoManaged)}</td>
        <td>${statusBadge(row.status)}</td>
        <td><span class="performance ${performanceClass(row.performance)}">${performanceText(row.performance)}</span></td>
        <td>
          <div class="attendance-manage">
            <button type="button" class="ghost attendance-edit" data-id="${escapeHtml(row.employeeId)}">Edit Time</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

function renderReportSummary(summary) {
  const cards = [
    { label: "Records", value: summary.records, note: "Attendance entries", tone: "neutral" },
    { label: "Employees", value: summary.employees, note: "Unique employees", tone: "secondary" },
    { label: "Worked", value: formatDurationFromMinutes(summary.totalWorkedMinutes), note: "Total month hours", tone: "primary" },
    { label: "Late Days", value: summary.lateDays, note: "Late check in", tone: "warn" },
    { label: "Early Out", value: summary.earlyDays, note: "Early check out", tone: "danger" }
  ];

  reportSummaryCards.innerHTML = cards
    .map(
      (card) => `<article class="summary-card tone-${card.tone}">
        <p class="summary-label">${escapeHtml(card.label)}</p>
        <p class="summary-value">${escapeHtml(card.value)}</p>
        <p class="summary-note">${escapeHtml(card.note)}</p>
      </article>`
    )
    .join("");
}

function renderReportRows(rows) {
  const dates = buildDateRange(reportRange.from, reportRange.to);
  const monthLabel = (date) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString([], { day: "2-digit", month: "short" });

  reportHead.innerHTML = `
    <tr>
      <th rowspan="2">Name</th>
      <th rowspan="2">Department</th>
      ${dates.map((date) => `<th colspan="3">${escapeHtml(monthLabel(date))}</th>`).join("")}
      <th colspan="4">Totals</th>
    </tr>
    <tr>
      ${dates.map(() => "<th>In</th><th>Out</th><th>Hrs</th>").join("")}
      <th>Total Hrs</th>
      <th>Days In</th>
      <th>Half Day</th>
      <th>Absent</th>
    </tr>
  `;

  const rowMap = new Map();
  for (const row of rows) {
    const key = `${row.employeeId}__${row.date}`;
    rowMap.set(key, row);
  }

  const employeesFromRows = new Map(rows.map((row) => [row.employeeId, { id: row.employeeId, name: row.employeeName, department: row.department }]));
  const employees = cachedEmployees.length
    ? cachedEmployees.map((item) => ({ id: item.id, name: item.name, department: item.department }))
    : Array.from(employeesFromRows.values());

  if (!employees.length) {
    reportBody.innerHTML = '<tr><td colspan="999" class="empty-row">No users found for report.</td></tr>';
    return;
  }

  const workingDays = new Set(cachedSettings?.workingDays ?? [1, 2, 3, 4, 5, 6]);

  reportBody.innerHTML = employees
    .map((employee) => {
      let totalWorked = 0;
      let daysIn = 0;
      let halfDay = 0;
      let absent = 0;

      const dailyCells = dates
        .map((date) => {
          const row = rowMap.get(`${employee.id}__${date}`);
          const weekDay = new Date(`${date}T00:00:00Z`).getUTCDay();
          const isWorking = workingDays.has(weekDay);

          const inVal = row?.checkInAt ? formatTimeOnly(row.checkInAt) : "-";
          const outVal = row?.checkOutAt ? formatTimeOnly(row.checkOutAt) : "-";
          const hrsVal = row ? formatDurationFromMinutes(row.workedMinutes) : "-";

          if (row?.checkInAt) {
            daysIn += 1;
            totalWorked += Number(row.workedMinutes ?? 0);
            if (row.performance === "HALF_DAY") {
              halfDay += 1;
            }
          } else if (isWorking) {
            absent += 1;
          }

          return `<td>${escapeHtml(inVal)}</td><td>${escapeHtml(outVal)}</td><td>${escapeHtml(hrsVal)}</td>`;
        })
        .join("");

      return `<tr>
        <td>
          <div class="employee-meta">
            <span class="employee-name">${escapeHtml(employee.name)}</span>
            <span class="employee-id">${escapeHtml(employee.id)}</span>
          </div>
        </td>
        <td>${escapeHtml(employee.department)}</td>
        ${dailyCells}
        <td>${escapeHtml(formatDurationFromMinutes(totalWorked))}</td>
        <td>${escapeHtml(daysIn)}</td>
        <td>${escapeHtml(halfDay)}</td>
        <td>${escapeHtml(absent)}</td>
      </tr>`;
    })
    .join("");
}

function renderEmployeeMeta(employees) {
  const activeCount = employees.filter((employee) => employee.active).length;
  const inactiveCount = employees.length - activeCount;
  const departments = new Set(employees.map((employee) => employee.department)).size;

  const cards = [
    { label: "Total Employees", value: employees.length, note: "All profiles", tone: "neutral" },
    { label: "Active", value: activeCount, note: "Can login", tone: "primary" },
    { label: "Disabled", value: inactiveCount, note: "Access blocked", tone: inactiveCount > 0 ? "warn" : "secondary" },
    { label: "Departments", value: departments, note: "Configured teams", tone: "secondary" }
  ];

  employeeMetaCards.innerHTML = cards
    .map(
      (card) => `<article class="summary-card tone-${card.tone}">
        <p class="summary-label">${escapeHtml(card.label)}</p>
        <p class="summary-value">${escapeHtml(card.value)}</p>
        <p class="summary-note">${escapeHtml(card.note)}</p>
      </article>`
    )
    .join("");
}

function renderEmployeesTable(employees) {
  if (!employees.length) {
    employeesBody.innerHTML = '<tr><td colspan="6" class="empty-row">No employees match your search.</td></tr>';
    return;
  }

  employeesBody.innerHTML = employees
    .map(
      (employee) => `<tr>
        <td>${escapeHtml(employee.id)}</td>
        <td>${escapeHtml(employee.name)}</td>
        <td>${escapeHtml(employee.department)}</td>
        <td>${employee.active ? '<span class="badge in">Active</span>' : '<span class="badge absent">Disabled</span>'}</td>
        <td>${new Date(employee.createdAt).toLocaleDateString()}</td>
        <td>
          <div class="manage-buttons">
            <button type="button" class="ghost employee-edit" data-id="${escapeHtml(employee.id)}">Edit</button>
            <button type="button" class="ghost employee-toggle" data-id="${escapeHtml(employee.id)}">${employee.active ? "Disable" : "Enable"}</button>
            <button type="button" class="ghost employee-delete" data-id="${escapeHtml(employee.id)}">Delete</button>
          </div>
        </td>
      </tr>`
    )
    .join("");
}

function renderAdminProfile() {
  const activeEmployees = cachedEmployees.filter((item) => item.active).length;
  const totalWorkedMinutes = cachedReportRows.reduce((acc, row) => acc + Number(row.workedMinutes ?? 0), 0);
  adminProfileCard.innerHTML = `
    <div>
      <h2>Admin Profile</h2>
      <p class="muted">Control center for attendance operations and policy governance.</p>
    </div>
    <div class="profile-grid">
      <article class="profile-item">
        <p class="summary-label">System Role</p>
        <p class="summary-value">HR Admin</p>
        <p class="summary-note">Full access to users, reports, and corrections</p>
      </article>
      <article class="profile-item">
        <p class="summary-label">Active Users</p>
        <p class="summary-value">${escapeHtml(activeEmployees)}</p>
        <p class="summary-note">Employees currently allowed to login</p>
      </article>
      <article class="profile-item">
        <p class="summary-label">Current Report Range</p>
        <p class="summary-value">${escapeHtml(reportRange.from)} to ${escapeHtml(reportRange.to)}</p>
        <p class="summary-note">Used for latest monthly report</p>
      </article>
      <article class="profile-item">
        <p class="summary-label">Worked Hours (Range)</p>
        <p class="summary-value">${escapeHtml(formatDurationFromMinutes(totalWorkedMinutes))}</p>
        <p class="summary-note">Total from loaded report data</p>
      </article>
    </div>
  `;
}

function populateSettingsForm(settings) {
  shiftStartInput.value = settings.shiftStart;
  shiftEndInput.value = settings.shiftEnd;
  halfDayAfterInput.value = settings.halfDayAfter ?? "10:15";
  minimumWorkMinutesInput.value = String(settings.minimumWorkMinutes ?? 540);
  graceMinutesInput.value = String(settings.graceMinutes);
  autoPunchOutToggle.value = String(settings.autoPunchOut);
  autoPunchOutTimeInput.value = settings.autoPunchOutTime;

  const selectedDays = new Set(settings.workingDays);
  for (const checkbox of workingDaysWrap.querySelectorAll('input[type="checkbox"]')) {
    checkbox.checked = selectedDays.has(Number(checkbox.value));
  }
}

function setEmployeePinMode(mode) {
  if (mode === "create") {
    employeePinInput.required = true;
    employeePinInput.placeholder = "4-digit PIN";
  } else {
    employeePinInput.required = false;
    employeePinInput.placeholder = "Leave blank to keep current PIN";
  }
}

function setNextEmployeeId(value) {
  const candidate = String(value ?? "").trim();
  nextEmployeeId = candidate || "0000001";
}

function resetEmployeeForm() {
  employeeMode.value = "create";
  employeeModalTitle.textContent = "Add Employee";
  employeeOriginalId.value = "";
  employeeIdInput.value = nextEmployeeId;
  employeeNameInput.value = "";
  employeeDepartmentInput.value = "";
  employeePinInput.value = "";
  employeeActiveInput.value = "true";
  employeeIdInput.disabled = false;
  setEmployeePinMode("create");
}

function fillEmployeeForm(employee) {
  employeeMode.value = "edit";
  employeeModalTitle.textContent = `Edit ${employee.id}`;
  employeeOriginalId.value = employee.id;
  employeeIdInput.value = employee.id;
  employeeNameInput.value = employee.name;
  employeeDepartmentInput.value = employee.department;
  employeePinInput.value = "";
  employeeActiveInput.value = String(employee.active);
  employeeIdInput.disabled = false;
  setEmployeePinMode("edit");
}

function openEmployeeModal() {
  employeeModal.classList.add("show");
  employeeModal.setAttribute("aria-hidden", "false");
}

function closeEmployeeModal() {
  employeeModal.classList.remove("show");
  employeeModal.setAttribute("aria-hidden", "true");
}

function openAttendanceEditModal(row) {
  editingAttendanceRow = row;
  attendanceEditMeta.textContent = `${row.employeeId} • ${row.employeeName} • ${todayDate}`;
  editCheckInInput.value = toTimeInputValue(row.checkInAt);
  editCheckOutInput.value = toTimeInputValue(row.checkOutAt);
  editCheckOutInput.disabled = false;
  clearCheckOutInput.checked = false;

  attendanceEditModal.classList.add("show");
  attendanceEditModal.setAttribute("aria-hidden", "false");
}

function closeAttendanceEditModal() {
  editingAttendanceRow = null;
  attendanceEditForm.reset();
  editCheckOutInput.disabled = false;
  attendanceEditModal.classList.remove("show");
  attendanceEditModal.setAttribute("aria-hidden", "true");
}

function applyEmployeeFilter() {
  const query = String(employeeSearchInput?.value ?? "")
    .trim()
    .toLowerCase();

  if (!query) {
    renderEmployeesTable(cachedEmployees);
    return;
  }

  const filtered = cachedEmployees.filter((employee) => {
    const haystack = `${employee.id} ${employee.name} ${employee.department}`.toLowerCase();
    return haystack.includes(query);
  });

  renderEmployeesTable(filtered);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || "Request failed");
  }

  return payload;
}

async function loadAttendance() {
  const payload = await requestJson(`/api/attendance/today?date=${todayDate}`);
  cachedAttendanceRows = payload.rows;
  renderSummary(payload.summary);
  renderDashboardRows(payload.rows);
  renderAttendanceRows(payload.rows);
  if (payload.settings) {
    cachedSettings = payload.settings;
    populateSettingsForm(payload.settings);
  }
}

async function loadEmployees() {
  const payload = await requestJson("/api/admin/employees");
  cachedEmployees = payload.employees;
  setNextEmployeeId(payload.nextEmployeeId);
  renderEmployeeMeta(cachedEmployees);
  applyEmployeeFilter();
  if (employeeMode.value === "create") {
    employeeIdInput.value = nextEmployeeId;
  }
  renderAdminProfile();
}

async function loadSettings() {
  const payload = await requestJson("/api/admin/workday-settings");
  populateSettingsForm(payload.settings);
}

async function loadReportByMonth(monthValue) {
  const range = monthRange(monthValue);
  reportRange = range;

  const payload = await requestJson(`/api/admin/attendance/report?from=${range.from}&to=${range.to}`);
  cachedReportRows = payload.rows;
  renderReportSummary(payload.summary);
  renderReportRows(payload.rows);
  renderAdminProfile();
}

async function runCurrentMonthReport() {
  const month = new Date().toISOString().slice(0, 7);
  reportMonthInput.value = month;
  await loadReportByMonth(month);
}

async function runPreviousMonthReport() {
  const base = new Date(`${new Date().toISOString().slice(0, 7)}-01T00:00:00Z`);
  base.setUTCMonth(base.getUTCMonth() - 1);
  const month = `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}`;
  reportMonthInput.value = month;
  await loadReportByMonth(month);
}

async function saveAttendanceCorrection(event) {
  event.preventDefault();

  if (!editingAttendanceRow) {
    showToast("Select a row to edit.", "error");
    return;
  }

  const checkInTime = editCheckInInput.value;
  if (!checkInTime) {
    showToast("Check in time is required.", "error");
    return;
  }

  const checkInAt = toIsoFromSelectedDate(checkInTime);
  let checkOutAt = null;

  if (!clearCheckOutInput.checked && editCheckOutInput.value) {
    checkOutAt = toIsoFromSelectedDate(editCheckOutInput.value);
  }

  if (checkOutAt && new Date(checkOutAt).getTime() <= new Date(checkInAt).getTime()) {
    showToast("Check out must be after check in.", "error");
    return;
  }

  await requestJson(`/api/admin/attendance/${encodeURIComponent(editingAttendanceRow.employeeId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      date: todayDate,
      checkInAt,
      checkOutAt
    })
  });

  await loadAttendance();
  closeAttendanceEditModal();
  showToast("Attendance time corrected", "success");
}

async function saveEmployee(event) {
  event.preventDefault();

  const mode = employeeMode.value;
  const employeeId = employeeIdInput.value.trim();
  const originalEmployeeId = employeeOriginalId.value.trim();
  const name = employeeNameInput.value.trim();
  const department = employeeDepartmentInput.value.trim();
  const pin = employeePinInput.value.trim();
  const active = employeeActiveInput.value === "true";

  if (!employeeId || !name || !department) {
    showToast("Please fill employee ID, name, and department.", "error");
    return;
  }

  if (mode === "create" && !pin) {
    showToast("PIN is required when creating employee.", "error");
    return;
  }

  if (mode === "create") {
    await requestJson("/api/admin/employees", {
      method: "POST",
      body: JSON.stringify({ id: employeeId, name, department, pin, active })
    });
    showToast("Employee created", "success");
  } else {
    const updateBody = { id: employeeId, name, department, active };
    if (pin) updateBody.pin = pin;

    await requestJson(`/api/admin/employees/${encodeURIComponent(originalEmployeeId || employeeId)}`, {
      method: "PATCH",
      body: JSON.stringify(updateBody)
    });
    showToast("Employee updated", "success");
  }

  resetEmployeeForm();
  closeEmployeeModal();
  await Promise.all([loadEmployees(), loadAttendance()]);
}

async function saveSettings(event) {
  event.preventDefault();

  const selectedDays = Array.from(workingDaysWrap.querySelectorAll('input[type="checkbox"]:checked')).map((item) =>
    Number(item.value)
  );

  if (!selectedDays.length) {
    showToast("Select at least one working day.", "error");
    return;
  }

  await requestJson("/api/admin/workday-settings", {
    method: "PUT",
    body: JSON.stringify({
      shiftStart: shiftStartInput.value,
      shiftEnd: shiftEndInput.value,
      halfDayAfter: halfDayAfterInput.value,
      minimumWorkMinutes: Number(minimumWorkMinutesInput.value),
      graceMinutes: Number(graceMinutesInput.value),
      autoPunchOut: autoPunchOutToggle.value === "true",
      autoPunchOutTime: autoPunchOutTimeInput.value,
      workingDays: selectedDays
    })
  });

  showToast("Workday rules saved", "success");
  await loadAttendance();
}

async function toggleEmployeeActive(employeeId) {
  const employee = cachedEmployees.find((item) => item.id === employeeId);
  if (!employee) return;

  await requestJson(`/api/admin/employees/${encodeURIComponent(employeeId)}`, {
    method: "PATCH",
    body: JSON.stringify({ active: !employee.active })
  });

  await Promise.all([loadEmployees(), loadAttendance()]);
  showToast(`Employee ${employee.active ? "disabled" : "enabled"}`, "success");
}

async function deleteEmployee(employeeId) {
  await requestJson(`/api/admin/employees/${encodeURIComponent(employeeId)}`, {
    method: "DELETE"
  });

  if (employeeMode.value === "edit" && employeeOriginalId.value === employeeId) {
    resetEmployeeForm();
  }

  await Promise.all([loadEmployees(), loadAttendance()]);
  showToast("Employee deleted", "success");
}

attendanceBody.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (!target.classList.contains("attendance-edit")) return;

  const employeeId = String(target.dataset.id ?? "").trim();
  if (!employeeId) return;

  const row = cachedAttendanceRows.find((item) => item.employeeId === employeeId);
  if (!row) return;

  openAttendanceEditModal(row);
});

employeesBody.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  if (target.classList.contains("employee-edit")) {
    const employeeId = target.dataset.id;
    const employee = cachedEmployees.find((item) => item.id === employeeId);
    if (employee) {
      fillEmployeeForm(employee);
      openEmployeeModal();
      showToast(`Editing ${employee.id}`, "success");
    }
    return;
  }

  if (target.classList.contains("employee-toggle")) {
    const employeeId = target.dataset.id;
    if (employeeId) {
      try {
        await toggleEmployeeActive(employeeId);
      } catch (error) {
        showToast(error.message, "error");
      }
    }
    return;
  }

  if (target.classList.contains("employee-delete")) {
    const employeeId = target.dataset.id;
    if (employeeId && window.confirm(`Delete employee ${employeeId}? This will remove attendance history for this employee.`)) {
      try {
        await deleteEmployee(employeeId);
      } catch (error) {
        showToast(error.message, "error");
      }
    }
  }
});

sidebarNav?.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.classList.contains("nav-btn")) return;
  const viewId = target.dataset.view;
  if (!viewId) return;

  setActiveView(viewId);

  try {
    if (viewId === "usersView") {
      await loadEmployees();
    }
    if (viewId === "configView") {
      await loadSettings();
    }
    if (viewId === "reportsView") {
      await loadReportByMonth(reportMonthInput.value);
    }
    if (viewId === "profileView") {
      renderAdminProfile();
    }
  } catch (error) {
    showToast(error.message, "error");
  }
});

refreshButton?.addEventListener("click", () => {
  loadAttendance().then(() => showToast("Attendance refreshed", "success")).catch((error) => showToast(error.message, "error"));
});

dailyRefreshButton?.addEventListener("click", () => {
  loadAttendance().then(() => showToast("Daily data refreshed", "success")).catch((error) => showToast(error.message, "error"));
});

autoManageButton?.addEventListener("click", async () => {
  try {
    const payload = await requestJson("/api/admin/attendance/auto-manage", {
      method: "POST",
      body: JSON.stringify({ date: todayDate, force: true })
    });

    await loadAttendance();
    showToast(`${payload.updatedRecords} record(s) auto-managed`, "success");
  } catch (error) {
    showToast(error.message, "error");
  }
});

employeeForm.addEventListener("submit", (event) => {
  saveEmployee(event).catch((error) => showToast(error.message, "error"));
});

resetEmployeeButton.addEventListener("click", () => {
  resetEmployeeForm();
  showToast("Form reset", "success");
});

reloadEmployeesButton.addEventListener("click", () => {
  loadEmployees().then(() => showToast("Employee list reloaded", "success")).catch((error) => showToast(error.message, "error"));
});

employeeSearchInput?.addEventListener("input", applyEmployeeFilter);

settingsForm.addEventListener("submit", (event) => {
  saveSettings(event).catch((error) => showToast(error.message, "error"));
});

openAddEmployeeButton?.addEventListener("click", () => {
  resetEmployeeForm();
  openEmployeeModal();
});

closeEmployeeModalButton?.addEventListener("click", closeEmployeeModal);

employeeModal?.addEventListener("click", (event) => {
  if (event.target === employeeModal) closeEmployeeModal();
});

attendanceEditForm.addEventListener("submit", (event) => {
  saveAttendanceCorrection(event).catch((error) => showToast(error.message, "error"));
});

clearCheckOutInput.addEventListener("change", () => {
  editCheckOutInput.disabled = clearCheckOutInput.checked;
  if (clearCheckOutInput.checked) {
    editCheckOutInput.value = "";
  }
});

closeAttendanceEditModalButton.addEventListener("click", closeAttendanceEditModal);
cancelAttendanceEditButton.addEventListener("click", closeAttendanceEditModal);

attendanceEditModal.addEventListener("click", (event) => {
  if (event.target === attendanceEditModal) closeAttendanceEditModal();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && attendanceEditModal.classList.contains("show")) {
    closeAttendanceEditModal();
  }
  if (event.key === "Escape" && employeeModal.classList.contains("show")) {
    closeEmployeeModal();
  }
});

currentMonthButton?.addEventListener("click", () => {
  runCurrentMonthReport().catch((error) => showToast(error.message, "error"));
});

previousMonthButton?.addEventListener("click", () => {
  runPreviousMonthReport().catch((error) => showToast(error.message, "error"));
});

runReportButton?.addEventListener("click", () => {
  loadReportByMonth(reportMonthInput.value).then(() => showToast("Report generated", "success")).catch((error) => showToast(error.message, "error"));
});

exportReportButton?.addEventListener("click", () => {
  try {
    const range = monthRange(reportMonthInput.value);
    window.open(`/api/attendance/export.csv?from=${range.from}&to=${range.to}`, "_blank");
    showToast("CSV export opened", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
});

const socket = io();

socket.on("connect", () => {
  socketStatus.textContent = "Connected";
  socketStatus.classList.remove("disconnected");
  socketStatus.classList.add("connected");
});

socket.on("disconnect", () => {
  socketStatus.textContent = "Disconnected";
  socketStatus.classList.remove("connected");
  socketStatus.classList.add("disconnected");
});

socket.on("attendance:summary", (payload) => {
  if (!payload || !payload.rows || !payload.summary) return;
  cachedAttendanceRows = payload.rows;
  renderSummary(payload.summary);
  renderDashboardRows(payload.rows);
  renderAttendanceRows(payload.rows);
});

async function init() {
  try {
    setActiveView(activeView);
    resetEmployeeForm();
    await loadAttendance();
    await Promise.all([loadEmployees(), loadSettings()]);
    await runCurrentMonthReport();
    renderAdminProfile();
  } catch (error) {
    showToast(error.message, "error");
  }
}

init();
