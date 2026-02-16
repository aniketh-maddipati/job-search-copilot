const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const path = require('path');
const fs = require('fs');

// ═══════════════════════════════════════════════════════════════════════════════
// BOOTSTRAP: Load mocks and Code.js into global scope
// ═══════════════════════════════════════════════════════════════════════════════

const mocks = require('./mocks');
Object.assign(global, mocks);

try {
  const codeContent = fs.readFileSync(path.join(__dirname, '..', 'Code.js'), 'utf8');
  eval(codeContent);
  console.log('✓ Code.js loaded successfully');
} catch (e) {
  console.error('✗ Failed to load Code.js:', e.message);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHIM: Injected into HTML to simulate google.script.run
// ═══════════════════════════════════════════════════════════════════════════════

const GOOGLE_SCRIPT_SHIM = `
<script>
if (typeof google === 'undefined') {
  window.google = {
    script: {
      run: new Proxy({}, {
        get(_, functionName) {
          let successHandler = () => {};
          let failureHandler = () => {};
          
          const handler = {
            withSuccessHandler(fn) { successHandler = fn; return handler; },
            withFailureHandler(fn) { failureHandler = fn; return handler; }
          };
          
          handler[functionName] = (...args) => {
            fetch('/api/' + functionName, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ args })
            })
            .then(r => r.json())
            .then(data => data.success ? successHandler(data.result) : failureHandler(data))
            .catch(failureHandler);
          };
          
          return handler;
        }
      })
    }
  };
}
</script>`;

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER SETUP
// ═══════════════════════════════════════════════════════════════════════════════

const fastify = Fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, ignore: 'pid,hostname' }
    }
  }
});

// Static files (CSS, JS, etc.)
fastify.register(fastifyStatic, {
  root: path.join(__dirname, '..'),
  prefix: '/'
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Serve Setup.html with injected shim
fastify.get('/', async (request, reply) => {
  const htmlPath = path.join(__dirname, '..', 'Setup.html');
  
  if (!fs.existsSync(htmlPath)) {
    return reply.code(404).send({ error: 'Setup.html not found' });
  }
  
  let html = fs.readFileSync(htmlPath, 'utf8');
  html = html.replace('</body>', GOOGLE_SCRIPT_SHIM + '\n</body>');
  
  return reply.type('text/html').send(html);
});

// API endpoint to simulate google.script.run
fastify.post('/api/:functionName', async (request, reply) => {
  const { functionName } = request.params;
  const fn = global[functionName];
  
  if (typeof fn !== 'function') {
    const available = Object.keys(global).filter(k => typeof global[k] === 'function' && !k.startsWith('_'));
    return reply.code(404).send({ 
      error: `Function "${functionName}" not found`,
      available: available.slice(0, 20)
    });
  }
  
  const args = request.body?.args || [];
  const startTime = Date.now();
  
  try {
    const result = fn(...args);
    const duration = Date.now() - startTime;
    
    fastify.log.info({ fn: functionName, duration: `${duration}ms` }, 'Function executed');
    return { success: true, result, _meta: { duration } };
  } catch (e) {
    fastify.log.error({ fn: functionName, error: e.message, stack: e.stack }, 'Function failed');
    return reply.code(500).send({ 
      success: false, 
      error: e.message,
      stack: process.env.NODE_ENV !== 'production' ? e.stack : undefined
    });
  }
});

// Dashboard data endpoint (for debugging)
fastify.get('/api/dashboard', async (request, reply) => {
  const dataPath = path.join(__dirname, 'data', 'sheets.json');
  
  if (!fs.existsSync(dataPath)) {
    return { data: [], _meta: { source: 'empty' } };
  }
  
  const sheets = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  return sheets.Dashboard || { data: [] };
});

// Health check / diagnostics
fastify.get('/api/_health', async (request, reply) => {
  const dataDir = path.join(__dirname, 'data');
  
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      cwd: process.cwd()
    },
    mocks: {
      loaded: Object.keys(mocks),
      dataDir: fs.existsSync(dataDir),
      files: fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : []
    },
    functions: Object.keys(global)
      .filter(k => typeof global[k] === 'function' && /^[a-z]/i.test(k))
      .filter(k => !['require', 'eval', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'structuredClone', 'atob', 'btoa', 'fetch'].includes(k))
  };
});

// ═══════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  
  console.log(`
┌─────────────────────────────────────────────────┐
│  🚀 Job Search Co-Pilot - Local Dev Server      │
├─────────────────────────────────────────────────┤
│  UI:     http://localhost:${PORT}                   │
│  API:    http://localhost:${PORT}/api/{fn}          │
│  Health: http://localhost:${PORT}/api/_health       │
├─────────────────────────────────────────────────┤
│  📁 Mock data: local/data/                      │
│  📝 Edit Code.js and refresh to see changes     │
└─────────────────────────────────────────────────┘
`);
});
