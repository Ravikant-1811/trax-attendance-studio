import { promises as fs } from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import type { JsonDatabase } from "./types.js";

const dataFilePath = path.resolve(process.cwd(), "data", "store.json");
const databaseUrl = process.env.DATABASE_URL?.trim();
const usePostgres = Boolean(databaseUrl);
const parsedCacheTtlMs = Number(process.env.DB_CACHE_TTL_MS ?? "30000");
const dbCacheTtlMs = Number.isFinite(parsedCacheTtlMs) && parsedCacheTtlMs > 0 ? parsedCacheTtlMs : 30000;

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
    halfDayAfter: "10:15",
    minimumWorkMinutes: 540,
    adminName: "HR Admin",
    adminUsername: "admin",
    adminPassword: "admin@123",
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
let dbCache: JsonDatabase | null = null;
let dbCacheExpiresAt = 0;

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

function cloneDb(db: JsonDatabase): JsonDatabase {
  return structuredClone(db);
}

function hasFreshCache(): boolean {
  return Boolean(dbCache && Date.now() < dbCacheExpiresAt);
}

function setDbCache(db: JsonDatabase): void {
  dbCache = cloneDb(db);
  dbCacheExpiresAt = Date.now() + dbCacheTtlMs;
}

function clearDbCache(): void {
  dbCache = null;
  dbCacheExpiresAt = 0;
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
    await client.query("CREATE INDEX IF NOT EXISTS idx_attendance_date_employee ON attendance(date, employee_id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, date);");

    await client.query(`
      CREATE TABLE IF NOT EXISTS punch_events (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        punched_at TIMESTAMPTZ NOT NULL,
        device_id TEXT NOT NULL
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_punch_events_punched_at ON punch_events(punched_at DESC);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_punch_events_employee_punched ON punch_events(employee_id, punched_at DESC);");

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SMALLINT PRIMARY KEY,
        shift_start TEXT NOT NULL,
        shift_end TEXT NOT NULL,
        grace_minutes INTEGER NOT NULL,
        auto_punch_out BOOLEAN NOT NULL,
        auto_punch_out_time TEXT NOT NULL,
        half_day_after TEXT NOT NULL DEFAULT '10:15',
        minimum_work_minutes INTEGER NOT NULL DEFAULT 540,
        admin_name TEXT NOT NULL DEFAULT 'HR Admin',
        admin_username TEXT NOT NULL DEFAULT 'admin',
        admin_password TEXT NOT NULL DEFAULT 'admin@123',
        working_days INTEGER[] NOT NULL
      );
    `);

    await client.query("ALTER TABLE settings ADD COLUMN IF NOT EXISTS half_day_after TEXT NOT NULL DEFAULT '10:15';");
    await client.query("ALTER TABLE settings ADD COLUMN IF NOT EXISTS minimum_work_minutes INTEGER NOT NULL DEFAULT 540;");
    await client.query("ALTER TABLE settings ADD COLUMN IF NOT EXISTS admin_name TEXT NOT NULL DEFAULT 'HR Admin';");
    await client.query("ALTER TABLE settings ADD COLUMN IF NOT EXISTS admin_username TEXT NOT NULL DEFAULT 'admin';");
    await client.query("ALTER TABLE settings ADD COLUMN IF NOT EXISTS admin_password TEXT NOT NULL DEFAULT 'admin@123';");

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
    half_day_after: string;
    minimum_work_minutes: number;
    admin_name: string;
    admin_username: string;
    admin_password: string;
    working_days: number[];
  }>(
    `
    SELECT shift_start, shift_end, grace_minutes, auto_punch_out, auto_punch_out_time, half_day_after, minimum_work_minutes, admin_name, admin_username, admin_password, working_days
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
          halfDayAfter: settingsRow.half_day_after,
          minimumWorkMinutes: settingsRow.minimum_work_minutes,
          adminName: settingsRow.admin_name,
          adminUsername: settingsRow.admin_username,
          adminPassword: settingsRow.admin_password,
          workingDays: settingsRow.working_days
        }
      : defaultDb.settings
  });
}

function shallowStableEqual<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function diffById<T extends { id: string }>(previousRows: T[], nextRows: T[]) {
  const previousMap = new Map(previousRows.map((row) => [row.id, row]));
  const nextMap = new Map(nextRows.map((row) => [row.id, row]));
  const upserts: T[] = [];
  const deletes: string[] = [];

  for (const [id, next] of nextMap.entries()) {
    const previous = previousMap.get(id);
    if (!previous || !shallowStableEqual(previous, next)) {
      upserts.push(next);
    }
  }

  for (const id of previousMap.keys()) {
    if (!nextMap.has(id)) {
      deletes.push(id);
    }
  }

  return { upserts, deletes };
}

async function writeDbToPostgres(client: PoolClient, previousDb: JsonDatabase, nextDb: JsonDatabase): Promise<void> {
  const employeeDiff = diffById(previousDb.employees, nextDb.employees);
  if (employeeDiff.deletes.length > 0) {
    await client.query("DELETE FROM employees WHERE id = ANY($1::text[]);", [employeeDiff.deletes]);
  }
  for (const employee of employeeDiff.upserts) {
    await client.query(
      `
      INSERT INTO employees (id, name, department, pin, active, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          department = EXCLUDED.department,
          pin = EXCLUDED.pin,
          active = EXCLUDED.active,
          created_at = EXCLUDED.created_at;
      `,
      [employee.id, employee.name, employee.department, employee.pin, employee.active, employee.createdAt]
    );
  }

  const attendanceDiff = diffById(previousDb.attendance, nextDb.attendance);
  if (attendanceDiff.deletes.length > 0) {
    await client.query("DELETE FROM attendance WHERE id = ANY($1::text[]);", [attendanceDiff.deletes]);
  }
  for (const record of attendanceDiff.upserts) {
    await client.query(
      `
      INSERT INTO attendance (
        id, employee_id, date, machine_punch_at, check_in_at, check_out_at, check_in_location, check_out_location, auto_managed, created_at, updated_at
      )
      VALUES ($1, $2, $3::date, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE
      SET employee_id = EXCLUDED.employee_id,
          date = EXCLUDED.date,
          machine_punch_at = EXCLUDED.machine_punch_at,
          check_in_at = EXCLUDED.check_in_at,
          check_out_at = EXCLUDED.check_out_at,
          check_in_location = EXCLUDED.check_in_location,
          check_out_location = EXCLUDED.check_out_location,
          auto_managed = EXCLUDED.auto_managed,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at;
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

  const punchEventDiff = diffById(previousDb.punchEvents, nextDb.punchEvents);
  if (punchEventDiff.deletes.length > 0) {
    await client.query("DELETE FROM punch_events WHERE id = ANY($1::text[]);", [punchEventDiff.deletes]);
  }
  for (const event of punchEventDiff.upserts) {
    await client.query(
      `
      INSERT INTO punch_events (id, employee_id, punched_at, device_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE
      SET employee_id = EXCLUDED.employee_id,
          punched_at = EXCLUDED.punched_at,
          device_id = EXCLUDED.device_id;
      `,
      [event.id, event.employeeId, event.punchedAt, event.deviceId]
    );
  }

  if (!shallowStableEqual(previousDb.settings, nextDb.settings)) {
    await client.query(
      `
      UPDATE settings
      SET shift_start = $1,
          shift_end = $2,
          grace_minutes = $3,
          auto_punch_out = $4,
          auto_punch_out_time = $5,
          half_day_after = $6,
          minimum_work_minutes = $7,
          admin_name = $8,
          admin_username = $9,
          admin_password = $10,
          working_days = $11
      WHERE id = 1;
      `,
      [
        nextDb.settings.shiftStart,
        nextDb.settings.shiftEnd,
        nextDb.settings.graceMinutes,
        nextDb.settings.autoPunchOut,
        nextDb.settings.autoPunchOutTime,
        nextDb.settings.halfDayAfter,
        nextDb.settings.minimumWorkMinutes,
        nextDb.settings.adminName,
        nextDb.settings.adminUsername,
        nextDb.settings.adminPassword,
        nextDb.settings.workingDays
      ]
    );
  }
}

export async function readDb(): Promise<JsonDatabase> {
  await ensureStorageReady();

  if (!usePostgres) {
    const raw = await fs.readFile(dataFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<JsonDatabase>;
    return normalizeDb(parsed);
  }

  if (hasFreshCache() && dbCache) {
    return cloneDb(dbCache);
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    const db = await readDbFromPostgres(client);
    setDbCache(db);
    return cloneDb(db);
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
    const previousDb = hasFreshCache() && dbCache ? cloneDb(dbCache) : await readDbFromPostgres(client);
    const db = normalizeDb(previousDb);
    const output = await mutator(db);
    const normalized = normalizeDb(db);
    await writeDbToPostgres(client, previousDb, normalized);
    await client.query("COMMIT");
    setDbCache(normalized);
    return output;
  } catch (error) {
    await client.query("ROLLBACK");
    clearDbCache();
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
    halfDayAfter: input.settings?.halfDayAfter ?? defaultDb.settings.halfDayAfter,
    minimumWorkMinutes: Number.isFinite(input.settings?.minimumWorkMinutes)
      ? Number(input.settings?.minimumWorkMinutes)
      : defaultDb.settings.minimumWorkMinutes,
    adminName: String(input.settings?.adminName ?? defaultDb.settings.adminName).trim() || defaultDb.settings.adminName,
    adminUsername:
      String(input.settings?.adminUsername ?? defaultDb.settings.adminUsername).trim() || defaultDb.settings.adminUsername,
    adminPassword:
      String(input.settings?.adminPassword ?? defaultDb.settings.adminPassword).trim() || defaultDb.settings.adminPassword,
    workingDays:
      Array.isArray(input.settings?.workingDays) && input.settings?.workingDays.length > 0
        ? input.settings.workingDays.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        : defaultDb.settings.workingDays
  };

  return { employees, attendance, punchEvents, settings };
}
