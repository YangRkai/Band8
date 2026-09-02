# Band8 Quick Start

This guide starts from a clean clone and uses only repository-declared dependencies and synthetic training content.

## Requirements

The `v0.1.0-alpha.1` release candidate is verified with:

- Node.js 20.x;
- npm 10.x (`package.json` records npm 10.8.2 as the reference package manager);
- Python 3.11 or 3.12 (CI uses 3.11; the Linux clean-clone gate also covers 3.12);
- a Chromium-family browser for the browser flow and E2E suite.

Python is used only for the protocol reference validator and RFC 8785 parity oracle. Its pinned dependency is declared in `requirements-protocol.txt`.

## Install from a clean clone

Clone the repository, enter its `Band8` directory, then install Node dependencies:

```text
npm ci
```

Create an isolated Python environment.

Windows PowerShell:

```text
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-protocol.txt
```

Linux:

```text
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-protocol.txt
```

## Verify the clone

Use the Python executable from the environment above for the two protocol commands, then run the unified Node verification and browser suite:

```text
python tests/protocol/validate_protocol.py all .
python -m unittest discover -s tests/protocol -p "test_*.py" -v
npm run verify:release
npm run test:e2e
```

On Linux, replace `python` in the two commands with `.venv/bin/python`. On Windows, replace it with `.venv\Scripts\python.exe`. The unified command intentionally uses `python`; run it after activating the environment or when the declared dependency is installed in the selected Python interpreter.

## Run the local Web Shell

Build the Runtime and local assets:

```text
npm run build
```

Create a local workspace with a stable learning timezone and import the repository's generated Reading fixture:

```text
node dist/src/cli/index.js --workspace .tmp/band8-quickstart timezone set UTC
node dist/src/cli/index.js --workspace .tmp/band8-quickstart import tests/runtime/fixtures/reading-golden/training-package.json --protected tests/runtime/fixtures/reading-golden/protected-evaluation.json
node dist/src/cli/index.js --workspace .tmp/band8-quickstart serve
```

The final command prints and opens an `http://127.0.0.1:<port>` URL. Add `--no-open` when browser opening should be manual. Stop the process with Ctrl+C. Restarting with the same workspace preserves timezone, sessions, history, artifacts, and exactly-once reinforcement state.

The local server is not a LAN or Internet server. Do not proxy or expose it publicly.

## CLI checks

```text
node dist/src/cli/index.js --version
node dist/src/cli/index.js --help
```

This repository is not prepared for npm registry publication; do not use a global npm installation command.

## External Coach

Writing review remains a manual external workflow. Export the current checkpoint from the Coach page, provide the data-only bundle to the external Coach, and explicitly import the returned continuation package. Band8 does not contact a Coach API automatically.

For the trust model, continue with [Phase 1D Local Web Shell](runtime/PHASE1D_LOCAL_WEB_SHELL.md) and [Coach input trust](../protocol/COACH_INPUT_TRUST.md).
