import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { WorkspacesService } from './workspaces.service.js';
@Controller()
export class WorkspacesController {
  constructor(private readonly manager: WorkspacesService) {}
  @Get('config') config() {
    return {
      root: this.manager.root,
      agents: this.manager.agentConfigs.map((a) => ({
        id: a.id,
        name: a.name,
      })),
    };
  }
  @Get('workspaces') list() {
    return [...this.manager.workspaces.values()];
  }
  @Post('workspaces') create(
    @Body() body: { name: string; directory: string },
  ) {
    return this.manager.create(body.name, body.directory);
  }
  @Get('workspaces/:wid') get(@Param('wid') wid: string) {
    return this.manager.get(wid);
  }
  @Delete('workspaces/:wid') remove(@Param('wid') wid: string) {
    this.manager.remove(wid);
    return { ok: true };
  }
  @Post('workspaces/:wid/resources') add(
    @Param('wid') wid: string,
    @Body() body: { type: 'terminal' | 'agent'; agentId?: string },
  ) {
    return this.manager.add(wid, body.type, body.agentId);
  }
  @Delete('workspaces/:wid/resources/:rid') removeResource(
    @Param('wid') wid: string,
    @Param('rid') rid: string,
  ) {
    this.manager.removeResource(wid, rid);
    return { ok: true };
  }
  @Get('workspaces/:wid/files') files(
    @Param('wid') wid: string,
    @Query('path') path?: string,
  ) {
    return this.manager.files(wid, path);
  }
  @Get('workspaces/:wid/file') read(
    @Param('wid') wid: string,
    @Query('path') path: string,
  ) {
    return this.manager.read(wid, path);
  }
  @Put('workspaces/:wid/file') write(
    @Param('wid') wid: string,
    @Body() body: { path: string; content: string },
  ) {
    return this.manager.write(wid, body.path, body.content);
  }
  @Post('workspaces/:wid/resources/:rid/prompt') prompt(
    @Param('wid') wid: string,
    @Param('rid') rid: string,
    @Body() body: { text: string },
  ) {
    return this.manager.agent(wid, rid).prompt(body.text);
  }
  @Post('workspaces/:wid/resources/:rid/cancel') cancel(
    @Param('wid') wid: string,
    @Param('rid') rid: string,
  ) {
    return this.manager.agent(wid, rid).cancel();
  }
  @Get('workspaces/:wid/resources/:rid/permissions') permissions(
    @Param('wid') wid: string,
    @Param('rid') rid: string,
  ) {
    return this.manager.agent(wid, rid).permissions();
  }
  @Post('workspaces/:wid/resources/:rid/permissions/:pid') permission(
    @Param('wid') wid: string,
    @Param('rid') rid: string,
    @Param('pid') pid: string,
    @Body() body: { optionId?: string },
  ) {
    return this.manager.agent(wid, rid).permission(pid, body.optionId);
  }
}
