import React from 'react';
import get from 'lodash.get';
import { RowContainer } from './ResourceTableRowContainer';

type Memoizer = string | string[] | ((data: any) => string);

/**
* Calculate the memo key based on the memoizer function provided, fallback to default if not provided.
*/
const calcMemoKey = (data: any, memoizer?: Memoizer) => {
  if (typeof memoizer === 'function') {
    return memoizer(data);
  }

  if (Array.isArray(memoizer)) {
    return memoizer.map(key => get(data, key)).join('-');
  }

  if (typeof memoizer === 'string') {
    return memoizer.split(',').map(key => get(data, key)).join('-');
  }

  // memoizer is not provided, so there isn't really a way we can memoize this.
  return null;
};

const ResourceTableRow = React.memo(RowContainer, (prev, next) => {
  const prevMemoKey = calcMemoKey(prev.row.original, prev.memoizer);
  const nextMemoKey = calcMemoKey(next.row.original, next.memoizer);

  return prevMemoKey === nextMemoKey
    && prev.virtualRow.start === next.virtualRow.start
    && prev.isSelected === next.isSelected
    && prev.columnVisibility === next.columnVisibility
    && prev.resizedColumnIds === next.resizedColumnIds;
});

ResourceTableRow.displayName = 'ResourceTableRow';
ResourceTableRow.whyDidYouRender = true;

export default ResourceTableRow;
