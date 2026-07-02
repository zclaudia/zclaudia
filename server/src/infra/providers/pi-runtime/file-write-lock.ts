import path from 'path';

const fileWriteLocks = new Map<string, Promise<void>>();

export async function runWithFileWriteLock<T>(
  filePath: string,
  operation: () => Promise<T>
): Promise<T> {
  const key = path.resolve(filePath);
  const previous = fileWriteLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  const tail = previous.then(
    () => current,
    () => current
  );
  fileWriteLocks.set(key, tail);
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (fileWriteLocks.get(key) === tail) {
      fileWriteLocks.delete(key);
    }
  }
}
