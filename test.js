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
    console.log('1. Testing /api/state...');
    const state = await fetchJson('http://localhost:4000/api/state');
    assert(state.status === 'OPTIMAL', 'Status should be OPTIMAL');
    assert(state.replicas === 3, 'Default replicas should be 3');
    assert(state.dbStatus === 'CONNECTED', 'Database should be connected');
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
    assert(secrets.status === 'SUCCESS', 'Vault retrieval status should be SUCCESS');
    assert(secrets.secret_path.includes('chronosai'), 'Vault path matches config');
    console.log('PASS: /api/sim-secrets retrieves encrypted data.');

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
