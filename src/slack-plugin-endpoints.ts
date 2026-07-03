import type { SlackConfig } from "./slack-integration";
import type { SlackPlugin } from "./slack-plugin";

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleSlackPluginEndpoint(
  plugin: SlackPlugin,
  request: Request,
  path: string,
): Promise<Response | null> {
  if ((path === "/status" || path === "/bot-status") && request.method === "GET") {
    const runtimeConfig = await plugin.buildRuntimeConfig();
    const status = await plugin.getBotStatus();
    return jsonResponse({
      enabled: plugin.isEnabled(),
      connected: status.connected,
      error: status.error,
      summary: status.summary,
      lastActivity: status.lastActivity,
      username: runtimeConfig?.username || null,
      defaultChannelId: runtimeConfig?.defaultChannelId || null,
      channelIds: runtimeConfig?.channelIds || [],
      allowedUserIds: runtimeConfig?.allowedUserIds || [],
      webhookUrl: runtimeConfig?.webhookUrl || plugin.resolveWebhookUrl(runtimeConfig),
      mode: runtimeConfig?.mode || "webhook",
      autoStart: runtimeConfig?.autoStart ?? false,
    });
  }

  if (path === "/webhook") {
    const botService = plugin.getBotService();
    if (!botService) {
      return new Response("Slack integration is not running", { status: 503 });
    }

    return botService.handleWebhook(request);
  }

  if (path === "/start" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (body && typeof body === "object" && "config" in body) {
      await plugin.updateConfig((body as { config: Record<string, unknown> }).config);
    }

    const result = await plugin.startBot();
    return jsonResponse(result, result.success ? 200 : 400);
  }

  if (path === "/stop" && request.method === "POST") {
    const result = await plugin.stopBot();
    return jsonResponse(result, result.success ? 200 : 400);
  }

  if ((path === "/test" || path === "/test-connection") && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const runtimeConfig = await plugin.buildRuntimeConfig(
      (body || {}) as Partial<SlackConfig>,
    );

    if (!runtimeConfig) {
      return jsonResponse(
        {
          success: false,
          error: "Slack bot token is required",
        },
        400,
      );
    }

    const result = await plugin.testConnection(runtimeConfig);
    return jsonResponse(
      {
        ...result,
        connected: result.success,
        username: result.botInfo?.user,
        userId: result.botInfo?.id,
      },
      result.success ? 200 : 400,
    );
  }

  return null;
}
