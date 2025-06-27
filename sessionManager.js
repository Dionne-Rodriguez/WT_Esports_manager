// sessionManager.js

import {
  createCustomLobby,
  closeLobby,
  updateLobby,
} from "./WTEsportsClient.js";
import mapsByType from "./mapsByType.json" with { type: "json" };
import {
  postLobbyEndedEmbedMessage,
  postLobbyStartedEmbedMessage,
} from "./utilities.js";

/**
 * Active multi-round sessions:
 *  key = lobbyId of the *current* lobby,
 *  value = {
 *    players,
 *    teamA,
 *    teamB,
 *    selfSelectTeam,
 *    sequence,     // full list of map URLs to play
 *    nextIndex,    // index into sequence for the next round
 *    totalRounds,  // sequence.length
 *  }
 */
const activeSessions = new Map();
let lobbyId = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start a new multi-round session.
 *
 * @param {Object} options
 * @param {string} options.mapOption          // either a single URL or "<type>-All"
 * @param {Array<Object>} options.teamA
 * @param {Array<Object>} options.teamB
 * @param {Array<Object>} options.players
 * @param {boolean} options.selfSelectTeam
 * @param {number} options.roundsPerMap       // how many times each map should be played
 *
 * @returns {Promise<string>}  Resolves to the first lobbyId
 */
export async function createSession({
  mapOption,
  teamA,
  teamB,
  players,
  selfSelectTeam,
  roundsPerMap = 1,
}) {
  if (roundsPerMap < 1) {
    throw new Error("roundsPerMap must be at least 1");
  }

  // Build the full sequence of map URLs:
  let sequence;
  const allMatch = /^(\d+)-All$/.exec(mapOption);
  if (allMatch) {
    const typeKey = allMatch[1];
    const entries = mapsByType[typeKey] || [];
    const allMapsList = entries
      .filter((e) => e.value !== mapOption)
      .map((e) => e.value);
    if (!allMapsList.length) {
      throw new Error(`No maps found for type ${typeKey}`);
    }
    // repeat each map in the list roundsPerMap times
    sequence = allMapsList.flatMap((url) => Array(roundsPerMap).fill(url));
  } else {
    // single map, repeated roundsPerMap times
    sequence = Array(roundsPerMap).fill(mapOption);
  }

  // Create the first lobby with sequence[0]
  console.log(`▶️ Creating round 1 of ${sequence.length}…`);
  const payload = makePayload(
    sequence[0],
    teamA,
    teamB,
    players,
    selfSelectTeam
  );

  const response = await createCustomLobby(payload);
  lobbyId = response.roomId;
  const offlineInvites = response.offlineInvites || [];
  if (typeof lobbyId === "number") lobbyId = lobbyId.toString();

  activeSessions.set(lobbyId, {
    players,
    teamA,
    teamB,
    selfSelectTeam,
    sequence,
    nextIndex: 1, // next round uses sequence[1]
    totalRounds: sequence.length,
  });

  console.log(
    `✅  Lobby created (ID = ${lobbyId}). Waiting for backend callback…`
  );
  return { lobbyId, offlineInvites };
}

/**
 * Handle a lobby-ended callback from your backend.
 *
 * @param {string|number} endedLobbyId
 */
export async function handleLobbyEnded(endedLobbyId) {
  if (typeof endedLobbyId === "number") {
    endedLobbyId = endedLobbyId.toString();
  }
  const session = activeSessions.get(endedLobbyId);
  if (!session) {
    console.warn(
      `Received “lobby ended” callback for unknown lobbyId=${endedLobbyId}. Ignoring.`
    );
    return;
  }

  const {
    players,
    teamA,
    teamB,
    selfSelectTeam,
    sequence,
    nextIndex,
    totalRounds,
  } = session;

  console.log(
    `🏁  Lobby ${endedLobbyId} ended. Completed ${nextIndex} of ${totalRounds}`
  );

  //send a message to the Discord channel with the lobby ended info
  await postLobbyEndedEmbedMessage(nextIndex, totalRounds, sequence);

  // If we've played all maps in the sequence, clean up
  if (nextIndex >= sequence.length) {
    activeSessions.delete(endedLobbyId);
    const destroyedResp = await closeLobby();
    if (destroyedResp.status !== "Lobby destroyed") {
      throw new Error(
        `Failed to destroy lobby ${endedLobbyId}: ${destroyedResp.status}`
      );
    }
    console.log(`✅  Session complete (all ${totalRounds} rounds done).`);
    return;
  }

  // Otherwise, play the next map
  const nextMapUrl = sequence[nextIndex];
  console.log(
    `🔄  Creating round ${
      nextIndex + 1
    } of ${totalRounds} with map ${nextMapUrl}`
  );

  try {
    // destroy the old lobby first
    // const destroyedResp = await closeLobby();
    // if (destroyedResp.status !== "Lobby destroyed") {
    //   throw new Error(
    //     `Failed to destroy lobby ${endedLobbyId}: ${destroyedResp.status}`
    //   );
    // }

    // const response = await createCustomLobby(
    //   makePayload(nextMapUrl, teamA, teamB, players, selfSelectTeam)
    // );
    // let newLobbyId = response.roomId;
    // if (typeof newLobbyId === "number") newLobbyId = newLobbyId.toString();

    // Replace the session under the new lobbyId
    // activeSessions.delete(endedLobbyId);
    await updateLobby({ missionURL: nextMapUrl });
    // TODO: update the lobby instead of making a new one

    activeSessions.set(lobbyId, {
      players,
      teamA,
      teamB,
      selfSelectTeam,
      sequence,
      nextIndex: nextIndex + 1,
      totalRounds,
    });

    console.log(
      `✅  Created lobby for next round (ID = ${lobbyId}). Waiting for callback…`
    );
  } catch (err) {
    console.error(
      `❌  Failed to create next round for lobby ${endedLobbyId} ended:`,
      err
    );
    activeSessions.delete(endedLobbyId);
    console.log(`❌  Session aborted; state cleared for ${endedLobbyId}.`);
    await closeLobby();
  }
}

export async function handleLobbyStarted(lobbyId) {
  if (typeof lobbyId === "number") {
    lobbyId = lobbyId.toString();
  }

  const session = activeSessions.get(lobbyId);
  if (!session) {
    console.warn(
      `Received “lobby started callback for unknown lobbyId=${lobbyId}. Ignoring.`
    );
    return;
  }

  let { sequence, nextIndex } = session;

  if (nextIndex === 1) {
    nextIndex = 0; // first round starts at index 0
  }

  await postLobbyStartedEmbedMessage(sequence[nextIndex]);
}

// ------------------------------------------------------------------
// Helper: build the payload to send to your backend.
function makePayload(mapUrl, teamA, teamB, players, selfSelectTeam) {
  const base = { mapUrl, teamA, teamB, players };
  if (selfSelectTeam) {
    return { ...base, MinReadyTotal: players.length };
  } else {
    return { ...base, MinReadyPerTeam: Math.floor(players.length / 2) };
  }
}
