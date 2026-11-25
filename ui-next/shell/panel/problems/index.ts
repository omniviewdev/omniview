// The host's Problems tool (ch16 S74, S121): the model of the conditions that are true now (`createProblems`), the body that draws them (`ProblemsBody`) and the tool's place, glyph and words. docs/ui-next/status/PT1.md
// says how they fit together; the producers that feed the model are the host's (`plugins/host/conditions.ts`).
export { createProblems } from './model';
export { ProblemsBody } from './ProblemsBody';
export { PROBLEMS_EMPTY, PROBLEMS_TOOL, PROBLEMS_TOOL_ID } from './tool';
export type { Condition, ProblemCounts, Problems, ProblemsSnapshot, Severity } from './types';
