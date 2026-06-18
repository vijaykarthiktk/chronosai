// Chart.js references
let gdpChartInstance = null;
let cpuGaugeInstance = null;
let ramGaugeInstance = null;

// History vectors for economic trend tracking
let timeLabels = [];
let regionHistory = {
  "North America": [],
  "Eurozone": [],
  "Asia-Pacific": []
};
const MAX_HISTORY_POINTS = 10;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  initRouter();
  pollData();
  setInterval(pollData, 2000);
});

// SPA Hash Router
function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  // Initial route resolve
  handleRoute();
}

function handleRoute() {
  if (!window.location.hash) {
    window.location.hash = '#dashboard';
    return;
  }
  const hash = window.location.hash;
  
  const routes = {
    '#dashboard': 'page-dashboard',
    '#indicators': 'page-indicators',
    '#jobs': 'page-jobs',
    '#alerts': 'page-alerts',
    '#admin': 'page-admin'
  };

  const targetPageId = routes[hash] || 'page-dashboard';

  // Toggle page visibility
  document.querySelectorAll('.page-view').forEach(page => {
    if (page.id === targetPageId) {
      page.classList.remove('hidden');
    } else {
      page.classList.add('hidden');
    }
  });

  // Update active navigation items
  document.querySelectorAll('.nav-links .nav-item').forEach(link => {
    const linkHash = link.getAttribute('href');
    if (linkHash === hash || (hash === '#dashboard' && linkHash === '#dashboard')) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Handle Chart.js resizing/redrawing when components become visible
  setTimeout(() => {
    if (hash === '#dashboard') {
      if (cpuGaugeInstance) {
        cpuGaugeInstance.resize();
        cpuGaugeInstance.update('none');
      }
      if (ramGaugeInstance) {
        ramGaugeInstance.resize();
        ramGaugeInstance.update('none');
      }
    } else if (hash === '#indicators') {
      if (gdpChartInstance) {
        gdpChartInstance.resize();
        gdpChartInstance.update('none');
      }
    }
  }, 50);
}

// Initialize Chart.js graphs
function initCharts() {
  // GDP Forecasting Trend Chart
  const gdpCtx = document.getElementById('gdpChart').getContext('2d');
  gdpChartInstance = new Chart(gdpCtx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'North America',
          data: [],
          borderColor: '#3B82F6',
          backgroundColor: 'rgba(59, 130, 246, 0.04)',
          borderWidth: 2,
          tension: 0.4,
          fill: true
        },
        {
          label: 'Eurozone',
          data: [],
          borderColor: '#6366F1',
          backgroundColor: 'rgba(99, 102, 241, 0.04)',
          borderWidth: 2,
          tension: 0.4,
          fill: true
        },
        {
          label: 'Asia-Pacific',
          data: [],
          borderColor: '#10B981',
          backgroundColor: 'rgba(16, 185, 129, 0.04)',
          borderWidth: 2,
          tension: 0.4,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#475569', font: { family: 'Inter', size: 11 } }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(15, 23, 42, 0.06)' }, ticks: { color: '#64748B' } },
        y: { grid: { color: 'rgba(15, 23, 42, 0.06)' }, ticks: { color: '#64748B' } }
      }
    }
  });

  // CPU Donut Gauge
  const cpuCtx = document.getElementById('cpuGauge').getContext('2d');
  cpuGaugeInstance = new Chart(cpuCtx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [0, 100],
        backgroundColor: ['#3B82F6', '#E2E8F0'],
        borderWidth: 0
      }]
    },
    options: {
      cutout: '80%',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      events: []
    }
  });

  // RAM Donut Gauge
  const ramCtx = document.getElementById('ramGauge').getContext('2d');
  ramGaugeInstance = new Chart(ramCtx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [0, 100],
        backgroundColor: ['#6366F1', '#E2E8F0'],
        borderWidth: 0
      }]
    },
    options: {
      cutout: '80%',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      events: []
    }
  });
}

