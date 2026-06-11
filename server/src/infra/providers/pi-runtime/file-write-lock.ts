const fileWriteLocks = new Map<string, Promise<void>>();

export async function runWithFileWriteLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = fileWriteLocks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  fileWriteLocks.set(filePath, previous.then(() => current, () => current));
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (fileWriteLocks.get(filePath) === current) {
      fileWriteLocks.delete(filePath);
    }
  }
}
