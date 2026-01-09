import { SlashCommandBuilder } from "discord.js";

const AppealBlacklistRole = "1442913863988281465";
const AllowedRoles = [
  "1403777162460397649",
  "1402693639486046278",
  "1235182843487981669",
  "1459193961808658534"
];

export default {
  data: new SlashCommandBuilder()
    .setName("appeal")
    .setDescription("Manage appeal blacklist")
    .addSubcommand(sub =>
      sub
        .setName("blacklist")
        .setDescription("Blacklist a user from appealing")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User to blacklist")
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("reason")
            .setDescription("Reason for blacklist")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("unblacklist")
        .setDescription("Remove appeal blacklist from a user")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User to remove from blacklist")
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const Member = interaction.member;

    const HasRole = Member.roles.cache.some(r => AllowedRoles.includes(r.id));
    if (!HasRole) return interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });

    const Subcommand = interaction.options.getSubcommand();
    const TargetUser = interaction.options.getUser("user");
    const GuildMember = await interaction.guild.members.fetch(TargetUser.id);

    if (Subcommand === "blacklist") {
      const Reason = interaction.options.getString("reason");
      if (!GuildMember) return interaction.reply({ content: "User not found in this server.", ephemeral: true });

      await GuildMember.roles.add(AppealBlacklistRole, Reason);
      await interaction.reply({ content: `${TargetUser.tag} has been blacklisted from appealing for: ${Reason}`, ephemeral: false });

    } else if (Subcommand === "unblacklist") {
      if (!GuildMember) return interaction.reply({ content: "User not found in this server.", ephemeral: true });

      await GuildMember.roles.remove(AppealBlacklistRole, "Appeal blacklist removed");
      await interaction.reply({ content: `${TargetUser.tag} has been removed from the appeal blacklist.`, ephemeral: false });
    }
  }
};
