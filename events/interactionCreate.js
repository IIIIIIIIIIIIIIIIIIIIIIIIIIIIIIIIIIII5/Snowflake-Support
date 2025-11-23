import { ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import fetch from "node-fetch";
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

function GenerateTranscriptHtml(channelName, messages) {
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Transcript - ${channelName}</title>
<style>
  body { font-family: 'Arial', sans-serif; background: #36393f; color: #dcddde; padding: 20px; }
  h1 { color: #fff; }
  .message { display: flex; margin-bottom: 15px; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 10px; }
  .content { background: #2f3136; padding: 10px; border-radius: 5px; flex: 1; }
  .header { font-weight: bold; color: #fff; margin-bottom: 3px; }
  .timestamp { font-size: 0.75em; color: #72767d; margin-left: 5px; }
  .text { color: #dcddde; margin-top: 2px; white-space: pre-wrap; word-wrap: break-word; }
  img.attachment { max-width: 400px; max-height: 300px; border-radius: 5px; margin-top: 5px; }
</style>
</head>
<body>
<h1>Transcript for #${channelName}</h1>`;

  messages.reverse().forEach(msg => {
    const timestamp = new Date(msg.createdTimestamp).toLocaleString();
    html += `
<div class="message">
  <img class="avatar" src="${msg.author.displayAvatarURL({ format: 'png', size: 128 })}" alt="${msg.author.tag}">
  <div class="content">
    <div class="header">${msg.author.tag} <span class="timestamp">${timestamp}</span></div>
    <div class="text">${msg.content || ''}</div>`;

    msg.attachments.forEach(att => {
      html += `<img class="attachment" src="${att.url}" alt="Attachment">`;
    });

    html += `</div></div>`;
  });

  html += `</body></html>`;
  return html;
}

async function UploadTranscript(channelId, html) {
  const key = `${channelId}.html`;
  const command = new PutObjectCommand({
    Bucket: process.env.R2Bucket,
    Key: key,
    Body: html,
    ContentType: "text/html",
    ACL: "public-read"
  });
  try {
    await R2.send(command);
    return `${process.env.R2PublicBase}/${key}`;
  } catch (err) {
    console.error("R2 upload failed:", err);
    return "https://example.com";
  }
}

function GetCategoryType(categoryId) {
  if (categoryId === process.env.REPORT_CATEGORY) return "Report";
  if (categoryId === process.env.APPEAL_CATEGORY) return "Appeal";
  if (categoryId === process.env.INQUIRY_CATEGORY) return "Inquiry";
  return "Unknown";
}

async function SyncPermissions(channel, category, ownerId) {
  if (!category) return;
  const overwrites = category.permissionOverwrites.cache.map(po => ({
    id: po.id,
    allow: new PermissionsBitField(po.allow).bitfield,
    deny: new PermissionsBitField(po.deny).bitfield
  }));
  await channel.permissionOverwrites.set(overwrites);
  await channel.permissionOverwrites.edit(ownerId, {
    ViewChannel: true,
    SendMessages: true,
    AttachFiles: true
  });
}

export default {
  name: "interactionCreate",
  async execute(interaction, client) {
    let activeTickets = await GetTickets();
    const guild = interaction.guild;
    const user = interaction.user;

    if (!client.TicketCounts) client.TicketCounts = { Report: 0, Appeal: 0, Inquiry: 0 };

    for (const t of Object.values(activeTickets)) {
      if (t.categoryType && typeof t.ticketNumber === "number") {
        if (!client.TicketCounts[t.categoryType] || client.TicketCounts[t.categoryType] < t.ticketNumber) {
          client.TicketCounts[t.categoryType] = t.ticketNumber;
        }
      }
    }

    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      try { await command.execute(interaction, client); } 
      catch (err) { console.error(err); interaction.reply({ content: "Error executing command.", ephemeral: true }); }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "move_ticket") {
      const selectedCategoryId = interaction.values[0];
      if (!selectedCategoryId) return interaction.reply({ content: "Invalid category selected.", ephemeral: true });
      const oldCategory = guild.channels.cache.get(interaction.channel.parentId);
      await interaction.channel.setParent(selectedCategoryId).catch(() => {});
      const newCategory = guild.channels.cache.get(selectedCategoryId);
      const ticketData = activeTickets[interaction.channel.id];
      if (ticketData) await SyncPermissions(interaction.channel, newCategory, ticketData.ownerId);
      try {
        const owner = await client.users.fetch(ticketData.ownerId);
        const moveEmbed = new EmbedBuilder()
          .setTitle("Ticket Moved")
          .setColor("Yellow")
          .setDescription(`Your ticket has been moved from **${oldCategory ? oldCategory.name : "Unknown"}** to **${newCategory ? newCategory.name : "Unknown"}**.`);
        await owner.send({ embeds: [moveEmbed] });
      } catch (err) { console.error("Failed to DM ticket owner:", err); }
      return interaction.reply({ content: `Ticket moved to <#${selectedCategoryId}> and synced permissions successfully.`, ephemeral: true });
    }

    if (!interaction.isButton()) return;
    const ticketData = activeTickets[interaction.channel.id];

    if (interaction.customId.startsWith("confirm_close_")) {
      await interaction.deferReply({ ephemeral: false });
      const confirmed = interaction.customId.endsWith("yes");
      const logChannel = await guild.channels.fetch("1417526499761979412").catch(() => null);
      if (!logChannel?.isTextBased()) return interaction.editReply({ content: "Log channel not found." });
      if (!ticketData) return interaction.editReply({ content: "Ticket data not found." });
      if (!confirmed) { await interaction.message.edit({ content: "Ticket close cancelled.", components: [] }); await interaction.editReply({ content: "Cancelled ticket closure." }); return; }

      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const html = GenerateTranscriptHtml(interaction.channel.name, messages);
      let transcriptUrl = "";
      try { transcriptUrl = await UploadTranscript(interaction.channel.id, html); } 
      catch (err) { console.error("R2 upload failed:", err); transcriptUrl = "https://example.com"; }

      const closeEmbed = new EmbedBuilder()
        .setTitle("Ticket Closed")
        .addFields(
          { name: "Ticket", value: interaction.channel.name, inline: true },
          { name: "Closed by", value: user.tag, inline: true },
          { name: "Channel ID", value: interaction.channel.id, inline: true }
        )
        .setColor("Red")
        .setTimestamp();

      const transcriptButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Transcript").setStyle(ButtonStyle.Link).setURL(transcriptUrl)
      );

      await logChannel.send({ embeds: [closeEmbed], components: [transcriptButton] });

      const createdAt = ticketData.createdAt ? new Date(ticketData.createdAt) : new Date();
      const closedAt = new Date();
      const diffDays = Math.round((closedAt - createdAt) / (1000 * 60 * 60 * 24));
      const categoryType = GetCategoryType(interaction.channel.parentId);
      const ticketNumber = ticketData.ticketNumber;

      const dmEmbed = new EmbedBuilder()
        .setTitle("Ticket Closed")
        .setColor("Red")
        .addFields(
          { name: "Ticket", value: `${categoryType} #${ticketNumber}`, inline: false },
          { name: "Created At", value: createdAt.toLocaleString(), inline: true },
          { name: "Closed At", value: `${closedAt.toLocaleString()} (${diffDays} day${diffDays !== 1 ? "s" : ""})`, inline: true },
          { name: "Closed By", value: user.tag, inline: false }
        );

      const dmButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Transcript").setStyle(ButtonStyle.Link).setURL(transcriptUrl)
      );

      try { const owner = await client.users.fetch(ticketData.ownerId); await owner.send({ embeds: [dmEmbed], components: [dmButton] }); } 
      catch (err) { console.error("Failed to DM user:", err); }

      delete activeTickets[interaction.channel.id];
      await SaveTickets(activeTickets);
      await interaction.editReply({ content: "Ticket closed, transcript saved to log channel." });
      await interaction.message.edit({ components: [] });
      setTimeout(() => interaction.channel.delete().catch(() => {}), 2000);
      return;
    }

    if (interaction.customId === "close_ticket") {
      const confirmEmbed = new EmbedBuilder()
        .setTitle("Confirm Ticket Closure")
        .setDescription("Are you sure you want to close this ticket?")
        .setColor("Red");
      const confirmButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("confirm_close_yes").setLabel("Yes, close it").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("confirm_close_no").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({ embeds: [confirmEmbed], components: [confirmButtons], ephemeral: false });
      return;
    }

    if (interaction.customId === "claim_ticket") {
      if (!ticketData) return interaction.reply({ content: "Ticket data not found.", ephemeral: true });
      if (ticketData.claimerId) return interaction.reply({ content: "This ticket is already claimed.", ephemeral: true });

      const member = await guild.members.fetch(user.id);
      const allowedRoles = [
        "1403777886661644398",
        "1403777609522745485",
        "1403777335416848537",
        "1403777452517494784",
        "1403777162460397649",
        "1423280211239243826"
      ];
      const hasRole = member.roles.cache.some(r => allowedRoles.includes(r.id));
      if (!member.permissions.has(PermissionsBitField.Flags.Administrator) && !hasRole) return interaction.reply({ content: "You do not have permission to claim tickets.", ephemeral: true });

      ticketData.claimerId = user.id;
      activeTickets[interaction.channel.id] = ticketData;
      await SaveTickets(activeTickets);

      const fetchedMessages = await interaction.channel.messages.fetch({ limit: 10 });
      const ticketMessage = fetchedMessages.find(m => m.components.length > 0);
      if (ticketMessage) {
        const updatedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setStyle(ButtonStyle.Danger)
        );
        await ticketMessage.edit({ components: [updatedRow] });
      }

      const category = interaction.channel.parent ? guild.channels.cache.get(interaction.channel.parentId) : null;
      if (category) await SyncPermissions(interaction.channel, category, ticketData.ownerId);

      await interaction.channel.permissionOverwrites.edit(ticketData.ownerId, { ViewChannel: true, SendMessages: true, AttachFiles: true });
      await interaction.channel.permissionOverwrites.edit(ticketData.claimerId, { ViewChannel: true, SendMessages: true });

      await interaction.reply({ content: `Ticket claimed by ${user.tag}`, ephemeral: false });
      return;
    }

    const ticketCategories = {
      Report: process.env.REPORT_CATEGORY,
      Appeal: process.env.APPEAL_CATEGORY,
      Inquiry: process.env.INQUIRY_CATEGORY
    };

    let categoryId, topic, type;
    switch (interaction.customId) {
      case "report_ticket": categoryId = ticketCategories.Report; topic = "Report a User"; type = "Report"; break;
      case "appeal_ticket": categoryId = ticketCategories.Appeal; topic = "Appeal a Punishment"; type = "Appeal"; break;
      case "inquiry_ticket": categoryId = ticketCategories.Inquiry; topic = "Inquiries"; type = "Inquiry"; break;
      default: return;
    }

    const existingTicket = Object.values(activeTickets).find(t => t.ownerId === user.id && t.categoryType === type);
    if (existingTicket) return interaction.reply({ content: `You already have an open ${type} ticket in this category. Please close it before creating a new one.`, ephemeral: true });

    const channel = await guild.channels.create({
      name: `ticket-${user.username}`,
      type: ChannelType.GuildText,
      parent: categoryId,
      topic: `${topic} | Opened by ${user.tag}`
    });

    const parentCategory = guild.channels.cache.get(categoryId);
    if (parentCategory) await SyncPermissions(channel, parentCategory, user.id);

    await channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, AttachFiles: true });

    client.TicketCounts[type] += 1;
    const ticketNumber = client.TicketCounts[type];

    activeTickets[channel.id] = { ownerId: user.id, claimerId: null, createdAt: Date.now(), categoryType: type, ticketNumber };
    await SaveTickets(activeTickets);

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("claim_ticket").setLabel("Claim Ticket").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setStyle(ButtonStyle.Danger)
    );

    const ticketEmbed = new EmbedBuilder()
      .setTitle(`${topic} #${ticketNumber}`)
      .setDescription("A staff member will be with you shortly.\nPlease describe your issue below.")
      .setColor("Blue");

    await channel.send({ content: `${user}`, embeds: [ticketEmbed], components: [buttons] });
    await interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });
  }
};
