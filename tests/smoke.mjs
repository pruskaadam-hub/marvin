import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files = await Promise.all(["index.html", "app.js", "config.js"].map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
const [html, app, config] = files;

for (const id of ["appPanel", "areaGrid", "timeline", "priorities", "tomorrow", "attention", "noteForm"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `Chybí #${id}`);
}
assert.match(app, /typ:\s*["']poznamka["']/, "Povolený typ poznamka chybí");
assert.doesNotMatch(app + config, /cometx\.app\.n8n\.cloud\/webhook/, "Frontend nesmí volat n8n přímo");
assert.doesNotMatch(app + config, /X-Marvin-Key/i, "Frontend nesmí znát tajný n8n klíč");
assert.doesNotMatch(app + config, /github.*token|token.*github/i, "Frontend nesmí používat GitHub token");
assert.match(config, /kmntccvrsuhndupswrig\.supabase\.co/, "Chybí správný Supabase projekt");
console.log("MARVIN smoke test: OK");

