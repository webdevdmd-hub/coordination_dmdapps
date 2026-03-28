type TimestampedRecord = {
  createdAt?: unknown;
  updatedAt?: unknown;
};

const toTimestamp = (value?: unknown) => {
  if (typeof value !== 'string' || !value) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
};

const compareTimestampsDesc = (left?: unknown, right?: unknown) =>
  toTimestamp(right) - toTimestamp(left);

export const sortRecordsNewestFirst = <T extends TimestampedRecord>(records: T[]) =>
  [...records].sort((a, b) => {
    const createdAtComparison = compareTimestampsDesc(a.createdAt, b.createdAt);
    if (createdAtComparison !== 0) {
      return createdAtComparison;
    }
    const updatedAtComparison = compareTimestampsDesc(a.updatedAt, b.updatedAt);
    if (updatedAtComparison !== 0) {
      return updatedAtComparison;
    }
    return 0;
  });
