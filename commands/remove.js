import { SlashCommandBuilder, PermissionsBitField } from "discord.js";
import fetch from "node-fetch";

const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}`;

async function getTickets() {
  const res = await fetch(JSONBIN_URL, { headers: { "X-Master-Key": process.env.JSONBIN_KEY } });
  const data = await res.json();
  return data.record || {};
}

export default {
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a user from the current ticket")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to remove from this ticket")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const channel = interaction.channel;
    if (!channel || !channel.name.startsWith("ticket-")) return;

    const overwrites = channel.permissionOverwrites.cache;
    const members = await channel.guild.members.fetch();

    const includedMembers = members.filter(
      m => overwrites.has(m.id) && !m.user.bot
    );

    const focusedValue = interaction.options.getFocused();
    const filtered = includedMembers.filter(m =>
      m.user.tag.toLowerCase().includes(focusedValue.toLowerCase())
    );

    await interaction.respond(
      filtered
        .map(m => ({ name: m.user.tag, value: m.id }))
        .slice(0, 25)
    );
  },

  async execute(interaction) {
    const user = interaction.options.getUser("user");
    const channel = interaction.channel;
    const member = interaction.member;

    const tickets = await getTickets();
    const ticketData = tickets[channel.id];

    if (!channel.name.startsWith("ticket-")) {
      return interaction.reply({ content: "This command can only be used inside a ticket channel.", ephemeral: true });
    }

    const isStaff = member.permissions.has(PermissionsBitField.Flags.ManageChannels);
    const isOwner = ticketData && ticketData.ownerId === member.id;

    if (!isStaff && !isOwner) {
      return interaction.reply({ content: "Only staff or the ticket owner can use this command.", ephemeral: true });
    }

    await channel.permissionOverwrites.delete(user.id).catch(() => {});
    await interaction.reply({ content: `${user.tag} has been removed from this ticket.`, ephemeral: false });
  }
};
