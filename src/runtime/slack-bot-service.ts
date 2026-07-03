import {
  AGENT_DEFAULTS,
  createPlatformConversationBridge,
  createPluginModuleLogger,
  importEsmModule,
  kvService,
  type PlatformConversationBridgeInboundEvent,
  type ServerEnv,
} from "@phantasy/agent/plugin-runtime";

import type { SlackConfig } from "../slack-integration";
import { buildSlackGatewayThreadId, normalizeSlackId } from "./slack-thread-helpers";

const logger = createPluginModuleLogger("SlackBotService");

type SlackBridge = ReturnType<typeof createPlatformConversationBridge>;

type ResolvedCommand = {
  content?: string;
  handled: boolean;
  responseText?: string;
} | null;

export class SlackBotService {
  private bridge: SlackBridge | null = null;
  private connected = false;
  private socketAbort: AbortController | null = null;

  constructor(
    private readonly env: ServerEnv,
    private readonly config: SlackConfig,
    private readonly webhookUrl?: string,
  ) {}

  async start(): Promise<void> {
    if (this.connected) {
      return;
    }

    const bridge = this.getBridge();
    await bridge.initialize();
    this.connected = true;
    logger.info("Slack messaging bridge initialized");
  }

  async stop(): Promise<void> {
    this.socketAbort?.abort();
    this.socketAbort = null;

    if (this.bridge) {
      await this.bridge.shutdown();
      this.bridge = null;
    }

    this.connected = false;
    logger.info("Slack messaging bridge stopped");
  }

  getStatus(): { connected: boolean } {
    return { connected: this.connected };
  }

  async handleWebhook(request: Request): Promise<Response> {
    return this.getBridge().handleWebhook(request);
  }

  async sendMessage(
    channelId: string,
    content: string,
    options: {
      gatewayThreadId?: string;
      sessionId?: string;
      threadTs?: string;
    } = {},
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const bridge = this.getBridge();
    await bridge.initialize();
    const adapter = bridge.getAdapter();
    const threadId = adapter.encodeThreadId({
      channel: channelId,
      threadTs: options.threadTs || channelId,
    });

    return bridge.sendMessage({
      channelUserId: channelId,
      content,
      gatewayMetadata: {
        channelId,
        threadTs: options.threadTs,
      },
      gatewayThreadId:
        options.gatewayThreadId ||
        buildSlackGatewayThreadId({
          channelId,
          threadTs: options.threadTs,
        }),
      sessionId: options.sessionId,
      threadId,
    });
  }

  private getBridge(): SlackBridge {
    if (this.bridge) {
      return this.bridge;
    }

    this.bridge = createPlatformConversationBridge({
      adapterKey: "slack",
      env: this.env,
      platform: "slack",
      registerDirectHandler: true,
      registerMentionHandler: true,
      registerMessageHandler:
        this.config.enableAutoReply && !this.config.enableMentionOnly,
      registerSubscribedHandler: true,
      replyDelayMs: Math.max(0, this.config.replyDelay) * 1000,
      stateKeyPrefix: "phantasy-chat-sdk:slack",
      userName: this.config.username || "phantasy-slack",
      createAdapter: async () => {
        const { createSlackAdapter } = await importEsmModule<{
          createSlackAdapter: (config: Record<string, unknown>) => unknown;
        }>("@chat-adapter/slack");

        return createSlackAdapter({
          botToken: this.config.botToken,
          signingSecret: this.config.signingSecret,
          appToken: this.config.appToken,
          clientId: this.config.clientId,
          clientSecret: this.config.clientSecret,
          botUserId: this.config.botUserId,
          userName: this.config.username || "phantasy-slack",
          mode: this.config.mode,
        }) as never;
      },
      normalizeInboundMessage: (event) => this.normalizeInboundMessage(event),
      onStart: async (bridge) => {
        if (this.config.mode !== "socket") {
          return;
        }

        const adapter = bridge.getAdapter() as {
          startSocketModeListener?: (
            options?: Record<string, unknown>,
            durationMs?: number,
            signal?: AbortSignal,
            webhookUrl?: string,
          ) => Promise<Response>;
        };
        this.socketAbort = new AbortController();
        void adapter.startSocketModeListener?.(
          {},
          undefined,
          this.socketAbort.signal,
          this.webhookUrl,
        );
      },
      onStop: async () => {
        this.socketAbort?.abort();
        this.socketAbort = null;
      },
    });

    return this.bridge;
  }

