const multer = require("multer");
const fs = require("fs");
const path = require("path");

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");
const DOCS_DIR = path.join(UPLOAD_ROOT, "documents");

// Asegurar que exista el directorio de destino
function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      const target = req.uploadTargetDir && typeof req.uploadTargetDir === "string"
        ? req.uploadTargetDir
        : DOCS_DIR;
      ensureDir(target);
      cb(null, target);
    } catch (e) {
      cb(e);
    }
  },
  filename: function (req, file, cb) {
    const safeOriginal = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const timestamp = Date.now();
    cb(null, `${timestamp}_${safeOriginal}`);
  },
});

// Aceptar solo PDF
const fileFilter = (req, file, cb) => {
  const isPdfMime = file.mimetype === "application/pdf";
  const hasPdfExt = path.extname(file.originalname).toLowerCase() === ".pdf";
  if (isPdfMime && hasPdfExt) return cb(null, true);
  const err = new Error("Solo se permiten archivos PDF");
  err.status = 400;
  return cb(err);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 20 * 1024 * 1024 } }); // 20 MB

module.exports = upload;
