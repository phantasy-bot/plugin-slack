import {
  AGENT_DEFAULTS,
  createPluginModuleLogger,
  fetchWithTimeout,
  kvService,
  type ServerEnv,
} from "@phantasy/agent/plugin-runtime";

import {
  readBoolean,
  readNumber,
  readOptionalString,
  readStringArray,
} from "./runtime/config-helpers";

const logger = createPluginModuleLogger("SlackIntegration");

export type SlackAdapterMode = "webhook" | "socket";

export interface SlackConfig {
  botToken: string;
  signingSecret?: string;
  appToken?: string;
  clientId?: string;
  clientSecret?: string;
  botUserId?: string;
  username?: string;
  defaultChannelId?: string;
  channelIds: string[];
  allowedUserIds: string[];
  commandPrefix: string;
  enableCommands: boolean;
  enableAutoReply: boolean;
  enableMentionOnly: boolean;
  replyDelay: number;
  webhookSecret?: string;
  webhookUrl?: string;
  mode: SlackAdapterMode;
  autoStart?: boolean;
  connected?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getNestedRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  const next = value[key];
  return isRecord(next) ? next : {};
}

function normalizeSlackConfig(config: Partial<SlackConfig>): SlackConfig {
  const mode = readOptionalString(config.mode);
  return {
    botToken: readOptionalString(config.botToken) || "",
    signingSecret: readOptionalString(config.signingSecret),
    appToken: readOptionalString(config.appToken),
    clientId: readOptionalString(config.clientId),
    clientSecret: readOptionalString(config.clientSecret),
    botUserId: readOptionalString(config.botUserId),
    username: readOptionalString(config.username),
    defaultChannelId: readOptionalString(config.defaultChannelId),
    channelIds: readStringArray(config.channelIds),
    allowedUserIds: readStringArray(config.allowedUserIds),
    commandPrefix: readOptionalString(config.commandPrefix) || "!",
    enableCommands:
      typeof config.enableCommands === "boolean" ? config.enableCommands : true,
    enableAutoReply:
      typeof config.enableAutoReply === "boolean" ? config.enableAutoReply : true,
    enableMentionOnly:
      typeof config.enableMentionOnly === "boolean" ? config.enableMentionOnly : true,
    replyDelay: readNumber(config.replyDelay, 0),
    webhookSecret: readOptionalString(config.webhookSecret),
    webhookUrl: readOptionalString(config.webhookUrl),
    mode: mode === "socket" ? "socket" : "webhook",
    autoStart: readBoolean(config.autoStart),
    connected: readBoolean(config.connected),
  };
}

function getSlackIntegrationConfig(agent: unknown): SlackConfig | undefined {
  const integrations = getNestedRecord(agent, "integrations");
  const slack = getNestedRecord(integrations, "slack");
  if (Object.keys(slack).length === 0) {
    return undefined;
  }

  return normalizeSlackConfig(slack as Partial<SlackConfig>);
}

export class SlackIntegration {
  constructor(private readonly env: ServerEnv) {}

  async getConfig(): Promise<SlackConfig | null> {
    try {
      const storedConfig = await kvService.get("integration:slack");
      const config =
        isRecord(storedConfig) && Object.keys(storedConfig).length > 0
          ? normalizeSlackConfig(storedConfig as Partial<SlackConfig>)
          : getSlackIntegrationConfig(await kvService.get(AGENT_DEFAULTS.ID));

      if (!config?.botToken) {
        return null;
      }

      return config;
    } catch (error) {
      logger.error("Failed to get Slack config:", error);
      return null;
    }
  }

  async saveConfig(config: SlackConfig): Promise<boolean> {
    try {
      const normalizedConfig = normalizeSlackConfig(config);
      if (!normalizedConfig.botToken) {
        throw new Error("Slack bot token is required");
      }

      await kvService.set("integration:slack", normalizedConfig);

      const agent = (await kvService.get(AGENT_DEFAULTS.ID)) as Record<
        string,
        unknown
      > | null;
      if (agent) {
        const integrations = getNestedRecord(agent, "integrations");
        agent.integrations = {
          ...integrations,
          slack: normalizedConfig,
        };
        await kvService.set(AGENT_DEFAULTS.ID, agent);
      }

      return true;
    } catch (error) {
      logger.error("Failed to save Slack config:", error);
      return false;
    }
  }

  async testConnection(config: Pick<SlackConfig, "botToken">): Promise<{
    success: boolean;
    error?: string;
    botInfo?: { id?: string; user?: string; team?: string };
  }> {
    try {
      const response = await fetchWithTimeout("https://slack.com/api/auth.test", {
        headers: {
          Authorization: `Bearer ${config.botToken}`,
        },
        timeout: 10_000,
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        user_id?: string;
        user?: string;
        team?: string;
      };

      if (!response.ok || !payload.ok) {
        return {
          success: false,
          error: payload.error || `Slack API returned ${response.status}`,
        };
      }

      return {
        success: true,
        botInfo: {
          id: payload.user_id,
          user: payload.user,
          team: payload.team,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  resolveWebhookUrl(config: SlackConfig): string | undefined {
    if (config.webhookUrl) {
      return config.webhookUrl;
    }

    const publicUrl = readOptionalString(
      this.env.PUBLIC_URL,
      this.env.PHANTASY_PUBLIC_URL,
      this.env.WEB_BASE_URL,
    );
    if (!publicUrl) {
      return undefined;
    }

    const base = publicUrl.replace(/\/$/, "");
    return `${base}/admin/api/plugins/slack/webhook`;
  }
}
