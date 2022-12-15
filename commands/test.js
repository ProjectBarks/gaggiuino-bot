import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonStyle,
  ButtonBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import GitHub from 'github-api';
import Fuse from 'fuse.js';
import Airtable from 'airtable';

import { Cache, CacheKeys } from '../helpers/cache.js';
import { isProduction } from '../helpers/environment.js';

const GITHUB_USER = 'Zer0-bit';
const GITHUB_REPO = 'gaggiuino';
const AIRTABLE_BASE = 'appVJDLktxcKImcay';
const ARBITRARY_MAX_VALUE = 150;

export const data = new SlashCommandBuilder()
  .setName('test')
  .setDescription('test ');

export async function execute(interaction) {
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('select')
      .setPlaceholder('Nothing selected')
      .addOptions(
        {
          label: 'Yes',
          description:
            'Yes, there was a significant amount of liquid in the cup',
          value: 'first_option',
        },
        {
          label: 'Some',
          description: 'Yes, but it was a few drops',
          value: 'second_option',
        },
        {
          label: 'No',
          description: 'No, it all stayed within the basket',
          value: 'third_option',
        }
      )
  );

  await interaction.reply({
    content: 'Was there liquid in the cup when PI finished?',
    ephemeral: true,
    components: [row],
  });
}
