/**
 * Agent Type Definitions
 * Types for OpenClaw AI agents
 *
 * Schema reference: node_modules/openclaw/dist/plugin-sdk/config/types.agents.d.ts
 */

/**
 * Per-agent model config — can be a simple string or an object with primary + fallbacks
 */
export type AgentModelConfig =
  | string
  | {
      primary?: string;
      fallbacks?: string[];
    };

/**
 * Agent entry in openclaw.json agents.list[]
 *
 * Fields from OpenClaw AgentConfig schema:
 *   id (required), default, name, workspace, agentDir, model,
 *   identity, skills, memorySearch, humanDelay, heartbeat,
 *   groupChat, subagents, sandbox, tools
 */
export interface Agent {
  id: string;
  default?: boolean;
  name?: string;
  workspace?: string;
  agentDir?: string;
  model?: AgentModelConfig;
  identity?: { emoji?: string };
  skills?: string[];
}

/**
 * Agent defaults from openclaw.json agents.defaults
 * Provides fallback values for all agents
 */
export interface AgentDefaults {
  workspace?: string;
  skipBootstrap?: boolean;
  model?: {
    primary?: string;
    fallbacks?: string[];
  };
}

/**
 * Full agents section from openclaw.json
 */
export interface AgentConfig {
  defaults?: AgentDefaults;
  list?: Agent[];
}

/**
 * Workspace file info
 */
export interface WorkspaceFile {
  name: string;
  path: string;
  isDirectory: boolean;
}

/**
 * Input for creating a new agent
 */
export interface AgentCreateInput {
  id: string;
  name: string;
  emoji?: string;
  workspace?: string;
  model?: string;
  isDefault?: boolean;
}

/**
 * Input for updating an agent
 */
export interface AgentUpdateInput {
  name?: string;
  emoji?: string;
  workspace?: string;
  model?: AgentModelConfig | null;
  default?: boolean;
}

/**
 * Resolve the effective model string for an agent,
 * falling back to agents.defaults.model.primary
 */
export function resolveAgentModel(agent: Agent, defaults?: AgentDefaults | null): string | undefined {
  const agentModel = agent.model;
  if (agentModel) {
    if (typeof agentModel === 'string') return agentModel;
    if (agentModel.primary) return agentModel.primary;
  }
  return defaults?.model?.primary;
}

/**
 * Resolve the effective workspace for an agent,
 * falling back to agents.defaults.workspace
 */
export function resolveAgentWorkspace(agent: Agent, defaults?: AgentDefaults | null): string | undefined {
  return agent.workspace || defaults?.workspace;
}

/**
 * Get the display name for an agent (name > id)
 */
export function resolveAgentName(agent: Agent): string {
  return agent.name || agent.id;
}
