
/**
* Given an array of numbers, redistribute the space between them. The mode can be 'even' or 'priority'. 
* If mode is 'even', the space is distributed evenly between all the elements. If mode is 'priority', 
* the space is distributed based on the priorityIndexes or priorityPosition.
*
* @param arr The array of numbers to redistribute the space
* @param target The target number for all the elements in the array to add up to. 
* @param mode The mode to redistribute the space. Can be 'even' or 'priority' - defaults to 'even'
* @param priorityIndexes The indexes that have priority. Only used if mode is 'priority' and priorityPosition is not provided.
* @param priorityPosition The position of the priority. Can be 'first' or 'last'. Only used if mode is 'priority' and priorityIndexes is not provided.
* @returns The array of numbers with the redistributed space
*/
export const redistributeSpace = (
  arr: number[],
  target: number,
  mode: 'even' | 'priority' = 'even',
  priorities?: 'first' | 'last' | number[],
): number[] => {
  if (target < 0) {
    console.warn('Target size cannot be negative');
    return arr;
  }
  let calculated = arr.slice();

  const currentTotal = arr.reduce((sum, value) => sum + value, 0);
  const adjustmentFactor = target - currentTotal;

  if (mode === 'even') {
    // Distribute the adjustmentFactor evenly across all elements
    const adjustmentPerElement = adjustmentFactor > 0
      ? Math.floor(adjustmentFactor / arr.length)
      : Math.ceil(adjustmentFactor / arr.length);

    calculated = calculated.map(value => value + adjustmentPerElement);
  } else if (mode === 'priority' && priorities !== undefined) {
    let priorityIndexes: number[] = [];
    if (Array.isArray(priorities)) {
      // check if priorities are out of range
      const maxIndex = arr.length - 1;
      priorities.forEach(index => {
        if (index < 0 || index > maxIndex) {
          console.warn(`Priority index ${index} is out of range`);
          return arr;
        }
      });
      priorityIndexes = priorities;
    }
    if (priorities === 'first') {
      priorityIndexes = [0];
    }
    if (priorities === 'last') {
      priorityIndexes = [arr.length - 1];
    }

    // split the adjustment factor between priority and non-priority elements
    let perPriorityChange = adjustmentFactor;
    if (priorityIndexes.length > 1) {
      perPriorityChange = adjustmentFactor > 0
        ? Math.floor(adjustmentFactor / priorityIndexes.length)
        : Math.ceil(adjustmentFactor / priorityIndexes.length);
    }

    // Apply adjustment evenly to priority elements
    for (let i = 0; i < calculated.length; i++) {
      if (priorityIndexes.includes(i)) {
        calculated[i] += perPriorityChange;
      }
    }


  } else {
    console.warn('Mode "priority" requires priorities to favor for resizing');
  }

  // Ensure the final array sums up to targetSize due to possible floating-point arithmetic issues
  const finalTotal = calculated.reduce((sum, value) => sum + value, 0);
  if (finalTotal !== target) {
    const roundingError = target - finalTotal;
    calculated[calculated.length - 1] += roundingError;
  }

  return calculated;
};
