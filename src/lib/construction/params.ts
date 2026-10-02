/**
 * Job settings — the ⚠ PARAMS of docs/23 §16. PURE (no Prisma). Trimmed 2026-10-02
 * to the settings the (now simpler) automatic reading still uses; the values it no
 * longer derives (slab / void / leading edges, risers, blockwork) are entered by hand.
 *
 * Every value Colin has not confirmed is a named parameter with a placeholder, so
 * the engine never guesses silently: a derived quantity records which parameters
 * it used, and any of them that is still a placeholder shows as a flag in review.
 * A job can override any numeric/choice value (`ConstructionQuote.jobParams`).
 */

import { z } from "zod";
import { DEFAULT_LIFT_HEIGHT_M } from "./rules";

export type ParamKey =
  | "P1_liftHeightM"
  | "P2_wallTopDatum"
  | "P2b_dpcAboveGroundM"
  | "P2c_groundSource"
  | "P3_bandFrom"
  | "P4_cornerAllowanceM"
  | "P6_internalReachM"
  | "P7_hakiLifts"
  | "P8_loadingBayLifts"
  | "P9_gablesCounted"
  | "P15_toleranceM"
  | "P15_tolerancePct"
  | "P16_inspectionWeeks"
  | "P17_outputGrouping"
  | "P18_hireInPrice"
  | "P19_boardedLiftsAtEachLevel";

export interface ParamDef {
  key: ParamKey;
  label: string;
  /** The placeholder in force until Colin answers. */
  value: number | string;
  unit?: string;
  /** Why this placeholder (evidence or assumption). */
  basis: string;
  /** true once Airwright confirms it (then it no longer flags). */
  confirmed: boolean;
  /** Choices, for a string parameter. */
  options?: string[];
}

export const PARAM_DEFS: ParamDef[] = [
  {
    key: "P1_liftHeightM",
    label: "External lift height",
    value: DEFAULT_LIFT_HEIGHT_M,
    unit: "m",
    basis: "Fits the lifts on all four real quotes (Murray Park, Wren, CBAND hall + pavilion); 1.5 m misfits three.",
    confirmed: false,
  },
  {
    key: "P2_wallTopDatum",
    label: "Height the external scaffold serves",
    value: "SOFFIT_OR_PARAPET",
    options: ["SOFFIT_OR_PARAPET", "SOFFIT", "PARAPET", "RIDGE"],
    basis: "Pitched roof → underside of soffit (the confirmed house-build datum); flat roof → top of parapet (assumed).",
    confirmed: false,
  },
  {
    key: "P2b_dpcAboveGroundM",
    label: "DPC above ground",
    value: 0.15,
    unit: "m",
    basis: "Typical. Bovis heights are printed from DPC, not from ground.",
    confirmed: false,
  },
  {
    key: "P2c_groundSource",
    label: "Which ground level",
    value: "LOWEST_PROPOSED",
    options: ["LOWEST_PROPOSED", "LOWEST_EXISTING", "FFL"],
    basis: "Assumed: the lowest proposed spot level along a face; FFL − DPC offset when there is none.",
    confirmed: false,
  },
  {
    key: "P3_bandFrom",
    label: "Height band taken from",
    value: "MAX_HEIGHT",
    options: ["MAX_HEIGHT"],
    basis: "Assumed: the band containing the highest scaffold of the job.",
    confirmed: false,
  },
  {
    key: "P4_cornerAllowanceM",
    label: "Corner allowance",
    value: 1.0,
    unit: "m per external corner",
    basis: "Confirmed for house-build (docs/11); not yet for construction.",
    confirmed: false,
  },
  {
    key: "P6_internalReachM",
    label: "Working reach for internal lift suggestions",
    value: 2.0,
    unit: "m",
    basis: "Suggestion only: no rule fits every CBAND internal / birdcage lift count.",
    confirmed: false,
  },
  {
    key: "P7_hakiLifts",
    label: "Haki lifts",
    value: "FOLLOW_EXTERNAL",
    options: ["FOLLOW_EXTERNAL"],
    basis: "CBAND (2 on 2-lift buildings) and Wren (×3 / ×2) follow the scaffold they serve.",
    confirmed: false,
  },
  {
    key: "P8_loadingBayLifts",
    label: "Loading-bay lifts",
    value: "FOLLOW_EXTERNAL",
    options: ["FOLLOW_EXTERNAL"],
    basis: "As P7 — CBAND and Wren.",
    confirmed: false,
  },
  {
    key: "P9_gablesCounted",
    label: "Gables given table lifts + apex handrails",
    value: "MAIN_ONLY",
    options: ["MAIN_ONLY", "ALL"],
    basis: "CBAND quote counts main gables only (pavilion porch gable not counted).",
    confirmed: false,
  },
  {
    key: "P15_toleranceM",
    label: "Cross-check tolerance (absolute)",
    value: 0.2,
    unit: "m",
    basis: "Colin: being out by 100–200 mm is fine.",
    confirmed: false,
  },
  {
    key: "P15_tolerancePct",
    label: "Cross-check tolerance (relative)",
    value: 1,
    unit: "%",
    basis: "The larger of the absolute and relative tolerance applies.",
    confirmed: false,
  },
  {
    key: "P16_inspectionWeeks",
    label: "Inspection weeks",
    value: "LONGEST_HIRE",
    options: ["LONGEST_HIRE"],
    basis: "CBAND: 16 inspections = the longest hire period.",
    confirmed: false,
  },
  {
    key: "P17_outputGrouping",
    label: "Output grouping",
    value: "BUILDING_BY_AREA",
    options: ["BUILDING_BY_AREA"],
    basis: "Both real quotes: sections per building × external / internal / birdcage.",
    confirmed: false,
  },
  {
    key: "P18_hireInPrice",
    label: "Hire beyond the rate's included weeks",
    value: "TERMS",
    options: ["TERMS", "INCLUDED"],
    basis:
      "Rates include 4 weeks. INCLUDED: a line's price covers all the hire weeks asked for (the default on a scope job — Ben, 9 Sep: 40 weeks asked = 40 weeks priced). TERMS: the price covers the rates' 4 weeks and longer hire is stated per week (the default otherwise). Colin to confirm.",
    confirmed: false,
  },
  {
    key: "P19_boardedLiftsAtEachLevel",
    label: "\"Lifts at each level\" means",
    value: "PER_FLOOR_LEVEL",
    options: ["PER_FLOOR_LEVEL", "EVERY_LIFT"],
    basis:
      "Assumed (King Edward): one boarded lift per floor level above ground (1F, 2F, roof); EVERY_LIFT boards every lift of the scaffold.",
    confirmed: false,
  },
];

