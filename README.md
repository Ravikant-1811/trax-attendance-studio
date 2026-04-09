# Office Attendance Tracker (Mobile + HR Dashboard)

This project gives you:
- Employee mobile app to **Punch In / Punch Out**.
- One-time login setup (employee stays signed in on phone).
- HR web command center with **real-time updates**.
- Employee add/manage from admin dashboard.
- HR daily auto-time rules (shift, grace, working days, auto punch-out).
- CSV export for attendance data.

## Project Structure

- `backend/`: Node.js API + real-time dashboard + data export
- `mobile-app/`: Expo React Native app for employees

## 1) Run Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Backend runs on: `http://localhost:4000`

HR dashboard: `http://localhost:4000/dashboard`

## 2) Run Mobile App

```bash
cd ../mobile-app
cp .env.example .env
npm install
npm start
```

Important: In `mobile-app/.env`, set:

```env
EXPO_PUBLIC_API_URL=http://<YOUR-LAPTOP-IP>:4000
```

Use your system IP (example `192.168.1.10`) so phone and laptop are on the same Wi-Fi.

## Default Employee Login

- `EMP001 / 1111`
- `EMP002 / 2222`
- `EMP003 / 3333`

You can edit these in `backend/data/store.json`.

## Attendance Flow

1. Employee opens app (first login is only once).
2. In morning, employee taps **Punch In**.
3. In evening, employee taps **Punch Out**.
4. HR dashboard updates live, marks late/early metrics, and can export CSV.
5. HR can auto-manage open attendance for a day from dashboard.

## Admin Features

- Add new employee
- Edit employee details (name, department, PIN)
- Enable/disable employee account
- Configure shift start/end
- Set grace minutes for late mark
- Select working days
- Enable automatic daily punch-out time
- Run manual auto-manage for selected date

## Optional Machine API (Not Required)

If you ever want biometric integration later, this endpoint is still available:

```bash
curl -X POST http://localhost:4000/api/punch-machine/events \
  -H "Content-Type: application/json" \
  -H "x-machine-secret: trax-machine-secret" \
  -d '{"employeeId":"EMP001","deviceId":"main-gate"}'
```

This is optional and not needed for the current app flow.

## Core APIs

- `POST /api/employees/login`
- `POST /api/attendance/check-in`
- `POST /api/attendance/check-out`
- `GET /api/attendance/today?date=YYYY-MM-DD`
- `GET /api/attendance/employee/:employeeId/today`
- `GET /api/attendance/export.csv?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/admin/employees`
- `POST /api/admin/employees`
- `PATCH /api/admin/employees/:employeeId`
- `GET /api/admin/workday-settings`
- `PUT /api/admin/workday-settings`
- `POST /api/admin/attendance/auto-manage`
- `POST /api/punch-machine/events` (optional legacy integration)

## Notes

- Data storage is JSON file (`backend/data/store.json`) for quick setup.
- For production, switch to PostgreSQL/MySQL and add proper auth tokens.
