import "dotenv/config";
import http from "node:http";
import path from "node:path";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import { ApiError } from "./errors.js";
import { attendanceRowsToCsv } from "./csv.js";
import { getDateKey, getTimeZone, nowIso } from "./time.js";
import { getDataFilePath, mutateDb, readDb } from "./store.js";
import type { AttendanceRecord, AttendanceRow, Employee, JsonDatabase, PunchEvent, WorkdaySettings } from "./types.js";

const port = Number(process.env.PORT ?? 4000);
const machineSecret = process.env.MACHINE_SECRET ?? "trax-machine-secret";
const corsOrigin = process.env.CORS_ORIGIN ?? "*";
const timeZone = getTimeZone();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOrigin === "*" ? true : corsOrigin.split(",").map((item) => item.trim())
  }
});

app.use(cors({ origin: corsOrigin === "*" ? true : corsOrigin.split(",").map((item) => item.trim()) }));
app.use(express.json());

const publicPath = path.resolve(process.cwd(), "public");
app.use(express.static(publicPath));

app.get("/", (_req, res) => {
  res.redirect("/dashboard");
});

app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

function cleanEmployee(employee: Employee) {
  return {
    id: employee.id,
    name: employee.name,
    department: employee.department,
    active: employee.active,
    createdAt: employee.createdAt
  };
}

function parseTimeToMinutes(time: string): number {
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
    throw new ApiError(400, `Invalid time format: ${time}. Use HH:MM.`);
  }

  const [hour, minute] = time.split(":").map((item) => Number(item));
  return hour * 60 + minute;
}

function minuteDiff(laterIso: string, earlierIso: string): number {
  const later = new Date(laterIso).getTime();
  const earlier = new Date(earlierIso).getTime();
  return Math.max(0, Math.floor((later - earlier) / (1000 * 60)));
}

function getMinuteOfDay(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(iso));

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  return hour * 60 + minute;
}

function isWorkingDay(date: string, settings: WorkdaySettings): boolean {
  const weekDay = new Date(`${date}T00:00:00Z`).getUTCDay();
  return settings.workingDays.includes(weekDay);
}

function normalizeWorkingDays(days: number[]): number[] {
  return Array.from(new Set(days.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort((a, b) => a - b);
}

function parseIsoInput(value: unknown, fieldName: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    throw new ApiError(400, `${fieldName} is required`);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, `${fieldName} must be a valid datetime`);
  }

  return parsed.toISOString();
}

function parseOptionalIsoInput(value: unknown, fieldName: string): string | null {
  if (value == null || value === "") {
    return null;
  }

  return parseIsoInput(value, fieldName);
}

function buildAttendanceRow(
  employee: Employee,
  record: AttendanceRecord | undefined,
  date: string,
  settings: WorkdaySettings
): AttendanceRow {
  if (!record) {
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      department: employee.department,
      date,
      machinePunchAt: null,
      checkInAt: null,
      checkOutAt: null,
      workedMinutes: null,
      lateByMinutes: 0,
      earlyOutByMinutes: 0,
      autoManaged: false,
      performance: "ABSENT",
      status: "ABSENT"
    };
  }

  const shiftStartMinutes = parseTimeToMinutes(settings.shiftStart);
  const shiftEndMinutes = parseTimeToMinutes(settings.shiftEnd);
  const checkInMinutes = getMinuteOfDay(record.checkInAt);
  const lateByMinutes = Math.max(0, checkInMinutes - (shiftStartMinutes + settings.graceMinutes));

  let workedMinutes: number | null = null;
  let earlyOutByMinutes = 0;

  if (record.checkOutAt) {
    const checkOutMinutes = getMinuteOfDay(record.checkOutAt);
    workedMinutes = minuteDiff(record.checkOutAt, record.checkInAt);
    earlyOutByMinutes = Math.max(0, shiftEndMinutes - checkOutMinutes);
  }

  let performance: AttendanceRow["performance"] = "IN_PROGRESS";
  if (record.autoManaged) {
    performance = "AUTO_CLOSED";
  } else if (record.checkOutAt) {
    if (lateByMinutes > 0 && earlyOutByMinutes > 0) {
      performance = "LATE_AND_EARLY";
    } else if (lateByMinutes > 0) {
      performance = "LATE_IN";
    } else if (earlyOutByMinutes > 0) {
      performance = "EARLY_OUT";
    } else {
      performance = "ON_TIME";
    }
  }

  return {
    employeeId: employee.id,
    employeeName: employee.name,
    department: employee.department,
    date: record.date,
    machinePunchAt: record.machinePunchAt,
    checkInAt: record.checkInAt,
    checkOutAt: record.checkOutAt,
    workedMinutes,
    lateByMinutes,
    earlyOutByMinutes,
    autoManaged: record.autoManaged,
    performance,
    status: record.checkOutAt ? "CHECKED_OUT" : "IN_OFFICE"
  };
}

