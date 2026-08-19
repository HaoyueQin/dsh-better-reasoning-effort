# dsh-better-reasoning-effort

给 DeepSeek Harness 的**第三方模型**（pi-ai 手工声明路由）提供思考强度（reasoning effort）设置的插件——直接在官方「模型」页的模型行里编辑，带知识库 + 协议推断的自动适配。

## 为什么需要它

DeepSeek Harness 的 `llm-pi-ai` 适配器原生支持每个模型声明 `reasoningEfforts`（接受哪些思考档位 + 每个档位发往端点的确切取值），但官方「模型」页的编辑卡**刻意不暴露这个字段**——官方注释明说它是 per-model 能力、provider 级旋钮会弄坏部分模型。于是：

- 第三方模型在 Composer 的模型选择器里**没有思考档位选择**（`getSupportedThinkingLevels` 短路成 `["off"]`）；
- 只有官方 DeepSeek API（内置 catalog）能设思考强度；
- 想给第三方模型设档位，只能手写 `settings.yaml` 的 `reasoningEfforts` / `compat` 块。

本插件把这份配置能力搬回 UI：**官方模型编辑卡内直接编辑**，加**自动适配**。

## 特性

- **官方页内注入**：官方「模型 → 编辑 → 自定义设置 → 模型行展开区」里出现「思考强度」编辑块，和上下文窗口 / 最大输出并列——不是另起炉灶的单列页面，而是融进官方编辑流程（同一个 `settings.mutate` 契约、同一种保存方式）。编辑器占满展开区整行，与官方容量字段同密度。
- **自动适配**：内置模型知识库（DeepSeek V3/R1、OpenAI o 系列、Qwen、GLM、Kimi、MiniMax、豆包等）+ 协议推断（按 `api` / `baseURL` 判断 openai / deepseek / anthropic / gemini 方言），一键填入推荐档位与线上取值。
- **Host 自动填充**：settings 更新时，为没有 `reasoningEfforts` 声明的模型自动补一份推荐声明（不覆盖已声明或显式 `false` 的模型）。写入采用乐观锁：若你的编辑已把设置顶高，自动填充会放弃并等下一次更新，绝不与你抢写。
- **三种意图**：全不勾 = 取消声明（回到继承）；只勾 off = 禁用推理（`false`）；勾选档位 = 写入声明。编辑器随官方页重新渲染保持同步，你编辑到一半不会被打断。
- **防御式注入**：注入依赖官方页 DOM 结构（aria-label / class），一旦官方升级改变结构，注入器自动停用、官方页不受影响；结构恢复后下次扫描自动重新注入。
- 双语文案（中文 / English）。

## 安装

### 从 GitHub

```bash
# 在 dsh 的 web profile 下
dsh plugin --profile web add github:<your-name>/dsh-better-reasoning-effort
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
2. 展开某个模型行：官方容量字段下方是「思考强度」块。
   - 勾选档位（off / minimal / low / medium / high / xhigh / max），填线上取值（如给 `high` 填 `ultra`，Composer 选 High 时网关收到 `ultra`）；
   - 点「自动适配」按知识库/协议填推荐档位；
   - 点「应用」写入设置。

声明后的模型在 Composer 模型选择器里立即可选思考强度。

## 工作方式（架构）

```
浏览器 (lib/client.js)                  Host (lib/index.js)
├─ DOM 注入器                           └─ 自动填充
│   MutationObserver 监听官方模型页        settings/updated → 为未声明模型
│   → 在模型行展开区挂 EffortEditor         补 reasoningEfforts（知识库+推断）
├─ EffortEditor（React 组件）
│   档位勾选 / 线上值 / 自动适配 / 应用
│   └─ 写 settings.mutate（llm-pi-ai）
```

- **知识库 + 协议推断**：`src/knowledge.ts` 的 `suggestEfforts()`，纯函数，host 与浏览器共用。
- **DOM 注入**：`src/client/injector.ts` 的 `reconcile()`，按官方按钮 aria-label（`Capacities`/`容量`）定位模型行，把编辑器挂进容量折叠区。
- **写入**：`src/client/ops.ts` 的 `createEditorApi()`，`settings.mutate` 按路径改写 `providers.<route>.models[i].reasoningEfforts`，保留行内其他字段；冲突时自动重读重试一次（与官方设置表单相同的恢复策略）。
- **共享常量**：`src/constants.ts` 承载插件 id、设置命名空间、DOM 标记，host 与浏览器共用。

## 与同类插件的区别

| | better-model-provider | dsh-reasoning-effort-autofill | HanaAyane/dsh-reasoning-effort | 本插件 |
|---|---|---|---|---|
| 编辑入口 | 独立设置页 | 无 UI（静默填充） | 独立设置页（粘贴 YAML） | **官方模型编辑卡内** |
| 自动适配 | 无 | 写死 OpenAI 档位 | 诊断 + 粘贴 | **知识库 + 协议推断**，一键填入 |
| 官方页融合 | 否 | 否 | 否 | **是**（DOM 注入） |

## 开发

```bash
npm run typecheck   # tsc 严格检查 src
npm test            # vitest：知识库 / 推断 / autofill / DOM 注入 / 写入
npm run build       # lib/*.js + lib/client.js（模块加载器 bundle）
```

契约版本：`@deepseek-ai/dsh-api-remotes@0.1.0-rc.7`（client 契约类型），dsh CLI `0.1.0-rc.6` 实测。

## 已知限制

- 注入依赖官方 Models 页当前 DOM（aria-label/class）。官方升级若改结构，注入自动停用，需要跟进适配；停用期间官方页不受影响。
- `reasoningEfforts` 声明是建议值：网关实际接受哪些档位/取值以端点文档为准，可在 UI 里逐个修改。
- 知识库覆盖面有限——未收录的模型走协议推断 + 通用档位，可手动调整。

## License

MIT
