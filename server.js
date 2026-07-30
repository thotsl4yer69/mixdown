const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "public");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

function sendFile(response, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, {
      "Content-Type":
        contentTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(content);
  });
}

function createServer() {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    let decodedPathname;

    try {
      decodedPathname = decodeURIComponent(pathname);
    } catch {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Invalid path");
      return;
    }

    const relativePath = decodedPathname === "/" ? "/index.html" : decodedPathname;
    const filePath = path.resolve(publicDir, `.${relativePath}`);

    if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Invalid path");
      return;
    }

    sendFile(response, filePath);
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => {
    console.log(`Mixdown app running at http://localhost:${port}`);
  });
}

module.exports = { createServer };
