import { Client, Collection, GatewayIntentBits, Partials, REST, Routes } from "discord.js";
import fs from "fs";
import path from "path";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

client.commands = new Collection();

const commands = [];
const commandsPath = path.join(process.cwd(), "commands");
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"))) {
  const command = await import(`./commands/${file}`);
  client.commands.set(command.default.data.name, command.default);
  commands.push(command.default.data.toJSON());
}

const eventsPath = path.join(process.cwd(), "events");
for (const file of fs.readdirSync(eventsPath).filter(f => f.endsWith(".js"))) {
  const event = await import(`./events/${file}`);
  if (event.default.once) {
    client.once(event.default.name, (...args) => event.default.execute(...args, client));
  } else {
    client.on(event.default.name, (...args) => event.default.execute(...args, client));
  }
}

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: [] }
    );
    console.log("Commands cleared successfully.");

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("Commands registered successfully.");
  } catch (error) {
    console.error(error);
  }
})();

import interactionHandler from "./events/interactionCreate";

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith("!")) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  if (command === "close") {
    const allowedUserId = "1442913863988281465";
    if (message.author.id !== allowedUserId) return;

    const channel = message.channel;
    const ActiveTickets = await interactionHandler.execute.GetTickets();
    const TicketData = ActiveTickets[channel.id];
    if (!TicketData) return message.reply("No ticket data found for this channel.");

    const Messages = await channel.messages.fetch({ limit: 100 });
    const Html = await interactionHandler.execute.GenerateTranscriptHtml(channel.name, Messages, message.guild);
    const TranscriptUrl = await interactionHandler.execute.UploadTranscript(channel.id, Html);

    const CloseEmbed = {
      title: "Ticket Closed",
      fields: [
        { name: "Ticket", value: channel.name, inline: true },
        { name: "Closed by", value: message.author.tag, inline: true },
        { name: "Channel ID", value: channel.id, inline: true }
      ],
      color: 0xff0000,
      timestamp: new Date()
    };

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
    const TranscriptButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Transcript").setStyle(ButtonStyle.Link).setURL(TranscriptUrl)
    );

    const LogChannel = await message.guild.channels.fetch("1417526499761979412").catch(() => null);
    if (LogChannel?.isTextBased()) await LogChannel.send({ embeds: [CloseEmbed], components: [TranscriptButton] });

    try {
      const Owner = await client.users.fetch(TicketData.ownerId);
      const CreatedAt = TicketData.createdAt ? new Date(TicketData.createdAt) : new Date();
      const ClosedAt = new Date();
      const DiffDays = Math.round((ClosedAt.getTime() - CreatedAt.getTime()) / (1000*60*60*24));

      const DmEmbed = {
        title: "Ticket Closed",
        color: 0xff0000,
        fields: [
          { name: "Ticket", value: `${interactionHandler.execute.GetCategoryType(channel.parentId)} #${TicketData.ticketNumber}`, inline: false },
          { name: "Created At", value: CreatedAt.toLocaleString(), inline: true },
          { name: "Closed At", value: `${ClosedAt.toLocaleString()} (${DiffDays} day${DiffDays!==1?'s':''})`, inline: true },
          { name: "Closed By", value: message.author.tag, inline: false }
        ]
      };

      const DmButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Transcript").setStyle(ButtonStyle.Link).setURL(TranscriptUrl)
      );

      await Owner.send({ embeds: [DmEmbed], components: [DmButton] });
    } catch {}

    delete ActiveTickets[channel.id];
    await interactionHandler.execute.SaveTickets(ActiveTickets);
    setTimeout(() => channel.delete().catch(() => {}), 2000);
    return message.reply("Ticket closed, transcript saved.");
  }
});

client.login(process.env.TOKEN);
