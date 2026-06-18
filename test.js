const { spawn } = require('child_process');
const http = require('http');

console.log('Starting integration test suite...');

// Spawn the express server
const server = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: '4000' }
});

let serverOutput = '';
server.stdout.on('data', (data) => {
  serverOutput += data.toString();
});

server.stderr.on('data', (data) => {
  console.error(`Server error output: ${data}`);
});

// Wait for server to start, then run tests
setTimeout(async () => {
  if (!serverOutput.includes('ChronosAI App is running on port 4000')) {
    console.log('Server output:', serverOutput);
    console.error('FAIL: Server did not start correctly.');
    cleanup(1);
  }

  try {
    console.log('0. Resetting state...');
    await postJson('http://localhost:4000/api/reset');

    console.log('1. Testing /api/state...');
    const state = await fetchJson('http://localhost:4000/api/state');
    assert(state.status === 'OPTIMAL', 'Status should be OPTIMAL');
    assert(state.replicas === 3, 'Default replicas should be 3');
    assert(typeof state.dbStatus === 'string', 'Database status field should be present');
    console.log('PASS: /api/state matches schema.');

    console.log('2. Testing /api/forecast...');
    const forecast = await fetchJson('http://localhost:4000/api/forecast');
    assert(Array.isArray(forecast.regions), 'Regions should be an array');
    assert(forecast.regions.length > 0, 'Regions should not be empty');
    assert(forecast.regions[0].gdpGrowth > 0, 'GDP Growth should be positive');
    console.log('PASS: /api/forecast returns valid economic data.');

    console.log('3. Testing /api/sim-metrics (Prometheus scraping)...');
    const text = await fetchText('http://localhost:4000/api/sim-metrics');
    assert(text.includes('chronosai_cpu_utilization'), 'Metrics should expose chronosai_cpu_utilization');
    assert(text.includes('chronosai_active_pods'), 'Metrics should expose chronosai_active_pods');
    console.log('PASS: /api/sim-metrics formatted correctly for Prometheus.');

    console.log('4. Testing /api/sim-logs (ELK stack logging)...');
    const logs = await fetchJson('http://localhost:4000/api/sim-logs');
    assert(Array.isArray(logs), 'Logs should be an array');
    assert(logs.length > 0, 'Logs list should not be empty');
    console.log('PASS: /api/sim-logs returns active systems logs.');

    console.log('5. Testing /api/sim-secrets (Vault service)...');
    const secrets = await fetchJson('http://localhost:4000/api/sim-secrets');
    assert(secrets.status === 'SUCCESS' || secrets.status === 'ERROR', 'Vault retrieval status should be SUCCESS or ERROR');
    console.log('PASS: /api/sim-secrets returns valid Vault status.');

    console.log('6. Testing /health (Kubernetes Liveness check)...');
    const health = await fetchJson('http://localhost:4000/health');
    assert(health.status === 'healthy', 'Health check should be healthy');
    assert(health.service === 'chronosai-api', 'Service tag should match');
    console.log('PASS: /health check succeeds.');

    console.log('7. Testing /version (App version tag)...');
    const version = await fetchJson('http://localhost:4000/version');
    assert(version.version === '2.4.1', 'Version should match EKS tag');
    console.log('PASS: /version matches build manifest.');

    console.log('8. Testing /metrics (Case study Prometheus endpoint)...');
    const metricsTxt = await fetchText('http://localhost:4000/metrics');
    assert(metricsTxt.includes('chronosai_cpu_utilization'), 'Metrics should expose CPU Load');
    assert(metricsTxt.includes('chronosai_active_pods'), 'Metrics should expose Pod count');
    console.log('PASS: /metrics exposes Prometheus metrics.');

    console.log('9. Testing /api/jobs (Analytics jobs feed)...');
    const jobs = await fetchJson('http://localhost:4000/api/jobs');
    assert(typeof jobs.runningCount === 'number', 'Running count should be numerical');
    assert(Array.isArray(jobs.jobs), 'Jobs list should be an array');
    console.log('PASS: /api/jobs returns active job batches.');

    console.log('10. Testing /api/alerts (Observability incidents stream)...');
    const alerts = await fetchJson('http://localhost:4000/api/alerts');
    assert(Array.isArray(alerts), 'Alerts list should be an array');
    assert(alerts.length > 0, 'Alerts list should contain items');
    console.log('PASS: /api/alerts returns DevOps logs.');

    console.log('ALL TESTS PASSED SUCCESSFULLY!');
    cleanup(0);
  } catch (error) {
    console.error('TEST SUITE FAILED:', error.message);
    cleanup(1);
  }
}, 2000);

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON response: ${data.slice(0, 100)}`));
        }
      });
    }).on('error', reject);
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function cleanup(exitCode) {
  console.log('Shutting down test server...');
  server.kill();
  process.exit(exitCode);
}

function postJson(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = http.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({});
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify({}));
    req.end();
  });
}
