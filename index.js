import { Client, Collection, GatewayIntentBits, Partials, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import fs from "fs";
import path from "path";
import interactionHandler from "./events/interactionCreate.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

client.commands = new Collection();

const commandsPath = path.join(process.cwd(), "commands");
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"))) {
  const commandModule = await import(`./commands/${file}`);
  const command = commandModule.default;
  client.commands.set(command.data.name, command);
}

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [] });
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: Array.from(client.commands.values()).map(c => c.data.toJSON()) }
    );
    console.log("Commands registered successfully.");
  } catch (err) { console.error(err); }
})();

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.content.startsWith("!")) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  if (cmd === "close") {
    const allowedUserId = "1442913863988281465";
    if (message.author.id !== allowedUserId) return;

    const ActiveTickets = await interactionHandler.GetTickets();
    const TicketData = ActiveTickets[message.channel.id];
    if (!TicketData) return message.reply("No ticket data found for this channel.");

    const Messages = await message.channel.messages.fetch({ limit: 100 });
    const Html = await interactionHandler.GenerateTranscriptHtml(message.channel.name, Messages, message.guild);
    const TranscriptUrl = await interactionHandler.UploadTranscript(message.channel.id, Html);

    const CloseEmbed = {
      title: "Ticket Closed",
      fields: [
        { name: "Ticket", value: message.channel.name, inline: true },
        { name: "Closed by", value: message.author.tag, inline: true },
        { name: "Channel ID", value: message.channel.id, inline: true }
      ],
      color: 0xff0000,
      timestamp: new Date()
    };

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
          { name: "Ticket", value: `${interactionHandler.GetCategoryType(message.channel.parentId)} #${TicketData.ticketNumber}`, inline: false },
          { name: "Created At", value: CreatedAt.toLocaleString(), inline: true },
          { name: "Closed At", value: `${ClosedAt.toLocaleString()} (${DiffDays} day${DiffDays !== 1 ? 's' : ''})`, inline: true },
          { name: "Closed By", value: message.author.tag, inline: false }
        ]
      };

      const DmButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Transcript").setStyle(ButtonStyle.Link).setURL(TranscriptUrl)
      );

      await Owner.send({ embeds: [DmEmbed], components: [DmButton] });
    } catch {}

    delete ActiveTickets[message.channel.id];
    await interactionHandler.SaveTickets(ActiveTickets);
    setTimeout(() => message.channel.delete().catch(() => {}), 2000);
    return message.reply("Ticket closed, transcript saved.");
  }
});

client.login(process.env.TOKEN);
