/**
 * Channels State Store
 * Manages messaging channel state
 */
import { create } from 'zustand';
import type { Channel, ChannelType, AgentBinding } from '../types/channel';

interface AddChannelParams {
  type: ChannelType;
  name: string;
  token?: string;
}

interface ChannelsState {
  channels: Channel[];
  bindings: AgentBinding[];
  loading: boolean;
  error: string | null;

  // Actions
  fetchChannels: () => Promise<void>;
  addChannel: (params: AddChannelParams) => Promise<Channel>;
  deleteChannel: (channelId: string) => Promise<void>;
  connectChannel: (channelId: string) => Promise<void>;
  disconnectChannel: (channelId: string) => Promise<void>;
  requestQrCode: (channelType: ChannelType) => Promise<{ qrCode: string; sessionId: string }>;
  setChannels: (channels: Channel[]) => void;
  updateChannel: (channelId: string, updates: Partial<Channel>) => void;
  clearError: () => void;
  // Binding actions
  fetchBindings: () => Promise<void>;
  setBinding: (agentId: string, channel: string, accountId?: string, session?: string) => Promise<void>;
  removeBinding: (channel: string, accountId?: string) => Promise<void>;
}

export const useChannelsStore = create<ChannelsState>((set, get) => ({
  channels: [],
  bindings: [],
  loading: false,
  error: null,

  fetchChannels: async () => {
    set({ loading: true, error: null });
    try {
      const result = await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'channels.status',
        { probe: true }
      ) as {
        success: boolean;
        result?: {
          channelOrder?: string[];
          channels?: Record<string, unknown>;
          channelAccounts?: Record<string, Array<{
            accountId?: string;
            configured?: boolean;
            connected?: boolean;
            running?: boolean;
            lastError?: string;
            name?: string;
            linked?: boolean;
            lastConnectedAt?: number | null;
            lastInboundAt?: number | null;
            lastOutboundAt?: number | null;
          }>>;
          channelDefaultAccountId?: Record<string, string>;
        };
        error?: string;
      };

      if (result.success && result.result) {
        const data = result.result;
        const channels: Channel[] = [];

        const channelOrder = data.channelOrder || Object.keys(data.channels || {});
        const now = Date.now();
        const RECENT_MS = 10 * 60 * 1000;
        const hasRecentActivity = (a: { lastInboundAt?: number | null; lastOutboundAt?: number | null; lastConnectedAt?: number | null }) =>
          (typeof a.lastInboundAt === 'number' && now - a.lastInboundAt < RECENT_MS) ||
          (typeof a.lastOutboundAt === 'number' && now - a.lastOutboundAt < RECENT_MS) ||
          (typeof a.lastConnectedAt === 'number' && now - a.lastConnectedAt < RECENT_MS);

        for (const channelId of channelOrder) {
          const summary = (data.channels as Record<string, unknown> | undefined)?.[channelId] as Record<string, unknown> | undefined;
          const configured =
            typeof summary?.configured === 'boolean'
              ? summary.configured
              : typeof (summary as { running?: boolean })?.running === 'boolean'
                ? true
                : false;
          if (!configured) continue;

          const accounts = data.channelAccounts?.[channelId] || [];
          const summaryError =
            typeof (summary as { error?: string })?.error === 'string'
              ? (summary as { error?: string }).error
              : typeof (summary as { lastError?: string })?.lastError === 'string'
                ? (summary as { lastError?: string }).lastError
                : undefined;

          // Create one Channel entry per account instead of collapsing to one per type
          if (accounts.length === 0) {
            // No account data — create a single entry for the channel type
            channels.push({
              id: `${channelId}-default`,
              type: channelId as ChannelType,
              name: channelId,
              status: summaryError ? 'error' : 'disconnected',
              accountId: 'default',
              error: summaryError,
            });
            continue;
          }

          for (const account of accounts) {
            const acctId = account.accountId || 'default';
            let status: Channel['status'] = 'disconnected';
            const acctConnected = account.connected === true || account.linked === true || hasRecentActivity(account);
            const acctRunning = account.running === true;
            const acctError = (typeof account.lastError === 'string' && account.lastError) || undefined;

            if (acctConnected) {
              status = 'connected';
            } else if (acctRunning && !acctError) {
              status = 'connected';
            } else if (acctError || summaryError) {
              status = 'error';
            } else if (acctRunning) {
              status = 'connecting';
            }

            channels.push({
              id: `${channelId}-${acctId}`,
              type: channelId as ChannelType,
              name: account.name || (acctId === 'default' ? channelId : `${channelId} (${acctId})`),
              status,
              accountId: acctId,
              error: acctError || (typeof summaryError === 'string' ? summaryError : undefined),
            });
          }
        }

        // Merge enabled status from config + add disabled accounts not reported by Gateway
        try {
          const enabledResult = await window.electron.ipcRenderer.invoke(
            'channel:getEnabledMap'
          ) as { success: boolean; map: Record<string, Record<string, boolean>> };
          if (enabledResult.success && enabledResult.map) {
            // Set enabled on existing channels
            for (const ch of channels) {
              const acctId = ch.accountId || 'default';
              const typeMap = enabledResult.map[ch.type];
              if (typeMap && typeof typeMap[acctId] === 'boolean') {
                ch.enabled = typeMap[acctId];
              } else {
                ch.enabled = true;
              }
            }
            // Add disabled accounts that the Gateway didn't report
            for (const [channelType, acctMap] of Object.entries(enabledResult.map)) {
              for (const [acctId, enabled] of Object.entries(acctMap)) {
                if (enabled) continue; // only care about disabled ones
                const exists = channels.some(
                  (c) => c.type === channelType && (c.accountId || 'default') === acctId
                );
                if (!exists) {
                  channels.push({
                    id: `${channelType}-${acctId}`,
                    type: channelType as ChannelType,
                    name: acctId === 'default' ? channelType : `${channelType} (${acctId})`,
                    status: 'disconnected',
                    accountId: acctId,
                    enabled: false,
                  });
                }
              }
            }
          }
        } catch {
          // ignore — enabled defaults to true
        }

        set({ channels, loading: false });
      } else {
        // Gateway not available - try to show channels from local config
        set({ channels: [], loading: false });
      }
    } catch {
      // Gateway not connected, show empty
      set({ channels: [], loading: false });
    }
  },

  addChannel: async (params) => {
    try {
      const result = await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'channels.add',
        params
      ) as { success: boolean; result?: Channel; error?: string };

      if (result.success && result.result) {
        set((state) => ({
          channels: [...state.channels, result.result!],
        }));
        return result.result;
      } else {
        // If gateway is not available, create a local channel for now
        const newChannel: Channel = {
          id: `local-${Date.now()}`,
          type: params.type,
          name: params.name,
          status: 'disconnected',
        };
        set((state) => ({
          channels: [...state.channels, newChannel],
        }));
        return newChannel;
      }
    } catch {
      // Create local channel if gateway unavailable
      const newChannel: Channel = {
        id: `local-${Date.now()}`,
        type: params.type,
        name: params.name,
        status: 'disconnected',
      };
      set((state) => ({
        channels: [...state.channels, newChannel],
      }));
      return newChannel;
    }
  },

  deleteChannel: async (channelId) => {
    // Extract channel type and accountId from the channelId (format: "channelType-accountId")
    const dashIdx = channelId.indexOf('-');
    const channelType = dashIdx >= 0 ? channelId.slice(0, dashIdx) : channelId;
    const accountId = dashIdx >= 0 ? channelId.slice(dashIdx + 1) : 'default';

    try {
      // Delete the account-specific configuration
      await window.electron.ipcRenderer.invoke('channel:deleteAccountConfig', channelType, accountId);
    } catch (error) {
      console.error('Failed to delete channel config:', error);
    }

    // Also remove any binding for this account
    try {
      await window.electron.ipcRenderer.invoke(
        'binding:remove',
        channelType,
        accountId === 'default' ? undefined : accountId
      );
    } catch {
      // ignore
    }

    try {
      await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'channels.delete',
        { channelId: channelType }
      );
    } catch (error) {
      // Continue with local deletion even if gateway fails
      console.error('Failed to delete channel from gateway:', error);
    }

    // Remove from local state
    set((state) => ({
      channels: state.channels.filter((c) => c.id !== channelId),
      bindings: state.bindings.filter(
        (b) => !(b.match.channel === channelType && (b.match.accountId || 'default') === accountId)
      ),
    }));
  },

  connectChannel: async (channelId) => {
    const { updateChannel } = get();
    updateChannel(channelId, { status: 'connecting', error: undefined });

    try {
      const result = await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'channels.connect',
        { channelId }
      ) as { success: boolean; error?: string };

      if (result.success) {
        updateChannel(channelId, { status: 'connected' });
      } else {
        updateChannel(channelId, { status: 'error', error: result.error });
      }
    } catch (error) {
      updateChannel(channelId, { status: 'error', error: String(error) });
    }
  },

  disconnectChannel: async (channelId) => {
    const { updateChannel } = get();

    try {
      await window.electron.ipcRenderer.invoke(
        'gateway:rpc',
        'channels.disconnect',
        { channelId }
      );
    } catch (error) {
      console.error('Failed to disconnect channel:', error);
    }

    updateChannel(channelId, { status: 'disconnected', error: undefined });
  },

  requestQrCode: async (channelType) => {
    const result = await window.electron.ipcRenderer.invoke(
      'gateway:rpc',
      'channels.requestQr',
      { type: channelType }
    ) as { success: boolean; result?: { qrCode: string; sessionId: string }; error?: string };

    if (result.success && result.result) {
      return result.result;
    }

    throw new Error(result.error || 'Failed to request QR code');
  },

  setChannels: (channels) => set({ channels }),

  updateChannel: (channelId, updates) => {
    set((state) => ({
      channels: state.channels.map((channel) =>
        channel.id === channelId ? { ...channel, ...updates } : channel
      ),
    }));
  },

  clearError: () => set({ error: null }),

  fetchBindings: async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('binding:get') as {
        success: boolean;
        bindings?: AgentBinding[];
      };
      if (result.success && result.bindings) {
        set({ bindings: result.bindings });
      }
    } catch {
      // ignore
    }
  },

  setBinding: async (agentId, channel, accountId?, session?) => {
    try {
      await window.electron.ipcRenderer.invoke('binding:set', agentId, channel, accountId, session);
      await get().fetchBindings();
    } catch (error) {
      console.error('Failed to set binding:', error);
    }
  },

  removeBinding: async (channel, accountId?) => {
    try {
      await window.electron.ipcRenderer.invoke('binding:remove', channel, accountId);
      await get().fetchBindings();
    } catch (error) {
      console.error('Failed to remove binding:', error);
    }
  },
}));
