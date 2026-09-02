import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_KEY,
  EXTRACTION_MODELS,
  isValidModelKey,
  resolveModel,
} from "./catalog";

describe("extraction model catalog", () => {
  it("resolves null / unknown keys to the default (Anthropic)", () => {
    expect(resolveModel(null).key).toBe(DEFAULT_MODEL_KEY);
    expect(resolveModel(undefined).key).toBe(DEFAULT_MODEL_KEY);
    expect(resolveModel("nope").key).toBe(DEFAULT_MODEL_KEY);
    expect(resolveModel(DEFAULT_MODEL_KEY).provider).toBe("anthropic");
  });

  it("resolves each provider key to the right adapter", () => {
    expect(resolveModel("gemini-3-1-pro").provider).toBe("gemini");
    expect(resolveModel("openai-gpt-5-6").provider).toBe("openai");
  });

  it("validates keys", () => {
    expect(isValidModelKey("gemini-3-1-pro")).toBe(true);
    expect(isValidModelKey("nope")).toBe(false);
    expect(isValidModelKey(null)).toBe(false);
  });

  it("has unique keys and sane pricing", () => {
    const keys = EXTRACTION_MODELS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of EXTRACTION_MODELS) {
      expect(m.priceInPerMtok).toBeGreaterThan(0);
      expect(m.priceOutPerMtok).toBeGreaterThan(0);
      expect(m.apiModelId.length).toBeGreaterThan(0);
    }
  });

  it("the default key exists in the catalog", () => {
    expect(EXTRACTION_MODELS.some((m) => m.key === DEFAULT_MODEL_KEY)).toBe(true);
  });
});
