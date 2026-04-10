# Trax Attendance Studio

A modern attendance system with:
- A mobile app for employee punch-in / punch-out
- A real-time HR/Admin web dashboard
- Monthly reports and Excel export
- Configurable office attendance rules

This repo is now open-source friendly and ready for contributors.

## Features

### Employee Mobile App (Expo React Native)
- One-time login with Employee ID + PIN
- Punch In / Punch Out
- Optional location capture for punch events
- Persistent session (no daily re-login)

### HR/Admin Dashboard (Web)
- Admin login + logout
- Employee management (add, edit, disable, delete)
- Daily tracking with manual correction
- Monthly reports with compact timeline UI
- Export report to Excel (`.xlsx`)
- Live updates via Socket.IO

### Attendance Rules
- Shift start/end
- Grace minutes
- Half-day threshold (example: after `10:15`)
- Minimum work minutes (example: `540` = 9 hours)
- Working-day configuration
- Auto punch-out option + time

## Tech Stack

- **Backend**: Node.js, Express, TypeScript, Socket.IO
- **Database**:
  - Local JSON (`backend/data/store.json`) for quick setup
  - Neon PostgreSQL (recommended for production)
- **Mobile**: Expo / React Native
- **Exports**: CSV + Excel (`exceljs`)

## Monorepo Structure

- `backend/` - API server + admin dashboard + export endpoints
- `mobile-app/` - Expo mobile app for employees
- `render.yaml` - Render deployment blueprint

## Quick Start (Local)

### 1) Start Backend

```bash
cd backend
npm install
npm run dev
```

Backend URL: [http://localhost:4000](http://localhost:4000)  
Dashboard URL: [http://localhost:4000/dashboard](http://localhost:4000/dashboard)

### 2) Start Mobile App

```bash
cd ../mobile-app
npm install
npm start
```

Set API URL in `mobile-app/.env`:

```env
EXPO_PUBLIC_API_URL=http://<YOUR-LAPTOP-IP>:4000
```

Use LAN IP so phone and laptop are on same Wi-Fi.

## Environment Variables

### Backend (`backend/.env`)

```env
PORT=4000
TIME_ZONE=Asia/Kolkata
CORS_ORIGIN=*
MACHINE_SECRET=trax-machine-secret
DATABASE_URL=
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin@123
DB_CACHE_TTL_MS=30000
```

Notes:
- Leave `DATABASE_URL` empty for local JSON mode.
- Set `DATABASE_URL` for Neon PostgreSQL mode.

## Default Credentials

### Admin Dashboard
- Username: `admin`
- Password: `admin@123`

### Seed Employees
- `EMP001 / 1111`
- `EMP002 / 2222`
- `EMP003 / 3333`

## Database Modes

### Local JSON Mode
- No DB needed
- Data stored in `backend/data/store.json`

### Neon PostgreSQL Mode (Production)
1. Create DB on [Neon](https://neon.tech)
2. Copy connection string
3. Set `DATABASE_URL` in backend environment
4. Start backend (schema auto-creates)
5. Optional seed:

```bash
cd backend
npm run seed
```

## API Highlights

### Auth
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/session`
- `GET /api/admin/profile`
- `PATCH /api/admin/profile`
- `POST /api/employees/login`

### Attendance
- `POST /api/attendance/check-in`
- `POST /api/attendance/check-out`
- `GET /api/attendance/today?date=YYYY-MM-DD`
- `GET /api/attendance/employee/:employeeId/today`

### Admin
- `GET /api/admin/employees`
- `POST /api/admin/employees`
- `PATCH /api/admin/employees/:employeeId`
- `DELETE /api/admin/employees/:employeeId`
- `GET /api/admin/workday-settings`
- `PUT /api/admin/workday-settings`
- `PATCH /api/admin/attendance/:employeeId`
- `POST /api/admin/attendance/auto-manage`
- `GET /api/admin/attendance/report?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/admin/attendance/export.xlsx?from=YYYY-MM-DD&to=YYYY-MM-DD`

### Legacy Machine Punch (Optional)
- `POST /api/punch-machine/events` with header `x-machine-secret`

## Deploy Backend (Render)

1. Push repository to GitHub
2. Create Render service from repo
3. Use root + `backend` as configured in Render settings
4. Set env vars (`DATABASE_URL`, `TIME_ZONE`, etc.)
5. Deploy

Example production URL:
- `https://trax-attendance-backend.onrender.com`
- Dashboard: `https://trax-attendance-backend.onrender.com/dashboard`

## Build Android App (EAS)

From `mobile-app/`:

```bash
npx eas login
npx eas build:configure
```

Set production API URL for mobile build:

```env
EXPO_PUBLIC_API_URL=https://trax-attendance-backend.onrender.com
```

Build APK (internal testing):

```bash
npx eas build --platform android --profile preview
```

Build AAB (Play Store):

```bash
npx eas build --platform android --profile production
```

## Performance Notes

Recent backend optimizations include:
- Read cache for DB fetches
- Indexed Postgres tables
- Diff-based row updates for faster save/edit

If latency still appears in production:
- Check Render region vs Neon region
- Ensure service is not in cold-start state
- Use a paid always-on plan for lower cold-start delay

## Contributing

Contributions are welcome.

1. Fork repository
2. Create branch
3. Make changes
4. Open pull request

Please include:
- Clear commit messages
- API/UI change notes
- Basic testing steps

## Security

For production, change default admin credentials immediately.

## License

Please add a `LICENSE` file (recommended: MIT) before public release.