function buildRows(db: JsonDatabase, date: string): AttendanceRow[] {
  return db.employees
    .filter((employee) => employee.active)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((employee) => {
      const record = db.attendance.find((row) => row.employeeId === employee.id && row.date === date);
      return buildAttendanceRow(employee, record, date, db.settings);
    });
}

function buildSummary(rows: AttendanceRow[]) {
  return {
    totalEmployees: rows.length,
    checkedIn: rows.filter((row) => row.status === "IN_OFFICE").length,
    checkedOut: rows.filter((row) => row.status === "CHECKED_OUT").length,
    absent: rows.filter((row) => row.status === "ABSENT").length
  };
}

async function broadcastAttendance(date: string): Promise<void> {
  const db = await readDb();
  const rows = buildRows(db, date);

  io.emit("attendance:summary", {
    date,
    rows,
    summary: buildSummary(rows),
    settings: db.settings,
    generatedAt: nowIso()
  });
}

function getEmployeeById(db: JsonDatabase, employeeId: string): Employee | undefined {
  return db.employees.find((employee) => employee.id.toUpperCase() === employeeId.toUpperCase());
}

function getActiveEmployeeById(db: JsonDatabase, employeeId: string): Employee | undefined {
  const employee = getEmployeeById(db, employeeId);
  if (!employee || !employee.active) {
    return undefined;
  }
  return employee;
}

function handleError(error: unknown, res: Response) {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }

  console.error(error);
  res.status(500).json({ message: "Internal server error" });
}

async function autoManageAttendanceForDate(targetDate: string, force: boolean, runAtIso = nowIso()): Promise<number> {
  const updatedRecords = await mutateDb((db) => {
    if (!force) {
      if (!db.settings.autoPunchOut) {
        return 0;
      }

      if (!isWorkingDay(targetDate, db.settings)) {
        return 0;
      }

      const currentMinutes = getMinuteOfDay(runAtIso);
      const autoCloseMinutes = parseTimeToMinutes(db.settings.autoPunchOutTime);
      if (currentMinutes < autoCloseMinutes) {
        return 0;
      }
    }

    let updated = 0;
    for (const record of db.attendance) {
      if (record.date === targetDate && record.checkInAt && !record.checkOutAt) {
        record.checkOutAt = runAtIso;
        record.autoManaged = true;
        record.updatedAt = runAtIso;
        updated += 1;
      }
    }

    return updated;
  });

  if (updatedRecords > 0) {
    await broadcastAttendance(targetDate);
  }

  return updatedRecords;
}

function startAutoManager() {
  const interval = setInterval(() => {
    const currentIso = nowIso();
    const today = getDateKey(currentIso);

    autoManageAttendanceForDate(today, false, currentIso).catch((error) => {
      console.error("Auto-manage failed", error);
    });
  }, 60_000);

  interval.unref();
}

