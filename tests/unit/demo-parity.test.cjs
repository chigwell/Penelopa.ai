const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { buildSync, transformSync } = require("esbuild");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

// Captured before extracting scenario data. This protects all copy, timings,
// phase progress, agent details, report blocks, and animation token positions.
const originalScenarioDigest = "e95bd20297ea768f56a53b05b782547e4ff69fc6c9a57e2a793ff57952148d9e";

function loadScenario() {
  const source = readFileSync(path.join(__dirname, "../../app/components/PenelopaHowItWorksDemo.tsx"), "utf8");
  const start = source.indexOf("const DEMO_CONFIG =");
  const end = source.indexOf("const INITIAL_ANALYSIS_STAGE");
  assert.ok(start >= 0 && end > start, "demo scenario data must be identifiable");
  const { code } = transformSync(source.slice(start, end), { loader: "ts", format: "cjs", target: "es2020" });
  return new Function(`${code}; return { DEMO_CONFIG, TOKEN_POSITIONS };`)();
}

test("demo scenario data matches the original behavior contract", () => {
  const digest = createHash("sha256").update(JSON.stringify(loadScenario())).digest("hex");
  assert.equal(digest, originalScenarioDigest);
});

test("both demo agents retain the session, analysis, recommendation, and applied sequence", () => {
  const { DEMO_CONFIG, TOKEN_POSITIONS } = loadScenario();
  assert.deepEqual(Object.keys(DEMO_CONFIG.agents), ["codex", "claude"]);
  assert.equal(TOKEN_POSITIONS.length, DEMO_CONFIG.analysis.tokens.length);
  for (const agent of Object.values(DEMO_CONFIG.agents)) {
    assert.equal(agent.flow.length, 25);
    assert.deepEqual(agent.flow.filter((step) => step.type === "phase").map(({ index, label }) => [index, label]), [
      ["01", "Session"], ["03", "Recommendation"], ["04", "Applied"],
    ]);
    assert.equal(agent.flow.filter((step) => step.type === "analysis").length, 1);
    assert.deepEqual(agent.flow.filter((step) => step.type === "screen").map(({ screen }) => screen), ["penelopa", "agent"]);
    assert.deepEqual(agent.flow.at(-1), { type: "complete", progress: 1 });
  }
});

test("demo initial HTML retains all three screens in both themes", () => {
  const { outputFiles } = buildSync({
    entryPoints: [path.join(__dirname, "../../app/components/PenelopaHowItWorksDemo.tsx")],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    external: ["react", "react-dom", "lucide-react"],
  });
  const fixtureModule = { exports: {} };
  new Function("require", "module", "exports", outputFiles[0].text)(require, fixtureModule, fixtureModule.exports);
  const originalMarkupDigests = {
    light: "ce26d9d4fc079120574ecef23150ebeac5d0804d0a4f734560b717181916ad3a",
    dark: "5a03d3ce542e97bf10ee6d94116c2df2ece3f1606377c657f05bcad9c95457cd",
  };
  for (const [theme, expected] of Object.entries(originalMarkupDigests)) {
    const markup = renderToStaticMarkup(React.createElement(fixtureModule.exports.default, { theme, onToggleTheme() {} }));
    assert.equal(createHash("sha256").update(markup).digest("hex"), expected, theme);
  }
});
