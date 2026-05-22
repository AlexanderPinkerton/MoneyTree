import { describe, expect, it } from "vitest";

import { PrismaService } from "../prisma/prisma.service";
import { BizProcessingService } from "./biz-processing.service";

describe("BizProcessingService sentiment triage", () => {
  const service = new BizProcessingService({} as PrismaService);

  function sentimentFor(text: string) {
    return service
      .classifyText(text)
      .tags.find((tag) => tag.tag_type === "sentiment")?.value;
  }

  function hasMarketContext(text: string) {
    return service
      .classifyText(text)
      .tags.some((tag) => tag.tag_type === "market_context");
  }

  it("classifies negative chart language as bearish", () => {
    expect(sentimentFor("Chart looks like dogshit.")).toBe("bearish");
    expect(sentimentFor("This chart is trash.")).toBe("bearish");
    expect(sentimentFor("Chart looks weak here.")).toBe("bearish");
    expect(hasMarketContext("Chart looks like dogshit.")).toBe(true);
  });

  it("does not make generic insults bearish without market context", () => {
    expect(sentimentFor("This thread is dogshit.")).toBe("neutral");
    expect(sentimentFor("Looks weak here.")).toBe("neutral");
  });

  it("handles negative language aimed at bearish positioning", () => {
    expect(sentimentFor("Shorts are cooked.")).toBe("bullish");
    expect(sentimentFor("Puts are dead.")).toBe("bullish");
    expect(sentimentFor("Bear thesis is dogshit.")).toBe("bullish");
  });

  it("handles negative language aimed at bullish positioning", () => {
    expect(sentimentFor("Calls are cooked.")).toBe("bearish");
    expect(sentimentFor("Bull thesis is dogshit.")).toBe("bearish");
  });
});
