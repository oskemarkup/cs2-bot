import { z } from "zod";

export const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(JsonValueSchema)])
);

export const JsonObjectSchema = z.record(JsonValueSchema);
export const JsonArraySchema = z.array(JsonValueSchema);
export const JsonResponseSchema = z.union([JsonObjectSchema, JsonArraySchema]);

const MarketCsgoDictionaryEntrySchema = z.union([
  z.string(),
  z.object({ name: z.string().optional(), market_hash_name: z.string().optional() }).passthrough()
]);

export const MarketCsgoSchemas = {
  prices: JsonResponseSchema,
  fullExport: JsonResponseSchema,
  classInstancePrices: JsonResponseSchema,
  orders: JsonResponseSchema,
  fullHistoryAll: JsonResponseSchema,
  fullHistoryItem: JsonResponseSchema,
  dictionaryNames: z.union([
    z.record(MarketCsgoDictionaryEntrySchema),
    z.array(MarketCsgoDictionaryEntrySchema),
    z.object({ items: z.array(MarketCsgoDictionaryEntrySchema) }).passthrough()
  ])
};

export const SkinportItemSchema = z
  .object({
    market_hash_name: z.string().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/),
    suggested_price: z.union([z.string(), z.number()]).nullable().optional(),
    min_price: z.union([z.string(), z.number()]).nullable().optional(),
    max_price: z.union([z.string(), z.number()]).nullable().optional(),
    mean_price: z.union([z.string(), z.number()]).nullable().optional(),
    quantity: z.number().int().nonnegative().nullable().optional()
  })
  .passthrough();

export const SkinportSalesHistoryItemSchema = z
  .object({
    market_hash_name: z.string().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    sales: z.union([z.number().int().nonnegative(), z.array(JsonValueSchema)]).optional(),
    min_price: z.union([z.string(), z.number()]).nullable().optional(),
    max_price: z.union([z.string(), z.number()]).nullable().optional(),
    avg_price: z.union([z.string(), z.number()]).nullable().optional(),
    mean_price: z.union([z.string(), z.number()]).nullable().optional()
  })
  .passthrough();

export const SkinportSchemas = {
  items: z.array(SkinportItemSchema),
  salesHistory: z.array(SkinportSalesHistoryItemSchema)
};
