# DSH Better Reasoning Effort

[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/dsh-better-reasoning-effort)](https://www.npmjs.com/package/dsh-better-reasoning-effort)
[![npm downloads](https://img.shields.io/npm/dw/dsh-better-reasoning-effort)](https://www.npmjs.com/package/dsh-better-reasoning-effort)
![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4d6bfe)
![dsh-plugin](https://img.shields.io/badge/dsh--plugin-ecosystem-4d6bfe)
![Version](https://img.shields.io/badge/version-0.3.1-4d6bfe)
![Docs](https://img.shields.io/badge/docs-EN%20%7C%20ZH-4d6bfe)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[English](README.md) | **中文**

给 DeepSeek Harness 的**第三方模型**（pi-ai 手工声明路由）提供思考强度（reasoning effort）与**输入模态**（图片输入支持）设置的插件——直接在官方「模型」页的模型行里编辑，带知识库 + 协议推断的自动适配；另附**官方模型菜单内的快捷思考强度滑块**（白色圆形滑块，集成自 HanaAyane 的 dsh-reasoning-effort，见[致谢](#致谢)）——Composer 右下角的官方*模型 · 思考强度*显示形式保持不变。

![官方「模型」页模型行内的思考强度编辑器](assets/models-page-effort-editor.png)

## 为什么需要它

DeepSeek Harness 的 `llm-pi-ai` 适配器原生支持每个模型声明 `reasoningEfforts`（接受哪些思考档位 + 每个档位发往端点的确切取值），但官方「模型」页的编辑卡**刻意不暴露这个字段**——官方注释明说它是 per-model 能力、provider 级旋钮会弄坏部分模型。于是：

- 第三方模型在 Composer 的模型选择器里**没有思考档位选择**（`getSupportedThinkingLevels` 短路成 `["off"]`）；
- 只有官方 DeepSeek API（内置 catalog）能设思考强度；
- 想给第三方模型设档位，只能手写 `settings.yaml` 的 `reasoningEfforts` / `compat` 块。
- 手工声明的第三方模型默认被当作**纯文本**（`input` 缺省为 `["text"]`）：图片附件在发送前就被拒绝，read-image 工具拒绝工作，中间每一层网关路径都读同一个标志。核心本来就接受每模型的 `input: ["text", "image"]` 声明——只是官方页同样不暴露。

本插件把这两份配置能力都搬回 UI：**官方模型编辑卡内直接编辑**，加**自动适配**。

## 特性

- **官方页内注入**：官方「模型 → 编辑 → 自定义设置 → 模型行展开区」里出现编辑块，和上下文窗口 / 最大输出并列——不是另起炉灶的单列页面，而是融进官方编辑流程（同一个 `settings.mutate` 契约、同一种保存方式）。编辑块横跨展开区整行，档位行按官方容量字段同样的两列均分；现在包含**思考强度**与**输入模态**两个分区，由底部同一对「应用 / 放弃修改」按钮统一控制。
- **输入模态声明**：一个勾选框（「图片输入」）让手工声明的模型端到端具备视觉能力——Composer 附件、read-image 工具、代理门控读的都是同一个标志。取消勾选把声明收窄为纯文本；点「清除声明」则写入持久的 `inputUnset` 标记，host 自动填充会像尊重思考档位的撤销标记一样尊重它。
- **分区式建议展示**：「自动适配」在独立一行报告应用了什么（来源 · 置信度），单独说明模态建议的出处（端点列表 / 知识库 / 命名启发式——最后一种明确标注低置信度），并把参考容量（上下文窗口、最大输出）渲染进独立的只读区块，标题写明"仅提示，不自动填充"。数值带千分位，可直接照抄进官方容量输入框。
- **未保存行的暂存**：编辑块也会出现在"尚未保存"的行上，两种形态同一条链路——新建供应商的卡片（自动适配直接用卡上填写的协议/端点），以及给**已保存供应商新增的模型行**（自动适配改用文档里的路由事实 + 行上已输入的显示名称）。**暂存**把声明留在内存中，该行（或该供应商）保存落盘的瞬间自动写入；绝不覆盖文档里已有的声明。注意暂存阶段表达不了"故意留空"：全部清空后再暂存等同撤单、退回自动适配的填充——确要不声明的模型，请先保存行，再在行内全不勾并应用（写入持久撤销标记）。
- **自动适配**：内置模型知识库（DeepSeek V3/V4/R1 及其视觉实验版；OpenAI GPT-4o/GPT-4.1/GPT-5.1–5.6 按代际（含 codex 变体）+ o 系列 + gpt-oss 开源权重 + 各代非推理 -chat 线；Claude 3.x/4.5–5 按代分档（仅官方列入 effort 支持清单的型号给出档位）、Gemini、Grok 4.3–4.6、Mistral Small 2603 / Medium 3-5（reasoning_effort 模型；已弃用的 magistral 线声明为无 effort 控制）、通义含 Qwen-VL/QvQ 与 3.8 代、智谱含 GLM-4V/4.5V/4.6V/5V 与 GLM-5.2/5.3、Kimi K2.5/K2.6/K2.7-Code/K3、MiniMax M3 思考开关、豆包、混元 hy3、阶跃含 3.5/3.6/3.7、百度 ERNIE（官方接口无 effort 控制）——全部条目已于 2026-08 逐条对照各家官方文档复核，并与公开模型目录交叉印证；视觉变体单独成条，基础条目绝不替它们声称图片能力）+ 协议推断（按 pi-ai 真实线协议 `openai-completions` / `openai-responses` / `anthropic-messages`，以及从 `baseURL` 识别的 DeepSeek 官方端点方言——仅 `api.deepseek.com` 这一经验证的官方域名），一键填入推荐档位与线上取值。在此无法触及 effort 式控制的家族（Llama、Nova、Phi、Cohere、Perplexity sonar）有意不设条目——低置信度的通用建议更诚实。compat 建议按协议分门：openai-completions 门接受 thinkingFormat/supportsReasoningEffort，自适应思考的 Claude 家族在 anthropic-messages 路由上补 `forceAdaptiveThinking` 引脚，使 pi-ai 把声明的档位以 `output_config.effort` 发出。
- **端点取证**：自动适配还会经 host 同源路由探测供应商的**原始** `/models` 列表（凭据只在服务端解析、绝不回显），按置信度融合信号——端点明确"不支持推理"时直接建议禁用；知识库的线上取值始终权威；每条建议标注高/中/低置信度，低置信度建议核对后再用。同一次探测还会读取**模态披露**（OpenRouter 式 `architecture.input_modalities`、models.dev 式嵌套、`supported_features`/`capabilities` 的 vision 标志、`supports_vision`）以及端点自报的**上下文长度**——显式列表优先于知识库，沉默不改变任何判断。
- **Host 自动填充**：settings 更新时，为没有 `reasoningEfforts` 声明的模型自动补一份推荐声明——缺失的输入模态声明也会一并补齐（可用 `modalityAutofill: false` 关闭；已声明、显式 `false`、刻意撤销的标记一律不动，容量字段则从不写入）。写入采用乐观锁：若你的编辑已把设置顶高，自动填充会放弃并等下一次更新，绝不与你抢写。
- **三种意图**：全不勾 = 取消声明（回到继承——以 `reasoningEffortsUnset` 标记持久化，自动填充会尊重它，重启后依然有效）；只勾 off = 禁用推理（`false`）；勾选档位 = 写入声明。模态侧同理：未声明 = 继承提供方默认，勾选图片 = 声明收图，「清除声明」= 以 `inputUnset` 标记持久化撤销。编辑器随官方页重新渲染与推送的设置变更保持同步，你编辑到一半不会被打断。
- **Composer 思考强度滑块（整个弹窗复刻）**：官方模型菜单（右下角席位弹出的 popover）打开的那一帧起，体内即替换为上游设计——滑块（白色圆钮、渐变胶囊轨道、radiation canvas + flare；档位取自当前模型适配器播报的阶梯）带 14px 内边距，一条分隔线，然后**一行** *模型名 · 当前档位 ›*（点击打开官方模型列表）。官方“推理等级”钻取行被滑块取代（滑块本身就是档位控件）；官方菜单外壳与右下角触发钮保持原样。拖动经官方 session 模型选择链路提交（乐观 + 被拒回滚，失败在菜单内提示）。档位少于两个的模型显示安静提示 + 模型行。复刻体与菜单同一帧挂载，不会先闪现官方原版窗口。
- **模型页开关**：「推理强度滑块」开关从通用设置移出，放到**「模型」**设置页“添加提供方 / 添加自定义提供方”的下方，置于一个带边框的容器内（设置项形式与上游插件一致）。`0.1.2-alpha.1` 上该开关挂在官方 `settings.models.footer` slot；旧内核（rc.2）上同一个盒子以 DOM 注入方式挂到添加按钮下方。
- **防御式注入**：注入依赖官方页 DOM 结构（aria-label / class），一旦官方升级改变结构，注入器自动停用、官方页不受影响；结构恢复后下次扫描自动重新注入。
- 双语文案（中文 / English）。

## 安装

需要 DeepSeek Harness `0.1.1-rc.1` 或更新版本，含 `0.1.2-alpha.1` 预发布（`@deepseek-ai/dsh-api-remotes@^0.1.1-rc.1 || ^0.1.2-alpha.1`；host 侧 peer 依赖 `@deepseek-ai/dsh-settings` 采用同一范围，另有 `@deepseek-ai/schemastery@^3.18.0`——必须显式写 `||` 分支：npm 的 prerelease 排除规则会使普通 rc 范围拒绝匹配 `0.1.2-alpha.1`）。线协议契约已对照 `0.1.1-rc.2` 验证，并对照 `0.1.2-alpha.1` 源码静态复核（settings Remote 面、client 服务、模块加载协议与 Models 页 DOM 锚点）；更早的 rc 线不受支持。client bundle 运行时不请求任何官方模块，同一产物可在两条内核线上加载。

**模型行编辑器在两条内核线上统一走 DOM bypass（不做版本号嗅探）：**注入器按官方容量折叠区锚点（`Capacities`/`容量`）定位——rc.2 与 alpha.1 未变——因此编辑器挂进每个展开的模型行下，就在*编辑 → 自定义设置*流程里，也覆盖未保存行（新建供应商卡片上的暂存、保存瞬间自动写入；alpha.1 的新建卡片同样支持，不需要“先保存再配置”）。唯一随内核变化的席位是滑块开关：`0.1.2-alpha.1` 上挂在官方 `settings.models.footer` slot；`0.1.1-rc.2` 的 Models 分区不声明任何扩展 slot，同一盒子以 DOM 注入方式挂到添加按钮下方。切换依据仍是内核暴露的 settings wire 席位（`ctx.remote.settings` 与 `connection.api`），而非版本字符串。

### 从 npm

```bash
# 在 dsh 的 web profile 下
dsh plugin --profile web add dsh-better-reasoning-effort
```

### 从 GitHub

```bash
# 在 dsh 的 web profile 下
dsh plugin --profile web add github:HaoyueQin/dsh-better-reasoning-effort
```

`github:` 源只拉源码，`lib/` 由包的 `prepare` 钩子构建；pnpm 默认不跑 git 依赖的构建脚本，安装器会打印需要加入 `allowBuilds` 的密钥，照做后重新 `add`。

### 本地开发

```bash
npm install && npm run build
dsh plugin --profile web add link:D:/Project/dsh-better-reasoning-effort
```

重启 `dsh web`，硬刷新浏览器。官方「模型」页每行模型的展开区多了一块「思考强度」。

## 使用

1. 在官方「模型」页配置第三方供应商（API Key 等）。
2. 展开某个模型行：官方容量字段下方是编辑块。
   - 勾选档位（off / minimal / low / medium / high / xhigh / max），填线上取值（如给 `high` 填 `ultra`，Composer 选 High 时网关收到 `ultra`）；
   - 在「输入模态」区勾选**图片输入**，声明模型接受什么（不勾且无声明 = 继承提供方默认，通常纯文本）；
   - 点「自动适配」按知识库/协议/端点列表填推荐档位与模态——参考容量会以只读提示出现，可自行照抄进官方输入框；
   - 点「应用」写入设置。
3. 全不勾 + 应用 = 取消声明（回到继承）；只勾 off + 应用 = 禁用推理（`false`）；模态行「清除声明」+ 应用 = 回到继承提供方默认。

声明后的模型在 Composer 模型选择器里立即可选思考强度；声明了图片输入的模型可以端到端传附件。

## 配置

host 侧接受可选的配置项（以下是默认值）：

```yaml
- insert:
    - id: dsh-better-reasoning-effort
      name: dsh-better-reasoning-effort
      config:
        # 启动时与设置更新后自动填充未声明的模型。
        autofill: true
        # 上述自动填充是否连带补写输入模态声明。
        modalityAutofill: true
        # 上游 /models 探测请求超时，单位毫秒。
        probeTimeoutMs: 15000
        # 启动填充的重试退避表；[] 表示只尝试一次。
        bootRetryDelaysMs: [1000, 2000, 4000, 8000, 16000, 30000]
```

设 `autofill: false` 可完全关闭静默自动填充——浏览器里的 **Auto-adapt（自动适配）** 按钮不受影响。

## 工作方式（架构）

```
浏览器 (lib/client.js)                  Host (lib/index.js)
├─ DOM 注入器                           └─ 自动填充
│   MutationObserver 监听官方模型页        settings/updated → 为未声明模型
│   → 在模型行展开区挂 EffortEditor         补 reasoningEfforts（知识库+推断）
├─ EffortEditor（React 组件）
│   档位勾选 / 线上值 / 输入模态开关 /
│   自动适配（分区式建议展示）/ 应用
│   └─ 写 settings.mutate（llm-pi-ai）
```

- **知识库 + 协议推断**：`src/knowledge.ts` 的 `suggestEfforts()`，纯函数，host 与浏览器共用——融合端点信号、精选条目（档位、模态、参考容量）、命名启发式与协议推断。
- **DOM 注入**：`src/client/injector.ts` 的 `reconcile()`，按官方按钮 aria-label（`Capacities`/`容量`）定位模型行，把编辑器挂进容量折叠区。
- **写入**：`src/client/ops.ts` 的 `createEditorApi()`，`settings.mutate` 按路径改写 `providers.<route>.models[i].reasoningEfforts`——有模态意图时一并改写 `.input`——保留行内其他字段；冲突时自动重读重试一次（与官方设置表单相同的恢复策略）。
- **共享常量**：`src/constants.ts` 承载插件 id、设置命名空间、DOM 标记，host 与浏览器共用。

## 开发

```bash
npm run typecheck   # tsc 严格检查 src
npm test            # vitest：知识库 / 推断 / autofill / DOM 注入 / 写入
npm run build       # lib/*.js + lib/client.js（模块加载器 bundle）
```

契约版本：`@deepseek-ai/dsh-api-remotes@0.1.1-rc.2`（client 契约类型），已通过针对 `0.1.1-rc.2` 各包的 typecheck、测试套件与完整构建验证。

## 已知限制

- 注入依赖官方 Models 页当前 DOM（aria-label/class）。官方升级若改结构，注入自动停用，需要跟进适配；停用期间官方页不受影响。
- 官方模型菜单的箭头键焦点漫游遍历的是它自己（已被隐藏）的根单元格——对 display:none 节点 focus() 是空操作；键盘用户经 Tab 到达复刻体，复刻行的 Enter 可打开官方模型列表。
- 「自动适配」的探测路由只应答 **loopback 与 IP 字面量 Host**——采用核心 `/api` 栅栏同款 Host 白名单纪律，但暂无其 `trustedHosts` 出口（DNS rebinding 页面的 Host 必然是攻击者域名，因此域名宿主一律拒绝）。以域名对外提供 GUI 的局域网部署，仅此一条探测路由会得到 403（IP 字面量宿主不受影响），其余功能照常。
- `reasoningEfforts` 声明是建议值：网关实际接受哪些档位/取值以端点文档为准，可在 UI 里逐个修改。
- 知识库覆盖面有限——各家上新后拼写会漂移，不吃 effort 档的家族则完全无条目；未收录的模型走协议推断 + 通用档位，可手动调整。
- 模态词表跟随 pi-ai 核心（当前为 `text` / `image`）。部分网关支持的更宽能力（PDF、音频、视频）已按家族记录在案，等核心词表扩充后再开放声明——今天声明不了是设计使然，不是疏漏。
- 名字启发式的模态建议（`*-vl*` / `*vision*` / `gpt-4o` 一类视觉味 id）刻意标注为低置信度——使用前请核对。

## 致谢

Composer 思考强度滑块**改编自 [dsh-reasoning-effort](https://github.com/HanaAyane/dsh-reasoning-effort)（作者 [HanaAyane](https://github.com/HanaAyane)，MIT 许可）**——感谢原作者与 codex 风格思考强度控制的思路。

本插件取自它的部分：

- 其依托的 session 模型选择契约（按会话的模型目录 → 适配器播报的档位阶梯 → `selectModel` 提交，乐观快照 + 被拒回滚）；
- 滑块交互形态（拖动 / 键盘操作，滑块旁显示档位名）。

集成时的**刻意改动**：

- **只把滑块换成白色圆形。** chibi-runner“大肥鱼”滑块（把圆钮换成鱼形贴图）不带入；其余与上游逐字一致——渐变胶囊轨道、左侧裁剪的 canvas 辐射动效与 flare 辉光、拖动/键盘契约、乐观提交 + 被拒回滚。
- **官方模型席位绝不被替换。** 上游插件把整个席位顶掉（自绘触发钮 + 菜单）；这里官方右下角 *模型 · 思考强度* 显示形式保持原样，滑块在官方菜单弹出时注入到其顶部。
- **位置与设置项减少。** 上游的“推理强度滑块 / 大肥鱼滑块”两项在通用设置页；这里只保留 *推理强度滑块* 开关，放在**「模型」**页添加提供方按钮下方的带框容器内；“大肥鱼滑块”随功能一起移除。
- **跨内核维护。** 这是基于 harness wire 契约的精简重写（不是上游 bundle 的 fork）：无需上游的 `0.1.0-rc.6` 版本钉死，可跑在 `0.1.1-rc.2` 与 `0.1.2-alpha.1` 上，整个挂载/卸载生命周期由本插件的 DOM 注入器管理。若上游项目恢复更新，留意两点：两个插件同时装会重复——上游再次顶掉官方席位，官方触发钮会再次消失。

如果你之前用过上游插件，请移除它，避免同席位上出现两套思考强度控制：

```bash
dsh plugin --profile web remove dsh-reasoning-effort
```

## License

MIT