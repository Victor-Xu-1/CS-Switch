import { request as httpRequest } from 'node:http';
import { json } from './http.mjs';

export class ReverseProxy {
  requests = 0;
  sockets = new Set();
  constructor(config, manager) { this.config = config; this.manager = manager; }
  forward(request, response) {
    if (!this.manager.runtime.child) {
      if (request.method === 'GET' && request.url === '/') { response.writeHead(302, { location: '/_bridge/' }); response.end(); return; }
      return json(response, 503, { error: { code: 'runtime_stopped', message: 'Start Claude Science from the CS-Switch workbench.' } });
    }
    if (this.manager.maintenance) return json(response, 503, { error: { code: 'updating', message: 'Validating a runtime update. Retry shortly.' } });
    if (/^\/daemon\/(?:apply-update|restart)/.test(request.url)) return json(response, 409, { error: { code: 'managed_updates', message: 'Use CS-Switch to update or restart this managed runtime.' } });
    this.requests++;
    const outgoing = httpRequest({ hostname: '127.0.0.1', port: this.config.appPort, path: request.url, method: request.method,
      headers: { ...request.headers, host: `127.0.0.1:${this.config.appPort}`, ...(request.headers.origin ? { origin: `http://127.0.0.1:${this.config.appPort}` } : {}) } }, upstream => {
      const headers = { ...upstream.headers };
      // Keep navigation on the stable public entry, including redirects.
      if (headers.location?.startsWith(`http://127.0.0.1:${this.config.appPort}`)) headers.location = headers.location.replace(`:${this.config.appPort}`, `:${this.config.port}`);
      response.writeHead(upstream.statusCode, headers); upstream.pipe(response);
    });
    let finished = false;
    const finish = () => { if (!finished) { finished = true; this.requests--; } };
    response.on('close', () => { finish(); outgoing.destroy(); });
    outgoing.on('error', () => { finish(); if (!response.headersSent) json(response, 502, { error: { code: 'runtime_unavailable', message: 'Scientific runtime unavailable.' } }); else response.destroy(); });
    request.pipe(outgoing);
  }
  upgrade(request, socket, head) {
    if (this.manager.maintenance || !this.manager.runtime.child) { socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return; }
    const outgoing = httpRequest({ hostname: '127.0.0.1', port: this.config.appPort, path: request.url, method: 'GET',
      headers: { ...request.headers, host: `127.0.0.1:${this.config.appPort}`, ...(request.headers.origin ? { origin: `http://127.0.0.1:${this.config.appPort}` } : {}) } });
    outgoing.on('upgrade', (response, upstream, upstreamHead) => {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      this.sockets.add(socket);
      socket.on('close', () => { this.sockets.delete(socket); upstream.destroy(); });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      upstream.pipe(socket); socket.pipe(upstream);
    });
    outgoing.on('response', response => { socket.end(`HTTP/1.1 ${response.statusCode} Rejected\r\n\r\n`); response.resume(); });
    outgoing.on('error', () => socket.destroy()); outgoing.end();
  }
  disconnect() { for (const socket of this.sockets) socket.destroy(); }
}
