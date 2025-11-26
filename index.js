import { Client, Collection, GatewayIntentBits, Partials, REST, Routes } from "discord.js";
import fs from "fs";
import path from "path";

dotenv.config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

client.commands = new Collection();

const commands = [];
const commandsPath = path.join(process.cwd(), "commands");
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"))) {
  const command = await import(`./commands/${file}`);
  client.commands.set(command.default.data.name, command.default);
  commands.push(command.default.data.toJSON());
}

const eventsPath = path.join(process.cwd(), "events");
for (const file of fs.readdirSync(eventsPath).filter(f => f.endsWith(".js"))) {
  const event = await import(`./events/${file}`);
  if (event.default.once) {
    client.once(event.default.name, (...args) => event.default.execute(...args, client));
  } else {
    client.on(event.default.name, (...args) => event.default.execute(...args, client));
  }
}

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: [] }
    );
    console.log("Commands cleared successfully.");

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("Commands registered successfully.");
  } catch (error) {
    console.error(error);
  }
})();

client.login(process.env.TOKEN);
