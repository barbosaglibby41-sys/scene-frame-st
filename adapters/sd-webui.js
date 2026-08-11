export async function generateSD({ baseUrl = 'http://127.0.0.1:7860', prompt, negativePrompt = '', width = 768, height = 1024, steps = 28, cfgScale = 7, samplerName = 'Euler a', seed = -1, model }) {
  const url = `${baseUrl.replace(/\/$/, '')}/sdapi/v1/txt2img`;
  const body = { prompt, negative_prompt: negativePrompt, width, height, steps, cfg_scale: cfgScale, sampler_name: samplerName, seed };
  if (model) body.override_settings = { sd_model_checkpoint: model };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`A1111 HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  if (!data.images?.[0]) throw new Error('A1111 未返回图片');
  const raw = data.images[0].replace(/^data:image\/[^;]+;base64,/, '');
  const bin = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
  return { blob: new Blob([bin], { type: 'image/png' }), backend: 'sd', prompt, info: data.info };
}
