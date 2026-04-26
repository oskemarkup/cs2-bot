import { z } from "zod";

export const PaperTradeEventSchema = z.object({
  itemName: z.string().min(1),
  marketplace: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  priceMinor: z.bigint().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  occurredAt: z.date(),
  notes: z.string().max(500).optional()
});

export type PaperTradeEvent = z.infer<typeof PaperTradeEventSchema>;
