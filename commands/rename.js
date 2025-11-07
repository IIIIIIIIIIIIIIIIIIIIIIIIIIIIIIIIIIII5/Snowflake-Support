import { SlashCommandBuilder } from "discord.js";
import fetch from "node-fetch";

const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}`;
const ALLOWED_ROLES = [
  "1403777162460397649",
  "1235182843487981669",
  "1423280211239243826",
  "1402693639486046278"
];

async function GetTickets() {
  const Res = await fetch(JSONBIN_URL, { headers: { "X-Master-Key": process.env.JSONBIN_KEY } });
  const Data = await Res.json();
  return Data.record || {};
}

export default {
  data: new SlashCommandBuilder()
    .setName("rename")
    .setDescription("Rename the current ticket")
    .addStringOption(option =>
      option
        .setName("name")
        .setDescription("New name for the ticket")
        .setRequired(true)
    ),

  async execute(Interaction) {
    const NewName = Interaction.options.getString("name");
    const Channel = Interaction.channel;
    const Member = Interaction.member;

    if (!Channel.name.startsWith("ticket-")) {
      return Interaction.reply({ content: "This command can only be used inside a ticket channel.", ephemeral: true });
    }

    const HasRole = Member.roles.cache.some(r => ALLOWED_ROLES.includes(r.id));
    if (!HasRole) return Interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });

    await Channel.setName(`ticket-${NewName.toLowerCase().replace(/\s+/g, '-')}`);
    Interaction.reply({ content: `Ticket has been renamed to **ticket-${NewName}**.`, ephemeral: false });

    const Tickets = await GetTickets();
    if (Tickets[Channel.id]) {
      Tickets[Channel.id].customName = NewName;
      await fetch(JSONBIN_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Master-Key": process.env.JSONBIN_KEY },
        body: JSON.stringify(Tickets)
      });
    }
  }
};
