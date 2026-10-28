// Cliente mínimo de la API de Gemini (Google AI Studio).
// La clave se guarda solo en este dispositivo (localStorage) y se envía únicamente a Google.
'use strict';

const AI = (() => {
  const BASE = 'https://generativelanguage.googleapis.com/v1beta';
  const KEY = 'pf_gemini';
  const DEFAULTS = { key: '', textModel: 'gemini-2.5-flash', imageModel: 'gemini-2.5-flash-image' };

  function settings() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
    catch (e) { return { ...DEFAULTS }; }
  }
  function save(s) { localStorage.setItem(KEY, JSON.stringify({ ...settings(), ...s })); }
  const ready = () => Boolean(settings().key);

  async function request(path, body) {
    const s = settings();
    if (!s.key) throw new Error('Falta la clave de Gemini. Ponla en IA → Ajustes de Gemini.');
    const res = await fetch(`${BASE}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.key },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (e) { /* respuesta vacía */ }
    if (!res.ok) throw new Error((json && json.error && json.error.message) || `Error ${res.status}`);
    return json;
  }

  const generate = (model, body) => request(`models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`, body);

  const partsOf = json => ((json.candidates || [])[0] || {}).content?.parts || [];
  const textOf = json => partsOf(json).filter(p => p.text).map(p => p.text).join('\n').trim();
  function imageOf(json) {
    const p = partsOf(json).find(p => p.inlineData || p.inline_data);
    if (!p) return null;
    const d = p.inlineData || p.inline_data;
    return `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`;
  }
  function blockedReason(json) {
    const c = (json.candidates || [])[0];
    return json.promptFeedback?.blockReason || (c && c.finishReason && c.finishReason !== 'STOP' ? c.finishReason : '');
  }

  const imagePart = dataUrl => {
    const [head, data] = dataUrl.split(',');
    return { inlineData: { mimeType: head.slice(5, head.indexOf(';')), data } };
  };

  // Texto (opcionalmente con imagen). history: [{role:'user'|'model', parts:[...]}]
  async function chat(history, system) {
    const json = await generate(settings().textModel, {
      contents: history,
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    });
    const text = textOf(json);
    if (!text) throw new Error('Gemini no devolvió texto' + (blockedReason(json) ? ` (${blockedReason(json)})` : '.'));
    return text;
  }

  // Respuesta JSON con esquema.
  async function json(prompt, schema) {
    const res = await generate(settings().textModel, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
    });
    return JSON.parse(textOf(res));
  }

  // Imagen a partir de texto (y opcionalmente una imagen de entrada).
  async function image(prompt, inputDataUrl) {
    const parts = [{ text: prompt }];
    if (inputDataUrl) parts.push(imagePart(inputDataUrl));
    const res = await generate(settings().imageModel, {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    });
    const img = imageOf(res);
    if (!img) {
      const why = textOf(res) || blockedReason(res) || 'sin imagen';
      throw new Error(`Gemini no devolvió una imagen: ${why}`);
    }
    return img;
  }

  async function listModels() {
    const out = [];
    let token = '';
    do {
      const res = await request(`models?pageSize=200${token ? '&pageToken=' + encodeURIComponent(token) : ''}`);
      for (const m of res.models || [])
        if ((m.supportedGenerationMethods || []).includes('generateContent')) out.push(m.name.replace(/^models\//, ''));
      token = res.nextPageToken || '';
    } while (token);
    return out;
  }

  return { settings, save, ready, chat, json, image, imagePart, listModels };
})();
