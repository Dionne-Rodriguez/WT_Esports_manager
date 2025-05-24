import { Client, Events, GatewayIntentBits, EmbedBuilder } from "discord.js";
import moment from "moment";
import dotenv from "dotenv";
import cron from "node-cron";
import express from "express";

dotenv.config();

const app = express();
app.get("/", (req, res) => res.send("Hello World! 🌍"));
app.listen(3000, () => console.log("🌐 Keep-alive server running."));

const testing = false;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildScheduledEvents,
  ],
  partials: ["MESSAGE", "CHANNEL", "REACTION", "USER", "GUILD_MEMBER"],
});

client.on("error", (error) => {
  console.error("🚨 Client Error:", error);
});

const token = process.env.TOKEN;
const channelId = testing ? process.env.TEST_CHANNELID : process.env.CHANNELID;
const voiceChannelId = process.env.VOICECHANNELID;

let scrimPostWeek = null;
let messageId = null;
let eventCreated = {};
let createdEventIds = {};
let scheduledReminders = {};

const numberEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];
const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday"];

//set up commands
const commands = [
  new SlashCommandBuilder()
    .setName("user")
    .setDescription("Register your War Thunder ID")
    .addIntegerOption((opt) =>
      opt
        .setName("id")
        .setDescription("Your War Thunder numeric user ID")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("session")
    .setDescription("Start a custom War Thunder lobby")
    .addBooleanOption((opt) =>
      opt
        .setName("self_select")
        .setDescription("If false, team-based formation will be applied")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("mapurl")
        .setDescription("Optional map URL or a random one will be selected")
        .setRequired(false)
    ),
].map((command) => command.toJSON());
const rest = new REST({ version: "10" }).setToken(token);

(async () => {
  try {
    console.log("⏳ Registering slash commands...");
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ), // or Routes.applicationCommands(clientId) for global
      { body: commands }
    );
    console.log("✅ Slash commands registered!");
  } catch (error) {
    console.error("❌ Failed to register commands:", error);
  }
})();

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  scrimPostWeek = moment.utc().isoWeek();
  const currentWeek = moment.utc().isoWeek();

  if (scrimPostWeek !== currentWeek) {
    console.log("🛡 Missed post this week — posting now...");
    await postNewScrimInterest();
  }
  const existingMessageId = "";
  const channel = await client.channels.fetch(channelId);
  const oldMessage = await channel.messages.fetch(existingMessageId);
  const loadExistingMessage = false;
  if (oldMessage && existingMessageId) {
    messageId = oldMessage.id;
    console.log(`📌 Loaded existing scrim message ID: ${messageId}`);
  }
  if (testing) {
    console.log("Testing mode: posting scrim interest check once.");
    await postNewScrimInterest();
  } else if (!loadExistingMessage) {
    let hasPosted = false;

    cron.schedule("0 12 * * 6", async () => {
      if (!hasPosted) {
        await postNewScrimInterest();
        hasPosted = true;
      }
    });
  }
});

async function postNewScrimInterest() {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      console.error("❌ Invalid or non-text channel.");
      return;
    }

    for (const emoji of numberEmojis) {
      eventCreated[emoji] = false;
      createdEventIds[emoji] = null;
      scheduledReminders[emoji] = null;
    }
    messageId = null;

    const now = moment.utc();
    scrimPostWeek = now.isoWeek();
    const timestamp18UTC = now.clone().set({ hour: 18, minute: 0 }).unix();

    const embed = new EmbedBuilder()
      .setTitle("In-house Scrims Interest Check 📝")
      .setDescription(
        `Weekly in-house scrims at <t:${timestamp18UTC}:t> (**18:00 UTC**).\n` +
          `React to the number for the day you're available!\nSession happens if 8 or more react.\n\n` +
          `1️⃣ Monday\n2️⃣ Tuesday\n3️⃣ Wednesday\n4️⃣ Thursday`
      )
      .setColor(0x00ff00);

    const message = await channel.send({ embeds: [embed] });
    messageId = message.id;
    console.log("🔗 Watching for reactions on message ID:", messageId);

    for (const emoji of numberEmojis) {
      await message.react(emoji);
    }
  } catch (error) {
    console.error("Failed to post scrim check:", error);
  }
}

