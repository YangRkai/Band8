# Phase 1D Local Web Shell

Phase 1D adds a local React/Vite product shell without moving authority out of the Node.js Runtime. The browser consumes learner-safe DTOs through `/api/v1/`; HTTP handlers validate transport input and delegate to existing Runtime APIs.

## Learning timezone

Runtime settings persist an IANA `learning_timezone` and append immutable timezone epochs. A learning-day identity combines `timezone_epoch_id` with the local calendar date at evidence time. Existing day records are never re-keyed. A timezone change starts a new current-streak epoch while preserving best streak, total effective days, and historical achievements.

## Local server

Build and serve:

```powershell
npm run build
node dist/src/cli/index.js --workspace E:\path\to\workspace serve --no-open
```

The server:

- binds `127.0.0.1` only and chooses a free port unless `--port` is provided;
- serves only built local assets and `/api/v1/` DTOs;
- rejects mutating requests without exact Host, Origin, JSON content type, and the startup-scoped local session token;
- applies route-specific JSON limits (4 KiB settings, 16 KiB session/export controls, 1 MiB learner responses, and 4 MiB package/continuation imports) and stable safe error DTOs;
- exposes no arbitrary path, URL-fetch, shell, or dynamic-code endpoint;
- emits no wildcard CORS and loads no external fonts, scripts, images, or APIs.

## Product areas

The primary navigation is Today, Train, Progress, History, and Coach. Settings is secondary. Train renders only `INSTRUCTION`, `PRESENT_TEXT`, `SELECT`, and `TEXT_RESPONSE`; all content remains escaped plain text. Coach bundle export and continuation validation remain Runtime operations.

The Runtime turns its Phase 1B outbox references into a hash-verified, self-contained `band8_coach_download` DTO for browser download. The browser does not assemble or validate Coach evidence. Settings is the one intentionally scoped API surface that shows the active Runtime workspace path, because Phase 1D explicitly requires a local data-location entry; no endpoint accepts a path or reads an arbitrary path supplied by the browser.

## Verification

```powershell
npm run test:server
npm run test:web
npm run test:e2e
npm run typecheck
npm run build
```

`npm run test:e2e` performs the complete Reading and Writing browser dogfood, security and viewport checks, then starts a second server process on the same synthetic workspace to verify restart persistence and exactly-once projections.
