import moment from "moment";
import dotenv from "dotenv";
import { EmbedBuilder } from "discord.js";
import mapsByType from "./mapsByType.json" with { type: "json" };
import client from "./discordClient.js";

dotenv.config();
const testing = process.env.TESTING === "true";
const channelId = testing
  ? process.env.TEST_CHANNELID
  : process.env.SESSION_CHANNEL_ID;

export async function postLobbyStartedEmbedMessage(currentMapUrl) {
  if (!client) {
    console.error("❌ Discord client is not ready.");
    return res.status(503).json({ error: "Discord client not ready." });
  }
  const channel = await client.channels.fetch(channelId);
  const embed = new EmbedBuilder()
    .setTitle("Match Started")
    .addFields({
      name: "Map",
      value: getMapNameFromUrl(currentMapUrl),
      inline: true,
    })
    .setColor(0x00ff00) // green accent
    .setTimestamp(new Date());

  // Replace with your actual channel ID where you want to post
  if (!channel || !channel.send) {
    console.error("❌ Cannot find Discord channel:", channelId);
    throw new Error(`Discord channel ${channelId} not found.`);
  }

  await channel.send({ embeds: [embed] });
 // console.log(`✅ Notified Discord about lobby ${roomId} starting.`);
}

export async function postLobbyEndedEmbedMessage(
  nextIndex,
  totalRounds,
  sequence
) {
  if (!client) {
    console.error("❌ Discord client is not ready.");
    return res.status(503).json({ error: "Discord client not ready." });
  }
  const nextMap = () => {
    if (!(nextIndex >= sequence.length)) {
      return {
        name: "Next Map",
        value: getMapNameFromUrl(sequence[nextIndex]),
        inline: true,
      };
    }
  };

  const channel = await client.channels.fetch(channelId);
  const embed = new EmbedBuilder()
    .setTitle("Match Ended")
    .setDescription(`Completed ${nextIndex} of ${totalRounds} rounds.`)
    .setColor(0x00ff00) // green accent
    .setTimestamp(new Date());

  const mapField = nextMap();
  if(mapField) {
    embed.addFields(mapField);
  }


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

export async function postLobbyStaleEmbedMessage() {
  if (!client || !client.isReady()) {
    console.error("❌ Discord client is not ready.");
    return res.status(503).json({ error: "Discord client not ready." });
  }
  const channel = await client.channels.fetch(channelId);
  const embed = new EmbedBuilder()
    .setTitle("Lobby Stale")
    .setDescription("The lobby is inactive and will now be closed...")
    .setColor(0x00ff00);

  if (!channel || !channel.send) {
    console.error("❌ Cannot find Discord channel:", channelId);
    throw new Error(`Discord channel ${channelId} not found.`);
  }
  console.log("Lobby stale event posted to discord channel");

  await channel.send({
    embeds: [embed],
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