app.get("/api/health", async (_req, res) => {
  const db = await readDb();
  res.json({
    status: "ok",
    dataFile: getDataFilePath(),
    timeZone,
    settings: db.settings,
    timestamp: nowIso()
  });
});

app.get("/api/employees", async (_req, res) => {
  try {
    const db = await readDb();
    res.json({ employees: db.employees.filter((item) => item.active).map(cleanEmployee) });
  } catch (error) {
    handleError(error, res);
  }
});

app.post("/api/employees/login", async (req, res) => {
  try {
    const employeeId = String(req.body.employeeId ?? "").trim();
    const pin = String(req.body.pin ?? "").trim();

    if (!employeeId || !pin) {
      throw new ApiError(400, "employeeId and pin are required");
    }

    const db = await readDb();
    const employee = getEmployeeById(db, employeeId);

    if (!employee) {
      throw new ApiError(404, "Employee not found");
    }

    if (!employee.active) {
      throw new ApiError(403, "This account is disabled. Contact HR.");
    }

    if (employee.pin !== pin) {
      throw new ApiError(401, "Invalid PIN");
    }

    res.json({
      employee: cleanEmployee(employee),
      message: "Login successful"
    });
  } catch (error) {
    handleError(error, res);
  }
});

app.get("/api/admin/employees", async (_req, res) => {
  try {
    const db = await readDb();
    const employees = db.employees.slice().sort((a, b) => a.id.localeCompare(b.id));
    res.json({ employees: employees.map(cleanEmployee) });
  } catch (error) {
    handleError(error, res);
  }
});

app.post("/api/admin/employees", async (req, res) => {
  try {
    const id = String(req.body.id ?? "").trim().toUpperCase();
    const name = String(req.body.name ?? "").trim();
    const department = String(req.body.department ?? "General").trim() || "General";
    const pin = String(req.body.pin ?? "").trim();

    if (!id || !name || !pin) {
      throw new ApiError(400, "id, name, and pin are required");
    }

    const employee = await mutateDb((db) => {
      if (db.employees.some((item) => item.id === id)) {
        throw new ApiError(409, "Employee ID already exists");
      }

      const nextEmployee: Employee = {
        id,
        name,
        department,
        pin,
        active: true,
        createdAt: nowIso()
      };

      db.employees.push(nextEmployee);
      return nextEmployee;
    });

    await broadcastAttendance(getDateKey(nowIso()));

    res.status(201).json({
      message: "Employee created",
      employee: cleanEmployee(employee)
    });
  } catch (error) {
    handleError(error, res);
  }
});

app.patch("/api/admin/employees/:employeeId", async (req, res) => {
  try {
    const employeeId = String(req.params.employeeId ?? "").trim();

    const updatedEmployee = await mutateDb((db) => {
      const employee = getEmployeeById(db, employeeId);
      if (!employee) {
        throw new ApiError(404, "Employee not found");
      }

      if (typeof req.body.name === "string") {
        const nextName = req.body.name.trim();
        if (!nextName) throw new ApiError(400, "Name cannot be empty");
        employee.name = nextName;
      }

      if (typeof req.body.department === "string") {
        const nextDepartment = req.body.department.trim();
        employee.department = nextDepartment || "General";
      }

      if (typeof req.body.pin === "string") {
        const nextPin = req.body.pin.trim();
        if (!nextPin) throw new ApiError(400, "PIN cannot be empty");
        employee.pin = nextPin;
      }

      if (typeof req.body.active === "boolean") {
        employee.active = req.body.active;
      }

      return employee;
    });

    await broadcastAttendance(getDateKey(nowIso()));

    res.json({
      message: "Employee updated",
      employee: cleanEmployee(updatedEmployee)
    });
  } catch (error) {
    handleError(error, res);
  }
});

app.get("/api/admin/workday-settings", async (_req, res) => {
  try {
    const db = await readDb();
    res.json({ settings: db.settings });
  } catch (error) {
    handleError(error, res);
  }
});

