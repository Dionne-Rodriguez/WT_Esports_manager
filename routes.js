import express from "express";
import { handleLobbyEnded, handleLobbyStarted } from "./sessionManager.js";
import {
  postLobbyStartedEmbedMessage,
  postLobbyStaleEmbedMessage,
} from "./utilities.js";

export default function registerRoutes(app, postNewScrimInterest) {
  app.use(express.json());

  app.get("/post-scrim-interest", async (req, res) => {
    try {
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
      const { roomId } = req.body;

      console.log(`Lobby event ${roomId}`);

      await handleLobbyStarted(roomId);

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
      console.log(`🔄  Handling lobby ended for roomId ${roomId}...`);
      await new Promise((res) => setTimeout(res, 2000));
      await handleLobbyEnded(roomId);
      console.log(`✅ Notified Discord about lobby ${roomId} ending.`);
      return res.status(200).json({ message: "Discord notified." });
    } catch (err) {
      console.error("Error in /lobby-ended:", err);
      return res
        .status(500)
        .json({ success: false, error: err.message || "Unknown error" });
    }
  });

  app.post("/lobby-stale", async (req, res) => {
    console.log("Lobby stale event received");
    try {
      await postLobbyStaleEmbedMessage();
      return res.status(200).json({
        success: true,
        message: "Lobby stale event received successfully.",
      });
    } catch (err) {
      console.error("Error in /lobby-stale:", err);
      return res
        .status(500)
        .json({ success: false, error: err.message || "Unknown error" });
    }
  });
}
