import {
  Client,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import moment from "moment";
import dotenv from "dotenv";
import cron from "node-cron";
import express from "express";

dotenv.config();

const app = express();
app.get("/", (req, res) => res.send("Hello World! 🌍"));
app.listen(3000, () => console.log("🌐 Keep-alive server running."));

const testing = false; // Set to false for production

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildScheduledEvents,
  ],
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

  if (testing) {
    console.log("Testing mode: posting scrim interest check once.");
    await postNewScrimInterest();
  } else {
    cron.schedule("0 12 * * 6", async () => {
      console.log("⏰ Scheduled task triggered.");
      await postNewScrimInterest();
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

    for (const emoji of numberEmojis) {
      await message.react(emoji);
    }
  } catch (error) {
    console.error("Failed to post scrim check:", error);
  }
}

async function startReadyCheck(channel, players, mapUrl, selfSelectTeam) {
  const readyMsg = await channel.send(
    `✅ All players confirmed for a scrim!
**Ready Check**: React with 👍 when you are online and logged into War Thunder.
We need all ${players.length} players to react in order for invites to be sent out.`
  );

  await readyMsg.react("👍");

  const readyCollector = readyMsg.createReactionCollector({
    filter: (reaction, user) => {
      return (
        reaction.emoji.name === "👍" &&
        !user.bot &&
        players.some((p) => p.id === user.id)
      );
    },
  });

  const reacted = new Set();

  readyCollector.on("collect", (reaction, user) => {
    reacted.add(user.id);
    console.log(`${user.tag} is ready (${reacted.size}/${players.length})`);

    if (reacted.size === players.length) {
      readyCollector.stop("all-ready");
    }
  });

  readyCollector.on("end", async (collected, reason) => {
    if (reason === "all-ready") {
      await channel.send(
        "All players are ready and online. Sending invites and launching lobby..."
      );
      await createCustomLobby(
        mapUrl,
        new Map(players.map((p) => [p.id, p.warId])),
        channel
      );
    }
  });
}

const MIN_PLAYERS = testing ? 2 : 8;

function setupSessionCollector(announceMessage, mapUrl, selfSelectTeam) {
  const participants = new Map();

  const filter = (reaction, user) => {
    return !user.bot && reaction.emoji.name === "👍";
  };

  const collector = announceMessage.createReactionCollector({
    filter,
  });

  collector.on("collect", async (reaction, user) => {
    const member = await announceMessage.guild.members.fetch(user.id);
    const idRole = member.roles.cache.find((r) => r.name.startsWith("id-"));

    if (!idRole) {
      try {
        await reaction.users.remove(user.id);
      } catch {}
      await announceMessage.channel.send({
        content: `${user}, your War Thunder ID role is missing. Please use \`/user id <your_id>\` to register before joining.`,
      });
      return;
    }

    const warId = parseInt(idRole.name.slice(3));
    participants.set(user.id, warId);
    console.log(
      `✅ ${user.tag} joined session (${participants.size}/${MIN_PLAYERS})`
    );

    if (participants.size >= MIN_PLAYERS) {
      collector.stop("enough-players");
    }
  });

  collector.on("end", async (_collected, reason) => {
    if (participants.size < MIN_PLAYERS) {
      await announceMessage.reply(
        "❌ Not enough players joined the lobby in time."
      );
      return;
    }

    const channel = announceMessage.channel;
    const playerArray = Array.from(participants.entries()).map(
      ([id, warId]) => ({ id, warId })
    );
    await startReadyCheck(channel, playerArray, mapUrl, selfSelectTeam);
  });
}

client.on("messageReactionAdd", async (reaction, user) => {
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
    const reactionThreshold = testing ? 3 : 8;

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
      const eligibleTeams = Object.entries(teams).filter(
        ([team, users]) => team !== "Mixed" && users.length >= 4
      );

      let team1 = null;
      let team2 = null;

      if (eligibleTeams.length >= 2) {
        [team1, team2] = eligibleTeams.slice(0, 2);
      } else if (
        eligibleTeams.length === 1 && nonBotUsers.length >= testing ? 3 : 8
      ) {
        team1 = eligibleTeams[0];
        const mixedPool = nonBotUsers.filter(
          (u) => !team1[1].some((m) => m.id === u.id)
        );
        team2 = ["Mixed", mixedPool];
      }

      if (team1 && team2 && team1[1].length >= 4 && team2[1].length >= 4) {
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

        const timeUntilStart = eventMoment.diff(moment.utc());
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

        if (timeUntilStart > 0) {
          setTimeout(async () => {
            const warThunderPlayers = [];

            for (const user of nonBotUsers) {
              const member = await guild.members.fetch(user.id);
              const idRole = member.roles.cache.find((r) =>
                r.name.startsWith("id-")
              );
              if (idRole) {
                const warId = parseInt(idRole.name.slice(3));
                warThunderPlayers.push({ id: user.id, warId });
              }
            }

            await startReadyCheck(
              channel,
              warThunderPlayers,
              "(default map or TBD)"
            );
          }, timeUntilStart);
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
    const threshold = testing ? 3 : 8;

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

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;
  if (interaction.commandName === "user") {
    const warThunderId = interaction.options.getInteger("id");
    if (!warThunderId) {
      await interaction.reply({
        content: "Please provide a valid War Thunder user ID.",
        ephemeral: true,
      });
      return;
    }
    const roleName = `id-${warThunderId}`;
    const guild = interaction.guild;
    let role = guild.roles.cache.find((r) => r.name === roleName);
    if (!role) {
      // Create role if it doesn't exist
      role = await guild.roles.create({
        name: roleName,
        mentionable: false, // ID roles need not be mentionable by everyone
        reason: `Role for War Thunder ID ${warThunderId}`,
      });
    }
    // Assign role to the user
    await interaction.member.roles.add(role); // use roles.add to assign:contentReference[oaicite:0]{index=0}
    await interaction.reply({
      content: `Your War Thunder ID **${warThunderId}** has been registered!`,
      ephemeral: true,
    });
  }
  if (interaction.commandName === "session") {
    const mapUrl = interaction.options.getString("mapurl") || "Default map";
    const selfSelect = interaction.options.getBoolean("self_select"); // true or false

    console.log(
      `Session command received. Map URL: ${mapUrl}, Self-select: ${selfSelect}`
    );
    const announce = await interaction.reply({
      content: `**Custom War Thunder Lobby Announcement**\nMap: ${mapUrl}\nPlayers self select team: ${selfSelect}\nReact with 👍 to join the lobby! (Need at least 8 players)`,
      fetchReply: true,
    });

    await announce.react("👍");

    setupSessionCollector(announce, mapUrl, selfSelect);
  }
});

client.login(token);
