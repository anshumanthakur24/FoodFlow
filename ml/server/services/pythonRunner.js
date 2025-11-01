const { spawn } = require('child_process');

// Executes the Python inference module and returns parsed JSON output.
function runInference({ pythonBin, cwd, modelDir, records }) {
  return new Promise((resolve, reject) => {
    const args = ['-m', 'src.infer', '--model-dir', modelDir];
    const child = spawn(pythonBin, args, { cwd });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const error = new Error(`Python process exited with code ${code}`);
        error.stderr = stderr;
        return reject(error);
      }
      try {
        const payload = JSON.parse(stdout || '{}');
        return resolve(payload);
      } catch (parseError) {
        const error = new Error('Failed to parse Python output');
        error.stderr = stderr;
        error.stdout = stdout;
        return reject(error);
      }
    });

    child.stdin.write(JSON.stringify({ records }));
    child.stdin.end();
  });
}

module.exports = {
  runInference,
};
