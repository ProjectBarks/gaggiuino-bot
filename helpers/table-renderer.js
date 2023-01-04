import { createCanvas } from 'canvas';

const cellWidth = 100;
const cellHeight = 40;
const offsetLeft = 8;
const offsetTop = 26;
const spacing = 20;
const titleSpacing = 2;
const fontFamily = 'sans-serif';
const paddingVertical = 5;
const paddingHorizontal = 5;
const backgroundColor = '#2E3136';

const getTableWidth = (columns) => {
  return (
    columns?.reduce(
      (sum, col) => sum + (col === '|' ? 1 : col.width ?? cellWidth),
      0
    ) ?? cellWidth
  );
};

const getTableHeight = (title, columns, dataSource) => {
  const titleHeight = title ? cellHeight + titleSpacing : 0;
  const headerHeight =
    !columns?.length || columns.every((col) => !col.title) ? 0 : cellHeight;
  const bodyHeight =
    dataSource?.reduce(
      (height, row) => height + (row === '-' ? 1 : cellHeight),
      0
    ) ?? 0;
  return titleHeight + headerHeight + bodyHeight;
};

const renderBackground = (ctx, width, height) => {
  ctx.fillStyle = backgroundColor;
  ctx.strokeStyle = backgroundColor;
  ctx.fillRect(-10, -10, width + 10, height + 10);
};

const renderHorizontalLines =
  (ctx) =>
  (dataSource, { x, y, width }) => {
    ctx.strokeStyle = '#FFFFFF';
    dataSource?.forEach((row, i) => {
      if (row !== '-') return;
      ctx.moveTo(paddingHorizontal, y[i]);
      ctx.lineTo(paddingHorizontal + width, y[i]);
      ctx.stroke();
    });
  };

const renderVerticalLines =
  (ctx) =>
  (title, columns, { x, y, height }) => {
    ctx.strokeStyle = '#FFFFFF';
    const titleHeight = title ? cellHeight + titleSpacing : 0;
    const headerHeight =
      !columns?.length || columns.every((col) => !col.title) ? 0 : cellHeight;
    columns?.forEach((col, i) => {
      if (col !== '|') return;
      ctx.moveTo(x[i], y[0] - headerHeight);
      ctx.lineTo(x[i], y[0] - headerHeight + height - titleHeight);
      ctx.stroke();
    });
  };

const renderTitle =
  (ctx) =>
  (title, titleStyle = {}, { top, x }) => {
    if (!title) return;
    ctx.font = titleStyle.font ?? `bold 24px ${fontFamily}`;
    ctx.fillStyle = titleStyle?.fillStyle ?? '#FFFFFF';
    ctx.textAlign = titleStyle?.textAlign ?? 'left';
    ctx.fillText(
      title,
      paddingHorizontal + offsetLeft,
      top + offsetTop + (titleStyle?.offsetTop ?? 0)
    );
  };

const renderHeader =
  (ctx) =>
  (columns, { x, y }) => {
    ctx.font = `normal 16px ${fontFamily}`;
    ctx.fillStyle = '#FFFFFF';
    columns?.forEach((col, i) => {
      if (typeof col != 'object' || !col.title) return;
      const { title, width = cellWidth, align = 'left' } = col;
      ctx.textAlign = align;
      ctx.fillText(
        title,
        x[i] + (align === 'right' ? width - offsetLeft : offsetLeft),
        y[0] - cellHeight + offsetTop
      );
    });
  };

const renderRows =
  (ctx) =>
  (columns, dataSource, { x, y }) => {
    ctx.fillStyle = '#FFFFFF';
    dataSource?.forEach((row, i) => {
      if (row === '-') return;
      columns?.forEach(
        (
          {
            width = cellWidth,
            dataIndex,
            align = 'left',
            prefix = '',
            suffix = '',
          },
          j
        ) => {
          if (!row[dataIndex]) return;
          const content = prefix + row[dataIndex] + suffix;
          ctx.textAlign = align;
          ctx.fillText(
            content,
            x[j] + (align === 'right' ? width - offsetLeft : offsetLeft),
            y[i] + offsetTop,
            width - 2 * offsetLeft
          );
        }
      );
    });
  };

const renderTable = (
  { title, titleStyle = {}, columns, dataSource },
  { ctx, width, height, top = paddingVertical }
) => {
  const info = {
    width,
    height,
    top,
    x: new Array(columns?.length ?? 0)
      .fill()
      .map(
        (_, i) =>
          paddingHorizontal +
          columns?.reduce(
            (x, col, j) =>
              x + (j >= i ? 0 : col === '|' ? 1 : col.width ?? cellWidth),
            0
          )
      ),
    y: new Array(dataSource?.length ?? 0).fill().map((_, i) => {
      const titleHeight = title ? cellHeight + titleSpacing : 0;
      const headerHeight =
        !columns?.length || columns.every((col) => !col.title) ? 0 : cellHeight;
      return (
        top +
        titleHeight +
        headerHeight +
        dataSource?.reduce(
          (y, row, j) => y + (j >= i ? 0 : row === '-' ? 1 : cellHeight),
          0
        )
      );
    }),
  };
  renderHorizontalLines(ctx)(dataSource, info);
  renderVerticalLines(ctx)(title, columns, info);
  renderTitle(ctx)(title, titleStyle, info);
  renderHeader(ctx)(columns, info);
  renderRows(ctx)(columns, dataSource, info);
};

const renderTables = (tables, { ctx, width, height }) => {
  tables.forEach((table, i) => {
    const { title, columns, dataSource } = table;
    const top =
      tables.reduce(
        (top, { title, columns, dataSource }, j) =>
          top + (j >= i ? 0 : getTableHeight(title, columns, dataSource)),
        0
      ) +
      i * spacing +
      paddingVertical;
    renderTable(table, {
      ctx,
      width: getTableWidth(columns),
      height: getTableHeight(title, columns, dataSource),
      top,
    });
  });
};

export default (table) => {
  const { title, columns, dataSource } = table;
  const width = getTableWidth(columns);
  const height = getTableHeight(title, columns, dataSource);
  const canvas = createCanvas(
    width + 2 * paddingHorizontal,
    height + 2 * paddingVertical
  );
  const ctx = canvas.getContext('2d');
  renderBackground(
    ctx,
    width + 2 * paddingHorizontal,
    height + 2 * paddingVertical
  );
  renderTable(table, { ctx, width, height });
  return canvas;
};

export const Table = { ROW_SEPARATOR: '-' };
