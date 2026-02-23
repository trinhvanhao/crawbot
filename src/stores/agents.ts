/**
 * Agents State Store
 * Manages OpenClaw agent configuration state
 */
import { create } from 'zustand';
import type {
  Agent,
  AgentDefaults,
  AgentCreateInput,
  AgentUpdateInput,
  WorkspaceFile,
} from '../types/agent';

interface AgentsState {
  agents: Agent[];
  defaults: AgentDefaults | null;
  loading: boolean;
  error: string | null;
  selectedAgent: Agent | null;
  workspaceFiles: WorkspaceFile[];
  selectedFile: { name: string; content: string } | null;

  // Actions
  fetchAgents: () => Promise<void>;
  createAgent: (input: AgentCreateInput) => Promise<Agent>;
  updateAgent: (id: string, updates: AgentUpdateInput) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  setSelectedAgent: (agent: Agent | null) => void;
  fetchWorkspaceFiles: (workspacePath: string) => Promise<void>;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<void>;
  setSelectedFile: (file: { name: string; content: string } | null) => void;
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: [],
  defaults: null,
  loading: false,
  error: null,
  selectedAgent: null,
  workspaceFiles: [],
  selectedFile: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });

    try {
      const result = (await window.electron.ipcRenderer.invoke('agent:list')) as {
        success: boolean;
        agents?: Agent[];
        defaults?: AgentDefaults;
        error?: string;
      };

      if (result.success) {
        const agents = result.agents ?? [];
        const currentSelected = get().selectedAgent;
        // Update selected agent if it still exists
        const updatedSelected = currentSelected
          ? agents.find((a) => a.id === currentSelected.id) ?? null
          : null;
        set({
          agents,
          defaults: result.defaults ?? null,
          selectedAgent: updatedSelected,
          loading: false,
        });
      } else {
        set({ error: result.error ?? 'Failed to load agents', loading: false });
      }
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  createAgent: async (input) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('agent:create', {
        id: input.id,
        name: input.name,
        emoji: input.emoji,
        workspace: input.workspace,
        model: input.model,
        isDefault: input.isDefault,
      })) as { success: boolean; agent?: Agent; error?: string };

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to create agent');
      }

      const agent = result.agent!;
      // Re-fetch to get the full updated list
      await get().fetchAgents();
      return agent;
    } catch (error) {
      console.error('Failed to create agent:', error);
      throw error;
    }
  },

  updateAgent: async (id, updates) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('agent:update', id, updates)) as {
        success: boolean;
        agent?: Agent;
        error?: string;
      };

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to update agent');
      }

      // Re-fetch to get the full updated list
      await get().fetchAgents();
    } catch (error) {
      console.error('Failed to update agent:', error);
      throw error;
    }
  },

  deleteAgent: async (id) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('agent:delete', id)) as {
        success: boolean;
        error?: string;
      };

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to delete agent');
      }

      set((state) => ({
        agents: state.agents.filter((a) => a.id !== id),
        selectedAgent: state.selectedAgent?.id === id ? null : state.selectedAgent,
      }));
    } catch (error) {
      console.error('Failed to delete agent:', error);
      throw error;
    }
  },

  setSelectedAgent: (agent) => {
    set({ selectedAgent: agent, workspaceFiles: [], selectedFile: null });
  },

  fetchWorkspaceFiles: async (workspacePath) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke(
        'agent:getWorkspaceFiles',
        workspacePath
      )) as { success: boolean; files?: WorkspaceFile[]; error?: string };

      if (result.success) {
        set({ workspaceFiles: result.files ?? [] });
      }
    } catch (error) {
      console.error('Failed to fetch workspace files:', error);
    }
  },

  readFile: async (filePath) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke('agent:readFile', filePath)) as {
        success: boolean;
        content?: string;
        error?: string;
      };

      if (result.success) {
        return result.content ?? '';
      }
      throw new Error(result.error ?? 'Failed to read file');
    } catch (error) {
      console.error('Failed to read file:', error);
      throw error;
    }
  },

  writeFile: async (filePath, content) => {
    try {
      const result = (await window.electron.ipcRenderer.invoke(
        'agent:writeFile',
        filePath,
        content
      )) as { success: boolean; error?: string };

      if (!result.success) {
        throw new Error(result.error ?? 'Failed to write file');
      }
    } catch (error) {
      console.error('Failed to write file:', error);
      throw error;
    }
  },

  setSelectedFile: (file) => set({ selectedFile: file }),
}));
