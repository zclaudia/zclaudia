import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';

export async function inventoryPlugin(directory) {
  const root = await realpath(directory);
  const files = [];
  const dependencies = [];
  async function visit(relative = '') {
    for (const name of (await readdir(path.join(root, relative))).sort()) {
      const local = path.join(relative, name);
      const filename = path.join(root, local);
      const metadata = await lstat(filename);
      const portable = local.split(path.sep).join('/');
      if (metadata.isSymbolicLink()) {
        const target = await readlink(filename);
        const resolved = await realpath(filename);
        if (
          path.isAbsolute(target) ||
          (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
        ) {
          throw new Error(`Non-relocatable plugin dependency: ${portable}`);
        }
        files.push({ path: portable, link: target.split(path.sep).join('/') });
      } else if (metadata.isDirectory()) await visit(local);
      else if (metadata.isFile()) {
        const content = await readFile(filename);
        files.push({
          path: portable,
          sha256: createHash('sha256').update(content).digest('hex'),
          executable: !!(metadata.mode & 0o111),
        });
        if (name === 'package.json') {
          const pkg = JSON.parse(content.toString());
          if (pkg.name && pkg.version)
            dependencies.push({
              name: pkg.name,
              version: pkg.version,
              license: pkg.license ?? 'See package license',
              path: portable,
            });
        }
      } else throw new Error(`Unsupported plugin resource: ${portable}`);
    }
  }
  await visit();
  return {
    treeSha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    files,
    dependencies,
  };
}
