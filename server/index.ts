/**
 * Game server: the JSON API from api.ts, CORS, and (when ../dist exists) the built game,
 * so one laptop can host the whole thing on a LAN. Run with `npm run server`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api';
import { PackCache } from './cache';
import { loadEnvFile, readEnv } from './env';
import { JobStore } from './jobs';
import { OpenAiCompatClient } from './llm/client';
import { attachMultiplayer, lanUrls } from './mp/ws';
import {
  NEW_PACKS_PER_WINDOW, NEW_PACKS_WINDOW_MS, POLLS_PER_WINDOW, POLLS_WINDOW_MS, RateLimiter,
} from './ratelimit';

const here = dirname(fileURLToPath(import.meta.url));
loadEnvFile(join(here, '.env'));
loadEnvFile(join(here, '..', '.env')); // root .env: DEEPSEEK_API
const env = readEnv();
const dataDir = join(here, 'data');
const distDir = resolve(here, '..', 'dist');

const llm = env.llmEnabled
  ? new OpenAiCompatClient({ baseUrl: env.llmBaseUrl, apiKey: env.llmApiKey, model: env.llmModel, disableThinking: env.disableThinking })
  : null;

const api = createApi({
  env, llm,
  cache: new PackCache({ dir: join(dataDir, 'packs') }),
  jobs: new JobStore(),
  packLimiter: new RateLimiter(NEW_PACKS_PER_WINDOW, NEW_PACKS_WINDOW_MS),
  pollLimiter: new RateLimiter(POLLS_PER_WINDOW, POLLS_WINDOW_MS),
  now: () => new Date(),
  lanUrls: () => lanUrls(env.port),
  appendReport: (line) => {
    mkdirSync(dataDir, { recursive: true });
    appendFileSync(join(dataDir, 'reports.jsonl'), line + '\n');
  },
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function cors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && env.allowedOrigins.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
  }
}

function readBody(req: IncomingMessage, limit = 4096): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(pathname: string, res: ServerResponse): boolean {
  if (!existsSync(distDir)) return false;
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = resolve(distDir, rel || 'index.html');
  if (file !== distDir && !file.startsWith(distDir + sep)) return false; // path traversal
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) return false;
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
  return true;
}

const server = createServer(async (req, res) => {
  cors(req, res);
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (url.pathname.startsWith('/api/')) {
    let body: unknown;
    if (req.method === 'POST') {
      try { body = await readBody(req); } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad-request', message: 'Bad request body.' }));
        return;
      }
    }
    const out = await api.handle({ method: req.method ?? 'GET', path: url.pathname, ip: req.socket.remoteAddress ?? 'unknown', body });
    res.writeHead(out.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(out.body));
    return;
  }
  if (req.method === 'GET' && serveStatic(url.pathname, res)) return;
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
});

attachMultiplayer(server);

server.listen(env.port, () => {
  console.log(`Learn Your Way Out server on http://localhost:${env.port}`);
  console.log(env.llmEnabled ? `Any Topic: ON (model ${env.llmModel})` : 'Any Topic: OFF (no DEEPSEEK_API in .env or LLM_API_KEY in server/.env)');
  console.log('Multiplayer: ON (/ws)');
  for (const u of lanUrls(env.port)) console.log(`  Other laptops on this network can open ${u}`);
  if (existsSync(distDir)) console.log('Serving the built game from dist/');
});
