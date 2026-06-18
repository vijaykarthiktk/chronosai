const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Global state representation (runs in memory as fallback, mirrors database if connected)
let systemState = {
  status: "OPTIMAL",
  crisisType: null,
  replicas: 3,
  cpuLoad: 14.2,
  ramUsage: 27.5,
  requestRate: 420,
  errorRate: 0.01,
  dbStatus: "DISCONNECTED",
  vaultStatus: "DISCONNECTED",
  primaryRegion: "us-east-1",
  failoverRegion: "eu-west-1",
  activeRegion: "us-east-1",
  healedCount: 0,
  dbLatency: 4,
  totalRequests: 843202,
  totalErrors: 84
};

// Database connection pool reference
let dbPool = null;
let isInitializing = false;

// Self-healing startup initialization with automatic reconnect retries
async function initializeApp() {
  if (isInitializing) return;
  isInitializing = true;

  const vaultAddr = process.env.VAULT_ADDR || 'http://127.0.0.1:8200';
  const vaultToken = process.env.VAULT_TOKEN || 'myroottoken';
  
  let dbUser = process.env.DB_USER || 'postgres';
  let dbPassword = process.env.DB_PASSWORD || 'SuperSecurePassword123';
  const dbHost = process.env.DB_HOST || '127.0.0.1';
  const dbName = process.env.DB_NAME || 'chronosai_forecasting';

  console.log(`[Self-Healing] Querying Vault credentials at: ${vaultAddr}...`);
  try {
    const vaultRes = await fetch(`${vaultAddr}/v1/secret/data/chronosai/database`, {
      method: 'GET',
      headers: { 'X-Vault-Token': vaultToken }
    });

    if (vaultRes.ok) {
      const data = await vaultRes.json();
      if (data && data.data && data.data.data) {
        dbUser = data.data.data.db_username || dbUser;
        dbPassword = data.data.data.db_password || dbPassword;
        systemState.vaultStatus = "CONNECTED";
        console.log("[Self-Healing] Vault connection: OPERATIONAL");
      }
    } else {
      console.warn(`[Self-Healing] Vault returned status ${vaultRes.status}. Using fallback credentials.`);
      systemState.vaultStatus = "SEALED";
    }
  } catch (err) {
    console.warn(`[Self-Healing] Vault connection failed (${err.message}). Retrying in 10s...`);
    systemState.vaultStatus = "DISCONNECTED";
  }

  // PostgreSQL pool initialization
  console.log(`[Self-Healing] Connecting to PostgreSQL at: ${dbHost}:5432...`);
  const pool = new Pool({
    user: dbUser,
    password: dbPassword,
    host: dbHost,
    database: dbName,
    port: 5432,
    connectionTimeoutMillis: 3000
  });

  try {
    const client = await pool.connect();
    console.log("[Self-Healing] PostgreSQL connection pool: ESTABLISHED");
    systemState.dbStatus = "CONNECTED";
    dbPool = pool;

    // Run database schemas provisioning
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_state (
        id INT PRIMARY KEY,
        status VARCHAR(50),
        crisis_type VARCHAR(50),
        replicas INT,
        cpu_load NUMERIC(5,2),
        ram_usage NUMERIC(5,2),
        request_rate INT,
        error_rate NUMERIC(5,2),
        db_status VARCHAR(20),
        vault_status VARCHAR(20),
        active_region VARCHAR(50),
        healed_count INT,
        db_latency INT,
        total_requests INT,
        total_errors INT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS economic_indicators (
        region VARCHAR(50) PRIMARY KEY,
        gdp_growth NUMERIC(5,2),
        cpi_inflation NUMERIC(5,2),
        unemployment NUMERIC(5,2),
        risk_index INT,
        logistics_score INT,
        model_status VARCHAR(20)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS system_logs (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        level VARCHAR(20),
        message TEXT,
        component VARCHAR(50)
      )
    `);

    // Seed data
    const stateCount = await client.query(`SELECT COUNT(*) FROM system_state`);
    if (parseInt(stateCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO system_state (id, status, crisis_type, replicas, cpu_load, ram_usage, request_rate, error_rate, db_status, vault_status, active_region, healed_count, db_latency, total_requests, total_errors)
        VALUES (1, 'OPTIMAL', NULL, 3, 14.2, 27.5, 420, 0.01, 'CONNECTED', 'CONNECTED', 'us-east-1', 0, 4, 843202, 84)
      `);
    }

    const indicatorCount = await client.query(`SELECT COUNT(*) FROM economic_indicators`);
    if (parseInt(indicatorCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO economic_indicators (region, gdp_growth, cpi_inflation, unemployment, risk_index, logistics_score, model_status) VALUES
        ('North America', 2.4, 3.1, 3.8, 15, 92, 'OPTIMAL'),
        ('Eurozone', 1.2, 2.6, 6.4, 22, 88, 'OPTIMAL'),
        ('Asia-Pacific', 4.8, 2.0, 4.2, 18, 95, 'OPTIMAL'),
        ('Latin America', 1.8, 5.2, 7.8, 40, 74, 'OPTIMAL')
      `);
    }

    const logCount = await client.query(`SELECT COUNT(*) FROM system_logs`);
    if (parseInt(logCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO system_logs (level, message, component) VALUES
        ('INFO', 'System initialized successfully on EKS cluster', 'orchestrator'),
        ('INFO', 'Successfully fetched DB credentials from HashiCorp Vault', 'security'),
        ('INFO', 'Database connection pool established', 'database'),
        ('INFO', 'Prometheus scraping active on /api/sim-metrics', 'monitoring'),
        ('INFO', 'ChronosAI Forecasting Engine loaded model weights v4.2.1', 'analytics')
      `);
    }

    client.release();
    isInitializing = false;
  } catch (err) {
    console.warn(`[Self-Healing] PostgreSQL connection failed (${err.message}). Retrying in 10s...`);
    systemState.dbStatus = "DISCONNECTED";
    dbPool = null;
    pool.end();
    isInitializing = false;
    // Schedule retry loop
    setTimeout(initializeApp, 10000);
  }
}

