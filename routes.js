import express from "express";
import moment from "moment";
import { EmbedBuilder } from "discord.js";
import { handleLobbyEnded } from "./sessionManager.js";
import { postLobbyStartedEmbedMessage } from "./utilities.js";

export default function registerRoutes(
  app,
  client,
  postNewScrimInterest,
  channelId
) {
  app.use(express.json());

  app.get("/post-scrim-interest", async (req, res) => {
    try {
      if (!client || !client.isReady()) {
        console.error("❌ Client is not ready.");
        return res.status(503).send("Client is not ready.");
      }
      await postNewScrimInterest();
      console.log(
        "✅ Scrim interest posted successfully via api url:",
        req.originalUrl
      );
      res.status(200).send("Scrim interest posted successfully.");
    } catch (error) {
      console.error("Failed to post scrim interest:", error);
      res.status(500).send("Failed to post scrim interest.");
    }
  });

  app.post("/lobby-started", async (req, res) => {
    try {
      if (!client || !client.isReady()) {
        console.error("❌ Discord client is not ready.");
        return res.status(503).json({ error: "Discord client not ready." });
      }
      const { roomId } = req.body;

      console.log(`Lobby event ${roomId}`);

      await postLobbyStartedEmbedMessage(client, roomId);

      console.log(`✅ Notified Discord about lobby ${roomId} starting.`);

      return res.status(200).json({ message: "Discord notified." });
    } catch (err) {
      console.error("Error in POST /lobbyStarted:", err);
      return res.status(500).json({ error: err.message });
    }
  });

  app.post("/lobby-ended", express.json(), async (req, res) => {
    try {
      const { roomId } = req.body;
      if (!roomId) {
        return res
          .status(400)
          .json({ success: false, error: "Missing lobbyId in request body" });
      }

      // const { roomId } = req.data;
      // if (typeof roomId !== "number") {
      //   console.error("❌ Invalid payload to /lobbyStarted:", req.body);
      //   return res.status(400).json({ error: "Invalid JSON payload." });
      // }

      console.log(`Lobby ended event ${roomId}`);

      const embed = new EmbedBuilder()
        .setTitle("Lobby Ended")
        .addFields(
          { name: "Room ID", value: `${roomId}`, inline: true },
          {
            name: "Ended At",
            value: moment.utc().format("YYYY-MM-DD hh:mm A"),
            inline: true,
          }
        )
        .setColor(0x00ff00) // green accent
        .setTimestamp(new Date());

      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.send) {
        console.error("❌ Cannot find Discord channel:", channelId);
        return res.status(500).json({ error: "Discord channel not found." });
      }

      await channel.send({ embeds: [embed] });
      console.log(`✅ Notified Discord about lobby ${roomId} ending.`);

      console.log(`🔄  Handling lobby ended for roomId ${roomId}...`);
      await new Promise((res) => setTimeout(res, 5000));
      await handleLobbyEnded(roomId);

      return res.status(200).json({ message: "Discord notified." });
    } catch (err) {
      console.error("Error in /lobby-ended:", err);
      return res
        .status(500)
        .json({ success: false, error: err.message || "Unknown error" });
    }
  });

  app.post("/lobby-stale", express.json(), async (req, res) => {
    try {
      const { roomId } = req.body;
      if (!roomId) {
        return res
          .status(400)
          .json({ success: false, error: "Missing lobbyId in request body" });
      }

      // const { roomId } = req.data;
      // if (typeof roomId !== "number") {
      //   console.error("❌ Invalid payload to /lobbyStarted:", req.body);
      //   return res.status(400).json({ error: "Invalid JSON payload." });
      // }

      console.log(`Lobby closed for ${roomId}`);

      const embed = new EmbedBuilder()
        .setTitle("Lobby Closed")
        .addFields(
          { name: "Room ID", value: `${roomId}`, inline: true },
          {
            name: "Closed At",
            value: moment.utc().format("YYYY-MM-DD hh:mm A"),
            inline: true,
          }
        )
        .setColor(0x00ff00) // green accent
        .setTimestamp(new Date());

      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.send) {
        console.error("❌ Cannot find Discord channel:", channelId);
        return res.status(500).json({ error: "Discord channel not found." });
      }

      await channel.send({ embeds: [embed] });
      console.log(`✅ Notified Discord about lobby ${roomId} closing.`);

      return res.status(200).json({ message: "Discord notified." });
    } catch (err) {
      console.error("Error in /lobby-stale:", err);
      return res
        .status(500)
        .json({ success: false, error: err.message || "Unknown error" });
    }
  });
}
