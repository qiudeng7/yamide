import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { WorkspacesService } from './workspaces.service.js';
let root: string;
let manager: WorkspacesService;
const prior = { ...process.env };
async function until(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'yamide-test-'));
  await mkdir(resolve(root, 'project'));
  process.env.YAMIDE_ROOT = root;
  process.env.YAMIDE_STATE_DIR = resolve(root, 'state');
  process.env.YAMIDE_AGENTS = JSON.stringify([
    {
      id: 'fixture',
      name: 'Fixture',
      command: process.execPath,
      args: [resolve('test/fixtures/mock-agent.mjs')],
    },
  ]);
  manager = new WorkspacesService();
});
afterEach(async () => {
  manager.onModuleDestroy();
  process.env = prior;
  await rm(root, { recursive: true, force: true });
});
describe('Workspace lifecycle', () => {
  it('retains metadata across restart, marks old processes exited and leaves project files on delete', async () => {
    const w = await manager.create('Test', 'project');
    await writeFile(resolve(w.directory, 'keep.txt'), 'keep');
    const terminal = await manager.add(w.id, 'terminal');
    const restarted = new WorkspacesService();
    expect(
      restarted.get(w.id).resources.find((r) => r.id === terminal.id)?.status,
    ).toBe('exited');
    manager.remove(w.id);
    expect(manager.terminals.has(terminal.id)).toBe(false);
    expect(await readFile(resolve(w.directory, 'keep.txt'), 'utf8')).toBe(
      'keep',
    );
    expect(new WorkspacesService().workspaces.size).toBe(0);
  });
  it('keeps PTY alive with no listeners and replays its output after reconnection', async () => {
    const w = await manager.create('Test', 'project');
    const r = await manager.add(w.id, 'terminal');
    manager.input(w.id, r.id, "printf 'YAMIDE_TEST_OK\\n'\r");
    await until(() =>
      JSON.stringify(manager.histories.get(`${w.id}:${r.id}`)).includes(
        'YAMIDE_TEST_OK',
      ),
    );
    expect(manager.terminals.has(r.id)).toBe(true);
    manager.resize(w.id, r.id, 100, 30);
    expect(manager.terminals.get(r.id)?.cols).toBe(100);
    manager.removeResource(w.id, r.id);
    expect(manager.terminals.has(r.id)).toBe(false);
    expect(manager.histories.has(`${w.id}:${r.id}`)).toBe(false);
  });
  it('blocks traversal and symlink escapes, including writes into external paths', async () => {
    const w = await manager.create('Test', 'project');
    await symlink(root, resolve(w.directory, 'escape'));
    await expect(
      manager.read(w.id, '../state/workspaces.json'),
    ).rejects.toThrow('outside workspace');
    await expect(manager.write(w.id, 'escape/out.txt', 'bad')).rejects.toThrow(
      'outside workspace',
    );
    await manager.write(w.id, 'inside.txt', 'hello');
    expect(await manager.read(w.id, 'inside.txt')).toEqual({
      content: 'hello',
    });
    await expect(manager.add(w.id, 'agent', 'unconfigured')).rejects.toThrow(
      'Unknown agent',
    );
  });
  it('continues ACP task without a client and waits for explicit permission', async () => {
    const w = await manager.create('Agent', 'project');
    const r = await manager.add(w.id, 'agent', 'fixture');
    expect(r.status).toBe('idle');
    const a = manager.agent(w.id, r.id);
    await a.prompt('do work');
    await until(() => a.permissions().length === 1);
    expect(r.status).toBe('busy');
    const permission = a.permissions()[0]!;
    expect(() => a.permission(permission.id, 'unknown')).toThrow(
      'Invalid permission',
    );
    a.permission(permission.id, 'allow');
    await until(() => r.status === 'idle');
    expect(JSON.stringify(manager.histories.get(`${w.id}:${r.id}`))).toContain(
      'approved',
    );
    manager.remove(w.id);
    expect(manager.agents.size).toBe(0);
  });
});
