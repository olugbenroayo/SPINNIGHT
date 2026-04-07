const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kswdhhulsqqhhykcievb.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { action, payload } = JSON.parse(event.body);
    let result;

    switch (action) {

      case 'create_room': {
        // Generate unique code
        let code = Math.random().toString(36).slice(2,8).toUpperCase();

        // Insert room
        const roomRes = await sb('POST', '/rooms', {
          code,
          host_id: payload.hostId,
          total_rounds: payload.totalRounds || 15,
          status: 'lobby',
        });
        console.log('Room insert response:', JSON.stringify(roomRes));

        // Insert host as player
        const playerRes = await sb('POST', '/players', {
          room_code: code,
          player_id: payload.hostId,
          name: payload.hostName,
          avatar_color: payload.avatarColor || '#7c4dff',
          is_host: true,
        });
        console.log('Player insert response:', JSON.stringify(playerRes));

        result = { code };
        break;
      }

      case 'join_room': {
        const rooms = await sb('GET', `/rooms?code=eq.${payload.code}&select=*`);
        console.log('Join - rooms response:', JSON.stringify(rooms));
        const roomsArr = Array.isArray(rooms) ? rooms : [];
        if (!roomsArr.length) throw new Error('Room not found. Code: ' + payload.code);
        if (roomsArr[0].status !== 'lobby') throw new Error('Game already started');
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

      case 'start_game': {
        await sb('PATCH', `/rooms?code=eq.${payload.code}`, { status: 'playing', current_round: 0 });
        result = { ok: true };
        break;
      }

      case 'push_question': {
        await sb('PATCH', `/rooms?code=eq.${payload.code}`, {
          current_round: payload.round,
          current_game: payload.game,
          current_question: payload.question,
          show_results: false,
          updated_at: new Date().toISOString(),
        });
        await sb('DELETE', `/answers?room_code=eq.${payload.code}&round_number=eq.${payload.round}`);
        result = { ok: true };
        break;
      }

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

      case 'reveal_results': {
        await sb('PATCH', `/rooms?code=eq.${payload.code}`, { show_results: true });
        result = { ok: true };
        break;
      }

      case 'update_score': {
        await sb('PATCH', `/players?room_code=eq.${payload.code}&player_id=eq.${payload.playerId}`, {
          score: payload.score,
          lives: payload.lives,
        });
        result = { ok: true };
        break;
      }

      case 'lose_life': {
        const pArr = await sb('GET', `/players?room_code=eq.${payload.code}&player_id=eq.${payload.playerId}&select=lives`);
        const pSafe = Array.isArray(pArr) ? pArr : [];
        if (pSafe.length) {
          const newLives = Math.max(0, (pSafe[0].lives || 3) - 1);
          await sb('PATCH', `/players?room_code=eq.${payload.code}&player_id=eq.${payload.playerId}`, { lives: newLives });
        }
        result = { ok: true };
        break;
      }

      case 'get_room': {
        const r = await sb('GET', `/rooms?code=eq.${payload.code}&select=*`);
        const p = await sb('GET', `/players?room_code=eq.${payload.code}&select=*&order=score.desc`);
        const a = await sb('GET', `/answers?room_code=eq.${payload.code}&round_number=eq.${payload.round || 0}&select=*`);
        const rArr = Array.isArray(r) ? r : [];
        const pArr2 = Array.isArray(p) ? p : [];
        const aArr = Array.isArray(a) ? a : [];
        result = { room: rArr[0], players: pArr2, answers: aArr };
        break;
      }

      case 'end_game': {
        await sb('PATCH', `/rooms?code=eq.${payload.code}`, { status: 'finished' });
        result = { ok: true };
        break;
      }

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
    console.error('supabase-proxy error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

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
  console.log(method, path, '→', res.status, text.slice(0, 200));
  try { return text ? JSON.parse(text) : {}; } catch (e) { return text; }
}