// Fetch dashboard datasets and updates
async function pollData() {
  try {
    const statePromise = fetch('/api/state').then(r => r.ok ? r.json() : null).catch(() => null);
    const forecastPromise = fetch('/api/forecast').then(r => r.ok ? r.json() : null).catch(() => null);
    const logsPromise = fetch('/api/sim-logs').then(r => r.ok ? r.json() : null).catch(() => null);
    const secretsPromise = fetch('/api/sim-secrets').catch(() => null);
    const jobsPromise = fetch('/api/jobs').then(r => r.ok ? r.json() : null).catch(() => null);
    const alertsPromise = fetch('/api/alerts').then(r => r.ok ? r.json() : null).catch(() => null);

    const [state, forecast, logs, secretsRes, jobs, alerts] = await Promise.all([
      statePromise,
      forecastPromise,
      logsPromise,
      secretsPromise,
      jobsPromise,
      alertsPromise
    ]);

    if (state) {
      updateSystemMetrics(state);
      updateK8sPods(state);
      updateSelfHealingTimeline(state);
    }
    if (forecast) {
      updateIndicatorsTable(forecast);
      updateEconomicChart(forecast);
    }
    if (logs) {
      updateLogTerminal(logs);
    }
    if (secretsRes) {
      updateVaultView(secretsRes);
    }
    if (jobs) {
      updateJobsTab(jobs);
    }
    if (alerts) {
      updateAlertsTab(alerts);
    }
  } catch (error) {
    console.error('Error polling dashboard datasets:', error);
  }
}

// Update basic dashboard components
function updateSystemMetrics(state) {
  // Update header parameters
  document.getElementById('header-region').textContent = state.activeRegion;
  document.getElementById('header-replicas').textContent = `${state.replicas} / 10`;
  document.getElementById('header-heals').textContent = state.healedCount;

  // CPU/RAM numerical stats
  document.getElementById('cpu-text').textContent = `${state.cpuLoad}%`;
  document.getElementById('ram-text').textContent = `${state.ramUsage}%`;
  document.getElementById('req-rate-text').textContent = `${state.requestRate} rps`;
  document.getElementById('err-rate-text').textContent = `${state.errorRate}%`;
  document.getElementById('db-latency-text').textContent = `${state.dbLatency}ms`;

  // Dashboard page specific elements
  const dashEvents = document.getElementById('dash-events');
  const dashForecastStatus = document.getElementById('dash-forecast-status');
  const dashSystemHealth = document.getElementById('dash-system-health');
  if (dashEvents) dashEvents.textContent = state.totalRequests.toLocaleString();
  if (dashForecastStatus) {
    dashForecastStatus.textContent = state.status === 'OPTIMAL' ? 'OPTIMAL' : 'DEGRADED';
    dashForecastStatus.style.color = state.status === 'OPTIMAL' ? 'var(--color-success)' : 'var(--color-danger)';
  }
  if (dashSystemHealth) {
    dashSystemHealth.textContent = state.status;
    dashSystemHealth.style.color = state.status === 'OPTIMAL' ? 'var(--color-success)' : 'var(--color-warning)';
  }

  // Admin page active region / Vault
  const adminActiveRegion = document.getElementById('admin-active-region');
  const adminVaultPill = document.getElementById('admin-vault-pill');
  if (adminActiveRegion) adminActiveRegion.textContent = state.activeRegion;
  if (adminVaultPill) {
    adminVaultPill.textContent = state.vaultStatus === 'CONNECTED' ? 'Connected' : state.vaultStatus;
    adminVaultPill.className = state.vaultStatus === 'CONNECTED' ? 'status-pill green-pill' : 'status-pill red-pill';
  }

  const errText = document.getElementById('err-rate-text');
  if (state.errorRate > 5.0) {
    errText.className = 'highlight-green'; // Reset class
    errText.style.color = '#F43F5E';
  } else if (state.errorRate > 0.5) {
    errText.style.color = '#F59E0B';
  } else {
    errText.style.color = '#10B981';
  }

  // Update gauges
  cpuGaugeInstance.data.datasets[0].data = [state.cpuLoad, 100 - state.cpuLoad];
  cpuGaugeInstance.data.datasets[0].backgroundColor[0] = state.cpuLoad > 80 ? '#F43F5E' : '#3B82F6';
  cpuGaugeInstance.update();

  ramGaugeInstance.data.datasets[0].data = [state.ramUsage, 100 - state.ramUsage];
  ramGaugeInstance.update();

  // Sidebar systems indicator
  const sidePulse = document.getElementById('sidebar-pulse');
  const sideText = document.getElementById('sidebar-status-text');
  
  sidePulse.className = 'status-pulse-dot pulse'; // Reset
  sideText.textContent = `Cluster: ${state.status}`;

  if (state.status === 'OPTIMAL') {
    // defaults
  } else if (state.status === 'CRISIS_DETECTED') {
    sidePulse.classList.add('danger');
  } else if (state.status === 'AUTOSCALING' || state.status === 'FAILOVER_ACTIVE') {
    sidePulse.classList.add('warning');
  } else if (state.status === 'RECOVERING') {
    sidePulse.classList.add('warning');
  }
}

