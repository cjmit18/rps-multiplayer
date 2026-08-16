const state = { roomId: null, user: null, pollId: null, room: null, busy: new Set() };

function getElement(id) {
  return document.getElementById(id);
}

function setStatus(message, isError = false) {
  const roomStatus = getElement('roomStatus');
  if (!roomStatus) return;
  roomStatus.textContent = message;
  roomStatus.classList.toggle('error', isError);
  roomStatus.setAttribute('role', isError ? 'alert' : 'status');
  roomStatus.setAttribute('aria-live', isError ? 'assertive' : 'polite');
}

function setAuthStatus(message, isError = false) {
  const status = getElement('authStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('error', isError);
  status.setAttribute('role', isError ? 'alert' : 'status');
  status.setAttribute('aria-live', isError ? 'assertive' : 'polite');
}

function errorMessage(error) {
  return error instanceof Error && error.message ? error.message : 'Request failed. Try again.';
}

function updateAuthUI() {
  const identity = getElement('authIdentity');
  const display = getElement('authUsernameDisplay');
  const authFields = document.querySelectorAll('#authUsername, #authPassword, .auth-actions');
  const roomActions = document.querySelectorAll('#createRoom, #joinRoom, #resetRoom, [data-move]');
  if (identity) identity.classList.toggle('hidden', !state.user);
  if (display) display.textContent = state.user?.username || '';
  authFields.forEach((element) => element.classList.toggle('hidden', Boolean(state.user)));
  roomActions.forEach((element) => { element.disabled = !state.user; });
}

function updateMoveButtons(room) {
  const players = Array.isArray(room?.players) ? room.players : [];
  const playerState = players.find((player) => player.userId === state.user?.id);
  const enabled = Boolean(state.user && state.roomId && playerState && players.length >= 2 && room.status !== 'finished' && !playerState.move && !state.busy.has('move'));
  document.querySelectorAll('[data-move]').forEach((button) => {
    button.disabled = !enabled;
    button.setAttribute('aria-disabled', String(!enabled));
    button.title = enabled ? 'Submit move' : 'Sign in and join a room to play';
  });
}

function renderPlayers(room) {
  const playersList = getElement('playersList');
  if (!playersList) return;
  playersList.replaceChildren();
  (Array.isArray(room?.players) ? room.players : []).forEach((player) => {
    const card = document.createElement('div');
    card.className = `player-card ${player.userId === state.user?.id ? 'current-player' : ''}`;
    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = `${player.name || 'Unnamed player'}${player.userId === state.user?.id ? ' (you)' : ''}`;
    card.append(name);
    const move = document.createElement('span');
    move.className = 'player-move';
    move.textContent = player.move ? `Move: ${player.move}` : 'Waiting for move';
    card.append(move);
    playersList.append(card);
  });
}

function updateRoomUI(room) {
  state.room = room;
  const badge = getElement('roomBadge');
  const scoreBox = getElement('scoreBox');
  const resultBox = getElement('resultBox');
  if (!room) {
    if (badge) { badge.textContent = 'No room'; badge.className = 'badge neutral'; }
    if (getElement('playersList')) getElement('playersList').replaceChildren();
    if (scoreBox) { scoreBox.textContent = 'Best of 3: 0 - 0'; scoreBox.setAttribute('aria-label', 'Current best-of-three score: 0 - 0'); }
    if (resultBox) { resultBox.classList.add('hidden'); resultBox.textContent = ''; }
    updateMoveButtons(null);
    return;
  }
  const players = Array.isArray(room.players) ? room.players : [];
  const roomState = room.status === 'finished' ? 'finished' : players.length >= 2 ? 'ready' : 'waiting';
  if (badge) { badge.textContent = roomState === 'finished' ? 'Finished' : roomState === 'ready' ? 'Ready' : 'Waiting'; badge.className = `badge ${roomState}`; }
  const scores = room.scores || {};
  const scoreText = `${scores.playerOne || 0} - ${scores.playerTwo || 0}`;
  if (scoreBox) { scoreBox.textContent = `Best of 3: ${scoreText}`; scoreBox.setAttribute('aria-label', `Current best-of-three score: ${scoreText}`); }
  renderPlayers(room);
  if (resultBox) {
    let result = '';
    if (room.status === 'finished' && room.lastResult) result = room.winner ? `${room.winner} wins the match!` : 'It was a draw.';
    else if (room.lastResult) {
      const winner = room.lastResult.winner;
      const winnerName = winner === 'draw' ? '' : players[winner === 'player-one' ? 0 : 1]?.name;
      result = winnerName ? `${winnerName} wins the round. First to 2 wins.` : 'Round draw. First to 2 wins.';
    }
    resultBox.textContent = result;
    resultBox.classList.toggle('hidden', !result);
  }
  updateMoveButtons(room);
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

async function refreshLeaderboard() {
  const leaderboardList = getElement('leaderboardList');
  if (!leaderboardList) return;
  try {
    const list = await api('/api/leaderboard');
    leaderboardList.replaceChildren();
    (Array.isArray(list) ? list : []).forEach((entry, index) => {
      const item = document.createElement('li');
      item.textContent = `#${index + 1} ${entry.name}: ${entry.wins || 0}W / ${entry.losses || 0}L / ${entry.ties || 0}T`;
      leaderboardList.append(item);
    });
  } catch (error) {
    leaderboardList.textContent = `Leaderboard unavailable: ${errorMessage(error)}`;
  }
}

async function refreshRoom() {
  if (!state.roomId || !state.user) { updateRoomUI(null); return; }
  const room = await api(`/api/rooms/${state.roomId}`);
  updateRoomUI(room);
  if (room.status === 'finished') setStatus(`Match complete: ${room.winner ? `${room.winner} wins` : 'It was a draw'}.`);
  else setStatus(Array.isArray(room.players) && room.players.length >= 2 ? 'Both players are here. Choose your move.' : 'Waiting for another player to join.');
}

function startPolling() {
  if (state.pollId) clearInterval(state.pollId);
  if (!state.roomId || !state.user) return;
  state.pollId = setInterval(() => refreshRoom().catch(() => {}), 2000);
}

function setBusy(key, busy) {
  if (busy) state.busy.add(key); else state.busy.delete(key);
  const selectors = { create: '#createRoom', join: '#joinRoom', reset: '#resetRoom', move: '[data-move]', auth: '#loginButton, #registerButton' };
  document.querySelectorAll(selectors[key] || '').forEach((element) => { element.disabled = busy; element.setAttribute('aria-busy', String(busy)); });
  updateMoveButtons(state.room);
}

function isBusy(key) { return state.busy.has(key); }

async function loadCurrentUser() {
  const result = await api('/api/auth/me');
  state.user = result.user;
  updateAuthUI();
  setAuthStatus(state.user ? `Signed in as ${state.user.username}.` : 'Sign in or create an account to play.');
  if (state.user) setStatus('You are ready to create or join a room.');
}

async function authenticate(endpoint) {
  if (isBusy('auth')) return;
  const username = getElement('authUsername')?.value.trim() || '';
  const password = getElement('authPassword')?.value || '';
  setBusy('auth', true);
  setAuthStatus(endpoint.endsWith('register') ? 'Creating account...' : 'Signing in...');
  try {
    const result = await api(endpoint, { method: 'POST', body: JSON.stringify({ username, password }) });
    state.user = result.user;
    updateAuthUI();
    setAuthStatus(`Signed in as ${state.user.username}.`);
    setStatus('You are ready to create or join a room.');
  } catch (error) { setAuthStatus(errorMessage(error), true); }
  finally { setBusy('auth', false); }
}

getElement('loginButton')?.addEventListener('click', () => authenticate('/api/auth/login'));
getElement('registerButton')?.addEventListener('click', () => authenticate('/api/auth/register'));
getElement('logoutButton')?.addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  if (state.pollId) clearInterval(state.pollId);
  state.user = null; state.roomId = null; state.room = null;
  updateAuthUI(); updateRoomUI(null); setAuthStatus('Signed out.'); setStatus('Sign in to create or join a room.');
});

