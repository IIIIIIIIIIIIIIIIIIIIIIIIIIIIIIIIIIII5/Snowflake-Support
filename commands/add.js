import { SlashCommandBuilder, PermissionsBitField } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("add")
    .setDescription("Add a user to the current ticket")
    .addUserOption(option =>
      option.setName("user").setDescription("User to add to this ticket").setRequired(true)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser("user");
    const channel = interaction.channel;

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return interaction.reply({ content: "You need Manage Channels permission to use this command.", ephemeral: true });
    }

    if (!channel.name.startsWith("ticket-")) {
      return interaction.reply({ content: "This command can only be used inside a ticket channel.", ephemeral: true });
    }

    await channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      SendMessages: true,
      AttachFiles: true,
      ReadMessageHistory: true
    });

    await interaction.reply({ content: `${user.tag} has been added to this ticket.`, ephemeral: false });
  }
};
