import { z } from "zod";

export const AllowedSystemModeSchema = z.enum(["read_only_collection", "alerts", "paper_trading", "manual_checklist"]);
export type AllowedSystemMode = z.infer<typeof AllowedSystemModeSchema>;

export const ExecutionActionSchema = z.enum(["steam_ui", "steam_guard", "marketplace_ui", "purchase", "sale"]);
export type ExecutionAction = z.infer<typeof ExecutionActionSchema>;

export const allowedSystemModes: readonly AllowedSystemMode[] = AllowedSystemModeSchema.options;

export function assertManualExecutionOnly(action: ExecutionAction): never {
  throw new Error(`Execution action is outside project scope and must remain manual: ${action}`);
}

export function isAllowedSystemMode(mode: string): mode is AllowedSystemMode {
  return AllowedSystemModeSchema.safeParse(mode).success;
}
