# FEMS

FEMS is a full-stack forestry management platform with:

- NestJS backend in [fems-backend/](./fems-backend)
- Expo + React Native mobile app in [fems-mobile/](./fems-mobile)
- MySQL database supplied by XAMPP

This repository is not just a UI mockup: the backend, Prisma schema, permissions, payments, GIS, inspections, AI, and mobile app are all wired together.

## Prerequisites

Before you start, install:

- Node.js 20 LTS or newer
- npm
- XAMPP with Apache and MySQL
- Git
- Optional: Android Studio or Xcode if you want to run the mobile app on a simulator/device

## 1) Database setup with XAMPP

This project can use the MySQL server included with XAMPP. Docker is not required.

1. Open the XAMPP Control Panel.
2. Start **MySQL**. Apache is only required if you want to use phpMyAdmin.
3. Open `http://localhost/phpmyadmin`.
4. Create a database named `fems` using the `utf8mb4` character set and `utf8mb4_unicode_ci` collation.

You can also create it from the phpMyAdmin SQL tab:

```sql
CREATE DATABASE fems
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

Then create the backend environment file:

```bash
copy fems-backend\.env.example fems-backend\.env
```

Edit [fems-backend/.env](./fems-backend/.env) and set at least:

```env
DATABASE_URL="mysql://fems:fems@127.0.0.1:3306/fems"
JWT_SECRET="replace-with-a-long-random-secret"
JWT_REFRESH_SECRET="replace-with-a-different-long-random-secret"
PAYMENT_PROVIDER="simulator"
```

The default XAMPP database config is:

- database: `fems`
- user: `root`
- password: empty
- port: `3306`

If you configured a MySQL root password in XAMPP, update `DATABASE_URL` with that password.

If your migration error says `Access denied for user 'fems'`, your `.env` still
contains the old Docker credentials. Open the file and replace its
`DATABASE_URL` line:

```powershell
notepad fems-backend\.env
```

Use this for the default XAMPP installation:

```env
DATABASE_URL="mysql://root:@127.0.0.1:3306/fems"
```

If PowerShell has an old `DATABASE_URL` value in the current terminal, it takes
priority over `.env`. Clear it before running the migration:


```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
```

Run Prisma migrations after MySQL is running and the database exists:

```bash
npm --prefix fems-backend run db:migrate
```

Optionally seed demo data:

```bash
npm --prefix fems-backend run db:seed
```

The first time you use a fresh database, start the API once before seeding.
The API synchronises the RBAC catalogue and creates the system roles required
by the demo seed:

```bash
npm --prefix fems-backend run start:dev
```

Wait until the API reports that the RBAC catalogue was synchronised, stop it
with `Ctrl+C`, and then run:

```bash
npm --prefix fems-backend run db:seed
```

To stop the database, stop **MySQL** in the XAMPP Control Panel.

## 2) Backend setup

### Backend environment file

The backend reads configuration from `fems-backend/.env`. Create it from the
example file:

```powershell
Copy-Item fems-backend\.env.example fems-backend\.env
```

For XAMPP's default MySQL configuration, make sure this line is present:

```env
DATABASE_URL="mysql://root:@127.0.0.1:3306/fems"
```

If you set a password for the XAMPP MySQL `root` user, include it after
`root:`. If MySQL is running on another port, update `3306` as well.

The remaining local values can stay as shown in
[fems-backend/.env.example](./fems-backend/.env.example). At minimum, use
development-only values for `JWT_SECRET`, `JWT_REFRESH_SECRET`, and set
`PAYMENT_PROVIDER=simulator`. Do not commit `.env` files or real credentials.

Install dependencies:

```bash
cd C:\Users\greys\Documents\GitHub\FEMS
npm --prefix fems-backend install
```

Generate Prisma client:

```bash
npm --prefix fems-backend run prisma:generate
```

Start the backend:

```bash
npm --prefix fems-backend run start:dev
```

The backend runs at:

```text
http://localhost:3000
http://localhost:3000/api/v1
```

Useful backend commands:

```bash
npm --prefix fems-backend run build
npm --prefix fems-backend run test
npm --prefix fems-backend run test:e2e
npm --prefix fems-backend run db:seed
```

## 3) Frontend setup

Install the mobile app dependencies:

```bash
cd C:\Users\greys\Documents\GitHub\FEMS
npm --prefix fems-mobile install
```

Set the API URL if needed:

```powershell
$env:EXPO_PUBLIC_API_URL = "http://127.0.0.1:3000/api/v1"
```

Start Expo:

```bash
npm --prefix fems-mobile run start
```

For browser preview:

```bash
npm --prefix fems-mobile run web
```

The mobile app defaults to the backend at `http://127.0.0.1:3000/api/v1` in local development, as configured in [fems-mobile/src/api/config.ts](./fems-mobile/src/api/config.ts).

## Full local setup with XAMPP

From the repo root:

```bash
npm run setup
npm --prefix fems-backend run prisma:generate
npm run db:migrate
npm run backend:dev
npm run mobile:start
```

## Common commands

```bash
npm run setup
npm run db:migrate
npm run db:seed
npm run backend:dev
npm run backend:test
npm run mobile:start
npm run mobile:web
npm run mobile:typecheck
```

## Project structure

```text
FEMS/
├── README.md
├── fems-backend/      # NestJS API, Prisma schema, migrations, business logic
├── fems-mobile/       # Expo React Native app
└── package.json       # root convenience scripts
```

## Troubleshooting

### MySQL is not running

Start MySQL in the XAMPP Control Panel. If it does not start, check whether
another MySQL or MariaDB service is already using port `3306`.

If XAMPP uses a different port, update the port in `DATABASE_URL`.

### Prisma client errors

```bash
npm --prefix fems-backend run prisma:generate
```

### Database migration problems

Check the connection string in [fems-backend/.env](./fems-backend/.env) and confirm MySQL is running.

### Mobile app cannot reach the backend

Make sure the backend is running on port 3000 and that `EXPO_PUBLIC_API_URL` points to the same machine or LAN address.

## Notes

- Do not commit secrets to source control.
- The backend expects environment variables from [fems-backend/.env.example](./fems-backend/.env.example).
- Payment integrations default to a simulator in local development unless you configure Campay credentials.
- Docker is optional; the documented local database setup uses XAMPP MySQL.
