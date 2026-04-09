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

function toLocationValue(location: AttendanceRow["checkInLocation"]): string {
  if (!location) return "";
  return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
}

export function attendanceRowsToCsv(rows: AttendanceRow[]): string {
  const headers = [
    "Employee ID",
    "Employee Name",
    "Department",
    "Date",
    "Punch In Time",
    "Punch In Location",
    "Punch Out Time",
    "Punch Out Location",
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
      toLocationValue(row.checkInLocation),
      row.checkOutAt,
      toLocationValue(row.checkOutLocation),
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
