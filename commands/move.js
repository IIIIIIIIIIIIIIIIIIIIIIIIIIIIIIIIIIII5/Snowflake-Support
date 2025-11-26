const { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, PermissionsBitField } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("move")
    .setDescription("Move the current ticket to another category"),

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return interaction.reply({ content: "You need Manage Channels permissions to use this command.", ephemeral: true });
    }

    const TICKET_CATEGORIES = {
      report: process.env.REPORT_CATEGORY,
      appeal: process.env.APPEAL_CATEGORY,
      inquiry: process.env.INQUIRY_CATEGORY
    };

    const moveMenu = new StringSelectMenuBuilder()
      .setCustomId("move_ticket")
      .setPlaceholder("Select a category to move this ticket to")
      .addOptions([
        { label: "Report", value: TICKET_CATEGORIES.report },
        { label: "Appeal", value: TICKET_CATEGORIES.appeal },
        { label: "Inquiry", value: TICKET_CATEGORIES.inquiry }
      ]);

    const row = new ActionRowBuilder().addComponents(moveMenu);
    await interaction.reply({ content: "Select the category to move this ticket to:", components: [row], ephemeral: true });
  }
};
