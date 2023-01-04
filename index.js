import * as dotenv from 'dotenv';
dotenv.config();
import {
  Client,
  REST,
  Routes,
  Events,
  GatewayIntentBits,
  Collection,
} from 'discord.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// COMMAND SETUP
client.commands = new Collection();
const commands = await Promise.all([
  import('./commands/log.js'),
  import('./commands/log-history.js'),
]);
for (const command of commands) {
  client.commands.set(command.data.name, command);
}
(async () => {
  try {
    console.log(`refreshing ${commands.length} application (/) commands.`);
    const data = await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands.map((command) => command.data.toJSON()) }
    );

    console.log(
      `successfully reloaded ${data.length} application (/) commands.`
    );
  } catch (error) {
    console.error(error);
  }
})();

// when the client is ready, run this code (only once)
// we use 'c' for the event parameter to keep it separate from the already defined 'client'
client.once(Events.ClientReady, (c) => {
  console.log(`logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) return;
  const command = interaction.client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  if (interaction.isChatInputCommand()) {
    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      interaction.replied
        ? await interaction.reply({
            content: 'There was an error while executing this command!',
            ephemeral: true,
          })
        : await interaction.editReply({
            content: 'There was an error while executing this command!',
            ephemeral: true,
          });
    }
  } else if (interaction.isAutocomplete()) {
    try {
      await command.autocomplete(interaction);
    } catch (error) {
      console.error(error);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
