import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Create the ticket embed"),

  async execute(interaction) {
    if (interaction.user.id !== "804292216511791204") {
      return interaction.reply({ content: "You are not authorized to use this command.", ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle("SFP Official Tickets")
      .setDescription("To create a ticket, use the buttons below.")
      .setColor("#2B2D31");

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("report_ticket").setLabel("Report a user").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("appeal_ticket").setLabel("Appeal a punishment").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("inquiry_ticket").setLabel("Inquiries").setStyle(ButtonStyle.Danger)
    );

    await interaction.channel.send({ embeds: [embed], components: [buttons] });
    await interaction.reply({ content: "Ticket panel created successfully.", ephemeral: true });
  }
};
