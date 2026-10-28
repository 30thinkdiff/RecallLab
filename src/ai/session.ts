import type { GenerationState } from './generation';
import type { ProviderConfig } from './protocol';
// Deliberately volatile: neither credentials nor unconfirmed/private drafts enter browser storage.
export const aiSession: {
  enabled: boolean;
  config: ProviderConfig;
  drafts: Map<string, GenerationState>;
} = {
  enabled: false,
  config: {
    kind: 'compatible',
    endpoint: 'http://127.0.0.1:8088/v1',
    model: 'qwen2.5-0.5b-instruct',
    apiKey: '',
    jsonMode: 'schema',
  },
  drafts: new Map(),
};
