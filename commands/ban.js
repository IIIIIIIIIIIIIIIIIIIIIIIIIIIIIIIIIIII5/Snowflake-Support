import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a user from the server')
        .addUserOption(option =>
            option.setName('target')
                  .setDescription('The user to ban')
                  .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                  .setDescription('Reason for the ban')
                  .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(interaction) {
        const member = interaction.options.getMember('target');
        const reason = interaction.options.getString('reason');

        if (!member) return interaction.reply({ content: 'User not found.', ephemeral: true });
        if (!member.bannable) return interaction.reply({ content: 'I cannot ban this user.', ephemeral: true });

        await member.ban({ reason });

        const embed = new EmbedBuilder()
            .setTitle('User Banned')
            .setDescription(`<@${member.id}> has been banned.`)
            .addFields({ name: 'Reason', value: reason })
            .setColor(0xFF0000)
            .setTimestamp()
            .setFooter({ text: `Banned by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() });

        await interaction.reply({ embeds: [embed] });
    }
};
