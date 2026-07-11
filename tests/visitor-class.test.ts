import { describe, expect, it } from "vitest";
import { browserFamily, classifyVisitor } from "@/lib/visitor-class";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FIREFOX_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";
const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const EDGE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";

describe("classifyVisitor", () => {
  it("erkennt LLM-Crawler", () => {
    expect(classifyVisitor("Mozilla/5.0 AppleWebKit/537.36; compatible; GPTBot/1.2")).toBe("llm");
    expect(classifyVisitor("Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)")).toBe("llm");
    expect(classifyVisitor("Mozilla/5.0 (compatible; PerplexityBot/1.0)")).toBe("llm");
    expect(classifyVisitor("CCBot/2.0 (https://commoncrawl.org/faq/)")).toBe("llm");
  });

  it("erkennt klassische Bots", () => {
    expect(classifyVisitor("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe("bot");
    expect(classifyVisitor("Mozilla/5.0 (compatible; bingbot/2.0)")).toBe("bot");
    expect(classifyVisitor("curl/8.5.0")).toBe("bot");
  });

  it("Heuristik: unbekannte Crawler mit bot/spider im Namen", () => {
    expect(classifyVisitor("SuperNeuerBot/0.1")).toBe("bot");
    expect(classifyVisitor("datenspider 2.0")).toBe("bot");
  });

  it("leerer UA gilt als Bot, echte Browser als Mensch", () => {
    expect(classifyVisitor(null)).toBe("bot");
    expect(classifyVisitor("")).toBe("bot");
    expect(classifyVisitor(CHROME_UA)).toBe("mensch");
    expect(classifyVisitor(SAFARI_UA)).toBe("mensch");
  });
});

describe("browserFamily", () => {
  it("klassifiziert die großen Familien", () => {
    expect(browserFamily(CHROME_UA)).toBe("chrome");
    expect(browserFamily(FIREFOX_UA)).toBe("firefox");
    expect(browserFamily(SAFARI_UA)).toBe("safari");
    expect(browserFamily(EDGE_UA)).toBe("edge");
    expect(browserFamily("curl/8.5.0")).toBe("sonstige");
  });
});
