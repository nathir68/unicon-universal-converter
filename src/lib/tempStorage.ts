import os from 'os';
import path from 'path';
import fs from 'fs';

/**
 * Returns the temporary working directory for UniCon.
 * In serverless environments (Vercel/AWS Lambda), process.cwd() is read-only (/var/task),
 * so os.tmpdir() (/tmp) is required.
 */
export function getUniConTempDir(): string {
  const dir = path.join(os.tmpdir(), 'unicon');
  return dir;
}

export function getUploadsDir(): string {
  const dir = path.join(getUniConTempDir(), 'uploads');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getConvertedDir(): string {
  const dir = path.join(getUniConTempDir(), 'converted');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
