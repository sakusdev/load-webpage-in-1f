# load-webpage-in-1f

> Load the first viewport in one frame.

An experiment in extreme web delivery: one initial document, zero external render-blocking assets, a strict compressed first-flight budget, and everything below the fold deferred until after the first paint.

## Targets

- 120 Hz frame budget: **8.33 ms**
- 60 Hz frame budget: **16.67 ms**
- Brotli-compressed first document: **<= 12 KiB**
- Initial render-blocking requests: **1 document only**
- External CSS before first paint: **0**
- External JS before first paint: **0**
- Web fonts before first paint: **0**
- Framework runtime: **0**
- Third-party resources before first paint: **0**

## Architecture

The first viewport is a self-contained HTML document with inline critical CSS and a tiny inline boot loader. Deferred fragments are not allowed to start until the browser reports `first-contentful-paint`, so below-the-fold content cannot compete with the first paint.

```
request /
   |
   +-- HTML + critical CSS + tiny boot JS  -> first paint
   |
   +-- after first paint
          +-- next viewport fragment
          +-- deep fragments on approach
```

## Development

```bash
npm install
npm run build
npm run budget
npm run serve
```

Then open http://localhost:8788.

Browser benchmark:

```bash
npx playwright install chromium
npm run benchmark
```

## Deploy

```bash
npm run build
npx wrangler deploy
```

The deployment target is Cloudflare Workers Static Assets.

## Important

The 8.33 ms target is a rendering/delivery goal, not a claim that arbitrary internet round trips can complete in microseconds. Real cold-load latency is bounded by DNS, transport setup, RTT, device scheduling, and display refresh. CI therefore treats the byte/request contract as the hard gate and reports browser timing separately.
