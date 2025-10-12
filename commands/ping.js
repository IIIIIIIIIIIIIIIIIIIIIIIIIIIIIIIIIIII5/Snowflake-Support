import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check the bot's current ping"),

  async execute(interaction) {
    const ping = Math.round(interaction.client.ws.ping);
    await interaction.reply(`Pong! Ping: ${ping}ms`);
  }
};
