import type Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { plotListResultSchema, type PlotListResult } from "./plotSchema";
import { runToolExtraction } from "./claude";

export const PLOT_PROMPT_VERSION = "2026-08-02.1";

const TOOL_NAME = "record_plot_list";

const SYSTEM_PROMPT = `You read house-builder tender plot lists / site plans for Airwright Midland, a UK scaffolding contractor. Your job is to map every plot to its house type and configuration.

Rules:
- Read the plot schedule table if there is one; otherwise read the site plan.
- For each plot, report: the plot number, the house-type code and/or name, and the configuration (detached / semi-detached / end-terrace / mid-terrace).
- Configuration: on a plot schedule it is often stated. On a site plan you may infer it from how plots adjoin (a standalone plot is detached; a pair sharing one wall are semi-detached; a run of three or more has end-terrace ends and mid-terrace middles). If you genuinely cannot tell, set configuration to null — do NOT guess.
- NEVER invent a plot or a house type. If a field is not legible, use null and lower the confidence.
- Keep notes short and useful.

Respond by calling the provided tool. Do not write prose outside the tool call.`;

const USER_INSTRUCTION = `Extract the plot list: every plot number with its house-type code/name and configuration.`;

const toolInputSchema = zodToJsonSchema(plotListResultSchema, {
  target: "openApi3",
  $refStrategy: "none",
}) as Anthropic.Tool.InputSchema;

export interface ExtractPlotListResult {
  data: PlotListResult;
  meta: {
    model: string;
    promptVersion: string;
    latencyMs: number;
    costUsd: number;
    raw: unknown;
  };
}

/** Extract the plot → house-type → configuration map from a plot-layout PDF. */
export async function extractPlotList(pdf: Buffer): Promise<ExtractPlotListResult> {
  const res = await runToolExtraction({
    pdf,
    system: SYSTEM_PROMPT,
    userText: USER_INSTRUCTION,
    toolName: TOOL_NAME,
    toolDescription: "Record the plot list mapping plots to house types.",
    inputSchema: toolInputSchema,
    maxTokens: 8192, // plot lists can be long
  });

  const data = plotListResultSchema.parse(res.input);

  return {
    data,
    meta: {
      model: res.model,
      promptVersion: PLOT_PROMPT_VERSION,
      latencyMs: res.latencyMs,
      costUsd: res.costUsd,
      raw: res.input,
    },
  };
}
