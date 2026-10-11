import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', msg => console.log('console', msg.type(), msg.text()));
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded' });
await page.getByText('Settings', { exact: true }).click();
await page.waitForTimeout(3000);
await browser.close();
