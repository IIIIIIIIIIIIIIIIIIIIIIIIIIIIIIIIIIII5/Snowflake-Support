import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export default {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clear messages in a channel')
        .addIntegerOption(option =>
            option.setName('amount')
                  .setDescription('Number of messages to delete')
                  .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        const amount = interaction.options.getInteger('amount');
        if (amount < 1 || amount > 100) return interaction.reply({ content: 'You can delete 1-100 messages at a time.', ephemeral: true });

        const messages = await interaction.channel.messages.fetch({ limit: amount });
        await interaction.channel.bulkDelete(messages, true);
        await interaction.reply({ content: `Deleted ${messages.size} messages.`, ephemeral: true });
    }
};
