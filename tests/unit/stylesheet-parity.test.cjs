const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const postcss = require("postcss");

// Captured from the original globals.css before any stylesheet extraction.
// Whitespace and comments may change; selectors, declaration values, rule order,
// media queries, keyframes, and external imports must remain identical.
const originalStylesheetDigest = "b06ae7f8143a1d0a423748f53813b783dea5a78d03b151da43f8526957980456";

function readStylesheet(filename, ancestors = []) {
  assert.ok(!ancestors.includes(filename), `cyclic stylesheet import: ${filename}`);
  const root = postcss.parse(readFileSync(filename, "utf8"), { from: filename });
  root.walkAtRules("import", (rule) => {
    const localImport = rule.params.match(/^["'](\.[^"']+)["']$/);
    if (!localImport) return;
    const imported = readStylesheet(path.resolve(path.dirname(filename), localImport[1]), [...ancestors, filename]);
    rule.replaceWith(...imported.nodes);
  });
  return root;
}

function canonicalize(node) {
  const result = { type: node.type };
  for (const key of ["name", "params", "selector", "prop", "value", "important"]) {
    if (node[key] !== undefined) result[key] = node[key];
  }
  if (node.nodes) result.nodes = node.nodes.filter((child) => child.type !== "comment").map(canonicalize);
  return result;
}

test("ordered global CSS rules match the original cascade", () => {
  const root = readStylesheet(path.join(__dirname, "../../app/globals.css"));
  assert.equal(root.nodes.length, 434);
  const digest = createHash("sha256").update(JSON.stringify(canonicalize(root))).digest("hex");
  assert.equal(digest, originalStylesheetDigest);
});
