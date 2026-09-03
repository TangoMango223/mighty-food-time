/**
 * decisionEngine.js
 * -----------------
 * Takes the player profile (deterministic traits from gameSession.js) and
 * produces a restaurant recommendation.
 *
 * Uses the OpenAI **Responses API** (client.responses.create), not Chat
 * Completions — it's where OpenAI puts new capability, and it supports the
 * function-calling loop below natively.
 *
 * Grounding: a custom function tool, `find_real_restaurants`, backed by
 * googlePlaces.js — a plain HTTP call to the Google Places API, not MCP.
 * (An MCP-based version pointed at Uber Eats / DoorDash's official servers
 * was tried first; both turned out to be closed to non-partner clients — see
 * README. Places API needs only an API key, no OAuth login, and carries none
 * of the bot-detection/account-ban risk a browser-automation approach would.)
 *
 * No fallbacks, no invented data. This requires both OPENAI_API_KEY and
 * GOOGLE_MAPS_API_KEY — if either is missing, or the lookup can't find real
 * restaurants nearby, streamRecommendation() throws and the client shows a
 * game-over screen instead of a recommendation. Every restaurant returned is
 * real. Places doesn't expose per-menu-item data, so there's nothing real to
 * ground a dish in — this engine only recommends restaurants, never dishes.
 *
 * The async patterns to notice:
 *
 * 1. STREAMING. The response is an async iterable of typed EVENTS (not raw
 *    text chunks like Chat Completions). We care about
 *    `response.output_text.delta`, and we forward each delta the instant it
 *    lands. Function-call events give us free "the model is searching..." UI.
 *
 * 2. CALLBACK INJECTION. This module has never heard of WebSockets. It calls
 *    `onToken(text)`. server.js decides that means "push a WS frame". That's
 *    why the same engine works in the headless test unchanged.
 *
 * 3. AGENTIC LOOP. Unlike the MCP tool (which OpenAI's infrastructure
 *    executes server-side), a custom function tool is executed by US. When
 *    the model wants to call `find_real_restaurants`, the stream ends with a
 *    pending function call, we run the actual Google Places lookup, and send
 *    the result back as a new turn (`previous_response_id` + a
 *    `function_call_output`) so the model can keep generating with it.
 */

import { findRestaurants } from './googlePlaces.js';

const PERSONA = `You are the announcer for a chaotic WarioWare-style microgame show.
Your job: judge how the player performed and sentence them to a restaurant for tonight.
Voice: fast, punchy, gleefully unhinged, affectionate roasting. Never mean-spirited.
Keep every line short. No emoji spam (one or two max).`;

const TOOL_ADDENDUM = `You have a tool, find_real_restaurants, that returns up to 3 real
nearby restaurants for a cuisine or food type. Call it FIRST, before writing anything.
Write REASON_1, REASON_2, REASON_3 in the SAME ORDER the tool returned the
restaurants — those slots refer to specific real places, so don't reorder or
rename them, just explain why each one fits.`;

const OUTPUT_CONTRACT = `Reply in EXACTLY this format, one field per line, nothing else:

VERDICT: <one savage-but-fond line about how they played>
REASON_1: <one silly sentence tying restaurant #1 to their performance>
REASON_2: <one silly sentence tying restaurant #2 to their performance>
REASON_3: <one silly sentence tying restaurant #3 to their performance>
DARE: <a one-line "YOLO mode" dare about going, not tied to any specific dish>

Plain text only. No markdown: no headers, no bold/italics, no bullet points,
no code blocks. Just the five "LABEL: value" lines above and nothing else —
no preamble, no closing remarks. Never mention or invent a specific dish.`;

const INSTRUCTIONS = `${PERSONA}\n\n${TOOL_ADDENDUM}\n\n${OUTPUT_CONTRACT}`;

function buildUserPrompt(profile) {
  const lines = [
    `Score: ${profile.score}/${profile.total} microgames won.`,
    `Overall vibe: ${profile.vibe}.`,
    'Traits observed:',
    ...profile.traits.map((t) => `- ${t}`),
    '',
    `Deliver to: ${process.env.USER_LOCATION || 'Toronto, ON'}`,
  ];
  return lines.join('\n');
}

/** Parse the LABEL: value contract into a flat { LABEL: value } map. */
function parseFields(text) {
  const fields = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(VERDICT|REASON_1|REASON_2|REASON_3|DARE)\s*:\s*(.*)$/i);
    if (m) fields[m[1].toUpperCase()] = m[2].trim();
  }
  return fields;
}

/**
 * Turn the model's raw text + the real restaurants the tool found into the
 * final { verdict, dare, restaurants } shape the client renders. Every
 * restaurant here came from Google Places — nothing invented.
 */
export function parseVerdict(text, groundedRestaurants) {
  const fields = parseFields(text);
  const verdict = fields.VERDICT || text.trim().slice(0, 240);
  const dare = fields.DARE || '';

  const restaurants = groundedRestaurants.map((r, i) => ({
    name: r.name,
    address: r.address,
    rating: r.rating,
    mapsUri: r.mapsUri,
    photoUrl: r.photoName ? `/api/place-photo?name=${encodeURIComponent(r.photoName)}` : null,
    reason: fields[`REASON_${i + 1}`] || '',
  }));

  return { verdict, dare, restaurants, raw: text };
}

