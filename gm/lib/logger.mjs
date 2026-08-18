// Minimal structured JSON-line logger. One JSON object per line on stdout
// (or stderr for warn/error), so both humans (via `| jq`) and the smoke
// test (via JSON.parse per line) can consume it.

function emit(stream, level, msg, fields) {
  const line = { ts: new Date().toISOString(), level, msg, ...fields };
  stream.write(JSON.stringify(line) + "\n");
}

export const log = {
  info(msg, fields = {}) {
    emit(process.stdout, "info", msg, fields);
  },
  warn(msg, fields = {}) {
    emit(process.stderr, "warn", msg, fields);
  },
  error(msg, fields = {}) {
    emit(process.stderr, "error", msg, fields);
  },
};
