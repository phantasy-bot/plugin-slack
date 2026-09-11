import { describe, expect, it } from "vitest";

import { buildSlackGatewayThreadId, normalizeSlackId } from "./slack-thread-helpers";

describe("slack-thread-helpers", () => {
  it("builds stable gateway thread ids for channels and threads", () => {
    expect(buildSlackGatewayThreadId({ channelId: "C123" })).toBe("slack:channel:C123");
    expect(buildSlackGatewayThreadId({ channelId: "C123", threadTs: "1234.5678" })).toBe(
      "slack:channel:C123:thread:1234.5678",
    );
  });

  it("normalizes slack ids and rejects empty values", () => {
    expect(normalizeSlackId(" U123 ")).toBe("U123");
    expect(normalizeSlackId("")).toBeUndefined();
    expect(normalizeSlackId(null)).toBeUndefined();
  });
});
