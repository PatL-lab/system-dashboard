# AGENTS.md

## Overview

`sysinfo-web` is a small Node.js + Express single-page dashboard that displays real-time
**system information** for a Linux host, styled to look like the `htop` / `fastfetch`
terminal tools. It is **not a framework project** — it is plain Node with vanilla HTML/CSS/JS.

**Run:** `npm start` (or `node server.js`). Serves `http://localhost:3000` by default
(`PORT` env var overrides). Requires Linux and the CLI tools `fastfetch`, `journalctl`/`dmesg`,
`top`, and `ps`.

---

## Project Layout

```
server.js              # Express app: static serving + all backend data collection & APIs
public/
  index.html           # Page structure; element IDs consumed by app.js
  style.css            # All styling (GitHub-dark themed)
  app.js               # Frontend: fetches APIs, renders htop/fastfetch/logs panels
walkthrough.md         # Design/implementation notes & refinement history (context only)
package.json           # Dep: express ^4.21.0; script: start
```

---

## Architecture

- **Static serving:** `app.use(express.static('public'))`.
- **Command execution:** `runCommand(cmd, args, extraEnv)` wraps `child_process.spawn`
  in a Promise. Adds a 15s `timeout` (set as the native `timeout` option alongside `shell: false`, not a `stdio` trick),
  pipes stdout/stderr, and rejects on non-zero exit.
- **HTTP API (all `GET`, async):**
  - `GET /api/fastfetch` — runs `fastfetch --pipe false` with `TERM=xterm-256color`, converts
    ANSI escape codes to styled HTML via `ansiToHtml`.
  - `GET /api/logs` — collects warning+ logs: `journalctl -p warning` first, falling back to
    `dmesg -l warn,...` if empty. Returns `{source, level, message}` entries (capped at 100).
  - `GET /api/htop` — memory, system metrics, and process data (see below).
- **Frontend polling:** `app.js` polls `/api/fastfetch`, `/api/logs`, and `/api/htop` every
  15,000ms (`POLL_INTERVAL`).

---

## Key Details

### `ansiToHtml` (server)
Simulates a 2D terminal grid to accurately render ANSI cursor movements (`CUU`, `CUD`,
`CUF`, `CUB`, `CHA`, `CUP`), strips OSC sequences (such as OSC 8 hyperlinks), and emits
styled HTML `<span style="...">` tags supporting 16-color, 256-color, and 24-bit TrueColor
palettes along with bold and background colors. This ensures multi-column side-by-side
layouts like fastfetch render cleanly across different distributions (Parrot OS, Kali,
Debian, Ubuntu, RedHat, etc.).

### CPU sampling (`sampleCpu`, `getSystemMetrics`, `getMemoryData`)
Reads Linux procfs directly (`/proc/stat`, `/proc/meminfo`, `/proc/loadavg`, `/proc/uptime`).
- `sampleCpu` reads per-core `/proc/stat` deltas to compute per-core `%` usage. Primed with an
  initial sample at startup (`setTimeout(sampleCpu, 100)`) plus a `setInterval` every 1500ms.
- Memory math mirrors `htop`: `used = total - free - buffers - cached - SReclaimable + Shmem`.
- System metrics include load average, uptime formatting, and thread counts (`tasks`/`thr`/`kthr`).

### Process parsing (`getProcesses`, `mapProcessLine`)
Runs `top -b -n 2 -d 0.3 -w 512` (sampling the 2nd iteration for accurate delta-based CPU% instead of single-iteration startup spikes), falling back to `ps -eo ... --sort=-pcpu`. `mapProcessLine`
**dynamically discovers header names** (e.g. `PR`/`PRI`, `VSZ`/`VIRT`, `RSS`/`RES`, `%CPU`) so it
works across distros and custom `~/.toprc` configs. Returns `topCpu`, `topMem`, and `all` procs.

---

## Conventions & Gotchas

- **No build step, no tests, no lint config.** Add before scaling.
- **Terminal-dependent:** on a host missing `fastfetch`/`top`/`journalctl`, the relevant panels
  show error/placeholders. `getFastfetch` returns 500 if it fails; `getProcesses` silently falls
  back to `ps`.
- **HTML-in-JSON:** `fastfetch` output is JSON-encoded as an HTML string. Trustworthy only for
  the controlled fastfetch output; do not extend this pattern to untrusted data.
- **Procfs-only:** metrics assume Linux. Cross-platform changes would need abstraction.
- `runCommand` uses Node's native `timeout: 15000` option (a hard per-child-process limit, not a `stdio` trick) alongside `shell: false`. If you later need per-command limits, the `timeout` option is the right place — no workaround needed here.

---

## Common Tasks

| Task | How |
|------|-----|
| Start dev server | `npm start` |
| Add a new API endpoint | Add an `app.get('/api/...')` route in `server.js` + a `renderXxx` + `fetch` call in `app.js` |
| Change refresh rate | Edit `POLL_INTERVAL` in `public/app.js` (server samples independently) |
| Add a metric | Read from `/proc/...` in `server.js`, return from `/api/htop` (or a new endpoint), render in `renderHtop` |
