import type { AttendanceRow } from "./types.js";

function escapeCsv(value: string | number | boolean | null): string {
  const normalized = value === null ? "" : String(value);
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function toDurationValue(minutes: number | null): string {
  if (minutes == null) return "";
  const totalMinutes = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(totalMinutes / 60);
  const balance = totalMinutes % 60;
  return `${hours}h ${String(balance).padStart(2, "0")}m`;
}

export function attendanceRowsToCsv(rows: AttendanceRow[]): string {
  const headers = [
    "Employee ID",
    "Employee Name",
    "Department",
    "Date",
    "Punch In Time",
    "Punch Out Time",
    "Worked Duration",
    "Late By Duration",
    "Early Out By Duration",
    "Auto Managed",
    "Status",
    "Performance"
  ];

  const lines = rows.map((row) => {
    return [
      row.employeeId,
      row.employeeName,
      row.department,
      row.date,
      row.checkInAt,
      row.checkOutAt,
      toDurationValue(row.workedMinutes),
      toDurationValue(row.lateByMinutes),
      toDurationValue(row.earlyOutByMinutes),
      row.autoManaged,
      row.status,
      row.performance
    ]
      .map((value) => escapeCsv(value))
      .join(",");
  });

  return [headers.join(","), ...lines].join("\n");
}
