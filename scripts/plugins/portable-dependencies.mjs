import { cp, lstat, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

/** Copy the installed production graph into ordinary Node package directories.
 * Tauri's resource copier omits directory symlinks, including pnpm's links.
 * Resolve before copying, retain exact installed versions and peer contexts,
 * and use nested packages when two edges resolve to different instances.
 */
export async function copyPortableDependencies(
  source,
  destination,
  allowedRoot,
  { includeOptional = [] } = {}
) {
  const includeOptionalNames = new Set(includeOptional);
  const boundary = await realpath(allowedRoot);
  const graph = new Map();
  const inside = filename => filename === boundary || filename.startsWith(boundary + path.sep);
  const validName = name => /^(?:@[^/.\\]+\/)?[^/.\\][^/\\]*$/.test(name);

  async function resolveDependency(from, name, optional) {
    if (!validName(name)) throw new Error(`Invalid dependency name: ${name}`);
    for (let directory = from; inside(directory); directory = path.dirname(directory)) {
      const candidate = path.join(directory, 'node_modules', name);
      let resolved;
      try {
        resolved = await realpath(candidate);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      if (!inside(resolved)) throw new Error(`Dependency escapes source tree: ${name}`);
      return resolved;
    }
    if (optional) return null;
    throw new Error(`Missing production dependency ${name} from ${from}`);
  }

  async function discover(directory) {
    if (graph.has(directory)) return graph.get(directory);
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    const edges = new Map();
    graph.set(directory, edges); // Allow dependency cycles.
    const names = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      // Optional dependencies are excluded by default (same policy as the
      // former deploy --prod --no-optional); only explicitly included names —
      // e.g. the SDK engine package for the current target platform — enter
      // the graph.
      ...Object.keys(manifest.optionalDependencies ?? {}).filter(name =>
        includeOptionalNames.has(name)
      ),
    ]);
    for (const name of [...names].sort()) {
      if (
        Object.hasOwn(manifest.optionalDependencies ?? {}, name) &&
        !includeOptionalNames.has(name)
      ) {
        continue;
      }
      const optional =
        !Object.hasOwn(manifest.dependencies ?? {}, name) &&
        manifest.peerDependenciesMeta?.[name]?.optional === true;
      const resolved = await resolveDependency(directory, name, optional);
      if (!resolved) continue;
      edges.set(name, resolved);
      await discover(resolved);
    }
    return edges;
  }

  const sourceRoot = await realpath(source);
  if (!inside(sourceRoot)) throw new Error('Dependency source escapes source tree');
  const roots = await discover(sourceRoot);
  const output = path.resolve(destination);
  const placements = new Map();
  const queue = [];
  function place(target, origin) {
    placements.set(target, origin);
    queue.push({ target, origin });
    if (queue.length > 10_000) throw new Error('Production dependency graph exceeds copy limit');
  }
  for (const [name, origin] of roots) place(path.join(output, name), origin);

  function nearestDependency(from, name) {
    for (let dir = from; dir.startsWith(output + path.sep); dir = path.dirname(dir)) {
      const existing = placements.get(path.join(dir, 'node_modules', name));
      if (existing) return existing;
    }
    return placements.get(path.join(output, name));
  }

  for (let i = 0; i < queue.length; i++) {
    const { target, origin } = queue[i];
    for (const [name, dependency] of graph.get(origin)) {
      if (nearestDependency(target, name) === dependency) continue;
      const hoisted = path.join(output, name);
      place(
        placements.has(hoisted) ? path.join(target, 'node_modules', name) : hoisted,
        dependency
      );
    }
  }

  await mkdir(output, { recursive: true });
  for (const { target, origin } of queue) {
    await mkdir(target, { recursive: true });
    for (const name of await readdir(origin)) {
      if (name === 'node_modules') continue;
      await cp(path.join(origin, name), path.join(target, name), {
        recursive: true,
        filter: async filename => {
          // Package assets must also survive the resource copier. Fail rather
          // than silently ship a dangling link or follow an unbounded graph.
          if ((await lstat(filename)).isSymbolicLink()) {
            throw new Error(`Unsupported package asset symlink: ${filename}`);
          }
          return true;
        },
      });
    }
  }
  return { packages: queue.length };
}
