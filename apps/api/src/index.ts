import { loadConfig } from "@cs2-bot/config";
import { createApp } from "./server.js";

const config = loadConfig();
const app = createApp({ config });

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
