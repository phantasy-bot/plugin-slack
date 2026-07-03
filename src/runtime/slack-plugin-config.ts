import type { SlackAdapterMode, SlackConfig } from "../slack-integration";
import {
  readBoolean,
  readNumber,
  readOptionalString,
  readRequiredString,
  readStringArray,
} from "./config-helpers";

export function buildSlackRuntimeConfig(input: {
  overrides?: Partial<SlackConfig>;
  snapshot: Partial<SlackConfig>;
  stored: SlackConfig | null;
}): SlackConfig | null {
  const { overrides, snapshot, stored } = input;
  const mode = readOptionalString(overrides?.mode, snapshot.mode, stored?.mode);
  const runtimeConfig: SlackConfig = {
    botToken: readRequiredString(
      overrides?.botToken,
      snapshot.botToken,
      stored?.botToken,
      process.env.SLACK_BOT_TOKEN,
    ),
    signingSecret: readOptionalString(
      overrides?.signingSecret,
      snapshot.signingSecret,
      stored?.signingSecret,
      process.env.SLACK_SIGNING_SECRET,
    ),
    appToken: readOptionalString(
      overrides?.appToken,
      snapshot.appToken,
      stored?.appToken,
      process.env.SLACK_APP_TOKEN,
    ),
    clientId: readOptionalString(
      overrides?.clientId,
      snapshot.clientId,
      stored?.clientId,
      process.env.SLACK_CLIENT_ID,
    ),
    clientSecret: readOptionalString(
      overrides?.clientSecret,
      snapshot.clientSecret,
      stored?.clientSecret,
      process.env.SLACK_CLIENT_SECRET,
    ),
    botUserId: readOptionalString(
      overrides?.botUserId,
      snapshot.botUserId,
      stored?.botUserId,
    ),
    username: readOptionalString(
      overrides?.username,
      snapshot.username,
      stored?.username,
      process.env.SLACK_BOT_USERNAME,
    ),
    defaultChannelId: readOptionalString(
      overrides?.defaultChannelId,
      snapshot.defaultChannelId,
      stored?.defaultChannelId,
    ),
    channelIds: readStringArray(
      overrides?.channelIds,
      snapshot.channelIds,
      stored?.channelIds,
    ),
    allowedUserIds: readStringArray(
      overrides?.allowedUserIds,
      snapshot.allowedUserIds,
      stored?.allowedUserIds,
    ),
    commandPrefix:
      readOptionalString(
        overrides?.commandPrefix,
        snapshot.commandPrefix,
        stored?.commandPrefix,
      ) || "!",
    enableCommands:
      typeof overrides?.enableCommands === "boolean"
        ? overrides.enableCommands
        : typeof snapshot.enableCommands === "boolean"
          ? snapshot.enableCommands
          : typeof stored?.enableCommands === "boolean"
            ? stored.enableCommands
            : true,
    enableAutoReply:
      typeof overrides?.enableAutoReply === "boolean"
        ? overrides.enableAutoReply
        : typeof snapshot.enableAutoReply === "boolean"
          ? snapshot.enableAutoReply
          : typeof stored?.enableAutoReply === "boolean"
            ? stored.enableAutoReply
            : true,
    enableMentionOnly:
      typeof overrides?.enableMentionOnly === "boolean"
        ? overrides.enableMentionOnly
        : typeof snapshot.enableMentionOnly === "boolean"
          ? snapshot.enableMentionOnly
          : typeof stored?.enableMentionOnly === "boolean"
            ? stored.enableMentionOnly
            : true,
    replyDelay: readNumber(
      overrides?.replyDelay,
      snapshot.replyDelay,
      stored?.replyDelay,
      0,
    ),
    webhookSecret: readOptionalString(
      overrides?.webhookSecret,
      snapshot.webhookSecret,
      stored?.webhookSecret,
    ),
    webhookUrl: readOptionalString(
      overrides?.webhookUrl,
      snapshot.webhookUrl,
      stored?.webhookUrl,
    ),
    mode: mode === "webhook" || mode === "socket" ? mode : "webhook",
    autoStart: readBoolean(overrides?.autoStart, snapshot.autoStart, stored?.autoStart),
    connected: stored?.connected,
  };

  if (!runtimeConfig.botToken) {
    return null;
  }

  return runtimeConfig;
}
