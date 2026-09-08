// 纯本地复现：DSH 经 pi-ai 发往 中转站 的实际 wire body，不启动 DSH、不联网。
// 做法：把 pi-ai openai-completions 的 streamSimple 指向本地回显服务，
// 抓它真正 POST 出去的 JSON。pi-ai 版本与 DSH checkout 内嵌的一致。
// 用法：node scripts/wire-repro.mjs
import http from 'node:http';
import { pathToFileURL } from 'node:url';

// 经 llm-pi-ai 的 node_modules symlink 解析，DSH 升级 pi-ai 后依然有效。
const PI_API = pathToFileURL(
  'D:/Project/deepseek-harness-dev/packages/llm/llm-pi-ai/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js',
).href;
const { streamSimple } = await import(PI_API);

const captured = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    captured.push({ url: req.url, body });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: [DONE]\n\n');
  });
});
await new Promise((r) => server.listen(8899, '127.0.0.1', r));

const glmModel = {
  id: 'glm-5.3-flash',
  provider: 'suiyue-repro',
  baseUrl: 'http://127.0.0.1:8899/v1',
  input: ['text', 'image'],
  reasoning: true,
  // 与插件知识库 glm-5-3-flash 条目一致：low/high/max，无 off
  thinkingLevelMap: { low: 'low', high: 'high', max: 'max' },
  compat: { thinkingFormat: 'zai', supportsReasoningEffort: true },
};
const qwenModel = {
  id: 'qwen3.8-flash',
  provider: 'suiyue-repro',
  baseUrl: 'http://127.0.0.1:8899/v1',
  input: ['text', 'image'],
  reasoning: true,
  // 与插件知识库 qwen-3-8 条目一致：off:null（关=不发值）
  thinkingLevelMap: { off: null, low: 'low', medium: 'medium', xhigh: 'xhigh' },
  compat: { thinkingFormat: 'qwen', supportsReasoningEffort: true },
};

const ctx = { messages: [{ role: 'user', content: 'ping' }] };
// 对话页会带系统提示（与测试页只有 user 消息不同）
const sysCtx = {
  systemPrompt: 'You are a helpful assistant.',
  messages: [{ role: 'user', content: 'ping' }],
};

async function one(label, model, reasoning, useCtx = ctx) {
  captured.length = 0;
  const options = { apiKey: 'repro-key', maxTokens: 16, temperature: 0 };
  if (reasoning !== undefined) options.reasoning = reasoning;
  try {
    // eslint-disable-next-line no-unused-vars
    for await (const _ev of streamSimple(model, useCtx, options)) {
      /* 只关心发出去的请求体，响应直接消费掉 */
    }
    console.log('response: consumed (no throw)');
  } catch (e) {
    console.log('response: threw:', String(e?.message ?? e).slice(0, 200));
  }
  const raw = captured[0]?.body ?? '(no request captured)';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }
  // 只打印思考相关字段 + 模型名，避免刷屏
  const focus = {
    model: parsed.model,
    thinking: parsed.thinking,
    reasoning_effort: parsed.reasoning_effort,
    enable_thinking: parsed.enable_thinking,
  };
  console.log('=== ' + label + ' (reasoning=' + String(reasoning) + ') ===');
  console.log(JSON.stringify(focus));
  if (useCtx !== ctx) console.log('messages=' + JSON.stringify(parsed.messages));
}

await one('GLM Default（对应模型Pro测试页）', glmModel, undefined);
await one('GLM 显式 max', glmModel, 'max');
await one('GLM 显式 off（设置里已删掉的档）', glmModel, 'off');
await one('Qwen Default', qwenModel, undefined);
await one('Qwen 显式 low（issue最新要求测的）', qwenModel, 'low');
await one('GLM 显式 high + 系统提示（对应图六对话页）', glmModel, 'high', sysCtx);
await one('Qwen Default + 系统提示（对应图三/图四对话页）', qwenModel, undefined, sysCtx);

server.close();