getElement('createRoom')?.addEventListener('click', async () => {
  if (isBusy('create') || !state.user) return;
  setBusy('create', true); setStatus('Creating room...');
  try {
    const room = await api('/api/rooms', { method: 'POST', body: '{}' });
    state.roomId = room.id; getElement('roomId').value = room.id; updateRoomUI(room); setStatus('Room created. Share the code with another player.'); startPolling();
  } catch (error) { setStatus(errorMessage(error), true); }
  finally { setBusy('create', false); }
});

getElement('joinRoom')?.addEventListener('click', async () => {
  if (isBusy('join') || !state.user) return;
  const roomId = getElement('roomId')?.value.trim() || '';
  if (!roomId) { setStatus('Enter a room code first.', true); return; }
  setBusy('join', true); setStatus('Joining room...');
  try {
    const room = await api('/api/rooms/join', { method: 'POST', body: JSON.stringify({ roomId }) });
    state.roomId = room.id; getElement('roomId').value = room.id; updateRoomUI(room); setStatus('Joined the room successfully.'); startPolling();
  } catch (error) { setStatus(errorMessage(error), true); }
  finally { setBusy('join', false); }
});

getElement('resetRoom')?.addEventListener('click', async () => {
  if (isBusy('reset') || !state.roomId) return;
  setBusy('reset', true); setStatus('Starting a new match...');
  try { const room = await api(`/api/rooms/${state.roomId}/reset`, { method: 'POST', body: '{}' }); updateRoomUI(room); setStatus('New match started. Make your first move!'); }
  catch (error) { setStatus(errorMessage(error), true); }
  finally { setBusy('reset', false); }
});

document.querySelectorAll('[data-move]').forEach((button) => button.addEventListener('click', async () => {
  if (isBusy('move') || !state.roomId || !state.user) return;
  const move = button.getAttribute('data-move'); if (!move) return;
  setBusy('move', true); setStatus(`Submitting ${move}...`);
  try {
    const room = await api(`/api/rooms/${state.roomId}/move`, { method: 'POST', body: JSON.stringify({ move }) });
    updateRoomUI(room);
    setStatus(room.status === 'finished' ? `${room.winner} wins the match!` : room.lastResult ? 'Round complete. Choose your next move.' : 'Move locked. Waiting for the other player...');
    await refreshLeaderboard();
  } catch (error) { setStatus(errorMessage(error), true); }
  finally { setBusy('move', false); }
}));

getElement('copyRoom')?.addEventListener('click', async () => {
  const roomId = getElement('roomId')?.value.trim() || state.roomId;
  if (!roomId) { setStatus('Create or join a room first.', true); return; }
  try { await navigator.clipboard.writeText(roomId); setStatus('Room code copied to your clipboard.'); }
  catch { setStatus(`Room code: ${roomId}`); }
});

updateAuthUI(); updateRoomUI(null); loadCurrentUser().catch(() => setAuthStatus('Sign in or create an account to play.', true)); refreshLeaderboard();
