require('dotenv').config(); // Carga variables de entorno desde .env

const prisma = require('./prisma/client'); // Prisma (singleton)
const logger = require('./src/utils/logger');
const { setupGracefulShutdown } = require('./src/utils/shutdown');

const app = require('./src/app');
const port = process.env.PORT || 3000; // Puerto

if (require.main === module) {
  const server = app.listen(port, () => {
    logger.info(`Server inicializado en el puerto ${port}`);
  });

  // Configurar apagado controlado
  setupGracefulShutdown(server, prisma);
}

module.exports = app;