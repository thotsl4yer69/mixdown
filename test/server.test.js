const test = require("node:test");
const assert = require("node:assert/strict");

const { createServer } = require("../server");

async function withServer(run) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("serves the starter app homepage", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Mixdown starter app/);
    assert.match(html, /Build your next release/);
  });
});

test("serves static assets", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/styles.css`);
    const css = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/css/);
    assert.match(css, /\.hero/);
  });
});

test("returns 404 for unknown files", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/missing.txt`);

    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Not found");
  });
});
