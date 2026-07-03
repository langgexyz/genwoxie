// 理解服务客户端:wav 录音 -> POST /api/understand -> {char, context}。
// 服务端(dev server / FC 函数)持有模型 key,前端只见业务 JSON。
// 页面加载时探测理解服务是否在(纯静态部署无后端时走 Web Speech 降级链)。
export async function probeUnderstandApi(timeoutMs = 1500) {
    try {
        const res = await fetch("/api/health", { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok)
            return false;
        const data = (await res.json());
        return data.ok === true;
    }
    catch {
        return false;
    }
}
export async function requestUnderstand(wav) {
    const res = await fetch("/api/understand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: await blobToBase64(wav), format: "wav" }),
        signal: AbortSignal.timeout(20000),
    });
    if (!res.ok)
        throw new Error(`understand HTTP ${res.status}`);
    const data = (await res.json());
    return {
        char: typeof data["char"] === "string" ? data["char"] : "",
        context: typeof data["context"] === "string" ? data["context"] : "",
    };
}
async function blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const CHUNK = 0x8000; // 分块拼,避免大数组撑爆调用栈
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}
