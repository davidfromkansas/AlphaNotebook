import { Sandbox } from "@vercel/sandbox";
import { createHash } from "node:crypto";

export interface SourceFile {
  sourceId: string;
  collectionId: string;
  title: string;
  author: string | null;
  url: string | null;
  content: string;
}

/**
 * A persistent Vercel Sandbox microVM scoped to a single user. The whole
 * filesystem mirrors the user's workspace and survives between chats.
 *
 * Layout inside the VM:
 *   /vercel/sandbox/
 *     .manifest.json                       # sourceId -> { collectionId, hash }
 *     collections/<collectionId>/
 *       index.json                         # that collection's sources
 *       sources/<sourceId>.md
 *     scratch/<chatId>/active_sources.json  # in-scope sourceIds for one chat
 *
 * `workdir` is the active collection's directory — the cwd the agent's tools
 * see, so `sources/` and `index.json` resolve exactly like the old layout.
 */
export interface SandboxSession {
  sessionId: string;
  userId: string;
  collectionId: string;
  basePath: string;
  workdir: string;
  sandbox: Sandbox;
}

const BASE_PATH = "/vercel/sandbox";
const MANIFEST_FILE = ".manifest.json";

interface ManifestEntry {
  collectionId: string;
  hash: string;
}
type Manifest = Record<string, ManifestEntry>;

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function collectionDir(collectionId: string): string {
  return `${BASE_PATH}/collections/${collectionId}`;
}

function sourcePath(collectionId: string, sourceId: string): string {
  return `${collectionDir(collectionId)}/sources/${sourceId}.md`;
}

/**
 * Resume (or create) the persistent per-user sandbox and point the session at
 * the active collection's directory.
 *
 * Persistence is the SDK default: the filesystem auto-snapshots on stop and is
 * restored on resume. `getOrCreate` resumes an existing sandbox by name or
 * creates a fresh one (running `onCreate` once).
 *
 * Auth: requires `VERCEL_OIDC_TOKEN` (auto-provided on Vercel deploys; run
 * `vercel link && vercel env pull` locally) or a `VERCEL_TOKEN` access token.
 */
export async function getOrCreateUserSandbox(
  userId: string,
  collectionId: string
): Promise<SandboxSession> {
  const name = `user-${userId}`;
  const sandbox = await Sandbox.getOrCreate({
    name,
    runtime: "node24",
    // Bound a single working session; the snapshot persists across sessions.
    timeout: 10 * 60_000,
    onCreate: async (sbx) => {
      await sbx.runCommand("mkdir", ["-p", `${BASE_PATH}/collections`]);
    },
  });

  const workdir = collectionDir(collectionId);
  // Ensure the active collection's sources dir + scratch root exist.
  await sandbox.runCommand("mkdir", ["-p", `${workdir}/sources`, `${BASE_PATH}/scratch`]);

  return {
    sessionId: sandbox.name,
    userId,
    collectionId,
    basePath: BASE_PATH,
    workdir,
    sandbox,
  };
}

async function readManifest(session: SandboxSession): Promise<Manifest> {
  const result = await session.sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", `cat ${BASE_PATH}/${MANIFEST_FILE} 2>/dev/null || echo '{}'`],
  });
  try {
    return JSON.parse(await result.stdout()) as Manifest;
  } catch {
    return {};
  }
}

/**
 * Sync the user's entire workspace into the persistent filesystem: write new or
 * changed sources, move sources whose collection changed, and prune deleted
 * ones. Dirty-checking is by content hash recorded in `.manifest.json`, so
 * steady-state reconciles write ~0 files. Postgres remains the source of truth.
 */
export async function reconcileWorkspace(
  session: SandboxSession,
  allSources: SourceFile[]
): Promise<void> {
  const prev = await readManifest(session);
  const next: Manifest = {};

  const toWrite: { path: string; content: Buffer }[] = [];
  const toDelete: string[] = [];
  const dirsNeeded = new Set<string>();

  for (const s of allSources) {
    const hash = hashContent(s.content);
    next[s.sourceId] = { collectionId: s.collectionId, hash };

    const before = prev[s.sourceId];
    const movedCollection = before && before.collectionId !== s.collectionId;
    const changed = !before || before.hash !== hash || movedCollection;

    if (movedCollection) {
      toDelete.push(sourcePath(before.collectionId, s.sourceId));
    }
    if (changed) {
      dirsNeeded.add(`${collectionDir(s.collectionId)}/sources`);
      toWrite.push({
        path: sourcePath(s.collectionId, s.sourceId),
        content: Buffer.from(s.content, "utf-8"),
      });
    }
  }

  // Prune sources that no longer exist in the workspace.
  for (const sourceId of Object.keys(prev)) {
    if (!next[sourceId]) {
      toDelete.push(sourcePath(prev[sourceId].collectionId, sourceId));
    }
  }

  if (dirsNeeded.size > 0) {
    await session.sandbox.runCommand("mkdir", ["-p", ...dirsNeeded]);
  }
  if (toDelete.length > 0) {
    await session.sandbox.runCommand("rm", ["-f", ...toDelete]);
  }
  if (toWrite.length > 0) {
    await session.sandbox.writeFiles(toWrite);
  }

  // Rewrite the active collection's index.json + the manifest.
  const collectionSources = allSources.filter(
    (s) => s.collectionId === session.collectionId
  );
  const index = collectionSources.map((s) => ({
    sourceId: s.sourceId,
    title: s.title,
    author: s.author,
    url: s.url,
    lineCount: s.content.split("\n").length,
  }));

  await session.sandbox.writeFiles([
    {
      path: `${session.workdir}/index.json`,
      content: Buffer.from(JSON.stringify(index, null, 2), "utf-8"),
    },
    {
      path: `${BASE_PATH}/${MANIFEST_FILE}`,
      content: Buffer.from(JSON.stringify(next, null, 2), "utf-8"),
    },
  ]);
}

/**
 * Write `scratch/<chatId>/active_sources.json` listing the sourceIds the agent
 * may cite for this chat, and return its path relative to the workdir.
 */
export async function writeActiveSources(
  session: SandboxSession,
  chatId: string,
  sourceIds: string[]
): Promise<void> {
  const dir = `${BASE_PATH}/scratch/${chatId}`;
  await session.sandbox.runCommand("mkdir", ["-p", dir]);
  await session.sandbox.writeFiles([
    {
      path: `${dir}/active_sources.json`,
      content: Buffer.from(JSON.stringify(sourceIds, null, 2), "utf-8"),
    },
  ]);
}

/**
 * Read a file from the sandbox. Relative paths resolve against the active
 * collection workdir (so `sources/<id>.md` and `index.json` just work).
 */
export async function readSandboxFile(
  session: SandboxSession,
  relativeOrAbsolute: string
): Promise<string> {
  const path = relativeOrAbsolute.startsWith("/")
    ? relativeOrAbsolute
    : `${session.workdir}/${relativeOrAbsolute}`;
  const result = await session.sandbox.runCommand("cat", [path]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to read ${path}: ${await result.stderr()}`);
  }
  return await result.stdout();
}

/**
 * Execute a bash command inside the sandbox with cwd = active collection
 * workdir. Same return shape as before, so callers don't change.
 */
export async function execBash(
  session: SandboxSession,
  command: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await session.sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", command],
    cwd: session.workdir,
  });
  return {
    stdout: await result.stdout(),
    stderr: await result.stderr(),
    exitCode: result.exitCode,
  };
}
