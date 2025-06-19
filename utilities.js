import moment from "moment";
import dotenv from "dotenv";
import { EmbedBuilder } from "discord.js";
import mapsByType from "./mapsByType.json" assert { type: "json" };

dotenv.config();
const testing = process.env.TESTING === "true";
const channelId = testing
  ? process.env.TEST_CHANNELID
  : process.env.SESSION_CHANNEL_ID;

export async function postLobbyStartedEmbedMessage(client, roomId) {
  const channel = await client.channels.fetch(channelId);
  const embed = new EmbedBuilder()
    .setTitle("Lobby Started")
    .setDescription(null)
    .addFields(
      // { name: "Room ID", value: `${roomId}`, inline: true },
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

export async function postJoinedSessionEmbedMessage(
  client,
  user,
  participants,
  MIN_PLAYERS
) {
  const channel = await client.channels.fetch(channelId);
  const embed = new EmbedBuilder()
    .setDescription(
      `✅ <@${user.id}> has joined the session! (${participants.size}/${MIN_PLAYERS})`
    )
    .setColor(0x00ff00);

  if (!channel || !channel.send) {
    console.error("❌ Cannot find Discord channel:", channelId);
    throw new Error(`Discord channel ${channelId} not found.`);
  }
  console.log("user joined session id", user);

  await channel.send({
    embeds: [embed],
    allowedMentions: { users: ["user"] },
  });
}

export function getMapNameFromUrl(mapUrl) {
  for (const group of Object.values(mapsByType)) {
    const match = group.find((m) => m.value === mapUrl);
    if (match) return match.name;
  }
  return "Custom Map"; // fallback
}

export function createDiscordPlayerPings(players) {
  return players.map((p) => `<@${p.id}>`).join(", ");
}
