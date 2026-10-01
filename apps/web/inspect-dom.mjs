import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:3080');
await page.getByText('Settings').last().click();
await page.waitForTimeout(500);
const result = await page.evaluate(() => {
  const slot = document.querySelector("[data-slot='settings.section']");
  return slot ? slot.outerHTML.slice(0,2000) : document.body.outerHTML.slice(0,2000);
});
console.log(result);
await browser.close();
