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
import registerRoutes from "./routes.js";
import { createSession } from "./sessionManager.js";
import mapsByType from "./mapsByType.json" assert { type: "json" };
import {
  postJoinedSessionEmbedMessage,
  getMapNameFromUrl,
} from "./utilities.js";

// Now you can use mapsByType exactly the same way:

dotenv.config();

const app = express();
app.get("/", (req, res) => res.send("Hello World! 🌍"));
app.listen(3000, () => console.log("🌐 Keep-alive server running."));

const testing = process.env.TESTING === "true";

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
const sessionChannelId = testing
  ? process.env.TEST_CHANNELID
  : process.env.SESSION_CHANNEL_ID;

let messageId = null;
let eventCreated = {};
let createdEventIds = {};
let scheduledReminders = {};
let scheduledStartChecks = {};

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
        .setDescription(
          "If false, bot will auto‐assign teams; if true, teams are up to players"
        )
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("rounds_per_map")
        .setDescription("Number of rounds played on each selected map")
        .setRequired(true)
        .addChoices(
          { name: "1", value: 1 },
          { name: "2", value: 2 },
          { name: "3", value: 3 },
          { name: "4", value: 4 },
          { name: "5", value: 5 }
        )
    )
    .addIntegerOption((opt) =>
      opt
        .setName("match_type")
        .setDescription("match type")
        .setRequired(true)
        .addChoices(
          { name: "1v1 Joust", value: 1 },
          { name: "2v2", value: 2 },
          { name: "4v4", value: 4 },
          { name: "6v6", value: 6 }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName("map_option")
        .setDescription("Select a map for your chosen match type")
        .setRequired(true)
        .setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show usage instructions for the bot"),
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
  registerRoutes(app, client, postNewScrimInterest, sessionChannelId);

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

async function startReadyCheck(
  channel,
  players,
  selfSelectTeam,
  mapOption,
  roundsPerMap,
  playersPerTeam,
  team1,
  team2
) {
  let teamA_warIds = [];
  let teamB_warIds = [];
  const embed = new EmbedBuilder()
    .setTitle("Online Check in 📝")
    .setDescription(
      `All players confirmed for a session.\n\n` +
        `React with 👍 when you are ** online and logged into War Thunder. **\n\n` +
        `** We need all ${players.length} players to react in order for invites to be sent out. **`
    )
    .setColor(0x00ff00);
  const message = await channel.send({ embeds: [embed] });

  await message.react("👍");

  const readyCollector = message.createReactionCollector({
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
      if (!selfSelectTeam) {
        teamA_warIds = warIds.slice(0, playersPerTeam);
        teamB_warIds = warIds.slice(playersPerTeam, playersPerTeam * 2);

        let mentionsA = playerArray
          .filter((p) => teamA_warIds.includes(p.warId))
          .map((p) => `<@${p.id}>`)
          .join(", ");
        let mentionsB = playerArray
          .filter((p) => teamB_warIds.includes(p.warId))
          .map((p) => `<@${p.id}>`)
          .join(", ");

        console.log("team1:", team1);
        console.log("team2:", team2);

        if (team1 && team2) {
          teamA_warIds = team1.team1[0];
          teamB_warIds = team2.team2[0];
          mentionsA = team1.mentions1;
          mentionsB = team2.mentions2;
        }

        await channel.send(
          `Teams randomly created\n\n` +
            `(Rounds per map ${roundsPerMap}):\n\n` +
            `🟥 **Team A** (${teamA_warIds.length} players):\n${mentionsA}\n\n` +
            `🟦 **Team B** (${teamB_warIds.length} players):\n${mentionsB}\n\n`
        );
      }
      const inviteFields = players.map((p) => {
        if (!p.id || !p.warId) {
          console.warn("Bad player object:", p);
        }
        return { name: "🥷", value: `<@${p.id}>` };
      });

      console.log("inviteFields:", inviteFields);

      const embed = new EmbedBuilder()
        .setTitle("Creating Session...")
        .setDescription(`Sending invites to`)
        .addFields(...inviteFields)
        .setColor(0x00ff00);
      const message = await channel.send({
        embeds: [embed],
        allowedMentions: { parse: ["users"] },
      });
      console.log(
        mapOption,
        teamA_warIds,
        teamB_warIds,
        roundsPerMap,
        players.map((p) => p.warId.toString()),
        selfSelectTeam
      );
      const res = await createSession({
        mapOption,
        teamA: teamA_warIds,
        teamB: teamB_warIds,
        players: players.map((p) => p.warId.toString()),
        selfSelectTeam,
        roundsPerMap,
      });
      const offline = res.offlineInvites.length > 0;
      const mapName = getMapNameFromUrl(mapOption);
      if (res.lobbyId) {
        const embed = new EmbedBuilder()
          .setTitle("Session Created")
          .setDescription(
            `** Map: ** ${mapName}\n` +
              `** Rounds per map: ** ${roundsPerMap}\n` +
              `** Players: ** ${players.length}`
          )
          .setFields(
            players.map((p) => ({
              name: `${offline ? "Offline ❌" : "Invited ✅"}`,
              value: `<@${p.id}>`,
            }))
          )
          .setColor(0x00ff00);
        await channel.send({
          embeds: [embed],
          allowedMentions: { parse: ["users"] },
        });
      }
    }
  });
}

async function setupSessionCollector(
  announceMessage,
  mapOption,
  selfSelectTeam,
  playersPerTeam,
  roundsPerMap
) {
  const MIN_PLAYERS = playersPerTeam * 2; // Minimum players required for a session
  const participants = new Map();

  const filter = (reaction, user) => !user.bot && reaction.emoji.name === "👍";

  const collector = announceMessage.createReactionCollector({ filter });

  collector.on("collect", async (reaction, user) => {
    const member = await announceMessage.guild.members.fetch(user.id);
    const idRole = member.roles.cache.find((r) => r.name.startsWith("id-"));
    const channel = announceMessage.channel;

    if (!idRole) {
      try {
        await reaction.users.remove(user.id);
      } catch {}
      const embed = new EmbedBuilder()
        .setTitle("⚠️ War Thunder ID Required")
        .setDescription(
          `${user}, you need to register your War Thunder ID to join lobbies.\n\n` +
            `1. Visit [Gaijin Profile](https://store.gaijin.net/user.php)\n` +
            `2. Copy your numeric ID\n` +
            `3. Use the command: \`/user id <your_id>\` to register`
        )
        .setColor(0xffcc00); // Yellow warning color

      await announceMessage.channel.send({
        embeds: [embed],
        allowedMentions: { parse: ["users"] },
      });

      // await announceMessage.channel.send({
      //   content: `${user}, please register your War Thunder ID via \`/user id <your_id>\` first.`,
      // });
      return;
    }

    const warId = parseInt(idRole.name.slice(3), 10);
    participants.set(user.id, warId);

    await postJoinedSessionEmbedMessage(
      client,
      user,
      participants,
      MIN_PLAYERS
    );

    // channel.send(
    //   `✅ ${user} has joined the session! (${participants.size}/${MIN_PLAYERS})`
    // );

    console.log("eval", participants.size >= (testing ? 2 : MIN_PLAYERS));
    console.log(typeof participants.size, participants.size);
    if (participants.size >= (testing ? 2 : MIN_PLAYERS)) {
      console.log(
        `🔔 Enough players joined: ${participants.size}/${MIN_PLAYERS}`
      );
      collector.stop("enough-players");
    }
  });

  collector.on("end", async (_collected, reason) => {
    const channel = announceMessage.channel;
    // if (participants.size < MIN_PLAYERS) {
    //   return announceMessage.reply(
    //     "Not enough players joined the lobby in time."
    //   );
    // }

    const playerArray = Array.from(participants.entries()).map(
      ([id, warId]) => ({ id, warId })
    );
    const warIds = playerArray.map((p) => p.warId);

    if (selfSelectTeam) {
      // ── CASE A: self‐select = true ──
      // await channel.send(
      //   `All ${playerArray.length} players joined session queue. Teams will be self‐selected.\n` +
      //     `calling startReadyCheck()`
      // );

      await startReadyCheck(
        channel,
        playerArray,
        selfSelectTeam,
        mapOption,
        roundsPerMap,
        playersPerTeam
      );
    } else {
      // ── CASE B: self‐select = false ──
      // Auto‐assign teams of size = playersPerTeam:
      console.log(warIds);
      console.log();
      const teamA_warIds = warIds.slice(0, playersPerTeam);
      const teamB_warIds = warIds.slice(playersPerTeam, playersPerTeam * 2);

      const mentionsA = playerArray
        .filter((p) => teamA_warIds.includes(p.warId))
        .map((p) => `<@${p.id}>`)
        .join(", ");
      const mentionsB = playerArray
        .filter((p) => teamB_warIds.includes(p.warId))
        .map((p) => `<@${p.id}>`)
        .join(", ");

      await channel.send(
        `✅ Teams formed (Rounds per map ${roundsPerMap}):\n\n` +
          `🟥 **Team A** (${teamA_warIds.length} players):\n${mentionsA}\n\n` +
          `🟦 **Team B** (${teamB_warIds.length} players):\n${mentionsB}\n\n` +
          `Launching lobby now...`
      );

      await createSession({
        mapOption,
        teamA: teamA_warIds,
        teamB: teamB_warIds,
        players: playerArray.map((p) => p.warId.toString()),
        selfSelectTeam: false,
        roundsPerMap,
      });
    }
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

    const emoji = reaction.emoji.name;
    const emojiIndex = numberEmojis.indexOf(emoji);
    const reactionThreshold = testing ? 1 : 8;

    console.log(`🔎 ${dayNames[emojiIndex]} has ${count} reaction(s).`);

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

      console.log("eligibleTeams:", eligibleTeams.length);
      console.log("users:", nonBotUsers.length);

      let team1 = null;
      let team2 = null;

      if (eligibleTeams.length >= 2) {
        [team1, team2] = eligibleTeams.slice(0, 2);
      }
      if (
        eligibleTeams.length === 1 &&
        nonBotUsers.length >= (testing ? 2 : 8)
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

        const { createdEvent, eventMoment } = await createEvent(
          emojiIndex,
          guild,
          dayName,
          reactionThreshold
        );

        createdEventIds[emoji] = createdEvent.id;

        const embed = new EmbedBuilder()
          .setTitle("Scrim confirmed for ${dayName} at 18:00 UTC!")
          .setDescription(
            `🟥 **Team 1 (${name1})**:\n${mentions1}\n\n` +
              `🟦 **Team 2 (${name2})**:\n${mentions2}`
          )
          .setColor(0x00ff00);

        await channel.send({ embeds: [embed] });

        await scheduleReminder(eventMoment, emoji, reaction, channel, dayName);

        const timeUntilStart = eventMoment.diff(moment.utc());

        if (timeUntilStart > 0) {
          const timeoutHandle = setTimeout(async () => {
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
            if (eventCreated[emoji]) {
              await startReadyCheck(
                channel,
                warThunderPlayers,
                false,
                "4-All",
                3,
                4,
                { team1: { team1, mentions1 } },
                { team2: { team2, mentions2 } }
              );
            }
          }, timeUntilStart);
          scheduledStartChecks[emoji] = timeoutHandle;
        }
      } else if (
        eligibleTeams.length === 0 &&
        nonBotUsers.length >= (testing ? 1 : 8)
      ) {
        const mentionableUsers = nonBotUsers
          .map((u) => `<@${u.id}>`)
          .join(", ");
        console.log("No eligible teams found.");
        const { createdEvent, eventMoment } = await createEvent(
          emojiIndex,
          guild,
          dayName,
          reactionThreshold
        );

        createdEventIds[emoji] = createdEvent.id;

        const embed = new EmbedBuilder()
          .setTitle(`Scrim confirmed for ${dayName} at 18:00 UTC!`)
          .setDescription(` ** Mixed Team Session: ** \n ${mentionableUsers}\n`)
          .setColor(0x00ff00);

        await channel.send({ embeds: [embed] });

        await scheduleReminder(eventMoment, emoji, reaction, channel, dayName);

        const timeUntilStart = eventMoment.diff(moment.utc());

        if (timeUntilStart > 0) {
          const timeoutHandle = setTimeout(async () => {
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

            if (eventCreated[emoji]) {
              await startReadyCheck(
                channel,
                warThunderPlayers,
                true,
                "4-All",
                3,
                4
              );
            }
          }, timeUntilStart);
          scheduledStartChecks[emoji] = timeoutHandle;
        }
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
    const threshold = testing ? 1 : 8;

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

        if (scheduledStartChecks[emoji]) {
          clearTimeout(scheduledStartChecks[emoji]);
          scheduledStartChecks[emoji] = null;
        }

        const embed = new EmbedBuilder()
          .setTitle(`❌ **Scrim for ${dayName} canceled. Not enough players.**`)
          .setDescription(
            `${
              threshold - count
            } player(s) required to recreate event. If interested, react to original post.`
          )
          .setColor("Red");
        await channel.send({ embeds: [embed] });
      }
    }
  } catch (error) {
    console.error("❌ Failed on reaction removal:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  // ① If Discord is asking for autocomplete results…
  if (interaction.isAutocomplete() && interaction.commandName === "session") {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "map_option") {
      // partial text user typed (lowercase)
      const input = focused.value.toLowerCase();

      // what did they pick for match_type so far? Default to 4 if missing
      const mode = interaction.options.getInteger("match_type") ?? 4;
      const allMaps = mapsByType[mode] || [];

      // filter by name match; return up to 25 suggestions
      const choices = allMaps
        .filter((m) => m.name.toLowerCase().includes(input))
        .slice(0, 25)
        .map((m) => ({ name: m.name, value: m.value }));

      return interaction.respond(choices);
    }
  }

  if (!interaction.isCommand()) return;
  if (interaction.commandName === "user") {
    const warThunderId = interaction.options.getInteger("id");
    if (!warThunderId) {
      await interaction.reply({
        content:
          "Please provide a valid War Thunder user ID. You can get this by going on https://store.gaijin.net/user.php and copying your id.",
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
    const mapOption =
      interaction.options.getString("map_option") || "Default map";
    const selfSelect = interaction.options.getBoolean("self_select"); // true or false
    const roundsPerMap = interaction.options.getInteger("rounds_per_map");
    const playersPerTeam = interaction.options.getInteger("match_type");

    console.log(
      `Creating session with mapOption: ${mapOption}, selfSelect: ${selfSelect}, roundsPerMap: ${roundsPerMap}, playersPerTeam: ${playersPerTeam}`
    );

    await interaction.deferReply();

    const mapName = getMapNameFromUrl(mapOption);

    const embed = new EmbedBuilder()
      .setTitle("War Thunder Session")
      .addFields(
        { name: "🗺️ Map", value: mapName },
        {
          name: "🎮 Players self-select teams",
          value: selfSelect ? "Yes" : "No",
        },
        {
          name: "🔁 Rounds per map",
          value: `${roundsPerMap}`,
        },
        {
          name: "⚔️ Match type",
          value: `${playersPerTeam}v${playersPerTeam}`,
        },
        {
          name: "✅ How to Join",
          value: `React with 👍 to join this session queue! (Min required: ${
            playersPerTeam * 2
          })`,
        }
      )
      .setColor(0x00ff00)
      .setTimestamp();

    const announce = await interaction.editReply({
      embeds: [embed],
      fetchReply: true,
      allowedMentions: { parse: ["users"] },
    });

    await announce.react("👍");

    // Pass all three flags (mapOption, selfSelect, playersPerTeam, roundsPerMap) into setupSessionCollector
    await setupSessionCollector(
      announce,
      mapOption,
      selfSelect,
      playersPerTeam,
      roundsPerMap
    );
  }
  if (interaction.commandName === "help") {
    const embed = new EmbedBuilder()
      .setTitle("🤖 WT Esports Bot Help")
      .setColor(0x3498db)
      .setDescription(
        "This bot supports two key features for organizing War Thunder scrims:"
      )
      .addFields(
        {
          name: "📅 Weekly Scrim Schedule",
          value:
            "Every Saturday at **12:00 UTC**, an interest check is posted in <#1365763729161195611> for the upcoming week.\n" +
            "React with the number emoji for the days you're available (Mon–Thurs). If 8+ players react, a match is scheduled.",
        },
        {
          name: "⚔️ /session Command",
          value:
            "Use this command at any time to create a spontaneous custom match session.\n" +
            "Players react with 👍 to join. 1v1, 2v2, 4v4, 6v6 are options along with other parameters to make a War Thunder custom session.",
        },
        {
          name: "⚠️ Important Notes",
          value:
            "- Only **one session** can run at a time.\n" +
            "- You **must register your War Thunder ID** with `/user id <your_id>` beforehand.\n" +
            "- Dedicated channel to use the sesssion command is <#1384608279975428156>",
        }
      )
      .setFooter({
        text: "Developed by Team Mythical Esports",
      });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

client.login(token);

async function scheduleReminder(
  eventMoment,
  emoji,
  reaction,
  channel,
  dayName
) {
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
}

async function createEvent(emojiIndex, guild, dayName, reactionThreshold) {
  let eventMoment;

  if (testing) {
    // In testing mode, schedule the event for now + 5 minutes
    eventMoment = moment.utc().add(30, "seconds");
  } else {
    // Existing behavior: find next occurrence of weekday (1=Monday…4=Thursday) at 18:00 UTC
    const today = moment.utc();
    const targetDay = emojiIndex + 1; // Monday=1, Tuesday=2, etc.
    const currentDay = today.isoWeekday();
    let daysToAdd = targetDay - currentDay;
    if (daysToAdd < 0) daysToAdd += 7;

    eventMoment = today
      .clone()
      .add(daysToAdd, "days")
      .set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
  }

  const createdEvent = await guild.scheduledEvents.create({
    name: testing
      ? `🔧 (Testing) Scrim starts shortly!`
      : `4v4 Jetstrike Scrims – ${dayName}`,
    scheduledStartTime: eventMoment.toDate(),
    privacyLevel: 2, // GUILD_ONLY
    entityType: 2, // VOICE
    channel: voiceChannelId,
    description: testing
      ? `This is a test event scheduled for ${eventMoment.format(
          "YYYY-MM-DD HH:mm"
        )} UTC.`
      : `Weekly in-house scrims happening on ${dayName} at **18:00 UTC**!\n\n🕐 **Duration:** 1 Hour\n🎯 **Min players:** ${reactionThreshold}`,
  });

  return { createdEvent, eventMoment };
}
