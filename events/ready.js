import { REST, Routes } from "discord.js";

export default {
  name: "ready",
  once: true,
  async execute(client) {
    console.log(`Logged in as ${client.user.tag}`);

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
    const commands = client.commands.map(cmd => cmd.data.toJSON());

    try {
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
      );
      console.log("Global slash commands registered.");
    } catch (error) {
      console.error(error);
    }
  },
};
