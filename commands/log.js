import {
  SlashCommandBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import GitHub from 'github-api';
import Fuse from 'fuse.js';
import Airtable from 'airtable';
import regression from 'regression';
import { stripIndents } from 'common-tags';

import { Cache, CacheKeys } from '../helpers/cache.js';
import { isProduction } from '../helpers/environment.js';

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
      .setRequired(isProduction)
  )
  .addAttachmentOption((option) =>
    option
      .setName('photo')
      .setDescription('photo of display during shot')
      .setRequired(isProduction)
  )
  .addStringOption((option) =>
    option
      .setName('comments')
      .setDescription('important notes to share during the shot')
  );

const GITHUB_USER = 'Zer0-bit';
const GITHUB_REPO = 'gaggiuino';
const AIRTABLE_BASE = 'appVJDLktxcKImcay';
const AIRTABLE_TABLE_NAME = 'Predicative Scale Tests';
const ARBITRARY_MAX_VALUE = 150;

const AirtableFields = {
  USER: 'User Tag',
  PREDICTED: 'Predicted',
  ACTUAL: 'Actual',
  PUMP_ZERO: 'Pump Zero',
  BUILD: 'Build Version',
  CREATED: 'Created',
  EXCLUDE_FROM_CALCULATIONS: 'Exclude From Calculations',
};

export async function execute(interaction) {
  const withDevDefault = (v, d) => v ?? (isProduction ? undefined : d);

  const rawP = interaction.options.getNumber('predicted');
  const p = Math.abs(rawP) < 0.005 ? 0.005 : rawP; // prevent divide by zero
  const a = interaction.options.getNumber('actual');
  const pz = interaction.options.getNumber('pump-zero');
  const rawBuild = withDevDefault(
    interaction.options.getString('build'),
    'aaaaaa'
  );
  const build = rawBuild
    ?.match(/\s*(?<hash>[A-z0-9]{6})/gi)
    ?.shift()
    ?.trim();
  const attachment = withDevDefault(
    interaction.options.getAttachment('photo'),
    {
      url: 'https://media.discordapp.net/ephemeral-attachments/1048836765357723739/1049423157947277402/IMG_6292.jpeg',
      width: 100,
      height: 100,
    }
  );
  const comments = interaction.options.getString('comments', '');

  //
  /// VALIDATION
  //
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

  const maxVal = Math.max(p, a, pz);
  if (maxVal > ARBITRARY_MAX_VALUE) {
    await interaction.reply({
      content: `Input of, "${round(
        maxVal,
        2
      )}" is too large, are you sure you entered the values in the correct format?`,
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

  //
  /// FETCH DATA
  //
  const base = new Airtable().base(AIRTABLE_BASE);
  if (isProduction) {
    await base(AIRTABLE_TABLE_NAME).create(
      [
        {
          fields: {
            [AirtableFields.USER]: interaction.user.tag,
            [AirtableFields.PREDICTED]: p,
            [AirtableFields.ACTUAL]: a,
            [AirtableFields.PUMP_ZERO]: pz,
            [AirtableFields.BUILD]: build,
          },
        },
      ],
      { typecast: true }
    );
  }

  //
  /// NEXT PUMP ZERO CALCULATION
  //
  const records = await base(AIRTABLE_TABLE_NAME)
    .select({
      view: 'Grid view',
      fields: Object.values(AirtableFields),
      filterByFormula: `{${AirtableFields.USER}} = '${interaction.user.tag}'`,
      sort: [{ field: AirtableFields.CREATED, direction: 'desc' }],
    })
    .firstPage();

  const samples = records
    .filter(
      (record) => !record.fields[AirtableFields.EXCLUDE_FROM_CALCULATIONS]
    )
    .map((record) => {
      const delta =
        record.fields[AirtableFields.PREDICTED] -
        record.fields[AirtableFields.ACTUAL];
      const pz = record.fields[AirtableFields.PUMP_ZERO];
      return [delta, pz];
    });

  const round = (x, digits) =>
    (Math.round(x * 10 ** digits) / 10 ** digits).toFixed(digits);

  function getLabelForBound(bounds, input) {
    for (const bound of bounds) {
      if (bound[0] >= input) return bound[1];
    }
    return bounds[bounds.length - 1][1];
  }

  function getNextPumpZero(p, a, pz, samples) {
    const DEFAULT_RESULT = {
      isLikelyBadData: false,
      next: pz + (a - p) / 2,
      quality: 'poor',
    };
    if (samples.length < 4) return DEFAULT_RESULT;
    const lr = regression.linear(samples);
    console.log(`${interaction.user.tag} regression`, lr);
    if (lr.r2 <= 0.5) return { ...DEFAULT_RESULT, isLikelyBadData: true };
    const next = lr.equation.pop();
    return {
      ...DEFAULT_RESULT,
      next,
      quality: getLabelForBound(
        [
          [0.5, 'poor'],
          [0.6, 'fair'],
          [0.8, 'good'],
          [0.9, 'very-good'],
        ],
        lr.r2
      ),
    };
  }

  const {
    next: nextPZ,
    quality: nextPZQuality,
    isLikelyBadData,
  } = getNextPumpZero(p, a, pz, samples);

  //
  /// DISPLAY
  //
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
      { name: 'Submission', value: `#${samples.length}`, inline: true },
      {
        name: 'Next Pump-Zero',
        value: `${round(nextPZ, 2)} (${nextPZQuality})`,
        inline: true,
      }
    )
    .setImage(attachment?.url)
    .setTimestamp();
  if (comments) embed.setDescription(comments);

  await interaction.reply({ embeds: [embed] });
  if (isLikelyBadData)
    await interaction.followUp({
      content: `**With "${samples.length}" samples we noticed data currently has week correlation.** Ensure you are following the advice provided.`,
      ephemeral: true,
    });
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
