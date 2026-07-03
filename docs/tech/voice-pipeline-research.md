# 语音链路技术调研(2026-07-03)

产品化「跟我写」的语音闭环:孩子按住说话(2-5 秒) -> 云端模型理解 -> {目标汉字, 语境词} -> 毛笔演示 + 回声播报。本文是三路并行调研(模型选型 / 前端录音与微信环境 / 最小后端与部署)+ 交叉复核的结论,供实施阶段引用。

## 1. 推荐架构

```
手机浏览器(静态页, EdgeOne Pages 境外模式托管)
  按住录音(MediaRecorder, iOS 出 mp4/aac, Android 出 webm/opus)
  -> 前端统一重采样为 wav 16k mono(OfflineAudioContext, 归一格式差异)
  -> 方式A: 拿临时 key 后 fetch 直连百炼   方式B: 经转发函数
       qwen3-omni-flash (OpenAI 兼容, base64 音频入, SSE 流式出)
  <- {char, context, echo} JSON
  -> canvas 毛笔演示(已有) + speechSynthesis 播报(不可用时云端 TTS 兜底)

阿里云 FC 3.0(内置域名 fcapp.run, 零备案):
  方式A: 只做「签发临时 API Key」的迷你函数(官方机制, 1-1800s 有效期)
  方式B: 转发录音的代理函数(临时 key 直连被 CORS 挡住时的退路)
```

理解层降级链:qwen3-omni-flash 端到端 -> qwen3-asr-flash + qwen-flash 两段式(同平台同 key,非流式,随时可切) -> 本地 extract.ts 正则(已有,配打字框/Web Speech 时兜底)。

## 2. 模型选型(理解层)

| 候选 | 形态 | 单次成本(3s) | 结论 |
|---|---|---|---|
| 百炼 qwen3-omni-flash / qwen3.5-omni | 音频 base64 一次调用,OpenAI 兼容,必须流式 | 约 0.001 元 | 首选:音频直入避免 ASR 同音字丢信息 |
| 百炼 qwen3-asr-flash + qwen-flash | 同步 HTTP,非流式可选 | 约 0.001 元 | 次选/AB 对照,同 key 零切换成本 |
| 火山 大模型录音文件识别 + 豆包 | 异步提交+轮询,音频需公网 URL | 约 0.001 元 | 链路最长,不选 |
| 讯飞 IAT + 文本模型 | WebSocket 分帧,预签名 URL 可前端直连 | 免费 500 次/日 | 接入复杂,备选 |
| 智谱 glm-4-voice | 对话定位,输出音频,80 元/百万 token | 0.01-0.05 元 | 不推荐(停更/贵/形态不符) |
| 豆包端到端实时语音 | WebSocket 实时 | 约 0.097 元 | 双重不匹配 |

关键横向结论:
1. 五家公开 API 均无童声/儿童声学优化的官方说明,也无公开儿童语音评测。童声正确率是全链路最大未知数,只能自采样本实测(见 M0)。
2. qwen-omni-turbo 已停更,选型用 qwen3-omni-flash 或 qwen3.5-omni-flash。
3. Qwen-Omni 文档格式列表为 AMR/WAV/3GP/AAC/MP3,未列 webm/opus——前端统一转 wav 直接消掉该风险。

## 3. 前端录音与微信环境

环境矩阵(录音能力):
1. iOS Safari:MediaRecorder 自 14.5 稳定,产出 audio/mp4(AAC)。每次页面加载重新弹麦克风授权(SPA 内不刷新则一次到底)。
2. Android Chrome / 微信 XWeb:MediaRecorder 可用,产出 webm/opus。
3. 微信 iOS webview:iOS 14.3+ 苹果放开 WKWebView WebRTC,腾讯云文档确认可采集,但微信侧无官方承诺、社区有机型差异——必须真机回归,失败则该场景引导跳系统浏览器打开。
4. 微信 JS-SDK 录音兜底需认证公众号,个人主体走不通。
5. 微信小程序:RecorderManager 官方保障(可直接出 wav/pcm),但 request 域名必须 HTTPS + ICP 备案;同声传译插件现状存疑(社区反馈搜不到/个人主体不能加),不押注。

TTS(读音是产品核心功能):
1. iOS Safari speechSynthesis 可用但必须用户手势触发(按住说话本身就是手势,天然满足)。
2. Android/微信 webview 的 speechSynthesis 不可靠(getVoices 常为空)——需云端 TTS 兜底(百炼 qwen-tts/cosyvoice,同一平台),检测 voices 为空时切换。

## 4. 部署与 key 防护

