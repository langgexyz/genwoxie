// 理解服务客户端:wav 录音 -> POST api/understand -> {char, context}。
// API 路径用相对形式:根路径与反代子路径(如 ccdirect.dev/xie/)部署都成立。
// 服务端(dev server / FC 函数)持有模型 key,前端只见业务 JSON。
// 轮询后台复核:同意且证据强/超时/出错返回 null(无事发生)。
// 孩子无感等待,不占同步链路延迟。
export async function pollAuditSignal(auditId, signal) {
    for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (signal.aborted)
            return null;
        try {
            const res = await fetch(`api/audit?id=${encodeURIComponent(auditId)}`, { signal });
            if (!res.ok)
                return null;
            const data = (await res.json());
            if (data["status"] === "pending")
                continue;
            if (data["agree"] === false && typeof data["char"] === "string" && data["char"]) {
                return {
                    kind: "correction",
                    char: data["char"],
                    context: typeof data["context"] === "string" ? data["context"] : "",
                };
            }
            if (data["agree"] === true && data["weak"] === true)
                return { kind: "weak" };
            return null;
        }
        catch {
            return null;
        }
    }
    return null;
}
// 页面加载时探测理解服务是否在(纯静态部署无后端时走 Web Speech 降级链)。
export async function probeUnderstandApi(timeoutMs = 1500) {
    try {
        const res = await fetch("api/health", { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok)
            return false;
        const data = (await res.json());
        return data.ok === true;
    }
    catch {
        return false;
    }
}
export async function requestUnderstand(wav, prevAuditId = "") {
    const res = await fetch("api/understand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            audio: await blobToBase64(wav),
            format: "wav",
            ...(prevAuditId ? { prev: prevAuditId } : {}),
        }),
        signal: AbortSignal.timeout(20000),
    });
    if (!res.ok)
        throw new Error(`understand HTTP ${res.status}`);
    const data = (await res.json());
    return {
        char: typeof data["char"] === "string" ? data["char"] : "",
        context: typeof data["context"] === "string" ? data["context"] : "",
        auditId: typeof data["auditId"] === "string" ? data["auditId"] : undefined,
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