app.put("/api/admin/workday-settings", async (req, res) => {
  try {
    const nextSettings = await mutateDb((db) => {
      const current = db.settings;

      if (typeof req.body.shiftStart === "string") {
        parseTimeToMinutes(req.body.shiftStart);
        current.shiftStart = req.body.shiftStart;
      }

      if (typeof req.body.shiftEnd === "string") {
        parseTimeToMinutes(req.body.shiftEnd);
        current.shiftEnd = req.body.shiftEnd;
      }

      if (typeof req.body.autoPunchOutTime === "string") {
        parseTimeToMinutes(req.body.autoPunchOutTime);
        current.autoPunchOutTime = req.body.autoPunchOutTime;
      }

      if (typeof req.body.graceMinutes === "number") {
        if (req.body.graceMinutes < 0 || req.body.graceMinutes > 120) {
          throw new ApiError(400, "graceMinutes must be between 0 and 120");
        }
        current.graceMinutes = Math.floor(req.body.graceMinutes);
      }

      if (typeof req.body.autoPunchOut === "boolean") {
        current.autoPunchOut = req.body.autoPunchOut;
      }

      if (Array.isArray(req.body.workingDays)) {
        const normalized = normalizeWorkingDays(req.body.workingDays);
        if (normalized.length === 0) {
          throw new ApiError(400, "At least one working day is required");
        }
        current.workingDays = normalized;
      }

      return current;
    });

    await broadcastAttendance(getDateKey(nowIso()));

    res.json({
      message: "Workday settings updated",
      settings: nextSettings
    });
  } catch (error) {
    handleError(error, res);
  }
});

app.post("/api/admin/attendance/auto-manage", async (req, res) => {
  try {
    const date = String(req.body.date ?? getDateKey(nowIso()));
    const force = req.body.force ?? true;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ApiError(400, "date must be YYYY-MM-DD");
    }

    const updatedRecords = await autoManageAttendanceForDate(date, Boolean(force), nowIso());

    res.json({
      message: updatedRecords > 0 ? "Auto management completed" : "No open attendance records",
      date,
      updatedRecords
    });
  } catch (error) {
    handleError(error, res);
  }
});

app.patch("/api/admin/attendance/:employeeId", async (req, res) => {
  try {
    const employeeId = String(req.params.employeeId ?? "").trim();
    const date = String(req.body.date ?? "").trim();

    if (!employeeId) {
      throw new ApiError(400, "employeeId is required");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ApiError(400, "date must be YYYY-MM-DD");
    }

    const checkInAt = parseIsoInput(req.body.checkInAt, "checkInAt");
    const checkOutAt = parseOptionalIsoInput(req.body.checkOutAt, "checkOutAt");

    if (getDateKey(checkInAt, timeZone) !== date) {
      throw new ApiError(400, "checkInAt must belong to selected date");
    }

    if (checkOutAt && getDateKey(checkOutAt, timeZone) !== date) {
      throw new ApiError(400, "checkOutAt must belong to selected date");
    }

    if (checkOutAt && new Date(checkOutAt).getTime() <= new Date(checkInAt).getTime()) {
      throw new ApiError(400, "checkOutAt must be later than checkInAt");
    }

    const row = await mutateDb((db) => {
      const employee = getEmployeeById(db, employeeId);
      if (!employee) {
        throw new ApiError(404, "Employee not found");
      }

      let record = db.attendance.find((item) => item.employeeId === employee.id && item.date === date);
      const updatedAt = nowIso();

      if (!record) {
        record = {
          id: nanoid(12),
          employeeId: employee.id,
          date,
          machinePunchAt: null,
          checkInAt,
          checkOutAt,
          autoManaged: false,
          createdAt: updatedAt,
          updatedAt
        };
        db.attendance.push(record);
      } else {
        record.machinePunchAt = null;
        record.checkInAt = checkInAt;
        record.checkOutAt = checkOutAt;
        record.autoManaged = false;
        record.updatedAt = updatedAt;
      }

      return buildAttendanceRow(employee, record, date, db.settings);
    });

    await broadcastAttendance(date);
    io.emit("attendance:updated", row);

    res.json({
      message: "Attendance corrected",
      record: row
    });
  } catch (error) {
    handleError(error, res);
  }
});

