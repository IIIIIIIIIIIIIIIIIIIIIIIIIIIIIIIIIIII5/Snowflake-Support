import { SlashCommandBuilder, PermissionsBitField } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("transfer")
    .setDescription("Transfer ownership of a ticket")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The new owner of the ticket")
        .setRequired(true)
    ),

  async execute(interaction, Client) {
    const Guild = interaction.guild;
    const Channel = interaction.channel;
    const Member = interaction.member;

    const AllowedRoles = [
      "1403777886661644398",
      "1403777609522745485",
      "1403777335416848537",
      "1403777452517494784",
      "1403777162460397649",
      "1423280211239243826"
    ];

    const hasPermission =
      Member.permissions.has(PermissionsBitField.Flags.Administrator) ||
      Member.roles.cache.some(r => AllowedRoles.includes(r.id));

    if (!hasPermission)
      return interaction.reply({ content: "You do not have permission to transfer ticket ownership.", ephemeral: true });

    const JsonBinUrl = `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}`;
    let Tickets = {};
    try {
      const res = await fetch(JsonBinUrl, { headers: { "X-Master-Key": process.env.JSONBIN_KEY } });
      const data = await res.json();
      Tickets = data.record || {};
    } catch {
      return interaction.reply({ content: "Failed to load ticket data.", ephemeral: true });
    }

    const TicketData = Tickets[Channel.id];
    if (!TicketData)
      return interaction.reply({ content: "This channel is not a ticket.", ephemeral: true });

    const NewOwner = interaction.options.getUser("user");
    const NewOwnerMember = await Guild.members.fetch(NewOwner.id).catch(() => null);
    if (!NewOwnerMember)
      return interaction.reply({ content: "The user is not in this server.", ephemeral: true });

    if (NewOwner.id === TicketData.ownerId)
      return interaction.reply({ content: "This user is already the ticket owner.", ephemeral: true });

    const OldOwnerId = TicketData.ownerId;
    TicketData.ownerId = NewOwner.id;
    Tickets[Channel.id] = TicketData;

    try {
      await fetch(JsonBinUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Master-Key": process.env.JSONBIN_KEY },
        body: JSON.stringify(Tickets)
      });
    } catch {
      return interaction.reply({ content: "Failed to save ticket data.", ephemeral: true });
    }

    const ParentCategory = Guild.channels.cache.get(Channel.parentId);
    if (ParentCategory) {
      const Overwrites = ParentCategory.permissionOverwrites.cache.map(Po => ({
        id: Po.id,
        allow: new PermissionsBitField(Po.allow).bitfield,
        deny: new PermissionsBitField(Po.deny).bitfield
      }));
      await Channel.permissionOverwrites.set(Overwrites);
      await Channel.permissionOverwrites.edit(NewOwner.id, {
        ViewChannel: true,
        SendMessages: true,
        AttachFiles: true
      });
      await Channel.permissionOverwrites.delete(OldOwnerId).catch(() => {});
    }

    await interaction.reply({ content: `Ticket ownership has been transferred to **${NewOwner.tag}**.`, ephemeral: false });

    try {
      const OldOwner = await Client.users.fetch(OldOwnerId);
      await OldOwner.send(`Your ticket in **${Guild.name}** has been transferred to **${NewOwner.tag}**.`);
    } catch {}

    try {
      await NewOwner.send(`You are now the owner of ticket **${Channel.name}** in **${Guild.name}**.`);
    } catch {}
  }
};
