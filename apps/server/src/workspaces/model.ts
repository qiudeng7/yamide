export type ResourceType = 'explorer' | 'terminal' | 'agent';
export type Resource = {
  id: string;
  type: ResourceType;
  name: string;
  status: 'running' | 'idle' | 'busy' | 'exited' | 'error';
  error?: string;
  exitCode?: number;
  agentId?: string;
};
export type Workspace = {
  id: string;
  name: string;
  directory: string;
  createdAt: string;
  resources: Resource[];
};
export type AgentConfig = {
  id: string;
  name: string;
  command: string;
  args?: string[];
};
export type Event = {
  seq: number;
  resourceId: string;
  type: string;
  data: unknown;
};
