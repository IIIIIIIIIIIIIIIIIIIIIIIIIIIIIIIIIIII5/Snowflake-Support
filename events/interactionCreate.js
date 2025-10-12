import { ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from "discord.js";
import fs from "fs";
import path from "path";

const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}`;

async function getTickets() {
  const res = await fetch(JSONBIN_URL, {
    headers: { "X-Master-Key": process.env.JSONBIN_KEY }
  });
  const data = await res.json();
  return data.record || {};
}

async function saveTickets(tickets) {
  await fetch(JSONBIN_URL, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": process.env.JSONBIN_KEY
    },
    body: JSON.stringify(tickets)
  });
}

function generateTranscriptHTML(channelName, messages) {
  let html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Transcript - ${channelName}</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f4f4f4; padding: 20px; }
      .message { margin-bottom: 15px; padding: 10px; border-radius: 5px; background: #fff; }
      .author { font-weight: bold; color: #333; }
      .content { margin-top: 5px; }
      img { max-width: 300px; margin-top: 5px; border-radius: 5px; }
      .timestamp { font-size: 0.8em; color: #666; margin-top: 3px; }
    </style>
  </head>
  <body>
    <h1>Transcript for ${channelName}</h1>
  `;

  messages.reverse().forEach(msg => {
    html += `<div class="message">
      <div class="author">${msg.author.tag}</div>
      <div class="content">${msg.content || ''}</div>`;
    msg.attachments.forEach(a => html += `<img src="${a.url}" alt="Attachment">`);
    html += `<div class="timestamp">${new Date(msg.createdTimestamp).toLocaleString()}</div>`;
    html += `</div>`;
  });

  html += `
  </body>
  </html>
  `;

  return html;
}

export default {
  name: "interactionCreate",
  async execute(interaction, client) {
    let activeTickets = await getTickets();

    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      try { await command.execute(interaction, client); } 
      catch (err) { console.error(err); interaction.reply({ content: "Error executing command.", ephemeral: true }); }
      return;
    }

    if (!interaction.isButton()) return;
    const guild = interaction.guild;
    const user = interaction.user;

    if (interaction.customId.startsWith("confirm_close_")) {
      const channel = interaction.channel;
      const confirmed = interaction.customId.endsWith("yes");
      const ticketData = activeTickets[channel.id];
      const logChannelRaw = await guild.channels.fetch("1417526499761979412").catch(() => null);
      if (!logChannelRaw || !logChannelRaw.isTextBased()) return;
      const logChannel = logChannelRaw;

      if (!ticketData) return interaction.reply({ content: "Ticket data not found.", ephemeral: true });

      if (confirmed) {
        if (logChannel) {
          const messages = await channel.messages.fetch({ limit: 100 });
          const html = generateTranscriptHTML(channel.name, messages);
          const filePath = path.join("/tmp", `${channel.name}-transcript.html`);
          fs.writeFileSync(filePath, html);

          const file = new AttachmentBuilder(filePath);
          await logChannel.send({ content: `Ticket Closed by ${user.tag}`, files: [file] });
        }

        await interaction.reply({ content: "Ticket closed.", ephemeral: true });
        delete activeTickets[channel.id];
        await saveTickets(activeTickets);
        setTimeout(() => channel.delete().catch(() => {}), 2000);
      } else {
        await interaction.update({ content: "Ticket close cancelled.", components: [], embeds: [] });
      }
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

      await interaction.reply({ embeds: [confirmEmbed], components: [confirmButtons] });
      return;
    }

    if (interaction.customId === "claim_ticket") {
      const ticketData = activeTickets[interaction.channel.id];
      if (!ticketData) return interaction.reply({ content: "Ticket data not found.", ephemeral: true });
      if (ticketData.claimerId) return interaction.reply({ content: "This ticket is already claimed.", ephemeral: true });

      ticketData.claimerId = user.id;
      activeTickets[interaction.channel.id] = ticketData;
      await saveTickets(activeTickets);

      await interaction.reply({ content: `Ticket claimed by ${user.tag}`, ephemeral: true });

      await interaction.channel.permissionOverwrites.set([
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: ticketData.ownerId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] },
        { id: ticketData.claimerId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      ]);
      return;
    }

    const TICKET_CATEGORIES = {
      report: process.env.REPORT_CATEGORY,
      appeal: process.env.APPEAL_CATEGORY,
      inquiry: process.env.INQUIRY_CATEGORY,
    };

    let categoryId, topic;

    switch (interaction.customId) {
      case "report_ticket": categoryId = TICKET_CATEGORIES.report; topic = "Report a User"; break;
      case "appeal_ticket": categoryId = TICKET_CATEGORIES.appeal; topic = "Appeal a Punishment"; break;
      case "inquiry_ticket": categoryId = TICKET_CATEGORIES.inquiry; topic = "Inquiries"; break;
      default: return;
    }

    const existing = guild.channels.cache.find(c => c.name === `ticket-${user.username.toLowerCase()}`);
    if (existing) return interaction.reply({ content: "You already have an open ticket.", ephemeral: true });

    const channel = await guild.channels.create({
      name: `ticket-${user.username}`,
      type: ChannelType.GuildText,
      parent: categoryId,
      topic: `${topic} | Opened by ${user.tag}`,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] },
        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      ],
    });

    activeTickets[channel.id] = { ownerId: user.id, claimerId: null };
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
  },
};
