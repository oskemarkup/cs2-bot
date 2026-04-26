import { z } from "zod";

export const AlertCandidateSchema = z.object({
  itemName: z.string().min(1),
  sourceMarketplace: z.string().min(1),
  targetMarketplace: z.string().min(1),
  sourcePriceMinor: z.bigint().nonnegative(),
  targetPriceMinor: z.bigint().nonnegative(),
  expectedProfitMinor: z.bigint(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  checklistUrl: z.string().url().optional()
});

export type AlertCandidate = z.infer<typeof AlertCandidateSchema>;

export interface AlertSink {
  send(candidate: AlertCandidate): Promise<void>;
}
