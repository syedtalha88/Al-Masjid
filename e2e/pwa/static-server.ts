import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';

// Minimal static server for the PWA update e2e: serves one build directory with SPA fallback and `no-cache`
// entry points (like Caddy, 01 §5.2). `setRoot` swaps the deployment without restarting.

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export interface StaticServer {
  readonly url: string;
  setRoot(root: string): void;
  close(): Promise<void>;
}

/** Starts the server on `port` serving `root`. */
export async function startStaticServer(root: string, port: number): Promise<StaticServer> {
  let current = root;
  const server: Server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const safe = normalize(path).replace(/^([/\\])+/, '');
    let file = join(current, safe);
    if (!file.startsWith(current) || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(current, 'index.html');
    }
    const immutable = safe.startsWith('assets');
    response.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://localhost:${String(port)}`,
    setRoot(next) {
      current = next;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
