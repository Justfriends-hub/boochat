import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('console', (msg) => {
    console.log('CONSOLE', msg.type(), msg.text());
  });
  page.on('pageerror', (err) => {
    console.log('PAGEERROR', err.stack || err.message);
  });
  const urls = ['http://127.0.0.1:4176/status', 'http://127.0.0.1:4176/calls', 'http://127.0.0.1:4176/chats', 'http://127.0.0.1:4176/groups', 'http://127.0.0.1:4176/settings'];
  for (const url of urls) {
    console.log('NAVIGATE', url);
    const response = await page.goto(url, { waitUntil: 'networkidle' });
    console.log('RESPONSE', response?.status(), response?.url());
    const html = await page.content();
    const hasSnag = html.includes('hit a snag');
    console.log('HAS_SNAG', hasSnag);
    console.log('TITLE', await page.title());
    console.log('HTML_SNIPPET', html.slice(0, 800));
  }
  await browser.close();
})();
