# Contributing Guide

Thanks for your interest in contributing to **Trax Attendance Studio**.

## Development Setup

1. Fork the repository and clone your fork.
2. Install backend dependencies:

```bash
cd backend
npm install
```

3. Install mobile app dependencies:

```bash
cd ../mobile-app
npm install
```

4. Run backend:

```bash
cd ../backend
npm run dev
```

5. Run mobile app:

```bash
cd ../mobile-app
npm start
```

## Branching

- Create a feature/fix branch from `main`.
- Keep branch names descriptive (example: `feat/report-export-xlsx`, `fix/admin-login`).

## Commit Messages

Use clear, scoped commit messages:
- `feat(report): add monthly excel export`
- `fix(auth): handle session expiry`
- `docs: update setup instructions`

## Pull Request Checklist

Before opening a PR, please ensure:

- [ ] Code builds successfully.
- [ ] Existing behavior is not broken.
- [ ] New UI changes are responsive (desktop + mobile where applicable).
- [ ] API changes are documented in `README.md`.
- [ ] PR description includes:
  - What changed
  - Why it changed
  - How to test

## Code Style

- Keep changes focused and minimal.
- Prefer readable code over clever code.
- Avoid unrelated refactors in the same PR.
- Do not commit secrets, keys, or credentials.

## Reporting Issues

When creating an issue, include:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots/logs if available
- Environment (local/Render, mobile/web)

## Security

If you discover a security issue, please do not post sensitive details publicly.
Open a private report to the project maintainer.

Thank you for helping improve Trax Attendance Studio.
