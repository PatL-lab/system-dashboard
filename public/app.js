const POLL_INTERVAL = 15000;

const sysinfoEl = document.getElementById('sysinfo');
const logsPanel = document.getElementById('logs-panel');
const htopPanel = document.getElementById('htop-panel');
const storagePanel = document.getElementById('storage-panel');
const lastUpdatedEl = document.getElementById('last-updated');

/* ───── helpers ───── */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/* ───── render fastfetch ───── */
function renderFastfetch(data) {
  if (!data || data.error || !data.html) {
    sysinfoEl.innerHTML = '<pre class="fastfetch-terminal error-state">Failed to load fastfetch output</pre>';
    return;
  }
  sysinfoEl.innerHTML = `<pre class="fastfetch-terminal">${data.html}</pre>`;
}

/* ───── render htop ───── */
function renderHtopBar(segments, valueStr, totalSlots = 24) {
  const totalCount = segments.reduce((sum, s) => sum + s.count, 0);
  const clampedTotal = Math.min(totalSlots, totalCount);

  let html = '';
  let remaining = clampedTotal;
  for (const seg of segments) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, seg.count);
    if (take > 0) {
      html += `<span class="${seg.class}">${'|'.repeat(take)}</span>`;
      remaining -= take;
    }
  }

  return `
    <span class="htop-meter-bar">
      ${html}
      <span class="htop-meter-spacer"></span>
      <span class="htop-meter-val">${escapeHtml(valueStr)}</span>
    </span>
  `;
}

