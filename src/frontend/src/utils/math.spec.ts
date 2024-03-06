import { redistributeSpace } from './math';

describe('redistributeSpace', () => {
  test('even distribution with positive adjustment non-float', () => {
    expect(redistributeSpace([10, 20, 30], 90, 'even')).toEqual([20, 30, 40]);
  });

  test('even distribution with positive adjustment float', () => {
    expect(redistributeSpace([10, 20, 30], 100, 'even')).toEqual([23, 33, 44]);
  });

  test('even distribution with negative adjustment non-float', () => {
    expect(redistributeSpace([10, 20, 30], 51, 'even')).toEqual([7, 17, 27]);
  });

  test('even distribution with negative adjustment float', () => {
    expect(redistributeSpace([10, 20, 30], 50, 'even')).toEqual([7, 17, 26]);
  });

  test('priority distribution with target size and single priority index', () => {
    expect(redistributeSpace([10, 20, 30], 100, 'priority', [1])).toEqual([10, 60, 30]);
  });

  test('priority distribution with target size and multiple priority indexes', () => {
    expect(redistributeSpace([10, 20, 30], 100, 'priority', [1, 2])).toEqual([10, 40, 50]);
  });

  test('priority distribution with target size and priority position first', () => {
    expect(redistributeSpace([10, 20, 30], 120, 'priority', 'first')).toEqual([70, 20, 30]);
  });

  test('priority distribution with target size and priority position last', () => {
    expect(redistributeSpace([10, 20, 30], 120, 'priority', 'last')).toEqual([10, 20, 90]);
  });

  test('edge case: empty array', () => {
    expect(redistributeSpace([], 0, 'even')).toEqual([]);
  });

  test('edge case: single element', () => {
    expect(redistributeSpace([50], 100, 'even')).toEqual([100]);
  });

  test('improper use: negative target size', () => {
    expect(redistributeSpace([10, 20], -30, 'even')).toEqual([10, 20]);
  });
});
