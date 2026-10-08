import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
const root = await mkdtemp(resolve(tmpdir(), 'yamide-http-'));
await mkdir(resolve(root, 'project'));
const token = 'smoke-test-token-not-for-production';
const port = 18372;
const processHandle = spawn(process.execPath, ['dist/main.js'], {
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    YAMIDE_TOKEN: token,
    YAMIDE_ROOT: root,
    YAMIDE_STATE_DIR: resolve(root, 'state'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
processHandle.stdout.on('data', (d) => (logs += d));
processHandle.stderr.on('data', (d) => (logs += d));
const base = `http://127.0.0.1:${port}`;
const api = async (path, method = 'GET', body) => {
  const response = await fetch(base + '/api' + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert(response.ok, `${response.status} ${await response.clone().text()}`);
  return response.json();
};
async function attach(wid, rid, auth = token) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'attach', token: auth, wid, rid }));
  return { ws, messages };
}
async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('Timed out');
}
try {
  await until(() => logs.includes('Nest application successfully started'));
  assert.equal((await fetch(base + '/api/workspaces')).status, 401);
  const w = await api('/workspaces', 'POST', {
    name: 'HTTP smoke',
    directory: 'project',
  });
  const t = await api(`/workspaces/${w.id}/resources`, 'POST', {
    type: 'terminal',
  });
  const initial = await attach(w.id, t.id);
  await until(() => initial.messages.some((m) => m.type === 'snapshot'));
  initial.ws.close();
  const detached = await attach(w.id, t.id);
  await until(() => detached.messages.some((m) => m.type === 'snapshot'));
  detached.ws.send(
    JSON.stringify({
      type: 'input',
      data: "sleep 0.1; printf 'SMOKE_RECONNECT_OK\\n'\r",
    }),
  );
  detached.ws.close();
  await new Promise((r) => setTimeout(r, 250));
  const reconnect = await attach(w.id, t.id);
  await until(() => reconnect.messages.some((m) => m.type === 'snapshot'));
  assert(JSON.stringify(reconnect.messages).includes('SMOKE_RECONNECT_OK'));
  assert.equal(reconnect.messages[0].resource.status, 'running');
  const invalid = await attach(w.id, t.id, 'wrong');
  await new Promise((r) =>
    invalid.ws.once('close', (code) => {
      assert.equal(code, 1008);
      r();
    }),
  );
  await api(`/workspaces/${w.id}/file`, 'PUT', {
    path: 'hello.txt',
    content: 'hello',
  });
  assert.equal(
    (await api(`/workspaces/${w.id}/file?path=hello.txt`)).content,
    'hello',
  );
  await api(`/workspaces/${w.id}`, 'DELETE');
  await until(() =>
    reconnect.messages.some(
      (m) => m.type === 'event' && m.event.type === 'workspace-removed',
    ),
  );
  reconnect.ws.close();
  assert.equal((await api('/workspaces')).length, 0);
  console.log(
    'HTTP auth, WebSocket auth, live PTY reconnection, file editing, cascade deletion: passed',
  );
} catch (e) {
  console.error(logs);
  throw e;
} finally {
  processHandle.kill('SIGTERM');
  await new Promise((r) => {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null)
      r();
    else processHandle.once('exit', r);
  });
  await rm(root, { recursive: true, force: true });
}