const DEF_BY_KEY = new Map(PARAM_DEFS.map((d) => [d.key, d]));

/** What a job stores: overrides only (value + whether the estimator confirmed it). */
export const jobParamsSchema = z
  .record(
    z.string(),
    z.object({
      value: z.union([z.number(), z.string()]),
      confirmed: z.boolean().optional(),
    }),
  )
  .catch({});
export type StoredJobParams = z.infer<typeof jobParamsSchema>;

export interface ResolvedParam extends ParamDef {
  /** True when the job overrode the placeholder. */
  overridden: boolean;
}

export type ResolvedParams = Record<ParamKey, ResolvedParam>;

/** Merge a job's stored overrides onto the defaults. Unknown keys / bad types are ignored. */
export function resolveJobParams(stored: unknown, opts: { scopeJob?: boolean } = {}): ResolvedParams {
  const parsed = jobParamsSchema.parse(stored ?? {});
  const out = {} as ResolvedParams;
  for (const base of PARAM_DEFS) {
    // A scope job prices the hire the client asks for (Ben, 9 Sep 2026: "the price has an
    // install and dismantle component plus a weekly hire rate on top", 40 weeks → 40 weeks).
    const def = base.key === "P18_hireInPrice" && opts.scopeJob ? { ...base, value: "INCLUDED" } : base;
    const o = parsed[def.key];
    const typeOk = o != null && typeof o.value === typeof def.value;
    const choiceOk = !def.options || (typeOk && def.options.includes(String(o!.value)));
    const numOk = typeof def.value !== "number" || (typeOk && Number.isFinite(o!.value as number) && (o!.value as number) >= 0);
    const use = typeOk && choiceOk && numOk;
    out[def.key] = {
      ...def,
      value: use ? o!.value : def.value,
      confirmed: use ? Boolean(o!.confirmed) || def.confirmed : def.confirmed,
      overridden: use,
    };
  }
  return out;
}

export function paramNumber(p: ResolvedParams, key: ParamKey): number {
  const v = p[key].value;
  return typeof v === "number" ? v : Number(v);
}

export function paramString(p: ResolvedParams, key: ParamKey): string {
  return String(p[key].value);
}

/** A human flag for every parameter a value used that is still a placeholder. */
export function paramFlags(p: ResolvedParams, used: ParamKey[]): string[] {
  const seen = new Set<ParamKey>();
  const flags: string[] = [];
  for (const k of used) {
    if (seen.has(k)) continue;
    seen.add(k);
    const d = p[k] ?? DEF_BY_KEY.get(k);
    if (d && !d.confirmed) {
      const unit = d.unit ? ` ${d.unit}` : "";
      flags.push(`${d.label}: ${d.value}${unit} is a placeholder (${k.split("_")[0]})`);
    }
  }
  return flags;
}
