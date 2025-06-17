import axios from "axios";

export async function createCustomLobby(payload) {
  console.log("payload", payload);
  try {
    const response = await axios.post(
      `${process.env.THUNDER_API_URL}/api/custom/create`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    console.log("response", response.data);
    return response.data.status;
  } catch (error) {
    console.error("Error creating custom lobby:", error.code, error.message);
    throw error;
  }
}

async function invitePlayer(playerId) {}

async function getLobbyInfo() {}

export async function updateLobby(payload) {
  console.log("payload", payload);
  try {
    const response = await axios.post(
      `${process.env.THUNDER_API_URL}/api/custom/update`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    console.log("response", response.data);
    return response.data.status;
  } catch (error) {
    console.error("Error editing custom lobby:", error.code, error.message);
    throw error;
  }
}

export async function closeLobby() {
  console.log("Closing custom lobby now...");
  try {
    const response = await axios.post(
      `${process.env.THUNDER_API_URL}/api/custom/destroy`
    );
    console.log("response", response.data);
    console.log("response status", response.status);
    return response.data;
  } catch (error) {
    console.error("Error closing custom lobby:", error.code, error.message);
    throw error;
  }
}
