import { Client, Collection, GatewayIntentBits, Partials, REST, Routes } from "discord.js";
import fs from "fs";
import path from "path";
import interactionHandler from "./events/interactionCreate.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

client.commands = new Collection();

const commandsPath = path.join(process.cwd(), "commands");
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"))) {
  const commandModule = await import(`./commands/${file}`);
  const command = commandModule.default;
  client.commands.set(command.data.name, command);
}

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [] });
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: Array.from(client.commands.values()).map(c => c.data.toJSON()) }
    );
    console.log("Commands registered successfully.");
  } catch (err) { console.error(err); }
})();

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.content.startsWith("!")) return;
  const args = message.content.slice(1).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  if (cmd === "close") {
    await interactionHandler.CloseTicketMessage(message, client);
  }
});

client.login(process.env.TOKEN);
