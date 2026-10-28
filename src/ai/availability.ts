import { destination } from './providers';
import type { ProviderConfig } from './protocol';
export interface ModelAvailability {
  status: 'ready' | 'missing-model' | 'unreachable' | 'authentication' | 'unsupported' | 'mock';
  models: { id: string; bytes?: number }[];
  message: string;
}
export async function checkModel(
  config: ProviderConfig,
  signal: AbortSignal,
  fetcher: typeof fetch = (...a) => fetch(...a),
): Promise<ModelAvailability> {
  let place;
  try {
    place = destination(config);
  } catch {
    return { status: 'unsupported', models: [], message: '请填写有效的模型地址与名称。' };
  }
  if (config.kind === 'mock')
    return { status: 'mock', models: [], message: '模拟演示，不是 AI，也不需要模型服务。' };
  if (place.destination === 'external')
    return {
      status: 'unsupported',
      models: [],
      message: '外部服务不自动探测；生成前请明确核对地址、密钥和发送范围。',
    };
  try {
    const response = await fetcher(
      config.endpoint.replace(/\/+$/, '') + (config.kind === 'ollama' ? '/api/tags' : '/models'),
      {
        signal,
        headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      },
    );
    if (response.status === 401 || response.status === 403)
      return {
        status: 'authentication',
        models: [],
        message: '本机服务要求认证，请填写本次密钥；密钥不会保存。',
      };
    if (!response.ok)
      return {
        status: 'unsupported',
        models: [],
        message: '服务可连接，但不支持模型清单或仍在加载；请检查服务类型。',
      };
    const raw = await response.text();
    if (raw.length > 1024 * 1024) throw Error();
    const data = JSON.parse(raw) as {
      models?: { name: string; size?: number }[];
      data?: { id: string }[];
    };
    const models =
      config.kind === 'ollama'
        ? (data.models ?? []).map((m) => ({ id: m.name, bytes: m.size }))
        : (data.data ?? []).map((m) => ({ id: m.id }));
    if (!models.every((m) => typeof m.id === 'string')) throw Error();
    const exists = models.some(
      (m) =>
        m.id === config.model || (config.kind === 'ollama' && m.id === `${config.model}:latest`),
    );
    return {
      status: exists ? 'ready' : 'missing-model',
      models,
      message: exists
        ? '本机服务可用，所选模型已存在。'
        : '服务已连接，但没有找到所选模型。请选择已安装模型；不会自动下载。',
    };
  } catch {
    return {
      status: 'unreachable',
      models: [],
      message: signal.aborted
        ? '检测已取消或超时。'
        : '未连接到本机模型服务，或浏览器不允许访问。基础学习仍然可用。',
    };
  }
}
