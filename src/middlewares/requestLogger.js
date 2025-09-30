const crypto = require("crypto");
const logger = require("../utils/logger");

function getRequestId(req) {
  return (
    req.headers["x-request-id"] ||
    req.headers["X-Request-Id"] ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"))
  );
}

module.exports = function requestLogger(req, res, next) {
  const requestId = getRequestId(req);
  req.id = requestId;
  req.log = logger.child({ requestId });
  res.setHeader("X-Request-Id", requestId);

  const start = Date.now();
  req.log.info({ method: req.method, url: req.originalUrl }, "request:start");

  res.on("finish", () => {
    const duration = Date.now() - start;
    req.log.info(
      { method: req.method, url: req.originalUrl, status: res.statusCode, duration },
      "request:finish"
    );
  });

  next();
};