// Helpers to query active database state
async function queryState() {
  // If connection is lost, try to reinitialize
  if (!dbPool) {
    initializeApp();
    return systemState;
  }
  try {
    const res = await dbPool.query(`SELECT * FROM system_state WHERE id = 1`);
    if (res.rows.length > 0) {
      const dbRow = res.rows[0];
      systemState = {
        status: dbRow.status,
        crisisType: dbRow.crisis_type,
        replicas: dbRow.replicas,
        cpuLoad: parseFloat(dbRow.cpu_load),
        ramUsage: parseFloat(dbRow.ram_usage),
        requestRate: dbRow.request_rate,
        errorRate: parseFloat(dbRow.error_rate),
        dbStatus: dbRow.db_status,
        vaultStatus: dbRow.vault_status,
        primaryRegion: "us-east-1",
        failoverRegion: "eu-west-1",
        activeRegion: dbRow.active_region,
        healedCount: dbRow.healed_count,
        dbLatency: dbRow.db_latency,
        totalRequests: dbRow.total_requests,
        totalErrors: dbRow.total_errors
      };
    }
  } catch (err) {
    console.error("[Self-Healing] Lost PG connection. Falling back to memory.", err.message);
    systemState.dbStatus = "DISCONNECTED";
    dbPool = null;
    initializeApp(); // Schedule reconnect immediately
  }
  return systemState;
}

async function updateState(newState) {
  Object.assign(systemState, newState);
  if (!dbPool) return;
  try {
    await dbPool.query(`
      UPDATE system_state SET
        status = $1, crisis_type = $2, replicas = $3, cpu_load = $4, ram_usage = $5,
        request_rate = $6, error_rate = $7, db_status = $8, vault_status = $9,
        active_region = $10, healed_count = $11, db_latency = $12,
        total_requests = $13, total_errors = $14
      WHERE id = 1
    `, [
      systemState.status, systemState.crisisType, systemState.replicas, systemState.cpuLoad,
      systemState.ramUsage, systemState.requestRate, systemState.errorRate, systemState.dbStatus,
      systemState.vaultStatus, systemState.activeRegion, systemState.healedCount, systemState.dbLatency,
      systemState.totalRequests, systemState.totalErrors
    ]);
  } catch (err) {
    console.error("[Self-Healing] Failed to update DB state:", err.message);
    systemState.dbStatus = "DISCONNECTED";
    dbPool = null;
  }
}

