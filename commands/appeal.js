const { SlashCommandBuilder } = require("discord.js");

const Roles = ["1403777162460397649", "1402693639486046278"];
const AppealBlacklistRole = "1442913863988281465";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("appeal")
    .setDescription("Appeals")
    .addSubcommand(sub =>
      sub
        .setName("blacklist")
        .setDescription("Blacklist a user from appealing")
        .addUserOption(opt =>
          opt
            .setName("user")
            .setDescription("User to blacklist from appeals")
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName("reason")
            .setDescription("Reason to blacklist the user for")
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!interaction.member.roles.cache.some(r => Roles.includes(r.id))) {
      return interaction.reply({ content: "You do not have permission to use this command!", ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "blacklist") {
      const Target = interaction.options.getUser("user");
      const Reason = interaction.options.getString("reason");
      const Member = await interaction.guild.members.fetch(Target.id).catch(() => null);

      if (Member) {
        await Member.roles.add(AppealBlacklistRole).catch(() => {});
      }

      await interaction.reply(`Successfully blacklisted ${Target.tag} for: ${Reason}`);
    }
  }
};
