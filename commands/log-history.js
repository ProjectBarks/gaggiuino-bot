import {
  SlashCommandBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  DiscordjsError,
} from 'discord.js';
import Airtable from 'airtable';

import {
  AIRTABLE_BASE,
  AIRTABLE_PREDICTIVE_SCALES_TABLE,
  AirtablePredictiveScalesFields,
} from '../helpers/airtable.js';
import { GITHUB_USER, GITHUB_REPO } from '../helpers/github.js';
import renderTable, { Table } from '../helpers/table-renderer.js';

export const data = new SlashCommandBuilder()
  .setName('log-history')
  .setDescription('view/manage predictive scale history')
  .addIntegerOption((option) =>
    option.setName('drop-oldest').setDescription('drop the oldest N records')
  )
  .addIntegerOption((option) =>
    option.setName('drop').setDescription('drop a specific record')
  );

export async function execute(interaction) {
  const dropOldest = interaction.options.getInteger('drop-oldest');
  const drop = interaction.options.getInteger('drop');

  await interaction.deferReply({ ephemeral: true });
  const base = new Airtable().base(AIRTABLE_BASE);
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

  let samples = records.filter(
    (r, i) =>
      !r.fields[AirtablePredictiveScalesFields.EXCLUDE_FROM_CALCULATIONS]
  );
  samples = samples.filter(
    (r, i) =>
      (!drop || drop === r.fields[AirtablePredictiveScalesFields.ID]) &&
      (!dropOldest || samples.length - i <= dropOldest)
  );

  if (samples.length <= 0) {
    await interaction.editReply('No matching records!');
    return;
  }

  const isDrop = drop || dropOldest;
  const canvas = renderTable({
    title: isDrop ? 'Logs to Drop' : 'Predictive Scale Test Log',
    columns: [
      {
        width: 75,
        title: 'ID',
        dataIndex: AirtablePredictiveScalesFields.ID,
      },
      {
        width: 110,
        title: 'Predicted',
        dataIndex: AirtablePredictiveScalesFields.PREDICTED,
      },
      {
        width: 100,
        title: 'Actual',
        dataIndex: AirtablePredictiveScalesFields.ACTUAL,
      },
      {
        width: 120,
        title: 'Pump Zero',
        dataIndex: AirtablePredictiveScalesFields.PUMP_ZERO,
      },
      {
        width: 100,
        title: 'Build',
        dataIndex: AirtablePredictiveScalesFields.BUILD,
      },
    ],
    dataSource: [Table.ROW_SEPARATOR, ...samples.map((r) => r.fields)],
  });

  const dropID = 'confirmDropLogs';
  const message = await interaction.editReply({
    files: [{ name: 'data.png', attachment: canvas.toBuffer('image/png') }],
    components: isDrop
      ? [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(dropID)
              .setLabel('Drop')
              .setStyle(ButtonStyle.Danger)
          ),
        ]
      : [],
  });

  if (isDrop) {
    await message
      .awaitMessageComponent({
        filter: (i) =>
          i.customId === dropID && i.user.id === interaction.user.id,
        time: 10000,
      })
      .finally(() =>
        interaction.editReply({
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(dropID)
                .setLabel('Drop')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(true)
            ),
          ],
        })
      )
      .then(async (i) => {
        await base(AIRTABLE_PREDICTIVE_SCALES_TABLE).update(
          samples.map((sample) => ({
            id: sample.id,
            fields: {
              [AirtablePredictiveScalesFields.EXCLUDE_FROM_CALCULATIONS]: true,
            },
          }))
        );
        await i.reply({
          content: 'Success, dropped logs!',
          ephemeral: true,
        });
      })
      .catch((e) => {
        if (!(e instanceof DiscordjsError)) throw e;
        interaction.followUp({
          content: "Disabling drop log request. You didn't reply in time!",
          ephemeral: true,
        });
      });
  }
}
