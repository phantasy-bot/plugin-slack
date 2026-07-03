import {
  BasePlugin,
  type PlatformCapability,
  type PluginConfig,
  type PluginTool,
} from "@phantasy/agent/plugins";
import {
  createPluginModuleLogger,
  getPluginRuntimeEnv,
  type ServerEnv,
} from "@phantasy/agent/plugin-runtime";

import { handleSlackPluginEndpoint } from "./slack-plugin-endpoints";
import { SlackIntegration, type SlackConfig } from "./slack-integration";
import { SlackBotService } from "./runtime/slack-bot-service";
import { buildSlackRuntimeConfig } from "./runtime/slack-plugin-config";

const log = createPluginModuleLogger("SlackPlugin");

type SlackPluginConfig = PluginConfig & Partial<SlackConfig>;

export class SlackPlugin extends BasePlugin implements PlatformCapability {
  name = "slack";
  version = "0.1.0";
  description = "Slack workspace messaging integration for Phantasy.";

  protected displayName = "Slack";
  protected category = "messaging";
  protected tags = ["slack", "messaging", "chat", "bot"];
  protected permissions = ["internet"];
  protected workspace = "business" as const;
  protected extensionKind = "integration" as const;
  protected isPlatform = true;
  protected platformFeatures = {
    messaging: true,
    autonomous: false,
  } as const;
  protected adminSurface = {
    tabId: "slack",
    label: "Slack",
    section: "business",
    workspace: "business",
    kind: "generic",
    keywords: ["slack", "messaging", "chat", "bot"],
    dashboardIcon: "slack",
  } as const;
  protected configSchema = {
    type: "object",
    properties: {
      enabled: { type: "boolean", default: true, title: "Enabled" },
      autoStart: {
        type: "boolean",
        default: false,
        title: "Auto-start",
        description:
          "Start the Slack bridge automatically when this integration is enabled.",
      },
      botToken: { type: "string", title: "Bot token", format: "password" },
      signingSecret: { type: "string", title: "Signing secret", format: "password" },
      appToken: { type: "string", title: "App token", format: "password" },
      clientId: { type: "string", title: "Client ID" },
      clientSecret: { type: "string", title: "Client secret", format: "password" },
      defaultChannelId: { type: "string", title: "Default channel ID" },
      channelIds: {
        type: "array",
        title: "Allowed channel IDs",
        items: { type: "string" },
        default: [],
      },
      allowedUserIds: {
        type: "array",
        title: "Allowed user IDs",
        items: { type: "string" },
        default: [],
      },
      commandPrefix: { type: "string", default: "!", title: "Command prefix" },
      enableCommands: { type: "boolean", default: true, title: "Enable commands" },
      enableAutoReply: { type: "boolean", default: true, title: "Enable auto-reply" },
      enableMentionOnly: {
        type: "boolean",
        default: true,
        title: "Mention-only in channels",
      },
      replyDelay: { type: "number", default: 0, title: "Reply delay (seconds)" },
      webhookUrl: { type: "string", title: "Webhook URL" },
      mode: {
        type: "string",
        enum: ["webhook", "socket"],
        default: "webhook",
        title: "Runtime mode",
      },
    },
  };

  private botService: SlackBotService | null = null;
  private lastActivity?: Date;

  getTools(): PluginTool[] {
    return [];
  }

  override async onInit(
    _agentConfig: Record<string, unknown>,
    config?: SlackPluginConfig,
  ): Promise<void> {
    await super.onInit(_agentConfig, config);
    const runtimeConfig = await this.buildRuntimeConfig();
    if (runtimeConfig) {
      await this.createIntegration().saveConfig(runtimeConfig);
    }

    if (this.isEnabled() && runtimeConfig?.autoStart && !this.botService) {
      const result = await this.startBot();
      if (!result.success) {
        log.warn("Slack auto-start failed", { message: result.message });
      }
    }
  }

  async startBot(): Promise<{ success: boolean; message?: string }> {
    const runtimeConfig = await this.buildRuntimeConfig();
    if (!runtimeConfig) {
      return {
        success: false,
        message: "Set a Slack bot token before starting the integration.",
      };
    }

    if (runtimeConfig.mode === "webhook" && !runtimeConfig.signingSecret) {
      return {
        success: false,
        message: "Configure a Slack signing secret for webhook mode.",
      };
    }

    if (runtimeConfig.mode === "socket" && !runtimeConfig.appToken) {
      return {
        success: false,
        message: "Configure a Slack app token for socket mode.",
      };
    }

    const integration = this.createIntegration();
    const testResult = await integration.testConnection(runtimeConfig);
    if (!testResult.success) {
      return {
        success: false,
        message: testResult.error || "Failed to connect to Slack",
      };
    }

    const webhookUrl =
      runtimeConfig.webhookUrl || integration.resolveWebhookUrl(runtimeConfig);
    const nextConfig = {
      ...runtimeConfig,
      username: testResult.botInfo?.user || runtimeConfig.username,
      botUserId: testResult.botInfo?.id || runtimeConfig.botUserId,
      connected: true,
      webhookUrl,
    };
    await integration.saveConfig(nextConfig);

    if (this.botService) {
      await this.botService.stop();
    }

    this.botService = new SlackBotService(this.getRuntimeEnv(), nextConfig, webhookUrl);
    await this.botService.start();
    this.lastActivity = new Date();

    return {
      success: true,
      message: nextConfig.username
        ? `Connected to Slack as ${nextConfig.username}`
        : "Connected to Slack",
    };
  }

