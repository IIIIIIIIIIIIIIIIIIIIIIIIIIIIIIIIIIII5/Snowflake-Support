import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Mute a user in the server')
        .addUserOption(option =>
            option.setName('target')
                  .setDescription('The user to mute')
                  .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.MuteMembers),

    async execute(interaction) {
        const member = interaction.options.getMember('target');
        if (!member) return interaction.reply({ content: 'User not found.', ephemeral: true });

        const muteRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'muted');
        if (!muteRole) return interaction.reply({ content: 'No "Muted" role found. Please create one.', ephemeral: true });

        await member.roles.add(muteRole);
        await interaction.reply({ content: `${member.user.tag} has been muted.` });
    }
};
