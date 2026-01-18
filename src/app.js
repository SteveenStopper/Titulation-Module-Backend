require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');

const errorHandler = require('./middlewares/errorHandler');
const corsMiddleware = require('./middlewares/cors');
const requestLogger = require('./middlewares/requestLogger');

const app = express();

// Deshabilitar generación de ETag para evitar 304 con If-None-Match en endpoints JSON
app.set('etag', false);

// Middlewares
app.use(express.json());
app.use(requestLogger);
app.use(helmet());
app.use(corsMiddleware);
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Rutas
app.use('/api', require('./routes'));

// Error handler
app.use(errorHandler);

module.exports = app;
