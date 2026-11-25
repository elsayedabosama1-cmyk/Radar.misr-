import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const env = { ALLOWED_ORIGIN: "https://mirsad.example" };
const request = (path, options = {}) => new Request(`https://api.mirsad.example${path}`, {
  ...options,
  headers: { origin: env.ALLOWED_ORIGIN, ...(options.headers || {}) }
});

test("preflight allows the configured website origin", async () => {
  const response = await worker.fetch(request("/api/v1/me", { method: "OPTIONS" }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), env.ALLOWED_ORIGIN);
  assert.match(response.headers.get("access-control-allow-methods") || "", /POST/);
});

test("preflight rejects an unconfigured website origin", async () => {
  const response = await worker.fetch(new Request("https://api.mirsad.example/api/v1/me", {
    method: "OPTIONS", headers: { origin: "https://attacker.example" }
  }), env);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Origin not allowed" });
});

test("protected profile endpoint rejects requests without a bearer token", async () => {
  const response = await worker.fetch(request("/api/v1/me"), env);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "يلزم تسجيل الدخول" });
});

test("offline sync endpoint rejects requests without a bearer token", async () => {
  const response = await worker.fetch(request("/api/v1/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operations: [{ id: "test-op", kind: "draft.save", payload: { id: "draft-1", t: "عنوان تجريبي", b: "نص تجريبي" } }] })
  }), env);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "يلزم تسجيل الدخول" });
});

test("unknown API paths return a JSON 404", async () => {
  const response = await worker.fetch(request("/api/v1/not-a-route"), env);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "المسار غير موجود" });
  assert.equal(response.headers.get("cache-control"), "no-store");
});
