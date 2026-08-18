import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("local launcher proxies account mutations into the Next.js runtime", async () => {
  const source = await readFile(new URL("../tools/serve_local.py", import.meta.url), "utf8");
  assert.match(source, /def do_POST\(self\)/);
  assert.match(source, /def do_PUT\(self\)/);
  assert.match(source, /def do_PATCH\(self\)/);
  assert.match(source, /def is_websocket_upgrade\(self\)/);
  assert.match(source, /def proxy_websocket\(self\)/);
  assert.match(source, /select\.select\(peers/);
  assert.match(source, /target\.sendall\(payload\)/);
  assert.match(source, /def do_DELETE\(self\)/);
  assert.match(source, /HTTPConnection\("localhost"/);
  assert.match(source, /self\.rfile\.read\(content_length\)/);
  assert.match(source, /connection\.request\(self\.command/);
  assert.match(source, /headers\["X-Real-IP"\] = client_ip/);
  assert.match(source, /headers\["X-Forwarded-For"\] = client_ip/);
  assert.match(source, /def verify_local_postgres\(\)/);
  assert.match(source, /str\(NEXT\), "dev"/);
  assert.match(source, /def find_node\(\)/);
  assert.match(source, /def wait_for_app\(process:/);
  assert.match(source, /process\.poll\(\)/);
  assert.match(source, /def stop_process_tree\(process:/);
  assert.match(source, /def create_public_server\(host:/);
  assert.match(source, /class ExclusiveThreadingHTTPServer/);
  assert.match(source, /SO_EXCLUSIVEADDRUSE/);
  assert.match(source, /"taskkill", "\/PID"/);
  assert.match(source, /environment\["NEXT_DIST_DIR"\] = "\.next-local"/);
  assert.match(source, /if args\.host in \{"127\.0\.0\.1", "localhost"\}/);
  assert.doesNotMatch(source, /CREATE_NO_WINDOW/);
  assert.match(source, /Application server unavailable/);
  assert.doesNotMatch(source, /str\(NEXT\), "build"/);
  assert.doesNotMatch(source, /C:\\Users\\PeterB/);
  assert.doesNotMatch(source, /key\.lower\(\) not in \{"host"/);
});

test("Windows launcher discovers Python instead of requiring one machine path", async () => {
  const source = await readFile(new URL("../启动本地题库.bat", import.meta.url), "utf8");
  assert.match(source, /QUIZ_APP_PYTHON/);
  assert.match(source, /where py/);
  assert.match(source, /where python/);
  assert.match(source, /"%%P" --version/);
  assert.match(source, /codex-primary-runtime\\dependencies\\python\\python\.exe/);
  assert.match(source, /serve_local\.py" --host 127\.0\.0\.1 %\*/);
  assert.match(source, /CHEMQUIZ_ADMIN_USERNAME=chemquiz_admin/);
  assert.match(source, /CHEMQUIZ_ADMIN_PASSWORD=ChemQuiz-Local-Admin-2026!/);
  assert.match(source, /DATABASE_URL=postgresql:\/\/quizapp:.*@127\.0\.0\.1:5432\/quizapp/);
  assert.match(source, /CHEMQUIZ_TRUST_PROXY=1/);
  assert.match(source, /\/chemquiz-control/);
});

test("Next account route exports the administrator mutation methods", async () => {
  const source = await readFile(new URL("../app/api/[...path]/route.ts", import.meta.url), "utf8");
  assert.match(source, /handler as PATCH/);
});

test("VPS proxy overwrites client IP headers before the trusted application hop", async () => {
  const nginx = await readFile(new URL("../deploy/vps/quizapp-nginx.conf", import.meta.url), "utf8");
  const service = await readFile(new URL("../deploy/vps/quizapp.service", import.meta.url), "utf8");
  assert.match(nginx, /proxy_set_header X-Real-IP \$remote_addr/);
  assert.match(nginx, /proxy_set_header X-Forwarded-For \$remote_addr/);
  assert.doesNotMatch(nginx, /proxy_add_x_forwarded_for/);
  assert.match(service, /Environment=HOSTNAME=127\.0\.0\.1/);
  assert.match(service, /Environment=CHEMQUIZ_TRUST_PROXY=1/);
});
