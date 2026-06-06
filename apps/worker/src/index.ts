import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import { loadConfig, type AppConfig } from "@cs2-bot/config";
import { createLogger } from "@cs2-bot/core";

export const collectionQueueName = "read-only-marketplace-collection";

export const CollectionJobSchema = z.object({
  marketplace: z.literal("market_csgo"),
  requestedAt: z.coerce.date()
});

export type CollectionJob = z.infer<typeof CollectionJobSchema>;

export function createCollectionQueue(config: AppConfig) {
  const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue<CollectionJob>(collectionQueueName, { connection });

  return { queue, connection };
}

export function createCollectionWorker(config: AppConfig) {
  const logger = createLogger({ level: config.LOG_LEVEL });
  const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const worker = new Worker<CollectionJob>(
    collectionQueueName,
    async (job) => {
      const payload = CollectionJobSchema.parse(job.data);

      logger.info({ marketplace: payload.marketplace }, "read-only collection job accepted");

      return {
        readOnly: true,
        marketplace: payload.marketplace,
        requestedAt: payload.requestedAt.toISOString()
      };
    },
    { connection }
  );

  return { worker, connection };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });
  const { worker } = createCollectionWorker(config);

  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, err: error }, "collection job failed");
  });
}
