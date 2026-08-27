# Band8

Band8 is a protocol-first, local-first IELTS personalized training runtime.

Core boundary:

- Band8 Runtime executes training and records evidence.
- External Codex Coach diagnoses the learner and compiles training packages.
- Band8 and the Coach communicate through the versioned Band8 Training Protocol (B8TP).
- Raw learning evidence and model inference remain separate.

Current stage:

Phase 1D — Local Web Product Shell + Learning Timezone.

The Node.js Runtime remains the sole authority for sessions, artifacts, Coach exchange, mission, reinforcement, and learning-day identity. The React/Vite web shell is a localhost presentation layer over `/api/v1/`; it does not derive domain truth. Learning timezone changes create immutable epochs without re-keying historical days.

Local development:

```powershell
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Run the built local product shell against an explicit Runtime workspace:

```powershell
npm run build
node dist/src/cli/index.js --workspace E:\path\to\band8-workspace serve
```

The server binds only to `127.0.0.1`, chooses a free port by default, and opens the fixed localhost URL. Use `--port 43127` to select a port or `--no-open` to suppress browser opening. Stop it with Ctrl+C. No global npm package publication is implied.

See [Phase 1A Runtime](docs/runtime/PHASE1A_RUNTIME.md) for local commands and storage guarantees.
See [Phase 1B1 Writing Coach Loop](docs/runtime/PHASE1B1_WRITING_COACH_LOOP.md) for the artifact, checkpoint, continuation, and trust boundaries.
See [Phase 1C Reinforcement Engine](docs/runtime/PHASE1C_REINFORCEMENT_ENGINE.md) for deterministic policy, persistence, open-loop mission, streak, reveal, and anti-reward-hacking guarantees.
See [Phase 1D Local Web Shell](docs/runtime/PHASE1D_LOCAL_WEB_SHELL.md) for local server, browser security, product projections, and browser test commands.
