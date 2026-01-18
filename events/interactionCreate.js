// events/interactionCreate.js
import { ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const JsonBinUrl = `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}`;

const R2 = new S3Client({
  endpoint: `https://${process.env.R2AccountId}.r2.cloudflarestorage.com`,
  region: "auto",
  credentials: {
    accessKeyId: process.env.R2AccessKey,
    secretAccessKey: process.env.R2SecretKey
  }
});

const ModerationRoles = [
  "1403777886661644398",
  "1403777609522745485",
  "1403777335416848537",
  "1403777452517494784",
  "1403777162460397649",
  "1423280211239243826",
  "1459193961808658534"
];

async function GetTickets() {
  const res = await fetch(JsonBinUrl, { headers: { "X-Master-Key": process.env.JSONBIN_KEY } });
  const data = await res.json();
  return data.record || {};
}

async function SaveTickets(tickets) {
  await fetch(JsonBinUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Master-Key": process.env.JSONBIN_KEY },
    body: JSON.stringify(tickets)
  });
}

async function UploadTranscript(ChannelId, Html) {
  const Key = `${ChannelId}.html`;
  const Command = new PutObjectCommand({
    Bucket: process.env.R2Bucket,
    Key,
    Body: Html,
    ContentType: "text/html",
    ACL: "public-read"
  });
  await R2.send(Command);
  return `${process.env.R2PublicBase}/${Key}`;
}

function EscapeHtml(text) {
  return text;
}

function GetCategoryType(CategoryId) {
  if (CategoryId === process.env.REPORT_CATEGORY) return "Report";
  if (CategoryId === process.env.APPEAL_CATEGORY) return "Appeal";
  if (CategoryId === process.env.INQUIRY_CATEGORY) return "Inquiry";
  return "Unknown";
}

async function GenerateTranscriptHtml(ChannelName, Messages, Guild) {
  let Html = `<!DOCTYPE html><html><body><h1>${ChannelName}</h1>`;
  Messages.reverse().forEach(Msg => {
    Html += `<p><b>${EscapeHtml(Msg.author.tag)}</b>: ${EscapeHtml(Msg.content || "")}</p>`;
  });
  Html += `</body></html>`;
  return Html;
}

export async function CloseTicket(Interaction, Client) {
  const Guild = Interaction.guild;
  const User = Interaction.user;
  let ActiveTickets = await GetTickets();
  const TicketData = ActiveTickets[Interaction.channel.id];
  if (!TicketData) return Interaction.reply({ content: "Ticket data not found.", ephemeral: true });

  const Member = await Guild.members.fetch(User.id);
  const Allowed =
    Member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    Member.roles.cache.some(R => ModerationRoles.includes(R.id));

  if (!Allowed) return Interaction.reply({ content: "You do not have permission.", ephemeral: true });

  await Interaction.deferReply({ ephemeral: false });

  const Messages = await Interaction.channel.messages.fetch({ limit: 100 });
  const Html = await GenerateTranscriptHtml(Interaction.channel.name, Messages, Guild);
  const TranscriptUrl = await UploadTranscript(Interaction.channel.id, Html);

  const LogChannel = await Guild.channels.fetch("1417526499761979412");
  const CloseEmbed = new EmbedBuilder()
    .setTitle("Ticket Closed")
    .addFields(
      { name: "Ticket", value: Interaction.channel.name, inline: true },
      { name: "Closed By", value: User.tag, inline: true }
    )
    .setColor("Red")
    .setTimestamp();

  const Row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel("Transcript").setStyle(ButtonStyle.Link).setURL(TranscriptUrl)
  );

  await LogChannel.send({ embeds: [CloseEmbed], components: [Row] });

  try {
    const Owner = await Client.users.fetch(TicketData.ownerId);
    await Owner.send({ embeds: [CloseEmbed], components: [Row] });
  } catch {}

  delete ActiveTickets[Interaction.channel.id];
  await SaveTickets(ActiveTickets);

  await Interaction.editReply({ content: "Ticket closed." });
  setTimeout(() => Interaction.channel.delete().catch(() => {}), 2000);
}

export default {
  name: "interactionCreate",
  async execute(Interaction, Client) {
    if (Interaction.isChatInputCommand()) {
      const Command = Client.commands.get(Interaction.commandName);
      if (Command) await Command.execute(Interaction, Client);
      return;
    }

    if (Interaction.isButton() && Interaction.customId === "close_ticket") {
      const ConfirmEmbed = new EmbedBuilder()
        .setTitle("Confirm Ticket Closure")
        .setDescription("Are you sure you want to close this ticket?")
        .setColor("Red");

      const Row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("confirm_close_yes").setLabel("Yes").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("confirm_close_no").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      );

      return Interaction.reply({ embeds: [ConfirmEmbed], components: [Row] });
    }

    if (Interaction.isButton() && Interaction.customId === "confirm_close_yes") {
      return CloseTicket(Interaction, Client);
    }

    if (Interaction.isButton() && Interaction.customId === "confirm_close_no") {
      return Interaction.update({ content: "Ticket close cancelled.", embeds: [], components: [] });
    }
  }
};
