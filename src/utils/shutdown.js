const logger = require("./logger");

function setupGracefulShutdown(server, prisma) {
  let shuttingDown = false;

  async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    try {
      logger.info(`${signal} received: starting graceful shutdown...`);
      await new Promise((resolve) => server.close(resolve));
      await prisma.$disconnect();
      logger.info("Connections closed. Exiting.");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  }

  // Handle signals
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

  // Handle uncaught errors
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "unhandledRejection");
  });

  process.on("uncaughtException", (err) => {
    logger.error({ err }, "uncaughtException");
    gracefulShutdown("uncaughtException");
  });
}

module.exports = { setupGracefulShutdown };
