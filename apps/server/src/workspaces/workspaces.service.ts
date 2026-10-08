import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { EventEmitter } from 'node:events';
import * as pty from 'node-pty';
import { stopProcessTree } from './process-tree.js';
import { runtimeEnvironment } from './environment.js';
import { AgentRuntime } from './agent.js';
import type { AgentConfig, Event, Resource, Workspace } from './model.js';

@Injectable()
export class WorkspacesService implements OnModuleDestroy {
  readonly events = new EventEmitter();
  readonly workspaces = new Map<string, Workspace>();
  readonly terminals = new Map<string, pty.IPty>();
  readonly agents = new Map<string, AgentRuntime>();
  readonly histories = new Map<string, Event[]>();
  readonly agentConfigs: AgentConfig[];
  private sequence = 0;
  private readonly stateFile = resolve(
    process.env.YAMIDE_STATE_DIR ?? resolve(homedir(), '.yamide'),
    'workspaces.json',
  );
  readonly root = resolve(process.env.YAMIDE_ROOT ?? homedir());

  constructor() {
    this.events.setMaxListeners(200);
    this.agentConfigs = JSON.parse(
      process.env.YAMIDE_AGENTS ?? '[]',
    ) as AgentConfig[];
    if (
      !Array.isArray(this.agentConfigs) ||
      this.agentConfigs.some(
        (a) =>
          !a.id ||
          !a.command ||
          !a.name ||
          (a.args && !a.args.every((v) => typeof v === 'string')),
      )
    )
      throw new Error('Invalid YAMIDE_AGENTS');
    mkdirSync(dirname(this.stateFile), { recursive: true, mode: 0o700 });
    if (existsSync(this.stateFile)) {
      const saved = JSON.parse(
        readFileSync(this.stateFile, 'utf8'),
      ) as Workspace[];
      for (const w of saved) {
        for (const r of w.resources)
          if (r.type !== 'explorer') r.status = 'exited';
        this.workspaces.set(w.id, w);
      }
      this.persist();
    }
  }
  persist() {
    writeFileSync(
      `${this.stateFile}.tmp`,
      JSON.stringify([...this.workspaces.values()], null, 2),
      { mode: 0o600 },
    );
    renameSync(`${this.stateFile}.tmp`, this.stateFile);
  }
  get(id: string) {
    const w = this.workspaces.get(id);
    if (!w) throw new NotFoundException('Workspace not found');
    return w;
  }
  resource(wid: string, rid: string) {
    const r = this.get(wid).resources.find((r) => r.id === rid);
    if (!r) throw new NotFoundException('Resource not found');
    return r;
  }
  emit(wid: string, resourceId: string, type: string, data: unknown) {
    const event: Event = { seq: ++this.sequence, resourceId, type, data };
    if (type === 'removed') {
      this.events.emit(wid, event);
      return;
    }
    const key = `${wid}:${resourceId}`;
    const history = this.histories.get(key) ?? [];
    history.push(event);
    // Bounded replay: at most ~1 MiB for each resource.
    while (history.length > 512 || JSON.stringify(history).length > 1024 * 1024)
      history.shift();
    this.histories.set(key, history);
    this.events.emit(wid, event);
  }
  status(wid: string, r: Resource, status: Resource['status'], error?: string) {
    r.status = status;
    r.error = error;
    this.persist();
    this.emit(wid, r.id, 'status', { ...r });
  }
  async create(name: string, directory: string) {
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 100 ||
      typeof directory !== 'string'
    )
      throw new BadRequestException('Name and directory required');
    const root = await realpath(this.root);
    const dir = await realpath(resolve(root, directory));
    this.within(root, dir);
    if (!(await stat(dir)).isDirectory())
      throw new BadRequestException('Not a directory');
    const w: Workspace = {
      id: randomUUID(),
      name: name.trim(),
      directory: dir,
      createdAt: new Date().toISOString(),
      resources: [
        { id: randomUUID(), type: 'explorer', name: '文件', status: 'idle' },
      ],
    };
    this.workspaces.set(w.id, w);
    this.persist();
    return w;
  }
  within(root: string, path: string) {
    const rel = relative(root, path);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new BadRequestException('Path outside workspace');
  }
  async path(wid: string, path: string, creating = false) {
    if (typeof path !== 'string' || path.includes('\0'))
      throw new BadRequestException('Invalid path');
    const root = await realpath(this.get(wid).directory);
    const target = resolve(root, path);
    this.within(root, target);
    const actual =
      creating && !existsSync(target)
        ? resolve(
            await realpath(dirname(target)),
            relative(dirname(target), target),
          )
        : await realpath(target);
    this.within(root, actual);
    return actual;
  }
  async files(wid: string, path = '.') {
    const dir = await this.path(wid, path);
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .map((e) => ({
        name: e.name,
        directory: e.isDirectory(),
        symlink: e.isSymbolicLink(),
      }))
      .sort(
        (a, b) =>
          Number(b.directory) - Number(a.directory) ||
          a.name.localeCompare(b.name),
      );
  }
  async read(wid: string, path: string) {
    const file = await this.path(wid, path);
    if ((await stat(file)).size > 1024 * 1024)
      throw new BadRequestException('File exceeds 1 MiB');
    const buffer = await readFile(file);
    if (buffer.includes(0)) throw new BadRequestException('Binary file');
    return { content: buffer.toString('utf8') };
  }
  async write(wid: string, path: string, content: string) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > 1024 * 1024)
      throw new BadRequestException('Invalid content');
    await writeFile(await this.path(wid, path, true), content, 'utf8');
    return { ok: true };
  }
  async add(wid: string, type: 'terminal' | 'agent', agentId?: string) {
    const w = this.get(wid);
    if (!['terminal', 'agent'].includes(type))
      throw new BadRequestException('Unsupported resource');
    if (w.resources.length >= 32)
      throw new BadRequestException('Resource limit reached');
    const config =
      type === 'agent'
        ? this.agentConfigs.find((a) => a.id === agentId)
        : undefined;
    if (type === 'agent' && !config)
      throw new BadRequestException('Unknown agent configuration');
    const r: Resource = {
      id: randomUUID(),
      type,
      name: config?.name ?? '终端',
      status: 'idle',
      agentId,
    };
    w.resources.push(r);
    this.persist();
    try {
      if (type === 'terminal') this.startTerminal(w, r);
      else {
        const agent = new AgentRuntime(this, w, r, config!);
        this.agents.set(r.id, agent);
        await agent.start();
      }
    } catch (e) {
      this.status(wid, r, 'error', String(e));
    }
    return r;
  }
  private startTerminal(w: Workspace, r: Resource) {
    const proc = pty.spawn(process.env.SHELL ?? '/bin/bash', [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: w.directory,
      env: { ...runtimeEnvironment(), TERM: 'xterm-256color' },
    });
    this.terminals.set(r.id, proc);
    this.status(w.id, r, 'running');
    proc.onData((data) => {
      if (this.workspaces.has(w.id)) this.emit(w.id, r.id, 'output', data);
    });
    proc.onExit(({ exitCode }) => {
      this.terminals.delete(r.id);
      r.exitCode = exitCode;
      if (this.workspaces.has(w.id) && w.resources.includes(r))
        this.status(w.id, r, 'exited');
    });
  }
  input(wid: string, rid: string, data: string) {
    this.resource(wid, rid);
    const t = this.terminals.get(rid);
    if (!t) throw new ConflictException('Terminal exited');
    if (typeof data !== 'string' || data.length > 65536)
      throw new BadRequestException('Invalid input');
    t.write(data);
  }
  resize(wid: string, rid: string, cols: number, rows: number) {
    this.resource(wid, rid);
    if (
      !Number.isInteger(cols) ||
      !Number.isInteger(rows) ||
      cols < 2 ||
      rows < 1 ||
      cols > 500 ||
      rows > 500
    )
      throw new BadRequestException('Invalid size');
    this.terminals.get(rid)?.resize(cols, rows);
  }
  removeResource(wid: string, rid: string) {
    const w = this.get(wid);
    this.resource(wid, rid);
    w.resources = w.resources.filter((r) => r.id !== rid);
    const terminal = this.terminals.get(rid);
    if (terminal) stopProcessTree(terminal.pid);
    this.terminals.delete(rid);
    this.agents.get(rid)?.dispose();
    this.agents.delete(rid);
    this.histories.delete(`${wid}:${rid}`);
    this.persist();
    this.emit(wid, rid, 'removed', null);
  }
  remove(wid: string) {
    const w = this.get(wid);
    this.workspaces.delete(wid);
    for (const r of w.resources) {
      const terminal = this.terminals.get(r.id);
      if (terminal) stopProcessTree(terminal.pid);
      this.terminals.delete(r.id);
      this.agents.get(r.id)?.dispose();
      this.agents.delete(r.id);
      this.histories.delete(`${wid}:${r.id}`);
    }
    this.persist();
    this.events.emit(wid, {
      seq: ++this.sequence,
      resourceId: '',
      type: 'workspace-removed',
      data: null,
    });
    this.events.removeAllListeners(wid);
  }
  agent(wid: string, rid: string) {
    this.resource(wid, rid);
    const a = this.agents.get(rid);
    if (!a) throw new ConflictException('Agent exited');
    return a;
  }
  onModuleDestroy() {
    for (const t of this.terminals.values()) stopProcessTree(t.pid);
    for (const a of this.agents.values()) a.dispose();
  }
}