// Update indicators table
function updateIndicatorsTable(forecast) {
  const tbody = document.getElementById('indicators-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  forecast.regions.forEach(r => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border-color)';
    
    let riskClass = 'low';
    if (r.riskIndex > 60) riskClass = 'high';
    else if (r.riskIndex > 30) riskClass = 'medium';

    const employmentRate = (100 - r.unemployment).toFixed(1);
    const tradeVolume = Math.floor(120 + r.gdpGrowth * 15 - r.riskIndex * 0.5);

    tr.innerHTML = `
      <td style="padding: 12px 8px; font-weight: 600;">${r.name}</td>
      <td style="padding: 12px 8px; text-align: right; font-weight: 700; color: ${r.gdpGrowth > 0 ? 'var(--color-success)' : 'var(--color-danger)'}">${r.gdpGrowth > 0 ? '+' : ''}${r.gdpGrowth}%</td>
      <td style="padding: 12px 8px; text-align: right;">${r.cpiInflation}%</td>
      <td style="padding: 12px 8px; text-align: right;">${employmentRate}%</td>
      <td style="padding: 12px 8px; text-align: right; font-weight: 600;">${tradeVolume}</td>
      <td style="padding: 12px 8px; text-align: right;">${r.logisticsScore}</td>
      <td style="padding: 12px 8px; text-align: center;">
        <span class="status-pill ${r.forecastingModelStatus === 'OPTIMAL' ? 'status-active' : 'red-pill'}">${r.forecastingModelStatus}</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Update Jobs Tab
function updateJobsTab(data) {
  const runEl = document.getElementById('jobs-running');
  const compEl = document.getElementById('jobs-completed');
  const failEl = document.getElementById('jobs-failed');
  const avgEl = document.getElementById('jobs-avg-time');
  const dashActiveJobs = document.getElementById('dash-active-jobs');
  const tbody = document.getElementById('jobs-table-body');

  if (runEl) runEl.textContent = data.runningCount;
  if (dashActiveJobs) dashActiveJobs.textContent = data.runningCount;
  if (compEl) compEl.textContent = data.completedCount;
  if (failEl) failEl.textContent = data.failedCount;
  if (avgEl) avgEl.textContent = `${data.avgProcessingTime}s`;

  if (tbody) {
    tbody.innerHTML = '';
    data.jobs.forEach(j => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-color)';
      
      let statusClass = 'status-active';
      if (j.status === 'FAILED') statusClass = 'red-pill';
      else if (j.status === 'RUNNING') statusClass = 'green-pill';

      tr.innerHTML = `
        <td style="padding: 12px 8px; font-family: monospace; font-weight: 600;">${j.id}</td>
        <td style="padding: 12px 8px; font-weight: 500;">${j.name}</td>
        <td style="padding: 12px 8px;">
          <span class="status-pill ${statusClass}">${j.status}</span>
        </td>
        <td style="padding: 12px 8px; text-align: right; font-weight: 600;">${j.duration}</td>
        <td style="padding: 12px 8px; text-align: right; color: var(--text-secondary);">${new Date(j.timestamp).toLocaleTimeString()}</td>
      `;
      tbody.appendChild(tr);
    });
  }
}

// Update Alerts Tab
function updateAlertsTab(alerts) {
  const statusPill = document.getElementById('alerts-status-pill');
  const tbody = document.getElementById('alerts-table-body');

  const activeAlerts = alerts.filter(a => a.status === 'ACTIVE');
  if (statusPill) {
    if (activeAlerts.length > 0) {
      statusPill.textContent = `${activeAlerts.length} Active Alert(s)`;
      statusPill.className = 'status-pill red-pill';
    } else {
      statusPill.textContent = 'System Optimal';
      statusPill.className = 'status-pill green-pill';
    }
  }

  if (tbody) {
    tbody.innerHTML = '';
    alerts.forEach(a => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-color)';
      
      let severityClass = 'status-active';
      if (a.severity === 'CRITICAL') severityClass = 'red-pill';
      else if (a.severity === 'WARNING') severityClass = 'status-pill';

      let statusClass = 'green-pill';
      if (a.status === 'ACTIVE') statusClass = 'red-pill';

      tr.innerHTML = `
        <td style="padding: 12px 8px; font-family: monospace;">${a.id}</td>
        <td style="padding: 12px 8px; font-weight: 600;">${a.type}</td>
        <td style="padding: 12px 8px;">
          <span class="status-pill ${severityClass}">${a.severity}</span>
        </td>
        <td style="padding: 12px 8px; font-weight: 500;">${a.message}</td>
        <td style="padding: 12px 8px; text-align: right; color: var(--text-secondary);">${new Date(a.timestamp).toLocaleTimeString()}</td>
        <td style="padding: 12px 8px; text-align: center;">
          <span class="status-pill ${statusClass}">${a.status}</span>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }
}