1. 零备案组合(M1 用):EdgeOne Pages「全球(不含大陆)」模式绑自有域名(免费, 大陆可达无国内加速) + FC 3.0 内置域名 `*.fcapp.run` 跑函数(原生 HTTPS,大陆节点)。FC 内置域名官方定位测试用途且强制 attachment 响应头,fetch 拿 JSON 不受影响,个人项目可接受。
2. 正规组合(转正用):个人域名 ICP 备案(常见 5-7 天,上限 20 工作日) + OSS 静态托管 + FC 绑子域名。小程序路线也需要备案域名,建议 M1 期间并行启动备案。
3. key 防护:百炼官方临时 API Key(POST /api/v1/tokens,1-1800s 有效期,官方明确面向浏览器等不可信环境)。后端可缩成「签临时 key」迷你函数;前端拿临时 key 直连 compatible-mode 端点。DashScope 是否放行浏览器 CORS 未查到文档,需实测;不通则退回转发函数。
4. 不选:腾讯云 SCF(免费政策反复),Cloudflare Workers/Pages(workers.dev/pages.dev 大陆被污染,自定义域名走海外节点不稳)。
5. 成本:FC 首开 3 个月每月 15 万 CU 免费,之后此量级近零;模型约 0.001 元/次;总成本量级 = 域名年费 + 每月几元。

## 5. 里程碑

M0 语音链路 spike(前置:百炼 API key):
1. 实测 DashScope 临时 key + 浏览器 CORS 直连是否可行,定 方式A/方式B。
2. 自采童声样本(家里孩子 + TTS 合成童声变体),qwen3-omni-flash 与 asr+flash 两段式 AB 实测正确率与 p50 延迟;复用已有 16 条话术 eval 表(文本层 gpt-5.5 已验 15/16,提取规则 prompt 直接平移)。
3. 退出标准:真实童声 top1 字正确率、语境词正确率、端到端延迟有数,选定主方案。

M1 Web MVP:
1. 录音采集模块(isTypeSupported 探测 + OfflineAudioContext 归一 wav 16k mono)。
2. FC 函数(签临时 key 或转发,按 M0 结论)。
3. 接入主循环:录音 -> 模型 -> loadCharacter(char, context) + echo 播报;Web Speech/打字框保留为降级链。
4. TTS 兜底:voices 为空时切云端 TTS。
5. 部署 EdgeOne + FC;e2e 扩展(mock 模型响应);真机矩阵回归(iOS Safari / Android Chrome / 微信双端),记录微信 iOS webview 实测结论。
6. 并行:启动个人域名备案。

M2 微信形态决策(依赖 M1 真机结论):
1. 微信 iOS webview 可用 -> 纯 web 覆盖,小程序缓做。
2. 不可用 -> 小程序版(RecorderManager 出 wav,canvas 渲染层平移,备案域名接自家 FC)。

M3 产品打磨:逐笔模式实验(真孩子试连续版后决策)、常用字预取、误识别引导话术、亲子设置页。

## 6. 风险与未决项

| 风险 | 等级 | 缓解 |
|---|---|---|
| 童声识别正确率无任何厂商承诺 | 高 | M0 自采样本实测;回声消歧设计已内置(错了孩子听得出) |
| 微信 iOS webview 录音机型差异 | 中 | M1 真机矩阵;失败引导浏览器打开;M2 小程序 |
| DashScope 浏览器 CORS 未知 | 中 | M0 首项实测;退路=转发函数(已设计) |
| omni 不收 webm/opus | 低 | 前端统一转 wav,已消 |
| Android/微信 speechSynthesis 不可靠 | 中 | 云端 TTS 兜底,同平台 |
| FC 内置域名「仅测试用途」 | 低 | 转正时切备案自定义域名 |

## 7. 主要来源

1. Qwen-Omni: https://help.aliyun.com/zh/model-studio/qwen-omni
2. 百炼价格: https://help.aliyun.com/zh/model-studio/model-pricing
3. Qwen-ASR: https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference
4. 临时 API Key: https://help.aliyun.com/zh/model-studio/generate-temporary-api-key
5. FC 3.0 免费额度: https://help.aliyun.com/zh/functioncompute/fc-3-0/product-overview/trial-quota-1
6. FC HTTP 触发器/内置域名: https://www.alibabacloud.com/help/zh/functioncompute/fc-3-0/user-guide/http-triggers-overview
7. EdgeOne Pages 域名政策: https://pages.edgeone.ai/document/domain-overview
8. WebKit MediaRecorder: https://webkit.org/blog/11353/mediarecorder-api/
9. iOS 微信 webview WebRTC: https://cloud.tencent.com/developer/article/1871294
10. Recorder 库(H5 录音兼容性): https://github.com/xiangyuecn/Recorder
11. 小程序域名规则: https://developers.weixin.qq.com/miniprogram/dev/framework/ability/domain.html
12. 同声传译插件: https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/extended/translator.html

数据缺口(如实声明):百炼国内挂牌价页截断(以控制台为准);DashScope CORS 无文档;微信 iOS webview 无微信官方承诺;童声质量全行业无公开数据。
