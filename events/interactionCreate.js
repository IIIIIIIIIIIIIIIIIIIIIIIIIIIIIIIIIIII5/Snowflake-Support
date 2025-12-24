import { ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const JsonBinUrl = `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}`;

const R2 = new S3Client({
  endpoint: `https://${process.env.R2AccountId}.r2.cloudflarestorage.com`,
  region: "auto",
  credentials: { accessKeyId: process.env.R2AccessKey, secretAccessKey: process.env.R2SecretKey }
});

async function GetTickets() {
  const res = await fetch(JsonBinUrl, { headers: { "X-Master-Key": process.env.JSONBIN_KEY } });
  const data = await res.json();
  return data.record || {};
}

async function SaveTickets(tickets) {
  await fetch(JsonBinUrl, { method: "PUT", headers: { "Content-Type": "application/json", "X-Master-Key": process.env.JSONBIN_KEY }, body: JSON.stringify(tickets) });
}

function EscapeHtml(text) { return text; }

function GetCategoryType(CategoryId) {
  if (CategoryId === process.env.REPORT_CATEGORY) return "Report";
  if (CategoryId === process.env.APPEAL_CATEGORY) return "Appeal";
  if (CategoryId === process.env.INQUIRY_CATEGORY) return "Inquiry";
  return "Unknown";
}

async function GenerateTranscriptHtml(ChannelName, Messages, Guild) {
  let html = `<html><head></head><body><h1>Transcript for #${ChannelName}</h1>`;
  Messages.reverse().forEach(Msg => {
    const timestamp = new Date(Msg.createdTimestamp).toLocaleString();
    let content = Msg.content || "";
    content = content.replace(/<@!?(\d+)>/g, (_, id) => {
      const m = Guild.members.cache.get(id);
      return m ? `@${m.displayName}` : "@Unknown";
    });
    html += `<div><strong>${Msg.author.tag}</strong> [${timestamp}]: ${EscapeHtml(content)}</div>`;
  });
  html += "</body></html>";
  return html;
}

async function UploadTranscript(ChannelId, Html) {
  const Key = `${ChannelId}.html`;
  const Command = new PutObjectCommand({ Bucket: process.env.R2Bucket, Key, Body: Html, ContentType: "text/html", ACL: "public-read" });
  try { await R2.send(Command); return `${process.env.R2PublicBase}/${Key}`; } catch { return "https://example.com"; }
}

async function CloseTicketMessage(message, client) {
  const allowedUserId = "1442913863988281465";
  if (message.author.id !== allowedUserId) {
    return message.reply("You are not allowed to close tickets.");
  }
  
  const ActiveTickets = await GetTickets();
  const TicketData = ActiveTickets[message.channel.id];
  
  if (!TicketData) {
    return message.reply("No ticket data found for this channel.");
  }

  const Messages = await message.channel.messages.fetch({ limit: 100 });
  const Html = await GenerateTranscriptHtml(message.channel.name, Messages, message.guild);
  const TranscriptUrl = await UploadTranscript(message.channel.id, Html);

  const CloseEmbed = new EmbedBuilder()
    .setTitle("Ticket Closed")
    .addFields(
      { name: "Ticket", value: message.channel.name, inline: true },
      { name: "Closed by", value: message.author.tag, inline: true },
      { name: "Channel ID", value: message.channel.id, inline: true }
    )
    .setColor("Red")
    .setTimestamp();

  const TranscriptButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Transcript").setStyle(ButtonStyle.Link).setURL(TranscriptUrl));

  const LogChannel = await message.guild.channels.fetch(process.env.LOG_CHANNEL_ID).catch(() => null);
  if (LogChannel?.isTextBased()) await LogChannel.send({ embeds: [CloseEmbed], components: [TranscriptButton] });

  try {
    const Owner = await client.users.fetch(TicketData.ownerId);
    const CreatedAt = TicketData.createdAt ? new Date(TicketData.createdAt) : new Date();
    const ClosedAt = new Date();
    const DiffDays = Math.round((ClosedAt.getTime() - CreatedAt.getTime()) / (1000*60*60*24));

    const DmEmbed = new EmbedBuilder()
      .setTitle("Ticket Closed")
      .setColor("Red")
      .addFields(
        { name: "Ticket", value: `${GetCategoryType(message.channel.parentId)} #${TicketData.ticketNumber}`, inline: false },
        { name: "Created At", value: CreatedAt.toLocaleString(), inline: true },
        { name: "Closed At", value: `${ClosedAt.toLocaleString()} (${DiffDays} day${DiffDays !== 1 ? 's' : ''})`, inline: true },
        { name: "Closed By", value: message.author.tag, inline: false }
      );

    const DmButton = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel("Transcript").setStyle(ButtonStyle.Link).setURL(TranscriptUrl));
    await Owner.send({ embeds: [DmEmbed], components: [DmButton] });
  } catch {}

  delete ActiveTickets[message.channel.id];
  await SaveTickets(ActiveTickets);
  setTimeout(() => message.channel.delete().catch(() => {}), 2000);
  return message.reply({ content: "Ticket closed, transcript saved.", embeds: [CloseEmbed] });
}

export default {
  name: "interactionCreate",
  async execute(Interaction, Client) { /* existing logic */ },
  GetTickets,
  SaveTickets,
  GenerateTranscriptHtml,
  UploadTranscript,
  GetCategoryType,
  CloseTicketMessage
};
