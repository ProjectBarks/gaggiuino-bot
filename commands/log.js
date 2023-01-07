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
import { oneLine } from 'common-tags';

import {
  AIRTABLE_BASE,
  AIRTABLE_PREDICTIVE_SCALES_TABLE,
  AirtablePredictiveScalesFields,
} from '../helpers/airtable.js';
import { Cache, CacheKeys } from '../helpers/cache.js';
import { isProduction } from '../helpers/environment.js';

export const data = new SlashCommandBuilder()
  .setName('log')
  .setDescription('logs a predictive scale shot')
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
const ARBITRARY_MAX_VALUE = 150;

export async function execute(interaction) {
  const withDevDefault = (v, d) => v ?? (isProduction ? undefined : d);
  const round = (x, digits) =>
    (Math.round(x * 10 ** digits) / 10 ** digits).toFixed(digits);

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
  /// INSERT DATA
  //
  await interaction.deferReply();
  const base = new Airtable().base(AIRTABLE_BASE);
  if (isProduction) {
    await base(AIRTABLE_PREDICTIVE_SCALES_TABLE).create(
      [
        {
          fields: {
            [AirtablePredictiveScalesFields.USER]: interaction.user.tag,
            [AirtablePredictiveScalesFields.PREDICTED]: p,
            [AirtablePredictiveScalesFields.ACTUAL]: a,
            [AirtablePredictiveScalesFields.PUMP_ZERO]: pz,
            [AirtablePredictiveScalesFields.BUILD]: build,
          },
        },
      ],
      { typecast: true }
    );
  }

  //
  /// FETCH DATA
  //
  const records = await base(AIRTABLE_PREDICTIVE_SCALES_TABLE)
    .select({
      view: 'Grid view',
      fields: Object.values(AirtablePredictiveScalesFields),
      filterByFormula: `{${AirtablePredictiveScalesFields.USER}} = '${interaction.user.tag}'`,
      sort: [
        { field: AirtablePredictiveScalesFields.CREATED, direction: 'desc' },
      ],
    })
    .firstPage();

  //
  /// NEXT PUMP ZERO CALCULATION
  //
  const samples = records
    .filter(
      (record) =>
        !record.fields[AirtablePredictiveScalesFields.EXCLUDE_FROM_CALCULATIONS]
    )
    .map((record) => {
      const delta =
        record.fields[AirtablePredictiveScalesFields.PREDICTED] -
        record.fields[AirtablePredictiveScalesFields.ACTUAL];
      const pz = record.fields[AirtablePredictiveScalesFields.PUMP_ZERO];
      return [delta, pz];
    });

  function getLabelForBound(bounds, input) {
    for (const bound of bounds) {
      if (bound[0] >= input) return bound[1];
    }
    return bounds[bounds.length - 1][1];
  }

  function getNextPumpZero(p, a, pz, samples) {
    const divisor = samples.length < 4 ? 2 : 4;
    const DEFAULT_RESULT = {
      isLikelyBadData: false,
      next: pz + (a - p) / divisor,
    };
    if (samples.length < 4) return { ...DEFAULT_RESULT, quality: 'need-data' };
    const lr = regression.linear(samples);
    console.log(`${interaction.user.tag} regression`, lr);
    if (lr.r2 <= 0.5)
      return { ...DEFAULT_RESULT, quality: 'poor', isLikelyBadData: true };
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

  await interaction.editReply({ embeds: [embed] });
  if (isLikelyBadData)
    await interaction.followUp({
      content:
        oneLine`
        With "${samples.length}" samples we noticed your entries have
        weak correlation, **please ensure you're following the
        calibration advice in the [pinned post](
        https://discord.com/channels/890339612441063494/989599042277343273/1052665282054864908)**.` +
        '\n\n' +
        oneLine`
        *After reading the post consider dropping some of your bad
        data with \`/log-history\`.*`,
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