  async stopBot(): Promise<{ success: boolean; message?: string }> {
    if (this.botService) {
      await this.botService.stop();
      this.botService = null;
    }

    const runtimeConfig = await this.buildRuntimeConfig();
    if (runtimeConfig) {
      await this.createIntegration().saveConfig({
        ...runtimeConfig,
        connected: false,
      });
    }

    return {
      success: true,
      message: "Slack integration stopped",
    };
  }

  async getBotStatus(): Promise<{
    connected: boolean;
    streaming?: boolean;
    autonomousPosting?: boolean;
    lastActivity?: Date;
    error?: string;
    summary?: string;
    configuredChannels?: string[];
    recommendedActions?: string[];
  }> {
    const runtimeConfig = await this.buildRuntimeConfig();
    if (!runtimeConfig) {
      return {
        connected: false,
        streaming: false,
        autonomousPosting: false,
        lastActivity: this.lastActivity,
        error: "Slack bot token is not configured",
        summary: "Needs bot token",
        recommendedActions: [
          "Add SLACK_BOT_TOKEN or configure a bot token in the integration.",
          "Point Slack event subscriptions at /admin/api/plugins/slack/webhook.",
        ],
      };
    }

    const configuredChannels = Array.from(
      new Set(
        [runtimeConfig.defaultChannelId, ...runtimeConfig.channelIds].filter(
          Boolean,
        ) as string[],
      ),
    );

    if (this.botService) {
      const status = this.botService.getStatus();
      return {
        connected: status.connected,
        streaming: false,
        autonomousPosting: false,
        lastActivity: this.lastActivity,
        summary: status.connected
          ? runtimeConfig.username
            ? `Connected as ${runtimeConfig.username}`
            : "Connected"
          : "Configured, reconnecting",
        configuredChannels,
        recommendedActions:
          configuredChannels.length === 0
            ? ["Add a default channel ID or explicit channel allowlist."]
            : [],
      };
    }

    const storedConfig = await this.createIntegration().getConfig();
    const connected = Boolean(storedConfig?.connected);
    return {
      connected,
      streaming: false,
      autonomousPosting: false,
      lastActivity: this.lastActivity,
      error: connected ? undefined : "Slack bridge is not running",
      summary: connected ? "Configured" : "Configured, not running",
      configuredChannels,
      recommendedActions: ["Start the integration after configuring Slack credentials."],
    };
  }

  async sendMessage(params: {
    content: string;
    channelId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const runtimeConfig = await this.buildRuntimeConfig();
    const channelId = params.channelId || runtimeConfig?.defaultChannelId;

    if (!runtimeConfig || !channelId) {
      return {
        success: false,
        error: "Slack default channel is not configured",
      };
    }

    if (!this.botService) {
      return {
        success: false,
        error: "Slack bridge is not running",
      };
    }

    const threadTs =
      typeof params.metadata?.threadTs === "string"
        ? params.metadata.threadTs
        : undefined;

    const result = await this.botService.sendMessage(channelId, params.content, {
      threadTs,
      sessionId:
        typeof params.metadata?.sessionId === "string"
          ? params.metadata.sessionId
          : undefined,
      gatewayThreadId:
        typeof params.metadata?.gatewayThreadId === "string"
          ? params.metadata.gatewayThreadId
          : undefined,
    });

    if (result.success) {
      this.lastActivity = new Date();
    }

    return result;
  }

  async onConfigUpdated(newConfig: PluginConfig): Promise<void> {
    await super.onConfigUpdated(newConfig);
    const runtimeConfig = await this.buildRuntimeConfig();
    if (runtimeConfig) {
      await this.createIntegration().saveConfig(runtimeConfig);
    }
  }

  async handleCustomEndpoint(request: Request, path: string): Promise<Response | null> {
    try {
      return handleSlackPluginEndpoint(this, request, path);
    } catch (error) {
      log.error("Slack plugin endpoint failed", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      return new Response(
        JSON.stringify({ success: false, error: "Slack plugin request failed" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  getBotService(): SlackBotService | null {
    return this.botService;
  }

  resolveWebhookUrl(config: SlackConfig | null): string | undefined {
    if (!config) {
      return undefined;
    }
    return this.createIntegration().resolveWebhookUrl(config);
  }

  async testConnection(config: Pick<SlackConfig, "botToken">): Promise<{
    success: boolean;
    error?: string;
    botInfo?: { id?: string; user?: string; team?: string };
  }> {
    return this.createIntegration().testConnection(config);
  }

  async buildRuntimeConfig(
    overrides?: Partial<SlackConfig>,
  ): Promise<SlackConfig | null> {
    const snapshot = (this.getConfig() || {}) as SlackPluginConfig;
    const stored = await this.createIntegration().getConfig();
    return buildSlackRuntimeConfig({ overrides, snapshot, stored });
  }

  private createIntegration(): SlackIntegration {
    return new SlackIntegration(this.getRuntimeEnv());
  }

  private getRuntimeEnv(): ServerEnv {
    return getPluginRuntimeEnv() as unknown as ServerEnv;
  }
}

export default SlackPlugin;
