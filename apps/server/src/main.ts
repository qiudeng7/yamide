import { NestFactory } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { AppModule } from './app.module.js';
import { WorkspacesService } from './workspaces/workspaces.service.js';
import type { Event } from './workspaces/model.js';

async function bootstrap() {
  const token = process.env.YAMIDE_TOKEN;
  if (!token || token.length < 24)
    throw new Error('Set YAMIDE_TOKEN to a secret of at least 24 characters');
  const authorized = (value: unknown) =>
    typeof value === 'string' &&
    Buffer.byteLength(value) === Buffer.byteLength(token) &&
    timingSafeEqual(Buffer.from(value), Buffer.from(token));
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(express.json({ limit: '2mb' }));
  app.enableCors({
    origin: process.env.YAMIDE_ORIGINS?.split(',') ?? [
      'http://localhost:5173',
      'https://localhost',
      'http://localhost',
    ],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (
      req.path.startsWith('/api') &&
      !authorized(req.headers.authorization?.replace(/^Bearer /, ''))
    ) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    next();
  });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  const manager = app.get(WorkspacesService);
  const server = new WebSocketServer({
    server: app.getHttpServer(),
    path: '/ws',
    maxPayload: 128 * 1024,
  });
  server.on('connection', (socket) => {
    let attached: { wid: string; rid: string } | undefined;
    let listener: ((event: Event) => void) | undefined;
    const send = (message: unknown) => {
      if (socket.readyState === WebSocket.OPEN) {
        if (socket.bufferedAmount > 2 * 1024 * 1024)
          socket.close(1013, 'Slow client');
        else socket.send(JSON.stringify(message));
      }
    };
    const timer = setTimeout(
      () => socket.close(1008, 'Authenticate first'),
      5000,
    );
    socket.on('error', () => socket.close());
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse((Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as ArrayBuffer)).toString()) as {
          type: string;
          token?: string;
          wid?: string;
          rid?: string;
          data?: string;
          cols?: number;
          rows?: number;
        };
        if (!attached) {
          if (
            message.type !== 'attach' ||
            !authorized(message.token) ||
            !message.wid ||
            !message.rid
          ) {
            socket.close(1008, 'Unauthorized');
            return;
          }
          manager.resource(message.wid, message.rid);
          attached = { wid: message.wid, rid: message.rid };
          clearTimeout(timer);
          listener = (event: Event) => {
            if (
              event.resourceId === attached?.rid ||
              event.type === 'workspace-removed'
            )
              send({ type: 'event', event });
          };
          manager.events.on(attached.wid, listener);
          send({
            type: 'snapshot',
            resource: manager.resource(attached.wid, attached.rid),
            events:
              manager.histories.get(`${attached.wid}:${attached.rid}`) ?? [],
          });
          return;
        }
        if (message.type === 'input')
          manager.input(attached.wid, attached.rid, message.data!);
        if (message.type === 'resize')
          manager.resize(
            attached.wid,
            attached.rid,
            message.cols!,
            message.rows!,
          );
        if (message.type === 'ping') send({ type: 'pong' });
      } catch (e) {
        send({
          type: 'error',
          message: e instanceof Error ? e.message : 'Invalid message',
        });
      }
    });
    socket.on('close', () => {
      clearTimeout(timer);
      if (attached && listener) manager.events.off(attached.wid, listener);
    });
  });
  await app.listen(
    Number(process.env.PORT ?? 3000),
    process.env.HOST ?? '0.0.0.0',
  );
}
await bootstrap();
