import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';

/** Exercise the real CLI entry, without a fixture or operational store. */
export async function probeEntrypoint(root, directory, environment) {
  await mkdir(directory, { recursive: true });
  const reservation = createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const port = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(root, 'dist/server/index.js')], {
    cwd: root,
    env: { ...environment, HOST: '127.0.0.1', PORT: String(port), APP_ORIGIN: origin, SIDAKSA_DATA_DIR: directory },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let startupOutput = '';
  let exited = false;
  const completion = new Promise(resolve => child.once('exit', (code, signal) => { exited = true; resolve({ code, signal }); }));
  child.stderr.on('data', () => {}); // Do not forward private environment diagnostics.
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Compiled CLI entry did not become ready.')), 15000);
      const ready = () => { clearTimeout(timer); resolve(); };
      child.stdout.on('data', chunk => {
        startupOutput += chunk.toString();
        if (startupOutput.includes(`SIDAKSA tersedia di ${origin}`)) ready();
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      completion.then(() => { clearTimeout(timer); reject(new Error('Compiled CLI entry exited before readiness.')); });
    });
    const get = route => fetch(origin + route, { signal: AbortSignal.timeout(10000) });
    const health = await get('/api/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');
    const beforeLock = await readFile(path.join(directory, '.runtime.lock'), 'utf8');
    const duplicate = spawn(process.execPath, [path.join(root, 'dist/server/index.js')], {
      cwd: root, env: { ...environment, HOST: '127.0.0.1', PORT: String(port), APP_ORIGIN: origin, SIDAKSA_DATA_DIR: directory },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let duplicateOutput = '';
    duplicate.stdout.on('data', chunk => { duplicateOutput += chunk.toString(); });
    duplicate.stderr.on('data', () => {});
    const duplicateCode = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { duplicate.kill(); reject(new Error('Duplicate CLI did not exit.')); }, 10000);
      duplicate.once('error', error => { clearTimeout(timer); reject(error); });
      duplicate.once('exit', code => { clearTimeout(timer); resolve(code); });
    });
    assert.equal(duplicateCode, 0, 'Repeated npm start must acknowledge the verified active instance, not print a generic failure.');
    assert(duplicateOutput.includes(`SIDAKSA sudah berjalan di ${origin}`));
    assert.equal(await readFile(path.join(directory, '.runtime.lock'), 'utf8'), beforeLock);
    assert.equal((await get('/api/health')).status, 200);
    const config = await (await get('/api/public-config')).json();
    assert.equal(config.authConfigured, false);
    assert.equal(config.supabaseUrl, null);
    assert.equal(config.supabasePublishableKey, null);
    assert.equal((await get('/api/overview')).status, 401);
    const page = await get('/');
    assert.equal(page.status, 200);
    assert((await page.text()).includes('id="root"'));
    assert.equal((await get('/.private/data/state.json')).status, 404);
    assert.equal((await get('/.env')).status, 404);
    return { directNodeProcess: 'passed', duplicateCli: 'exit0-existing-instance-verified; no second writer or lock change', publicConfiguration: 'unconfigured-fail-closed', health: 200, spa: 200, anonymous: 401, privateFile: 404,
      cleanup: 'owned-process-exit-observed; caller-removes-isolated-directory', liveIntegration: false };
  } finally {
    // Windows process termination need not run JS signal handlers. The caller
    // removes only this disposable store after process exit has been observed.
    if (!exited) child.kill('SIGTERM');
    await Promise.race([completion, new Promise((_, reject) => {
      const timer = setTimeout(() => { if (!exited) child.kill('SIGKILL'); reject(new Error('CLI child did not exit.')); }, 10000);
      timer.unref();
    })]);
  }
}
