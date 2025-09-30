const { createLogger, format, transports } = require("winston");

const level = process.env.LOG_LEVEL || "info";
const isProd = process.env.NODE_ENV === "production";

const prodFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.splat(),
  format.json()
);

const devFormat = format.combine(
  format.colorize(),
  format.timestamp(),
  format.errors({ stack: true }),
  format.splat(),
  format.printf((info) => {
    const { timestamp, level, message, requestId, stack, ...rest } = info;
    const rid = requestId ? ` reqId=${requestId}` : "";
    const meta = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
    if (stack) {
      return `${level}: [${timestamp}]${rid} ${message}\n${stack}`;
    }
    return `${level}: [${timestamp}]${rid} ${message}${meta}`;
  })
);

const logger = createLogger({
  level,
  format: isProd ? prodFormat : devFormat,
  defaultMeta: { service: "mod-titulacion-backend" },
  transports: [new transports.Console()],
});

module.exports = logger;
