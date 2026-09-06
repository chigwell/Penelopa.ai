"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// desktop/runtime/files.cjs
var require_files = __commonJS({
  "desktop/runtime/files.cjs"(exports2, module2) {
    "use strict";
    var fs = require("node:fs");
    var path2 = require("node:path");
    var os = require("node:os");
    var crypto = require("node:crypto");
    var { execFileSync } = require("node:child_process");
    function home() {
      return path2.resolve(process.env.AUTO_IMPROVE_HOME || path2.join(os.homedir(), ".auto-improve"));
    }
    function mkdir(dir) {
      fs.mkdirSync(dir, { recursive: true, mode: 448 });
    }
    function syncDir(dir) {
      if (process.platform === "win32") return;
      const fd = fs.openSync(dir, "r");
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }
    function atomicWrite(file, value, mode = 384) {
      mkdir(path2.dirname(file));
      const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      const fd = fs.openSync(tmp, "wx", mode);
      try {
        fs.writeFileSync(fd, value);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      try {
        fs.renameSync(tmp, file);
        syncDir(path2.dirname(file));
      } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      }
      if (process.platform !== "win32") fs.chmodSync(file, mode);
    }
    function writeJson(file, value) {
      atomicWrite(file, JSON.stringify(value, null, 2) + "\n");
    }
    function readJson(file, fallback) {
      try {
        return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
      } catch (error) {
        if (error.code === "ENOENT") return fallback;
        throw new Error(`Cannot read valid JSON: ${path2.basename(file)}`);
      }
    }
    function protect(dir) {
      mkdir(dir);
      if (process.platform === "win32") {
        const sid = execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true }).match(/S-1-5-[0-9-]+/);
        if (!sid) throw new Error("Cannot determine the current Windows user.");
        execFileSync("icacls.exe", [dir, "/inheritance:r", "/grant:r", `*${sid[0]}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F"], { stdio: "ignore", windowsHide: true });
      } else fs.chmodSync(dir, 448);
    }
    function protectFile(file) {
      if (process.platform !== "win32") return fs.chmodSync(file, 384);
      const sid = execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true }).match(/S-1-5-[0-9-]+/);
      if (!sid) throw new Error("Cannot determine the current Windows user.");
      execFileSync("icacls.exe", [file, "/inheritance:r", "/grant:r", `*${sid[0]}:F`, "*S-1-5-18:F"], { stdio: "ignore", windowsHide: true });
    }
    function lock(file) {
      mkdir(path2.dirname(file));
      try {
        fs.mkdirSync(file, { mode: 448 });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const owner = readJson(path2.join(file, "owner.json"), null);
        if (owner) {
          try {
            process.kill(owner.pid, 0);
            return null;
          } catch (e) {
            if (e.code !== "ESRCH") return null;
          }
        } else if (Date.now() - fs.statSync(file).mtimeMs < 3e4) return null;
        fs.rmSync(file, { recursive: true, force: true });
        return lock(file);
      }
      writeJson(path2.join(file, "owner.json"), { pid: process.pid });
      return () => fs.rmSync(file, { recursive: true, force: true });
    }
    function settings(root = home()) {
      const prefs = { paused: false, notifications: false, autostart: false, ...readJson(path2.join(root, "preferences.json"), {}) };
      if (fs.existsSync(path2.join(root, "collection-disabled"))) prefs.paused = true;
      return prefs;
    }
    function installState(root = home()) {
      return readJson(path2.join(root, "install.json"), null);
    }
    function credential(state) {
      if (!state) return "";
      if (state.platform === "win32") return readJson(state.configFile, {}).token || "";
      const values = envFile(state.configFile);
      return values.AUTO_IMPROVE_TOKEN || "";
    }
    function envFile(file) {
      if (!fs.existsSync(file)) return {};
      return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).flatMap((line) => {
        const match = line.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/);
        if (!match) return [];
        let value = match[2];
        if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        return [[match[1], value]];
      }));
    }
    function fingerprint(value) {
      return crypto.createHash("sha256").update(value).digest("hex");
    }
    module2.exports = { home, mkdir, atomicWrite, writeJson, readJson, protect, protectFile, syncDir, lock, settings, installState, credential, envFile, fingerprint };
  }
});

// desktop/runtime/network.cjs
var require_network = __commonJS({
  "desktop/runtime/network.cjs"(exports2, module2) {
    "use strict";
    var fs = require("node:fs");
    var path2 = require("node:path");
    var crypto = require("node:crypto");
    var { mkdir } = require_files();
    function allowedUrl(value) {
      const url = new URL(value);
      if (url.username || url.password || url.protocol !== "https:" && !(process.env.PENELOPA_TESTING === "1" && url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) throw new Error("A secure HTTPS URL is required.");
      return url;
    }
    async function download(url, destination, expectedHash, maxBytes = 512 * 1024 * 1024) {
      allowedUrl(url);
      if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error("The release is missing a SHA-256 checksum.");
      mkdir(path2.dirname(destination));
      for (let attempt = 0; attempt < 3; attempt++) {
        const temporary = `${destination}.${process.pid}.download`;
        try {
          let target = url;
          let response;
          for (let redirects = 0; redirects <= 5; redirects++) {
            response = await fetch(allowedUrl(target), { signal: AbortSignal.timeout(3e5), redirect: "manual" });
            if (![301, 302, 303, 307, 308].includes(response.status)) break;
            const location = response.headers.get("location");
            await response.body?.cancel();
            if (!location || redirects === 5) throw new Error("Too many download redirects.");
            target = allowedUrl(new URL(location, target).href).href;
          }
          if (!response.ok || !response.body) throw new Error(`Download returned HTTP ${response.status}.`);
          const hash = crypto.createHash("sha256");
          const fd = fs.openSync(temporary, "w", 384);
          let size = 0;
          try {
            for await (const chunk of response.body) {
              size += chunk.length;
              if (size > maxBytes) throw new Error("Download exceeds the allowed size.");
              hash.update(chunk);
              fs.writeSync(fd, chunk);
            }
            fs.fsyncSync(fd);
          } finally {
            fs.closeSync(fd);
          }
          if (hash.digest("hex") !== expectedHash) throw new Error("Download checksum mismatch.");
          fs.renameSync(temporary, destination);
          return destination;
        } catch (error) {
          fs.rmSync(temporary, { force: true });
          if (/checksum|size/.test(error.message) || attempt === 2) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1e3 * 2 ** attempt));
        }
      }
    }
    async function jsonRequest(url, init = {}) {
      allowedUrl(url);
      const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(2e4) });
      if (!response.ok) {
        const error = new Error(response.status === 429 ? `Rate limit reached. Try again after ${response.headers.get("retry-after") || "a few"} seconds.` : `Request returned HTTP ${response.status}.`);
        error.status = response.status;
        throw error;
      }
      return response.status === 204 ? null : response.json();
    }
    module2.exports = { allowedUrl, download, jsonRequest };
  }
});

// desktop/runtime/archive.cjs
var require_archive = __commonJS({
  "desktop/runtime/archive.cjs"(exports2, module2) {
    "use strict";
    var fs = require("node:fs");
    var path2 = require("node:path");
    var { mkdir, atomicWrite } = require_files();
    function crc32(data) {
      let crc = 4294967295;
      for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ 3988292384 & -(crc & 1);
      }
      return (crc ^ 4294967295) >>> 0;
    }
    function createZip(entries) {
      const records = [];
      const central = [];
      let offset = 0;
      for (const [name, bytes] of entries.sort(([a], [b]) => a.localeCompare(b))) {
        const filename = Buffer.from(name);
        const data = Buffer.from(bytes);
        const checksum = crc32(data);
        const header = Buffer.alloc(30);
        header.writeUInt32LE(67324752);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(2048, 6);
        header.writeUInt16LE(33, 12);
        header.writeUInt32LE(checksum, 14);
        header.writeUInt32LE(data.length, 18);
        header.writeUInt32LE(data.length, 22);
        header.writeUInt16LE(filename.length, 26);
        const directory2 = Buffer.alloc(46);
        directory2.writeUInt32LE(33639248);
        directory2.writeUInt16LE(20, 4);
        directory2.writeUInt16LE(20, 6);
        directory2.writeUInt16LE(2048, 8);
        directory2.writeUInt16LE(33, 14);
        directory2.writeUInt32LE(checksum, 16);
        directory2.writeUInt32LE(data.length, 20);
        directory2.writeUInt32LE(data.length, 24);
        directory2.writeUInt16LE(filename.length, 28);
        directory2.writeUInt32LE(offset, 42);
        records.push(header, filename, data);
        central.push(directory2, filename);
        offset += header.length + filename.length + data.length;
      }
      const directory = Buffer.concat(central);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(101010256);
      end.writeUInt16LE(entries.length, 8);
      end.writeUInt16LE(entries.length, 10);
      end.writeUInt32LE(directory.length, 12);
      end.writeUInt32LE(offset, 16);
      return Buffer.concat([...records, directory, end]);
    }
    function extractZip(buffer, destination) {
      let offset = 0;
      let total = 0;
      const seen = /* @__PURE__ */ new Set();
      mkdir(destination);
      while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 67324752) {
        if (offset + 30 > buffer.length) throw new Error("Truncated source archive.");
        const flags = buffer.readUInt16LE(offset + 6);
        const method = buffer.readUInt16LE(offset + 8);
        const size = buffer.readUInt32LE(offset + 18);
        const length = buffer.readUInt16LE(offset + 26);
        const extra = buffer.readUInt16LE(offset + 28);
        const start = offset + 30 + length + extra;
        const name = buffer.subarray(offset + 30, offset + 30 + length).toString("utf8");
        if (method !== 0 || flags !== 2048 || buffer.readUInt32LE(offset + 22) !== size || start + size > buffer.length) throw new Error("Unsupported source archive format.");
        if (!name || name.startsWith("/") || /[\\:\0]/.test(name) || name.split("/").some((part) => !part || part === "." || part === "..") || seen.has(name.toLowerCase())) throw new Error("Unsafe source archive entry.");
        total += size;
        if (total > 32 * 1024 * 1024 || seen.size > 2e3) throw new Error("Source archive exceeds the allowed size.");
        const data = buffer.subarray(start, start + size);
        if (crc32(data) !== buffer.readUInt32LE(offset + 14)) throw new Error("Corrupt source archive.");
        atomicWrite(path2.join(destination, ...name.split("/")), data);
        seen.add(name.toLowerCase());
        offset = start + size;
      }
      if (!seen.has("package.json") || offset + 4 > buffer.length || buffer.readUInt32LE(offset) !== 33639248) throw new Error("Incomplete source archive.");
    }
    module2.exports = { createZip, extractZip, crc32 };
  }
});

// desktop/release-config.json
var require_release_config = __commonJS({
  "desktop/release-config.json"(exports2, module2) {
    module2.exports = {
      version: "1.0.1",
      schemaVersion: 1,
      bridgeVersion: 1,
      nodeVersion: "24.20.0",
      electronVersion: "44.2.0",
      baseUrl: "https://penelopa.ai/desktop",
      minimumOs: {
        darwin: "13.5",
        win32: "10.0.19045",
        linux: "kernel 4.18, glibc 2.28"
      },
      minimumFreeBytes: {
        hooks: 3e8,
        desktop: 3e9
      },
      node: {
        "darwin-arm64": "40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8",
        "darwin-x64": "9e5b2644cf107befb6aefca676b96d3296bc10138096f022ed378d6233ed81f4",
        "linux-arm64": "3515603e2487879a39bc75716f1a2affd027500c64ba50e845cf72cb33219013",
        "linux-x64": "855d581f8a4eb1a8117e3426de25fe02770592febcfb31369aee1ffbfee9e8ec",
        "win-x64": "6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba"
      },
      electron: {
        "darwin-arm64": "f906dff5d054b1b92e5711781b13cc206fd7139ce66467503b9d0a3e6fbc9b02",
        "darwin-x64": "0c58057eebd23859389e2eba1555975bcbc8adebcc5aa97ff36c036125e2b21a",
        "win32-x64": "4021363e3090d67a144ebedb90765cf193b0e61f300c519c83f0174502a481da"
      }
    };
  }
});

// desktop/runtime/releases.cjs
var require_releases = __commonJS({
  "desktop/runtime/releases.cjs"(exports2, module2) {
    "use strict";
    var fs = require("node:fs");
    var path2 = require("node:path");
    var { execFileSync } = require("node:child_process");
    var { home, mkdir, protect, readJson, fingerprint, writeJson } = require_files();
    var { jsonRequest, download, allowedUrl } = require_network();
    var { extractZip } = require_archive();
    var current = require_release_config();
    function validateManifest(manifest) {
      if (manifest?.schemaVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(manifest.version) || !/^\d+\.\d+\.\d+$/.test(manifest.nodeVersion) || !/^[a-f0-9]{64}$/.test(manifest.source?.sha256)) throw new Error("This release manifest is not supported.");
      const url = allowedUrl(manifest.source.url);
      if (url.origin !== new URL(current.baseUrl).origin || !url.pathname.startsWith("/desktop/releases/")) throw new Error("The release source is not hosted by Penelopa.");
      return manifest;
    }
    function inventory(directory) {
      const entries = {};
      function visit(folder) {
        for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
          const file = path2.join(folder, item.name);
          if (item.isDirectory()) visit(file);
          else entries[path2.relative(directory, file)] = fingerprint(fs.readFileSync(file));
        }
      }
      visit(directory);
      return entries;
    }
    function sourceIntact(directory, manifest) {
      try {
        const marker = readJson(path2.join(directory, ".verified.json"), null);
        return marker?.sha256 === manifest.source.sha256 && marker.files && Object.keys(marker.files).length > 0 && Object.entries(marker.files).every(([name, hash]) => {
          const file = path2.resolve(directory, name);
          return file.startsWith(directory + path2.sep) && fingerprint(fs.readFileSync(file)) === hash;
        });
      } catch {
        return false;
      }
    }
    async function getManifest2(version = null) {
      return validateManifest(await jsonRequest(`${current.baseUrl}/${version ? `releases/${version}/` : ""}manifest.json`));
    }
    async function prepareSource2(manifest, root = home()) {
      validateManifest(manifest);
      protect(root);
      const destination = path2.join(root, "releases", `${manifest.version}-${manifest.source.sha256.slice(0, 16)}`);
      if (sourceIntact(destination, manifest)) return destination;
      const stage = `${destination}.staging-${process.pid}`;
      const archive = path2.join(root, "cache", `source-${manifest.source.sha256}.zip`);
      await download(manifest.source.url, archive, manifest.source.sha256, 32 * 1024 * 1024);
      fs.rmSync(stage, { recursive: true, force: true });
      mkdir(stage);
      try {
        extractZip(fs.readFileSync(archive), stage);
        if (readJson(path2.join(stage, "package.json")).version !== manifest.version) throw new Error("Source and manifest versions do not match.");
        writeJson(path2.join(stage, ".verified.json"), { sha256: manifest.source.sha256, files: inventory(stage) });
        const previous = `${destination}.incomplete-${process.pid}`;
        if (fs.existsSync(destination)) fs.renameSync(destination, previous);
        try {
          fs.renameSync(stage, destination);
        } catch (error) {
          if (fs.existsSync(previous)) fs.renameSync(previous, destination);
          throw error;
        }
        fs.rmSync(previous, { recursive: true, force: true });
        return destination;
      } finally {
        fs.rmSync(stage, { recursive: true, force: true });
      }
    }
    async function ensureRuntime(manifest, root = home()) {
      const platform = process.platform === "win32" ? "win" : process.platform;
      const key = `${platform}-${process.arch}`;
      const digest = manifest.node?.[key];
      if (!/^[a-f0-9]{64}$/.test(digest || "")) throw new Error("No verified Node runtime is available for this platform.");
      const folder = `node-v${manifest.nodeVersion}-${key}`;
      const destination = path2.join(root, "runtime", folder);
      const node = path2.join(destination, process.platform === "win32" ? "node.exe" : "bin/node");
      try {
        if (fs.existsSync(node) && execFileSync(node, ["--version"], { encoding: "utf8", windowsHide: true }).trim() === `v${manifest.nodeVersion}`) return node;
      } catch {
      }
      const extension = process.platform === "win32" ? "zip" : "tar.gz";
      const archive = path2.join(root, "cache", `${folder}.${extension}`);
      await download(`https://nodejs.org/dist/v${manifest.nodeVersion}/${folder}.${extension}`, archive, digest);
      const stage = path2.join(root, "runtime", `.staging-${process.pid}`);
      mkdir(stage);
      try {
        if (process.platform === "win32") {
          const quote = (value) => `'${value.replace(/'/g, "''")}'`;
          execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(stage)} -Force`], { windowsHide: true });
        } else execFileSync("tar", ["-xzf", archive, "-C", stage]);
        const stagedNode = path2.join(stage, folder, process.platform === "win32" ? "node.exe" : "bin/node");
        if (execFileSync(stagedNode, ["--version"], { encoding: "utf8", windowsHide: true }).trim() !== `v${manifest.nodeVersion}`) throw new Error("The downloaded runtime cannot run on this operating system.");
        const previous = `${destination}.incomplete-${process.pid}`;
        if (fs.existsSync(destination)) fs.renameSync(destination, previous);
        try {
          fs.renameSync(path2.join(stage, folder), destination);
        } catch (error) {
          if (fs.existsSync(previous)) fs.renameSync(previous, destination);
          throw error;
        }
        fs.rmSync(previous, { recursive: true, force: true });
      } finally {
        fs.rmSync(stage, { recursive: true, force: true });
      }
      return node;
    }
    module2.exports = { validateManifest, getManifest: getManifest2, prepareSource: prepareSource2, ensureRuntime, sourceIntact, inventory };
  }
});

// desktop/runtime/bootstrap.cjs
var path = require("node:path");
var { spawnSync } = require("node:child_process");
var { getManifest, prepareSource } = require_releases();
var config = require_release_config();
(async () => {
  const manifest = await getManifest(config.version);
  const source = await prepareSource(manifest);
  const result = spawnSync(process.execPath, [path.join(source, "runtime", "install.cjs"), ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
  process.exitCode = result.status ?? 1;
})().catch((error) => {
  process.stderr.write(`Penelopa: ${error.message}
`);
  process.exitCode = 1;
});
