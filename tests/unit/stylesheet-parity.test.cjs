const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const postcss = require("postcss");

// The approved Session Explorer redesign replaces the historical whole-CSS
// fingerprint. Guard readability, keyboard access, motion preferences and
// intentional cascade boundaries while allowing reviewed visual changes.
const entrypoint = path.join(__dirname, "../../app/globals.css");
const localImports = [];
function readStylesheet(filename, ancestors = []) {
  assert.ok(!ancestors.includes(filename), `cyclic stylesheet import: ${filename}`);
  const root = postcss.parse(readFileSync(filename, "utf8"), { from: filename });
  root.walkAtRules("import", rule => {
    const localImport = rule.params.match(/^["'](\.[^"']+)["']$/);
    if (!localImport) return;
    const importedPath = path.resolve(path.dirname(filename), localImport[1]);
    assert.ok(!localImports.includes(importedPath), `duplicate stylesheet import: ${importedPath}`);
    localImports.push(importedPath);
    const imported = readStylesheet(importedPath, [...ancestors, filename]);
    rule.replaceWith(...imported.nodes);
  });
  return root;
}
const stylesheet = readStylesheet(entrypoint);
const rules = [];
stylesheet.walkRules(rule => rules.push(rule));
const selectors = rule => rule.selectors.map(selector => selector.trim());
const declarations = rule => Object.fromEntries((rule.nodes || []).filter(node => node.type === "decl").map(node => [node.prop, node.value]));
const ruleFor = selector => {
  const matches = rules.filter(rule => selectors(rule).includes(selector));
  assert.ok(matches.length, `missing selector ${selector}`);
  return matches.at(-1);
};
function reducedMotion(rule) {
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type === "atrule" && parent.name === "media" && parent.params.replace(/\s/g, "").includes("(prefers-reduced-motion:reduce)")) return true;
  }
  return false;
}
function luminance(hex) {
  assert.match(hex, /^#[\da-f]{6}$/i);
  const [r, g, b] = hex.slice(1).match(/../g).map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
function contrast(first, second) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("stylesheet imports resolve once and preserve base, responsive and feature cascade boundaries", () => {
  const imports = localImports.map(filename => path.basename(filename));
  const before = (first, second) => {
    assert.ok(imports.includes(first), `missing ${first}`);
    assert.ok(imports.includes(second), `missing ${second}`);
    assert.ok(imports.indexOf(first) < imports.indexOf(second), `${first} must precede ${second}`);
  };
  assert.equal(imports[0], "foundations.css");
  before("landing.css", "landing-responsive.css");
  before("dashboard.css", "telegram.css");
  before("telegram.css", "dashboard-responsive.css");
  before("activity-and-recommendations.css", "dashboard-responsive.css");
  before("dashboard-responsive.css", "loading.css");
  before("loading.css", "sessions.css");
  const remainingImports = [];
  stylesheet.walkAtRules("import", rule => remainingImports.push(rule.params));
  assert.ok(remainingImports.some(value => value.includes("fonts.googleapis.com") && value.includes("DM+Sans") && value.includes("DM+Mono") && value.includes("DM+Serif+Display")));
  assert.ok(remainingImports.includes('"tailwindcss"'));
});

test("both themes provide readable text, surfaces and inverse controls through shared tokens", () => {
  const light = declarations(ruleFor(":root"));
  const dark = { ...light, ...declarations(ruleFor(':root[data-theme="dark"]')) };
  assert.equal(light["color-scheme"], "light");
  assert.equal(dark["color-scheme"], "dark");
  assert.match(light["--font-display"], /DM Serif Display/);
  assert.match(light["--font-main"], /DM Sans/);
  assert.match(light["--font-mono"], /DM Mono/);
  for (const [name, tokens] of Object.entries({ light, dark })) {
    for (const token of ["--canvas", "--surface", "--surface-raised", "--border", "--border-strong", "--text", "--ink", "--muted", "--inverse", "--inverse-text"]) assert.ok(tokens[token], `${name}: missing ${token}`);
    for (const surface of ["--canvas", "--surface-raised"]) {
      for (const text of ["--text", "--ink", "--muted"]) assert.ok(contrast(tokens[text], tokens[surface]) >= 4.5, `${name}: ${text} needs readable contrast on ${surface}`);
    }
    assert.ok(contrast(tokens["--inverse"], tokens["--inverse-text"]) >= 4.5, `${name}: inverse controls need readable contrast`);
    assert.notEqual(tokens["--canvas"], tokens["--surface-raised"]);
  }
  assert.equal(declarations(ruleFor(".skeleton"))["background"], "var(--surface)");
  assert.equal(declarations(ruleFor(".inspector-code"))["background"], "var(--surface)");
});

test("reduced motion disables loading shimmer, progress, spinner and content entrance animations", () => {
  for (const selector of [".skeleton::after", ".loading-status-dot", ".loading-progress::after", ".notification-spinner", ".dashboard-content-ready", ".recommendation-inline-detail"]) {
    const animated = rules.filter(rule => selectors(rule).includes(selector) && !reducedMotion(rule) && declarations(rule).animation);
    assert.ok(animated.length, `missing intended animation for ${selector}`);
    const overrides = rules.filter(rule => selectors(rule).includes(selector) && reducedMotion(rule));
    assert.ok(overrides.some(rule => declarations(rule).animation === "none"), `${selector} must stop in reduced motion`);
    assert.ok(rules.indexOf(overrides.at(-1)) > rules.indexOf(animated.at(-1)), `${selector} motion override must follow its animation`);
  }
  for (const selector of [".session-shell *", ".session-shell *::before", ".session-shell *::after"]) {
    const rule = rules.find(rule => selectors(rule).includes(selector) && reducedMotion(rule));
    assert.ok(rule, `${selector} must respect reduced motion`);
    for (const [prop, value] of [["animation", "none"], ["transition", "none"], ["scroll-behavior", "auto"]]) {
      assert.ok(rule.nodes.some(node => node.prop === prop && node.value === value && node.important), `${selector}: ${prop} must override nested effects`);
    }
  }
});

test("buttons, links and transcript reading controls retain visible keyboard focus", () => {
  for (const selector of ["button:focus-visible", "a:focus-visible", ".session-shell input:focus-visible", ".session-shell select:focus-visible", ".session-shell summary:focus-visible", ".inspector-code:focus-visible"]) {
    const values = declarations(ruleFor(selector));
    assert.match(values.outline, /^[2-9]\d*px solid var\(--ink\)$/);
    assert.ok(parseFloat(values["outline-offset"]) >= 2, `${selector} needs separated focus feedback`);
  }
  rules.filter(rule => rule.selector.includes(":focus-visible")).forEach(rule => {
    const values = declarations(rule);
    if (values.outline) assert.ok(!/^(?:none|0(?:px)?)$/.test(values.outline), `${rule.selector} must not remove the focus outline`);
  });
  assert.equal(declarations(ruleFor(".sr-only"))["position"], "absolute");
  assert.notEqual(declarations(ruleFor(".sr-only"))["display"], "none");
});