const TOOLS = [
  {
    type: 'function',
    name: 'find_real_restaurants',
    description:
      'Search Google Maps for up to 3 real nearby restaurants matching a cuisine or food type. ' +
      "Returns each restaurant's name, address, and rating, in ranked order.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Cuisine or food type to search for, e.g. "Korean" or "fried chicken"',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

/**
 * @param {object} profile   from GameSession.buildProfile()
 * @param {(chunk: string) => void} onToken  called for every piece of text as it arrives
 * @returns {Promise<{verdict, dare, restaurants: Array<{name,address,rating,mapsUri,photoUrl,reason}>, raw, source}>}
 * @throws if either API key is missing, or no real restaurants could be found —
 *   there is no fallback path, the caller should show a game-over state.
 */
export async function streamRecommendation(profile, onToken) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini';

  if (!apiKey || apiKey.startsWith('sk-your-key')) {
    throw new Error('OPENAI_API_KEY is not set. Add a real key to .env — there is no offline mode.');
  }
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY is not set. Add it to .env — this game only recommends real restaurants.');
  }

  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey });

  // Runs one turn (create + consume the stream). Returns the response id
  // (needed to chain the next turn) and any function calls the model made
  // that still need executing — the SDK gives us the arguments incrementally
  // via `response.function_call_arguments.delta`, so we buffer per call_id
  // and only trust the `.done` event's full string.
  async function runTurn(request) {
    const stream = await client.responses.create(request);
    let text = '';
    let responseId = null;
    const calls = new Map(); // item_id -> { call_id, name, arguments }

    for await (const event of stream) {
      switch (event.type) {
        case 'response.output_text.delta':
          text += event.delta;
          onToken(event.delta);
          break;

        case 'response.output_item.added':
          if (event.item?.type === 'function_call') {
            calls.set(event.item.id, { call_id: event.item.call_id, name: event.item.name, arguments: '' });
            onToken('\n[checking real restaurants nearby…]\n');
          }
          break;

        case 'response.function_call_arguments.done':
          if (calls.has(event.item_id)) calls.get(event.item_id).arguments = event.arguments;
          break;

        case 'response.completed':
          responseId = event.response.id;
          break;

        case 'response.failed':
          throw new Error(event.response?.error?.message || 'Response failed');
      }
    }
    return { id: responseId, text, calls: [...calls.values()] };
  }

  // Populated by executeCall once the tool runs — kept outside so the final
  // parse can zip the model's per-slot reasons back onto the real places.
  let groundedRestaurants = null;

  async function executeCall(call) {
    try {
      const { query } = JSON.parse(call.arguments);
      const results = await findRestaurants(query, process.env.USER_LOCATION || 'Toronto, ON', 3);
      if (!results.length) return { error: 'No matching restaurants found nearby.' };
      groundedRestaurants = results;
      // Only hand the model what it needs to reason about — photo/maps data
      // stays server-side and gets re-attached after parsing.
      return results.map(({ name, address, rating }) => ({ name, address, rating }));
    } catch (err) {
      // Tag it so the outer catch doesn't mislabel a Places failure as an
      // OpenAI failure — no swallowing into a fake tool result either.
      err.isPlacesError = true;
      throw err;
    }
  }

  let acc = '';
  try {
    let turn = await runTurn({
      model,
      stream: true,
      instructions: INSTRUCTIONS,
      input: buildUserPrompt(profile),
      tools: TOOLS,
    });
    acc += turn.text;

    // The model can only call our function tool, and only via this loop —
    // cap it so a misbehaving model can't spin forever.
    let hops = 2;
    while (turn.calls.length && hops-- > 0) {
      const outputs = await Promise.all(
        turn.calls.map(async (call) => ({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(await executeCall(call)),
        }))
      );
      turn = await runTurn({
        model,
        stream: true,
        previous_response_id: turn.id,
        instructions: INSTRUCTIONS,
        input: outputs,
        tools: TOOLS,
      });
      acc += turn.text;
    }
  } catch (err) {
    if (err.isPlacesError) throw err;

    // Distinguish "can't reach OpenAI" from "bad model ID" — they look
    // identical from the UI otherwise, and the fix is completely different.
    const isNetwork = /connection error|fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|socket hang up/i
      .test(err.message);
    throw new Error(
      isNetwork
        ? `Couldn't reach the OpenAI API (${err.message}). Check your connection — ` +
          `note that sandboxed/VM environments often block api.openai.com by allowlist.`
        : `OpenAI call failed for model "${model}": ${err.message}. ` +
          `Try setting OPENAI_MODEL in .env (e.g. gpt-5.4-mini, gpt-5.4-nano, gpt-4o-mini).`
    );
  }

  if (!groundedRestaurants?.length) {
    throw new Error(
      'Could not find any real restaurants nearby. Try a different USER_LOCATION in .env, ' +
        'or check that "Places API (New)" is enabled for your Google Maps API key.'
    );
  }

  return { ...parseVerdict(acc, groundedRestaurants), source: model };
}
