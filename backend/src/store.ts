import { promises as fs } from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import type { JsonDatabase } from "./types.js";

const dataFilePath = path.resolve(process.cwd(), "data", "store.json");
const databaseUrl = process.env.DATABASE_URL?.trim();
const usePostgres = Boolean(databaseUrl);

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

const pgPool = usePostgres
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl?.includes("localhost") ? undefined : { rejectUnauthorized: false }
    })
  : null;

let writeQueue: Promise<void> = Promise.resolve();
let initPromise: Promise<void> | null = null;

function getPool(): Pool {
  if (!pgPool) {
    throw new Error("DATABASE_URL is not configured");
  }
  return pgPool;
}

function toIso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

async function ensureStorageReady(): Promise<void> {
  if (!usePostgres) {
    await ensureDataFile();
    return;
  }

  if (!initPromise) {
    initPromise = ensurePostgresSchema();
  }

  await initPromise;
}

async function ensureDataFile() {
  try {
    await fs.access(dataFilePath);
  } catch {
    await fs.mkdir(path.dirname(dataFilePath), { recursive: true });
    await fs.writeFile(dataFilePath, JSON.stringify(defaultDb, null, 2), "utf8");
  }
}

async function ensurePostgresSchema(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        department TEXT NOT NULL,
        pin TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        date DATE NOT NULL,
        machine_punch_at TIMESTAMPTZ NULL,
        check_in_at TIMESTAMPTZ NOT NULL,
        check_out_at TIMESTAMPTZ NULL,
        check_in_location JSONB NULL,
        check_out_location JSONB NULL,
        auto_managed BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
    `);

    await client.query("ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_location JSONB NULL;");
    await client.query("ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out_location JSONB NULL;");

    await client.query(`
      CREATE TABLE IF NOT EXISTS punch_events (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        punched_at TIMESTAMPTZ NOT NULL,
        device_id TEXT NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SMALLINT PRIMARY KEY,
        shift_start TEXT NOT NULL,
        shift_end TEXT NOT NULL,
        grace_minutes INTEGER NOT NULL,
        auto_punch_out BOOLEAN NOT NULL,
        auto_punch_out_time TEXT NOT NULL,
        working_days INTEGER[] NOT NULL
      );
    `);

    await client.query(
      `
      INSERT INTO settings (id, shift_start, shift_end, grace_minutes, auto_punch_out, auto_punch_out_time, working_days)
      VALUES (1, $1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO NOTHING;
      `,
      [
        defaultDb.settings.shiftStart,
        defaultDb.settings.shiftEnd,
        defaultDb.settings.graceMinutes,
        defaultDb.settings.autoPunchOut,
        defaultDb.settings.autoPunchOutTime,
        defaultDb.settings.workingDays
      ]
    );

    const employeeCountResult = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM employees");
    const employeeCount = Number(employeeCountResult.rows[0]?.count ?? "0");

    if (employeeCount === 0) {
      for (const employee of defaultDb.employees) {
        await client.query(
          `
          INSERT INTO employees (id, name, department, pin, active, created_at)
          VALUES ($1, $2, $3, $4, $5, $6);
          `,
          [employee.id, employee.name, employee.department, employee.pin, employee.active, employee.createdAt]
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function readDbFromPostgres(client: PoolClient): Promise<JsonDatabase> {
  const employeesResult = await client.query<{
    id: string;
    name: string;
    department: string;
    pin: string;
    active: boolean;
    created_at: Date;
  }>("SELECT id, name, department, pin, active, created_at FROM employees ORDER BY id ASC");

  const attendanceResult = await client.query<{
    id: string;
    employee_id: string;
    date: string;
    machine_punch_at: Date | null;
    check_in_at: Date;
    check_out_at: Date | null;
    check_in_location: { latitude?: number; longitude?: number } | null;
    check_out_location: { latitude?: number; longitude?: number } | null;
    auto_managed: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `
    SELECT id, employee_id, date::text, machine_punch_at, check_in_at, check_out_at, check_in_location, check_out_location, auto_managed, created_at, updated_at
    FROM attendance
    ORDER BY date ASC, employee_id ASC;
    `
  );

  const punchEventsResult = await client.query<{
    id: string;
    employee_id: string;
    punched_at: Date;
    device_id: string;
  }>("SELECT id, employee_id, punched_at, device_id FROM punch_events ORDER BY punched_at ASC");

  const settingsResult = await client.query<{
    shift_start: string;
    shift_end: string;
    grace_minutes: number;
    auto_punch_out: boolean;
    auto_punch_out_time: string;
    working_days: number[];
  }>(
    `
    SELECT shift_start, shift_end, grace_minutes, auto_punch_out, auto_punch_out_time, working_days
    FROM settings
    WHERE id = 1;
    `
  );

  const settingsRow = settingsResult.rows[0];

  return normalizeDb({
    employees: employeesResult.rows.map((employee) => ({
      id: employee.id,
      name: employee.name,
      department: employee.department,
      pin: employee.pin,
      active: employee.active,
      createdAt: toIso(employee.created_at) ?? createdAtSeed
    })),
    attendance: attendanceResult.rows.map((record) => ({
      id: record.id,
      employeeId: record.employee_id,
      date: record.date,
      machinePunchAt: toIso(record.machine_punch_at),
      checkInAt: toIso(record.check_in_at) ?? createdAtSeed,
      checkOutAt: toIso(record.check_out_at),
      checkInLocation:
        typeof record.check_in_location?.latitude === "number" && typeof record.check_in_location?.longitude === "number"
          ? {
              latitude: Number(record.check_in_location.latitude),
              longitude: Number(record.check_in_location.longitude)
            }
          : null,
      checkOutLocation:
        typeof record.check_out_location?.latitude === "number" && typeof record.check_out_location?.longitude === "number"
          ? {
              latitude: Number(record.check_out_location.latitude),
              longitude: Number(record.check_out_location.longitude)
            }
          : null,
      autoManaged: record.auto_managed,
      createdAt: toIso(record.created_at) ?? createdAtSeed,
      updatedAt: toIso(record.updated_at) ?? createdAtSeed
    })),
    punchEvents: punchEventsResult.rows.map((event) => ({
      id: event.id,
      employeeId: event.employee_id,
      punchedAt: toIso(event.punched_at) ?? createdAtSeed,
      deviceId: event.device_id
    })),
    settings: settingsRow
      ? {
          shiftStart: settingsRow.shift_start,
          shiftEnd: settingsRow.shift_end,
          graceMinutes: settingsRow.grace_minutes,
          autoPunchOut: settingsRow.auto_punch_out,
          autoPunchOutTime: settingsRow.auto_punch_out_time,
          workingDays: settingsRow.working_days
        }
      : defaultDb.settings
  });
}

async function writeDbToPostgres(client: PoolClient, db: JsonDatabase): Promise<void> {
  await client.query("DELETE FROM attendance;");
  await client.query("DELETE FROM punch_events;");
  await client.query("DELETE FROM employees;");

  for (const employee of db.employees) {
    await client.query(
      `
      INSERT INTO employees (id, name, department, pin, active, created_at)
      VALUES ($1, $2, $3, $4, $5, $6);
      `,
      [employee.id, employee.name, employee.department, employee.pin, employee.active, employee.createdAt]
    );
  }

  for (const record of db.attendance) {
    await client.query(
      `
      INSERT INTO attendance (
        id, employee_id, date, machine_punch_at, check_in_at, check_out_at, check_in_location, check_out_location, auto_managed, created_at, updated_at
      )
      VALUES ($1, $2, $3::date, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11);
      `,
      [
        record.id,
        record.employeeId,
        record.date,
        record.machinePunchAt,
        record.checkInAt,
        record.checkOutAt,
        record.checkInLocation ? JSON.stringify(record.checkInLocation) : null,
        record.checkOutLocation ? JSON.stringify(record.checkOutLocation) : null,
        record.autoManaged,
        record.createdAt,
        record.updatedAt
      ]
    );
  }

  for (const event of db.punchEvents) {
    await client.query(
      `
      INSERT INTO punch_events (id, employee_id, punched_at, device_id)
      VALUES ($1, $2, $3, $4);
      `,
      [event.id, event.employeeId, event.punchedAt, event.deviceId]
    );
  }

  await client.query(
    `
    UPDATE settings
    SET shift_start = $1,
        shift_end = $2,
        grace_minutes = $3,
        auto_punch_out = $4,
        auto_punch_out_time = $5,
        working_days = $6
    WHERE id = 1;
    `,
    [
      db.settings.shiftStart,
      db.settings.shiftEnd,
      db.settings.graceMinutes,
      db.settings.autoPunchOut,
      db.settings.autoPunchOutTime,
      db.settings.workingDays
    ]
  );
}

export async function readDb(): Promise<JsonDatabase> {
  await ensureStorageReady();

  if (!usePostgres) {
    const raw = await fs.readFile(dataFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<JsonDatabase>;
    return normalizeDb(parsed);
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    return await readDbFromPostgres(client);
  } finally {
    client.release();
  }
}

async function writeDbFile(db: JsonDatabase): Promise<void> {
  await fs.writeFile(dataFilePath, JSON.stringify(db, null, 2), "utf8");
}

export async function mutateDb<T>(mutator: (db: JsonDatabase) => T | Promise<T>): Promise<T> {
  await ensureStorageReady();

  if (!usePostgres) {
    let output!: T;

    writeQueue = writeQueue.then(async () => {
      const db = await readDb();
      output = await mutator(db);
      await writeDbFile(db);
    });

    await writeQueue;
    return output;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const db = await readDbFromPostgres(client);
    const output = await mutator(db);
    await writeDbToPostgres(client, normalizeDb(db));
    await client.query("COMMIT");
    return output;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function getDataFilePath(): string {
  if (usePostgres) {
    return "neon-postgres";
  }
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
    checkInLocation:
      record.checkInLocation &&
      Number.isFinite(record.checkInLocation.latitude) &&
      Number.isFinite(record.checkInLocation.longitude)
        ? {
            latitude: Number(record.checkInLocation.latitude),
            longitude: Number(record.checkInLocation.longitude)
          }
        : null,
    checkOutLocation:
      record.checkOutLocation &&
      Number.isFinite(record.checkOutLocation.latitude) &&
      Number.isFinite(record.checkOutLocation.longitude)
        ? {
            latitude: Number(record.checkOutLocation.latitude),
            longitude: Number(record.checkOutLocation.longitude)
          }
        : null,
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
