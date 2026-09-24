import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (rawPort === undefined || rawPort.trim() === "") {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const host = process.env["HOST"]?.trim() || "0.0.0.0";
const server = app.listen(port, host);
let shuttingDown = false;

server.on("error", (error) => {
  logger.error({ err: error, host, port }, "Server error");
  process.exitCode = 1;
});

server.on("listening", () => {
  logger.info({ host, port }, "Server listening");
});

const shutdown = (signal: NodeJS.Signals): void => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, "Shutting down");
  const forceExitTimer = setTimeout(() => {
    logger.error({ signal }, "Graceful shutdown timed out");
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();

  try {
    server.close((error) => {
      clearTimeout(forceExitTimer);
      if (error) {
        logger.error({ err: error, signal }, "Error closing server");
        process.exitCode = 1;
      }
    });
  } catch (error) {
    clearTimeout(forceExitTimer);
    logger.error({ err: error, signal }, "Error closing server");
    process.exitCode = 1;
  }
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
