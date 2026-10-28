import type { ProviderConfig } from './protocol';
// Credentials and enablement are session-only. Candidate drafts use versioned IndexedDB separately.
export const aiSession: {
  enabled: boolean;
  config: ProviderConfig;
} = {
  enabled: false,
  config: {
    kind: 'compatible',
    endpoint: 'http://127.0.0.1:8089/v1',
    model: 'qwen2.5-1.5b-instruct',
    apiKey: '',
    jsonMode: 'schema',
  },
};
