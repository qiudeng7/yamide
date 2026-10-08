import { BadRequestException, ConflictException } from '@nestjs/common';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { stopProcessTree } from './process-tree.js';
import { runtimeEnvironment } from './environment.js';
import * as acp from '@agentclientprotocol/sdk';
import type { WorkspacesService } from './workspaces.service.js';
import type { AgentConfig, Resource, Workspace } from './model.js';

export class AgentRuntime {
  private process?: ChildProcessWithoutNullStreams;
  private connection?: acp.ClientConnection;
  private sessionId?: string;
  private disposed = false;
  private pending = new Map<
    string,
    {
      params: acp.RequestPermissionRequest;
      resolve: (value: acp.RequestPermissionResponse) => void;
    }
  >();
  constructor(
    private manager: WorkspacesService,
    private workspace: Workspace,
    private resource: Resource,
    private config: AgentConfig,
  ) {}
  private emit(type: string, data: unknown) {
    if (!this.disposed)
      this.manager.emit(this.workspace.id, this.resource.id, type, data);
  }
  private status(status: Resource['status'], error?: string) {
    if (!this.disposed)
      this.manager.status(this.workspace.id, this.resource, status, error);
  }
  async start() {
    const proc = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.workspace.directory,
      stdio: 'pipe',
      detached: true,
      env: runtimeEnvironment(),
    });
    this.process = proc;
    proc.on('error', (e) => this.status('error', e.message));
    proc.on('exit', (code) => {
      this.cancelPermissions();
      this.resource.exitCode = code ?? undefined;
      this.status('exited');
    });
    proc.stderr.on('data', (data: Buffer) =>
      this.emit('stderr', data.toString().slice(-8192)),
    );
    this.connection = acp
      .client({ name: 'yamide' })
      .onNotification(acp.methods.client.session.update, (ctx) =>
        this.emit('agent-update', ctx.params.update),
      )
      .onRequest(
        acp.methods.client.session.requestPermission,
        (ctx) =>
          new Promise<acp.RequestPermissionResponse>((resolve) => {
            const id = randomUUID();
            this.pending.set(id, { params: ctx.params, resolve });
            this.emit('permission', { id, ...ctx.params });
          }),
      )
      .onRequest(acp.methods.client.fs.readTextFile, async (ctx) => {
        const { content } = await this.manager.read(
          this.workspace.id,
          ctx.params.path,
        );
        const start = (ctx.params.line ?? 1) - 1;
        return {
          content: content
            .split('\n')
            .slice(
              start,
              ctx.params.limit ? start + ctx.params.limit : undefined,
            )
            .join('\n'),
        };
      })
      .onRequest(acp.methods.client.fs.writeTextFile, async (ctx) => {
        await this.manager.write(
          this.workspace.id,
          ctx.params.path,
          ctx.params.content,
        );
        return {};
      })
      .connect(
        acp.ndJsonStream(
          Writable.toWeb(proc.stdin),
          Readable.toWeb(proc.stdout) as unknown as Parameters<
            typeof acp.ndJsonStream
          >[1],
        ),
      );
    try {
      await Promise.race([
        (async () => {
          await this.connection!.agent.request(acp.methods.agent.initialize, {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientInfo: { name: 'yamide', version: '0.1.0' },
            clientCapabilities: {
              fs: { readTextFile: true, writeTextFile: true },
            },
          });
          const session = await this.connection!.agent.request(
            acp.methods.agent.session.new,
            { cwd: this.workspace.directory, mcpServers: [] },
          );
          this.sessionId = session.sessionId;
        })(),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Agent initialization timed out')),
            30000,
          );
          timer.unref();
        }),
      ]);
      this.status('idle');
    } catch (e) {
      this.connection.close();
      this.kill();
      throw e;
    }
  }
  async prompt(text: string) {
    if (this.resource.status === 'busy')
      throw new ConflictException('Agent busy');
    if (!this.sessionId || !this.connection || this.disposed)
      throw new ConflictException('Agent unavailable');
    if (typeof text !== 'string' || !text.trim() || text.length > 65536)
      throw new BadRequestException('Invalid prompt');
    this.status('busy');
    this.emit('user-message', text);
    // The HTTP request returns immediately; the workspace owns the ongoing task.
    void this.connection.agent
      .request(acp.methods.agent.session.prompt, {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text }],
      })
      .then((result) => {
        this.emit('turn-end', result);
        this.status('idle');
      })
      .catch((e) => {
        this.status('error', String(e));
      })
      .finally(() => this.cancelPermissions());
    return { ok: true };
  }
  async cancel() {
    this.cancelPermissions();
    if (this.sessionId && this.connection)
      await this.connection.agent.notify(acp.methods.agent.session.cancel, {
        sessionId: this.sessionId,
      });
    return { ok: true };
  }
  permissions() {
    return [...this.pending].map(([id, p]) => ({ id, ...p.params }));
  }
  permission(id: string, optionId?: string) {
    const request = this.pending.get(id);
    if (!request) throw new BadRequestException('Permission no longer pending');
    if (
      optionId &&
      !request.params.options.some((o) => o.optionId === optionId)
    )
      throw new BadRequestException('Invalid permission option');
    request.resolve({
      outcome: optionId
        ? { outcome: 'selected', optionId }
        : { outcome: 'cancelled' },
    });
    this.pending.delete(id);
    this.emit('permission-resolved', { id });
    return { ok: true };
  }
  private cancelPermissions() {
    for (const [id, p] of this.pending) {
      p.resolve({ outcome: { outcome: 'cancelled' } });
      this.emit('permission-resolved', { id });
    }
    this.pending.clear();
  }
  private kill() {
    if (
      this.process?.pid &&
      this.process.exitCode === null &&
      this.process.signalCode === null
    )
      stopProcessTree(this.process.pid);
  }
  dispose() {
    this.disposed = true;
    this.cancelPermissions();
    this.connection?.close();
    this.kill();
  }
}