async function addLog(level, message, component) {
  console.log(`[${level}] <${component}> ${message}`);
  if (!dbPool) return;
  try {
    await dbPool.query(`
      INSERT INTO system_logs (level, message, component)
      VALUES ($1, $2, $3)
    `, [level, message, component]);
  } catch (err) {
    console.error("[Self-Healing] Failed to log to DB:", err.message);
    systemState.dbStatus = "DISCONNECTED";
    dbPool = null;
  }
}

// Background simulation loop
setInterval(async () => {
  const state = await queryState();
  state.totalRequests += Math.floor(Math.random() * 10) + 2;

  if (state.crisisType === null) {
    state.cpuLoad = Math.max(10, Math.min(25, +(state.cpuLoad + (Math.random() - 0.5) * 2).toFixed(1)));
    state.ramUsage = Math.max(25, Math.min(30, +(state.ramUsage + (Math.random() - 0.5) * 0.5).toFixed(1)));
    state.requestRate = Math.max(380, Math.min(460, Math.floor(state.requestRate + (Math.random() - 0.5) * 20)));
    state.dbLatency = Math.max(2, Math.min(8, Math.floor(state.dbLatency + (Math.random() - 0.5) * 2)));
    state.dbStatus = dbPool ? "CONNECTED" : "DISCONNECTED";
  } else {
    if (state.crisisType === "analytical_surge" && state.status === "AUTOSCALING") {
      state.cpuLoad = Math.max(90, Math.min(99, +(state.cpuLoad + (Math.random() - 0.5)).toFixed(1)));
    } else if (state.crisisType === "analytical_surge" && state.status === "RECOVERING") {
      state.cpuLoad = Math.max(25, Math.min(35, +(state.cpuLoad + (Math.random() - 0.5)).toFixed(1)));
    }
  }

  await updateState(state);
}, 3000);

// API Endpoints
app.get('/api/state', async (req, res) => {
  const state = await queryState();
  res.json(state);
});

// Economic Forecasting Data Query
app.get('/api/forecast', async (req, res) => {
  let multiplier = 1.0;
  let riskFactor = 1.0;
  const state = await queryState();

  if (state.crisisType === "market_crash") {
    multiplier = 0.4;
    riskFactor = 4.5;
  } else if (state.crisisType === "region_outage") {
    multiplier = 0.85;
    riskFactor = 1.8;
  } else if (state.crisisType === "cyber_attack") {
    multiplier = 0.7;
    riskFactor = 3.0;
  }

  if (dbPool) {
    try {
      const indicators = await dbPool.query(`SELECT * FROM economic_indicators`);
      const regionsMapped = indicators.rows.map(r => ({
        name: r.region,
        gdpGrowth: +(parseFloat(r.gdp_growth) * multiplier).toFixed(2),
        cpiInflation: +(parseFloat(r.cpi_inflation) * (riskFactor > 1 ? 1.8 : 1.0)).toFixed(2),
        unemployment: +(parseFloat(r.unemployment) * (riskFactor > 1 ? 1.5 : 1.0)).toFixed(2),
        riskIndex: Math.min(100, Math.floor(r.risk_index * riskFactor)),
        logisticsScore: Math.floor(r.logistics_score - (riskFactor - 1) * 10),
        forecastingModelStatus: state.status === "CRISIS_DETECTED" && state.crisisType === "region_outage" && r.region === "North America" ? "DEGRADED" : r.model_status
      }));

      return res.json({
        timestamp: new Date().toISOString(),
        regions: regionsMapped,
        commodities: {
          brentCrude: +(82.5 * (state.crisisType === "market_crash" ? 0.6 : 1.0)).toFixed(2),
          goldSpot: +(2320 * (riskFactor > 1 ? 1.3 : 1.0)).toFixed(0),
          balticDryIndex: Math.floor(1850 * multiplier)
        }
      });
    } catch (err) {
      console.error("DB error fetching forecast:", err.message);
    }
  }

  // Fallback economic indices
  res.json({
    timestamp: new Date().toISOString(),
    regions: [
      { name: "North America", gdpGrowth: +(2.4 * multiplier).toFixed(2), cpiInflation: +(3.1 * (riskFactor > 1 ? 1.8 : 1.0)).toFixed(2), unemployment: 3.8, riskIndex: Math.floor(15 * riskFactor), logisticsScore: 92, forecastingModelStatus: "OPTIMAL" },
      { name: "Eurozone", gdpGrowth: +(1.2 * multiplier).toFixed(2), cpiInflation: +(2.6 * (riskFactor > 1 ? 2.0 : 1.0)).toFixed(2), unemployment: 6.4, riskIndex: Math.floor(22 * riskFactor), logisticsScore: 88, forecastingModelStatus: "OPTIMAL" },
      { name: "Asia-Pacific", gdpGrowth: +(4.8 * multiplier).toFixed(2), cpiInflation: 2.0, unemployment: 4.2, riskIndex: Math.floor(18 * riskFactor), logisticsScore: 95, forecastingModelStatus: "OPTIMAL" },
      { name: "Latin America", gdpGrowth: +(1.8 * multiplier).toFixed(2), cpiInflation: 5.2, unemployment: 7.8, riskIndex: Math.floor(40 * riskFactor), logisticsScore: 74, forecastingModelStatus: "OPTIMAL" }
    ],
    commodities: { brentCrude: 82.5, goldSpot: 2320, balticDryIndex: 1850 }
  });
});

