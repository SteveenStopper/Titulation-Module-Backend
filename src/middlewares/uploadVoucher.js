const multer = require("multer");
const fs = require("fs");
const path = require("path");

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");
const VOUCHERS_DIR = path.join(UPLOAD_ROOT, "vouchers");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      const target = req.uploadTargetDir && typeof req.uploadTargetDir === "string"
        ? req.uploadTargetDir
        : VOUCHERS_DIR;
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

// Aceptar PDF e imágenes (png, jpg, jpeg)
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExt = [".pdf", ".png", ".jpg", ".jpeg"];
  const allowedMime = [
    "application/pdf",
    "image/png",
    "image/jpeg",
  ];
  if (allowedExt.includes(ext) && allowedMime.includes(file.mimetype)) return cb(null, true);
  const err = new Error("Solo se permiten PDF o imágenes (png, jpg, jpeg)");
  err.status = 400;
  return cb(err);
};

const uploadVoucher = multer({ storage, fileFilter, limits: { fileSize: 20 * 1024 * 1024 } });

module.exports = uploadVoucher;
