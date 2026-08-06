import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("local launcher proxies account mutations into the Next.js runtime", async () => {
  const source = await readFile(new URL("../tools/serve_local.py", import.meta.url), "utf8");
  assert.match(source, /def do_POST\(self\)/);
  assert.match(source, /def do_PUT\(self\)/);
  assert.match(source, /def do_DELETE\(self\)/);
  assert.match(source, /HTTPConnection\("localhost"/);
  assert.match(source, /self\.rfile\.read\(content_length\)/);
  assert.match(source, /connection\.request\(self\.command/);
  assert.match(source, /str\(NEXT\), "dev"/);
  assert.doesNotMatch(source, /key\.lower\(\) not in \{"host"/);
});
