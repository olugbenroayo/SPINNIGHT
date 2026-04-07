// Secure proxy — keeps Supabase service key off the client
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kswdhhulsqqhhykcievb.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { action, payload } = JSON.parse(event.body);
    let result;

    switch (action) {

      // ── Create a new room ──────────────────────────────
      case 'create_room': {
        // Generate code
        const codeRes = await sb('POST', '/rpc/generate_room_code', {});
        const code = codeRes;
        // Insert room
        const room = await sb('POST', '/rooms', {
          code,
          host_id: payload.hostId,
          total_rounds: payload.totalRounds || 15,
          status: 'lobby',
        });
        // Insert host as player
        await sb('POST', '/players', {
          room_code: code,
          player_id: payload.hostId,
          name: payload.hostName,
          avatar_color: payload.avatarColor || '#7c4dff',
          is_host: true,
        });
        result = { code, room };
        break;
      }

      // ── Join a room ────────────────────────────────────
      case 'join_room': {
        // Check room exists and is in lobby
        const rooms = await sb('GET', `/rooms?code=eq.${payload.code}&select=*`);
        const roomsArr = Array.isArray(rooms) ? rooms : [];
        if (!roomsArr.length) throw new Error('Room not found');
        if (roomsArr[0].status !== 'lobby') throw new Error('Game already started');
        // Upsert player
        await sb('POST', '/players', {
          room_code: payload.code,
          player_id: payload.playerId,
          name: payload.name,
          avatar_color: payload.avatarColor || '#ff4d8d',
          is_host: false,
        });
        result = { room: roomsArr[0] };
        break;
      }

      // ── Start game ─────────────────────────────────────
      case 'start_game': {
        await sb('PATCH', `/rooms?code=eq.${payload.code}`, { status: 'playing', current_round: 0 });
        result = { ok: true };
        break;
      }

      // ── Push next round/question to all players ────────
      case 'push_question': {
        await sb('PATCH', `/rooms?code=eq.${payload.code}`, {
          current_round: payload.round,
          current_game: payload.game,
          current_question: payload.question,
          show_results: false,
          updated_at: new Date().toISOString(),
        });
        // Clear previous answers for this round
        await sb('DELETE', `/answers?room_code=eq.${payload.code}&round_number=eq.${payload.round}`);
        result = { ok: true };
        break;
      }

      // ── Submit an answer ───────────────────────────────
      case 'submit_answer': {
        await sb('POST', '/answers', {
          room_code: payload.code,
          player_id: payload.playerId,
          player_name: payload.playerName,
          round_number: payload.round,
          answer: payload.answer,
          is_correct: payload.isCorrect || false,
        });
        result = { ok: true };
        break;
      }

      // ── Reveal results ─────────────────────────────────
      case 'reveal_results': {
        await sb('PATCH', `/rooms?code=eq.${payload.code}`, { show_results: true });
        result = { ok: true };
        break;
      }

      // ── Update scores ──────────────────────────────────
      case 'update_score': {
        await sb('PATCH', `/players?room_code=eq.${payload.code}&player_id=eq.${payload.playerId}`, {
          score: payload.score,
          lives: payload.lives,
        });
        result = { ok: true };
        break;
      }

      // ── Update lives (NHIE) ────────────────────────────
      case 'lose_life': {
        const pArr2 = await sb('GET', `/players?room_code=eq.${payload.code}&player_id=eq.${payload.playerId}&select=lives`);
        const pArr2Safe = Array.isArray(pArr2) ? pArr2 : [];
        if (pArr2Safe.length) {
          const newLives = Math.max(0, (pArr2Safe[0].lives || 3) - 1);
          await sb('PATCH', `/players?room_code=eq.${payload.code}&player_id=eq.${payload.playerId}`, { lives: newLives });
        }
        result = { ok: true };
        break;
      }

      // ── Get room state ─────────────────────────────────
      case 'get_room': {
        const r = await sb('GET', `/rooms?code=eq.${payload.code}&select=*`);
        const p = await sb('GET', `/players?room_code=eq.${payload.code}&select=*&order=score.desc`);
        const a = await sb('GET', `/answers?room_code=eq.${payload.code}&round_number=eq.${payload.round || 0}&select=*`);
        const rArr = Array.isArray(r) ? r : [];
        const pArr = Array.isArray(p) ? p : [];
        const aArr = Array.isArray(a) ? a : [];
        result = { room: rArr[0], players: pArr, answers: aArr };
        break;
      }

      // ── End game ───────────────────────────────────────
      case 'end_game': {
        await sb('PATCH', `/rooms?code=eq.${payload.code}`, { status: 'finished' });
        result = { ok: true };
        break;
      }

      // ── Player heartbeat ───────────────────────────────
      case 'heartbeat': {
        await sb('PATCH', `/players?room_code=eq.${payload.code}&player_id=eq.${payload.playerId}`, { is_online: true });
        result = { ok: true };
        break;
      }

      default:
        throw new Error('Unknown action: ' + action);
    }

    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('supabase-proxy error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// ── Supabase REST helper ───────────────────────────────────
async function sb(method, path, body) {
  const url = SUPABASE_URL + '/rest/v1' + path;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    },
  };
  if (body && Object.keys(body).length) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch (e) { return text; }
}
