import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const TARGET = process.env.BENCHMARK_URL || "https://load-webpage-in-1f.pages.dev/";
const target = new URL(TARGET);
const forceHost = target.hostname + ":" + (target.port || "443");

const modes = [
  { name: "auto", args: [] },
  {
    name: "forced-h3",
    args: [
      "--enable-quic",
      "--origin-to-force-quic-on=" + forceHost
    ]
  }
];

const report = {
  target: TARGET,
  generatedAt: new Date().toISOString(),
  runner: process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
  modes: []
};

for (const mode of modes) {
  const browser = await chromium.launch({
    headless: true,
    args: mode.args
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  const client = await context.newCDPSession(page);

  await client.send("Network.enable");
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });

  let active = null;

  client.on("Network.responseReceived", ({ type, response }) => {
    if (!active || type !== "Document") return;

    try {
      const u = new URL(response.url);
      if (u.origin !== target.origin) return;
    } catch {
      return;
    }

    active.protocol = response.protocol ?? null;
    active.connectionReused = response.connectionReused ?? null;
    active.connectionId = response.connectionId ?? null;
    active.remoteIPAddress = response.remoteIPAddress ?? null;
    active.remotePort = response.remotePort ?? null;
    active.encodedDataLengthAtHeaders = response.encodedDataLength ?? null;
    active.fromDiskCache = response.fromDiskCache ?? false;
    active.fromPrefetchCache = response.fromPrefetchCache ?? false;
    active.fromServiceWorker = response.fromServiceWorker ?? false;
    active.altSvc = response.headers?.["alt-svc"] ?? response.headers?.["Alt-Svc"] ?? null;
  });

  async function measure(label) {
    active = {
      label,
      protocol: null,
      connectionReused: null,
      connectionId: null,
      remoteIPAddress: null,
      remotePort: null,
      encodedDataLengthAtHeaders: null,
      fromDiskCache: false,
      fromPrefetchCache: false,
      fromServiceWorker: false,
      altSvc: null
    };

    const started = performance.now();

    await page.goto(TARGET, {
      waitUntil: "load",
      timeout: 30000
    });

    await page.waitForTimeout(100);

    const perf = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const paints = Object.fromEntries(
        performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime])
      );

      return {
        ttfbMs: nav?.responseStart ?? null,
        responseEndMs: nav?.responseEnd ?? null,
        domContentLoadedMs: nav?.domContentLoadedEventEnd ?? null,
        loadEventMs: nav?.loadEventEnd ?? null,
        transferSize: nav?.transferSize ?? null,
        encodedBodySize: nav?.encodedBodySize ?? null,
        decodedBodySize: nav?.decodedBodySize ?? null,
        firstPaintMs: paints["first-paint"] ?? null,
        fcpMs: paints["first-contentful-paint"] ?? null,
        renderAfterResponseMs:
          nav && paints["first-contentful-paint"] != null
            ? Math.max(0, paints["first-contentful-paint"] - nav.responseEnd)
            : null,
        parseToDomContentLoadedMs:
          nav ? Math.max(0, nav.domContentLoadedEventEnd - nav.responseEnd) : null
      };
    });

    active.wallMs = performance.now() - started;
    Object.assign(active, perf);

    const result = active;
    active = null;
    return result;
  }

  let cold = null;
  let warm = null;
  let error = null;

  try {
    cold = await measure("cold");
    await page.goto("about:blank");
    warm = await measure("warm");
  } catch (err) {
    error = String(err?.stack || err);
  }

  report.modes.push({
    name: mode.name,
    quicForced: mode.name === "forced-h3",
    chromiumArgs: mode.args,
    cold,
    warm,
    error
  });

  await browser.close();
}

await writeFile(
  "network-benchmark.json",
  JSON.stringify(report, null, 2) + "\n"
);

console.log("\nREMOTE NETWORK BENCHMARK\n");

for (const mode of report.modes) {
  console.log("[" + mode.name + "]");

  if (mode.error) {
    console.log("error: " + mode.error + "\n");
    continue;
  }

  for (const run of [mode.cold, mode.warm]) {
    console.log(
      run.label.padEnd(5) + " " +
      "protocol=" + String(run.protocol).padEnd(4) + " " +
      "reused=" + String(run.connectionReused).padEnd(5) + " " +
      "TTFB=" + (run.ttfbMs?.toFixed(2) ?? "n/a") + "ms " +
      "FCP=" + (run.fcpMs?.toFixed(2) ?? "n/a") + "ms " +
      "render=" + (run.renderAfterResponseMs?.toFixed(2) ?? "n/a") + "ms " +
      "transfer=" + (run.transferSize ?? "n/a") + "B " +
      "remote=" + (run.remoteIPAddress ?? "n/a")
    );
  }

  console.log("");
}

const forced = report.modes.find((m) => m.name === "forced-h3");
if (forced?.cold?.protocol !== "h3" && forced?.warm?.protocol !== "h3") {
  console.log(
    "NOTE: forced-h3 did not negotiate h3 on this runner. " +
    "GitHub-hosted runner UDP/QUIC availability can vary; this is reported, not treated as a CI failure."
  );
}
