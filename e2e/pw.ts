// e2e 共用:拿 playwright 运行时(默认用 probe skill 自带的浏览器安装,
// 本仓库 devDependency 只供类型),以及数 canvas 墨迹像素的断言辅助。
import type { Page, BrowserType } from "playwright";

const DEFAULT_PLAYWRIGHT = "/Users/zero/.claude/skills/probe/node_modules/playwright/index.js";

interface PlaywrightModule {
  chromium?: BrowserType;
  default?: { chromium: BrowserType };
}

export async function loadChromium(): Promise<BrowserType> {
  const modPath = process.env["PLAYWRIGHT"] ?? DEFAULT_PLAYWRIGHT;
  const mod = (await import(modPath)) as PlaywrightModule;
  const chromium = mod.chromium ?? mod.default?.chromium;
  if (!chromium) throw new Error(`playwright module has no chromium export: ${modPath}`);
  return chromium;
}

export const BASE_URL = process.env["BASE_URL"] ?? "http://localhost:8731";

// canvas 上不透明像素占比:>阈值即认为真写出了字(形状对不对另靠人/多模态看截图)。
export function inkRatio(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>("#inkCanvas");
    if (!c) throw new Error("missing #inkCanvas");
    const ictx = c.getContext("2d");
    if (!ictx) throw new Error("2d context unavailable");
    const { data } = ictx.getImageData(0, 0, c.width, c.height);
    let inked = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 20) inked++;
    return inked / (data.length / 4);
  });
}
