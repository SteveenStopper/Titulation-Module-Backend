require("dotenv").config(); // Carga variables de entorno desde .env
const express = require("express"); // Importamos express
const prisma = require("./prisma/client"); // Prisma (singleton)
const errorHandler = require("./src/middlewares/errorHandler"); // Error handler
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const requestLogger = require("./src/middlewares/requestLogger");
const logger = require("./src/utils/logger");
const { setupGracefulShutdown } = require("./src/utils/shutdown");
const port = process.env.PORT || 3000; // Puerto

// Inicializamos express
const app = express();

// Middlewares
app.use(express.json());
app.use(requestLogger);
app.use(helmet());
app.use(cors());
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Rutas
app.use("/api/v1", require("./src/routes"));

// Error handler
app.use(errorHandler);

// Iniciar servidor
const server = app.listen(port, () => {
  logger.info(`Server inicializado en el puerto ${port}`);
});

// Configurar apagado controlado
setupGracefulShutdown(server, prisma);