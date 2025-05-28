import express from "express";

export default function registerRoutes(app, client, postNewScrimInterest) {
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
}
