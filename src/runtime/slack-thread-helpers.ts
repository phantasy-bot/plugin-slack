export function buildSlackGatewayThreadId(input: {
  channelId: string;
  threadTs?: string;
}): string {
  return input.threadTs
    ? `slack:channel:${input.channelId}:thread:${input.threadTs}`
    : `slack:channel:${input.channelId}`;
}

export function normalizeSlackId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return undefined;
}
