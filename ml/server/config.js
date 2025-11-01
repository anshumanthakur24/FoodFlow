const path = require("path");
const dotenv = require("dotenv");

const ROOT_DIR = path.resolve(__dirname, "..");

// Load shared environment variables (falls back silently if .env is absent).
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const resolvePath = (target) => {
  if (!target) {
    return undefined;
  }
  return path.isAbsolute(target) ? target : path.resolve(ROOT_DIR, target);
};

const artifactsDir = resolvePath(process.env.ML_OUTPUT_DIR || "artifacts");

module.exports = {
  rootDir: ROOT_DIR,
  pythonBin: process.env.PYTHON_BIN || "python",
  artifactsDir,
  port: Number(process.env.ML_SERVER_PORT || 5050),
};
