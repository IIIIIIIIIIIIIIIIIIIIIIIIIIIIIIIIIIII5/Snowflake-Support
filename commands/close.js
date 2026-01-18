import { SlashCommandBuilder } from "discord.js";
import { CloseTicket } from "../events/interactionCreate.js";

export default {
  data: new SlashCommandBuilder()
    .setName("close")
    .setDescription("Close the current ticket"),
  async execute(interaction, client) {
    await CloseTicket(interaction, client);
  }
};
