export async function generateNAI({ apiKey, baseUrl = 'https://image.novelai.net', model = 'nai-diffusion-4-5-full', prompt, negativePrompt = '', width = 832, height = 1216, steps = 28, scale = 5, sampler = 'k_euler', seed = -1, nSamples = 1, ucPreset = 2, qualityToggle = true, smea = false, smeaDyn = false }) {
  if (!apiKey) throw new Error('未配置 NovelAI API Key');
  const url = `${baseUrl.replace(/\/$/, '')}/ai/generate-image`;
  const body = { input: prompt, model, action: 'generate', parameters: { width, height, scale, sampler, steps, seed, n_samples: nSamples, ucPreset, qualityToggle, sm: smea, sm_dyn: smeaDyn, negative_prompt: negativePrompt } };
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`NovelAI HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return { blob: await res.blob(), backend: 'nai', prompt };
}
