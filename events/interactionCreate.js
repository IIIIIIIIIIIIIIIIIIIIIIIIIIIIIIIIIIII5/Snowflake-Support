import { ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { Octokit } from "octokit";

const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}`;
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

async function getTickets() {
  const res = await fetch(JSONBIN_URL, { headers: { "X-Master-Key": process.env.JSONBIN_KEY } });
  const data = await res.json();
  return data.record || {};
}

async function saveTickets(tickets) {
  await fetch(JSONBIN_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Master-Key": process.env.JSONBIN_KEY },
    body: JSON.stringify(tickets)
  });
}

function generateTranscriptHTML(channelName, messages) {
  let html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Transcript - ${channelName}</title><style>
  body{font-family:Arial,sans-serif;background:#111;color:#fff;padding:20px;}
  .message{margin-bottom:15px;padding:10px;border-radius:5px;background:#222;}
  .author{font-weight:bold;color:#fff;}
  .content{margin-top:5px;color:#ddd;}
  img{max-width:300px;margin-top:5px;border-radius:5px;}
  .timestamp{font-size:0.8em;color:#aaa;margin-top:3px;}
  </style></head><body><h1>Transcript for ${channelName}</h1>`;
  messages.reverse().forEach(msg => {
    html += `<div class="message"><div class="author">${msg.author.tag}</div><div class="content">${msg.content || ""}</div>`;
    msg.attachments.forEach(a => html += `<img src="${a.url}" alt="Attachment">`);
    html += `<div class="timestamp">${new Date(msg.createdTimestamp).toLocaleString()}</div></div>`;
  });
  html += `</body></html>`;
  return html;
}

async function syncPermissions(channel, category) {
  if (!category) return;
  const overwrites = category.permissionOverwrites.cache.map(po => ({
    id: po.id,
    allow: new PermissionsBitField(po.allow).bitfield,
    deny: new PermissionsBitField(po.deny).bitfield
  }));
  await channel.permissionOverwrites.set(overwrites);
}

function getCategoryType(categoryId) {
  if (categoryId === process.env.REPORT_CATEGORY) return "Report";
  if (categoryId === process.env.APPEAL_CATEGORY) return "Appeal";
  if (categoryId === process.env.INQUIRY_CATEGORY) return "Inquiry";
  return "Unknown";
}

