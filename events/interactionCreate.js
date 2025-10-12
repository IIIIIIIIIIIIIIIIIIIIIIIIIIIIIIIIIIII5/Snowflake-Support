import { ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

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

    if (interaction.isButton()) {
      if (interaction.customId === "close_ticket") {
        await interaction.reply({ content: "This ticket will be closed in 5 seconds.", ephemeral: true });
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
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
