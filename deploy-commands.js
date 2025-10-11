import { REST, Routes } from 'discord.js';
import fs from 'fs';

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENTID;

const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = await import(`./commands/${file}`);
    commands.push(command.default.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('Registering slash commands globally...');
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands },
        );
        console.log('Commands registered successfully!');
    } catch (error) {
        console.error(error);
    }
})();