export default {
  name: "interactionCreate",
  async execute(interaction, client) {
    let activeTickets = await getTickets();
    const guild = interaction.guild;
    const user = interaction.user;

    if (!client.ticketCounts) client.ticketCounts = { Report: 0, Appeal: 0, Inquiry: 0 };

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
      await interaction.channel.setParent(selectedCategoryId).catch(() => {});
      const newCategory = guild.channels.cache.get(selectedCategoryId);
      await syncPermissions(interaction.channel, newCategory);
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

      if (!confirmed) {
        await interaction.message.edit({ content: "Ticket close cancelled.", components: [] });
        await interaction.editReply({ content: "Cancelled ticket closure." });
        return;
      }

      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const html = generateTranscriptHTML(interaction.channel.name, messages);
      const filePath = path.join("/tmp", `${interaction.channel.name}-transcript.html`);
      fs.writeFileSync(filePath, html);

      let githubUrl = "";
      try {
        const repo = process.env.GITHUB_REPO.split("/");
        const content = Buffer.from(html).toString("base64");
        await octokit.rest.repos.createOrUpdateFileContents({
          owner: repo[0],
          repo: repo[1],
          path: `${interaction.channel.id}/index.html`,
          message: `Add transcript for ticket ${interaction.channel.id}`,
          content,
          branch: "main"
        });
        githubUrl = `https://${process.env.GITHUB_USER}.github.io/tickets/${interaction.channel.id}/index.html`;
      } catch (err) {
        console.error("GitHub upload failed:", err);
      }

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
        new ButtonBuilder().setLabel("Transcript").setStyle(ButtonStyle.Link).setURL(githubUrl || "https://example.com")
      );

      await logChannel.send({ embeds: [closeEmbed], components: [transcriptButton] });

      const createdAt = ticketData.createdAt ? new Date(ticketData.createdAt) : new Date();
      const closedAt = new Date();
      const diffDays = Math.round((closedAt - createdAt) / (1000 * 60 * 60 * 24));
      const categoryType = getCategoryType(interaction.channel.parentId);
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
        new ButtonBuilder().setLabel("Transcript").setStyle(ButtonStyle.Link).setURL(githubUrl || "https://example.com")
      );

      try {
        const owner = await client.users.fetch(ticketData.ownerId);
        await owner.send({ embeds: [dmEmbed], components: [dmButton] });
      } catch (err) {
        console.error("Failed to DM user:", err);
      }

      delete activeTickets[interaction.channel.id];
      await saveTickets(activeTickets);
      await interaction.editReply({ content: "Ticket closed, transcript saved to log channel and GitHub." });
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

      ticketData.claimerId = user.id;
      activeTickets[interaction.channel.id] = ticketData;
      await saveTickets(activeTickets);

      const fetchedMessages = await interaction.channel.messages.fetch({ limit: 10 });
      const ticketMessage = fetchedMessages.find(m => m.components.length > 0);
      if (ticketMessage) {
        const updatedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setStyle(ButtonStyle.Danger)
        );
        await ticketMessage.edit({ components: [updatedRow] });
      }

      const category = interaction.channel.parent ? guild.channels.cache.get(interaction.channel.parentId) : null;
      if (category) await syncPermissions(interaction.channel, category);

      await interaction.channel.permissionOverwrites.edit(ticketData.ownerId, {
        ViewChannel: true,
        SendMessages: true,
        AttachFiles: true
      });

      await interaction.channel.permissionOverwrites.edit(ticketData.claimerId, {
        ViewChannel: true,
        SendMessages: true
      });

      await interaction.reply({ content: `Ticket claimed by ${user.tag}`, ephemeral: false });
      return;
    }

    const TICKET_CATEGORIES = {
      report: process.env.REPORT_CATEGORY,
      appeal: process.env.APPEAL_CATEGORY,
      inquiry: process.env.INQUIRY_CATEGORY
    };

    let categoryId, topic, type;
    switch (interaction.customId) {
      case "report_ticket": categoryId = TICKET_CATEGORIES.report; topic = "Report a User"; type = "Report"; break;
      case "appeal_ticket": categoryId = TICKET_CATEGORIES.appeal; topic = "Appeal a Punishment"; type = "Appeal"; break;
      case "inquiry_ticket": categoryId = TICKET_CATEGORIES.inquiry; topic = "Inquiries"; type = "Inquiry"; break;
      default: return;
    }

    const existing = guild.channels.cache.find(c => c.name === `ticket-${user.username.toLowerCase()}`);
    if (existing) return interaction.reply({ content: "You already have an open ticket.", ephemeral: true });

    const channel = await guild.channels.create({
      name: `ticket-${user.username}`,
      type: ChannelType.GuildText,
      parent: categoryId,
      topic: `${topic} | Opened by ${user.tag}`
    });

    const category = guild.channels.cache.get(categoryId);
    if (category) await syncPermissions(channel, category);

    await channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      SendMessages: true,
      AttachFiles: true
    });

    client.ticketCounts[type] += 1;
    const ticketNumber = client.ticketCounts[type];

    activeTickets[channel.id] = {
      ownerId: user.id,
      claimerId: null,
      createdAt: Date.now(),
      categoryType: type,
      ticketNumber
    };
    await saveTickets(activeTickets);

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("claim_ticket").setLabel("Claim Ticket").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setStyle(ButtonStyle.Danger)
    );

    const ticketEmbed = new EmbedBuilder()
      .setTitle(topic)
      .setDescription("A staff member will be with you shortly.\nPlease describe your issue below.")
      .setColor("Blue");

    await channel.send({ content: `${user}`, embeds: [ticketEmbed], components: [buttons] });
    await interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });
  }
};
