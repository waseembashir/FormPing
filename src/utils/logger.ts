const isDebug = process.env['DEBUG'] === 'true' || process.env['DEBUG'] === '1';

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export const logger = {
  info(msg: string): void {
    process.stderr.write(`[${timestamp()}] INFO  ${msg}\n`);
  },
  warn(msg: string): void {
    process.stderr.write(`[${timestamp()}] WARN  ${msg}\n`);
  },
  error(msg: string): void {
    process.stderr.write(`[${timestamp()}] ERROR ${msg}\n`);
  },
  debug(msg: string): void {
    if (isDebug) process.stderr.write(`[${timestamp()}] DEBUG ${msg}\n`);
  },
};
