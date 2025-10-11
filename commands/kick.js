import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a user from the server')
        .addUserOption(option =>
            option.setName('target')
                  .setDescription('The user to kick')
                  .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    async execute(interaction) {
        const member = interaction.options.getMember('target');
        if (!member) return interaction.reply({ content: 'User not found.', ephemeral: true });
        if (!member.kickable) return interaction.reply({ content: 'I cannot kick this user.', ephemeral: true });

        await member.kick();
        await interaction.reply({ content: `${member.user.tag} has been kicked.` });
    }
};
