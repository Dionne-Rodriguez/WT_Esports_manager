import moment from "moment";
import dotenv from "dotenv";
import { EmbedBuilder } from "discord.js";

dotenv.config();
const testing = process.env.TESTING === "true";
const channelId = testing ? process.env.TEST_CHANNELID : process.env.CHANNELID;

export async function postLobbyStartedEmbedMessage(client, roomId) {
  const channel = await client.channels.fetch(channelId);
  const embed = new EmbedBuilder()
    .setTitle("Lobby Started")
    .setDescription(null)
    .addFields(
      { name: "Room ID", value: `${roomId}`, inline: true },
      {
        name: "Started At",
        value: moment.utc().format("YYYY-MM-DD hh:mm A"),
        inline: true,
      }
    )
    .setColor(0x00ff00) // green accent
    .setTimestamp(new Date());

  // Replace with your actual channel ID where you want to post
  if (!channel || !channel.send) {
    console.error("❌ Cannot find Discord channel:", channelId);
    throw new Error(`Discord channel ${channelId} not found.`);
  }

  await channel.send({ embeds: [embed] });
}
