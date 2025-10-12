import { ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

export default {
  name: "interactionCreate",
  async execute(interaction, client) {
    // Slash command handling
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

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("confirm_close_")) {
        const channel = interaction.channel;
        const confirmed = interaction.customId.endsWith("yes");
        const user = interaction.user;
        const logChannel = await interaction.guild.channels.fetch("1417526499761979412").catch(() => null);

        if (confirmed) {
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle("Ticket Closed")
              .setColor("Red")
              .addFields(
                { name: "Ticket", value: channel.name, inline: true },
                { name: "Closed by", value: user.tag, inline: true },
                { name: "Channel ID", value: channel.id, inline: true }
              )
              .setTimestamp();

            await logChannel.send({ embeds: [logEmbed] });
          }

          await interaction.reply({ content: "Ticket closed.", ephemeral: true });
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

        await interaction.reply({ embeds: [confirmEmbed], components: [confirmButtons], ephemeral: true });
        return;
      }

      const guild = interaction.guild;
      const user = interaction.user;
      const existing = guild.channels.cache.find(c => c.name === `ticket-${user.username.toLowerCase()}`);

      if (existing) {
        return interaction.reply({ content: "You already have an open ticket.", ephemeral: true });
      }

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

      const closeButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setStyle(ButtonStyle.Secondary)
      );

      const ticketEmbed = new EmbedBuilder()
        .setTitle(topic)
        .setDescription("A staff member will be with you shortly.\nPlease describe your issue below.")
        .setColor("Blue");

      await channel.send({ content: `${user}`, embeds: [ticketEmbed], components: [closeButton] });
      await interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });
    }
  },
};