client.on("messageReactionAdd", async (reaction, user) => {
  console.log(`🧪 Detected a reaction from ${user.tag}`);
  if (reaction.partial) await reaction.fetch();
  if (user.partial) await user.fetch();
  if (user.bot) return;
  if (!reaction.message.guild || reaction.message.id !== messageId) return;
  if (!numberEmojis.includes(reaction.emoji.name)) return;

  try {
    const fetchedReaction = await reaction.message.reactions.cache
      .get(reaction.emoji.name)
      ?.fetch();

    const users = await fetchedReaction.users.fetch();
    const nonBotUsers = Array.from(users.values()).filter((u) => !u.bot);
    const count = nonBotUsers.length;

    console.log(`🔎 ${reaction.emoji.name} has ${count} non-bot reactions.`);

    const emoji = reaction.emoji.name;
    const emojiIndex = numberEmojis.indexOf(emoji);
    const reactionThreshold = testing ? 2 : 8;

    if (count >= reactionThreshold && !eventCreated[emoji]) {
      eventCreated[emoji] = true;

      const dayName = dayNames[emojiIndex];
      const guild = reaction.message.guild;
      const channel = await client.channels.fetch(channelId);

      const memberFetches = await Promise.all(
        nonBotUsers.map(async (u) => {
          try {
            const member = await guild.members.fetch(u.id);
            return { user: u, member };
          } catch {
            return null;
          }
        })
      );

      const TEAM_IDS = {
        "A-Team": "1234123978692628551",
        "B-Team": "1290618045747695708",
        "C-Team": "1290617974855827497",
      };

      const MAIN_SUFFIX = "-Main";
      const teams = { "A-Team": [], "B-Team": [], "C-Team": [], Mixed: [] };

      for (const entry of memberFetches) {
        if (!entry) continue;
        const { user, member } = entry;
        const roleNames = member.roles.cache.map((r) => r.name);

        const main = roleNames.find((r) => r.endsWith(MAIN_SUFFIX));
        if (main) {
          const baseTeam = main.replace(MAIN_SUFFIX, "");
          if (teams[baseTeam]) {
            teams[baseTeam].push(user);
            continue;
          }
        }

        const found = Object.keys(TEAM_IDS).find((t) => roleNames.includes(t));
        if (found) {
          teams[found].push(user);
        } else {
          teams.Mixed.push(user);
        }
      }
      const eligibleTeams = Object.entries(teams).filter(([team, users]) =>
        team !== "Mixed" && users.length >= testing ? 1 : 4
      );

      let team1 = null;
      let team2 = null;

      if (eligibleTeams.length >= 2) {
        [team1, team2] = eligibleTeams.slice(0, 2);
      } else if (
        eligibleTeams.length === 1 && nonBotUsers.length >= testing ? 2 : 8
      ) {
        team1 = eligibleTeams[0];
        const mixedPool = nonBotUsers.filter(
          (u) => !team1[1].some((m) => m.id === u.id)
        );
        team2 = ["Mixed", mixedPool];
      }

      if (
        team1 && team2 && team1[1].length >= testing
          ? 1
          : 4 && team2[1].length >= testing
          ? 1
          : 4
      ) {
        const name1 = team1[0];
        const name2 = team2[0];
        const mentions1 = team1[1].map((u) => `<@${u.id}>`).join(", ");
        const mentions2 = team2[1].map((u) => `<@${u.id}>`).join(", ");

        const today = moment.utc();
        const targetDay = emojiIndex + 1;
        const currentDay = today.isoWeekday();
        let daysToAdd = targetDay - currentDay;
        if (daysToAdd < 0) daysToAdd += 7;
        const eventMoment = today
          .clone()
          .add(daysToAdd, "days")
          .set({ hour: 18, minute: 0 });

        const createdEvent = await guild.scheduledEvents.create({
          name: `4v4 Jetstrike Scrims - ${dayName}`,
          scheduledStartTime: eventMoment.toDate(),
          privacyLevel: 2,
          entityType: 2,
          channel: voiceChannelId,
          description: `Weekly in-house scrims happening on ${dayName} at **18:00 UTC**!\n\n🕐 **Duration:** 1 Hour\n🎯 **Min players:** ${reactionThreshold}`,
        });

        createdEventIds[emoji] = createdEvent.id;

        await channel.send(
          `✅ **Scrim confirmed for ${dayName} at 18:00 UTC!**\n\n` +
            `🟥 **Team 1 (${name1})**:\n${mentions1}\n\n` +
            `🟦 **Team 2 (${name2})**:\n${mentions2}`
        );

        const reminderMoment = eventMoment.clone().subtract(30, "minutes");
        const timeUntilReminder = reminderMoment.diff(moment.utc());

        if (timeUntilReminder > 0) {
          scheduledReminders[emoji] = setTimeout(async () => {
            const updatedReaction = await reaction.message.reactions.cache
              .get(emoji)
              ?.fetch();
            const users = await updatedReaction.users.fetch();
            const validUsers = Array.from(users.values()).filter((u) => !u.bot);
            const mentions = validUsers.map((u) => `<@${u.id}>`).join(", ");

            await channel.send(
              `⏰ **Reminder!** Scrim for **${dayName}** starts in 30 minutes!\n${mentions}`
            );
          }, timeUntilReminder);
        }
      } else {
        console.log("❌ Not enough for 2 valid teams yet.");
      }
    }
  } catch (error) {
    console.error("❌ Failed on reaction add:", error);
  }
});

client.on("messageReactionRemove", async (reaction, user) => {
  console.log(`🧪 Detected an unreaction from ${user.tag}`);
  if (reaction.partial) await reaction.fetch();
  if (user.partial) await user.fetch();
  if (user.bot) return;
  if (!reaction.message.guild || reaction.message.id !== messageId) return;
  if (!numberEmojis.includes(reaction.emoji.name)) return;

  try {
    const fetchedReaction = await reaction.message.reactions.cache
      .get(reaction.emoji.name)
      ?.fetch();
    const users = await fetchedReaction.users.fetch();
    const nonBotUsers = Array.from(users.values()).filter((u) => !u.bot);
    const count = nonBotUsers.length;

    const emoji = reaction.emoji.name;
    const emojiIndex = numberEmojis.indexOf(emoji);
    const dayName = dayNames[emojiIndex];
    const threshold = testing ? 2 : 8;

    console.log(
      `🔎 ${reaction.emoji.name} has ${count} non-bot reactions after removal.`
    );
    if (count < threshold && eventCreated[emoji]) {
      const guild = reaction.message.guild;
      const channel = await client.channels.fetch(channelId);

      if (createdEventIds[emoji]) {
        await guild.scheduledEvents.delete(createdEventIds[emoji]);
        createdEventIds[emoji] = null;
        eventCreated[emoji] = false;

        if (scheduledReminders[emoji]) {
          clearTimeout(scheduledReminders[emoji]);
          scheduledReminders[emoji] = null;
        }

        await channel.send(
          `❌ **Scrim for ${dayName} canceled. Not enough players.**
` +
            `${
              threshold - count
            } player(s) required to recreate event. If interested, react to original post.`
        );
      }
    }
  } catch (error) {
    console.error("❌ Failed on reaction removal:", error);
  }
});

client.login(token);