  private async normalizeInboundMessage(event: PlatformConversationBridgeInboundEvent) {
    const authorId = normalizeSlackId(event.message.author.userId);
    const authorName =
      normalizeSlackId(event.message.author.userName) ||
      normalizeSlackId(event.message.author.fullName) ||
      authorId;

    if (!authorId || !authorName) {
      return null;
    }

    if (
      this.config.allowedUserIds.length > 0 &&
      !this.config.allowedUserIds.includes(authorId)
    ) {
      return null;
    }

    const decoded = event.adapter.decodeThreadId(event.thread.id) as {
      channel?: string;
      threadTs?: string;
    };
    const channelId = normalizeSlackId(decoded.channel);
    if (!channelId) {
      return null;
    }

    const monitoredChannels = new Set([
      ...this.config.channelIds,
      ...(this.config.defaultChannelId ? [this.config.defaultChannelId] : []),
    ]);
    if (monitoredChannels.size > 0 && !monitoredChannels.has(channelId)) {
      return null;
    }

    if (event.reason === "message" && this.config.enableMentionOnly) {
      return null;
    }

    if (
      !this.config.enableAutoReply &&
      event.reason !== "direct" &&
      event.reason !== "mention"
    ) {
      return null;
    }

    const rawText = String(event.message.text || "").trim();
    if (!rawText) {
      return null;
    }

    const command = await this.resolveCommand(rawText);
    if (command?.handled && !command.content) {
      return {
        autoSubscribe: false,
        channelId,
        channelUserId: authorId,
        content: rawText,
        gatewayMetadata: {
          channelId,
          threadTs: decoded.threadTs,
        },
        gatewayThreadId: buildSlackGatewayThreadId({
          channelId,
          threadTs: decoded.threadTs,
        }),
        immediateResponseText: command.responseText,
        source: "slack:channel",
        threadId: event.thread.id,
        userId: authorId,
        username: authorName,
      };
    }

    const content = command?.content || rawText;
    if (!content.trim()) {
      return null;
    }

    return {
      autoSubscribe: event.reason !== "message" || this.config.enableAutoReply,
      channelId,
      channelUserId: authorId,
      content,
      gatewayMetadata: {
        channelId,
        threadTs: decoded.threadTs,
      },
      gatewayThreadId: buildSlackGatewayThreadId({
        channelId,
        threadTs: decoded.threadTs,
      }),
      source: "slack:channel",
      threadId: event.thread.id,
      userId: authorId,
      username: authorName,
    };
  }

  private async resolveCommand(text: string): Promise<ResolvedCommand> {
    if (!this.config.enableCommands) {
      return null;
    }

    const prefix = this.config.commandPrefix || "!";
    if (!text.startsWith(prefix)) {
      return null;
    }

    const [rawCommand, ...args] = text.slice(prefix.length).trim().split(/\s+/);
    const command = rawCommand?.toLowerCase() || "";

    switch (command) {
      case "help":
        return {
          handled: true,
          responseText: `Available commands:
${prefix}help - Show this help message
${prefix}about - Learn about me
${prefix}chat <message> - Chat with me`,
        };
      case "about": {
        const agent = await kvService.get(AGENT_DEFAULTS.ID);
        const agentRecord =
          agent && typeof agent === "object"
            ? (agent as { name?: string; personality?: string })
            : null;
        return {
          handled: true,
          responseText: agentRecord?.name
            ? `I'm ${agentRecord.name}! ${agentRecord.personality || ""}`.trim()
            : "I'm an AI companion powered by Phantasy!",
        };
      }
      case "chat":
        if (args.length === 0) {
          return {
            handled: true,
            responseText: "Please provide a message to chat about!",
          };
        }
        return {
          content: args.join(" "),
          handled: true,
        };
      default:
        return {
          handled: true,
          responseText: `Unknown command. Use ${prefix}help to see available commands.`,
        };
    }
  }
}
