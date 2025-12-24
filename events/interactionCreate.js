import { ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const JsonBinUrl = `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}`;

const R2 = new S3Client({
  endpoint: `https://${process.env.R2AccountId}.r2.cloudflarestorage.com`,
  region: "auto",
  credentials: {
    accessKeyId: process.env.R2AccessKey,
    secretAccessKey: process.env.R2SecretKey
  },
});

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

async function UploadToR2(buffer, key, contentType) {
  const cmd = new PutObjectCommand({
    Bucket: process.env.R2Bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ACL: "public-read"
  });
  try {
    await R2.send(cmd);
    return `${process.env.R2PublicBase}/${key}`;
  } catch { return null; }
}

function EscapeHtml(text) { return text; }

function GetCategoryType(CategoryId) {
  if (CategoryId === process.env.REPORT_CATEGORY) return "Report";
  if (CategoryId === process.env.APPEAL_CATEGORY) return "Appeal";
  if (CategoryId === process.env.INQUIRY_CATEGORY) return "Inquiry";
  return "Unknown";
}

async function SyncPermissions(Channel, Category, OwnerId) {
  if (!Category) return;
  const Overwrites = Category.permissionOverwrites.cache.map(Po => ({
    id: Po.id,
    allow: new PermissionsBitField(Po.allow).bitfield,
    deny: new PermissionsBitField(Po.deny).bitfield
  }));
  await Channel.permissionOverwrites.set(Overwrites);
  await Channel.permissionOverwrites.edit(OwnerId, {
    ViewChannel: true,
    SendMessages: true,
    AttachFiles: true
  });
}

async function GenerateTranscriptHtml(ChannelName, Messages, Guild) {
  const Css = `
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #36393f; color: #dcddde; padding: 20px; }
    h1 { color: #fff; }
    .message { display: flex; margin-bottom: 12px; }
    .avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 10px; flex-shrink: 0; }
    .content { background: #2f3136; border-radius: 8px; padding: 8px 12px; flex: 1; }
    .header { font-weight: 600; color: #fff; }
    .timestamp { font-weight: 400; font-size: 0.75em; color: #72767d; margin-left: 6px; }
    .text { margin-top: 2px; white-space: pre-wrap; word-wrap: break-word; }
    img.attachment, video.attachment { max-width: 100%; border-radius: 5px; margin-top: 5px; }
    .sticker { width: 120px; height: auto; margin-top: 5px; }
    .embed { border-left: 4px solid; padding: 8px; margin-top: 6px; border-radius: 5px; background: #2f3136; }
    .embed-title { font-weight: 700; font-size: 0.95em; margin-bottom: 2px; }
    .embed-description { margin-top: 2px; font-size: 0.9em; }
    .embed-field { margin-top: 4px; }
    .embed-field-name { font-weight: 600; font-size: 0.85em; }
    .embed-field-value { font-size: 0.85em; margin-left: 4px; }
    .embed-image, .embed-thumbnail { max-width: 300px; margin-top: 4px; border-radius: 4px; }
  `;
  let Html = `<html><head><style>${Css}</style></head><body><h1>Transcript for #${ChannelName}</h1>`;

  Messages.reverse().forEach(Msg => {
    const Timestamp = new Date(Msg.createdTimestamp).toLocaleString();
    let content = Msg.content || "";
    content = content.replace(/<@!?(\d+)>/g, (_, id) => {
      const m = Guild.members.cache.get(id);
      return m ? `@${m.displayName}` : "@Unknown";
    });
    Html += `<div class="message"><img class="avatar" src="${Msg.author.displayAvatarURL({ format:'png', size:128 })}" alt="${Msg.author.tag}"><div class="content"><div class="header">${EscapeHtml(Msg.author.tag)} <span class="timestamp">${Timestamp}</span></div><div class="text">${EscapeHtml(content)}</div></div></div>`;
  });

  Html += `</body></html>`;
  return Html;
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
  try { await R2.send(Command); return `${process.env.R2PublicBase}/${Key}`; } catch { return "https://example.com"; }
}

async function CloseTicketMessage(message, client) {
  const allowedUserId = "1442913863988281465";
  if (message.author.id !== allowedUserId) return;

  const ActiveTickets = await GetTickets();
  const TicketData = ActiveTickets[message.channel.id];
  if (!TicketData) return message.reply("No ticket data found for this channel.");

  const Messages = await message.channel.messages.fetch({ limit: 100 });
  const Html = await GenerateTranscriptHtml(message.channel.name, Messages, message.guild);
  const TranscriptUrl = await UploadTranscript(message.channel.id, Html);

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

  delete ActiveTickets[message.channel.id];
  await SaveTickets(ActiveTickets);

  setTimeout(() => message.channel.delete().catch(() => {}), 2000);
  return message.reply({ content: "Ticket closed, transcript saved.", embeds: [CloseEmbed] });
}

export default {
  name: "interactionCreate",
  async execute(Interaction, Client) { /* existing interaction logic */ },
  GetTickets,
  SaveTickets,
  GenerateTranscriptHtml,
  UploadTranscript,
  GetCategoryType,
  SyncPermissions,
  CloseTicketMessage
};
