# HeliosGen Web Trial

> Experimental browser-hosted mode for the existing single-owner HeliosGen app.
> This is not an upstream-supported multi-user SaaS deployment.

The desktop build remains the primary supported distribution. This branch adds
an optional Node web server so the Next.js application can be tested in a
browser without the Tauri shell.

## Important design limits

- The application currently uses one implicit guest workspace. HTTP Basic Auth
  protects the whole app; it does not create separate user accounts.
- SQLite and generated media are stored on the server filesystem. A hosted
  environment must provide a persistent writable disk and a single app instance
  if you want data to survive restarts. Ephemeral filesystems will lose data.
- Do not run multiple replicas against the same SQLite database.
- The public GitHub repository contains source code only. Never commit API keys,
  passwords, database files, generated media, or private user data.
- Hosting the repository publicly does not make the running app safe to expose
  without authentication. The web server refuses to start if credentials are
  missing.
- The health endpoint `/healthz` is intentionally unauthenticated for platform
  health checks. All other requests, including API routes and generated media,
  require Basic Auth.
- Use HTTPS at the hosting provider. Do not send Basic Auth credentials over a
  public, unencrypted HTTP connection.

## Local browser test

Requirements: Node.js 22.13 or newer (the app uses Node's built-in
`node:sqlite` module).

```bash
corepack enable
pnpm install
pnpm build
```

Set credentials and start the web server:

**PowerShell**
```powershell
$env:HELIOS_WEB_USER = "owner"
$env:HELIOS_WEB_PASSWORD = "use-a-long-unique-password"
$env:HELIOS_DATA_DIR = "$PWD/data"
$env:HELIOS_MEDIA_DIR = "$PWD/public/generated"
pnpm start:web
```

**macOS / Linux**
```bash
HELIOS_WEB_USER=owner \
HELIOS_WEB_PASSWORD='use-a-long-unique-password' \
HELIOS_DATA_DIR="$PWD/data" \
HELIOS_MEDIA_DIR="$PWD/public/generated" \
pnpm start:web
```

Open http://localhost:3000 and enter the credentials when prompted. The
`/healthz` endpoint returns `ok` without authentication.

## API keys

Enter your Kie.ai (and optional Azure) key in the app's Settings screen. The
existing guest-mode implementation stores settings in the server-side SQLite
database. Treat that database as sensitive. Do not commit or share it.

## Current trial scope

This branch adds the authenticated web server entry point and documents the
single-workspace storage assumptions. It does not claim that every desktop
integration has been validated in a hosted browser environment. In particular,
test file uploads, video processing, generation status recovery, and all model
providers before relying on it.
