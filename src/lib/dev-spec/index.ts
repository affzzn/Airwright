/**
 * Barrel for the Dev / Spec page content. Pure data + types only — the LIVE
 * code values live in `./live` (imported by the server page, not re-exported
 * here, so a stray client import can't pull them in).
 */
export * from "./types";
export { MEASUREMENTS } from "./measurements";
export { CROSS_CHECKS } from "./cross-checks";
export { ENGINE_RULES } from "./engine-rules";
export { GLOSSARY } from "./glossary";
export { PIPELINE, SCHEMA_FIELDS } from "./pipeline";
export { LAYERS, DOCTRINES, OVERVIEW_INTRO } from "./overview";
