const state = { roomId: null, playerName: null, pollId: null };

function setStatus(message, isError = false) {
  const roomStatus = document.getElementById('roomStatus');
  roomStatus.textContent = message;
  roomStatus.classList.toggle('error', isError);
}

function updateMoveButtons(room) {
  const buttons = document.querySelectorAll('[data-move]');
  const name = (state.playerName || '').trim();
  const inRoom = room && room.players && room.players.some((player) => player.name.toLowerCase() === name.toLowerCase());
  const readyToPlay = !!room && room.players.length >= 2 && room.status !== 'finished';
  const playerState = room && room.players.find((player) => player.name.toLowerCase() === name.toLowerCase());
  const alreadyPlayed = !!playerState && !!playerState.move;

  buttons.forEach((button) => {
    const enabled = !!state.roomId && !!state.playerName && inRoom && readyToPlay && !alreadyPlayed;
    button.disabled = !enabled;
    button.title = enabled ? 'Submit move' : 'Join a room and wait for both players';
  });
}

function updateRoomUI(room) {
  const badge = document.getElementById('roomBadge');
  const playersList = document.getElementById('playersList');
  const resultBox = document.getElementById('resultBox');

  if (!room) {
    badge.textContent = 'No room';
    badge.className = 'badge neutral';
    playersList.innerHTML = '';
    resultBox.classList.add('hidden');
    resultBox.textContent = '';
    updateMoveButtons(null);
    return;
  }

  badge.textContent = room.status === 'finished' ? 'Finished' : room.players.length >= 2 ? 'Ready' : 'Waiting';
  badge.className = `badge ${room.status === 'finished' ? 'finished' : room.players.length >= 2 ? 'ready' : 'waiting'}`;

  playersList.innerHTML = room.players
    .map((player) => {
      const move = player.move ? `Move: ${player.move}` : 'Waiting for move';
      const isCurrentPlayer = state.playerName && player.name.toLowerCase() === state.playerName.toLowerCase();
      return `
        <div class="player-card ${isCurrentPlayer ? 'current-player' : ''}">
          <span class="player-name">${player.name}</span>
          <span class="player-move">${move}</span>
        </div>
      `;
    })
    .join('');

  if (room.status === 'finished' && room.lastResult) {
    const winnerName = room.winner || 'Draw';
    resultBox.textContent = room.winner ? `${winnerName} wins the round!` : 'It was a draw!';
    resultBox.classList.remove('hidden');
  } else {
    resultBox.classList.add('hidden');
    resultBox.textContent = '';
  }

  updateMoveButtons(room);
}

function startPolling() {
  if (state.pollId) {
    clearInterval(state.pollId);
  }
  if (!state.roomId) return;
  state.pollId = setInterval(async () => {
    try {
      await refreshRoom();
    } catch {
      // keep polling without breaking the UI
    }
  }, 2000);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(data?.error || 'Request failed');
  }
  return data;
}

async function refreshLeaderboard() {
  const list = await api('/api/leaderboard');
  const leaderboardList = document.getElementById('leaderboardList');
  leaderboardList.innerHTML = list
    .map((entry, index) => `<li>#${index + 1} ${entry.name}: ${entry.wins}W / ${entry.losses}L / ${entry.ties}T</li>`)
    .join('');
}

async function refreshRoom() {
  if (!state.roomId) {
    updateRoomUI(null);
    return;
  }
  const room = await api(`/api/rooms/${state.roomId}?playerName=${encodeURIComponent(state.playerName || '')}`);
  updateRoomUI(room);
  const playersText = room.players.length >= 2 ? 'Both players are here. Choose your move.' : 'Waiting for another player to join.';
  if (room.status === 'finished') {
    setStatus(`Round complete: ${room.winner ? `${room.winner} wins` : 'It was a draw'}.`);
  } else {
    setStatus(playersText);
  }
}

document.getElementById('createRoom').addEventListener('click', async () => {
  const name = document.getElementById('playerName').value.trim();
  if (!name) {
    setStatus('Enter a player name first.', true);
    return;
  }
  try {
    const room = await api('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ playerName: name }),
    });
    state.roomId = room.id;
    state.playerName = name;
    document.getElementById('roomId').value = room.id;
    setStatus('Room created. Share the code with another player.');
    await refreshRoom();
    startPolling();
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.getElementById('joinRoom').addEventListener('click', async () => {
  const roomId = document.getElementById('roomId').value.trim();
  const name = document.getElementById('playerName').value.trim();
  if (!roomId || !name) {
    setStatus('Enter a room code and player name.', true);
    return;
  }
  try {
    const room = await api('/api/rooms/join', {
      method: 'POST',
      body: JSON.stringify({ roomId, playerName: name }),
    });
    state.roomId = room.id;
    state.playerName = name;
    document.getElementById('roomId').value = room.id;
    setStatus('Joined the room successfully.');
    await refreshRoom();
    startPolling();
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.getElementById('resetRoom').addEventListener('click', async () => {
  if (!state.roomId) {
    setStatus('Create or join a room first.', true);
    return;
  }
  try {
    const room = await api(`/api/rooms/${state.roomId}/reset?playerName=${encodeURIComponent(state.playerName || '')}`, { method: 'POST' });
    updateRoomUI(room);
    setStatus('New round started. Make your next move!');
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.querySelectorAll('[data-move]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (!state.roomId || !state.playerName) {
      setStatus('Create or join a room first.', true);
      return;
    }
    const move = button.getAttribute('data-move');
    try {
      const room = await api(`/api/rooms/${state.roomId}/move`, {
        method: 'POST',
        body: JSON.stringify({ playerName: state.playerName, move }),
      });
      updateRoomUI(room);
      if (room.status === 'finished') {
        setStatus(room.winner ? `${room.winner} wins the round!` : 'This round was a draw.');
      } else {
        setStatus(`${state.playerName} picked ${move}. Waiting for the other player...`);
      }
      await refreshLeaderboard();
    } catch (error) {
      setStatus(error.message, true);
    }
  });
});

updateRoomUI(null);
refreshLeaderboard();
