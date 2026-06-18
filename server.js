const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Structured JSON Logging Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    // Log API requests (exclude frontend static assets to maintain clean container logs)
    if (req.originalUrl.startsWith('/api') || req.originalUrl === '/health' || req.originalUrl === '/metrics' || req.originalUrl === '/version') {
      const duration = Date.now() - start;
      const log = {
        timestamp: new Date().toISOString(),
        endpoint: req.originalUrl,
        method: req.method,
        status: res.statusCode,
        response_time: `${duration}ms`
      };
      console.log(JSON.stringify(log));

      // Dynamic real-time metrics tracking
      systemState.totalRequests = (systemState.totalRequests || 0) + 1;
      if (res.statusCode >= 400) {
        systemState.totalErrors = (systemState.totalErrors || 0) + 1;
      }
    }
  });
  next();
});

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
let currentDbPassword = process.env.DB_PASSWORD || 'SuperSecurePassword123';

// Self-healing startup initialization with automatic reconnect retries
async function initializeApp() {
  if (isInitializing) return;
  isInitializing = true;

  const vaultAddr = process.env.VAULT_ADDR || 'http://127.0.0.1:8200';
  const vaultToken = process.env.VAULT_TOKEN || 'myroottoken';
  
  let dbUser = process.env.DB_USER || 'postgres';
  let dbPassword = currentDbPassword;
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
        currentDbPassword = dbPassword; // Sync state
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

let artificialLatency = 0;
let cpuBurnerInterval = null;
let trafficSurgeInterval = null;

const { Worker } = require('worker_threads');
let cpuWorkers = [];

function startCpuBurner() {
  stopCpuBurner();
  for (let i = 0; i < 2; i++) {
    try {
      const worker = new Worker(`
        const { parentPort } = require('worker_threads');
        let running = true;
        parentPort.on('message', (msg) => {
          if (msg === 'stop') {
            process.exit(0);
          }
        });
        function burn() {
          if (!running) return;
          const start = Date.now();
          while (Date.now() - start < 80) {
            Math.random() * Math.random();
          }
          setTimeout(burn, 20);
        }
        burn();
      `, { eval: true });
      cpuWorkers.push(worker);
    } catch (err) {
      console.error("[Self-Healing] Failed to spawn CPU burner worker thread:", err.message);
    }
  }
}

function stopCpuBurner() {
  cpuWorkers.forEach(w => {
    try {
      w.postMessage('stop');
      w.terminate();
    } catch (e) {}
  });
  cpuWorkers = [];
}

// Helpers to query active database state
async function queryState() {
  if (artificialLatency > 0) {
    await new Promise(resolve => setTimeout(resolve, artificialLatency));
  }
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

    // Event-loop safe background CPU burner using worker threads
    startCpuBurner();

    setTimeout(async () => {
      const curState = await queryState();
      curState.status = "AUTOSCALING";
      curState.replicas = 6;
      await updateState(curState);
      await addLog("INFO", "HorizontalPodAutoscaler: Scaled replicas from 3 to 6 to handle traffic spike.", "orchestrator");
    }, 3000);

    setTimeout(async () => {
      // Cease CPU load during recovery phase
      stopCpuBurner();

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
      const rotatedPassword = "SuperSecurePassword_" + Math.random().toString(36).substring(2, 10);
      
      // 1. Rotate the PostgreSQL password in the database
      if (dbPool) {
        try {
          await dbPool.query(`ALTER USER postgres WITH PASSWORD '${rotatedPassword}'`);
          console.log("[Self-Healing] PostgreSQL password rotated successfully in DB.");
        } catch (err) {
          console.error("[Self-Healing] Failed to alter PostgreSQL password in DB:", err.message);
        }
      }

      // 2. Write rotated credentials to HashiCorp Vault KV v2 engine
      const vaultAddr = process.env.VAULT_ADDR || 'http://127.0.0.1:8200';
      const vaultToken = process.env.VAULT_TOKEN || 'myroottoken';
      try {
        await fetch(`${vaultAddr}/v1/secret/data/chronosai/database`, {
          method: 'POST',
          headers: { 'X-Vault-Token': vaultToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: {
              db_username: "postgres",
              db_password: rotatedPassword,
              last_rotation: new Date().toISOString(),
              rotation_reason: "Cyber Attack Mitigation - Automated IPS Action",
              jwt_signing_key: "HS256-vault-managed-token-key-chronosai-platform-2026"
            }
          })
        });
        console.log("[Self-Healing] Rotated database credentials saved to Vault.");
      } catch (err) {
        console.warn("[Cyber Attack simulation] Real Vault write error:", err.message);
      }

      // 3. Recreate the database connection pool with the new rotated password
      currentDbPassword = rotatedPassword;
      if (dbPool) {
        const oldPool = dbPool;
        dbPool = null;
        oldPool.end().catch(() => {});
      }

      const dbHost = process.env.DB_HOST || '127.0.0.1';
      const dbName = process.env.DB_NAME || 'chronosai_forecasting';
      dbPool = new Pool({
        user: 'postgres',
        password: rotatedPassword,
        host: dbHost,
        database: dbName,
        port: 5432,
        connectionTimeoutMillis: 3000
      });
      console.log("[Self-Healing] Recreated database pool with rotated credentials.");

      const curState = await queryState();
      curState.vaultStatus = "CONNECTED";
      curState.dbStatus = "CONNECTED";
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

    // Proper Load: Inject real query delay latency into database handler queries
    artificialLatency = 350;

    await addLog("CRITICAL", "Health Check: AWS Region 'us-east-1' network connectivity loss detected.", "dns-routing");
    await addLog("WARNING", "Database read replica latency exceeded SLA (350ms).", "database");

    setTimeout(async () => {
      const curState = await queryState();
      curState.status = "FAILOVER_ACTIVE";
      await updateState(curState);
      await addLog("INFO", "Global Traffic Manager: Initiating DNS route failover to region 'eu-west-1'.", "dns-routing");
    }, 2500);

    setTimeout(async () => {
      // Clear artificial delay upon routing recovery
      artificialLatency = 0;

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

    // Proper Load: Flood Express endpoints internally to trigger real HTTP traffic peaks
    if (trafficSurgeInterval) clearInterval(trafficSurgeInterval);
    trafficSurgeInterval = setInterval(() => {
      for (let i = 0; i < 40; i++) {
        fetch(`http://127.0.0.1:${PORT}/health`).catch(() => {});
      }
    }, 100);

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
      // Halt internal flood traffic generator during scaling stabilization
      if (trafficSurgeInterval) {
        clearInterval(trafficSurgeInterval);
        trafficSurgeInterval = null;
      }

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
  // Clear any active simulated load intervals
  if (cpuBurnerInterval) {
    clearInterval(cpuBurnerInterval);
    cpuBurnerInterval = null;
  }
  if (trafficSurgeInterval) {
    clearInterval(trafficSurgeInterval);
    trafficSurgeInterval = null;
  }
  stopCpuBurner();
  artificialLatency = 0;

  // Restore default PostgreSQL credentials if they were rotated
  if (currentDbPassword !== "SuperSecurePassword123") {
    if (dbPool) {
      try {
        await dbPool.query(`ALTER USER postgres WITH PASSWORD 'SuperSecurePassword123'`);
        console.log("[Self-Healing] Restored default database password.");
      } catch (err) {
        console.error("[Self-Healing] Failed to restore default DB password:", err.message);
      }
    }

    const vaultAddr = process.env.VAULT_ADDR || 'http://127.0.0.1:8200';
    const vaultToken = process.env.VAULT_TOKEN || 'myroottoken';
    try {
      await fetch(`${vaultAddr}/v1/secret/data/chronosai/database`, {
        method: 'POST',
        headers: { 'X-Vault-Token': vaultToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            db_username: "postgres",
            db_password: "SuperSecurePassword123",
            last_rotation: new Date().toISOString(),
            rotation_reason: "Simulation Reset to Default Credentials",
            jwt_signing_key: "HS256-vault-managed-token-key-chronosai-platform-2026"
          }
        })
      });
      console.log("[Self-Healing] Restored default Vault credentials.");
    } catch (err) {
      console.error("[Self-Healing] Failed to restore Vault credentials:", err.message);
    }

    currentDbPassword = "SuperSecurePassword123";
    if (dbPool) {
      const oldPool = dbPool;
      dbPool = null;
      oldPool.end().catch(() => {});
    }

    const dbHost = process.env.DB_HOST || '127.0.0.1';
    const dbName = process.env.DB_NAME || 'chronosai_forecasting';
    dbPool = new Pool({
      user: 'postgres',
      password: 'SuperSecurePassword123',
      host: dbHost,
      database: dbName,
      port: 5432,
      connectionTimeoutMillis: 3000
    });
  }

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
    vaultStatus: "CONNECTED",
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

// ==========================================================================
// Case Study DevOps Endpoints
// ==========================================================================

// Liveness/Readiness probe
app.get('/health', (req, res) => {
  res.json({
    status: "healthy",
    service: "chronosai-api",
    timestamp: new Date().toISOString()
  });
});

// Version endpoint
app.get('/version', (req, res) => {
  res.json({
    version: "2.4.1",
    buildNumber: "142",
    environment: "Production (EKS)",
    pipelineStatus: "SUCCESS",
    lastDeploymentTime: "2026-06-18T12:00:00Z"
  });
});

// Prometheus Scrape Endpoint
app.get('/metrics', async (req, res) => {
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

// Jobs API for Analytics tab
app.get('/api/jobs', async (req, res) => {
  const state = await queryState();
  
  let runningCount = 2;
  let completedCount = 124;
  let failedCount = 3;
  let avgProcessingTime = 14.2;
  
  if (state.crisisType === "analytical_surge") {
    runningCount = 8;
    completedCount = 142;
    avgProcessingTime = 22.4;
  } else if (state.crisisType === "market_crash") {
    runningCount = 5;
    completedCount = 118;
    failedCount = 8;
    avgProcessingTime = 18.6;
  } else if (state.crisisType === "region_outage") {
    runningCount = 1;
    failedCount = 12;
  }

  const jobsList = [
    { id: "JOB-4812", name: "Macroeconomic Trend Analysis - APAC", status: state.crisisType === "region_outage" ? "FAILED" : "RUNNING", duration: "12s", timestamp: new Date(Date.now() - 12000).toISOString() },
    { id: "JOB-4811", name: "Commodity Index Forecasting", status: "RUNNING", duration: "4s", timestamp: new Date(Date.now() - 4000).toISOString() },
    { id: "JOB-4810", name: "Inflation Impact Simulator", status: "COMPLETED", duration: "18s", timestamp: new Date(Date.now() - 30000).toISOString() },
    { id: "JOB-4809", name: "Regional Trade Flow Predictor", status: "COMPLETED", duration: "24s", timestamp: new Date(Date.now() - 60000).toISOString() },
    { id: "JOB-4808", name: "Federal Reserve Decision Risk Assessment", status: state.crisisType === "market_crash" ? "FAILED" : "COMPLETED", duration: "15s", timestamp: new Date(Date.now() - 90000).toISOString() }
  ];

  if (state.crisisType === "analytical_surge") {
    jobsList.unshift(
      { id: "JOB-4816", name: "Surge Analysis - Logistics Flow", status: "RUNNING", duration: "2s", timestamp: new Date().toISOString() },
      { id: "JOB-4815", name: "Surge Analysis - Port Congestion", status: "RUNNING", duration: "5s", timestamp: new Date(Date.now() - 5000).toISOString() },
      { id: "JOB-4814", name: "Surge Analysis - Freight Rates", status: "RUNNING", duration: "8s", timestamp: new Date(Date.now() - 8000).toISOString() }
    );
  }

  res.json({
    runningCount,
    completedCount,
    failedCount,
    avgProcessingTime,
    jobs: jobsList
  });
});

// Alerts API for Alerts tab
app.get('/api/alerts', async (req, res) => {
  const state = await queryState();
  const alertsList = [];

  if (state.crisisType === "market_crash") {
    alertsList.push({
      id: "ALT-280",
      type: "High CPU Alert",
      message: `System CPU load is abnormally high: ${state.cpuLoad}%`,
      severity: "WARNING",
      timestamp: new Date().toISOString(),
      status: "ACTIVE"
    });
  } else if (state.crisisType === "cyber_attack") {
    alertsList.push({
      id: "ALT-281",
      type: "Security Event",
      message: "Security Event: Vault auto-sealed due to brute force signature attempts.",
      severity: "CRITICAL",
      timestamp: new Date().toISOString(),
      status: "ACTIVE"
    });
  } else if (state.crisisType === "region_outage") {
    alertsList.push({
      id: "ALT-282",
      type: "Region Failure",
      message: "Infrastructure Incident: Active region 'us-east-1' network connectivity loss.",
      severity: "CRITICAL",
      timestamp: new Date().toISOString(),
      status: "ACTIVE"
    });
  } else if (state.crisisType === "analytical_surge") {
    alertsList.push({
      id: "ALT-283",
      type: "Infrastructure Incident",
      message: "Autoscaling Alert: Ingestion queue limits exceeded threshold.",
      severity: "INFO",
      timestamp: new Date().toISOString(),
      status: "ACTIVE"
    });
  }

  const historyAlerts = [
    { id: "ALT-278", type: "Service Recovery Event", message: "Database read replica failover successfully resolved", severity: "INFO", timestamp: new Date(Date.now() - 3600000).toISOString(), status: "RESOLVED" },
    { id: "ALT-277", type: "Failed Deployment", message: "Deployment version rollback: v2.4.0 failed health check in dev environment", severity: "WARNING", timestamp: new Date(Date.now() - 7200000).toISOString(), status: "RESOLVED" },
    { id: "ALT-276", type: "Security Event", message: "Rotated root TLS certificates in secure Vault path", severity: "INFO", timestamp: new Date(Date.now() - 86400000).toISOString(), status: "RESOLVED" }
  ];

  res.json([...alertsList, ...historyAlerts]);
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  const log = {
    timestamp: new Date().toISOString(),
    endpoint: req.originalUrl,
    method: req.method,
    status: 500,
    error: err.message
  };
  console.error(JSON.stringify(log));
  res.status(500).json({
    status: "error",
    message: "Internal Server Error",
    timestamp: new Date().toISOString()
  });
});

// Boot application
initializeApp().then(() => {
  app.listen(PORT, () => {
    console.log(`ChronosAI App is running on port ${PORT}`);
  });
});