// Prometheus Scrape Endpoint
app.get('/api/sim-metrics', async (req, res) => {
  const state = await queryState();
  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  const metrics = `
# HELP chronosai_cpu_utilization CPU utilization percentage
# TYPE chronosai_cpu_utilization gauge
chronosai_cpu_utilization ${state.cpuLoad}

# HELP chronosai_memory_utilization RAM utilization percentage
# TYPE chronosai_memory_utilization gauge
chronosai_memory_utilization ${state.ramUsage}

# HELP chronosai_http_requests_total Total HTTP requests processed
# TYPE chronosai_http_requests_total counter
chronosai_http_requests_total ${state.totalRequests}

# HELP chronosai_http_errors_total Total HTTP errors encountered
# TYPE chronosai_http_errors_total counter
chronosai_http_errors_total ${state.totalErrors}

# HELP chronosai_active_pods Active replica count
# TYPE chronosai_active_pods gauge
chronosai_active_pods ${state.replicas}

# HELP chronosai_database_connected Database connectivity state (1 = connected, 0 = disconnected)
# TYPE chronosai_database_connected gauge
chronosai_database_connected ${state.dbStatus === "CONNECTED" ? 1 : 0}

# HELP chronosai_vault_connected HashiCorp Vault connection status (1 = operational, 0 = sealed/error)
# TYPE chronosai_vault_connected gauge
chronosai_vault_connected ${state.vaultStatus === "CONNECTED" ? 1 : 0}

# HELP chronosai_active_region Current active deployment region (1 = US East, 2 = EU West)
# TYPE chronosai_active_region gauge
chronosai_active_region ${state.activeRegion === "us-east-1" ? 1 : 2}
`;
  res.send(metrics);
});

// Logs Endpoint from DB
app.get('/api/sim-logs', async (req, res) => {
  if (dbPool) {
    try {
      const logs = await dbPool.query(`SELECT level, message, component, timestamp FROM system_logs ORDER BY id DESC LIMIT 50`);
      return res.json(logs.rows.reverse());
    } catch (err) {
      console.error("DB error fetching logs:", err.message);
    }
  }

  // Fallback logs
  res.json([
    { timestamp: new Date().toISOString(), level: "INFO", message: "Operating in internal memory fallback mode. Database connection offline.", component: "database" }
  ]);
});

