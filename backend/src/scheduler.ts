import "./config/env";
import { startCronScheduler } from "./queue/queue";
import { logger } from "./utils/logger";

startCronScheduler();
logger.info("SCHEDULER", "Processo scheduler em execucao (apenas cron + BullMQ add)");