app.post("/api/punch-machine/events", async (req, res) => {
  try {
    const incomingSecret = req.header("x-machine-secret");
    if (incomingSecret !== machineSecret) {
      throw new ApiError(401, "Invalid machine secret");
    }

    const employeeId = String(req.body.employeeId ?? "").trim();
    const punchedAt = String(req.body.punchedAt ?? nowIso());
    const deviceId = String(req.body.deviceId ?? "machine-1");

    if (!employeeId) {
      throw new ApiError(400, "employeeId is required");
    }

    const db = await mutateDb((currentDb) => {
      const employee = getActiveEmployeeById(currentDb, employeeId);
      if (!employee) {
        throw new ApiError(404, "Active employee not found");
      }

      const punchEvent: PunchEvent = {
        id: nanoid(12),
        employeeId: employee.id,
        punchedAt,
        deviceId
      };

      currentDb.punchEvents.push(punchEvent);
      if (currentDb.punchEvents.length > 5000) {
        currentDb.punchEvents = currentDb.punchEvents.slice(-5000);
      }

      return currentDb;
    });

    const date = getDateKey(punchedAt);
    await broadcastAttendance(date);

    res.status(201).json({ message: "Punch event captured", punchEvents: db.punchEvents.length });
  } catch (error) {
    handleError(error, res);
  }
});

app.post("/api/attendance/check-in", async (req, res) => {
  try {
    const employeeId = String(req.body.employeeId ?? "").trim();
    if (!employeeId) {
      throw new ApiError(400, "employeeId is required");
    }

    const checkInAt = nowIso();
    const date = getDateKey(checkInAt);

    const row = await mutateDb((db) => {
      const employee = getActiveEmployeeById(db, employeeId);
      if (!employee) {
        throw new ApiError(404, "Active employee not found");
      }

      let record = db.attendance.find((item) => item.employeeId === employee.id && item.date === date);
      if (record?.checkInAt) {
        throw new ApiError(409, "You are already punched in for today.");
      }

      if (!record) {
        record = {
          id: nanoid(12),
          employeeId: employee.id,
          date,
          machinePunchAt: null,
          checkInAt,
          checkOutAt: null,
          autoManaged: false,
          createdAt: checkInAt,
          updatedAt: checkInAt
        };
        db.attendance.push(record);
      } else {
        record.machinePunchAt = null;
        record.checkInAt = checkInAt;
        record.checkOutAt = null;
        record.autoManaged = false;
        record.updatedAt = checkInAt;
      }

      return buildAttendanceRow(employee, record, date, db.settings);
    });

    await broadcastAttendance(date);
    io.emit("attendance:updated", row);

    res.status(201).json({ message: "Punched in successfully", record: row });
  } catch (error) {
    handleError(error, res);
  }
});

app.post("/api/attendance/check-out", async (req, res) => {
  try {
    const employeeId = String(req.body.employeeId ?? "").trim();
    if (!employeeId) {
      throw new ApiError(400, "employeeId is required");
    }

    const checkOutAt = nowIso();
    const date = getDateKey(checkOutAt);

    const row = await mutateDb((db) => {
      const employee = getActiveEmployeeById(db, employeeId);
      if (!employee) {
        throw new ApiError(404, "Active employee not found");
      }

      const record = db.attendance.find((item) => item.employeeId === employee.id && item.date === date);

      if (!record?.checkInAt) {
        throw new ApiError(400, "You are not punched in yet.");
      }

      if (record.checkOutAt) {
        throw new ApiError(409, "You have already punched out for today.");
      }

      record.checkOutAt = checkOutAt;
      record.autoManaged = false;
      record.updatedAt = checkOutAt;

      return buildAttendanceRow(employee, record, date, db.settings);
    });

    await broadcastAttendance(date);
    io.emit("attendance:updated", row);

    res.json({ message: "Punched out successfully", record: row });
  } catch (error) {
    handleError(error, res);
  }
});

