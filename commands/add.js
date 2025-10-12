import { SlashCommandBuilder } from "discord.js";
import fetch from "node-fetch";

const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}`;
const ALLOWED_ROLES = [
  "1403777162460397649",
  "1235182843487981669",
  "1423280211239243826",
  "1402693639486046278"
];

async function getTickets() {
  const res = await fetch(JSONBIN_URL, { headers: { "X-Master-Key": process.env.JSONBIN_KEY } });
  const data = await res.json();
  return data.record || {};
}

export default {
  data: new SlashCommandBuilder()
    .setName("add")
    .setDescription("Add a user to the current ticket")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to add to this ticket")
        .setRequired(true)
    ),

  async execute(interaction) {
    const user = interaction.options.getUser("user");
    const channel = interaction.channel;
    const member = interaction.member;

    const tickets = await getTickets();
    const ticketData = tickets[channel.id];

    if (!channel.name.startsWith("ticket-")) {
      return interaction.reply({ content: "This command can only be used inside a ticket channel.", ephemeral: true });
    }

    const hasRole = member.roles.cache.some(r => ALLOWED_ROLES.includes(r.id));
    if (!hasRole) return interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });

    await channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      SendMessages: true,
      AttachFiles: true,
      ReadMessageHistory: true
    });

    await interaction.reply({ content: `${user.tag} has been added to this ticket.`, ephemeral: false });
  }
};
