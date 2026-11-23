import { examples, type PartExamples } from '@omniviewdev/kit/examples';
import { StackDefault, TextDefault } from './foundations';

export const groups: PartExamples = {
  ...examples,
  Stack: { Default: StackDefault },
  Text: { Default: TextDefault },
};