app.get("/api/attendance/today", async (req, res) => {
  try {
    const dateParam = String(req.query.date ?? "").trim();
    const date = dateParam || getDateKey(nowIso());

    const db = await readDb();
    const rows = buildRows(db, date);

    res.json({
      date,
      rows,
      settings: db.settings,
      summary: buildSummary(rows)
    });
  } catch (error) {
    handleError(error, res);
  }
});

app.get("/api/attendance/employee/:employeeId/today", async (req: Request, res: Response) => {
  try {
    const employeeId = String(req.params.employeeId ?? "").trim();
    const dateParam = String(req.query.date ?? "").trim();
    const date = dateParam || getDateKey(nowIso());

    const db = await readDb();
    const employee = getEmployeeById(db, employeeId);

    if (!employee) {
      throw new ApiError(404, "Employee not found");
    }

    if (!employee.active) {
      throw new ApiError(403, "Employee account is inactive");
    }

    const record = db.attendance.find((item) => item.employeeId === employee.id && item.date === date);
    const row = buildAttendanceRow(employee, record, date, db.settings);

    res.json({ row, settings: db.settings });
  } catch (error) {
    handleError(error, res);
  }
});

app.get("/api/attendance/export.csv", async (req, res) => {
  try {
    const nowDate = getDateKey(nowIso());
    const from = String(req.query.from ?? nowDate);
    const to = String(req.query.to ?? nowDate);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new ApiError(400, "from and to must be in YYYY-MM-DD format");
    }

    if (from > to) {
      throw new ApiError(400, "from date cannot be after to date");
    }

    const db = await readDb();

    const records = db.attendance
      .filter((record) => record.date >= from && record.date <= to)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.employeeId.localeCompare(b.employeeId);
      });

    const rows: AttendanceRow[] = records.map((record) => {
      const employee = db.employees.find((item) => item.id === record.employeeId);

      if (!employee) {
        return {
          employeeId: record.employeeId,
          employeeName: "Unknown",
          department: "Unknown",
          date: record.date,
          machinePunchAt: record.machinePunchAt,
          checkInAt: record.checkInAt,
          checkOutAt: record.checkOutAt,
          workedMinutes: record.checkOutAt ? minuteDiff(record.checkOutAt, record.checkInAt) : null,
          lateByMinutes: 0,
          earlyOutByMinutes: 0,
          autoManaged: record.autoManaged,
          performance: record.autoManaged ? "AUTO_CLOSED" : "ON_TIME",
          status: record.checkOutAt ? "CHECKED_OUT" : "IN_OFFICE"
        };
      }

      return buildAttendanceRow(employee, record, record.date, db.settings);
    });

    const csv = attendanceRowsToCsv(rows);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=attendance_${from}_to_${to}.csv`);
    res.status(200).send(csv);
  } catch (error) {
    handleError(error, res);
  }
});

io.on("connection", async (socket) => {
  const date = getDateKey(nowIso());
  const db = await readDb();
  const rows = buildRows(db, date);

  socket.emit("attendance:summary", {
    date,
    rows,
    summary: buildSummary(rows),
    settings: db.settings,
    generatedAt: nowIso()
  });
});

startAutoManager();

server.listen(port, () => {
  console.log(`Attendance backend listening on http://localhost:${port}`);
  console.log(`Dashboard URL: http://localhost:${port}/dashboard`);
});
