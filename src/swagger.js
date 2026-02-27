const path = require('path');
const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const port = process.env.PORT || 3333;

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Módulo Titulación API',
    version: '1.0.0',
  },
  servers: [
    {
      url: `http://localhost:${port}`,
      description: 'Sistema de titulación',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
};

const swaggerSpec = swaggerJSDoc({
  definition: swaggerDefinition,
  apis: [
    path.join(__dirname, 'routes', '**', '*.js'),
    path.join(__dirname, 'routes', '*.js'),
  ],
});

module.exports = {
  swaggerUi,
  swaggerSpec,
};