function renderHtop(data) {
  if (!data || data.error || !data.cpus) {
    htopPanel.innerHTML = '<div class="logs-placeholder error-state">Failed to load htop data</div>';
    return;
  }

  const { cpus, memory, metrics, processes } = data;
  const BAR_SLOTS = 24;

  const half = Math.ceil(cpus.length / 2);
  const leftCpus = cpus.slice(0, half);
  const rightCpus = cpus.slice(half);

  // Left column rows: CPUs + Mem + Swp
  let leftHtml = '';
  for (const c of leftCpus) {
    const userBars = Math.round(((c.userPct || 0) / 100) * BAR_SLOTS);
    const niceBars = Math.round(((c.nicePct || 0) / 100) * BAR_SLOTS);
    const sysBars = Math.round(((c.sysPct || 0) / 100) * BAR_SLOTS);

    const segments = [
      { count: userBars, class: 'bar-user' },
      { count: niceBars, class: 'bar-nice' },
      { count: sysBars, class: 'bar-sys' }
    ];
    const valText = `${c.pct.toFixed(1)}%]`;
    leftHtml += `
      <div class="htop-meter-row">
        <span class="htop-meter-label">${c.core}</span><span class="htop-bracket">[</span>${renderHtopBar(segments, valText, BAR_SLOTS)}
      </div>
    `;
  }

  // Mem row
  if (memory) {
    const memTotal = memory.totalBytes || 1;
    const usedBars = Math.round(((memory.usedBytes || 0) / memTotal) * BAR_SLOTS);
    const bufBars = Math.round(((memory.buffersBytes || 0) / memTotal) * BAR_SLOTS);
    const cacheBars = Math.round(((memory.cacheBytes || 0) / memTotal) * BAR_SLOTS);
    const memSegments = [
      { count: usedBars, class: 'bar-mem-used' },
      { count: bufBars, class: 'bar-mem-buf' },
      { count: cacheBars, class: 'bar-mem-cache' }
    ];
    const memValText = `${memory.usedStr}/${memory.totalStr}]`;
    leftHtml += `
      <div class="htop-meter-row">
        <span class="htop-meter-label">Mem</span><span class="htop-bracket">[</span>${renderHtopBar(memSegments, memValText, BAR_SLOTS)}
      </div>
    `;

    // Swap row
    const swpTotal = memory.swap?.totalBytes || 1;
    const swpUsedBars = Math.round(((memory.swap?.usedBytes || 0) / swpTotal) * BAR_SLOTS);
    const swpSegments = [
      { count: swpUsedBars, class: 'bar-swp-used' }
    ];
    const swpValText = `${memory.swap?.usedStr || '0K'}/${memory.swap?.totalStr || '0K'}]`;
    leftHtml += `
      <div class="htop-meter-row">
        <span class="htop-meter-label">Swp</span><span class="htop-bracket">[</span>${renderHtopBar(swpSegments, swpValText, BAR_SLOTS)}
      </div>
    `;
  }

  // Right column rows: CPUs + Tasks + Load + Uptime
  let rightHtml = '';
  for (const c of rightCpus) {
    const userBars = Math.round(((c.userPct || 0) / 100) * BAR_SLOTS);
    const niceBars = Math.round(((c.nicePct || 0) / 100) * BAR_SLOTS);
    const sysBars = Math.round(((c.sysPct || 0) / 100) * BAR_SLOTS);

    const segments = [
      { count: userBars, class: 'bar-user' },
      { count: niceBars, class: 'bar-nice' },
      { count: sysBars, class: 'bar-sys' }
    ];
    const valText = `${c.pct.toFixed(1)}%]`;
    rightHtml += `
      <div class="htop-meter-row">
        <span class="htop-meter-label">${c.core}</span><span class="htop-bracket">[</span>${renderHtopBar(segments, valText, BAR_SLOTS)}
      </div>
    `;
  }

  if (metrics) {
    const { tasks, loadAvg, uptime } = metrics;
    rightHtml += `
      <div class="htop-info-line">
        <span class="htop-text-cyan">Tasks: </span><span class="htop-text-white">${tasks?.total ?? '--'}</span><span class="htop-text-cyan">, </span><span class="htop-text-white">${tasks?.thr ?? '--'}</span><span class="htop-text-cyan"> thr, </span><span class="htop-text-white">${tasks?.kthr ?? '--'}</span><span class="htop-text-cyan"> kthr; </span><span class="htop-text-green">${tasks?.running ?? 1} running</span>
      </div>
      <div class="htop-info-line">
        <span class="htop-text-cyan">Load average: </span><span class="htop-text-white">${(loadAvg || []).join(' ')}</span>
      </div>
      <div class="htop-info-line">
        <span class="htop-text-cyan">Uptime: </span><span class="htop-text-white">${uptime || '--'}</span>
      </div>
    `;
  }

  // Top header meters layout
  const metersHtml = `
    <div class="htop-meters-container">
      <div class="htop-meter-col">${leftHtml}</div>
      <div class="htop-meter-col">${rightHtml}</div>
    </div>
  `;

  // Process table layout: 2 sections (top 3 by CPU, top 3 by memory)
  function renderProcRows(procList) {
    if (!procList || procList.length === 0) {
      return '<tr><td colspan="12" class="logs-placeholder">No processes found</td></tr>';
    }
    return procList.map((p, idx) => {
      const isSelected = idx === 0;
      return `
        <tr class="${isSelected ? 'htop-row-selected' : ''}">
          <td class="htop-cell-pid">${escapeHtml(p.pid)}</td>
          <td class="htop-cell-user">${escapeHtml(p.user)}</td>
          <td class="htop-cell-dim">${escapeHtml(p.pri)}</td>
          <td class="htop-cell-dim">${escapeHtml(p.ni)}</td>
          <td class="htop-cell-memval">${escapeHtml(p.virt)}</td>
          <td class="htop-cell-memval">${escapeHtml(p.res)}</td>
          <td class="htop-cell-dim">${escapeHtml(p.shr)}</td>
          <td class="htop-cell-state">${escapeHtml(p.state)}</td>
          <td class="htop-cell-cpu">${p.cpu.toFixed(1)}</td>
          <td class="htop-cell-mem">${p.mem.toFixed(1)}</td>
          <td class="htop-cell-time">${escapeHtml(p.time)}</td>
          <td class="htop-cell-cmd">${escapeHtml(p.command)}</td>
        </tr>
      `;
    }).join('');
  }

  function renderProcSection(badgeText, title, procList, sortField) {
    return `
      <div class="htop-procs-section">
        <div class="htop-section-header">
          <span class="htop-badge">${escapeHtml(badgeText)}</span>
          <span class="htop-section-title">${escapeHtml(title)}</span>
        </div>
        <div class="htop-table-wrapper">
          <table class="htop-table">
            <thead>
              <tr>
                <th>PID</th>
                <th>USER</th>
                <th>PRI</th>
                <th>NI</th>
                <th>VIRT</th>
                <th>RES</th>
                <th>SHR</th>
                <th>S</th>
                <th>CPU%${sortField === 'cpu' ? '<span class="htop-sort-arrow">▼</span>' : ''}</th>
                <th>MEM%${sortField === 'mem' ? '<span class="htop-sort-arrow">▼</span>' : ''}</th>
                <th>TIME+</th>
                <th>Command</th>
              </tr>
            </thead>
            <tbody>
              ${renderProcRows(procList)}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  const topCpu = (data.topCpu && data.topCpu.length > 0)
    ? data.topCpu.slice(0, 3)
    : (data.processes || []).slice().sort((a, b) => b.cpu - a.cpu).slice(0, 3);

  const topMem = (data.topMem && data.topMem.length > 0)
    ? data.topMem.slice(0, 3)
    : (data.processes || []).slice().sort((a, b) => b.mem - a.mem).slice(0, 3);

  const tableHtml = `
    <div class="htop-procs-container">
      ${renderProcSection('[CPU]', 'Top 3 Processes by CPU', topCpu, 'cpu')}
      ${renderProcSection('[MEM]', 'Top 3 Processes by Memory Usage', topMem, 'mem')}
    </div>
  `;

  htopPanel.innerHTML = metersHtml + tableHtml;
}

/* ───── render logs ───── */
function renderLogs(entries) {
  if (!entries || entries.length === 0) {
    logsPanel.innerHTML = '<div class="logs-placeholder">No warning or higher logs found.</div>';
    return;
  }
  logsPanel.innerHTML = '';
  for (const entry of entries) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    const dotClass = entry.level || 'warning';
    div.innerHTML = `<span class="log-dot ${dotClass}"></span><span class="log-message">${escapeHtml(entry.message)}</span>`;
    logsPanel.appendChild(div);
  }
  logsPanel.scrollTop = logsPanel.scrollHeight;
}

/* ───── render storage ───── */
function renderStorage(data) {
  if (!data || data.error || !data.mounts || data.mounts.length === 0) {
    storagePanel.innerHTML = '<div class="logs-placeholder error-state">Failed to load storage data</div>';
    return;
  }

  const rows = data.mounts.map(m => {
    const pct = m.usePct;
    const barColor = pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warning)' : 'var(--success)';
    const label = m.source.split('/').pop() || m.source;
    return `
      <tr>
        <td class="storage-cell-src">${escapeHtml(label)}</td>
        <td class="storage-cell-fstype">${escapeHtml(m.fstype)}</td>
        <td class="storage-cell-num">${escapeHtml(m.sizeStr)}</td>
        <td class="storage-cell-num">${escapeHtml(m.usedStr)}</td>
        <td class="storage-cell-num">${escapeHtml(m.availStr)}</td>
        <td class="storage-cell-pct">
          <span class="storage-bar-wrap">
            <span class="storage-bar" style="width:${pct}%;background:${barColor}"></span>
            <span class="storage-pct-val">${pct}%</span>
          </span>
        </td>
      </tr>`;
  }).join('');

  const totalRow = data.total
    ? `<tr class="storage-row-total">
        <td class="storage-cell-src">Total</td>
        <td class="storage-cell-fstype">—</td>
        <td class="storage-cell-num">${data.total.sizeStr}</td>
        <td class="storage-cell-num">${data.total.usedStr}</td>
        <td class="storage-cell-num">—</td>
        <td class="storage-cell-pct">
          <span class="storage-bar-wrap">
            <span class="storage-bar" style="width:${data.total.usePct}%"></span>
            <span class="storage-pct-val">${data.total.usePct}%</span>
          </span>
        </td>
      </tr>`
    : '';

  storagePanel.innerHTML = `
    <table class="storage-table">
      <thead>
        <tr>
          <th>Mount</th>
          <th>Filesystem</th>
          <th class="storage-num">Size</th>
          <th class="storage-num">Used</th>
          <th class="storage-num">Avail</th>
          <th>Usage</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        ${totalRow}
      </tbody>
    </table>`;
}

/* ───── fetch & update ───── */
async function fetchHtop() {
  try {
    const res = await fetch('/api/htop');
    const data = await res.json();
    renderHtop(data);
  } catch (e) {
    console.error('Failed to fetch htop:', e);
  }
}

async function fetchData() {
  try {
    const [fastfetchRes, logRes, storageRes] = await Promise.all([
      fetch('/api/fastfetch'),
      fetch('/api/logs'),
      fetch('/api/storage')
    ]);
    const fastfetchData = await fastfetchRes.json();
    const logData = await logRes.json();
    const storageData = await storageRes.json();

    renderFastfetch(fastfetchData);
    renderLogs(logData);
    renderStorage(storageData);

    lastUpdatedEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch (e) {
    console.error(e);
    lastUpdatedEl.textContent = 'Update failed';
  }
}

fetchData();
fetchHtop();
setInterval(fetchData, POLL_INTERVAL);
setInterval(fetchHtop, POLL_INTERVAL);
