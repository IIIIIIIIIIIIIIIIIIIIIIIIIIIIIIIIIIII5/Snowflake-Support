import { ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageAttachment } from "discord.js";
import fs from "fs";
import path from "path";

const activeTickets = new Map(); // ticketChannelId -> { ownerId, claimerId }

export default {
  name: "interactionCreate",
  async execute(interaction, client) {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction, client);
      } catch (err) {
        console.error(err);
        interaction.reply({ content: "An error occurred while executing this command.", ephemeral: true });
      }
      return;
    }

    if (!interaction.isButton()) return;

    const guild = interaction.guild;
    const user = interaction.user;

    // Ticket Close Confirm
    if (interaction.customId.startsWith("confirm_close_")) {
      const channel = interaction.channel;
      const confirmed = interaction.customId.endsWith("yes");
      const ticketData = activeTickets.get(channel.id);
      const logChannel = await guild.channels.fetch("1417526499761979412").catch(() => null);

      if (!ticketData) return interaction.reply({ content: "Ticket data not found.", ephemeral: true });

      if (confirmed) {
        if (logChannel) {
          const messages = await channel.messages.fetch({ limit: 100 });
          let html = `<html><body><h1>Transcript for ${channel.name}</h1>`;
          messages.reverse().forEach(msg => {
            html += `<p><strong>${msg.author.tag}:</strong> ${msg.content || ''}`;
            msg.attachments.forEach(a => html += `<br><img src="${a.url}" width="300">`);
            html += `</p>`;
          });
          html += "</body></html>";

          const filePath = path.join("/tmp", `${channel.name}-transcript.html`);
          fs.writeFileSync(filePath, html);

          await logChannel.send({ content: `Ticket Closed by ${user.tag}`, files: [filePath] });
        }

        await interaction.reply({ content: "Ticket closed.", ephemeral: true });
        activeTickets.delete(channel.id);
        setTimeout(() => channel.delete().catch(() => {}), 2000);
      } else {
        await interaction.update({ content: "Ticket close cancelled.", components: [], embeds: [] });
      }
      return;
    }

    // Close Ticket Button
    if (interaction.customId === "close_ticket") {
      const confirmEmbed = new EmbedBuilder()
        .setTitle("Confirm Ticket Closure")
        .setDescription("Are you sure you want to close this ticket?")
        .setColor("Red");

      const confirmButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("confirm_close_yes").setLabel("Yes, close it").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("confirm_close_no").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({ embeds: [confirmEmbed], components: [confirmButtons], ephemeral: true });
      return;
    }

    // Claim Ticket Button
    if (interaction.customId === "claim_ticket") {
      const ticketData = activeTickets.get(interaction.channel.id);
      if (!ticketData) return interaction.reply({ content: "Ticket data not found.", ephemeral: true });

      if (ticketData.claimerId) return interaction.reply({ content: "This ticket is already claimed.", ephemeral: true });

      ticketData.claimerId = user.id;
      activeTickets.set(interaction.channel.id, ticketData);

      await interaction.reply({ content: `Ticket claimed by ${user.tag}`, ephemeral: true });

      // Update permissions
      await interaction.channel.permissionOverwrites.set([
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: ticketData.ownerId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] },
        { id: ticketData.claimerId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
      ]);
      return;
    }

    // Ticket Creation
    const TICKET_CATEGORIES = {
      report: process.env.REPORT_CATEGORY,
      appeal: process.env.APPEAL_CATEGORY,
      inquiry: process.env.INQUIRY_CATEGORY,
    };

    let categoryId;
    let topic;

    switch (interaction.customId) {
      case "report_ticket":
        categoryId = TICKET_CATEGORIES.report;
        topic = "Report a User";
        break;
      case "appeal_ticket":
        categoryId = TICKET_CATEGORIES.appeal;
        topic = "Appeal a Punishment";
        break;
      case "inquiry_ticket":
        categoryId = TICKET_CATEGORIES.inquiry;
        topic = "Inquiries";
        break;
      default:
        return;
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

    activeTickets.set(channel.id, { ownerId: user.id, claimerId: null });

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
