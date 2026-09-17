// Verifies the app version is consistent across every file that carries it,
// and — when given a release tag — that the tag matches too.
//
//   node scripts/desktop/check-version.mjs            # cross-file consistency
//   node scripts/desktop/check-version.mjs 1.2.0      # …and must equal 1.2.0
//   node scripts/desktop/check-version.mjs v1.2.0     # leading "v" is tolerated
//
// In CI the tag is read from $GITHUB_REF_NAME when no argument is passed, so a
// `git push --tags` that forgets to bump `tauri.conf.json` fails the build
// instead of shipping a bundle stamped with the wrong CFBundleShortVersionString
// (see issue #12).

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// tauri.conf.json is the source of truth — Tauri bakes its `version` into the
// macOS Info.plist, the Windows installer, and NEXT_PUBLIC_APP_VERSION.
const SOURCES = [
  {
    file: "src-tauri/tauri.conf.json",
    read: (t) => JSON.parse(t).version,
  },
  {
    file: "package.json",
    read: (t) => JSON.parse(t).version,
  },
  {
    file: "src-tauri/Cargo.toml",
    read: (t) => t.match(/^\s*\[package\][\s\S]*?^\s*version\s*=\s*"([^"]+)"/m)?.[1],
  },
  {
    file: "src-tauri/Cargo.lock",
    read: (t) =>
      t.match(/name = "heliosgen-desktop"\r?\nversion = "([^"]+)"/)?.[1],
  },
];

const found = SOURCES.map(({ file, read }) => {
  let version;
  try {
    version = read(readFileSync(join(ROOT, file), "utf8"));
  } catch (err) {
    console.error(`✗ ${file}: could not read (${err.message})`);
    process.exitCode = 1;
    return { file, version: null };
  }
  if (!version) {
    console.error(`✗ ${file}: no version found`);
    process.exitCode = 1;
  }
  return { file, version };
});

const canonical = found[0].version;
let ok = Boolean(canonical);

for (const { file, version } of found) {
  if (version && version !== canonical) {
    console.error(`✗ ${file}: ${version} (expected ${canonical})`);
    ok = false;
  } else if (version) {
    console.log(`✓ ${file}: ${version}`);
  }
}

const rawTag = process.argv[2] || process.env.GITHUB_REF_NAME || "";
const tag = rawTag.replace(/^v/, "").trim();
if (tag && /^\d+\.\d+\.\d+/.test(tag)) {
  if (tag !== canonical) {
    console.error(
      `✗ release tag ${rawTag} does not match version ${canonical} — bump ` +
        `src-tauri/tauri.conf.json (and package.json / Cargo.toml / Cargo.lock)`,
    );
    ok = false;
  } else {
    console.log(`✓ release tag ${rawTag} matches`);
  }
}

if (!ok) {
  process.exitCode = 1;
} else {
  console.log(`\nversion OK: ${canonical}`);
}
