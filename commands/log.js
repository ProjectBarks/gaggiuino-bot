import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import GitHub from 'github-api';
import Fuse from 'fuse.js';
import Airtable from 'airtable';

import { Cache, CacheKeys } from '../helpers/cache.js';

const GITHUB_USER = 'Zer0-bit';
const GITHUB_REPO = 'gaggiuino';
const AIRTABLE_BASE = 'appVJDLktxcKImcay';

export const data = new SlashCommandBuilder()
  .setName('log')
  .setDescription('logs a predictive scale shot ')
  .addNumberOption((option) =>
    option
      .setName('predicted')
      .setDescription('predicted shot weight (grams)')
      .setRequired(true)
  )
  .addNumberOption((option) =>
    option
      .setName('actual')
      .setDescription('actual shot weight (grams)')
      .setRequired(true)
  )
  .addNumberOption((option) =>
    option
      .setName('pump-zero')
      .setDescription('pump zero config value')
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName('build')
      .setDescription('git version hash')
      .setAutocomplete(true)
      .setRequired(true)
  )
  .addAttachmentOption((option) =>
    option
      .setName('photo')
      .setDescription('photo of display during shot')
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName('comments')
      .setDescription('important notes to share during the shot')
  );

export async function execute(interaction) {
  const rawP = interaction.options.getNumber('predicted');
  const p = Math.abs(rawP) < 0.005 ? 0.005 : rawP; // prevent divide by zero
  const a = interaction.options.getNumber('actual');
  const pz = interaction.options.getNumber('pump-zero');
  const rawBuild = interaction.options.getString('build');
  const build = rawBuild
    .match(/\s*(?<hash>[A-z0-9]{6})/gi)
    ?.shift()
    ?.trim();
  const attachment = interaction.options.getAttachment('photo');
  const comments = interaction.options.getString('comments', '');

  if (!attachment?.width || !attachment?.height) {
    await interaction.reply({
      content: `Unable to upload response with mime-type: **${
        attachment?.contentType ?? 'unknown'
      }**`,
      ephemeral: true,
    });
    return;
  }

  if (a <= 0) {
    await interaction.reply({
      content: 'You cannot pull a shot with zero or negative weight!',
      ephemeral: true,
    });
    return;
  }

  if (!build) {
    await interaction.reply({
      content:
        'Invalid build format, expected group 6 of alpha-numeric characters.',
      ephemeral: true,
    });
    return;
  }

  const nextPZ = (a - p) / 2;

  const round = (x, digits) =>
    (Math.round(x * 10 ** digits) / 10 ** digits).toFixed(digits);
  const base = new Airtable().base(AIRTABLE_BASE);
  await base('Predicative Scale Tests').create(
    [
      {
        fields: {
          'User Tag': interaction.user.tag,
          Predicted: p,
          Actual: a,
          'Pump Zero': pz,
          'Build Version': build,
        },
      },
    ],
    { typecast: true }
  );

  const embed = new EmbedBuilder()
    .setColor(0xef4e2b)
    .setTitle('Predictive Scale Test')
    .setAuthor({
      name: `@${interaction.user.username}`,
      iconURL: interaction.user.avatarURL(),
    })
    .addFields(
      { name: 'Predicted', value: round(p, 2), inline: true },
      { name: 'Actual', value: round(a, 2), inline: true },
      { name: 'Pump-Zero', value: round(pz, 2), inline: true },
      { name: 'Build', value: build, inline: true },
      { name: 'Calculated Next Pump-Zero', value: round(nextPZ, 2) }
    )
    .setImage(attachment.url)
    .setTimestamp();
  if (comments) embed.setDescription(comments);

  await interaction.reply({ embeds: [embed] });
}

export async function autocomplete(interaction) {
  const focusedValue = interaction.options.getFocused();
  let branches = Cache.get(CacheKeys.BRANCHES);
  if (!branches) {
    console.log('repopulating github branch cache');
    const gh = new GitHub();
    const repo = gh.getRepo(GITHUB_USER, GITHUB_REPO);
    const response = await repo.listBranches();
    branches = response.data;
    Cache.set(CacheKeys.BRANCHES, branches, 10 * 60);
  }

  const fuse = new Fuse(branches, { keys: ['name'] });
  const filtered =
    focusedValue.length > 0
      ? fuse.search(focusedValue).map((x) => x.item)
      : branches;

  await interaction.respond(
    filtered.map((branch) => ({
      name: `${branch.commit.sha.substr(0, 6)} - latest ${branch.name}`,
      value: branch.commit.sha.substr(0, 6),
    }))
  );
}
