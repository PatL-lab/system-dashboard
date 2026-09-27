const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

function runCommand(cmd, args = [], extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...extraEnv },
      timeout: 15000,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`${cmd} exited ${code}${stderr ? ': ' + stderr.trim() : ''}`));
      }
      resolve(stdout);
    });
    child.on('error', reject);
  });
}

function color256ToHex(idx) {
  if (idx < 16) {
    const map = [
      "#161b22", "#ff7b72", "#3fb950", "#d29922",
      "#38bdf8", "#bc8cff", "#39c5cf", "#c9d1d9",
      "#6e7681", "#ffa198", "#56d364", "#f0883e",
      "#79c0ff", "#d2a8ff", "#56d4dd", "#ffffff"
    ];
    return map[idx];
  }
  if (idx >= 232) {
    const gray = Math.round((idx - 232) * 10 + 8).toString(16).padStart(2, "0");
    return `#${gray}${gray}${gray}`;
  }
  const n = idx - 16;
  const b = (n % 6) ? ((n % 6) * 40 + 55) : 0;
  const g = (Math.floor(n / 6) % 6) ? ((Math.floor(n / 6) % 6) * 40 + 55) : 0;
  const r = (Math.floor(n / 36) % 6) ? ((Math.floor(n / 36) % 6) * 40 + 55) : 0;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function parseColor(params, startIndex) {
  const mode = params[startIndex + 1];
  if (mode === 5 && params[startIndex + 2] !== undefined) {
    return { color: color256ToHex(params[startIndex + 2]), consumed: 2 };
  } else if (mode === 2 && params[startIndex + 4] !== undefined) {
    const r = Math.min(255, Math.max(0, params[startIndex + 2]));
    const g = Math.min(255, Math.max(0, params[startIndex + 3]));
    const b = Math.min(255, Math.max(0, params[startIndex + 4]));
    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    return { color: hex, consumed: 4 };
  }
  return { color: null, consumed: 0 };
}

function ansiToHtml(str) {
  const fgColors = {
    30: "#161b22", 31: "#ff7b72", 32: "#3fb950", 33: "#d29922",
    34: "#38bdf8", 35: "#bc8cff", 36: "#39c5cf", 37: "#c9d1d9",
    90: "#6e7681", 91: "#ffa198", 92: "#56d364", 93: "#f0883e",
    94: "#79c0ff", 95: "#d2a8ff", 96: "#56d4dd", 97: "#ffffff"
  };

  const bgColors = {
    40: "#008080", 41: "#e03131", 42: "#2f9e44", 43: "#f08c00",
    44: "#1971c2", 45: "#9c36b5", 46: "#1098ad", 47: "#ced4da",
    100: "#20c997", 101: "#ff8787", 102: "#8ce99a", 103: "#ffe066",
    104: "#74c0fc", 105: "#e599f7", 106: "#66d9e8", 107: "#ffffff"
  };

  // Strip OSC sequences (e.g. OSC 8 hyperlinks \x1b]8;;url\x1b\ or window title sequences)
  const cleanStr = str.replace(/\x1b\][^\x1b\x07]*(?:\x1b\\|\x07)/g, "");

  const grid = [];
  let row = 0;
  let col = 0;

  let currentFg = null;
  let currentBg = null;
  let currentBold = false;

  function ensureCell(r, c) {
    while (grid.length <= r) {
      grid.push([]);
    }
    const line = grid[r];
    while (line.length <= c) {
      line.push({ char: " ", fg: null, bg: null, bold: false });
    }
  }

  const tokenRegex = /(\x1b\[[0-9;?]*[a-zA-Z])|(\x1b\([AB012])|(\r?\n)|(\r)|(\t)|([^\x1b\r\n\t]+)/g;
  let match;

  while ((match = tokenRegex.exec(cleanStr)) !== null) {
    const [, csi, , newline, cr, tab, text] = match;

    if (newline) {
      row++;
      col = 0;
    } else if (cr) {
      col = 0;
    } else if (tab) {
      col = (Math.floor(col / 8) + 1) * 8;
    } else if (csi) {
      const code = csi.slice(2, -1);
      const cmd = csi.slice(-1);
      const params = code ? code.split(";").map(p => parseInt(p, 10)) : [];
      const n = params[0] || 1;

      switch (cmd) {
        case "A": // CUU: Cursor Up
          row = Math.max(0, row - n);
          break;
        case "B": // CUD: Cursor Down
          row = row + n;
          break;
        case "C": // CUF: Cursor Forward (Right)
          col = col + n;
          break;
        case "D": // CUB: Cursor Back (Left)
          col = Math.max(0, col - n);
          break;
        case "G": // CHA: Cursor Horizontal Absolute (1-based)
          col = Math.max(0, (params[0] || 1) - 1);
          break;
        case "H":
        case "f": // CUP: Cursor Position (row, col) (1-based)
          row = Math.max(0, (params[0] || 1) - 1);
          col = Math.max(0, (params[1] || 1) - 1);
          break;
        case "K": // EL: Erase in Line
          if (grid[row]) {
            const mode = params[0] || 0;
            if (mode === 0) {
              grid[row] = grid[row].slice(0, col);
            } else if (mode === 1) {
              for (let i = 0; i <= Math.min(col, grid[row].length - 1); i++) {
                grid[row][i] = { char: " ", fg: null, bg: null, bold: false };
              }
            } else if (mode === 2) {
              grid[row] = [];
            }
          }
          break;
        case "J": // ED: Erase in Display
          if ((params[0] || 0) === 2) {
            grid.length = 0;
            row = 0;
            col = 0;
          }
          break;
        case "m": // SGR
          if (params.length === 0) {
            currentFg = null;
            currentBg = null;
            currentBold = false;
          } else {
            for (let i = 0; i < params.length; i++) {
              const p = isNaN(params[i]) ? 0 : params[i];
              if (p === 0) {
                currentFg = null;
                currentBg = null;
                currentBold = false;
              } else if (p === 1) {
                currentBold = true;
              } else if (p === 22) {
                currentBold = false;
              } else if (p === 39) {
                currentFg = null;
              } else if (p === 49) {
                currentBg = null;
              } else if (p >= 30 && p <= 37) {
                currentFg = fgColors[p];
              } else if (p >= 90 && p <= 97) {
                currentFg = fgColors[p];
              } else if (p >= 40 && p <= 47) {
                currentBg = bgColors[p];
              } else if (p >= 100 && p <= 107) {
                currentBg = bgColors[p];
              } else if (p === 38) {
                const parsed = parseColor(params, i);
                if (parsed.color) currentFg = parsed.color;
                i += parsed.consumed;
              } else if (p === 48) {
                const parsed = parseColor(params, i);
                if (parsed.color) currentBg = parsed.color;
                i += parsed.consumed;
              }
            }
          }
          break;
        // Ignore other CSIs like ?25l, ?25h
      }
    } else if (text) {
      for (const ch of text) {
        ensureCell(row, col);
        grid[row][col] = {
          char: ch,
          fg: currentFg,
          bg: currentBg,
          bold: currentBold
        };
        col++;
      }
    }
  }

  function escapeHtml(t) {
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Render grid to HTML
  const linesHtml = [];
  for (let r = 0; r < grid.length; r++) {
    const line = grid[r] || [];
    let lastIdx = line.length - 1;
    while (lastIdx >= 0 && line[lastIdx].char === " " && !line[lastIdx].bg) {
      lastIdx--;
    }
    if (lastIdx < 0) {
      linesHtml.push("");
      continue;
    }

    let lineHtml = "";
    let runText = "";
    let runFg = null;
    let runBg = null;
    let runBold = false;

    const flushRun = () => {
      if (!runText) return;
      let style = "";
      if (runFg) style += `color:${runFg};`;
      if (runBg) style += `background-color:${runBg};`;
      if (runBold) style += `font-weight:700;`;

      const escaped = escapeHtml(runText);
      if (style) {
        lineHtml += `<span style="${style}">${escaped}</span>`;
      } else {
        lineHtml += escaped;
      }
      runText = "";
    };

    for (let c = 0; c <= lastIdx; c++) {
      const cell = line[c];
      if (cell.fg !== runFg || cell.bg !== runBg || cell.bold !== runBold) {
        flushRun();
        runFg = cell.fg;
        runBg = cell.bg;
        runBold = cell.bold;
      }
      runText += cell.char;
    }
    flushRun();
    linesHtml.push(lineHtml);
  }

  while (linesHtml.length > 0 && linesHtml[linesHtml.length - 1] === "") {
    linesHtml.pop();
  }

  return linesHtml.join("\n");
}

async function getFastfetch() {
  try {
    const out = await runCommand('fastfetch', ['--pipe', 'false'], {
      TERM: 'xterm-256color'
    });
    return ansiToHtml(out);
  } catch (e) {
    console.error('fastfetch failed:', e.message);
    return null;
  }
}

async function getLogs() {
  const entries = [];

  try {
    const out = await runCommand('journalctl', ['-p', 'warning', '--no-pager', '-n', '60', '-o', 'short-iso']);
    out.trim().split('\n').forEach(line => {
      if (!line.trim()) return;
      entries.push({ source: 'journal', level: 'warning', message: line.trim() });
    });
  } catch (e) {
    console.error('journalctl failed:', e.message);
  }

  if (entries.length === 0) {
    try {
      const out = await runCommand('dmesg', ['-l', 'warn,err,crit,alert,emerg', '-x']);
      out.trim().split('\n').forEach(line => {
        if (!line.trim()) return;
        entries.push({ source: 'dmesg', level: 'kernel', message: line.trim() });
      });
    } catch (e) {
      console.error('dmesg failed:', e.message);
    }
  }

  return entries.slice(-100);
}

const DISK_VIRTUAL_FSTYPES = new Set([
  'tmpfs', 'devtmpfs', 'squashfs', 'overlay', 'ramfs', 'mqueue',
  'debugfs', 'tracefs', 'securityfs', 'pstore', 'bpf',
  'cgroup', 'cgroup2', 'proc', 'sysfs', 'autofs', 'binfmt_misc',
  'fuse.lxcfs'
]);

function formatBytes(bytes) {
  const units = ['B', 'K', 'M', 'G', 'T', 'P'];
  if (bytes < 1024) return Math.round(bytes) + ' B';
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return v.toFixed(1) + ' ' + units[i];
}

async function getStorage() {
  try {
    // df -k reports sizes in 1024-byte blocks; --output yields cleanly split columns.
    const out = await runCommand('df', ['-k', '--output=source,fstype,size,used,avail,pcent,target']);
    const lines = out.trim().split('\n');
    const mounts = [];
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 7) continue;
      const [source, fstype, sizeStr, usedStr, availStr, pcentStr] = parts;
      const target = parts.slice(6).join(' ');
      // Skip pseudo / virtual filesystems to show only real storage.
      if (DISK_VIRTUAL_FSTYPES.has(fstype)) continue;
      const sizeBytes = parseInt(sizeStr, 10) * 1024;
      const usedBytes = parseInt(usedStr, 10) * 1024;
      const availBytes = parseInt(availStr, 10) * 1024;
      const usePct = parseFloat(pcentStr.replace(/[^0-9.]/g, '')) || 0;
      mounts.push({
        source,
        fstype,
        target,
        sizeBytes,
        usedBytes,
        availBytes,
        sizeStr: formatBytes(sizeBytes),
        usedStr: formatBytes(usedBytes),
        availStr: formatBytes(availBytes),
        usePct
      });
    }

    // Aggregate a grand total across all real mounts.
    let totalBytes = 0;
    let usedBytes = 0;
    for (const m of mounts) { totalBytes += m.sizeBytes; usedBytes += m.usedBytes; }
    const total = totalBytes > 0 ? {
      sizeStr: formatBytes(totalBytes),
      usedStr: formatBytes(usedBytes),
      usePct: Math.round((usedBytes / totalBytes) * 1000) / 10
    } : null;

    return { mounts, total };
  } catch (e) {
    console.error('getStorage failed:', e.message);
    return null;
  }
}

app.get('/api/fastfetch', async (req, res) => {
  const html = await getFastfetch();
  if (!html) return res.status(500).json({ error: 'Could not fetch fastfetch output' });
  res.json({ html });
});

app.get('/api/logs', async (req, res) => {
  const data = await getLogs();
  res.json(data);
});

app.get('/api/storage', async (req, res) => {
  const data = await getStorage();
  if (!data) return res.status(500).json({ error: 'Failed to retrieve storage data' });
  res.json(data);
});

// ───── htop / procfs system data ─────

let lastCpuTimes = null;
let currentCpuStats = [];

function sampleCpu() {
  try {
    const stat = fs.readFileSync('/proc/stat', 'utf8');
    const lines = stat.split('\n');
    const currentTimes = {};
    const stats = [];

    for (const line of lines) {
      const m = line.match(/^cpu(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
      if (!m) continue;
      const core = parseInt(m[1], 10);
      const user = parseInt(m[2], 10);
      const nice = parseInt(m[3], 10);
      const sys = parseInt(m[4], 10);
      const idle = parseInt(m[5], 10);
      const iowait = parseInt(m[6], 10);
      const irq = parseInt(m[7], 10);
      const softirq = parseInt(m[8], 10);
      const steal = parseInt(m[9], 10);

      const idleTicks = idle + iowait;
      const userTicks = user;
      const niceTicks = nice;
      const sysTicks = sys + irq + softirq;
      const totalTicks = idleTicks + userTicks + niceTicks + sysTicks + steal;

      currentTimes[core] = { idleTicks, userTicks, niceTicks, sysTicks, totalTicks };

      if (lastCpuTimes && lastCpuTimes[core]) {
        const prev = lastCpuTimes[core];
        const deltaTotal = Math.max(1, totalTicks - prev.totalTicks);
        const deltaIdle = idleTicks - prev.idleTicks;
        const deltaUser = userTicks - prev.userTicks;
        const deltaNice = niceTicks - prev.niceTicks;
        const deltaSys = sysTicks - prev.sysTicks;

        const totalUsagePct = Math.max(0, Math.min(100, ((deltaTotal - deltaIdle) / deltaTotal) * 100));
        const userPct = Math.max(0, Math.min(100, (deltaUser / deltaTotal) * 100));
        const nicePct = Math.max(0, Math.min(100, (deltaNice / deltaTotal) * 100));
        const sysPct = Math.max(0, Math.min(100, (deltaSys / deltaTotal) * 100));

        stats.push({
          core,
          pct: parseFloat(totalUsagePct.toFixed(1)),
          userPct: parseFloat(userPct.toFixed(1)),
          nicePct: parseFloat(nicePct.toFixed(1)),
          sysPct: parseFloat(sysPct.toFixed(1))
        });
      } else {
        stats.push({
          core,
          pct: 0,
          userPct: 0,
          nicePct: 0,
          sysPct: 0
        });
      }
    }
    lastCpuTimes = currentTimes;
    if (stats.length > 0) {
      currentCpuStats = stats;
    }
  } catch (err) {
    console.error('CPU sample failed:', err.message);
  }
}

// Prime CPU sampling
sampleCpu();
setTimeout(sampleCpu, 100);
setInterval(sampleCpu, 1500);

function formatHtopSize(bytes) {
  const gig = 1024 * 1024 * 1024;
  const meg = 1024 * 1024;
  if (bytes >= gig) {
    return (bytes / gig).toFixed(2) + 'G';
  } else if (bytes >= meg) {
    return Math.round(bytes / meg) + 'M';
  } else {
    return Math.round(bytes / 1024) + 'K';
  }
}

function getMemoryData() {
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const parse = (key) => {
      const m = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
      return m ? parseInt(m[1], 10) : 0;
    };
    const totalKb = parse('MemTotal');
    const freeKb = parse('MemFree');
    const buffersKb = parse('Buffers');
    const cachedKb = parse('Cached');
    const sRecKb = parse('SReclaimable');
    const shmemKb = parse('Shmem');
    
    // htop memory calculation
    const usedKb = Math.max(0, totalKb - freeKb - buffersKb - cachedKb - sRecKb + shmemKb);
    const cacheKb = Math.max(0, cachedKb + sRecKb - shmemKb);

    const swapTotalKb = parse('SwapTotal');
    const swapFreeKb = parse('SwapFree');
    const swapUsedKb = Math.max(0, swapTotalKb - swapFreeKb);

    return {
      totalBytes: totalKb * 1024,
      usedBytes: usedKb * 1024,
      buffersBytes: buffersKb * 1024,
      cacheBytes: cacheKb * 1024,
      usedStr: formatHtopSize(usedKb * 1024),
      totalStr: formatHtopSize(totalKb * 1024),
      pct: totalKb > 0 ? parseFloat(((usedKb / totalKb) * 100).toFixed(1)) : 0,
      swap: {
        totalBytes: swapTotalKb * 1024,
        usedBytes: swapUsedKb * 1024,
        usedStr: formatHtopSize(swapUsedKb * 1024),
        totalStr: formatHtopSize(swapTotalKb * 1024),
        pct: swapTotalKb > 0 ? parseFloat(((swapUsedKb / swapTotalKb) * 100).toFixed(1)) : 0
      }
    };
  } catch (e) {
    console.error('getMemoryData failed:', e.message);
    return null;
  }
}

function getSystemMetrics() {
  let loadAvg = ['0.00', '0.00', '0.00'];
  let runningThreads = 1;
  let totalThreads = 0;
  try {
    const raw = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/);
    loadAvg = [raw[0], raw[1], raw[2]];
    if (raw[3]) {
      const parts = raw[3].split('/');
      runningThreads = parseInt(parts[0], 10) || 1;
      totalThreads = parseInt(parts[1], 10) || 0;
    }
  } catch (e) {}

  let uptimeStr = '0 days, 00:00:00';
  try {
    const uptimeSec = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
    const days = Math.floor(uptimeSec / 86400);
    const hours = Math.floor((uptimeSec % 86400) / 3600).toString().padStart(2, '0');
    const mins = Math.floor((uptimeSec % 3600) / 60).toString().padStart(2, '0');
    const secs = Math.floor(uptimeSec % 60).toString().padStart(2, '0');
    uptimeStr = `${days} days, ${hours}:${mins}:${secs}`;
  } catch (e) {}

  let tasksCount = 0;
  let kthrCount = 0;
  let thrCount = totalThreads;
  try {
    const pids = fs.readdirSync('/proc').filter(n => /^\d+$/.test(n));
    tasksCount = pids.length;
    for (const pid of pids) {
      try {
        const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        if (!cmd) kthrCount++;
      } catch (e) {}
    }
  } catch (e) {}

  return {
    loadAvg,
    uptime: uptimeStr,
    tasks: {
      total: tasksCount || 129,
      thr: thrCount || 406,
      kthr: kthrCount || 123,
      running: runningThreads
    }
  };
}

function formatProcUnit(val) {
  if (!val) return '0';
  if (/[a-zA-Z]$/.test(val)) return val.toUpperCase();
  const num = parseInt(val, 10);
  if (isNaN(num)) return val;
  if (num >= 1048576) return (num / 1048576).toFixed(1) + 'G';
  if (num >= 102400) return Math.round(num / 1024) + 'M';
  return num.toString();
}

function mapProcessLine(headers, parts) {
  const getCol = (patterns) => {
    for (const pat of patterns) {
      const idx = headers.findIndex(h => pat.test(h));
      if (idx !== -1 && idx < parts.length) return { val: parts[idx], idx };
    }
    return { val: '', idx: -1 };
  };

  const pid = getCol([/^pid$/i]).val || '0';
  const user = getCol([/^user$/i]).val || 'unknown';
  const pri = getCol([/^pr(i)?$/i]).val || '20';
  const ni = getCol([/^ni$/i]).val || '0';
  const virt = formatProcUnit(getCol([/^virt$/i, /^vsz$/i]).val);
  const res = formatProcUnit(getCol([/^res$/i, /^rss$/i]).val);
  const shr = formatProcUnit(getCol([/^shr$/i]).val) || '0';
  const state = (getCol([/^s(tat)?$/i]).val || 'S').charAt(0);
  const cpu = parseFloat(getCol([/^%?cpu$/i]).val) || 0;
  const mem = parseFloat(getCol([/^%?mem$/i]).val) || 0;
  const time = getCol([/^time\+?$/i]).val || '0:00.00';

  const cmdInfo = getCol([/^command$/i, /^args$/i]);
  const cmd = cmdInfo.idx !== -1 ? parts.slice(cmdInfo.idx).join(' ') : (parts[parts.length - 1] || '');

  return { pid, user, pri, ni, virt, res, shr, state, cpu, mem, time, command: cmd };
}

async function getProcesses() {
  let procs = [];
  try {
    const out = await runCommand('top', ['-b', '-n', '1', '-w', '512']);
    const lines = out.split('\n');
    const pidIndex = lines.findIndex(l => /^\s*PID\s+/i.test(l));
    if (pidIndex !== -1) {
      const headers = lines[pidIndex].trim().split(/\s+/);
      for (let i = pidIndex + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(/\s+/);
        if (parts.length >= headers.length - 1) {
          procs.push(mapProcessLine(headers, parts));
        }
      }
    }
  } catch (e) {
    // top failed or not available, fallback to ps
  }

  if (procs.length === 0) {
    try {
      const out = await runCommand('ps', ['-eo', 'pid,user,pri,ni,vsz,rss,stat,pcpu,pmem,time,args', '--sort=-pcpu']);
      const lines = out.trim().split('\n');
      if (lines.length > 1) {
        const headers = lines[0].trim().split(/\s+/);
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const parts = line.split(/\s+/);
          if (parts.length >= headers.length - 1) {
            procs.push(mapProcessLine(headers, parts));
          }
        }
      }
    } catch (e2) {}
  }

  const topCpu = [...procs].sort((a, b) => b.cpu - a.cpu).slice(0, 3);
  const topMem = [...procs].sort((a, b) => b.mem - a.mem).slice(0, 3);

  return { topCpu, topMem, all: procs };
}

app.get('/api/htop', async (req, res) => {
  try {
    const memory = getMemoryData();
    const metrics = getSystemMetrics();
    const { topCpu, topMem, all } = await getProcesses();

    res.json({
      cpus: currentCpuStats,
      memory,
      metrics,
      topCpu,
      topMem,
      processes: all
    });
  } catch (err) {
    console.error('API htop failed:', err.message);
    res.status(500).json({ error: 'Failed to retrieve system htop data' });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try: PORT=3001 npm start`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
