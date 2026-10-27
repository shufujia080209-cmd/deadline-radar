// Deadline Radar's service worker: keeps copies of the app's files so it opens without internet.
// - The page itself is fetched from the network first, so online visits always get the newest version;
//   the saved copy is used only when offline.
// - Other files (code, styles, icons) are served from the saved copies, falling back to the network.
//   Built code and style files get a new name every build, so a saved copy is never out of date.
// Assignments are not involved: they live in the browser's localStorage, not in this cache.
const CACHE_NAME = "deadline-radar";
const PAGE_URL = new URL("./", self.location).href;

self.addEventListener("install", (event) => {
  event.waitUntil(saveCurrentPage());
  // Start working right away instead of waiting for every open tab to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(request.mode === "navigate" ? pageNetworkFirst() : savedCopyFirst(request));
});

async function pageNetworkFirst() {
  try {
    return await saveCurrentPage();
  } catch {
    const saved = await caches.match(PAGE_URL);
    return saved ?? new Response("Deadline Radar is offline and hasn't been saved yet.", { status: 503 });
  }
}

async function savedCopyFirst(request) {
  const saved = await caches.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

/**
 * Downloads the page and every file it links to, saves them, and removes saved files the new page no
 * longer uses (for example code from an older build). Returns the page's response.
 */
async function saveCurrentPage() {
  const response = await fetch(PAGE_URL, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Page request failed: ${response.status}`);
  const html = await response.clone().text();
  const fileUrls = linkedFiles(html);

  const cache = await caches.open(CACHE_NAME);
  await cache.put(PAGE_URL, response.clone());
  await Promise.all(
    fileUrls.map(async (url) => {
      if (await cache.match(url)) return;
      const fileResponse = await fetch(url);
      if (fileResponse.ok) await cache.put(url, fileResponse);
    }),
  );

  const keep = new Set([PAGE_URL, ...fileUrls]);
  for (const savedRequest of await cache.keys()) {
    if (!keep.has(savedRequest.url)) await cache.delete(savedRequest);
  }
  return response;
}

/** The same-site files a page links to with src="…" or href="…", as full URLs. */
function linkedFiles(html) {
  const urls = [...html.matchAll(/\b(?:src|href)="([^"#?]+)"/g)].map((match) => new URL(match[1], PAGE_URL));
  return [...new Set(urls.filter((url) => url.origin === self.location.origin).map((url) => url.href))];
}
