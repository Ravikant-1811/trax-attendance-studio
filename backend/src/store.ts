import { promises as fs } from "node:fs";
import path from "node:path";
import type { JsonDatabase } from "./types.js";

const dataFilePath = path.resolve(process.cwd(), "data", "store.json");
const createdAtSeed = new Date().toISOString();

const defaultDb: JsonDatabase = {
  employees: [
    { id: "EMP001", name: "Aman Sharma", department: "Sales", pin: "1111", active: true, createdAt: createdAtSeed },
    { id: "EMP002", name: "Neha Verma", department: "Operations", pin: "2222", active: true, createdAt: createdAtSeed },
    { id: "EMP003", name: "Rahul Singh", department: "Finance", pin: "3333", active: true, createdAt: createdAtSeed }
  ],
  attendance: [],
  punchEvents: [],
  settings: {
    shiftStart: "09:30",
    shiftEnd: "18:30",
    graceMinutes: 10,
    autoPunchOut: true,
    autoPunchOutTime: "19:00",
    workingDays: [1, 2, 3, 4, 5, 6]
  }
};

let writeQueue: Promise<void> = Promise.resolve();

async function ensureDataFile() {
  try {
    await fs.access(dataFilePath);
  } catch {
    await fs.mkdir(path.dirname(dataFilePath), { recursive: true });
    await fs.writeFile(dataFilePath, JSON.stringify(defaultDb, null, 2), "utf8");
  }
}

export async function readDb(): Promise<JsonDatabase> {
  await ensureDataFile();
  const raw = await fs.readFile(dataFilePath, "utf8");
  const parsed = JSON.parse(raw) as Partial<JsonDatabase>;
  return normalizeDb(parsed);
}

async function writeDb(db: JsonDatabase): Promise<void> {
  await fs.writeFile(dataFilePath, JSON.stringify(db, null, 2), "utf8");
}

export async function mutateDb<T>(mutator: (db: JsonDatabase) => T | Promise<T>): Promise<T> {
  let output: T;

  writeQueue = writeQueue.then(async () => {
    const db = await readDb();
    output = await mutator(db);
    await writeDb(db);
  });

  await writeQueue;
  return output!;
}

export function getDataFilePath(): string {
  return dataFilePath;
}

function normalizeDb(input: Partial<JsonDatabase>): JsonDatabase {
  const now = new Date().toISOString();

  const employees = (input.employees ?? []).map((employee) => ({
    id: String(employee.id ?? "").trim().toUpperCase(),
    name: String(employee.name ?? "").trim(),
    department: String(employee.department ?? "").trim() || "General",
    pin: String(employee.pin ?? "").trim(),
    active: employee.active ?? true,
    createdAt: employee.createdAt ?? now
  }));

  const attendance = (input.attendance ?? []).map((record) => ({
    id: String(record.id ?? ""),
    employeeId: String(record.employeeId ?? "").trim().toUpperCase(),
    date: String(record.date ?? ""),
    machinePunchAt: record.machinePunchAt ?? null,
    checkInAt: String(record.checkInAt ?? ""),
    checkOutAt: record.checkOutAt ?? null,
    autoManaged: record.autoManaged ?? false,
    createdAt: String(record.createdAt ?? now),
    updatedAt: String(record.updatedAt ?? now)
  }));

  const punchEvents = (input.punchEvents ?? []).map((event) => ({
    id: String(event.id ?? ""),
    employeeId: String(event.employeeId ?? "").trim().toUpperCase(),
    punchedAt: String(event.punchedAt ?? now),
    deviceId: String(event.deviceId ?? "machine-1")
  }));

  const settings = {
    shiftStart: input.settings?.shiftStart ?? defaultDb.settings.shiftStart,
    shiftEnd: input.settings?.shiftEnd ?? defaultDb.settings.shiftEnd,
    graceMinutes: Number.isFinite(input.settings?.graceMinutes)
      ? Number(input.settings?.graceMinutes)
      : defaultDb.settings.graceMinutes,
    autoPunchOut: input.settings?.autoPunchOut ?? defaultDb.settings.autoPunchOut,
    autoPunchOutTime: input.settings?.autoPunchOutTime ?? defaultDb.settings.autoPunchOutTime,
    workingDays:
      Array.isArray(input.settings?.workingDays) && input.settings?.workingDays.length > 0
        ? input.settings.workingDays.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        : defaultDb.settings.workingDays
  };

  return { employees, attendance, punchEvents, settings };
}
