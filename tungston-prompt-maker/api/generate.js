const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 15;
const hits = new Map();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : req.socket?.remoteAddress) || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (arr.length >= RATE_LIMIT_MAX) {
    hits.set(ip, arr);
    return false;
  }
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 2000) {
    for (const [k, v] of hits.entries()) {
      const filtered = v.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (filtered.length) hits.set(k, filtered);
      else hits.delete(k);
    }
  }
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const ip = clientIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute and try again.' });
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Server configuration error: GROQ_API_KEY is missing.' });
  }

  const body = req.body || {};
  const idea = typeof body.idea === 'string' ? body.idea.trim() : '';
  const target = ['text', 'code', 'image'].includes(body.target) ? body.target : 'text';

  if (idea.length < 5) {
    return res.status(400).json({ error: 'Describe your idea in at least a few words.' });
  }
  if (idea.length > 4000) {
    return res.status(400).json({ error: 'Idea is too long. Keep it under 4000 characters.' });
  }

  const targetNotes = {
    text: 'The prompt is for a general-purpose text AI model (chat, writing, analysis, research).',
    code: 'The prompt is for an AI coding assistant. Specify language, inputs, outputs, edge cases, and code-quality expectations.',
    image: 'The prompt is for an AI image generator. Describe subject, style, composition, lighting, colors, and aspect ratio in concrete visual terms.'
  };

  const system = [
    'You turn rough ideas into sharp, structured prompts that another AI model will run.',
    targetNotes[target],
    'Write the prompt in the second person addressed to the AI model.',
    'Use these labeled sections when they apply: ROLE, TASK, CONTEXT, REQUIREMENTS, OUTPUT FORMAT.',
    'Keep every section concrete. Do not invent facts the user did not give. If a detail is missing, add a short line telling the model to ask or to state its assumption.',
    'Return only the finished prompt. No preface, no explanation, no markdown code fences.'
  ].join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.5,
        max_tokens: 2500,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: idea }
        ]
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : 502;
      const message = upstream.status === 429
        ? 'Rate limit hit. Wait a moment and try again.'
        : 'Upstream AI provider error (' + upstream.status + '). Try again shortly.';
      return res.status(status).json({ error: message });
    }

    const data = await upstream.json();
    const prompt = data?.choices?.[0]?.message?.content?.trim();

    if (!prompt) {
      return res.status(502).json({ error: 'The AI returned an empty response. Try again.' });
    }

    return res.status(200).json({ prompt });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Request timed out waiting for AI response.' });
    }
    return res.status(500).json({ error: 'Request failed. Please try again.' });
  }
};