// Secrets Endpoint for Vault
app.get('/api/sim-secrets', (req, res) => {
  if (systemState.vaultStatus === "CONNECTED") {
    res.json({
      status: "SUCCESS",
      secret_path: "secret/data/chronosai/database",
      fetched_at: new Date().toISOString(),
      keys: ["db_username", "db_password_hash", "jwt_signing_key"],
      data: {
        db_username: "postgres",
        jwt_signing_key: "HS256-vault-managed-token-key-********"
      }
    });
  } else {
    res.status(503).json({
      status: "ERROR",
      message: "Vault connection unavailable: Vault is currently SEALED or security lock in progress"
    });
  }
});

// Trigger a Crisis / Failure Scenario
app.post('/api/crisis', async (req, res) => {
  const { type } = req.body;
  if (!["market_crash", "cyber_attack", "region_outage", "analytical_surge"].includes(type)) {
    return res.status(400).json({ error: "Invalid crisis type" });
  }

  const state = await queryState();
  if (state.crisisType !== null) {
    return res.status(400).json({ error: "A crisis simulation is already running. Reset first." });
  }

  state.crisisType = type;
  state.status = "CRISIS_DETECTED";

  if (type === "market_crash") {
    state.requestRate = 1450;
    state.cpuLoad = 82.5;
    state.errorRate = 4.2;
    state.totalErrors += 18;
    await updateState(state);

    await addLog("ERROR", "Global Economic Event: Market Crash detected. Critical analytical request surge.", "gateway");
    await addLog("WARNING", "CPU utilization exceeded threshold (80%). Triggering scaling request.", "orchestrator");

    setTimeout(async () => {
      const curState = await queryState();
      curState.status = "AUTOSCALING";
      curState.replicas = 6;
      await updateState(curState);
      await addLog("INFO", "HorizontalPodAutoscaler: Scaled replicas from 3 to 6 to handle traffic spike.", "orchestrator");
    }, 3000);

    setTimeout(async () => {
      const curState = await queryState();
      curState.status = "RECOVERING";
      curState.errorRate = 0.5;
      curState.cpuLoad = 45.3;
      await updateState(curState);
      await addLog("INFO", "Traffic load distributed across expanded pod replicas. Error rates resolving.", "load-balancer");
    }, 6000);

    setTimeout(async () => {
      const curState = await queryState();
      curState.status = "OPTIMAL";
      curState.crisisType = null;
      curState.healedCount += 1;
      await updateState(curState);
      await addLog("INFO", "ChronosAI forecasting models recalibrated. System status restored to OPTIMAL.", "analytics");
    }, 10000);

  } else if (type === "cyber_attack") {
    state.errorRate = 35.8;
    state.vaultStatus = "LOCKED";
    state.totalErrors += 140;
    await updateState(state);

    await addLog("CRITICAL", "Intrusion Detection: Unauthorized signature attempts detected on JWT validation endpoint.", "security");
    await addLog("CRITICAL", "Vault Auto-Seal: HashiCorp Vault automatically sealed to prevent token exfiltration.", "security");

    setTimeout(async () => {
      const curState = await queryState();
      curState.status = "RECOVERING";
      await updateState(curState);
      await addLog("INFO", "Web Application Firewall: Blocked attacking IPs. IPS signatures updated.", "security");
      await addLog("INFO", "Orchestrator: Initializing secure credential rotation cycle.", "orchestrator");
    }, 3000);

    setTimeout(async () => {
      const curState = await queryState();
      curState.vaultStatus = "CONNECTED";
      curState.errorRate = 0.1;
      await updateState(curState);
      await addLog("INFO", "Vault Admin Tool: Unsealed HashiCorp Vault using shamir split keys. Rotated DB secrets.", "security");
    }, 6000);

    setTimeout(async () => {
      const curState = await queryState();
      curState.status = "OPTIMAL";
      curState.crisisType = null;
      curState.healedCount += 1;
      await updateState(curState);
      await addLog("INFO", "Security Audit: Incident resolved, all systems verified and operational.", "security");
    }, 9000);

  } else if (type === "region_outage") {
    state.activeRegion = "us-east-1 (FAILING)";
    state.errorRate = 64.0;
    state.dbLatency = 350;
    state.totalErrors += 250;
    await updateState(state);

    await addLog("CRITICAL", "Health Check: AWS Region 'us-east-1' network connectivity loss detected.", "dns-routing");
    await addLog("WARNING", "Database read replica latency exceeded SLA (350ms).", "database");

    setTimeout(async () => {
      const curState = await queryState();
      curState.status = "FAILOVER_ACTIVE";
      await updateState(curState);
      await addLog("INFO", "Global Traffic Manager: Initiating DNS route failover to region 'eu-west-1'.", "dns-routing");
    }, 2500);

    setTimeout(async () => {
      const curState = await queryState();
      curState.activeRegion = "eu-west-1";
      curState.status = "RECOVERING";
      curState.errorRate = 1.2;
      curState.dbLatency = 12;
      await updateState(curState);
      await addLog("INFO", "Failover routing complete. Traffic directed to active cluster in 'eu-west-1'.", "dns-routing");
      await addLog("INFO", "Database Failover: Promoted 'eu-west-1' PostgreSQL read-replica to Primary.", "database");
    }, 6000);

    setTimeout(async () => {
      const curState = await queryState();
      curState.status = "OPTIMAL";
      curState.crisisType = null;
      curState.healedCount += 1;
      await updateState(curState);
      await addLog("INFO", "Failover completed successfully. All economic forecast requests processed by EU West cluster.", "orchestrator");
    }, 9500);

  } else if (type === "analytical_surge") {
    state.requestRate = 2800;
    state.cpuLoad = 96.5;
    state.errorRate = 8.4;
    state.totalErrors += 42;
    await updateState(state);

    await addLog("INFO", "Logistics Watchdog: Unprecedented surge in ocean shipping data logs ingestion request.", "analytics");
    await addLog("WARNING", "Kubernetes Node Autoscale: Requesting additional provisioned nodes from AWS AutoScaling Group.", "orchestrator");

    setTimeout(async () => {
      const curState = await queryState();
      curState.status = "AUTOSCALING";
      curState.replicas = 8;
      await updateState(curState);
      await addLog("INFO", "HorizontalPodAutoscaler: Spawning analytical pod replicas from 3 to 8.", "orchestrator");
    }, 3000);

    setTimeout(async () => {
      const curState = await queryState();
      curState.status = "RECOVERING";
      curState.cpuLoad = 32.5;
      curState.errorRate = 0.05;
      await updateState(curState);
      await addLog("INFO", "Worker Pool: Analytical workloads distributed across 8 active pods. Processing queue back to normal.", "analytics");
    }, 7000);

    setTimeout(async () => {
      const curState = await queryState();
      curState.status = "OPTIMAL";
      curState.replicas = 3;
      curState.crisisType = null;
      curState.healedCount += 1;
      await updateState(curState);
      await addLog("INFO", "Kubernetes HPA: Analytical workloads stabilized. Scaling replicas back down to 3.", "orchestrator");
    }, 12000);
  }

  res.json({ status: "CRISIS_TRIGGERED", type: type });
});

// Reset System State
app.post('/api/reset', async (req, res) => {
  const curState = await queryState();
  const resetObj = {
    status: "OPTIMAL",
    crisisType: null,
    replicas: 3,
    cpuLoad: 14.5,
    ramUsage: 27.2,
    requestRate: 420,
    errorRate: 0.01,
    dbStatus: dbPool ? "CONNECTED" : "DISCONNECTED",
    vaultStatus: curState.vaultStatus === "CONNECTED" ? "CONNECTED" : "CONNECTED",
    activeRegion: "us-east-1",
    healedCount: curState.healedCount,
    dbLatency: 4,
    totalRequests: curState.totalRequests,
    totalErrors: curState.totalErrors
  };
  await updateState(resetObj);
  await addLog("INFO", "System state manual reset executed. Setting target state to OPTIMAL.", "orchestrator");
  res.json({ status: "RESET_COMPLETED", state: resetObj });
});

// Boot application
initializeApp().then(() => {
  app.listen(PORT, () => {
    console.log(`ChronosAI App is running on port ${PORT}`);
  });
});
