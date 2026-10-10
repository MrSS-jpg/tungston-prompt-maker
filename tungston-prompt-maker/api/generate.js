const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
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

  const body = req.body || {};
  const idea = typeof body.idea === 'string' ? body.idea.trim() : '';
  const target = ['text', 'code', 'image'].includes(body.target) ? body.target : 'text';
  const byokKey = typeof body.byok_key === 'string' ? body.byok_key.trim() : '';
  const byokProvider = typeof body.byok_provider === 'string' ? body.byok_provider.trim().toLowerCase() : 'groq';

  if (idea.length < 5) {
    return res.status(400).json({ error: 'Describe your idea in at least a few words.' });
  }
  if (idea.length > 4000) {
    return res.status(400).json({ error: 'Idea is too long. Keep it under 4000 characters.' });
  }

  let apiKey = byokKey || process.env.GROQ_API_KEY;
  let endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  let modelsToTry = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'];
  let extraHeaders = {};

  if (byokKey) {
    if (byokProvider === 'openrouter') {
      endpoint = 'https://openrouter.ai/api/v1/chat/completions';
      modelsToTry = [body.byok_model || 'meta-llama/llama-3.1-8b-instruct:free', 'google/gemini-2.0-flash-001'];
      extraHeaders = { 'HTTP-Referer': 'https://tungston-prompt-maker.vercel.app', 'X-Title': 'Tungston Prompt Maker' };
    } else if (byokProvider === 'nara') {
      endpoint = 'https://router.bynara.id/v1/chat/completions';
      modelsToTry = [body.byok_model || 'agnes-2.5-flash'];
    } else {
      // Groq BYOK
      endpoint = 'https://api.groq.com/openai/v1/chat/completions';
      if (body.byok_model) modelsToTry = [body.byok_model, ...modelsToTry];
    }
  } else if (process.env.GROQ_MODEL) {
    modelsToTry = [process.env.GROQ_MODEL, ...modelsToTry];
  }

  if (!apiKey) {
    return res.status(429).json({
      error: 'Server Groq API key is not configured or depleted. Please use BYOK (Bring Your Own Key).',
      quota_exceeded: true
    });
  }

  const targetNotes = {
    text: 'TARGET: General-purpose AI text assistant (chat, writing, research, analysis, strategy).',
    code: 'TARGET: Elite software engineer & coding assistant (architecture, syntax, edge cases, tests, clean code).',
    image: 'TARGET: AI Image Generator (Midjourney, DALL-E, Stable Diffusion). Describe camera, lighting, composition, style, color palette, and textures visually.'
  };

  const system = [
    'You are an elite Prompt Architect and Prompt Engineering specialist.',
    'Your mission is to transform a raw, informal user concept into a comprehensive, high-precision, production-grade prompt designed to elicit peak performance from advanced AI models.',
    targetNotes[target],
    '',
    'CRITICAL GUIDELINES FOR THE ENGINE:',
    '1. Break down the user prompt into crystal-clear sections:',
    '   - ## ROLE & PERSONA: Define the exact expertise, tone, and authority level.',
    '   - ## OBJECTIVE: State the primary goal with zero ambiguity.',
    '   - ## CONTEXT: Provide operational background, scenario framing, and assumptions.',
    '   - ## STEP-BY-STEP INSTRUCTIONS: Provide an ordered workflow for the AI to execute.',
    '   - ## CONSTRAINTS & NEGATIVES: Explicitly state what to avoid (no clichés, no generic fluff, no unsubstantiated assumptions).',
    '   - ## OUTPUT SPECIFICATION: Define the exact structure, headers, format, or length.',
    '2. Second-Person Perspective: Write the prompt addressing the AI ("You will act as...", "Your task is to...").',
    '3. Do NOT make up facts the user never implied. If context is missing, include instructions telling the AI to ask clarifying questions or explicitly state assumptions.',
    '4. OUTPUT ONLY THE CRAFTED PROMPT. Do not include introductory remarks ("Here is your prompt:"), no trailing remarks, and no outer code block fences around the entire prompt.'
  ].join('\n');

  let activeData = null;
  let activeModel = modelsToTry[0];
  let lastError = null;

  for (const m of modelsToTry) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
          ...extraHeaders
        },
        body: JSON.stringify({
          model: m,
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

      if (upstream.ok) {
        activeData = await upstream.json();
        activeModel = m;
        break;
      }

      const errText = await upstream.text().catch(() => '');

      // Check if model not found or decommissioned
      const isModelError =
        upstream.status === 404 ||
        (upstream.status === 400 && (
          errText.includes('model_decommissioned') ||
          errText.includes('decommissioned') ||
          errText.includes('model_not_found') ||
          errText.includes('does not exist') ||
          errText.includes('no longer supported')
        ));

      if (isModelError) {
        continue;
      }

      if (upstream.status === 429 || upstream.status === 402 || upstream.status === 401) {
        return res.status(upstream.status).json({
          error: 'Rate limit or quota reached on ' + (byokKey ? byokProvider : 'server Groq') + '. Switch to BYOK or verify your key.',
          quota_exceeded: !byokKey,
          upstream_status: upstream.status,
          upstream_msg: errText.slice(0, 300)
        });
      }

      lastError = { status: upstream.status, msg: errText.slice(0, 300) };
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        return res.status(504).json({ error: 'Request timed out waiting for AI response.' });
      }
      lastError = { status: 500, msg: err.message };
    }
  }

  if (!activeData) {
    return res.status(lastError?.status || 502).json({
      error: 'Upstream provider error (' + (lastError?.status || 502) + '). Try again shortly or verify your key.',
      upstream_msg: lastError?.msg || 'Could not connect to model'
    });
  }

  const prompt = activeData?.choices?.[0]?.message?.content?.trim();
  if (!prompt) {
    return res.status(502).json({ error: 'The AI returned an empty response. Try again.' });
  }

  return res.status(200).json({ prompt, model_used: activeModel, provider_used: byokKey ? byokProvider : 'groq' });
};