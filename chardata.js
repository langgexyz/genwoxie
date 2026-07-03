// 字形数据 loader:多源 CDN fallback + localStorage 缓存。
// 此前引整个 hanzi-writer 库只为 loadCharacterData 一个函数;自己 fetch 后
// 少一个库依赖,单一 CDN 不可达(国内环境常见)时自动换源,查过的字离线可用。
//
// 返回约定:
//   数据对象  查到了
//   null      数据集里没这个字(404,换源也不会有)
//   throw     所有源都不可达(网络问题,和「没这个字」是两种用户提示)

const DATA_HOSTS = [
  "https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0",
  "https://fastly.jsdelivr.net/npm/hanzi-writer-data@2.0",
  "https://unpkg.com/hanzi-writer-data@2.0",
];

const CACHE_PREFIX = "gwx-chardata-2.0:"; // 带数据集版本,升级数据集时换前缀自然失效

async function loadCharacterData(char) {
  const cacheKey = CACHE_PREFIX + char;
  try {
    const hit = localStorage.getItem(cacheKey);
    if (hit) return JSON.parse(hit);
  } catch {
    // 缓存读不出/解析坏了不挡主流程,走网络
  }

  let lastError = null;
  for (const host of DATA_HOSTS) {
    let res;
    try {
      res = await fetch(`${host}/${encodeURIComponent(char)}.json`);
    } catch (e) {
      lastError = e;
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      lastError = new Error(`${host} -> HTTP ${res.status}`);
      continue;
    }
    const data = await res.json();
    try {
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch {
      // 存不进(隐私模式/配额满)也不影响本次使用
    }
    return data;
  }
  throw lastError || new Error("no data host reachable");
}

window.GWXData = { loadCharacterData };
