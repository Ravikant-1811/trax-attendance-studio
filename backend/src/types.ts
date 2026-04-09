export interface Employee {
  id: string;
  name: string;
  department: string;
  pin: string;
  active: boolean;
  createdAt: string;
}

export interface PunchEvent {
  id: string;
  employeeId: string;
  punchedAt: string;
  deviceId: string;
}

export interface PunchLocation {
  latitude: number;
  longitude: number;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  machinePunchAt: string | null;
  checkInAt: string;
  checkOutAt: string | null;
  checkInLocation: PunchLocation | null;
  checkOutLocation: PunchLocation | null;
  autoManaged: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkdaySettings {
  shiftStart: string;
  shiftEnd: string;
  graceMinutes: number;
  autoPunchOut: boolean;
  autoPunchOutTime: string;
  halfDayAfter: string;
  minimumWorkMinutes: number;
  workingDays: number[];
}

export interface JsonDatabase {
  employees: Employee[];
  attendance: AttendanceRecord[];
  punchEvents: PunchEvent[];
  settings: WorkdaySettings;
}

export interface AttendanceRow {
  employeeId: string;
  employeeName: string;
  department: string;
  date: string;
  machinePunchAt: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  checkInLocation: PunchLocation | null;
  checkOutLocation: PunchLocation | null;
  workedMinutes: number | null;
  lateByMinutes: number;
  earlyOutByMinutes: number;
  autoManaged: boolean;
  performance:
    | "ABSENT"
    | "ON_TIME"
    | "LATE_IN"
    | "EARLY_OUT"
    | "LATE_AND_EARLY"
    | "IN_PROGRESS"
    | "AUTO_CLOSED"
    | "HALF_DAY";
  status: "ABSENT" | "IN_OFFICE" | "CHECKED_OUT";
}
