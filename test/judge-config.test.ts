import { describe, expect, it } from 'vitest';
import { judgeConfig } from '@/lib/judge-config';

const HF = { HF_ENDPOINT_URL: 'https://abc.endpoints.huggingface.cloud', HF_TOKEN: 'hf_x' };

describe('judgeConfig', () => {
  it('uses the self-hosted server alone by default', () => {
    expect(judgeConfig({ LAYA_BASE_URL: 'http://127.0.0.1:8000' })).toEqual({
      providers: [{ provider: 'laya', baseUrl: 'http://127.0.0.1:8000' }],
    });
  });

  it('adds the optional bearer key and a pinned checkpoint', () => {
    expect(judgeConfig({ LAYA_BASE_URL: ' http://l ', LAYA_API_KEY: 'k', LAYA_MODEL: ' Multilingual ' })).toEqual({
      providers: [{ provider: 'laya', baseUrl: 'http://l', apiKey: 'k', model: 'multilingual' }],
    });
  });

  it('treats an empty LAYA_MODEL as automatic routing', () => {
    expect(judgeConfig({ LAYA_BASE_URL: 'http://l', LAYA_MODEL: '' }).providers[0]).not.toHaveProperty('model');
  });

  it('rejects a model name laya-serve would ignore', () => {
    expect(() => judgeConfig({ LAYA_BASE_URL: 'http://l', LAYA_MODEL: 'jev-latest' })).toThrow(
      /LAYA_MODEL "jev-latest" is not a Laya checkpoint/
    );
  });

  it('leaves unlisted providers off even when their settings exist', () => {
    const config = judgeConfig({ LAYA_BASE_URL: 'http://l', ...HF });
    expect(config.providers.map((p) => p.provider)).toEqual(['laya']);
  });

  it('chains every listed provider in the given order', () => {
    const config = judgeConfig({ LAYA_PROVIDERS: 'huggingface,laya', LAYA_BASE_URL: 'http://l', LAYA_MODEL: 'english', ...HF });
    expect(config.providers).toEqual([
      { provider: 'huggingface', baseUrl: HF.HF_ENDPOINT_URL, apiKey: 'hf_x', model: 'english' },
      { provider: 'laya', baseUrl: 'http://l', model: 'english' },
    ]);
  });

  it('accepts aliases, drops repeats and skips providers without settings', () => {
    const config = judgeConfig({ LAYA_PROVIDERS: ' HF, laya-serve ,huggingface', LAYA_BASE_URL: 'http://l' });
    expect(config.providers.map((p) => p.provider)).toEqual(['laya']);
  });

  it('needs both the endpoint URL and the token for Hugging Face', () => {
    expect(() => judgeConfig({ LAYA_PROVIDERS: 'huggingface', HF_ENDPOINT_URL: 'https://x' })).toThrow(
      /LAYA_PROVIDERS=huggingface; set HF_ENDPOINT_URL and HF_TOKEN/
    );
  });

  it('explains what is missing when nothing is configured', () => {
    expect(() => judgeConfig({})).toThrow(/No Laya provider is configured for LAYA_PROVIDERS=laya; set LAYA_BASE_URL/);
    expect(() => judgeConfig({ LAYA_PROVIDERS: 'laya,huggingface', LAYA_BASE_URL: '  ' })).toThrow(
      /LAYA_PROVIDERS=laya,huggingface; set LAYA_BASE_URL or HF_ENDPOINT_URL and HF_TOKEN/
    );
  });

  it('rejects unknown provider names', () => {
    expect(() => judgeConfig({ LAYA_PROVIDERS: 'typesafe', LAYA_BASE_URL: 'http://l' })).toThrow(/unknown provider "typesafe"/);
  });
});