// Append data to moving Chart.js Economic Trends chart
function updateEconomicChart(forecast) {
  const timestamp = new Date(forecast.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (timeLabels.length === 0 || timeLabels[timeLabels.length - 1] !== timestamp) {
    timeLabels.push(timestamp);
    
    forecast.regions.forEach(r => {
      if (regionHistory[r.name]) {
        regionHistory[r.name].push(r.gdpGrowth);
      }
    });

    if (timeLabels.length > MAX_HISTORY_POINTS) {
      timeLabels.shift();
      Object.keys(regionHistory).forEach(k => regionHistory[k].shift());
    }

    gdpChartInstance.data.labels = timeLabels;
    gdpChartInstance.data.datasets[0].data = regionHistory["North America"];
    gdpChartInstance.data.datasets[1].data = regionHistory["Eurozone"];
    gdpChartInstance.data.datasets[2].data = regionHistory["Asia-Pacific"];
    gdpChartInstance.update('none'); // silent update
  }
}

// Render dynamic representation of Kubernetes pods
function updateK8sPods(state) {
  const container = document.getElementById('pod-visualizer');
  const countBadge = document.getElementById('pod-count-badge');
  container.innerHTML = '';
  
  countBadge.textContent = `${state.replicas} Pods`;

  for (let i = 1; i <= state.replicas; i++) {
    const pod = document.createElement('div');
    pod.className = 'pod-node';
    
    let stateIcon = 'fa-solid fa-cube';
    
    // Add status specific animation classes to pod representations
    if (state.crisisType === 'region_outage' && state.status === 'CRISIS_DETECTED') {
      pod.classList.add('failed');
      stateIcon = 'fa-solid fa-triangle-exclamation';
    } else if (state.crisisType !== null && i > 3 && state.status === 'CRISIS_DETECTED') {
      pod.classList.add('scaling');
      stateIcon = 'fa-solid fa-spinner';
    } else if (state.status === 'AUTOSCALING' && i > 3) {
      pod.classList.add('scaling');
      stateIcon = 'fa-solid fa-spinner';
    } else {
      // Running normal
      pod.classList.add('running');
    }

    pod.innerHTML = `
      <i class="${stateIcon}"></i>
      <span>chronos-core-${Math.random().toString(36).substring(2, 7)}</span>
    `;
    container.appendChild(pod);
  }
}

// Update the timeline steps based on Express server simulation state machine
function updateSelfHealingTimeline(state) {
  const stepDetect = document.getElementById('step-detect');
  const stepMitigate = document.getElementById('step-mitigate');
  const stepScaling = document.getElementById('step-scaling');
  const stepHeal = document.getElementById('step-heal');
  const badge = document.getElementById('chaos-state-badge');

  // Reset steps
  [stepDetect, stepMitigate, stepScaling, stepHeal].forEach(s => s.className = 'timeline-step');

  if (state.crisisType === null) {
    badge.textContent = 'Idle';
    badge.className = 'status-pill';
    stepHeal.classList.add('completed');
  } else {
    badge.textContent = `Event: ${state.crisisType.toUpperCase().replace('_', ' ')}`;
    badge.className = 'status-pill status-active';
    badge.style.color = '#F43F5E';
    badge.style.borderColor = 'rgba(244,63,94,0.4)';
    badge.style.background = 'rgba(244,63,94,0.1)';

    if (state.status === 'CRISIS_DETECTED') {
      stepDetect.classList.add('active');
    } else if (state.status === 'AUTOSCALING' || state.status === 'FAILOVER_ACTIVE') {
      stepDetect.classList.add('completed');
      stepMitigate.classList.add('active');
    } else if (state.status === 'RECOVERING') {
      stepDetect.classList.add('completed');
      stepMitigate.classList.add('completed');
      stepScaling.classList.add('active');
    }
  }
}

// Print streamed logger logs to black console terminal
function updateLogTerminal(logs) {
  const terminal = document.getElementById('log-terminal');
  
  // Quick optimization: only rebuild when count changes or list differs
  const currentLinesCount = terminal.children.length;
  if (currentLinesCount !== logs.length) {
    terminal.innerHTML = '';
    logs.forEach(l => {
      const timeStr = new Date(l.timestamp).toLocaleTimeString();
      const line = document.createElement('div');
      line.className = 'log-line';
      line.innerHTML = `
        <span class="time">[${timeStr}]</span>
        <span class="level level-${l.level}">${l.level}</span>
        <span class="comp">&lt;${l.component}&gt;</span>
        <span class="msg">${l.message}</span>
      `;
      terminal.appendChild(line);
    });
    // Auto scroll to latest logs
    terminal.scrollTop = terminal.scrollHeight;
  }
}

// Handle dynamic display of keys fetched from local secure micro-Vault
async function updateVaultView(response) {
  const container = document.getElementById('vault-secrets-view');
  const statusPill = document.getElementById('vault-status-pill');
  const statusText = document.getElementById('vault-status-text');

  if (response.status === 200) {
    const body = await response.json();
    container.textContent = JSON.stringify(body.data, null, 2);
    statusPill.className = 'status-pill green-pill';
    statusPill.textContent = 'Active';
    statusText.textContent = 'UNSEALED (OPERATIONAL)';
    statusText.style.color = '#10B981';
  } else {
    const errorBody = await response.json();
    container.textContent = errorBody.message;
    statusPill.className = 'status-pill red-pill';
    statusPill.textContent = 'Sealed';
    statusText.textContent = 'SEALED (SECURITY LOCKED)';
    statusText.style.color = '#F43F5E';
  }
}

// Trigger Crisis Simulation Call
async function triggerCrisis(type) {
  try {
    const res = await fetch('/api/crisis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type })
    });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
    } else {
      pollData();
    }
  } catch (err) {
    console.error('Failed to trigger crisis:', err);
  }
}

// Reset entire simulation state
async function resetState() {
  try {
    await fetch('/api/reset', { method: 'POST' });
    pollData();
  } catch (err) {
    console.error('Failed to reset system state:', err);
  }
}
