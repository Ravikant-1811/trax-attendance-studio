const socketStatus = document.getElementById("socket-status");
const toast = document.getElementById("toast");

const tabAttendance = document.getElementById("tabAttendance");
const tabAdmin = document.getElementById("tabAdmin");
const attendanceTab = document.getElementById("attendanceTab");
const adminTab = document.getElementById("adminTab");

const datePicker = document.getElementById("datePicker");
const refreshButton = document.getElementById("refreshButton");
const exportButton = document.getElementById("exportButton");
const autoManageButton = document.getElementById("autoManageButton");
const policyStrip = document.getElementById("policyStrip");
const summaryCards = document.getElementById("summaryCards");
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
const workingDaysWrap = document.getElementById("workingDaysWrap");

const weekDayLabel = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

let selectedDate = new Date().toISOString().slice(0, 10);
let cachedEmployees = [];
let cachedAttendanceRows = [];
let editingAttendanceRow = null;
let toastTimeout = null;
let nextEmployeeId = "0000001";

datePicker.value = selectedDate;

function showToast(message, type = "success") {
  if (!toast) return;

  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }

  toast.textContent = message;
  toast.className = `toast show ${type}`;

  toastTimeout = setTimeout(() => {
    toast.className = "toast";
  }, 2400);
}

function setActiveTab(tabName) {
  const showAttendance = tabName === "attendance";

  tabAttendance.classList.toggle("active", showAttendance);
  tabAdmin.classList.toggle("active", !showAttendance);

  attendanceTab.classList.toggle("active", showAttendance);
  adminTab.classList.toggle("active", !showAttendance);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getEmployeeInitials(name, id) {
  const words = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  if (words.length === 1 && words[0].length >= 2) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return String(id ?? "EM").slice(0, 2).toUpperCase();
}

function formatDateTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatLocation(location) {
  if (!location) return "-";
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "-";
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function toTimeInputValue(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function toIsoFromSelectedDate(timeValue) {
  const candidate = new Date(`${selectedDate}T${timeValue}:00`);
  if (Number.isNaN(candidate.getTime())) {
    throw new Error("Invalid time selected");
  }

  return candidate.toISOString();
}

function openAttendanceEditModal(row) {
  editingAttendanceRow = row;

  attendanceEditMeta.textContent = `${row.employeeId} • ${row.employeeName} • ${selectedDate}`;
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

function formatDurationFromMinutes(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  const totalMinutes = Math.max(0, Math.floor(Number(value)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function performanceText(value) {
  const map = {
    ABSENT: "Absent",
    ON_TIME: "On Time",
    LATE_IN: "Late In",
    EARLY_OUT: "Early Out",
    LATE_AND_EARLY: "Late + Early",
    IN_PROGRESS: "In Progress",
    AUTO_CLOSED: "Auto Closed"
  };
  return map[value] ?? value;
}

function performanceClass(value) {
  return `performance-${String(value).toLowerCase().replaceAll("_", "-")}`;
}

function statusBadge(status) {
  if (status === "IN_OFFICE") {
    return '<span class="badge in">Punched In</span>';
  }
  if (status === "CHECKED_OUT") {
    return '<span class="badge out">Punched Out</span>';
  }
  return '<span class="badge absent">Absent</span>';
}

function autoBadge(autoManaged) {
  if (autoManaged) {
    return '<span class="badge auto-yes">Yes</span>';
  }
  return '<span class="badge auto-no">No</span>';
}

function renderSummary(summary) {
  const present = summary.checkedIn + summary.checkedOut;
  const attendanceRate = summary.totalEmployees > 0 ? Math.round((present / summary.totalEmployees) * 100) : 0;

  const cards = [
    {
      label: "Active Team",
      value: summary.totalEmployees,
      note: "Employees enabled in system",
      tone: "neutral"
    },
    {
      label: "In Office",
      value: summary.checkedIn,
      note: "Currently punched in",
      tone: "primary"
    },
    {
      label: "Day Closed",
      value: summary.checkedOut,
      note: "Completed punch out",
      tone: "secondary"
    },
    {
      label: "Absent",
      value: summary.absent,
      note: "No check-in yet",
      tone: "danger"
    },
    {
      label: "Attendance Rate",
      value: `${attendanceRate}%`,
      note: "Present vs active team",
      tone: attendanceRate >= 85 ? "primary" : "warn"
    }
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

function renderPolicyStrip(settings) {
  if (!settings) {
    policyStrip.innerHTML = "";
    return;
  }

  const days = settings.workingDays.map((day) => weekDayLabel[day]).join(", ");

  policyStrip.innerHTML = [
    `<span class="policy-pill">Shift ${escapeHtml(settings.shiftStart)} - ${escapeHtml(settings.shiftEnd)}</span>`,
    `<span class="policy-pill">Grace ${escapeHtml(settings.graceMinutes)} min</span>`,
    `<span class="policy-pill">Auto Punch Out ${
      settings.autoPunchOut ? `Enabled @ ${escapeHtml(settings.autoPunchOutTime)}` : "Disabled"
    }</span>`,
    `<span class="policy-pill">Working Days ${escapeHtml(days)}</span>`
  ].join("");
}

function renderAttendanceRows(rows) {
  if (!rows.length) {
    attendanceBody.innerHTML = '<tr><td colspan="12" class="empty-row">No attendance data for selected date.</td></tr>';
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
        <td>${formatDateTime(row.checkInAt)}</td>
        <td>${formatLocation(row.checkInLocation)}</td>
        <td>${formatDateTime(row.checkOutAt)}</td>
        <td>${formatLocation(row.checkOutLocation)}</td>
        <td>${formatDurationFromMinutes(row.workedMinutes)}</td>
        <td>${formatDurationFromMinutes(row.lateByMinutes)}</td>
        <td>${formatDurationFromMinutes(row.earlyOutByMinutes)}</td>
        <td>${autoBadge(row.autoManaged)}</td>
        <td>
          ${statusBadge(row.status)}
          <span class="performance ${performanceClass(row.performance)}">${performanceText(row.performance)}</span>
        </td>
        <td>
          <div class="attendance-manage">
            <button type="button" class="ghost attendance-edit" data-id="${escapeHtml(row.employeeId)}">Edit Time</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

function populateSettingsForm(settings) {
  shiftStartInput.value = settings.shiftStart;
  shiftEndInput.value = settings.shiftEnd;
  graceMinutesInput.value = String(settings.graceMinutes);
  autoPunchOutToggle.value = String(settings.autoPunchOut);
  autoPunchOutTimeInput.value = settings.autoPunchOutTime;

  const selectedDays = new Set(settings.workingDays);
  for (const checkbox of workingDaysWrap.querySelectorAll('input[type="checkbox"]')) {
    checkbox.checked = selectedDays.has(Number(checkbox.value));
  }

  renderPolicyStrip(settings);
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
  nextEmployeeId = /^(\d{7})$/.test(candidate) ? candidate : "0000001";
}

function resetEmployeeForm() {
  employeeMode.value = "create";
  employeeOriginalId.value = "";
  employeeIdInput.value = nextEmployeeId;
  employeeNameInput.value = "";
  employeeDepartmentInput.value = "";
  employeePinInput.value = "";
  employeeActiveInput.value = "true";
  employeeIdInput.disabled = true;
  setEmployeePinMode("create");
}

function fillEmployeeForm(employee) {
  employeeMode.value = "edit";
  employeeOriginalId.value = employee.id;
  employeeIdInput.value = employee.id;
  employeeNameInput.value = employee.name;
  employeeDepartmentInput.value = employee.department;
  employeePinInput.value = "";
  employeeActiveInput.value = String(employee.active);
  employeeIdInput.disabled = false;
  setEmployeePinMode("edit");
}

function renderEmployeeMeta(employees) {
  if (!employeeMetaCards) return;

  const activeCount = employees.filter((employee) => employee.active).length;
  const inactiveCount = employees.length - activeCount;
  const departments = new Set(employees.map((employee) => employee.department)).size;
  const cards = [
    {
      label: "Total Employees",
      value: employees.length,
      note: "All employee profiles",
      tone: "neutral"
    },
    {
      label: "Active Accounts",
      value: activeCount,
      note: "Can login and punch",
      tone: "primary"
    },
    {
      label: "Disabled Accounts",
      value: inactiveCount,
      note: "Access currently blocked",
      tone: inactiveCount > 0 ? "warn" : "secondary"
    },
    {
      label: "Departments",
      value: departments,
      note: "Distinct teams configured",
      tone: "secondary"
    }
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
    employeesBody.innerHTML =
      '<tr><td colspan="6" class="empty-row">No employees match your search. Try another keyword.</td></tr>';
    return;
  }

  employeesBody.innerHTML = employees
    .map((employee) => {
      return `<tr>
        <td>${escapeHtml(employee.id)}</td>
        <td>${escapeHtml(employee.name)}</td>
        <td>${escapeHtml(employee.department)}</td>
        <td>${employee.active ? '<span class="badge in">Active</span>' : '<span class="badge absent">Disabled</span>'}</td>
        <td>${new Date(employee.createdAt).toLocaleDateString()}</td>
        <td>
          <div class="manage-buttons">
            <button type="button" class="ghost employee-edit" data-id="${escapeHtml(employee.id)}">Edit</button>
            <button type="button" class="ghost employee-toggle" data-id="${escapeHtml(employee.id)}">${
              employee.active ? "Disable" : "Enable"
            }</button>
            <button type="button" class="ghost employee-delete" data-id="${escapeHtml(employee.id)}">Delete</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
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
  const payload = await requestJson(`/api/attendance/today?date=${selectedDate}`);
  cachedAttendanceRows = payload.rows;
  renderSummary(payload.summary);
  renderAttendanceRows(payload.rows);
  if (payload.settings) {
    populateSettingsForm(payload.settings);
  }
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
      date: selectedDate,
      checkInAt,
      checkOutAt
    })
  });

  await loadAttendance();
  closeAttendanceEditModal();
  showToast("Attendance time corrected", "success");
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
}

async function loadSettings() {
  const payload = await requestJson("/api/admin/workday-settings");
  populateSettingsForm(payload.settings);
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

  if (!name || !department) {
    showToast("Please fill name and department.", "error");
    return;
  }

  if (mode === "create" && !pin) {
    showToast("PIN is required when creating an employee.", "error");
    return;
  }

  if (mode === "edit" && !/^(\d{7})$/.test(employeeId)) {
    showToast("Employee ID must be 7 digits.", "error");
    return;
  }

  if (mode === "create") {
    await requestJson("/api/admin/employees", {
      method: "POST",
      body: JSON.stringify({
        name,
        department,
        pin,
        active
      })
    });
    showToast("Employee created", "success");
  } else {
    const updateBody = {
      name,
      department,
      active
    };

    if (pin) {
      updateBody.pin = pin;
    }

    if (employeeId) {
      updateBody.id = employeeId;
    }

    await requestJson(`/api/admin/employees/${encodeURIComponent(originalEmployeeId || employeeId)}`, {
      method: "PATCH",
      body: JSON.stringify(updateBody)
    });
    showToast("Employee updated", "success");
  }

  resetEmployeeForm();
  await Promise.all([loadEmployees(), loadAttendance()]);
}

async function saveSettings(event) {
  event.preventDefault();

  const selectedDays = Array.from(workingDaysWrap.querySelectorAll('input[type="checkbox"]:checked')).map((item) =>
    Number(item.value)
  );

  if (selectedDays.length === 0) {
    showToast("Select at least one working day.", "error");
    return;
  }

  await requestJson("/api/admin/workday-settings", {
    method: "PUT",
    body: JSON.stringify({
      shiftStart: shiftStartInput.value,
      shiftEnd: shiftEndInput.value,
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
      setActiveTab("admin");
      employeeForm.scrollIntoView({ behavior: "smooth", block: "center" });
      showToast(`Editing ${employee.id}`, "success");
    }
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

resetEmployeeButton.addEventListener("click", () => {
  resetEmployeeForm();
  showToast("Form reset", "success");
});

reloadEmployeesButton.addEventListener("click", () => {
  loadEmployees().then(() => showToast("Employee list reloaded", "success")).catch((error) => showToast(error.message, "error"));
});

employeeSearchInput?.addEventListener("input", () => {
  applyEmployeeFilter();
});

employeeForm.addEventListener("submit", (event) => {
  saveEmployee(event).catch((error) => showToast(error.message, "error"));
});

settingsForm.addEventListener("submit", (event) => {
  saveSettings(event).catch((error) => showToast(error.message, "error"));
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
  if (event.target === attendanceEditModal) {
    closeAttendanceEditModal();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && attendanceEditModal.classList.contains("show")) {
    closeAttendanceEditModal();
  }
});

refreshButton.addEventListener("click", () => {
  loadAttendance().then(() => showToast("Attendance refreshed", "success")).catch((error) => showToast(error.message, "error"));
});

exportButton.addEventListener("click", () => {
  window.open(`/api/attendance/export.csv?from=${selectedDate}&to=${selectedDate}`, "_blank");
  showToast("CSV export opened", "success");
});

autoManageButton.addEventListener("click", async () => {
  try {
    const payload = await requestJson("/api/admin/attendance/auto-manage", {
      method: "POST",
      body: JSON.stringify({ date: selectedDate, force: true })
    });

    await loadAttendance();
    showToast(`${payload.updatedRecords} record(s) auto-managed`, "success");
  } catch (error) {
    showToast(error.message, "error");
  }
});

datePicker.addEventListener("change", async (event) => {
  selectedDate = event.target.value;
  try {
    await loadAttendance();
  } catch (error) {
    showToast(error.message, "error");
  }
});

tabAttendance.addEventListener("click", () => setActiveTab("attendance"));

tabAdmin.addEventListener("click", async () => {
  setActiveTab("admin");
  try {
    await Promise.all([loadEmployees(), loadSettings()]);
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
  if (payload.date !== selectedDate) return;
  renderSummary(payload.summary);
  renderAttendanceRows(payload.rows);
  if (payload.settings) {
    populateSettingsForm(payload.settings);
  }
});

setInterval(() => {
  loadAttendance().catch(() => undefined);
}, 30_000);

resetEmployeeForm();

Promise.all([loadAttendance(), loadEmployees(), loadSettings()]).catch((error) => {
  console.error(error);
  showToast("Unable to load dashboard data", "error");
});
