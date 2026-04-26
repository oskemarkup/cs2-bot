import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { z } from "zod";
import { loadConfig, type AppConfig } from "@cs2-bot/config";
import { MarketplaceSchema } from "@cs2-bot/connectors";

export const collectionQueueName = "read-only-marketplace-collection";

export const CollectionJobSchema = z.object({
  marketplace: MarketplaceSchema,
  requestedAt: z.coerce.date()
});

export type CollectionJob = z.infer<typeof CollectionJobSchema>;

export function createCollectionQueue(config: AppConfig) {
  const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue<CollectionJob>(collectionQueueName, { connection });

  return { queue, connection };
}

export function createCollectionWorker(config: AppConfig) {
  const logger = pino({ level: config.LOG_LEVEL });
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
  const { worker } = createCollectionWorker(config);

  worker.on("failed", (job, error) => {
    pino({ level: config.LOG_LEVEL }).error({ jobId: job?.id, error }, "collection job failed");
  });
}
